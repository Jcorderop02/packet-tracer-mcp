/**
 * Apply IPv6 intents to the live canvas. The applier groups all
 * router-side IPv6 intents per device into a single bulk push so the
 * `ipv6 unicast-routing` switch, OSPFv3 process, interface addresses and
 * static routes land in one CLI burst — order matters because IOS rejects
 * `ipv6 ospf <pid> area 0` on an interface unless the OSPF process exists
 * and `ipv6 unicast-routing` is on.
 *
 * Endpoint hosts (PC-PT/Laptop-PT/Server-PT) are configured via their
 * Command Prompt's `ipv6config` helper.
 */

import type { Bridge } from "../../bridge/http-bridge.js";
import { bulkCliJs, enterCommandJs } from "../../ipc/generator.js";
import {
  ipv6InterfaceSummary,
  ipv6OspfSummary,
  ipv6StaticSummary,
  routerIpv6Body,
  validateIpv6Interface,
  validateIpv6Ospf,
  validateIpv6Static,
  wrapInConfig,
} from "./cli.js";
import type {
  Ipv6EndpointIntent,
  Ipv6Intent,
  Ipv6InterfaceIntent,
  Ipv6OspfIntent,
  Ipv6StaticRouteIntent,
} from "./intents.js";

export interface Ipv6Action {
  readonly device: string;
  readonly kind: "router-cli" | "endpoint-static";
  readonly detail: string;
}

export interface Ipv6Report {
  readonly actions: readonly Ipv6Action[];
}

const IPV6_CIDR_RE = /^([0-9A-Fa-f:]+)\/(\d{1,3})$/;

function isPlausibleIpv6(addr: string): boolean {
  if (!/^[0-9A-Fa-f:]+$/.test(addr)) return false;
  if (!addr.includes(":")) return false;
  const abbrev = addr.match(/::/g);
  if (abbrev && abbrev.length > 1) return false;
  return addr.length > 0;
}

function validateEndpoint(e: Ipv6EndpointIntent): void {
  if (!e.device.trim()) throw new Error("ipv6 endpoint device cannot be empty");
  const m = IPV6_CIDR_RE.exec(e.address);
  if (!m) throw new Error(`ipv6 endpoint '${e.device}' address must be in CIDR form (got '${e.address}')`);
  const prefix = Number(m[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`ipv6 endpoint '${e.device}' has invalid prefix in '${e.address}'`);
  }
  if (!isPlausibleIpv6(m[1]!)) {
    throw new Error(`ipv6 endpoint '${e.device}' has invalid address in '${e.address}'`);
  }
  if (!isPlausibleIpv6(e.gateway)) {
    throw new Error(`ipv6 endpoint '${e.device}' gateway '${e.gateway}' is not a valid IPv6 address`);
  }
}

async function pushBulk(bridge: Bridge, label: string, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(bulkCliJs(device, wrapInConfig(body)), { timeoutMs: 60_000 });
  if (reply === null) throw new Error(`${label} on ${device} timed out`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`${label} on ${device} rejected: ${reply}`);
  }
}

async function pushPcCli(bridge: Bridge, device: string, command: string): Promise<void> {
  const reply = await bridge.sendAndWait(enterCommandJs(device, command), { timeoutMs: 15_000 });
  if (reply === null) throw new Error(`endpoint ${device} timed out on '${command}'`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`endpoint ${device} rejected '${command}': ${reply}`);
  }
}

export async function applyIpv6(bridge: Bridge, v: Ipv6Intent): Promise<Ipv6Report> {
  const interfaces = v.interfaces ?? [];
  const ospf = v.ospf ?? [];
  const staticRoutes = v.staticRoutes ?? [];
  const endpoints = v.endpoints ?? [];

  for (const i of interfaces) validateIpv6Interface(i);
  for (const o of ospf) validateIpv6Ospf(o);
  for (const s of staticRoutes) validateIpv6Static(s);
  for (const e of endpoints) validateEndpoint(e);

  const referencedOspf = new Set<string>(ospf.map(o => `${o.device}#${o.pid}`));
  for (const i of interfaces) {
    if (i.ospfPid !== undefined && !referencedOspf.has(`${i.device}#${i.ospfPid}`)) {
      throw new Error(
        `ipv6 interface ${i.device}/${i.port} binds to OSPFv3 pid ${i.ospfPid} but no ospf intent declares it on ${i.device}`,
      );
    }
  }

  const actions: Ipv6Action[] = [];
  const enableUnicast = v.unicastRouting !== false;

  const routerDevices = new Set<string>([
    ...interfaces.map(i => i.device),
    ...ospf.map(o => o.device),
    ...staticRoutes.map(s => s.device),
  ]);

  for (const device of routerDevices) {
    const ifs: Ipv6InterfaceIntent[] = interfaces.filter(i => i.device === device);
    const procs: Ipv6OspfIntent[] = ospf.filter(o => o.device === device);
    const routes: Ipv6StaticRouteIntent[] = staticRoutes.filter(s => s.device === device);
    const body = routerIpv6Body({
      enableUnicastRouting: enableUnicast,
      ospf: procs,
      interfaces: ifs,
      staticRoutes: routes,
    });
    if (!body) continue;
    await pushBulk(bridge, "IPv6", device, body);
    if (enableUnicast) {
      actions.push({ device, kind: "router-cli", detail: "ipv6 unicast-routing" });
    }
    for (const o of procs) actions.push({ device, kind: "router-cli", detail: ipv6OspfSummary(o) });
    for (const i of ifs) actions.push({ device, kind: "router-cli", detail: ipv6InterfaceSummary(i) });
    for (const s of routes) actions.push({ device, kind: "router-cli", detail: ipv6StaticSummary(s) });
  }

  for (const e of endpoints) {
    // PT 9 PCs accept `ipv6config <addr>/<prefix> <gw>` to set the
    // global unicast address and the default gateway in one call.
    await pushPcCli(bridge, e.device, `ipv6config ${e.address} ${e.gateway}`);
    actions.push({
      device: e.device,
      kind: "endpoint-static",
      detail: `${e.address} gw ${e.gateway}`,
    });
  }

  return { actions };
}

export function summarizeIpv6(r: Ipv6Report): string {
  if (r.actions.length === 0) return "No IPv6 actions applied.";
  const counts = new Map<string, number>();
  for (const a of r.actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(", ");
  return `Applied IPv6 actions: ${parts}.`;
}
