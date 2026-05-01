/**
 * Findings about a live canvas. Each Issue is a small, addressable
 * observation — duplicate IPs, unaddressed router uplinks, two router ports
 * facing each other but on different subnets, etc. Severity is split so the
 * mend recipe knows what is automatically repairable vs. what needs a human.
 *
 * Important: this never invents an "intended" topology. It only flags states
 * the live canvas itself reveals as inconsistent.
 */

import { ipToInt, parseCidr, parseInterface, prefixToMask } from "./subnetting.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation, PortObservation } from "./types.js";

export type IssueSeverity = "warning" | "error";

export type IssueCode =
  | "DUPLICATE_IP"
  | "ROUTER_UPLINK_UNADDRESSED"
  | "PORT_LINKED_BUT_DOWN"
  | "ROUTER_PEER_DIFFERENT_SUBNET"
  | "INVALID_MASK"
  | "INVALID_IP"
  | "DEVICE_POWERED_OFF";

export interface Issue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly message: string;
  /** Devices implicated, in the order most relevant to the issue. */
  readonly devices: readonly string[];
  /** Optional structured hint about how the mend recipe could repair this. */
  readonly hint?: string;
}

const ROUTER_CLASS = "Router";
const SWITCH_CLASS = "Switch";

function maskToPrefix(mask: string): number | null {
  if (!mask) return null;
  try {
    const intMask = ipToInt(mask);
    let prefix = 0;
    let zerosStarted = false;
    for (let i = 31; i >= 0; i--) {
      const bit = (intMask >>> i) & 1;
      if (bit === 1) {
        if (zerosStarted) return null; // non-contiguous
        prefix++;
      } else {
        zerosStarted = true;
      }
    }
    return prefix;
  } catch {
    return null;
  }
}

function addressedPort(p: PortObservation): boolean {
  return p.ip !== "" && p.mask !== "";
}

interface IpClaim {
  readonly device: string;
  readonly port: string;
}

