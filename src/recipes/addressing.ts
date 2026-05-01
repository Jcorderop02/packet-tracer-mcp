/**
 * Addressing recipe. Reads the live canvas, determines which router uplinks
 * face other routers (transit /30s) and which face LAN switches/endpoints
 * (LAN /24s), then pushes CLI to set ip addresses on routers and pt_set_pc
 * style commands on endpoints. Endpoints inside a DHCP-flagged LAN are
 * switched to DHCP; otherwise they get sequential static IPs.
 *
 * The recipe is idempotent in spirit: ports already inside the requested
 * pool are left alone. It's not a strict no-op when re-run because PT's CLI
 * may emit slightly different output the second time, but it never reassigns
 * an already-correct port.
 */

import type { Bridge } from "../bridge/http-bridge.js";
import { captureSnapshot } from "../canvas/snapshot.js";
import {
  ipToInt,
  parseCidr,
  prefixToMask,
  SubnetIterator,
  subnetHosts,
  type Ipv4Subnet,
} from "../canvas/subnetting.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation } from "../canvas/types.js";
import { wrapInConfig } from "../ipc/cli-prologue.js";
import {
  bulkCliJs,
  setEndpointStaticIpJs,
  setEndpointDhcpJs,
} from "../ipc/generator.js";
import { withDefaults, type Blueprint, type LanIntent } from "./blueprint.js";

export interface AddressingAction {
  readonly device: string;
  readonly port?: string;
  readonly action: "router-cli" | "endpoint-static" | "endpoint-dhcp" | "skipped";
  readonly detail: string;
}

export interface AddressingReport {
  readonly actions: readonly AddressingAction[];
  readonly transitAllocations: ReadonlyMap<string, Ipv4Subnet>; // linkKey -> subnet
  readonly lanAllocations: ReadonlyMap<string, Ipv4Subnet>;     // gateway/port -> subnet
}

function addressedAlready(p: { ip: string; mask: string }, subnet: Ipv4Subnet): boolean {
  if (!p.ip || !p.mask) return false;
  try {
    const claimed = parseCidr(`${p.ip}/${maskBits(p.mask)}`);
    return claimed.network === subnet.network && claimed.prefix === subnet.prefix;
  } catch {
    return false;
  }
}

function maskBits(mask: string): number {
  const n = ipToInt(mask);
  let count = 0;
  for (let i = 31; i >= 0; i--) if (((n >>> i) & 1) === 1) count++;
  return count;
}

function findRouterPair(snap: CanvasSnapshot, link: LinkObservation): boolean {
  const a = snap.devices.find(d => d.name === link.aDevice);
  const b = snap.devices.find(d => d.name === link.bDevice);
  return !!a && !!b && a.className === "Router" && b.className === "Router";
}

function pickGatewayPort(dev: DeviceObservation, lan: LanIntent): string | null {
  const named = dev.ports.find(p => p.name === lan.gatewayPort);
  if (named) return named.name;
  return null;
}

