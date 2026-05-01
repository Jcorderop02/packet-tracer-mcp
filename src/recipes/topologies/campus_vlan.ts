/**
 * "Campus VLAN" topology: a single router-on-a-stick gateway behind one
 * access switch, with N VLANs each containing M PCs. Demonstrates the
 * full L2/L3 mix recipes can produce:
 *
 *   - VLANs declared on the switch (with names + access ports).
 *   - A trunk port between switch and router.
 *   - Per-VLAN router subinterfaces with `encapsulation dot1Q` + IP gateway,
 *     pushed via `extraCli` since the addressing recipe cannot synthesise
 *     subinterfaces on its own.
 *   - Each VLAN gets its own /24 carved from the LAN pool so PCs can be
 *     auto-addressed by the standard addressing recipe.
 *
 * The shape is intentionally compact (one switch, one router) — the goal is
 * to show how `switching` + `extraCli` compose with the rest of the pipeline,
 * not to model a multi-distribution campus. Bigger topologies are easy to
 * derive once the building blocks are clear.
 */

import {
  DEFAULT_LAN_POOL,
  type Blueprint,
  type DeviceCliIntent,
  type DeviceIntent,
  type LanIntent,
  type LinkIntent,
  type RoutingProtocol,
} from "../blueprint.js";
import {
  prefixToMask,
  SubnetIterator,
  subnetHosts,
} from "../../canvas/subnetting.js";
import type {
  SwitchingIntent,
  TrunkIntent,
  VlanIntent,
} from "../switching/intents.js";

export interface CampusVlanOptions {
  /** Number of VLANs (1..16). */
  readonly vlans: number;
  /** PCs per VLAN (>= 0). */
  readonly pcsPerVlan: number;
  /** Optional starting VLAN id (default 10, then 20, 30, ...). */
  readonly startVlanId?: number;
  /** Optional VLAN id step between successive VLANs (default 10). */
  readonly vlanStep?: number;
  /** Router model (default 1941 — has Gig0/0 we'll trunk on). */
  readonly routerModel?: string;
  /** Switch model (default 2960-24TT — 24 access + 2 uplinks). */
  readonly switchModel?: string;
  /** PC model (default PC-PT). */
  readonly pcModel?: string;
  /** Optional override for the LAN pool used to carve /24s. */
  readonly lanPool?: string;
  /** Routing protocol — defaults to "none" (one router; nothing to advertise). */
  readonly routing?: RoutingProtocol;
}

const TRUNK_ROUTER_PORT = "GigabitEthernet0/0";
const TRUNK_SWITCH_PORT = "GigabitEthernet0/1";

