/**
 * Apply L3 service intents (ACLs, NAT, DHCP server/relay, NTP, Syslog) to
 * the live canvas. Each helper:
 *   - groups its CLI per device,
 *   - wraps the body in enable + configure terminal + end,
 *   - dispatches via the bridge,
 *   - returns per-device actions to the caller.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { bulkCliJs } from "../../ipc/generator.js";
import {
  aclCli,
  dhcpPoolCli,
  dhcpRelayCli,
  natCli,
  ntpCli,
  syslogCli,
  wrapInConfig,
} from "./cli.js";
import type {
  AclIntent,
  DhcpPoolIntent,
  DhcpRelayIntent,
  NatIntent,
  NtpIntent,
  ServicesIntent,
  SyslogIntent,
} from "./intents.js";

export interface ServiceAction {
  readonly device: string;
  readonly kind: "acl" | "nat" | "dhcp-pool" | "dhcp-relay" | "ntp" | "syslog";
  readonly cli: string;
}

export interface ServicesReport {
  readonly actions: readonly ServiceAction[];
  readonly skipped: readonly { readonly target: string; readonly reason: string }[];
}

async function pushBulk(bridge: Bridge, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(bulkCliJs(device, wrapInConfig(body)), { timeoutMs: 60_000 });
  if (reply === null) throw new Error(`services CLI on ${device} timed out`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`services CLI on ${device} rejected: ${reply}`);
  }
}

function groupByDevice<T extends { device: string }>(items: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const list = m.get(it.device) ?? [];
    list.push(it);
    m.set(it.device, list);
  }
  return m;
}

export async function applyAcls(bridge: Bridge, acls: readonly AclIntent[]): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(acls)) {
    const body = list.map(aclCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "acl", cli: body });
  }
  return out;
}

export async function applyNat(bridge: Bridge, nat: readonly NatIntent[]): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(nat)) {
    const body = list.map(natCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "nat", cli: body });
  }
  return out;
}

export async function applyDhcpPools(
  bridge: Bridge,
  pools: readonly DhcpPoolIntent[],
): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(pools)) {
    const body = list.map(dhcpPoolCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "dhcp-pool", cli: body });
  }
  return out;
}

export async function applyDhcpRelays(
  bridge: Bridge,
  relays: readonly DhcpRelayIntent[],
): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(relays)) {
    const body = list.map(dhcpRelayCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "dhcp-relay", cli: body });
  }
  return out;
}

export async function applyNtp(bridge: Bridge, ntp: readonly NtpIntent[]): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(ntp)) {
    const body = list.map(ntpCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "ntp", cli: body });
  }
  return out;
}

export async function applySyslog(bridge: Bridge, syslog: readonly SyslogIntent[]): Promise<ServiceAction[]> {
  const out: ServiceAction[] = [];
  for (const [dev, list] of groupByDevice(syslog)) {
    const body = list.map(syslogCli).join("\n");
    await pushBulk(bridge, dev, body);
    out.push({ device: dev, kind: "syslog", cli: body });
  }
  return out;
}

export async function applyServices(bridge: Bridge, s: ServicesIntent): Promise<ServicesReport> {
  const actions: ServiceAction[] = [];
  if (s.acls && s.acls.length > 0)              actions.push(...await applyAcls(bridge, s.acls));
  if (s.nat && s.nat.length > 0)                actions.push(...await applyNat(bridge, s.nat));
  if (s.dhcpPools && s.dhcpPools.length > 0)    actions.push(...await applyDhcpPools(bridge, s.dhcpPools));
  if (s.dhcpRelays && s.dhcpRelays.length > 0)  actions.push(...await applyDhcpRelays(bridge, s.dhcpRelays));
  if (s.ntp && s.ntp.length > 0)                actions.push(...await applyNtp(bridge, s.ntp));
  if (s.syslog && s.syslog.length > 0)          actions.push(...await applySyslog(bridge, s.syslog));
  return { actions, skipped: [] };
}

export function summarizeServices(r: ServicesReport): string {
  if (r.actions.length === 0) return "No service actions applied.";
  const counts = new Map<string, number>();
  for (const a of r.actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
  return `Applied service actions: ${parts}.`;
}
