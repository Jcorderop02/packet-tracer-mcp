/**
 * "Branch office" topology: a HQ router with two LANs (admin + ops) connected
 * to a remote branch router that has its own LAN. Mirrors a textbook small
 * enterprise — different from chain/star in that one of the routers carries
 * multiple LAN ports.
 */

import type { Blueprint, LinkIntent, DeviceIntent, LanIntent, RoutingProtocol } from "../blueprint.js";

export interface BranchOptions {
  readonly hqLans?: number;
  readonly pcsPerLan: number;
  readonly hqModel?: string;
  readonly branchModel?: string;
  readonly switchModel?: string;
  readonly pcModel?: string;
  readonly routing?: RoutingProtocol;
  readonly dhcp?: boolean;
}

export function branchOffice(opts: BranchOptions): Blueprint {
  const hqLans = opts.hqLans ?? 2;
  if (hqLans < 1 || hqLans > 2) {
    throw new Error("hqLans must be 1 or 2 (HQ uses 2911 with three Gig ports)");
  }
  if (opts.pcsPerLan < 0) throw new Error("pcsPerLan must be >= 0");

  const hqModel = opts.hqModel ?? "2911";
  const branchModel = opts.branchModel ?? "1941";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";

  const devices: DeviceIntent[] = [
    { name: "HQ", model: hqModel, x: 250, y: 200 },
    { name: "BR", model: branchModel, x: 700, y: 200 },
  ];
  const links: LinkIntent[] = [
    {
      aDevice: "HQ",
      aPort: "GigabitEthernet0/0",
      bDevice: "BR",
      bPort: "GigabitEthernet0/0",
      cable: "cross",
    },
  ];
  const lans: LanIntent[] = [];

  // HQ LANs hang off Gig0/1 (and Gig0/2 if there's a second).
  for (let i = 0; i < hqLans; i++) {
    const port = `GigabitEthernet0/${i + 1}`;
    const swName = `SW_HQ_${i + 1}`;
    const baseX = 100 + i * 220;
    devices.push({ name: swName, model: switchModel, x: baseX, y: 380 });
    links.push({
      aDevice: "HQ",
      aPort: port,
      bDevice: swName,
      bPort: "FastEthernet0/1",
      cable: "straight",
    });

    const pcNames: string[] = [];
    for (let p = 0; p < opts.pcsPerLan; p++) {
      const pcName = `PC_HQ_${i + 1}_${p + 1}`;
      pcNames.push(pcName);
      devices.push({ name: pcName, model: pcModel, x: baseX + p * 50, y: 540 });
      links.push({
        aDevice: pcName,
        aPort: "FastEthernet0",
        bDevice: swName,
        bPort: `FastEthernet0/${p + 2}`,
        cable: "straight",
      });
    }
    lans.push({
      gatewayDevice: "HQ",
      gatewayPort: port,
      endpoints: pcNames,
      ...(opts.dhcp ? { dhcp: true } : {}),
    });
  }

  // Branch LAN on Gig0/1 (the 1941's second port).
  if (opts.pcsPerLan > 0) {
    devices.push({ name: "SW_BR", model: switchModel, x: 700, y: 380 });
    links.push({
      aDevice: "BR",
      aPort: "GigabitEthernet0/1",
      bDevice: "SW_BR",
      bPort: "FastEthernet0/1",
      cable: "straight",
    });
    const pcNames: string[] = [];
    for (let p = 0; p < opts.pcsPerLan; p++) {
      const pcName = `PC_BR_${p + 1}`;
      pcNames.push(pcName);
      devices.push({ name: pcName, model: pcModel, x: 600 + p * 50, y: 540 });
      links.push({
        aDevice: pcName,
        aPort: "FastEthernet0",
        bDevice: "SW_BR",
        bPort: `FastEthernet0/${p + 2}`,
        cable: "straight",
      });
    }
    lans.push({
      gatewayDevice: "BR",
      gatewayPort: "GigabitEthernet0/1",
      endpoints: pcNames,
      ...(opts.dhcp ? { dhcp: true } : {}),
    });
  }

  return {
    name: `branch-${hqLans}hq-${opts.pcsPerLan}pc`,
    devices,
    links,
    lans,
    routing: opts.routing ?? "static",
    addressing: {},
  };
}
