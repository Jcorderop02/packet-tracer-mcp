/**
 * Pure CLI builders for VoIP intents. Each function returns a `\n`-separated
 * body fragment; the applier wraps the whole device's body via
 * `wrapInConfig` (see src/ipc/cli-prologue.ts).
 */

import type {
  EphoneDnIntent,
  EphoneIntent,
  VoiceVlanIntent,
  VoipCmeIntent,
} from "./intents.js";

const MAC_RE = /^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/;

function isIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function validateCme(c: VoipCmeIntent): void {
  if (!Number.isInteger(c.maxEphones) || c.maxEphones < 1 || c.maxEphones > 240) {
    throw new Error(`maxEphones must be in 1..240 (got ${c.maxEphones})`);
  }
  if (!Number.isInteger(c.maxDn) || c.maxDn < 1 || c.maxDn > 720) {
    throw new Error(`maxDn must be in 1..720 (got ${c.maxDn})`);
  }
  if (!isIpv4(c.sourceIp)) throw new Error(`sourceIp '${c.sourceIp}' is not a valid IPv4 address`);
  if (c.sourcePort !== undefined && (!Number.isInteger(c.sourcePort) || c.sourcePort < 1 || c.sourcePort > 65535)) {
    throw new Error(`sourcePort must be in 1..65535 (got ${c.sourcePort})`);
  }
  if (c.autoAssign) {
    const { first, last } = c.autoAssign;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) {
      throw new Error(`autoAssign requires 1 <= first <= last (got ${first}..${last})`);
    }
    if (last > c.maxDn) throw new Error(`autoAssign.last ${last} exceeds maxDn ${c.maxDn}`);
  }
}

export function validateEphoneDn(d: EphoneDnIntent): void {
  if (!Number.isInteger(d.dnTag) || d.dnTag < 1) throw new Error(`ephone-dn tag must be >= 1 (got ${d.dnTag})`);
  if (!d.number.trim()) throw new Error("ephone-dn number cannot be empty");
  if (!/^\d+$/.test(d.number)) throw new Error(`ephone-dn number '${d.number}' must be all digits`);
}

export function validateEphone(e: EphoneIntent): void {
  if (!Number.isInteger(e.ephoneNumber) || e.ephoneNumber < 1) {
    throw new Error(`ephone number must be >= 1 (got ${e.ephoneNumber})`);
  }
  if (!MAC_RE.test(e.mac)) {
    throw new Error(`ephone mac '${e.mac}' must be Cisco-dotted form (e.g. 0001.4321.ABCD)`);
  }
  if (e.buttons.length === 0) throw new Error(`ephone ${e.ephoneNumber} needs at least one button mapping`);
  for (const b of e.buttons) {
    if (typeof b === "number") {
      if (!Number.isInteger(b) || b < 1) throw new Error(`button must be >= 1 (got ${b})`);
    } else {
      if (!Number.isInteger(b.button) || b.button < 1) throw new Error(`button must be >= 1 (got ${b.button})`);
      if (!Number.isInteger(b.dnTag) || b.dnTag < 1) throw new Error(`button dnTag must be >= 1 (got ${b.dnTag})`);
    }
  }
}

export function validateVoiceVlan(v: VoiceVlanIntent): void {
  if (!Number.isInteger(v.voiceVlanId) || v.voiceVlanId < 1 || v.voiceVlanId > 4094) {
    throw new Error(`voiceVlanId must be in 1..4094 (got ${v.voiceVlanId})`);
  }
  if (v.dataVlanId !== undefined && (!Number.isInteger(v.dataVlanId) || v.dataVlanId < 1 || v.dataVlanId > 4094)) {
    throw new Error(`dataVlanId must be in 1..4094 (got ${v.dataVlanId})`);
  }
  if (!v.port.trim()) throw new Error("voice VLAN port cannot be empty");
}

export function cmeCli(c: VoipCmeIntent): string {
  validateCme(c);
  const lines: string[] = ["telephony-service"];
  lines.push(` max-ephones ${c.maxEphones}`);
  lines.push(` max-dn ${c.maxDn}`);
  lines.push(` ip source-address ${c.sourceIp} port ${c.sourcePort ?? 2000}`);
  if (c.autoAssign) {
    lines.push(` auto assign ${c.autoAssign.first} to ${c.autoAssign.last}`);
  }
  if (c.systemMessage) {
    lines.push(` system message ${c.systemMessage}`);
  }
  lines.push(" exit");
  return lines.join("\n");
}

export function ephoneDnCli(d: EphoneDnIntent): string {
  validateEphoneDn(d);
  const lines = [`ephone-dn ${d.dnTag}`, ` number ${d.number}`];
  if (d.name) lines.push(` name ${d.name}`);
  lines.push(" exit");
  return lines.join("\n");
}

function buttonClause(buttons: EphoneIntent["buttons"]): string {
  return buttons
    .map(b => (typeof b === "number" ? `${b}:${b}` : `${b.button}:${b.dnTag}`))
    .join(" ");
}

export function ephoneCli(e: EphoneIntent): string {
  validateEphone(e);
  const lines = [
    `ephone ${e.ephoneNumber}`,
    ` mac-address ${e.mac}`,
    ` type ${e.type ?? "7960"}`,
    ` button ${buttonClause(e.buttons)}`,
    " exit",
  ];
  return lines.join("\n");
}

export function voiceVlanCli(v: VoiceVlanIntent): string {
  validateVoiceVlan(v);
  const lines = [`interface ${v.port}`, " switchport mode access"];
  if (v.dataVlanId !== undefined) lines.push(` switchport access vlan ${v.dataVlanId}`);
  lines.push(` switchport voice vlan ${v.voiceVlanId}`);
  if (v.trustCiscoPhone !== false) lines.push(" mls qos trust device cisco-phone");
  lines.push(" spanning-tree portfast");
  lines.push(" exit");
  return lines.join("\n");
}

/** Builds the body for a router that owns one or more CME-related intents. */
export function routerVoipBody(
  cme: readonly VoipCmeIntent[],
  ephoneDns: readonly EphoneDnIntent[],
  ephones: readonly EphoneIntent[],
): string {
  const lines: string[] = [];
  for (const c of cme) lines.push(cmeCli(c));
  for (const d of ephoneDns) lines.push(ephoneDnCli(d));
  for (const e of ephones) lines.push(ephoneCli(e));
  return lines.join("\n");
}

export function switchVoipBody(vlans: readonly VoiceVlanIntent[]): string {
  return vlans.map(voiceVlanCli).join("\n");
}

export { wrapInConfig } from "../../ipc/cli-prologue.js";

export function cmeSummary(c: VoipCmeIntent): string {
  return `cme(maxEphones=${c.maxEphones} maxDn=${c.maxDn} src=${c.sourceIp}:${c.sourcePort ?? 2000})`;
}

export function ephoneSummary(e: EphoneIntent): string {
  return `ephone(${e.ephoneNumber} mac=${e.mac} type=${e.type ?? "7960"} buttons=${e.buttons.length})`;
}

export function ephoneDnSummary(d: EphoneDnIntent): string {
  return `dn(${d.dnTag} ext=${d.number}${d.name ? ` name=${d.name}` : ""})`;
}

export function voiceVlanSummary(v: VoiceVlanIntent): string {
  return `voice-vlan(${v.switch}/${v.port} voice=${v.voiceVlanId}${v.dataVlanId !== undefined ? ` data=${v.dataVlanId}` : ""})`;
}
