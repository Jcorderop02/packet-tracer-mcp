/**
 * Static routing recipe. Reads the live canvas, walks the router graph and
 * computes a first-hop next-hop for every (router, remote LAN) pair using BFS,
 * then pushes `ip route` lines via the CLI. LANs are detected by looking at
 * router ports that are inside the configured lanPool (or simply have any IP
 * outside the transitPool when no pool is given).
 *
 * Loops over the live canvas only — there is no plan struct. If you re-run
 * after manually changing one router, the next run synthesises against the
 * post-change state.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { captureSnapshot } from "../../canvas/snapshot.js";
import { ipToInt, parseCidr, prefixToMask } from "../../canvas/subnetting.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation } from "../../canvas/types.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs } from "../../ipc/generator.js";

export interface StaticRouteAction {
  readonly device: string;
  readonly destination: string;
  readonly mask: string;
  readonly nextHop: string;
}

interface RouterPort {
  readonly device: string;
  readonly port: string;
  readonly ip: string;
  readonly prefix: number;
  readonly network: string;
}

function maskBits(mask: string): number {
  const n = ipToInt(mask);
  let count = 0;
  for (let i = 31; i >= 0; i--) if (((n >>> i) & 1) === 1) count++;
  return count;
}

function routerInterfaces(snap: CanvasSnapshot): RouterPort[] {
  const out: RouterPort[] = [];
  for (const d of snap.devices) {
    if (d.className !== "Router") continue;
    for (const p of d.ports) {
      if (!p.ip || !p.mask) continue;
      try {
        const prefix = maskBits(p.mask);
        const net = parseCidr(`${p.ip}/${prefix}`);
        out.push({
          device: d.name,
          port: p.name,
          ip: p.ip,
          prefix,
          network: net.network,
        });
      } catch {
        /* skip malformed */
      }
    }
  }
  return out;
}

interface Adjacency {
  readonly neighbour: string;
  readonly via: string; // local port
  readonly nextHopIp: string; // neighbour's IP
  readonly transitNetwork: string;
  readonly transitPrefix: number;
}

function buildAdjacency(snap: CanvasSnapshot, ifaces: RouterPort[]): Map<string, Adjacency[]> {
  const map = new Map<string, Adjacency[]>();
  for (const d of snap.devices) {
    if (d.className !== "Router") map.set(d.name, []); // ignore non-routers
    else map.set(d.name, []);
  }
  for (const lnk of snap.links) {
    const a = snap.devices.find(x => x.name === lnk.aDevice);
    const b = snap.devices.find(x => x.name === lnk.bDevice);
    if (!a || !b) continue;
    if (a.className !== "Router" || b.className !== "Router") continue;
    const aIf = ifaces.find(i => i.device === a.name && i.port === lnk.aPort);
    const bIf = ifaces.find(i => i.device === b.name && i.port === lnk.bPort);
    if (!aIf || !bIf) continue;
    if (aIf.network !== bIf.network) continue; // not in same subnet, skip
    const transitNet = aIf.network;
    const transitPrefix = aIf.prefix;
    map.get(a.name)!.push({
      neighbour: b.name,
      via: aIf.port,
      nextHopIp: bIf.ip,
      transitNetwork: transitNet,
      transitPrefix,
    });
    map.get(b.name)!.push({
      neighbour: a.name,
      via: bIf.port,
      nextHopIp: aIf.ip,
      transitNetwork: transitNet,
      transitPrefix,
    });
  }
  return map;
}

interface RouterLan {
  readonly device: string;
  readonly network: string;
  readonly prefix: number;
}

function lanInterfaces(snap: CanvasSnapshot, ifaces: RouterPort[], transitNetworks: Set<string>): RouterLan[] {
  // A LAN interface is any router port whose subnet is NOT a transit /30 with another router.
  return ifaces
    .filter(i => !transitNetworks.has(`${i.network}/${i.prefix}`))
    .map(i => ({ device: i.device, network: i.network, prefix: i.prefix }));
}

export interface StaticRoutingReport {
  readonly actions: readonly StaticRouteAction[];
}

export async function applyStaticRouting(bridge: Bridge): Promise<StaticRoutingReport> {
  const snap = await captureSnapshot(bridge);
  const ifaces = routerInterfaces(snap);
  const adj = buildAdjacency(snap, ifaces);
  const transitNetworks = new Set<string>();
  for (const adjList of adj.values()) {
    for (const a of adjList) transitNetworks.add(`${a.transitNetwork}/${a.transitPrefix}`);
  }
  const lans = lanInterfaces(snap, ifaces, transitNetworks);

  const actions: StaticRouteAction[] = [];
  const routerNames = [...adj.keys()].filter(n => snap.devices.find(d => d.name === n)?.className === "Router");

  for (const src of routerNames) {
    // BFS from src to discover first-hop neighbour for every other router.
    const firstHop = new Map<string, { neighbour: string; nextHopIp: string }>();
    const queue: string[] = [src];
    const seen = new Set<string>([src]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const a of adj.get(cur) ?? []) {
        if (seen.has(a.neighbour)) continue;
        seen.add(a.neighbour);
        if (cur === src) {
          firstHop.set(a.neighbour, { neighbour: a.neighbour, nextHopIp: a.nextHopIp });
        } else {
          firstHop.set(a.neighbour, firstHop.get(cur)!);
        }
        queue.push(a.neighbour);
      }
    }

    // For every reachable foreign router, install a route to each of its LANs.
    const cli: string[] = [];
    for (const [other, hop] of firstHop) {
      for (const lan of lans) {
        if (lan.device !== other) continue;
        const mask = prefixToMask(lan.prefix);
        cli.push(`ip route ${lan.network} ${mask} ${hop.nextHopIp}`);
        actions.push({
          device: src,
          destination: lan.network,
          mask,
          nextHop: hop.nextHopIp,
        });
      }
      // Also install a route to the foreign router's transit /30 if we don't share it.
      for (const a of adj.get(other) ?? []) {
        if (a.neighbour === src) continue;
        const mask = prefixToMask(a.transitPrefix);
        cli.push(`ip route ${a.transitNetwork} ${mask} ${hop.nextHopIp}`);
        actions.push({
          device: src,
          destination: a.transitNetwork,
          mask,
          nextHop: hop.nextHopIp,
        });
      }
    }
    if (cli.length === 0) continue;
    await pushCli(bridge, src, cli.join("\n"));
  }

  return { actions };
}

async function pushCli(bridge: Bridge, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(
    bulkCliJs(device, wrapInConfig(body)),
    { timeoutMs: 60_000 },
  );
  if (reply === null) throw new Error(`static routing CLI on ${device} timed out`);
  if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
    throw new Error(`static routing CLI on ${device} rejected: ${reply}`);
  }
}

export function summarizeStaticRouting(r: StaticRoutingReport): string {
  if (r.actions.length === 0) return "No static routes were necessary.";
  const lines: string[] = [`Installed ${r.actions.length} static route(s).`, ""];
  const grouped = new Map<string, StaticRouteAction[]>();
  for (const a of r.actions) {
    const arr = grouped.get(a.device) ?? [];
    arr.push(a);
    grouped.set(a.device, arr);
  }
  for (const [dev, list] of grouped) {
    lines.push(`${dev}:`);
    for (const a of list) lines.push(`  ip route ${a.destination} ${a.mask} ${a.nextHop}`);
  }
  return lines.join("\n");
}
