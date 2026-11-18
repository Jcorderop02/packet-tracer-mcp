import { z } from "zod";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { makeGuard } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export function parseDiscovery(output: string) {
  const lines = output.split(/\r?\n/);
  const header = lines.findIndex(line => /Device ID.*Local Int.*Hold/i.test(line));
  if (header < 0) return [];
  return lines.slice(header + 1).flatMap(line => {
    const row = /^\s*(\S+)\s+(\S+(?:\s+\d+(?:\/\d+)*)?)\s+(\d+)\s+(.*?)\s{2,}(\S+(?:\s+\d+(?:\/\d+)*)?)\s*$/.exec(line);
    if (!row) return [];
    const [, neighbor, localPort, holdSeconds, details, remotePort] = row;
    return [{ neighbor, localPort, remotePort, holdSeconds: Number(holdSeconds), details }];
  });
}

export const registerReadDiscoveryTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_read_discovery", "Read CDP or LLDP neighbors on a simulated Cisco router or switch.", {
    device: z.string().min(1),
    protocol: z.enum(["cdp", "lldp"]).default("cdp"),
  }, ({ device, protocol }) => guard(async () => {
    const replies = await runCliBlock(bridge, device, ["enable", `show ${protocol} neighbors`]);
    const reply = replies.at(-1)!;
    if (reply.timedOut || reply.errors.length) throw new Error(reply.errors.join("\n") || "Neighbor lookup timed out.");
    const neighbors = parseDiscovery(reply.output);
    return JSON.stringify({ device, protocol, enabled: neighbors.length > 0 ? true : /not (?:enabled|running)/i.test(reply.output) ? false : null,
      neighbors, output: reply.output });
  }));
};
