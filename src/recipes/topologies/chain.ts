/**
 * "Chain" topology: N routers connected in series (R1-R2-R3-...), each one
 * carrying its own LAN of M PCs through a switch. It's the simplest non-trivial
 * topology and the one most useful for sanity-checking routing protocols.
 *
 * The recipe builds a Blueprint declaratively — the live application happens
 * later when the caller runs cookBlueprint() against this output.
 */

import type { Blueprint, LinkIntent, DeviceIntent, LanIntent, RoutingProtocol } from "../blueprint.js";

export interface ChainOptions {
  readonly routers: number;
  readonly pcsPerLan: number;
  readonly routerModel?: string;
  readonly switchModel?: string;
  readonly pcModel?: string;
  readonly routing?: RoutingProtocol;
  readonly dhcp?: boolean;
}

const SPACING = 150;

export function chain(opts: ChainOptions): Blueprint {
  if (opts.routers < 2) throw new Error("chain topology needs at least 2 routers");
  if (opts.pcsPerLan < 0) throw new Error("pcsPerLan must be >= 0");

  const routerModel = opts.routerModel ?? "2911";
  const switchModel = opts.switchModel ?? "2960-24TT";
  const pcModel = opts.pcModel ?? "PC-PT";

  const devices: DeviceIntent[] = [];
  const links: LinkIntent[] = [];
  const lans: LanIntent[] = [];

  for (let i = 0; i < opts.routers; i++) {
    const rIdx = i + 1;
    const rName = `R${rIdx}`;
    devices.push({ name: rName, model: routerModel, x: 200 + i * SPACING * 3, y: 200 });

    if (opts.pcsPerLan > 0) {
      const swName = `SW${rIdx}`;
      devices.push({ name: swName, model: switchModel, x: 200 + i * SPACING * 3, y: 350 });
      // Router's GigabitEthernet0/0 faces the LAN; SW's FastEthernet0/1 takes it.
      links.push({
        aDevice: rName,
        aPort: "GigabitEthernet0/0",
        bDevice: swName,
        bPort: "FastEthernet0/1",
        cable: "straight",
      });

      const pcNames: string[] = [];
      for (let p = 0; p < opts.pcsPerLan; p++) {
        const pcName = `PC${rIdx}_${p + 1}`;
        pcNames.push(pcName);
        devices.push({ name: pcName, model: pcModel, x: 100 + i * SPACING * 3 + p * 60, y: 500 });
        links.push({
          aDevice: pcName,
          aPort: "FastEthernet0",
          bDevice: swName,
          bPort: `FastEthernet0/${p + 2}`,
          cable: "straight",
        });
      }
      lans.push({
        gatewayDevice: rName,
        gatewayPort: "GigabitEthernet0/0",
        endpoints: pcNames,
        ...(opts.dhcp ? { dhcp: true } : {}),
      });
    }

    if (i > 0) {
      const prev = `R${i}`;
      links.push({
        aDevice: prev,
        aPort: "GigabitEthernet0/1",
        bDevice: rName,
        bPort: "GigabitEthernet0/2",
        cable: "cross",
      });
    }
  }

  return {
    name: `chain-${opts.routers}r-${opts.pcsPerLan}pc`,
    devices,
    links,
    lans,
    routing: opts.routing ?? "static",
    addressing: {},
  };
}
