/**
 * RIPv2 recipe. `router rip / version 2 / no auto-summary / network <c>` per
 * router subnet (classful form). Defaults to v2 because v1 is rarely useful
 * outside a homework setting and CIDR tends to break v1 anyway.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { captureSnapshot } from "../../canvas/snapshot.js";
import { parseCidr, ipToInt } from "../../canvas/subnetting.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs } from "../../ipc/generator.js";

function maskBits(mask: string): number {
  const n = ipToInt(mask);
  let count = 0;
  for (let i = 31; i >= 0; i--) if (((n >>> i) & 1) === 1) count++;
  return count;
}

export interface RipReport {
  readonly version: 1 | 2;
  readonly networks: ReadonlyMap<string, readonly string[]>;
}

export async function applyRip(bridge: Bridge, version: 1 | 2 = 2): Promise<RipReport> {
  const snap = await captureSnapshot(bridge);
  const networks = new Map<string, string[]>();

  for (const d of snap.devices) {
    if (d.className !== "Router") continue;
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of d.ports) {
      if (!p.ip || !p.mask) continue;
      try {
        const prefix = maskBits(p.mask);
        const net = parseCidr(`${p.ip}/${prefix}`);
        if (seen.has(net.network)) continue;
        seen.add(net.network);
        list.push(net.network);
      } catch { /* skip */ }
    }
    if (list.length === 0) continue;

    const cli: string[] = ["router rip", `version ${version}`, "no auto-summary"];
    for (const n of list) cli.push(`network ${n}`);
    cli.push("exit");
    await pushCli(bridge, d.name, cli.join("\n"));
    networks.set(d.name, list);
  }

  return { version, networks };
}

async function pushCli(bridge: Bridge, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(
    bulkCliJs(device, wrapInConfig(body)),
    { timeoutMs: 60_000 },
  );
  if (reply === null) throw new Error(`RIP CLI on ${device} timed out`);
  if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
    throw new Error(`RIP CLI on ${device} rejected: ${reply}`);
  }
}

export function summarizeRip(r: RipReport): string {
  if (r.networks.size === 0) return "No RIP networks announced (no addressed router ports).";
  const lines: string[] = [`Configured router rip v${r.version} on ${r.networks.size} router(s).`, ""];
  for (const [dev, nets] of r.networks) {
    lines.push(`${dev}:`);
    for (const n of nets) lines.push(`  network ${n}`);
  }
  return lines.join("\n");
}
