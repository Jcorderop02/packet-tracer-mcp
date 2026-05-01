/**
 * Apply VoIP intents to the live canvas. Groups all router-side CLI per device
 * (telephony-service + every ephone-dn + every ephone) into a single bulk push,
 * then applies switch voice-vlan blocks per switch. Order matters: CME and
 * ephone-dns must exist before ephones reference them.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { bulkCliJs } from "../../ipc/generator.js";
import {
  cmeSummary,
  ephoneDnSummary,
  ephoneSummary,
  routerVoipBody,
  switchVoipBody,
  validateCme,
  validateEphone,
  validateEphoneDn,
  validateVoiceVlan,
  voiceVlanSummary,
  wrapInConfig,
} from "./cli.js";
import type {
  EphoneDnIntent,
  EphoneIntent,
  VoipCmeIntent,
  VoipIntent,
} from "./intents.js";

export interface VoipAction {
  readonly device: string;
  readonly kind: "cme" | "ephone-dn" | "ephone" | "voice-vlan";
  readonly detail: string;
}

export interface VoipReport {
  readonly actions: readonly VoipAction[];
}

async function pushBulk(bridge: Bridge, label: string, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(bulkCliJs(device, wrapInConfig(body)), { timeoutMs: 60_000 });
  if (reply === null) throw new Error(`${label} on ${device} timed out`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`${label} on ${device} rejected: ${reply}`);
  }
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const list = m.get(key(it)) ?? [];
    list.push(it);
    m.set(key(it), list);
  }
  return m;
}

export async function applyVoip(bridge: Bridge, v: VoipIntent): Promise<VoipReport> {
  const cmeList = v.cme ?? [];
  const dnList = v.ephoneDns ?? [];
  const phoneList = v.ephones ?? [];
  const vlanList = v.voiceVlans ?? [];

  for (const c of cmeList) validateCme(c);
  for (const d of dnList) validateEphoneDn(d);
  for (const e of phoneList) validateEphone(e);
  for (const v2 of vlanList) validateVoiceVlan(v2);

  const referencedDnTags = new Set<number>(dnList.map(d => d.dnTag));
  for (const e of phoneList) {
    for (const b of e.buttons) {
      const dnTag = typeof b === "number" ? b : b.dnTag;
      if (!referencedDnTags.has(dnTag)) {
        throw new Error(`ephone ${e.ephoneNumber} button references missing ephone-dn ${dnTag}`);
      }
    }
  }

  const actions: VoipAction[] = [];

  const routerDevices = new Set<string>([
    ...cmeList.map(c => c.device),
    ...dnList.map(d => d.device),
    ...phoneList.map(p => p.device),
  ]);

  for (const device of routerDevices) {
    const cmes: VoipCmeIntent[] = cmeList.filter(c => c.device === device);
    const dns: EphoneDnIntent[] = [...dnList.filter(d => d.device === device)].sort((a, b) => a.dnTag - b.dnTag);
    const phones: EphoneIntent[] = [...phoneList.filter(p => p.device === device)].sort((a, b) => a.ephoneNumber - b.ephoneNumber);
    const body = routerVoipBody(cmes, dns, phones);
    if (!body) continue;
    await pushBulk(bridge, "VoIP CME", device, body);
    for (const c of cmes) actions.push({ device, kind: "cme", detail: cmeSummary(c) });
    for (const d of dns) actions.push({ device, kind: "ephone-dn", detail: ephoneDnSummary(d) });
    for (const p of phones) actions.push({ device, kind: "ephone", detail: ephoneSummary(p) });
  }

  for (const [sw, list] of groupBy(vlanList, x => x.switch)) {
    const body = switchVoipBody(list);
    await pushBulk(bridge, "voice VLAN", sw, body);
    for (const v2 of list) actions.push({ device: sw, kind: "voice-vlan", detail: voiceVlanSummary(v2) });
  }

  return { actions };
}

export function summarizeVoip(r: VoipReport): string {
  if (r.actions.length === 0) return "No VoIP actions applied.";
  const counts = new Map<string, number>();
  for (const a of r.actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
  return `Applied VoIP actions: ${parts}.`;
}
