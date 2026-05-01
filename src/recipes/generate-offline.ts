/**
 * Offline config generator. Given a Blueprint, synthesises the IOS CLI that
 * the live `cookBlueprint` pipeline would push to each device — without
 * touching the bridge or the canvas. Returns one wrapped config block per
 * device plus human-readable notes for endpoints (PCs, APs, phones) that
 * don't accept IOS CLI.
 *
 * Use case: documentation, classroom material, replicating the lab on real
 * hardware. NOT a replacement for `pt_cook_topology` — the live pipeline
 * remains canvas-first and idempotent against partial state. This is a
 * deterministic projection of the blueprint into text.
 */

import type { DeviceModel } from "../catalog/devices.js";
import { resolveModel } from "../catalog/devices.js";
import {
  SubnetIterator,
  parseCidr,
  prefixToMask,
  prefixToWildcard,
  subnetHosts,
  type Ipv4Subnet,
} from "../canvas/subnetting.js";
import { wrapInConfig } from "../ipc/cli-prologue.js";
import {
  validateBlueprintReferences,
  withDefaults,
  type Blueprint,
  type LanIntent,
  type LinkIntent,
} from "./blueprint.js";
import {
  ipv6InterfaceCli,
  ipv6OspfCli,
  ipv6StaticRouteCli,
  unicastRoutingCli,
} from "./ipv6/cli.js";
import {
  aclCli,
  dhcpPoolCli,
  dhcpRelayCli,
  natCli,
  ntpCli,
  syslogCli,
} from "./services/cli.js";
import {
  accessPortCli,
  etherChannelCli,
  portSecurityCli,
  trunkPortCli,
  vlanCreateCli,
} from "./switching/cli.js";
import { cmeCli, ephoneCli, ephoneDnCli, voiceVlanCli } from "./voip/cli.js";
import { bgpCli } from "./routing/bgp.js";
import { hsrpCli } from "./routing/hsrp.js";

export interface DeviceConfig {
  readonly device: string;
  readonly model: string;
  readonly category: string;
  /** Wrapped IOS config (`enable / configure terminal / … / end`) or empty. */
  readonly config: string;
  /** Free-form notes for non-IOS devices (endpoints, APs). */
  readonly notes: readonly string[];
}

export interface GenerateConfigsResult {
  readonly blueprint: string;
  readonly devices: readonly DeviceConfig[];
  readonly allocations: {
    readonly transit: ReadonlyMap<string, string>;
    readonly lans: ReadonlyMap<string, string>;
  };
  readonly warnings: readonly string[];
}

interface AddressedPort {
  readonly device: string;
  readonly port: string;
  readonly ip: string;
  readonly prefix: number;
  readonly network: string;
  readonly isTransit: boolean;
  /** Other endpoint of this transit link (for static routing BFS). */
  readonly peerDevice?: string;
  readonly peerIp?: string;
}