export async function applyAddressing(
  bridge: Bridge,
  rawBlueprint: Blueprint,
): Promise<AddressingReport> {
  const blueprint = withDefaults(rawBlueprint);
  const snap = await captureSnapshot(bridge);

  const transitIter = new SubnetIterator(blueprint.addressing.transitPool!, 30);
  const lanIter = new SubnetIterator(blueprint.addressing.lanPool!, 24);

  const transitAllocations = new Map<string, Ipv4Subnet>();
  const lanAllocations = new Map<string, Ipv4Subnet>();
  const actions: AddressingAction[] = [];

  // 1) Allocate /30s for every router-router link, configure both endpoints.
  const topologyLinks: LinkObservation[] = blueprint.links.length > 0
    ? blueprint.links.map(l => ({
        aDevice: l.aDevice,
        aPort: l.aPort,
        bDevice: l.bDevice,
        bPort: l.bPort,
      }))
    : [...snap.links];

  for (const link of topologyLinks) {
    if (!findRouterPair(snap, link)) continue;
    const a = snap.devices.find(d => d.name === link.aDevice)!;
    const b = snap.devices.find(d => d.name === link.bDevice)!;
    const aPort = a.ports.find(p => p.name === link.aPort);
    const bPort = b.ports.find(p => p.name === link.bPort);
    if (!aPort || !bPort) continue;

    const sub = transitIter.next();
    transitAllocations.set(`${a.name}/${aPort.name}--${b.name}/${bPort.name}`, sub);
    const [hostA, hostB] = subnetHosts(sub);
    if (!hostA || !hostB) continue;
    const mask = prefixToMask(sub.prefix);

    const aWanted = addressedAlready(aPort, sub);
    const bWanted = addressedAlready(bPort, sub);

    if (!aWanted) {
      const cli = [
        `interface ${aPort.name}`,
        `ip address ${hostA} ${mask}`,
        "no shutdown",
        "exit",
      ].join("\n");
      await sendBulk(bridge, a.name, cli);
      actions.push({
        device: a.name,
        port: aPort.name,
        action: "router-cli",
        detail: `${hostA}/${sub.prefix}`,
      });
    } else {
      actions.push({ device: a.name, port: aPort.name, action: "skipped", detail: "already in pool" });
    }

    if (!bWanted) {
      const cli = [
        `interface ${bPort.name}`,
        `ip address ${hostB} ${mask}`,
        "no shutdown",
        "exit",
      ].join("\n");
      await sendBulk(bridge, b.name, cli);
      actions.push({
        device: b.name,
        port: bPort.name,
        action: "router-cli",
        detail: `${hostB}/${sub.prefix}`,
      });
    } else {
      actions.push({ device: b.name, port: bPort.name, action: "skipped", detail: "already in pool" });
    }
  }

  // 2) Allocate /24s for every LAN intent and configure gateway + endpoints.
  for (const lan of blueprint.lans) {
    const gw = snap.devices.find(d => d.name === lan.gatewayDevice);
    if (!gw) {
      actions.push({ device: lan.gatewayDevice, action: "skipped", detail: "gateway not on canvas" });
      continue;
    }
    const portName = pickGatewayPort(gw, lan);
    // If the gateway port doesn't exist on the device but the LAN has an
    // explicit CIDR, treat it as externally managed (typical for
    // router-on-a-stick subinterfaces handled via extraCli). The gateway
    // CLI is the user's responsibility, but PCs still get addressed.
    const externallyManagedGateway = !portName && !!lan.cidr;
    if (!portName && !externallyManagedGateway) {
      actions.push({ device: gw.name, action: "skipped", detail: `port ${lan.gatewayPort} not present` });
      continue;
    }

    const subnet = lan.cidr ? parseCidr(lan.cidr) : lanIter.next();
    const allocKey = portName ? `${gw.name}/${portName}` : `${gw.name}/${lan.gatewayPort}`;
    lanAllocations.set(allocKey, subnet);
    const hosts = subnetHosts(subnet);
    const gateway = hosts[0];
    if (!gateway) continue;
    const mask = prefixToMask(subnet.prefix);

    if (portName) {
      const cli: string[] = [
        `interface ${portName}`,
        `ip address ${gateway} ${mask}`,
        "no shutdown",
        "exit",
      ];
      if (lan.dhcp) {
        const poolName = `LAN_${gw.name}_${portName.replace(/\W+/g, "")}`;
        cli.push(
          `ip dhcp pool ${poolName}`,
          `network ${subnet.network} ${mask}`,
          `default-router ${gateway}`,
          "exit",
        );
        const exclEnd = hosts[Math.min(hosts.length, 5) - 1] ?? gateway;
        cli.push(`ip dhcp excluded-address ${gateway} ${exclEnd}`);
      }
      await sendBulk(bridge, gw.name, cli.join("\n"));
      actions.push({
        device: gw.name,
        port: portName,
        action: "router-cli",
        detail: `${gateway}/${subnet.prefix}${lan.dhcp ? " + DHCP pool" : ""}`,
      });
    } else {
      actions.push({
        device: gw.name,
        port: lan.gatewayPort,
        action: "skipped",
        detail: `gateway externally managed (cidr ${subnet.network}/${subnet.prefix})`,
      });
    }

    // Configure endpoints in this LAN.
    let cursor = lan.dhcp ? hosts.length : 1; // skip the gateway, which is hosts[0]
    for (const epName of lan.endpoints) {
      const ep = snap.devices.find(d => d.name === epName);
      if (!ep) {
        actions.push({ device: epName, action: "skipped", detail: "endpoint not on canvas" });
        continue;
      }
      const epPort = ep.ports[0];
      if (!epPort) {
        actions.push({ device: ep.name, action: "skipped", detail: "no usable port" });
        continue;
      }
      if (lan.dhcp) {
        await sendRaw(bridge, setEndpointDhcpJs(ep.name));
        actions.push({ device: ep.name, port: epPort.name, action: "endpoint-dhcp", detail: "DHCP" });
        continue;
      }
      const host = hosts[cursor];
      if (!host) {
        actions.push({ device: ep.name, action: "skipped", detail: "subnet exhausted" });
        continue;
      }
      cursor++;
      await sendRaw(
        bridge,
        setEndpointStaticIpJs({
          device: ep.name,
          port: epPort.name,
          ip: host,
          mask,
          gateway,
        }),
      );
      actions.push({
        device: ep.name,
        port: epPort.name,
        action: "endpoint-static",
        detail: `${host}/${subnet.prefix} gw ${gateway}`,
      });
    }
  }

  return {
    actions,
    transitAllocations,
    lanAllocations,
  };
}

async function sendBulk(bridge: Bridge, device: string, cli: string): Promise<void> {
  const reply = await bridge.sendAndWait(bulkCliJs(device, wrapInConfig(cli)), {
    timeoutMs: 60_000,
  });
  if (reply === null) throw new Error(`addressing CLI on ${device} timed out`);
  if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
    throw new Error(`addressing CLI on ${device} rejected: ${reply}`);
  }
}

async function sendRaw(bridge: Bridge, js: string): Promise<void> {
  const reply = await bridge.sendAndWait(js, { timeoutMs: 10_000 });
  if (reply === null) throw new Error("endpoint command timed out");
  if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
    throw new Error(`endpoint command rejected: ${reply}`);
  }
}

export function summarizeAddressing(r: AddressingReport): string {
  const lines: string[] = [];
  lines.push(`Addressing applied ${r.actions.length} action(s).`);
  if (r.transitAllocations.size > 0) {
    lines.push("", "Transit allocations:");
    for (const [k, sub] of r.transitAllocations) lines.push(`  ${k} -> ${sub.network}/${sub.prefix}`);
  }
  if (r.lanAllocations.size > 0) {
    lines.push("", "LAN allocations:");
    for (const [k, sub] of r.lanAllocations) lines.push(`  ${k} -> ${sub.network}/${sub.prefix}`);
  }
  if (r.actions.length > 0) {
    lines.push("", "Actions:");
    for (const a of r.actions) {
      const target = a.port ? `${a.device}/${a.port}` : a.device;
      lines.push(`  - ${a.action} on ${target}: ${a.detail}`);
    }
  }
  return lines.join("\n");
}
