/**
 * "Dual ISP" topology: two edge routers (EDGE1, EDGE2) peering eBGP with a
 * shared upstream ISP, sharing a virtual gateway via HSRP on the inside LAN
 * for first-hop redundancy. Hosts behind SW_LAN get DHCP from EDGE1.
 */

import {
  DEFAULT_LAN_POOL,
  DEFAULT_TRANSIT_POOL,
  type Blueprint,
  type DeviceCliIntent,
  type DeviceIntent,
  type LanIntent,
  type LinkIntent,
} from "../blueprint.js";
import { prefixToMask, SubnetIterator, subnetHosts } from "../../canvas/subnetting.js";
import type { BgpIntent } from "../routing/bgp.js";

export interface DualIspOptions {
  readonly pcs: number;
  readonly edgeModel?: string;
  readonly ispModel?: string;
  readonly switchModel?: string;
  readonly pcModel?: string;
  readonly lanPool?: string;
  readonly transitPool?: string;
}

const EDGE_TO_ISP_PORT = "GigabitEthernet0/0";
const EDGE_TO_EDGE_PORT = "GigabitEthernet0/1";
const EDGE_TO_LAN_PORT = "GigabitEthernet0/2";
const ISP_TO_EDGE1_PORT = "GigabitEthernet0/0";
const ISP_TO_EDGE2_PORT = "GigabitEthernet0/1";

const HSRP_GROUP = 1;
const EDGE1_ASN = 65001;
const EDGE2_ASN = 65002;
const ISP_ASN = 65000;

