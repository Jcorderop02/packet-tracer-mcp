import { runCliScript } from "../ipc/reliable-cli.js";
/**
 * "Cook" a blueprint into the live canvas. The recipe walks the blueprint and
 * synthesises bridge operations in this order:
 *
 *   1) place every declared device that is not already on the canvas
 *   2) wire every declared link whose endpoints are not already linked
 *   3) hand off to the addressing recipe to assign IPs
 *   4) hand off to the routing recipe matching blueprint.routing
 *
 * Each step queries a fresh snapshot before acting, so re-running cook against
 * a partially built canvas is well-defined: it picks up where it left off.
 */

import type { Bridge } from "../bridge/http-bridge.js";
import { resolveModel } from "../catalog/devices.js";
import { captureSnapshot } from "../canvas/snapshot.js";
import {
  type CanvasSnapshot,
  type LinkObservation,
  linkKey,
} from "../canvas/types.js";
import {
  addDeviceJs,
  createLinkJs,
  saveRunningConfigJs,
} from "../ipc/generator.js";
import { wrapInConfig } from "../ipc/cli-prologue.js";
import { waitForClisReady } from "../ipc/cli-wait.js";
import {
  validateBlueprintReferences,
  withDefaults,
  type Blueprint,
} from "./blueprint.js";
import { applyAddressing, type AddressingReport } from "./addressing.js";
import { applyBgp, type BgpReport } from "./routing/bgp.js";
import { applyHsrp, type HsrpReport } from "./routing/hsrp.js";
import { applyOspf, type OspfReport } from "./routing/ospf.js";
import { applyEigrp, type EigrpReport } from "./routing/eigrp.js";
import { applyRip, type RipReport } from "./routing/rip.js";
import { applyStaticRouting, type StaticRoutingReport } from "./routing/static.js";
import { applySwitching, type SwitchingReport } from "./switching/apply.js";
import { applyServices, type ServicesReport } from "./services/apply.js";
import type { ServicesIntent } from "./services/intents.js";
import { applyWireless, validateWirelessAssociations, type WirelessReport } from "./wireless/apply.js";
import type { WirelessIntent } from "./wireless/intents.js";
import { applyVoip, type VoipReport } from "./voip/apply.js";
import type { VoipIntent } from "./voip/intents.js";
import { applyIpv6, type Ipv6Report } from "./ipv6/apply.js";
import type { Ipv6Intent } from "./ipv6/intents.js";

interface ExtraCliReport {
  readonly device: string;
  readonly label?: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface CookReport {
  readonly blueprint: string;
  readonly placedDevices: readonly string[];
  readonly skippedDevices: readonly { readonly name: string; readonly reason: string }[];
  readonly placedLinks: readonly string[];
  readonly skippedLinks: readonly { readonly link: string; readonly reason: string }[];
  readonly addressing: AddressingReport;
  readonly routing:
    | { kind: "static"; report: StaticRoutingReport }
    | { kind: "ospf"; report: OspfReport }
    | { kind: "eigrp"; report: EigrpReport }
    | { kind: "rip"; report: RipReport }
    | { kind: "none" };
  readonly switching?: SwitchingReport;
  readonly services?: ServicesReport;
  readonly wireless?: WirelessReport;
  readonly voip?: VoipReport;
  readonly bgp?: BgpReport;
  readonly hsrp?: HsrpReport;
  readonly ipv6?: Ipv6Report;
  readonly extraCli?: readonly ExtraCliReport[];
}

export async function cookBlueprint(bridge: Bridge, raw: Blueprint): Promise<CookReport> {
  const refs = validateBlueprintReferences(raw);
  if (refs.length > 0) throw new Error(`blueprint has invalid references:\n  - ${refs.join("\n  - ")}`);
  const blueprint = withDefaults(raw);
  if (blueprint.wireless) validateWirelessAssociations(blueprint.wireless);

  let snap = await captureSnapshot(bridge);
  const placedDevices: string[] = [];
  const skippedDevices: { name: string; reason: string }[] = [];
  for (const dev of blueprint.devices) {
    if (snap.devices.find(d => d.name === dev.name)) {
      skippedDevices.push({ name: dev.name, reason: "already on canvas" });
      continue;
    }
    const resolved = resolveModel(dev.model);
    if (!resolved) {
      skippedDevices.push({ name: dev.name, reason: `unknown model '${dev.model}'` });
      continue;
    }
    const reply = await bridge.sendAndWait(
      addDeviceJs({ name: dev.name, category: resolved.category, model: resolved.ptType, x: dev.x, y: dev.y }),
      { timeoutMs: 15_000 },
    );
    if (reply === null) throw new Error(`addDevice for ${dev.name} timed out`);
    if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
      skippedDevices.push({ name: dev.name, reason: reply });
      continue;
    }
    placedDevices.push(dev.name);
  }

