import type { Bridge } from "../bridge/http-bridge.js";
import { z } from "zod";
import { isIP } from "node:net";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { runPing } from "../sim/runner.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export function bgpPeers(output: string) {
  return output.split(/(?=BGP neighbor is )/i).flatMap(block => {
    const header = /BGP neighbor is (\S+),\s+remote AS (\d+)/i.exec(block);
    const state = /BGP state\s*=\s*([^,\r\n]+)/i.exec(block)?.[1]?.trim();
    const address = header?.[1];
    if (!address || isIP(address) !== 4 || !state) return [];
    return [{ address, asn: Number(header![2]), established: /^Established$/i.test(state), state }];
  });
}

export function ospfPeers(output: string) {
  return output.split(/\r?\n/).flatMap(line => {
    const [routerId, priority, state, deadTime, address, ...iface] = line.trim().split(/\s+/);
    if (!routerId || isIP(routerId) !== 4 || !priority || !/^\d+$/.test(priority) || !state ||
        !deadTime || !address || isIP(address) !== 4 || !iface.length) return [];
    return [{ routerId, address, state, full: /^FULL(?:\/|$)/i.test(state), interface: iface.join(" ") }];
  });
}

export function learnedRoutes(output: string, protocol: "bgp" | "ospf") {
  const pattern = protocol === "bgp" ? /^\s*B\s+(\S+\/\d+)/ : /^\s*O(?:\s+(?:IA|E[12]|N[12]))?\s+(\S+\/\d+)/;
  return output.split(/\r?\n/).flatMap(line => {
    const prefix = pattern.exec(line)?.[1];
    return prefix ? [prefix] : [];
  });
}

export const ipv4Prefix = z.string().refine(value => {
  const [address, length, extra] = value.split("/");
  return extra === undefined && address !== undefined && isIP(address) === 4 &&
    length !== undefined && /^(?:[0-9]|[12][0-9]|3[0-2])$/.test(length);
}, "Expected an IPv4 CIDR");

const anyAddress = z.string().refine(value => isIP(value) !== 0, "Expected an IP address");
const anyPrefix = z.string().refine(value => {
  const [address, length, extra] = value.split("/");
  return extra === undefined && address !== undefined && length !== undefined &&
    /^\d{1,3}$/.test(length) && (isIP(address) === 6 ? Number(length) <= 128 : ipv4Prefix.safeParse(value).success);
}, "Expected an IPv4 or IPv6 CIDR");

export function ospfv3Peers(output: string) {
  return [...output.matchAll(/^\s*((?:\d{1,3}\.){3}\d{1,3})\s+\d+\s+(\S+)\s+(?:\d+:\d+:\d+|-)\s+(?:\d+\s+)?(\S+)\s*$/gm)]
    .filter(([, id]) => isIP(id!) === 4)
    .map(([, routerId, state, iface]) => ({ routerId: routerId!, state: state!, full: /^FULL(?:\/|$)/i.test(state!), interface: iface! }));
}

function normalizeIpv6Prefix(prefix: string): string {
  const [address, length] = prefix.split("/");
  return new URL(`http://[${address}]`).hostname.slice(1, -1) + "/" + Number(length);
}

export function ospfv3Routes(output: string) {
  return [...output.matchAll(/^\s*O(?:I|E[12]|N[12])?\s+(\S+\/\d+)(?=\s|$)/gmi)]
    .map(match => match[1]!).filter(prefix => isIP(prefix.split("/")[0]!) === 6).map(normalizeIpv6Prefix);
}

export const RoutingCheckSchema = {
  router: z.string().min(1),
  protocol: z.enum(["bgp", "ospf", "ospfv3"]),
  expected_neighbors: z.array(anyAddress).max(32).default([]),
  expected_prefixes: z.array(anyPrefix).max(64).default([]),
  ping: z.object({ source: z.string().min(1), target: anyAddress }).optional(),
};
type RoutingCheck = z.infer<z.ZodObject<typeof RoutingCheckSchema>>;

export async function verifyRouting(bridge: Bridge, args: RoutingCheck) {
  const ipv6 = args.protocol === "ospfv3";
  if (args.expected_neighbors.some(address => isIP(address) !== 4)) {
    throw new Error("Expected neighbors must be IPv4 addresses or OSPF router IDs.");
  }
  if (args.expected_prefixes.some(prefix => isIP(prefix.split("/")[0]!) !== (ipv6 ? 6 : 4)) ||
      args.ping && isIP(args.ping.target) !== (ipv6 ? 6 : 4)) {
    throw new Error("Expected route prefixes and ping target must match the routing address family.");
  }
  const command = ipv6 ? "show ipv6 ospf neighbor" : args.protocol === "bgp" ? "show ip bgp neighbors" : "show ip ospf neighbor";
  const replies = await runCliBlock(bridge, args.router, ["enable", command, ipv6 ? "show ipv6 route" : "show ip route"]);
  const failed = replies.find(reply => reply.timedOut || reply.errors.length);
  if (failed) {
    throw new Error(failed.timedOut ? `CLI timed out during '${failed.command}': ${failed.output.slice(-450)}` : failed.errors.join("\n"));
  }
  const neighborOutput = replies[1]!.output, routeOutput = replies[2]!.output;
  const neighbors = args.protocol === "ospfv3" ? ospfv3Peers(neighborOutput)
    : args.protocol === "bgp" ? bgpPeers(neighborOutput) : ospfPeers(neighborOutput);
  const routes = args.protocol === "ospfv3" ? ospfv3Routes(routeOutput) : learnedRoutes(routeOutput, args.protocol);
  const missingNeighbors = args.expected_neighbors.filter(expected => !neighbors.some(neighbor =>
    "established" in neighbor ? neighbor.address === expected && neighbor.established :
      (("address" in neighbor && neighbor.address === expected) || neighbor.routerId === expected) && neighbor.full));
  const missingPrefixes = args.expected_prefixes.filter(expected => !routes.includes(ipv6 ? normalizeIpv6Prefix(expected) : expected));
  const ping = args.ping ? (await runPing(bridge, args.ping.source, args.ping.target)).result : undefined;
  const verified = !missingNeighbors.length && !missingPrefixes.length && (!ping || ping.complete && ping.received > 0);
  return {
    router: args.router, protocol: args.protocol, neighbors, routes,
    missingNeighbors, missingPrefixes,
    ...(ping ? { ping: { received: ping.received, sent: ping.sent, complete: ping.complete } } : {}),
    verified: args.expected_neighbors.length || args.expected_prefixes.length || ping ? verified : null,
  };
}

export const registerVerifyRoutingTool: ToolModule = ({ bridge, server }) => {
  server.tool("pt_verify_routing", "Read live IPv4 BGP/OSPF or IPv6 OSPFv3 neighbors and installed routes. Check optional expected peers, prefixes and a simulated ping.",
    RoutingCheckSchema, async args => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const result = await verifyRouting(bridge, args);
        return (result.verified === false ? errorResult : textResult)(JSON.stringify(result));
      } catch (error) {
        return errorResult(String(error));
      }
    });
};