export function generateConfigs(rawBlueprint: Blueprint): GenerateConfigsResult {
  const refs = validateBlueprintReferences(rawBlueprint);
  if (refs.length > 0) {
    throw new Error(`blueprint has invalid references:\n  - ${refs.join("\n  - ")}`);
  }
  const b = withDefaults(rawBlueprint);

  const warnings: string[] = [];
  const modelByDevice = new Map<string, DeviceModel | undefined>();
  for (const d of b.devices) {
    const m = resolveModel(d.model);
    if (!m) warnings.push(`unknown model '${d.model}' for device '${d.name}'`);
    modelByDevice.set(d.name, m);
  }
  const categoryOf = (name: string): string => modelByDevice.get(name)?.category ?? "unknown";
  const isRouter = (name: string): boolean => categoryOf(name) === "router";

  const transitIter = new SubnetIterator(b.addressing.transitPool!, 30);
  const lanIter = new SubnetIterator(b.addressing.lanPool!, 24);

  const transitAlloc = new Map<string, string>();
  const lanAlloc = new Map<string, string>();
  const portsByDevice = new Map<string, AddressedPort[]>();
  const cliByDevice = new Map<string, string[]>();
  const notesByDevice = new Map<string, string[]>();

  const addCli = (device: string, line: string): void => {
    const arr = cliByDevice.get(device) ?? [];
    arr.push(line);
    cliByDevice.set(device, arr);
  };
  const addNote = (device: string, note: string): void => {
    const arr = notesByDevice.get(device) ?? [];
    arr.push(note);
    notesByDevice.set(device, arr);
  };
  const recordPort = (p: AddressedPort): void => {
    const arr = portsByDevice.get(p.device) ?? [];
    arr.push(p);
    portsByDevice.set(p.device, arr);
  };

  // 1) Transit /30s for router-router links.
  for (const lnk of b.links) {
    if (!isRouter(lnk.aDevice) || !isRouter(lnk.bDevice)) continue;
    const sub = transitIter.next();
    const [hostA, hostB] = subnetHosts(sub);
    if (!hostA || !hostB) continue;
    const mask = prefixToMask(sub.prefix);
    transitAlloc.set(`${lnk.aDevice}/${lnk.aPort}--${lnk.bDevice}/${lnk.bPort}`, `${sub.network}/${sub.prefix}`);

    addCli(lnk.aDevice, `interface ${lnk.aPort}\n ip address ${hostA} ${mask}\n no shutdown\n exit`);
    addCli(lnk.bDevice, `interface ${lnk.bPort}\n ip address ${hostB} ${mask}\n no shutdown\n exit`);
    recordPort({ device: lnk.aDevice, port: lnk.aPort, ip: hostA, prefix: sub.prefix, network: sub.network, isTransit: true, peerDevice: lnk.bDevice, peerIp: hostB });
    recordPort({ device: lnk.bDevice, port: lnk.bPort, ip: hostB, prefix: sub.prefix, network: sub.network, isTransit: true, peerDevice: lnk.aDevice, peerIp: hostA });
  }

  // 2) LAN /24s. Gateway gets host[0]; endpoints either DHCP or sequential.
  for (const lan of b.lans) {
    const subnet: Ipv4Subnet = lan.cidr ? parseCidr(lan.cidr) : lanIter.next();
    const hosts = subnetHosts(subnet);
    const gateway = hosts[0];
    if (!gateway) continue;
    const mask = prefixToMask(subnet.prefix);
    lanAlloc.set(`${lan.gatewayDevice}/${lan.gatewayPort}`, `${subnet.network}/${subnet.prefix}`);

    const gwModel = modelByDevice.get(lan.gatewayDevice);
    const gwHasPort = gwModel?.ports.find(p => p.fullName === lan.gatewayPort);
    if (gwHasPort) {
      const gwLines = [
        `interface ${lan.gatewayPort}`,
        ` ip address ${gateway} ${mask}`,
        " no shutdown",
        " exit",
      ];
      if (lan.dhcp) {
        const poolName = `LAN_${lan.gatewayDevice}_${lan.gatewayPort.replace(/\W+/g, "")}`;
        const exclEnd = hosts[Math.min(hosts.length, 5) - 1] ?? gateway;
        gwLines.push(
          `ip dhcp pool ${poolName}`,
          ` network ${subnet.network} ${mask}`,
          ` default-router ${gateway}`,
          " exit",
          `ip dhcp excluded-address ${gateway} ${exclEnd}`,
        );
      }
      addCli(lan.gatewayDevice, gwLines.join("\n"));
      recordPort({ device: lan.gatewayDevice, port: lan.gatewayPort, ip: gateway, prefix: subnet.prefix, network: subnet.network, isTransit: false });
    } else {
      // Externally managed gateway (subinterfaces handled via extraCli).
      warnings.push(`gateway ${lan.gatewayDevice}/${lan.gatewayPort} not in catalog ports — assuming externally managed (subinterface, etc.)`);
    }

    // Endpoints inside this LAN.
    let cursor = lan.dhcp ? hosts.length : 1;
    for (const epName of lan.endpoints) {
      if (lan.dhcp) {
        addNote(epName, `LAN ${subnet.network}/${subnet.prefix}: DHCP from ${gateway}`);
        continue;
      }
      const host = hosts[cursor];
      if (!host) {
        addNote(epName, `LAN ${subnet.network}/${subnet.prefix}: subnet exhausted`);
        continue;
      }
      cursor++;
      addNote(epName, `LAN ${subnet.network}/${subnet.prefix}: static ip=${host} mask=${mask} gateway=${gateway}`);
    }
  }

  // 3) Routing.
  emitRouting(b, portsByDevice, addCli);

  // 4) Switching (per device).
  if (b.switching) {
    const s = b.switching;
    const grouped = new Map<string, string[]>();
    const push = (dev: string, line: string): void => {
      const arr = grouped.get(dev) ?? [];
      arr.push(line);
      grouped.set(dev, arr);
    };
    for (const v of s.vlans ?? []) {
      push(v.switch, vlanCreateCli(v));
      for (const port of v.accessPorts ?? []) push(v.switch, accessPortCli(port, v.id));
    }
    for (const t of s.trunks ?? []) push(t.switch, trunkPortCli(t));
    for (const ps of s.portSecurity ?? []) push(ps.switch, portSecurityCli(ps));
    for (const ec of s.etherChannels ?? []) push(ec.switch, etherChannelCli(ec));
    for (const [dev, lines] of grouped) {
      for (const ln of lines) addCli(dev, ln);
    }
  }

  // 5) Services (per device).
  if (b.services) {
    for (const a of b.services.acls ?? []) addCli(a.device, aclCli(a));
    for (const n of b.services.nat ?? []) addCli(n.device, natCli(n));
    for (const p of b.services.dhcpPools ?? []) addCli(p.device, dhcpPoolCli(p));
    for (const r of b.services.dhcpRelays ?? []) addCli(r.device, dhcpRelayCli(r));
    for (const n of b.services.ntp ?? []) addCli(n.device, ntpCli(n));
    for (const sl of b.services.syslog ?? []) addCli(sl.device, syslogCli(sl));
  }

  // 6) VoIP.
  if (b.voip) {
    for (const c of b.voip.cme ?? []) addCli(c.device, cmeCli(c));
    for (const d of b.voip.ephoneDns ?? []) addCli(d.device, ephoneDnCli(d));
    for (const e of b.voip.ephones ?? []) addCli(e.device, ephoneCli(e));
    for (const v of b.voip.voiceVlans ?? []) addCli(v.switch, voiceVlanCli(v));
  }

  // 7) IPv6.
  if (b.ipv6) {
    const grouped = new Map<string, string[]>();
    const push = (dev: string, line: string): void => {
      const arr = grouped.get(dev) ?? [];
      arr.push(line);
      grouped.set(dev, arr);
    };
    const routerSet = new Set<string>();
    for (const i of b.ipv6.interfaces ?? []) {
      if (isRouter(i.device)) routerSet.add(i.device);
    }
    for (const o of b.ipv6.ospf ?? []) {
      routerSet.add(o.device);
      push(o.device, ipv6OspfCli(o));
    }
    for (const dev of routerSet) push(dev, unicastRoutingCli());
    for (const i of b.ipv6.interfaces ?? []) push(i.device, ipv6InterfaceCli(i));
    for (const s of b.ipv6.staticRoutes ?? []) push(s.device, ipv6StaticRouteCli(s));
    for (const e of b.ipv6.endpoints ?? []) {
      addNote(e.device, `IPv6 ${e.address}${e.gateway ? ` gateway ${e.gateway}` : ""}`);
    }
    // Reorder so unicast-routing comes first per device.
    for (const [dev, lines] of grouped) {
      const ordered = [
        ...lines.filter(l => l.startsWith("ipv6 unicast-routing")),
        ...lines.filter(l => l.startsWith("ipv6 router ospf")),
        ...lines.filter(l => l.startsWith("interface")),
        ...lines.filter(l => l.startsWith("ipv6 route ")),
      ];
      for (const ln of ordered) addCli(dev, ln);
    }
  }

  // 8) Wireless — IPC-only (no IOS CLI), emit notes.
  if (b.wireless) {
    for (const ap of b.wireless.aps ?? []) {
      const security = ap.security === "wpa2-psk" ? `WPA2-PSK psk=${ap.psk ?? "<missing>"}` : "open";
      const extras: string[] = [];
      if (ap.channel !== undefined) extras.push(`channel=${ap.channel}`);
      if (ap.vlanId !== undefined) extras.push(`vlan=${ap.vlanId}`);
      addNote(ap.device, `AP SSID=${ap.ssid} security=${security}${extras.length ? ` (${extras.join(" ")})` : ""}`);
    }
    for (const cl of b.wireless.clients ?? []) {
      addNote(cl.device, `wireless client SSID=${cl.ssid}${cl.dhcp === false ? " (static)" : " (DHCP)"}`);
    }
  }

  // 9) Advanced routing — reuse the same pure CLI builders the live appliers use.
  for (const bgp of b.advancedRouting?.bgp ?? []) addCli(bgp.device, bgpCli(bgp));
  for (const hsrp of b.advancedRouting?.hsrp ?? []) addCli(hsrp.device, hsrpCli(hsrp));

  // 10) extraCli — appended verbatim at the end (matches cook order).
  for (const block of b.extraCli ?? []) addCli(block.device, block.commands);

  // Compose final per-device output.
  const devices: DeviceConfig[] = [];
  for (const d of b.devices) {
    const lines = cliByDevice.get(d.name) ?? [];
    const notes = notesByDevice.get(d.name) ?? [];
    const wrapped = lines.length > 0 ? wrapInConfig(lines.join("\n")) : "";
    devices.push({
      device: d.name,
      model: d.model,
      category: categoryOf(d.name),
      config: wrapped,
      notes,
    });
  }

  return {
    blueprint: b.name,
    devices,
    allocations: { transit: transitAlloc, lans: lanAlloc },
    warnings,
  };
}

