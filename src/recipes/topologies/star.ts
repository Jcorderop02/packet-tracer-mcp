/**
 * "Star" topology: a hub router connects N spoke routers, each spoke carrying
 * its own LAN. Useful for hub-and-spoke designs and to stress-test addressing
 * and routing recipes against branching graphs.
 */

import type { Blueprint, LinkIntent, DeviceIntent, LanIntent, RoutingProtocol } from "../blueprint.js";

export interface StarOptions {
  readonly spokes: number;
  readonly pcsPerSpoke: number;
  readonly hubModel?: string;
  readonly spokeModel?: string;
  readonly switchModel?: string;
  readonly pcModel?: string;
  readonly routing?: RoutingProtocol;
  readonly dhcp?: boolean;
}

export function star(opts: StarOptions): Blueprint {
  if (opts.spokes < 1) throw new Error("star topology needs at least 1 spoke");
  if (opts.pcsPerSpoke < 0) throw new Error("pcsPerSpoke must be >= 0");
  if (opts.spokes > 3) throw new Error("default 2911 hub only has 3 free uplinks; pick a custom hubModel for >3 spokes");

  const hubModel   = opts.hubModel   ?? "2911";
  const spokeModel = opts.spokeModel ?? "1941";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";

  const devices: DeviceIntent[] = [
    { name: "HUB", model: hubModel, x: 500, y: 200 },
  ];
  const links: LinkIntent[] = [];
  const lans: LanIntent[] = [];

  // Hub uplinks 0/0..0/N to each spoke's 0/0.
  // Hub does not own a LAN here — keeps the addressing recipe focused on transits.
  for (let i = 0; i < opts.spokes; i++) {
    const idx = i + 1;
    const sName = `S${idx}`;
    const angle = (Math.PI * 2 * i) / opts.spokes;
    const sx = 500 + Math.round(Math.cos(angle) * 280);
    const sy = 400 + Math.round(Math.sin(angle) * 200);
    devices.push({ name: sName, model: spokeModel, x: sx, y: sy });

    links.push({
      aDevice: "HUB",
      aPort: `GigabitEthernet0/${i}`,
      bDevice: sName,
      bPort: "GigabitEthernet0/0",
      cable: "cross",
    });

    if (opts.pcsPerSpoke > 0) {
      const swName = `SW${idx}`;
      devices.push({ name: swName, model: switchModel, x: sx, y: sy + 120 });
      links.push({
        aDevice: sName,
        aPort: "GigabitEthernet0/1",
        bDevice: swName,
        bPort: "FastEthernet0/1",
        cable: "straight",
      });

      const pcNames: string[] = [];
      for (let p = 0; p < opts.pcsPerSpoke; p++) {
        const pcName = `PC${idx}_${p + 1}`;
        pcNames.push(pcName);
        devices.push({ name: pcName, model: pcModel, x: sx + (p - Math.floor(opts.pcsPerSpoke / 2)) * 40, y: sy + 240 });
        links.push({
          aDevice: pcName,
          aPort: "FastEthernet0",
          bDevice: swName,
          bPort: `FastEthernet0/${p + 2}`,
          cable: "straight",
        });
      }
      lans.push({
        gatewayDevice: sName,
        gatewayPort: "GigabitEthernet0/1",
        endpoints: pcNames,
        ...(opts.dhcp ? { dhcp: true } : {}),
      });
    }
  }

  return {
    name: `star-${opts.spokes}s-${opts.pcsPerSpoke}pc`,
    devices,
    links,
    lans,
    routing: opts.routing ?? "ospf",
    addressing: {},
  };
}