  const cliDevices = blueprint.devices.filter(dev => {
    const category = resolveModel(dev.model)?.category;
    return (category === "router" || category === "switch") &&
      (placedDevices.includes(dev.name) || snap.devices.some(d => d.name === dev.name));
  });
  await waitForClisReady(bridge, cliDevices.map(dev => dev.name));

  // Refresh snapshot before wiring so the link-presence test is accurate.
  snap = await captureSnapshot(bridge);
  const existingLinks = new Set(snap.links.map(linkKey));
  const placedLinks: string[] = [];
  const skippedLinks: { link: string; reason: string }[] = [];

  for (const lnk of blueprint.links) {
    const candidate: LinkObservation = {
      aDevice: lnk.aDevice,
      aPort: lnk.aPort,
      bDevice: lnk.bDevice,
      bPort: lnk.bPort,
    };
    const key = linkKey(candidate);
    const tag = `${lnk.aDevice}/${lnk.aPort} <-> ${lnk.bDevice}/${lnk.bPort}`;
    if (existingLinks.has(key)) {
      skippedLinks.push({ link: tag, reason: "already wired" });
      continue;
    }
    if (!snap.devices.find(d => d.name === lnk.aDevice) || !snap.devices.find(d => d.name === lnk.bDevice)) {
      skippedLinks.push({ link: tag, reason: "endpoint missing on canvas" });
      continue;
    }
    const reply = await bridge.sendAndWait(
      createLinkJs({
        deviceA: lnk.aDevice,
        portA: lnk.aPort,
        deviceB: lnk.bDevice,
        portB: lnk.bPort,
        cable: lnk.cable,
      }),
      { timeoutMs: 15_000 },
    );
    if (reply === null) throw new Error(`createLink for ${tag} timed out`);
    if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
      throw new Error(`createLink for ${tag} failed: ${reply}`);
    }
    placedLinks.push(tag);
    existingLinks.add(key);
  }

  const wiredSnapshot = await waitForBlueprintLinks(bridge, blueprint.links);
  const addressing = await applyAddressing(bridge, blueprint, wiredSnapshot);

  let routing: CookReport["routing"];
  switch (blueprint.routing) {
    case "ospf":
      routing = { kind: "ospf", report: await applyOspf(bridge, blueprint.addressing.ospfPid ?? 1) };
      break;
    case "eigrp":
      routing = { kind: "eigrp", report: await applyEigrp(bridge, blueprint.addressing.eigrpAsn ?? 1) };
      break;
    case "rip":
      routing = { kind: "rip", report: await applyRip(bridge, blueprint.addressing.ripVersion ?? 2) };
      break;
    case "static":
      routing = { kind: "static", report: await applyStaticRouting(bridge) };
      break;
    case "none":
    default:
      routing = { kind: "none" };
  }

  let switching: SwitchingReport | undefined;
  if (blueprint.switching && hasAnyIntent(blueprint.switching)) {
    switching = await applySwitching(bridge, blueprint.switching);
  }

  let services: ServicesReport | undefined;
  if (blueprint.services && hasAnyServiceIntent(blueprint.services)) {
    services = await applyServices(bridge, blueprint.services);
  }

  let wireless: WirelessReport | undefined;
  if (blueprint.wireless && hasAnyWirelessIntent(blueprint.wireless)) {
    wireless = await applyWireless(bridge, blueprint.wireless, placedDevices);
  }

  let voip: VoipReport | undefined;
  if (blueprint.voip && hasAnyVoipIntent(blueprint.voip)) {
    voip = await applyVoip(bridge, blueprint.voip);
  }

  let bgp: BgpReport | undefined;
  if (blueprint.advancedRouting?.bgp && blueprint.advancedRouting.bgp.length > 0) {
    bgp = await applyBgp(bridge, blueprint.advancedRouting.bgp);
  }

  let hsrp: HsrpReport | undefined;
  if (blueprint.advancedRouting?.hsrp && blueprint.advancedRouting.hsrp.length > 0) {
    hsrp = await applyHsrp(bridge, blueprint.advancedRouting.hsrp);
  }

  let ipv6: Ipv6Report | undefined;
  if (blueprint.ipv6 && hasAnyIpv6Intent(blueprint.ipv6)) {
    ipv6 = await applyIpv6(bridge, blueprint.ipv6);
  }

  let extraCli: ExtraCliReport[] | undefined;
  if (blueprint.extraCli && blueprint.extraCli.length > 0) {
    extraCli = [];
    for (const block of blueprint.extraCli) {
      try {
        await runCliScript(bridge, block.device, wrapInConfig(block.commands));
        extraCli.push({ device: block.device, ...(block.label ? { label: block.label } : {}), ok: true });
      } catch (err) {
        extraCli.push({ device: block.device, ...(block.label ? { label: block.label } : {}), ok: false, error: (err as Error).message });
      }
    }
  }

  await persistAllConfigs(bridge, blueprint);

  return {
    blueprint: blueprint.name,
    placedDevices,
    skippedDevices,
    placedLinks,
    skippedLinks,
    addressing,
    routing,
    ...(switching ? { switching } : {}),
    ...(services ? { services } : {}),
    ...(wireless ? { wireless } : {}),
    ...(voip ? { voip } : {}),
    ...(bgp ? { bgp } : {}),
    ...(hsrp ? { hsrp } : {}),
    ...(ipv6 ? { ipv6 } : {}),
    ...(extraCli ? { extraCli } : {}),
  };
}