function emitRouting(
  b: Blueprint,
  portsByDevice: Map<string, AddressedPort[]>,
  addCli: (device: string, line: string) => void,
): void {
  if (b.routing === "none") return;

  const routerNames = b.devices
    .filter(d => resolveModel(d.model)?.category === "router")
    .map(d => d.name)
    .filter(name => (portsByDevice.get(name)?.length ?? 0) > 0);

  if (b.routing === "ospf") {
    const pid = b.addressing.ospfPid ?? 1;
    for (const dev of routerNames) {
      const ports = portsByDevice.get(dev) ?? [];
      if (ports.length === 0) continue;
      const lines = [`router ospf ${pid}`];
      const seen = new Set<string>();
      for (const p of ports) {
        const key = `${p.network}/${p.prefix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(` network ${p.network} ${prefixToWildcard(p.prefix)} area 0`);
      }
      lines.push(" exit");
      addCli(dev, lines.join("\n"));
    }
    return;
  }

  if (b.routing === "eigrp") {
    const asn = b.addressing.eigrpAsn ?? 1;
    for (const dev of routerNames) {
      const ports = portsByDevice.get(dev) ?? [];
      if (ports.length === 0) continue;
      const lines = [`router eigrp ${asn}`, " no auto-summary"];
      const seen = new Set<string>();
      for (const p of ports) {
        const key = `${p.network}/${p.prefix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(` network ${p.network} ${prefixToWildcard(p.prefix)}`);
      }
      lines.push(" exit");
      addCli(dev, lines.join("\n"));
    }
    return;
  }

  if (b.routing === "rip") {
    const version = b.addressing.ripVersion ?? 2;
    for (const dev of routerNames) {
      const ports = portsByDevice.get(dev) ?? [];
      if (ports.length === 0) continue;
      const lines = ["router rip", ` version ${version}`, " no auto-summary"];
      const classfulSeen = new Set<string>();
      for (const p of ports) {
        const classful = classfulNetwork(p.network);
        if (classfulSeen.has(classful)) continue;
        classfulSeen.add(classful);
        lines.push(` network ${classful}`);
      }
      lines.push(" exit");
      addCli(dev, lines.join("\n"));
    }
    return;
  }

  if (b.routing === "static") {
    emitStaticRoutes(routerNames, portsByDevice, addCli);
    return;
  }
}

/**
 * BFS-based static routing. For every router pair (src, dst), install a route
 * to each of dst's LANs and transit /30s through the first-hop neighbour.
 * Mirrors the live `applyStaticRouting` logic but consumes the offline
 * port allocations rather than a snapshot.
 */
function emitStaticRoutes(
  routerNames: readonly string[],
  portsByDevice: Map<string, AddressedPort[]>,
  addCli: (device: string, line: string) => void,
): void {
  // Adjacency: device -> [{ neighbour, nextHopIp }]
  const adj = new Map<string, { neighbour: string; nextHopIp: string }[]>();
  for (const dev of routerNames) adj.set(dev, []);
  for (const dev of routerNames) {
    for (const p of portsByDevice.get(dev) ?? []) {
      if (!p.isTransit || !p.peerDevice || !p.peerIp) continue;
      adj.get(dev)!.push({ neighbour: p.peerDevice, nextHopIp: p.peerIp });
    }
  }

  for (const src of routerNames) {
    const firstHop = new Map<string, string>(); // dest router -> nextHopIp
    const queue: string[] = [src];
    const seen = new Set<string>([src]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of adj.get(cur) ?? []) {
        if (seen.has(e.neighbour)) continue;
        seen.add(e.neighbour);
        firstHop.set(e.neighbour, cur === src ? e.nextHopIp : firstHop.get(cur)!);
        queue.push(e.neighbour);
      }
    }

    // Networks `src` is already directly attached to — never install a static
    // route towards them, the connected route already wins.
    const ownNetworks = new Set(
      (portsByDevice.get(src) ?? []).map(p => `${p.network}/${p.prefix}`),
    );
    const lines: string[] = [];
    for (const [other, nextHopIp] of firstHop) {
      const otherPorts = portsByDevice.get(other) ?? [];
      const seenNets = new Set<string>();
      for (const p of otherPorts) {
        const key = `${p.network}/${p.prefix}`;
        if (seenNets.has(key)) continue;
        seenNets.add(key);
        if (ownNetworks.has(key)) continue;
        lines.push(`ip route ${p.network} ${prefixToMask(p.prefix)} ${nextHopIp}`);
      }
    }
    if (lines.length > 0) addCli(src, lines.join("\n"));
  }
}

