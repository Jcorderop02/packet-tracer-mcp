/**
 * Pure CLI builders for the L2 switching intents. Every function in here
 * returns a multi-line `\n`-separated string ready to be fed into
 * `bulkCliJs(device, …)`. They never touch the bridge — that lets the unit
 * tests assert exact CLI output without spinning up Packet Tracer.
 */

import type {
  EtherChannelIntent,
  PortSecurityIntent,
  TrunkIntent,
  VlanIntent,
} from "./intents.js";

export function vlanCreateCli(v: VlanIntent): string {
  const lines = [`vlan ${v.id}`];
  if (v.name) lines.push(` name ${sanitiseName(v.name)}`);
  lines.push(" exit");
  return lines.join("\n");
}

export function accessPortCli(port: string, vlanId: number): string {
  return [
    `interface ${port}`,
    " switchport mode access",
    ` switchport access vlan ${vlanId}`,
    " no shutdown",
    " exit",
  ].join("\n");
}

export function trunkPortCli(t: TrunkIntent): string {
  const lines = [`interface ${t.port}`];
  const supportsEncapsulation = supportsExplicitTrunkEncapsulation(t.switchModel);
  if (t.encapsulation === "dot1q" && supportsEncapsulation !== false) {
    lines.push(" switchport trunk encapsulation dot1q");
  } else if (t.encapsulation === "isl" && supportsEncapsulation !== false) {
    lines.push(" switchport trunk encapsulation isl");
  }
  lines.push(" switchport mode trunk");
  if (t.allowed && t.allowed.length > 0) {
    lines.push(` switchport trunk allowed vlan ${[...t.allowed].sort((a, b) => a - b).join(",")}`);
  }
  if (t.native !== undefined) lines.push(` switchport trunk native vlan ${t.native}`);
  lines.push(" no shutdown", " exit");
  return lines.join("\n");
}

export function portSecurityCli(p: PortSecurityIntent): string {
  const lines = [`interface ${p.port}`, " switchport mode access", " switchport port-security"];
  if (p.maxMac !== undefined) lines.push(` switchport port-security maximum ${p.maxMac}`);
  if (p.sticky) lines.push(" switchport port-security mac-address sticky");
  if (p.violation) lines.push(` switchport port-security violation ${p.violation}`);
  lines.push(" exit");
  return lines.join("\n");
}

export function etherChannelCli(e: EtherChannelIntent): string {
  if (e.ports.length < 2) {
    throw new Error("EtherChannel needs at least 2 member ports");
  }
  if (supportsEtherChannel(e.switchModel) === false) {
    throw new Error(
      `EtherChannel not supported on '${e.switchModel}' in PT 9 (IOS XE parser stub drops 'channel-group'). ` +
        `Verified 2026-05-01 via scripts/probe-multilayer-cli-coverage.ts. ` +
        `Use a different multilayer (3560-24PS / 3650-24PS / IE-3400) or skip this intent.`,
    );
  }
  const mode = e.mode ?? "on";
  const memberRange = e.ports.join(",");
  return [
    `interface range ${memberRange}`,
    ` channel-group ${e.group} mode ${mode}`,
    " no shutdown",
    " exit",
  ].join("\n");
}

export { wrapInConfig } from "../../ipc/cli-prologue.js";

function sanitiseName(name: string): string {
  // VLAN names are space-sensitive; collapse internal whitespace to underscores.
  return name.trim().replace(/\s+/g, "_");
}

function supportsExplicitTrunkEncapsulation(model: string | undefined): boolean | undefined {
  if (!model) return undefined;
  const m = model.trim().toUpperCase();
  // Reject: legacy 2940/2950/2960 (parser never had the verb) and IOS XE
  // chassis (3650/IE-3400/IE-9320 — verified 2026-05-01 via
  // probe-encapsulation-parser; PT's IOS XE parser drops the keyword).
  if (
    ["2940", "2950", "2960", "3650"].some(prefix => m.startsWith(prefix)) ||
    m.includes("IE-3400") ||
    m.includes("IE-9320")
  ) return false;
  // Accept: IOS 12.x multilayer that exposes both ISL and dot1q.
  if (["2970", "3560", "3750"].some(prefix => m.startsWith(prefix))) return true;
  return undefined;
}

/**
 * Returns false when the platform is known to drop `channel-group` in PT 9.
 * Currently only IE-9320 (IOS XE 17.x industrial multilayer) — its parser
 * stub responds `% Invalid input detected at '^' marker.` for every mode
 * (active/passive/on/auto/desirable). 3560-24PS / 3650-24PS / IE-3400 do
 * accept the verb. Verified 2026-05-01 via
 * scripts/probe-multilayer-cli-coverage.ts; see VERIFIED.md §10.5.
 *
 * Returns undefined when the model is unknown — callers proceed and let
 * PT confirm via running-config (i.e. "trust by default").
 */
function supportsEtherChannel(model: string | undefined): boolean | undefined {
  if (!model) return undefined;
  const m = model.trim().toUpperCase();
  if (m.includes("IE-9320")) return false;
  return undefined;
}
