/**
 * Recipe registry — the public face of the recipes layer. Each entry is a
 * factory that turns a parameter object into a Blueprint, plus enough
 * metadata for the pt_list_recipes tool to render the catalog.
 */

import type { Blueprint } from "./blueprint.js";
import { chain, type ChainOptions } from "./topologies/chain.js";
import { star, type StarOptions } from "./topologies/star.js";
import { branchOffice, type BranchOptions } from "./topologies/branch_office.js";
import { campusVlan, type CampusVlanOptions } from "./topologies/campus_vlan.js";
import { edgeNat, type EdgeNatOptions } from "./topologies/edge_nat.js";
import { wifiLan, type WifiLanOptions } from "./topologies/wifi_lan.js";
import { dualIsp, type DualIspOptions } from "./topologies/dual_isp.js";
import { voipLab, type VoipLabOptions } from "./topologies/voip_lab.js";
import { ipv6Lab, type Ipv6LabOptions } from "./topologies/ipv6_lab.js";

export interface RecipeMeta {
  readonly key: string;
  readonly description: string;
  readonly paramHint: string;
}

export interface Recipe {
  readonly key: string;
  readonly meta: RecipeMeta;
  /** Runtime adapter — accepts loose params from a tool call and returns a Blueprint. */
  readonly build: (params: Record<string, unknown>) => Blueprint;
}

function asInt(v: unknown, name: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | undefined {
  if (v === undefined || v === null) {
    if (opts.required) throw new Error(`'${name}' is required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`'${name}' must be an integer (got ${typeof v})`);
  }
  if (opts.min !== undefined && v < opts.min) throw new Error(`'${name}' must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new Error(`'${name}' must be <= ${opts.max}`);
  return v;
}

function asString(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`'${name}' must be a string`);
  return v;
}

function asBool(v: unknown, name: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`'${name}' must be a boolean`);
  return v;
}

function asRouting(v: unknown): "none" | "static" | "ospf" | "rip" | "eigrp" | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "none" || v === "static" || v === "ospf" || v === "rip" || v === "eigrp") return v;
  throw new Error(`'routing' must be one of none|static|ospf|rip|eigrp`);
}

