/**
 * OSPF recipe. Walks the live canvas, extracts each router's interface
 * subnets (LAN + transit) and emits one `network <net> <wildcard> area 0`
 * line per subnet under `router ospf <pid>`.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { captureSnapshot } from "../../canvas/snapshot.js";
import { ipToInt, parseCidr, prefixToWildcard } from "../../canvas/subnetting.js";
import type { CanvasSnapshot } from "../../canvas/types.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs } from "../../ipc/generator.js";

function maskBits(mask: string): number {
  const n = ipToInt(mask);
  let count = 0;
  for (let i = 31; i >= 0; i--) if (((n >>> i) & 1) === 1) count++;
  return count;
}

export interface OspfReport {
  readonly pid: number;
  readonly networks: ReadonlyMap<string, readonly { network: string; wildcard: string }[]>;
}

export async function applyOspf(bridge: Bridge, pid = 1, area = 0): Promise<OspfReport> {
  const snap = await captureSnapshot(bridge);
  const networks = new Map<string, { network: string; wildcard: string }[]>();

  for (const d of snap.devices) {
    if (d.className !== "Router") continue;
    const list: { network: string; wildcard: string }[] = [];
    const seen = new Set<string>();
    for (const p of d.ports) {
      if (!p.ip || !p.mask) continue;
      try {
        const prefix = maskBits(p.mask);
        const net = parseCidr(`${p.ip}/${prefix}`);
        const key = `${net.network}/${prefix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ network: net.network, wildcard: prefixToWildcard(prefix) });
      } catch {
        /* skip malformed */
      }
    }
    if (list.length === 0) continue;

    const cli: string[] = [`router ospf ${pid}`];
    for (const n of list) cli.push(`network ${n.network} ${n.wildcard} area ${area}`);
    cli.push("exit");
    await pushCli(bridge, d.name, cli.join("\n"));
    networks.set(d.name, list);
  }

  return { pid, networks };
}

async function pushCli(bridge: Bridge, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(
    bulkCliJs(device, wrapInConfig(body)),
    { timeoutMs: 60_000 },
  );
  if (reply === null) throw new Error(`OSPF CLI on ${device} timed out`);
  if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
    throw new Error(`OSPF CLI on ${device} rejected: ${reply}`);
  }
}

export function summarizeOspf(r: OspfReport): string {
  if (r.networks.size === 0) return "No OSPF networks announced (no addressed router ports).";
  const lines: string[] = [`Configured router ospf ${r.pid} on ${r.networks.size} router(s).`, ""];
  for (const [dev, nets] of r.networks) {
    lines.push(`${dev}:`);
    for (const n of nets) lines.push(`  network ${n.network} ${n.wildcard} area 0`);
  }
  return lines.join("\n");
}
