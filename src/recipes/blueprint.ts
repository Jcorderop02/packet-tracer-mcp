/**
 * Blueprints describe *intent* — "I want a chain of three routers, each with
 * one PC LAN" — not a concrete plan. A topology recipe consumes a blueprint
 * and synthesises the bridge operations needed to realise it on the live
 * canvas. That synthesis can be deterministic (cook_topology) or guided by
 * the current snapshot (e.g. the addressing recipe re-uses ports already
 * configured if they fit the requested scheme).
 *
 * Blueprints are deliberately small and serialisable so they can be persisted
 * alongside snapshots — useful for explaining "what was the user trying to
 * build here?" days after the fact.
 */

import type { CableKind } from "../ipc/constants.js";
import type { Ipv6Intent } from "./ipv6/intents.js";
import type { BgpIntent } from "./routing/bgp.js";
import type { HsrpIntent } from "./routing/hsrp.js";
import type { ServicesIntent } from "./services/intents.js";
import type { SwitchingIntent } from "./switching/intents.js";
import type { VoipIntent } from "./voip/intents.js";
import type { WirelessIntent } from "./wireless/intents.js";

export type RoutingProtocol = "none" | "static" | "ospf" | "rip" | "eigrp";

export interface DeviceIntent {
  readonly name: string;
  /** Catalog model or alias. Resolved at recipe time. */
  readonly model: string;
  readonly x: number;
  readonly y: number;
}

export interface LinkIntent {
  readonly aDevice: string;
  readonly aPort: string;
  readonly bDevice: string;
  readonly bPort: string;
  readonly cable: CableKind;
}

export interface LanIntent {
  /** Router name that hosts the LAN's gateway. */
  readonly gatewayDevice: string;
  /** Gateway port (the router-side interface that faces the LAN). */
  readonly gatewayPort: string;
  /** PCs/laptops/servers that sit behind that gateway. */
  readonly endpoints: readonly string[];
  /** Optional CIDR override; addressing recipe picks one if absent. */
  readonly cidr?: string;
  /** If true, configure DHCP on the router for this LAN. */
  readonly dhcp?: boolean;
}

/**
 * Free-form CLI block to push at the end of cook. Used by recipes that need
 * device-specific configuration the standard addressing/routing/switching
 * passes don't cover — router-on-a-stick subinterfaces, DHCP pools, ACLs,
 * NAT rules, telephony-service for VoIP, IPv6 stacks, etc.
 */
export interface DeviceCliIntent {
  readonly device: string;
  readonly commands: string;
  /** Optional human label shown in the cook report. */
  readonly label?: string;
}

export interface AddressingIntent {
  /** Pool the addressing recipe slices /24s out of for LANs. */
  readonly lanPool?: string;
  /** Pool the addressing recipe slices /30s out of for inter-router links. */
  readonly transitPool?: string;
  /** OSPF process id if routing === 'ospf'. */
  readonly ospfPid?: number;
  /** EIGRP autonomous system number if routing === 'eigrp'. */
  readonly eigrpAsn?: number;
  /** RIP version (1 or 2). */
  readonly ripVersion?: 1 | 2;
}

export interface Blueprint {
  readonly name: string;
  readonly devices: readonly DeviceIntent[];
  readonly links: readonly LinkIntent[];
  readonly lans: readonly LanIntent[];
  readonly routing: RoutingProtocol;
  readonly addressing: AddressingIntent;
  /**
   * Optional L2 plumbing. Recipes that don't care about VLANs simply omit it.
   * `cookBlueprint` runs the switching application after L3 addressing and
   * routing, so trunked VLANs already have routed gateways when traffic flows.
   */
  readonly switching?: SwitchingIntent;
  /**
   * Optional L3 services (ACLs, NAT, DHCP pools/relays, NTP, Syslog).
   * `cookBlueprint` applies them after switching is up so NAT/ACLs see the
   * final port roles, then `extraCli` gets the last word.
   */
  readonly services?: ServicesIntent;
  /**
   * Optional wireless configuration using PT's native WirelessServer /
   * WirelessClient process APIs.
   */
  readonly wireless?: WirelessIntent;
  /**
   * Optional VoIP configuration: CME (telephony-service) on a router plus
   * voice VLANs on access switches. Applied after services so DHCP option-150
   * is in place when phones come up.
   */
  readonly voip?: VoipIntent;
  /**
   * Optional advanced routing on top of the IGP selected by `routing`.
   * BGP runs as a router-level process; HSRP attaches to interfaces. Both
   * apply after addressing/IGP/switching/services so they see final port
   * roles and reachable peers.
   */
  readonly advancedRouting?: {
    readonly bgp?: readonly BgpIntent[];
    readonly hsrp?: readonly HsrpIntent[];
  };
  /**
   * Optional dual-stack IPv6 layer. The applier emits `ipv6 unicast-routing`,
   * per-interface IPv6 addresses (with optional OSPFv3 binding), OSPFv3
   * processes and static IPv6 routes — independent of the IPv4 `addressing`
   * recipe. Endpoint hosts get configured via `ipv6config`.
   */
  readonly ipv6?: Ipv6Intent;
  /**
   * Optional final CLI passes — one per device. Applied last, so they can
   * rely on every prior step (devices placed, links wired, IPs assigned,
   * routing/switching brought up).
   */
  readonly extraCli?: readonly DeviceCliIntent[];
}

