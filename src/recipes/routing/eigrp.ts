import { runCliScript } from "../../ipc/reliable-cli.js";
/**
 * EIGRP recipe. One `network <classful>` line per router subnet, scoped to a
 * single autonomous system number. PT's IOS image accepts wildcards too but
 * the classful form is the most portable across the lab images.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { captureSnapshot } from "../../canvas/snapshot.js";
import { ipToInt, parseCidr } from "../../canvas/subnetting.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";

function maskBits(mask: string): number {
  const n = ipToInt(mask);
  let count = 0;
  for (let i = 31; i >= 0; i--) if (((n >>> i) & 1) === 1) count++;
  return count;
}

export interface EigrpReport {
  readonly asn: number;
  readonly networks: ReadonlyMap<string, readonly string[]>;
}

export async function applyEigrp(bridge: Bridge, asn = 1): Promise<EigrpReport> {
  if (asn < 1 || asn > 65535) throw new Error(`EIGRP ASN out of range: ${asn}`);
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

    const cli: string[] = [`router eigrp ${asn}`, "no auto-summary"];
    for (const n of list) cli.push(`network ${n}`);
    cli.push("exit");
    await pushCli(bridge, d.name, cli.join("\n"));
    networks.set(d.name, list);
  }

  return { asn, networks };
}

async function pushCli(bridge: Bridge, device: string, body: string): Promise<void> {
  await runCliScript(bridge, device, wrapInConfig(body));
}

export function summarizeEigrp(r: EigrpReport): string {
  if (r.networks.size === 0) return "No EIGRP networks announced (no addressed router ports).";
  const lines: string[] = [`Configured router eigrp ${r.asn} on ${r.networks.size} router(s).`, ""];
  for (const [dev, nets] of r.networks) {
    lines.push(`${dev}:`);
    for (const n of nets) lines.push(`  network ${n}`);
  }
  return lines.join("\n");
}