/**
 * Tras todas las fases (addressing, routing, switching, services, extraCli)
 * persistimos `running-config` → `startup-config` en cada router/switch del
 * blueprint. Imprescindible: PT puede reiniciar el modelo (p.ej. al
 * instalar un NIM con `setPower(false)`, o entre sesiones aunque el `.pkt`
 * sí se guarde) y al rearrancar solo se carga la startup. Sin este paso
 * se pierden interfaces, OSPF, NAT, ACLs, etc., reproduciendo las
 * incidencias documentadas en MCP_PACKET_TRACER.md (lecciones 2 y 3).
 *
 * Switching ya hace `write memory` granular por switch en `apply.ts`;
 * aquí completamos el resto (routers principalmente) y damos un segundo
 * paso defensivo a los switches.
 */
async function persistAllConfigs(bridge: Bridge, blueprint: Blueprint): Promise<void> {
  for (const dev of blueprint.devices) {
    const resolved = resolveModel(dev.model);
    if (!resolved) continue;
    if (resolved.category !== "router" && resolved.category !== "switch") continue;
    try {
      const reply = await bridge.sendAndWait(saveRunningConfigJs(dev.name), { timeoutMs: 15_000 });
      if (reply === null || (reply.startsWith("ERR:") && !reply.includes("not_found"))) {
        throw new Error(`write memory on ${dev.name} failed: ${reply ?? "timeout"}`);
      }
    } catch (err) {
      throw new Error(`failed to persist startup-config on ${dev.name}: ${(err as Error).message}`);
    }
  }
}

function hasAnyIntent(s: NonNullable<Blueprint["switching"]>): boolean {
  return (
    (s.vlans?.length ?? 0) > 0 ||
    (s.trunks?.length ?? 0) > 0 ||
    (s.portSecurity?.length ?? 0) > 0 ||
    (s.etherChannels?.length ?? 0) > 0
  );
}

function hasAnyServiceIntent(s: ServicesIntent): boolean {
  return (
    (s.acls?.length ?? 0) > 0 ||
    (s.nat?.length ?? 0) > 0 ||
    (s.dhcpPools?.length ?? 0) > 0 ||
    (s.dhcpRelays?.length ?? 0) > 0 ||
    (s.ntp?.length ?? 0) > 0 ||
    (s.syslog?.length ?? 0) > 0
  );
}

function hasAnyWirelessIntent(w: WirelessIntent): boolean {
  return (w.aps?.length ?? 0) > 0 || (w.clients?.length ?? 0) > 0;
}

