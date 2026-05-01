/**
 * BGP recipe. Emits `router bgp <asn>` with neighbors, networks and
 * redistribution per router intent, applies via bulk CLI and persists.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { parseCidr, prefixToMask } from "../../canvas/subnetting.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs, saveRunningConfigJs } from "../../ipc/generator.js";

export interface BgpNeighbor {
  readonly ip: string;
  readonly remoteAs: number;
  readonly description?: string;
}

export type BgpRedistributeSource = "ospf" | "eigrp" | "rip" | "connected" | "static";

export interface BgpIntent {
  readonly device: string;
  readonly asn: number;
  readonly routerId?: string;
  readonly neighbors: readonly BgpNeighbor[];
  readonly networks?: readonly string[];
  readonly redistribute?: readonly BgpRedistributeSource[];
}

export interface BgpReport {
  readonly devices: ReadonlyMap<string, BgpIntent>;
}

export function bgpCli(intent: BgpIntent): string {
  if (!Number.isInteger(intent.asn) || intent.asn < 1 || intent.asn > 65535) {
    throw new Error(`invalid BGP ASN: ${intent.asn} (must be 1..65535)`);
  }
  const lines: string[] = [`router bgp ${intent.asn}`];
  if (intent.routerId) lines.push(` bgp router-id ${intent.routerId}`);
  for (const n of intent.neighbors) {
    lines.push(` neighbor ${n.ip} remote-as ${n.remoteAs}`);
    if (n.description) lines.push(` neighbor ${n.ip} description ${n.description}`);
  }
  for (const cidr of intent.networks ?? []) {
    const net = parseCidr(cidr);
    lines.push(` network ${net.network} mask ${prefixToMask(net.prefix)}`);
  }
  for (const src of intent.redistribute ?? []) {
    lines.push(` redistribute ${src}`);
  }
  lines.push("exit");
  return lines.join("\n");
}

export async function applyBgp(
  bridge: Bridge,
  intents: readonly BgpIntent[],
): Promise<BgpReport> {
  const grouped = new Map<string, BgpIntent[]>();
  for (const i of intents) {
    const list = grouped.get(i.device) ?? [];
    list.push(i);
    grouped.set(i.device, list);
  }

  const devices = new Map<string, BgpIntent>();
  for (const [device, list] of grouped) {
    const body = list.map(bgpCli).join("\n");
    const reply = await bridge.sendAndWait(
      bulkCliJs(device, wrapInConfig(body)),
      { timeoutMs: 60_000 },
    );
    if (reply === null) throw new Error(`BGP CLI on ${device} timed out`);
    if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
      throw new Error(`BGP CLI on ${device} rejected: ${reply}`);
    }

    const save = await bridge.sendAndWait(saveRunningConfigJs(device), { timeoutMs: 15_000 });
    if (save === null) throw new Error(`write memory on ${device} timed out`);
    if (save.startsWith("ERR:")) throw new Error(`write memory on ${device} rejected: ${save}`);

    devices.set(device, list[0]!);
  }
  return { devices };
}

export function summarizeBgp(r: BgpReport): string {
  if (r.devices.size === 0) return "No BGP intents applied.";
  const lines: string[] = [`Configured BGP on ${r.devices.size} router(s).`];
  for (const [name, i] of r.devices) {
    const nets = i.networks?.length ?? 0;
    const red = i.redistribute?.length ?? 0;
    lines.push(`${name}: asn=${i.asn} neighbors=${i.neighbors.length} networks=${nets} redistribute=${red}`);
  }
  return lines.join("\n");
}