function buildChain(p: Record<string, unknown>): Blueprint {
  const opts: ChainOptions = {
    routers: asInt(p.routers, "routers", { min: 2, required: true })!,
    pcsPerLan: asInt(p.pcsPerLan, "pcsPerLan", { min: 0, required: true })!,
    ...(asString(p.routerModel, "routerModel") !== undefined ? { routerModel: asString(p.routerModel, "routerModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asRouting(p.routing) !== undefined ? { routing: asRouting(p.routing)! } : {}),
    ...(asBool(p.dhcp, "dhcp") !== undefined ? { dhcp: asBool(p.dhcp, "dhcp")! } : {}),
  };
  return chain(opts);
}

function buildStar(p: Record<string, unknown>): Blueprint {
  const opts: StarOptions = {
    spokes: asInt(p.spokes, "spokes", { min: 1, required: true })!,
    pcsPerSpoke: asInt(p.pcsPerSpoke, "pcsPerSpoke", { min: 0, required: true })!,
    ...(asString(p.hubModel, "hubModel") !== undefined ? { hubModel: asString(p.hubModel, "hubModel")! } : {}),
    ...(asString(p.spokeModel, "spokeModel") !== undefined ? { spokeModel: asString(p.spokeModel, "spokeModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asRouting(p.routing) !== undefined ? { routing: asRouting(p.routing)! } : {}),
    ...(asBool(p.dhcp, "dhcp") !== undefined ? { dhcp: asBool(p.dhcp, "dhcp")! } : {}),
  };
  return star(opts);
}

function buildCampusVlan(p: Record<string, unknown>): Blueprint {
  const opts: CampusVlanOptions = {
    vlans: asInt(p.vlans, "vlans", { min: 1, max: 16, required: true })!,
    pcsPerVlan: asInt(p.pcsPerVlan, "pcsPerVlan", { min: 0, required: true })!,
    ...(asInt(p.startVlanId, "startVlanId", { min: 2, max: 4094 }) !== undefined
      ? { startVlanId: asInt(p.startVlanId, "startVlanId", { min: 2, max: 4094 })! }
      : {}),
    ...(asInt(p.vlanStep, "vlanStep", { min: 1 }) !== undefined
      ? { vlanStep: asInt(p.vlanStep, "vlanStep", { min: 1 })! }
      : {}),
    ...(asString(p.routerModel, "routerModel") !== undefined ? { routerModel: asString(p.routerModel, "routerModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
    ...(asRouting(p.routing) !== undefined ? { routing: asRouting(p.routing)! } : {}),
  };
  return campusVlan(opts);
}

function buildEdgeNat(p: Record<string, unknown>): Blueprint {
  const opts: EdgeNatOptions = {
    pcs: asInt(p.pcs, "pcs", { min: 1, max: 22, required: true })!,
    ...(asString(p.edgeModel, "edgeModel") !== undefined ? { edgeModel: asString(p.edgeModel, "edgeModel")! } : {}),
    ...(asString(p.ispModel, "ispModel") !== undefined ? { ispModel: asString(p.ispModel, "ispModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
    ...(asString(p.transitPool, "transitPool") !== undefined ? { transitPool: asString(p.transitPool, "transitPool")! } : {}),
    ...(asBool(p.withTelemetry, "withTelemetry") !== undefined ? { withTelemetry: asBool(p.withTelemetry, "withTelemetry")! } : {}),
  };
  return edgeNat(opts);
}

function asWirelessSecurity(v: unknown): "open" | "wpa2-psk" | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "open" || v === "wpa2-psk") return v;
  throw new Error("'security' must be one of open|wpa2-psk");
}

function buildWifiLan(p: Record<string, unknown>): Blueprint {
  const opts: WifiLanOptions = {
    clients: asInt(p.clients, "clients", { min: 1, max: 12, required: true })!,
    ...(asString(p.ssid, "ssid") !== undefined ? { ssid: asString(p.ssid, "ssid")! } : {}),
    ...(asWirelessSecurity(p.security) !== undefined ? { security: asWirelessSecurity(p.security)! } : {}),
    ...(asString(p.psk, "psk") !== undefined ? { psk: asString(p.psk, "psk")! } : {}),
    ...(asInt(p.channel, "channel", { min: 1, max: 11 }) !== undefined ? { channel: asInt(p.channel, "channel", { min: 1, max: 11 })! } : {}),
    ...(asString(p.routerModel, "routerModel") !== undefined ? { routerModel: asString(p.routerModel, "routerModel")! } : {}),
    ...(asString(p.apModel, "apModel") !== undefined ? { apModel: asString(p.apModel, "apModel")! } : {}),
    ...(asString(p.clientModel, "clientModel") !== undefined ? { clientModel: asString(p.clientModel, "clientModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
  };
  return wifiLan(opts);
}

function buildVoipLab(p: Record<string, unknown>): Blueprint {
  const opts: VoipLabOptions = {
    phones: asInt(p.phones, "phones", { min: 1, max: 6, required: true })!,
    ...(asString(p.routerModel, "routerModel") !== undefined ? { routerModel: asString(p.routerModel, "routerModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
    ...(asInt(p.voiceVlanId, "voiceVlanId", { min: 1, max: 4094 }) !== undefined ? { voiceVlanId: asInt(p.voiceVlanId, "voiceVlanId", { min: 1, max: 4094 })! } : {}),
    ...(asInt(p.dataVlanId, "dataVlanId", { min: 1, max: 4094 }) !== undefined ? { dataVlanId: asInt(p.dataVlanId, "dataVlanId", { min: 1, max: 4094 })! } : {}),
    ...(asInt(p.startingExtension, "startingExtension", { min: 1 }) !== undefined ? { startingExtension: asInt(p.startingExtension, "startingExtension", { min: 1 })! } : {}),
    ...(asInt(p.sourcePort, "sourcePort", { min: 1, max: 65535 }) !== undefined ? { sourcePort: asInt(p.sourcePort, "sourcePort", { min: 1, max: 65535 })! } : {}),
  };
  return voipLab(opts);
}

function buildIpv6Lab(p: Record<string, unknown>): Blueprint {
  const opts: Ipv6LabOptions = {
    ...(asString(p.routerModel, "routerModel") !== undefined ? { routerModel: asString(p.routerModel, "routerModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
    ...(asInt(p.ospfPid, "ospfPid", { min: 1, max: 65535 }) !== undefined ? { ospfPid: asInt(p.ospfPid, "ospfPid", { min: 1, max: 65535 })! } : {}),
    ...(asBool(p.enableOspf, "enableOspf") !== undefined ? { enableOspf: asBool(p.enableOspf, "enableOspf")! } : {}),
  };
  return ipv6Lab(opts);
}

function buildDualIsp(p: Record<string, unknown>): Blueprint {
  const opts: DualIspOptions = {
    pcs: asInt(p.pcs, "pcs", { min: 1, max: 6, required: true })!,
    ...(asString(p.edgeModel, "edgeModel") !== undefined ? { edgeModel: asString(p.edgeModel, "edgeModel")! } : {}),
    ...(asString(p.ispModel, "ispModel") !== undefined ? { ispModel: asString(p.ispModel, "ispModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asString(p.lanPool, "lanPool") !== undefined ? { lanPool: asString(p.lanPool, "lanPool")! } : {}),
    ...(asString(p.transitPool, "transitPool") !== undefined ? { transitPool: asString(p.transitPool, "transitPool")! } : {}),
  };
  return dualIsp(opts);
}

function buildBranch(p: Record<string, unknown>): Blueprint {
  const hqLans = asInt(p.hqLans, "hqLans", { min: 1, max: 2 });
  const opts: BranchOptions = {
    pcsPerLan: asInt(p.pcsPerLan, "pcsPerLan", { min: 0, required: true })!,
    ...(hqLans !== undefined ? { hqLans: hqLans as 1 | 2 } : {}),
    ...(asString(p.hqModel, "hqModel") !== undefined ? { hqModel: asString(p.hqModel, "hqModel")! } : {}),
    ...(asString(p.branchModel, "branchModel") !== undefined ? { branchModel: asString(p.branchModel, "branchModel")! } : {}),
    ...(asString(p.switchModel, "switchModel") !== undefined ? { switchModel: asString(p.switchModel, "switchModel")! } : {}),
    ...(asString(p.pcModel, "pcModel") !== undefined ? { pcModel: asString(p.pcModel, "pcModel")! } : {}),
    ...(asRouting(p.routing) !== undefined ? { routing: asRouting(p.routing)! } : {}),
    ...(asBool(p.dhcp, "dhcp") !== undefined ? { dhcp: asBool(p.dhcp, "dhcp")! } : {}),
  };
  return branchOffice(opts);
}

export const RECIPES: readonly Recipe[] = [
  {
    key: "chain",
    meta: {
      key: "chain",
      description: "N routers in series; each carries a switch-backed LAN of M PCs.",
      paramHint: "{ routers: number, pcsPerLan: number, routing?, dhcp? }",
    },
    build: buildChain,
  },
  {
    key: "star",
    meta: {
      key: "star",
      description: "Hub router with N spoke routers; each spoke owns a LAN.",
      paramHint: "{ spokes: number, pcsPerSpoke: number, routing?, dhcp? }",
    },
    build: buildStar,
  },
  {
    key: "branch_office",
    meta: {
      key: "branch_office",
      description: "HQ router with one or two LANs + remote branch router with its own LAN.",
      paramHint: "{ hqLans?: 1|2, pcsPerLan: number, routing?, dhcp? }",
    },
    build: buildBranch,
  },
  {
    key: "campus_vlan",
    meta: {
      key: "campus_vlan",
      description: "Router-on-a-stick: one router + one access switch with N VLANs and M PCs per VLAN.",
      paramHint: "{ vlans: number, pcsPerVlan: number, startVlanId?, vlanStep?, lanPool?, routing? }",
    },
    build: buildCampusVlan,
  },
  {
    key: "edge_nat",
    meta: {
      key: "edge_nat",
      description: "Edge router doing PAT for an inside LAN; ISP upstream + DHCP pool + ACL + optional NTP/Syslog.",
      paramHint: "{ pcs: number, lanPool?, transitPool?, withTelemetry? }",
    },
    build: buildEdgeNat,
  },
  {
    key: "wifi_lan",
    meta: {
      key: "wifi_lan",
      description: "Router + AccessPoint-PT + wireless Laptop-PT clients with SSID/WPA2-PSK and DHCP.",
      paramHint: "{ clients: number, ssid?, security?, psk?, channel?, lanPool? }",
    },
    build: buildWifiLan,
  },
  {
    key: "voip_lab",
    meta: {
      key: "voip_lab",
      description: "CME router + access switch + N IP Phones (7960). Provisions telephony-service, ephone-dn extensions, voice VLAN trunking and DHCP option-150.",
      paramHint: "{ phones: 1..6, voiceVlanId?, dataVlanId?, startingExtension?, lanPool? }",
    },
    build: buildVoipLab,
  },
  {
    key: "ipv6_lab",
    meta: {
      key: "ipv6_lab",
      description: "Dual-stack IPv6 lab: 2 routers (chain) + 1 PC per LAN, OSPFv3 over the transit link, link-local enabled.",
      paramHint: "{ routerModel?, switchModel?, lanPool?, ospfPid?, enableOspf? }",
    },
    build: buildIpv6Lab,
  },
  {
    key: "dual_isp",
    meta: {
      key: "dual_isp",
      description: "Two edge routers eBGP-peering with a shared ISP and HSRP-sharing the inside-LAN gateway; PCs get DHCP from EDGE1.",
      paramHint: "{ pcs: number, lanPool?, transitPool? }",
    },
    build: buildDualIsp,
  },
];

export function findRecipe(key: string): Recipe | undefined {
  return RECIPES.find(r => r.key === key);
}