function hasAnyVoipIntent(v: VoipIntent): boolean {
  return (
    (v.cme?.length ?? 0) > 0 ||
    (v.ephoneDns?.length ?? 0) > 0 ||
    (v.ephones?.length ?? 0) > 0 ||
    (v.voiceVlans?.length ?? 0) > 0
  );
}

function hasAnyIpv6Intent(v: Ipv6Intent): boolean {
  return (
    (v.interfaces?.length ?? 0) > 0 ||
    (v.ospf?.length ?? 0) > 0 ||
    (v.staticRoutes?.length ?? 0) > 0 ||
    (v.endpoints?.length ?? 0) > 0
  );
}

async function waitForBlueprintLinks(
  bridge: Bridge,
  links: readonly Blueprint["links"][number][],
  timeoutMs = 30_000,
): Promise<CanvasSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let pending: readonly Blueprint["links"][number][];
  do {
    const snapshot = await captureSnapshot(bridge);
    const present = new Set(snapshot.links.map(linkKey));
    pending = links.filter(link => !present.has(linkKey(link)));
    if (!pending.length) return snapshot;
    await sleep(500);
  } while (Date.now() < deadline);

  throw new Error(`links not present after ${timeoutMs}ms: ${pending.map(linkKey).join(", ")}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function summarizeCook(r: CookReport): string {
  const lines: string[] = [];
  lines.push(`Cooked blueprint '${r.blueprint}'.`);
  lines.push(`  devices placed:  ${r.placedDevices.length}`);
  lines.push(`  devices skipped: ${r.skippedDevices.length}`);
  lines.push(`  links wired:     ${r.placedLinks.length}`);
  lines.push(`  links skipped:   ${r.skippedLinks.length}`);
  lines.push(`  routing:         ${r.routing.kind}`);
  if (r.skippedDevices.length > 0) {
    lines.push("", "Skipped devices:");
    for (const s of r.skippedDevices) lines.push(`  - ${s.name}: ${s.reason}`);
  }
  if (r.skippedLinks.length > 0) {
    lines.push("", "Skipped links:");
    for (const s of r.skippedLinks) lines.push(`  - ${s.link}: ${s.reason}`);
  }
  lines.push("", "Addressing actions: " + r.addressing.actions.length.toString());
  if (r.routing.kind === "static") {
    lines.push(`Static routes installed: ${r.routing.report.actions.length}`);
  } else if (r.routing.kind === "ospf") {
    lines.push(`OSPF announcements: ${r.routing.report.networks.size} router(s) under PID ${r.routing.report.pid}`);
  } else if (r.routing.kind === "eigrp") {
    lines.push(`EIGRP announcements: ${r.routing.report.networks.size} router(s) under ASN ${r.routing.report.asn}`);
  } else if (r.routing.kind === "rip") {
    lines.push(`RIP v${r.routing.report.version} announcements: ${r.routing.report.networks.size} router(s)`);
  }
  if (r.switching) {
    lines.push(`Switching actions: ${r.switching.actions.length}`);
  }
  if (r.services) {
    lines.push(`Service actions: ${r.services.actions.length}`);
  }
  if (r.wireless) {
    lines.push(`Wireless actions: ${r.wireless.actions.length}`);
  }
  if (r.voip) {
    lines.push(`VoIP actions: ${r.voip.actions.length}`);
  }
  if (r.bgp) {
    lines.push(`BGP processes: ${r.bgp.devices.size} router(s)`);
  }
  if (r.hsrp) {
    lines.push(`HSRP groups: ${[...r.hsrp.devices.values()].reduce((n, l) => n + l.length, 0)} interface(s) on ${r.hsrp.devices.size} router(s)`);
  }
  if (r.ipv6) {
    lines.push(`IPv6 actions: ${r.ipv6.actions.length}`);
  }
  if (r.extraCli && r.extraCli.length > 0) {
    const fails = r.extraCli.filter(e => !e.ok).length;
    lines.push(`Extra CLI blocks: ${r.extraCli.length} (${fails} failed)`);
    for (const e of r.extraCli.filter(e => !e.ok)) {
      lines.push(`  - ${e.device}${e.label ? ` (${e.label})` : ""}: ${e.error ?? "unknown error"}`);
    }
  }
  return lines.join("\n");
}