export function dualIsp(opts: DualIspOptions): Blueprint {
  if (opts.pcs < 1) throw new Error("dual_isp needs at least 1 PC behind the LAN");
  if (opts.pcs > 6) throw new Error("dual_isp caps at 6 PCs");

  const edgeModel = opts.edgeModel ?? "2911";
  const ispModel = opts.ispModel ?? "2911";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";
  const lanPool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const transitPool = opts.transitPool ?? DEFAULT_TRANSIT_POOL;

  // LAN /24: .1 = HSRP virtual IP (gateway clients see), .2 = EDGE1, .3 = EDGE2.
  // EDGE1's interface gets .2 via extraCli, overriding the .1 the addressing
  // recipe puts there for the LAN's gatewayDevice — necessary because PT/IOS
  // rejects `standby <g> ip X` when X equals the interface's own IP. EDGE2's
  // .3 is also assigned via extraCli (LanIntent only allows one gateway).
  const lanSub = new SubnetIterator(lanPool, 24).next();
  const lanHosts = subnetHosts(lanSub);
  const virtualIp = lanHosts[0]!;
  const edge1LanIp = lanHosts[1]!;
  const edge2LanIp = lanHosts[2]!;
  const lanMask = prefixToMask(lanSub.prefix);

  // Three /30s from the transit pool.
  const transitIter = new SubnetIterator(transitPool, 30);
  const t1 = transitIter.next(); // EDGE1 <-> ISP
  const t2 = transitIter.next(); // EDGE2 <-> ISP
  const t3 = transitIter.next(); // EDGE1 <-> EDGE2
  const t1Hosts = subnetHosts(t1);
  const t2Hosts = subnetHosts(t2);
  const t3Hosts = subnetHosts(t3);
  const edge1ToIspIp = t1Hosts[0]!;
  const ispToEdge1Ip = t1Hosts[1]!;
  const edge2ToIspIp = t2Hosts[0]!;
  const ispToEdge2Ip = t2Hosts[1]!;
  const edge1ToEdge2Ip = t3Hosts[0]!;
  const edge2ToEdge1Ip = t3Hosts[1]!;

  const devices: DeviceIntent[] = [
    { name: "EDGE1",  model: edgeModel,   x: 240, y: 200 },
    { name: "EDGE2",  model: edgeModel,   x: 480, y: 200 },
    { name: "ISP",    model: ispModel,    x: 360, y: 60  },
    { name: "SW_LAN", model: switchModel, x: 360, y: 360 },
  ];

  const links: LinkIntent[] = [
    {
      aDevice: "EDGE1", aPort: EDGE_TO_ISP_PORT,
      bDevice: "ISP",   bPort: ISP_TO_EDGE1_PORT,
      cable: "cross",
    },
    {
      aDevice: "EDGE2", aPort: EDGE_TO_ISP_PORT,
      bDevice: "ISP",   bPort: ISP_TO_EDGE2_PORT,
      cable: "cross",
    },
    {
      aDevice: "EDGE1", aPort: EDGE_TO_EDGE_PORT,
      bDevice: "EDGE2", bPort: EDGE_TO_EDGE_PORT,
      cable: "cross",
    },
    {
      aDevice: "EDGE1",  aPort: EDGE_TO_LAN_PORT,
      bDevice: "SW_LAN", bPort: "FastEthernet0/1",
      cable: "straight",
    },
    {
      aDevice: "EDGE2",  aPort: EDGE_TO_LAN_PORT,
      bDevice: "SW_LAN", bPort: "FastEthernet0/2",
      cable: "straight",
    },
  ];

  const pcNames: string[] = [];
  for (let i = 0; i < opts.pcs; i++) {
    const name = `PC${i + 1}`;
    pcNames.push(name);
    devices.push({ name, model: pcModel, x: 120 + i * 80, y: 500 });
    links.push({
      aDevice: name,
      aPort: "FastEthernet0",
      bDevice: "SW_LAN",
      bPort: `FastEthernet0/${i + 3}`,
      cable: "straight",
    });
  }

  // EDGE1 carries the gateway role only so that the addressing recipe creates
  // the LAN DHCP pool with `default-router = virtualIp` (.1 — the HSRP shared
  // address PCs talk to). The actual interface IPs and HSRP standby commands
  // are issued via extraCli per edge, which runs after BGP/HSRP and lets us
  // bundle "set the right IP, then add standby" into a single CLI block.
  const lans: LanIntent[] = [
    {
      gatewayDevice: "EDGE1",
      gatewayPort: EDGE_TO_LAN_PORT,
      endpoints: pcNames,
      cidr: `${lanSub.network}/${lanSub.prefix}`,
      dhcp: true,
    },
  ];

  const lanCidr = `${lanSub.network}/${lanSub.prefix}`;
  const bgp: BgpIntent[] = [
    {
      device: "EDGE1",
      asn: EDGE1_ASN,
      neighbors: [
        { ip: ispToEdge1Ip, remoteAs: ISP_ASN, description: "ISP" },
        { ip: edge2ToEdge1Ip, remoteAs: EDGE2_ASN, description: "EDGE2" },
      ],
      networks: [lanCidr],
    },
    {
      device: "EDGE2",
      asn: EDGE2_ASN,
      neighbors: [
        { ip: ispToEdge2Ip, remoteAs: ISP_ASN, description: "ISP" },
        { ip: edge1ToEdge2Ip, remoteAs: EDGE1_ASN, description: "EDGE1" },
      ],
      networks: [lanCidr],
    },
    {
      device: "ISP",
      asn: ISP_ASN,
      neighbors: [
        { ip: edge1ToIspIp, remoteAs: EDGE1_ASN, description: "EDGE1" },
        { ip: edge2ToIspIp, remoteAs: EDGE2_ASN, description: "EDGE2" },
      ],
    },
  ];

  const edge1Hsrp: DeviceCliIntent = {
    device: "EDGE1",
    label: "EDGE1 LAN IP + HSRP",
    commands: [
      `interface ${EDGE_TO_LAN_PORT}`,
      "no ip address",
      `ip address ${edge1LanIp} ${lanMask}`,
      "no shutdown",
      `standby ${HSRP_GROUP} ip ${virtualIp}`,
      `standby ${HSRP_GROUP} priority 110`,
      `standby ${HSRP_GROUP} preempt`,
      "exit",
    ].join("\n"),
  };

  const edge2Hsrp: DeviceCliIntent = {
    device: "EDGE2",
    label: "EDGE2 LAN IP + HSRP",
    commands: [
      `interface ${EDGE_TO_LAN_PORT}`,
      `ip address ${edge2LanIp} ${lanMask}`,
      "no shutdown",
      `standby ${HSRP_GROUP} ip ${virtualIp}`,
      `standby ${HSRP_GROUP} priority 100`,
      "exit",
    ].join("\n"),
  };

  return {
    name: `dual-isp-${opts.pcs}pc`,
    devices,
    links,
    lans,
    routing: "static",
    addressing: { lanPool, transitPool },
    advancedRouting: { bgp },
    extraCli: [edge1Hsrp, edge2Hsrp],
  };
}