function classfulNetwork(network: string): string {
  const first = Number(network.split(".")[0] ?? "0");
  if (first < 128) return `${network.split(".")[0]}.0.0.0`;
  if (first < 192) return `${network.split(".").slice(0, 2).join(".")}.0.0`;
  return `${network.split(".").slice(0, 3).join(".")}.0`;
}

export function summarizeGenerateConfigs(r: GenerateConfigsResult): string {
  const lines: string[] = [`Configs for blueprint '${r.blueprint}':`];
  const withCli = r.devices.filter(d => d.config.length > 0).length;
  const withNotes = r.devices.filter(d => d.notes.length > 0).length;
  lines.push(`  devices total:    ${r.devices.length}`);
  lines.push(`  with IOS config:  ${withCli}`);
  lines.push(`  with notes only:  ${withNotes}`);
  if (r.allocations.transit.size > 0) {
    lines.push("", "Transit allocations:");
    for (const [k, cidr] of r.allocations.transit) lines.push(`  ${k} -> ${cidr}`);
  }
  if (r.allocations.lans.size > 0) {
    lines.push("", "LAN allocations:");
    for (const [k, cidr] of r.allocations.lans) lines.push(`  ${k} -> ${cidr}`);
  }
  if (r.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const w of r.warnings) lines.push(`  ! ${w}`);
  }
  lines.push("", "Per-device output (use the structured response for the full text):");
  for (const d of r.devices) {
    const head = `  - ${d.device} [${d.category}/${d.model}]`;
    if (d.config.length > 0) {
      const ioslines = d.config.split("\n").length;
      lines.push(`${head}: ${ioslines} IOS line(s)${d.notes.length ? `, ${d.notes.length} note(s)` : ""}`);
    } else if (d.notes.length > 0) {
      lines.push(`${head}: ${d.notes.length} note(s) (non-IOS)`);
    } else {
      lines.push(`${head}: (nothing to configure)`);
    }
  }
  return lines.join("\n");
}
