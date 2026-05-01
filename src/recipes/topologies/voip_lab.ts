/**
 * VoIP lab topology: 1 router (CME) + 1 access switch + N IP Phones.
 *
 * The router runs telephony-service on the LAN gateway interface, hosts a
 * DHCP pool with option-150 pointing back to itself (so phones download
 * their config via TFTP), and declares one ephone-dn per phone with a
 * sequential 100X extension. Phones register themselves via SCCP and CME
 * binds them to free DNs through `auto assign 1 to N` — no synthetic MACs
 * are needed because the real port MAC is only knowable after the phone is
 * placed on the canvas (port0.getMacAddress()).
 *
 * The switch trunks data VLAN 10 + voice VLAN 100 on every phone-facing
 * port. PT IP Phones expose a single uplink "Port 0" — the chained PC
 * port is not cableable through the IPC API.
 *
 * IP Phone catalog entry: ptType="7960", typeId=12, port="Port 0".
 * Discovered via scripts/probe-ipphone-add.ts + probe-ipphone-ports.ts +
 * probe-voip-discovery.ts.
 */

import {
  DEFAULT_LAN_POOL,
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
  EphoneDnIntent,
  VoipCmeIntent,
  VoiceVlanIntent,
} from "../voip/intents.js";
import type { DhcpPoolIntent } from "../services/intents.js";
import type { VlanIntent } from "../switching/intents.js";
import { resolveModel } from "../../catalog/devices.js";

export interface VoipLabOptions {
  /** Number of IP Phones to provision (1..6). */
  readonly phones: number;
  /** Router model. Defaults to "2811" (CME ready out-of-the-box in PT 9). */
  readonly routerModel?: string;
  /** Switch model. Defaults to "2960-24TT". */
  readonly switchModel?: string;
  /** LAN pool to slice the voice subnet from. Defaults to DEFAULT_LAN_POOL. */
  readonly lanPool?: string;
  /** Voice VLAN ID (default 100). */
  readonly voiceVlanId?: number;
  /** Data VLAN ID (default 10) — reserved for future PC daisy-chaining. */
  readonly dataVlanId?: number;
  /** Starting extension (default 1001). Phone i gets startingExtension + i. */
  readonly startingExtension?: number;
  /** SCCP source port (default 2000). */
  readonly sourcePort?: number;
}

const SW_UPLINK_PORT = "GigabitEthernet0/1";
const PHONE_PORT = "Port 0";
const PHONES_MAX = 6;

/** Picks the first physical port of a router model (FastEthernet on 2811,
 *  GigabitEthernet on the 2900-series). The catalog is authoritative. */
function routerLanPort(model: string): string {
  const m = resolveModel(model);
  if (!m || m.category !== "router") {
    throw new Error(`voip_lab: unknown router model '${model}'`);
  }
  const port = m.ports[0];
  if (!port) throw new Error(`voip_lab: router '${model}' has no ports`);
  return port.fullName;
}

export function voipLab(opts: VoipLabOptions): Blueprint {
  if (!Number.isInteger(opts.phones) || opts.phones < 1 || opts.phones > PHONES_MAX) {
    throw new Error(`voip_lab needs phones in 1..${PHONES_MAX} (got ${opts.phones})`);
  }
  const routerModel = opts.routerModel ?? "2811";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const routerLan = routerLanPort(routerModel);
  const lanPool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const voiceVlanId = opts.voiceVlanId ?? 100;
  const dataVlanId = opts.dataVlanId ?? 10;
  const startingExtension = opts.startingExtension ?? 1001;
  const sourcePort = opts.sourcePort ?? 2000;

  const sub = new SubnetIterator(lanPool, 24).next();
  const hosts = subnetHosts(sub);
  const gatewayIp = hosts[0];
  if (!gatewayIp) throw new Error(`lanPool ${lanPool} did not yield a usable /24`);

  const devices: DeviceIntent[] = [
    { name: "CME", model: routerModel, x: 280, y: 220 },
    { name: "VSW", model: switchModel, x: 280, y: 360 },
  ];
  const links: LinkIntent[] = [
    { aDevice: "CME", aPort: routerLan, bDevice: "VSW", bPort: SW_UPLINK_PORT, cable: "straight" },
  ];

  const phoneNames: string[] = [];
  for (let i = 0; i < opts.phones; i++) {
    const name = `PHONE${i + 1}`;
    phoneNames.push(name);
    devices.push({ name, model: "7960", x: 120 + i * 90, y: 520 });
    links.push({
      aDevice: name,
      aPort: PHONE_PORT,
      bDevice: "VSW",
      bPort: `FastEthernet0/${i + 1}`,
      cable: "straight",
    });
  }

  const lans: LanIntent[] = [
    {
      gatewayDevice: "CME",
      gatewayPort: routerLan,
      endpoints: [],
      cidr: `${sub.network}/${sub.prefix}`,
      dhcp: false,
    },
  ];

  const dhcpPools: DhcpPoolIntent[] = [
    {
      device: "CME",
      name: "VOICE",
      network: `${sub.network}/${sub.prefix}`,
      defaultRouter: gatewayIp,
      tftpServer: gatewayIp,
      excluded: [{ start: gatewayIp, end: gatewayIp }],
    },
  ];

  const vlans: VlanIntent[] = [
    { switch: "VSW", id: dataVlanId, name: "DATA" },
    { switch: "VSW", id: voiceVlanId, name: "VOICE" },
  ];

  const cme: VoipCmeIntent[] = [
    {
      device: "CME",
      maxEphones: opts.phones,
      maxDn: opts.phones,
      sourceIp: gatewayIp,
      sourcePort,
      autoAssign: { first: 1, last: opts.phones },
    },
  ];

  const ephoneDns: EphoneDnIntent[] = [];
  for (let i = 0; i < opts.phones; i++) {
    const tag = i + 1;
    ephoneDns.push({ device: "CME", dnTag: tag, number: String(startingExtension + i) });
  }

  const voiceVlans: VoiceVlanIntent[] = phoneNames.map((_, i) => ({
    switch: "VSW",
    port: `FastEthernet0/${i + 1}`,
    voiceVlanId,
    dataVlanId,
  }));

  return {
    name: `voip-lab-${opts.phones}p`,
    devices,
    links,
    lans,
    routing: "none",
    addressing: { lanPool },
    switching: { vlans },
    services: { dhcpPools },
    voip: { cme, ephoneDns, voiceVlans },
  };
}

export function previewVoipLab(opts: VoipLabOptions): {
  network: string;
  gateway: string;
  mask: string;
  voiceVlanId: number;
  dataVlanId: number;
  extensions: readonly string[];
} {
  const sub = new SubnetIterator(opts.lanPool ?? DEFAULT_LAN_POOL, 24).next();
  const hosts = subnetHosts(sub);
  const startingExtension = opts.startingExtension ?? 1001;
  const extensions: string[] = [];
  for (let i = 0; i < opts.phones; i++) extensions.push(String(startingExtension + i));
  return {
    network: `${sub.network}/${sub.prefix}`,
    gateway: hosts[0] ?? "",
    mask: prefixToMask(sub.prefix),
    voiceVlanId: opts.voiceVlanId ?? 100,
    dataVlanId: opts.dataVlanId ?? 10,
    extensions,
  };
}