export function campusVlan(opts: CampusVlanOptions): Blueprint {
  if (opts.vlans < 1) throw new Error("campus_vlan needs at least 1 VLAN");
  if (opts.vlans > 16) throw new Error("campus_vlan caps at 16 VLANs (24-port switch)");
  if (opts.pcsPerVlan < 0) throw new Error("pcsPerVlan must be >= 0");

  const startId = opts.startVlanId ?? 10;
  const step = opts.vlanStep ?? 10;
  if (startId < 2 || startId > 4094) throw new Error("startVlanId must be in 2..4094");
  if (step < 1) throw new Error("vlanStep must be >= 1");
  const lastId = startId + (opts.vlans - 1) * step;
  if (lastId > 4094) throw new Error(`VLAN ids would exceed 4094 (last would be ${lastId})`);
  const totalPorts = opts.vlans * opts.pcsPerVlan;
  if (totalPorts > 22) {
    throw new Error("campus_vlan needs <= 22 access ports (Fa0/2..Fa0/23 on 2960-24TT)");
  }

  const routerModel = opts.routerModel ?? "1941";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";
  const pool = opts.lanPool ?? DEFAULT_LAN_POOL;

  const devices: DeviceIntent[] = [
    { name: "GW", model: routerModel, x: 320, y: 200 },
    { name: "SW", model: switchModel, x: 320, y: 360 },
  ];
  const links: LinkIntent[] = [
    {
      aDevice: "GW",
      aPort: TRUNK_ROUTER_PORT,
      bDevice: "SW",
      bPort: TRUNK_SWITCH_PORT,
      cable: "straight",
    },
  ];

  const vlanIntents: VlanIntent[] = [];
  const lans: LanIntent[] = [];
  const subinterfaceCli: string[] = [
    `interface ${TRUNK_ROUTER_PORT}`,
    " no shutdown",
    " exit",
  ];

  // Pre-allocate /24s deterministically so the recipe and the addressing
  // recipe agree on the gateway IP for each VLAN.
  const lanIter = new SubnetIterator(pool, 24);
  let nextAccessPort = 2; // Fa0/1 is reserved for the trunk uplink (we use Gig0/1, but skip 1 for clarity).

  // We use Gig0/1 for the trunk so Fa0/1..Fa0/24 are free; start access at Fa0/2 anyway
  // to leave a visible "non-access" buffer for tests/debugging.
  // (No technical requirement; this keeps screenshots tidy.)
  for (let i = 0; i < opts.vlans; i++) {
    const vlanId = startId + i * step;
    const subnet = lanIter.next();
    const hosts = subnetHosts(subnet);
    const gatewayIp = hosts[0]!;
    const mask = prefixToMask(subnet.prefix);
    const subif = `${TRUNK_ROUTER_PORT}.${vlanId}`;

    subinterfaceCli.push(
      `interface ${subif}`,
      ` encapsulation dot1Q ${vlanId}`,
      ` ip address ${gatewayIp} ${mask}`,
      " no shutdown",
      " exit",
    );

    const accessPorts: string[] = [];
    const pcNames: string[] = [];
    for (let p = 0; p < opts.pcsPerVlan; p++) {
      const port = `FastEthernet0/${nextAccessPort}`;
      accessPorts.push(port);
      const pcName = `PC_V${vlanId}_${p + 1}`;
      pcNames.push(pcName);
      const baseX = 80 + (nextAccessPort - 2) * 50;
      devices.push({ name: pcName, model: pcModel, x: baseX, y: 540 });
      links.push({
        aDevice: pcName,
        aPort: "FastEthernet0",
        bDevice: "SW",
        bPort: port,
        cable: "straight",
      });
      nextAccessPort++;
    }

    vlanIntents.push({
      switch: "SW",
      id: vlanId,
      name: `VLAN${vlanId}`,
      ...(accessPorts.length > 0 ? { accessPorts } : {}),
    });

    lans.push({
      gatewayDevice: "GW",
      gatewayPort: subif,
      endpoints: pcNames,
      cidr: `${subnet.network}/${subnet.prefix}`,
    });
  }

  const allowed = vlanIntents.map(v => v.id);
  const trunks: TrunkIntent[] = [
    {
      switch: "SW",
      switchModel,
      port: TRUNK_SWITCH_PORT,
      allowed,
      encapsulation: "dot1q",
    },
  ];

  const switching: SwitchingIntent = {
    vlans: vlanIntents,
    trunks,
  };

  const extraCli: DeviceCliIntent[] = [
    {
      device: "GW",
      label: "router-on-a-stick subinterfaces",
      commands: subinterfaceCli.join("\n"),
    },
  ];

  return {
    name: `campus-${opts.vlans}v-${opts.pcsPerVlan}pc`,
    devices,
    links,
    lans,
    routing: opts.routing ?? "none",
    addressing: { lanPool: pool },
    switching,
    extraCli,
  };
}

/** Re-exported for tests so we can verify the deterministic /24 carving. */
export function previewCampusVlanAllocations(opts: CampusVlanOptions): {
  vlanId: number;
  cidr: string;
  gateway: string;
}[] {
  const pool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const lanIter = new SubnetIterator(pool, 24);
  const startId = opts.startVlanId ?? 10;
  const step = opts.vlanStep ?? 10;
  const out: { vlanId: number; cidr: string; gateway: string }[] = [];
  for (let i = 0; i < opts.vlans; i++) {
    const sub = lanIter.next();
    const hosts = subnetHosts(sub);
    out.push({
      vlanId: startId + i * step,
      cidr: `${sub.network}/${sub.prefix}`,
      gateway: hosts[0] ?? "",
    });
  }
  return out;
}
