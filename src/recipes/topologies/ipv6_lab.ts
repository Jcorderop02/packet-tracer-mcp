/**
 * Dual-stack IPv6 lab: two routers in chain, each with one PC LAN, configured
 * with OSPFv3 over the transit link and `2001:DB8:N::/64` per LAN. The IPv4
 * stack is left intact (static routing) so we can verify that IPv4 and IPv6
 * coexist without stepping on each other — that's the whole point of having
 * an independent ipv6 intent layer.
 *
 * Topology:
 *   PCA --[Fa0]/[Fa0/2]-- SWA --[Fa0/1]/[Gi0/0]-- R6A --[Gi0/1]/[Gi0/2]-- R6B --[Gi0/0]/[Fa0/1]-- SWB --[Fa0/2]/[Fa0]-- PCB
 *
 * IPv4: R6A LAN 192.168.0.0/24 (.1 gw, .2 PC), R6B LAN 192.168.1.0/24, transit 10.0.0.0/30.
 * IPv6: R6A LAN 2001:DB8:1::/64 (::1 gw, ::2 PC), R6B LAN 2001:DB8:2::/64, transit 2001:DB8:F::/64.
 * OSPFv3 PID 1 on both routers, area 0 on every interface.
 */

import {
  DEFAULT_LAN_POOL,
  type Blueprint,
  type DeviceIntent,
  type LanIntent,
  type LinkIntent,
} from "../blueprint.js";
import type {
  Ipv6EndpointIntent,
  Ipv6InterfaceIntent,
  Ipv6OspfIntent,
} from "../ipv6/intents.js";

export interface Ipv6LabOptions {
  /** Router model. Defaults to "2911" (verified by probe-ipv6.ts). */
  readonly routerModel?: string;
  /** Switch model. Defaults to "2960-24TT". */
  readonly switchModel?: string;
  /** PC model. Defaults to "PC-PT". */
  readonly pcModel?: string;
  /** IPv4 LAN pool. Defaults to DEFAULT_LAN_POOL. */
  readonly lanPool?: string;
  /** OSPFv3 process id. Defaults to 1. */
  readonly ospfPid?: number;
  /** Whether to enable OSPFv3 on the transit + LAN interfaces. Defaults true. */
  readonly enableOspf?: boolean;
}

const ROUTER_LAN_PORT = "GigabitEthernet0/0";
const ROUTER_TRANSIT_A = "GigabitEthernet0/1";
const ROUTER_TRANSIT_B = "GigabitEthernet0/2";
const SW_UPLINK_PORT = "FastEthernet0/1";
const SW_PC_PORT = "FastEthernet0/2";

export function ipv6Lab(opts: Ipv6LabOptions = {}): Blueprint {
  const routerModel = opts.routerModel ?? "2911";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";
  const lanPool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const ospfPid = opts.ospfPid ?? 1;
  const enableOspf = opts.enableOspf !== false;

  const devices: DeviceIntent[] = [
    { name: "R6A", model: routerModel, x: 240, y: 220 },
    { name: "R6B", model: routerModel, x: 600, y: 220 },
    { name: "SWA", model: switchModel, x: 240, y: 360 },
    { name: "SWB", model: switchModel, x: 600, y: 360 },
    { name: "PCA", model: pcModel, x: 240, y: 500 },
    { name: "PCB", model: pcModel, x: 600, y: 500 },
  ];

  const links: LinkIntent[] = [
    { aDevice: "R6A", aPort: ROUTER_LAN_PORT, bDevice: "SWA", bPort: SW_UPLINK_PORT, cable: "straight" },
    { aDevice: "PCA", aPort: "FastEthernet0", bDevice: "SWA", bPort: SW_PC_PORT, cable: "straight" },
    { aDevice: "R6A", aPort: ROUTER_TRANSIT_A, bDevice: "R6B", bPort: ROUTER_TRANSIT_B, cable: "cross" },
    { aDevice: "R6B", aPort: ROUTER_LAN_PORT, bDevice: "SWB", bPort: SW_UPLINK_PORT, cable: "straight" },
    { aDevice: "PCB", aPort: "FastEthernet0", bDevice: "SWB", bPort: SW_PC_PORT, cable: "straight" },
  ];

  const lans: LanIntent[] = [
    { gatewayDevice: "R6A", gatewayPort: ROUTER_LAN_PORT, endpoints: ["PCA"] },
    { gatewayDevice: "R6B", gatewayPort: ROUTER_LAN_PORT, endpoints: ["PCB"] },
  ];

  const interfaces: Ipv6InterfaceIntent[] = [
    {
      device: "R6A",
      port: ROUTER_LAN_PORT,
      address: "2001:DB8:1::1/64",
      ...(enableOspf ? { ospfPid, ospfArea: 0 } : {}),
    },
    {
      device: "R6A",
      port: ROUTER_TRANSIT_A,
      address: "2001:DB8:F::1/64",
      ...(enableOspf ? { ospfPid, ospfArea: 0 } : {}),
    },
    {
      device: "R6B",
      port: ROUTER_LAN_PORT,
      address: "2001:DB8:2::1/64",
      ...(enableOspf ? { ospfPid, ospfArea: 0 } : {}),
    },
    {
      device: "R6B",
      port: ROUTER_TRANSIT_B,
      address: "2001:DB8:F::2/64",
      ...(enableOspf ? { ospfPid, ospfArea: 0 } : {}),
    },
  ];

  const ospf: Ipv6OspfIntent[] = enableOspf
    ? [
        { device: "R6A", pid: ospfPid, routerId: "1.1.1.1" },
        { device: "R6B", pid: ospfPid, routerId: "2.2.2.2" },
      ]
    : [];

  const endpoints: Ipv6EndpointIntent[] = [
    { device: "PCA", address: "2001:DB8:1::2/64", gateway: "2001:DB8:1::1" },
    { device: "PCB", address: "2001:DB8:2::2/64", gateway: "2001:DB8:2::1" },
  ];

  return {
    name: "ipv6-lab-2r-2pc",
    devices,
    links,
    lans,
    routing: "static",
    addressing: { lanPool },
    ipv6: {
      unicastRouting: true,
      interfaces,
      ...(ospf.length > 0 ? { ospf } : {}),
      endpoints,
    },
  };
}

export function previewIpv6Lab(_opts: Ipv6LabOptions = {}): {
  readonly lans: readonly { readonly device: string; readonly v6: string; readonly v4Preview: string }[];
  readonly transit: { readonly v6: string };
} {
  return {
    lans: [
      { device: "R6A", v6: "2001:DB8:1::/64", v4Preview: "192.168.x.0/24" },
      { device: "R6B", v6: "2001:DB8:2::/64", v4Preview: "192.168.x.0/24" },
    ],
    transit: { v6: "2001:DB8:F::/64" },
  };
}
