/**
 * "Edge NAT" topology: an edge router doing PAT (interface overload) for an
 * inside LAN, with an ISP router upstream. Demonstrates the L3 services
 * pipeline:
 *
 *   - addressing recipe assigns the inside LAN /24 and the WAN /30,
 *   - services intent installs ACL 1, marks the WAN as outside / LAN as
 *     inside, configures `ip nat inside source list 1 interface Gi0/0
 *     overload`, and stands up a DHCP pool serving the LAN,
 *   - optional NTP + syslog targets land on the edge router.
 *
 * The inside hosts get DHCP'd by the edge router (lan.dhcp = true) so they
 * exercise both the DHCP pool and the NAT overload end-to-end.
 */

import {
  DEFAULT_LAN_POOL,
  DEFAULT_TRANSIT_POOL,
  type Blueprint,
  type DeviceIntent,
  type LanIntent,
  type LinkIntent,
} from "../blueprint.js";
import {
  prefixToMask,
  SubnetIterator,
  subnetHosts,
} from "../../canvas/subnetting.js";
import type {
  AclIntent,
  DhcpPoolIntent,
  NatIntent,
  NtpIntent,
  ServicesIntent,
  SyslogIntent,
} from "../services/intents.js";

export interface EdgeNatOptions {
  readonly pcs: number;
  readonly edgeModel?: string;
  readonly ispModel?: string;
  readonly switchModel?: string;
  readonly pcModel?: string;
  readonly lanPool?: string;
  readonly transitPool?: string;
  /** When true, also add NTP/syslog directives pointing at the ISP router. */
  readonly withTelemetry?: boolean;
}

const EDGE_INSIDE_PORT = "GigabitEthernet0/1";
const EDGE_OUTSIDE_PORT = "GigabitEthernet0/0";

export function edgeNat(opts: EdgeNatOptions): Blueprint {
  if (opts.pcs < 1) throw new Error("edge_nat needs at least 1 PC behind the LAN");
  if (opts.pcs > 22) throw new Error("edge_nat caps at 22 PCs (2960-24TT free access ports)");

  const edgeModel = opts.edgeModel ?? "1941";
  const ispModel = opts.ispModel ?? "1941";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";
  const lanPool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const transitPool = opts.transitPool ?? DEFAULT_TRANSIT_POOL;

  // We pre-allocate the inside /24 so the DHCP pool, ACL and NAT statements
  // all agree with what the addressing recipe will install.
  const insideSub = new SubnetIterator(lanPool, 24).next();
  const insideHosts = subnetHosts(insideSub);
  const gateway = insideHosts[0]!;
  const dhcpFirst = insideHosts[1]!;
  const dhcpLast = insideHosts[insideHosts.length - 1]!;

  const devices: DeviceIntent[] = [
    { name: "EDGE", model: edgeModel, x: 320, y: 220 },
    { name: "ISP",  model: ispModel,  x: 600, y: 220 },
    { name: "SW",   model: switchModel, x: 320, y: 380 },
  ];
  const links: LinkIntent[] = [
    {
      aDevice: "EDGE",
      aPort: EDGE_OUTSIDE_PORT,
      bDevice: "ISP",
      bPort: "GigabitEthernet0/0",
      cable: "cross",
    },
    {
      aDevice: "EDGE",
      aPort: EDGE_INSIDE_PORT,
      bDevice: "SW",
      bPort: "FastEthernet0/1",
      cable: "straight",
    },
  ];

  const pcNames: string[] = [];
  for (let i = 0; i < opts.pcs; i++) {
    const name = `PC${i + 1}`;
    pcNames.push(name);
    devices.push({ name, model: pcModel, x: 120 + i * 60, y: 540 });
    links.push({
      aDevice: name,
      aPort: "FastEthernet0",
      bDevice: "SW",
      bPort: `FastEthernet0/${i + 2}`,
      cable: "straight",
    });
  }

  const lans: LanIntent[] = [
    {
      gatewayDevice: "EDGE",
      gatewayPort: EDGE_INSIDE_PORT,
      endpoints: pcNames,
      cidr: `${insideSub.network}/${insideSub.prefix}`,
      dhcp: true,
    },
  ];

  // Services bundle: ACL 1 matches the inside LAN; NAT marks the interfaces
  // and overloads onto the WAN port. DHCP pool covers the LAN minus the
  // first 5 hosts (already taken care of by the addressing recipe).
  const acl: AclIntent = {
    device: "EDGE",
    name: "1",
    kind: "standard",
    rules: [
      { action: "permit", source: `${insideSub.network}/${insideSub.prefix}` },
    ],
  };

  const nat: NatIntent = {
    device: "EDGE",
    interfaces: [
      { port: EDGE_INSIDE_PORT, role: "inside" },
      { port: EDGE_OUTSIDE_PORT, role: "outside" },
    ],
    overload: {
      aclName: "1",
      outsideInterface: EDGE_OUTSIDE_PORT,
    },
  };

  const dhcp: DhcpPoolIntent = {
    device: "EDGE",
    name: `LAN_${insideSub.network.replace(/\./g, "_")}`,
    network: `${insideSub.network}/${insideSub.prefix}`,
    defaultRouter: gateway,
    dnsServer: "8.8.8.8",
    excluded: [{ start: gateway, end: dhcpFirst }],
  };

  const services: ServicesIntent = {
    acls: [acl],
    nat: [nat],
    dhcpPools: [dhcp],
  };

  if (opts.withTelemetry) {
    // The ISP gets a /30 from the transit pool — we don't know the exact
    // address allocated by the addressing recipe yet, but the first /30
    // gives the ISP host[1] (since EDGE is the lower endpoint). That's a
    // close-enough default for the lab.
    const transit = new SubnetIterator(transitPool, 30).next();
    const ispHost = subnetHosts(transit)[1] ?? "10.0.0.2";
    const ntp: NtpIntent = { device: "EDGE", servers: [ispHost] };
    const syslog: SyslogIntent = { device: "EDGE", hosts: [ispHost], trapLevel: 4 };
    (services as { ntp?: readonly NtpIntent[]; syslog?: readonly SyslogIntent[] }).ntp = [ntp];
    (services as { ntp?: readonly NtpIntent[]; syslog?: readonly SyslogIntent[] }).syslog = [syslog];
  }

  return {
    name: `edge-nat-${opts.pcs}pc${opts.withTelemetry ? "-tlm" : ""}`,
    devices,
    links,
    lans,
    routing: "static",
    addressing: { lanPool, transitPool },
    services,
  };
}

/**
 * Helper used by tests to verify the recipe lays out addresses deterministically.
 * Keep in sync with the SubnetIterator logic above.
 */
export function previewEdgeNatLan(opts: EdgeNatOptions): { network: string; gateway: string; mask: string } {
  const sub = new SubnetIterator(opts.lanPool ?? DEFAULT_LAN_POOL, 24).next();
  const hosts = subnetHosts(sub);
  return {
    network: `${sub.network}/${sub.prefix}`,
    gateway: hosts[0] ?? "",
    mask: prefixToMask(sub.prefix),
  };
}
