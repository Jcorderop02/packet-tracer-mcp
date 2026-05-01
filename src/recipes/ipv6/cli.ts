/**
 * Pure CLI builders for IPv6 intents. Each function returns a `\n`-separated
 * body fragment; the applier wraps the whole device's body via
 * `wrapInConfig` (see src/ipc/cli-prologue.ts).
 */

import type {
  Ipv6InterfaceIntent,
  Ipv6OspfIntent,
  Ipv6StaticRouteIntent,
} from "./intents.js";

const IPV6_CIDR_RE = /^([0-9A-Fa-f:]+)\/(\d{1,3})$/;
const IPV6_RE = /^[0-9A-Fa-f:]+$/;
const IPV4_DOTTED_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isPlausibleIpv6(addr: string): boolean {
  if (!IPV6_RE.test(addr)) return false;
  // Must contain at least one colon and not start/end with a single colon.
  if (!addr.includes(":")) return false;
  // No more than one "::" abbreviation.
  const abbrev = addr.match(/::/g);
  if (abbrev && abbrev.length > 1) return false;
  // Reject all-zero or accidentally-empty strings.
  return addr.length > 0;
}

function parseIpv6Cidr(cidr: string): { address: string; prefix: number } {
  const m = IPV6_CIDR_RE.exec(cidr);
  if (!m) throw new Error(`invalid IPv6 CIDR: '${cidr}'`);
  const prefix = Number(m[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error(`invalid IPv6 prefix: '${cidr}'`);
  }
  if (!isPlausibleIpv6(m[1]!)) {
    throw new Error(`invalid IPv6 address in CIDR: '${cidr}'`);
  }
  return { address: m[1]!, prefix };
}

export function validateIpv6Interface(i: Ipv6InterfaceIntent): void {
  if (!i.device.trim()) throw new Error("ipv6 interface device cannot be empty");
  if (!i.port.trim()) throw new Error("ipv6 interface port cannot be empty");
  parseIpv6Cidr(i.address); // throws on bad CIDR
  if (i.ospfPid !== undefined && (!Number.isInteger(i.ospfPid) || i.ospfPid < 1 || i.ospfPid > 65535)) {
    throw new Error(`ipv6 ospf pid must be in 1..65535 (got ${i.ospfPid})`);
  }
  if (i.ospfArea !== undefined && (!Number.isInteger(i.ospfArea) || i.ospfArea < 0)) {
    throw new Error(`ipv6 ospf area must be >= 0 (got ${i.ospfArea})`);
  }
}

export function validateIpv6Ospf(o: Ipv6OspfIntent): void {
  if (!o.device.trim()) throw new Error("ipv6 ospf device cannot be empty");
  if (!Number.isInteger(o.pid) || o.pid < 1 || o.pid > 65535) {
    throw new Error(`ipv6 ospf pid must be in 1..65535 (got ${o.pid})`);
  }
  if (o.routerId !== undefined && !IPV4_DOTTED_RE.test(o.routerId)) {
    throw new Error(`ipv6 ospf router-id '${o.routerId}' must be dotted-quad`);
  }
}

export function validateIpv6Static(s: Ipv6StaticRouteIntent): void {
  if (!s.device.trim()) throw new Error("ipv6 static route device cannot be empty");
  parseIpv6Cidr(s.prefix); // throws on bad prefix
  if (!isPlausibleIpv6(s.nextHop)) {
    throw new Error(`ipv6 static route next-hop '${s.nextHop}' is not a valid IPv6 address`);
  }
  if (s.distance !== undefined && (!Number.isInteger(s.distance) || s.distance < 1 || s.distance > 255)) {
    throw new Error(`ipv6 route distance must be in 1..255 (got ${s.distance})`);
  }
}

export function ipv6InterfaceCli(i: Ipv6InterfaceIntent): string {
  validateIpv6Interface(i);
  const lines: string[] = [`interface ${i.port}`];
  if (i.enableLinkLocal !== false) lines.push(" ipv6 enable");
  lines.push(` ipv6 address ${i.address}`);
  if (i.ospfPid !== undefined) {
    lines.push(` ipv6 ospf ${i.ospfPid} area ${i.ospfArea ?? 0}`);
  }
  lines.push(" no shutdown", " exit");
  return lines.join("\n");
}

export function ipv6OspfCli(o: Ipv6OspfIntent): string {
  validateIpv6Ospf(o);
  const lines: string[] = [`ipv6 router ospf ${o.pid}`];
  if (o.routerId) lines.push(` router-id ${o.routerId}`);
  lines.push(" exit");
  return lines.join("\n");
}

export function ipv6StaticRouteCli(s: Ipv6StaticRouteIntent): string {
  validateIpv6Static(s);
  const tail = s.distance !== undefined ? ` ${s.distance}` : "";
  return `ipv6 route ${s.prefix} ${s.nextHop}${tail}`;
}

export function unicastRoutingCli(): string {
  return "ipv6 unicast-routing";
}

/** Composes the full router body for one device. Caller wraps via
 *  `wrapInConfig` (see src/ipc/cli-prologue.ts). */
export function routerIpv6Body(args: {
  readonly enableUnicastRouting: boolean;
  readonly ospf: readonly Ipv6OspfIntent[];
  readonly interfaces: readonly Ipv6InterfaceIntent[];
  readonly staticRoutes: readonly Ipv6StaticRouteIntent[];
}): string {
  const lines: string[] = [];
  if (args.enableUnicastRouting) lines.push(unicastRoutingCli());
  // OSPF processes must exist before interfaces try to bind to them.
  for (const o of args.ospf) lines.push(ipv6OspfCli(o));
  for (const i of args.interfaces) lines.push(ipv6InterfaceCli(i));
  for (const s of args.staticRoutes) lines.push(ipv6StaticRouteCli(s));
  return lines.join("\n");
}

export { wrapInConfig } from "../../ipc/cli-prologue.js";

export function ipv6InterfaceSummary(i: Ipv6InterfaceIntent): string {
  const ospf = i.ospfPid !== undefined ? ` ospf=${i.ospfPid}/area${i.ospfArea ?? 0}` : "";
  return `if(${i.device}/${i.port} ${i.address}${ospf})`;
}

export function ipv6OspfSummary(o: Ipv6OspfIntent): string {
  return `ospf(${o.device} pid=${o.pid}${o.routerId ? ` rid=${o.routerId}` : ""})`;
}

export function ipv6StaticSummary(s: Ipv6StaticRouteIntent): string {
  return `route(${s.device} ${s.prefix} via ${s.nextHop}${s.distance !== undefined ? ` ad=${s.distance}` : ""})`;
}