export const DEFAULT_LAN_POOL = "192.168.0.0/16";
export const DEFAULT_TRANSIT_POOL = "10.0.0.0/16";

export function withDefaults(b: Blueprint): Blueprint {
  return {
    ...b,
    addressing: {
      lanPool: b.addressing.lanPool ?? DEFAULT_LAN_POOL,
      transitPool: b.addressing.transitPool ?? DEFAULT_TRANSIT_POOL,
      ...(b.addressing.ospfPid !== undefined ? { ospfPid: b.addressing.ospfPid } : {}),
      ...(b.addressing.eigrpAsn !== undefined ? { eigrpAsn: b.addressing.eigrpAsn } : {}),
      ...(b.addressing.ripVersion !== undefined ? { ripVersion: b.addressing.ripVersion } : {}),
    },
  };
}

/** Sanity check: device names referenced by links/lans must exist. */
export function validateBlueprintReferences(b: Blueprint): string[] {
  const errors: string[] = [];
  const names = new Set(b.devices.map(d => d.name));
  for (const lnk of b.links) {
    if (!names.has(lnk.aDevice)) errors.push(`link references unknown device '${lnk.aDevice}'`);
    if (!names.has(lnk.bDevice)) errors.push(`link references unknown device '${lnk.bDevice}'`);
  }
  for (const lan of b.lans) {
    if (!names.has(lan.gatewayDevice)) errors.push(`LAN gateway references unknown device '${lan.gatewayDevice}'`);
    for (const e of lan.endpoints) {
      if (!names.has(e)) errors.push(`LAN endpoint references unknown device '${e}'`);
    }
  }
  for (const bgp of b.advancedRouting?.bgp ?? []) {
    if (!names.has(bgp.device)) errors.push(`BGP intent references unknown device '${bgp.device}'`);
  }
  for (const hsrp of b.advancedRouting?.hsrp ?? []) {
    if (!names.has(hsrp.device)) errors.push(`HSRP intent references unknown device '${hsrp.device}'`);
  }
  for (const ap of b.wireless?.aps ?? []) {
    if (!names.has(ap.device)) errors.push(`wireless AP references unknown device '${ap.device}'`);
  }
  for (const client of b.wireless?.clients ?? []) {
    if (!names.has(client.device)) errors.push(`wireless client references unknown device '${client.device}'`);
  }
  for (const c of b.voip?.cme ?? []) {
    if (!names.has(c.device)) errors.push(`VoIP CME references unknown device '${c.device}'`);
  }
  for (const d of b.voip?.ephoneDns ?? []) {
    if (!names.has(d.device)) errors.push(`VoIP ephone-dn references unknown device '${d.device}'`);
  }
  for (const e of b.voip?.ephones ?? []) {
    if (!names.has(e.device)) errors.push(`VoIP ephone references unknown device '${e.device}'`);
  }
  for (const v of b.voip?.voiceVlans ?? []) {
    if (!names.has(v.switch)) errors.push(`VoIP voice-vlan references unknown switch '${v.switch}'`);
  }
  for (const i of b.ipv6?.interfaces ?? []) {
    if (!names.has(i.device)) errors.push(`IPv6 interface references unknown device '${i.device}'`);
  }
  for (const o of b.ipv6?.ospf ?? []) {
    if (!names.has(o.device)) errors.push(`IPv6 OSPF process references unknown device '${o.device}'`);
  }
  for (const s of b.ipv6?.staticRoutes ?? []) {
    if (!names.has(s.device)) errors.push(`IPv6 static route references unknown device '${s.device}'`);
  }
  for (const e of b.ipv6?.endpoints ?? []) {
    if (!names.has(e.device)) errors.push(`IPv6 endpoint references unknown device '${e.device}'`);
  }
  return errors;
}