export function inspect(snap: CanvasSnapshot): Issue[] {
  const issues: Issue[] = [];

  // 1) Validate every (ip, mask) pair and flag malformed entries early.
  const ipClaims = new Map<string, IpClaim[]>();
  for (const d of snap.devices) {
    for (const p of d.ports) {
      if (!addressedPort(p)) continue;
      const prefix = maskToPrefix(p.mask);
      if (prefix === null) {
        issues.push({
          code: "INVALID_MASK",
          severity: "error",
          message: `${d.name}/${p.name} has a non-contiguous or malformed mask: '${p.mask}'.`,
          devices: [d.name],
        });
        continue;
      }
      try {
        parseInterface(`${p.ip}/${prefix}`);
      } catch (err) {
        issues.push({
          code: "INVALID_IP",
          severity: "error",
          message: `${d.name}/${p.name} carries an invalid IPv4 address '${p.ip}': ${(err as Error).message}.`,
          devices: [d.name],
        });
        continue;
      }
      const list = ipClaims.get(p.ip) ?? [];
      list.push({ device: d.name, port: p.name });
      ipClaims.set(p.ip, list);
    }
  }

  // 2) Duplicate IPs (across the whole canvas).
  for (const [ip, claims] of ipClaims) {
    if (claims.length < 2) continue;
    const where = claims.map(c => `${c.device}/${c.port}`).join(", ");
    issues.push({
      code: "DUPLICATE_IP",
      severity: "error",
      message: `IP ${ip} is claimed by multiple ports: ${where}.`,
      devices: [...new Set(claims.map(c => c.device))],
      hint: "Reassign one of the conflicting ports via pt_set_pc or the CLI.",
    });
  }

  // 3) Powered-off devices that nonetheless carry links.
  for (const d of snap.devices) {
    if (d.powered) continue;
    const linkedPorts = d.ports.filter(p => p.linked).length;
    if (linkedPorts === 0) continue;
    issues.push({
      code: "DEVICE_POWERED_OFF",
      severity: "warning",
      message: `${d.name} is powered off but has ${linkedPorts} active link(s).`,
      devices: [d.name],
      hint: "Power on with pt_send_raw 'd.setPower(true);d.skipBoot();' once the device is wired.",
    });
  }

  // 4) Router uplinks that are linked but unaddressed.
  for (const d of snap.devices) {
    if (d.className !== ROUTER_CLASS) continue;
    for (const p of d.ports) {
      if (!p.linked) continue;
      if (addressedPort(p)) continue;
      issues.push({
        code: "ROUTER_UPLINK_UNADDRESSED",
        severity: "warning",
        message: `${d.name}/${p.name} is wired but lacks an IP address.`,
        devices: [d.name],
        hint: "Run the addressing recipe or push CLI: 'interface <port>; ip address <a> <m>; no shutdown'.",
      });
    }
  }

  // 5) Router-to-router links where both ends are addressed but in different subnets.
  const byName = new Map(snap.devices.map(d => [d.name, d]));
  const seenLinkPairs = new Set<string>();
  for (const lnk of snap.links) {
    const aDev = byName.get(lnk.aDevice);
    const bDev = byName.get(lnk.bDevice);
    if (!aDev || !bDev) continue;
    if (aDev.className !== ROUTER_CLASS || bDev.className !== ROUTER_CLASS) continue;
    const aPort = aDev.ports.find(p => p.name === lnk.aPort);
    const bPort = bDev.ports.find(p => p.name === lnk.bPort);
    if (!aPort || !bPort) continue;
    if (!addressedPort(aPort) || !addressedPort(bPort)) continue;

    const aPrefix = maskToPrefix(aPort.mask);
    const bPrefix = maskToPrefix(bPort.mask);
    if (aPrefix === null || bPrefix === null) continue;
    let aNet, bNet;
    try {
      aNet = parseCidr(`${aPort.ip}/${aPrefix}`);
      bNet = parseCidr(`${bPort.ip}/${bPrefix}`);
    } catch {
      continue;
    }
    if (aNet.network === bNet.network && aPrefix === bPrefix) continue;
    const key = [`${aDev.name}/${aPort.name}`, `${bDev.name}/${bPort.name}`].sort().join("|");
    if (seenLinkPairs.has(key)) continue;
    seenLinkPairs.add(key);
    issues.push({
      code: "ROUTER_PEER_DIFFERENT_SUBNET",
      severity: "error",
      message:
        `Router peers ${aDev.name}/${aPort.name} (${aPort.ip}/${aPrefix}) and ` +
        `${bDev.name}/${bPort.name} (${bPort.ip}/${bPrefix}) are wired together but ` +
        `do not share a subnet.`,
      devices: [aDev.name, bDev.name],
      hint: `Reassign both ends inside the same /30, e.g. ${aPort.ip}/30 and ${incrementHost(aPort.ip)}/30.`,
    });
  }

  // 6) PC/server/laptop ports that report linked but no IP and no DHCP — record as warning.
  for (const d of snap.devices) {
    if (d.className !== "PC" && d.className !== "Pc" && d.className !== "Server" && d.className !== "Laptop") continue;
    const linkedPorts = d.ports.filter(p => p.linked);
    if (linkedPorts.length === 0) continue;
    const allUnaddressed = linkedPorts.every(p => !addressedPort(p));
    if (!allUnaddressed) continue;
    issues.push({
      code: "PORT_LINKED_BUT_DOWN",
      severity: "warning",
      message: `${d.name} is wired but its endpoint ports have no IP. Use pt_set_pc to enable DHCP or set static.`,
      devices: [d.name],
    });
  }

  return issues;
}

function incrementHost(ip: string): string {
  try {
    const n = ipToInt(ip);
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, ((n + 1) & 0xff)].join(".");
  } catch {
    return ip;
  }
}

export function summarizeIssues(issues: readonly Issue[]): string {
  if (issues.length === 0) return "No issues detected on the live canvas.";
  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const lines: string[] = [
    `Inspection result: ${errors} error(s), ${warnings} warning(s).`,
    "",
  ];
  for (const issue of issues) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
    if (issue.hint) lines.push(`  hint: ${issue.hint}`);
  }
  // Reference unused helpers so the type-checker keeps them in scope when this
  // file is consumed only through summarizeIssues.
  void prefixToMask;
  return lines.join("\n");
}

export function isClean(issues: readonly Issue[]): boolean {
  return issues.every(i => i.severity !== "error");
}
