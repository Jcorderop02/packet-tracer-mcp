/**
 * Compare two CanvasSnapshots and produce a structured diff. Used by the
 * forecast recipe (compare predicted vs current) and by snapshot persistence
 * to show "what changed since I last saved".
 */

import {
  type CanvasSnapshot,
  type DeviceObservation,
  type LinkObservation,
  type PortObservation,
  linkKey,
} from "./types.js";

export interface DeviceFieldChange {
  readonly name: string;
  readonly model?: { readonly from: string; readonly to: string };
  readonly powered?: { readonly from: boolean; readonly to: boolean };
  readonly position?: { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } };
}

export interface PortFieldChange {
  readonly device: string;
  readonly port: string;
  readonly ip?: { readonly from: string; readonly to: string };
  readonly mask?: { readonly from: string; readonly to: string };
  readonly linked?: { readonly from: boolean; readonly to: boolean };
}

export interface SnapshotDiff {
  readonly addedDevices: readonly DeviceObservation[];
  readonly removedDevices: readonly DeviceObservation[];
  readonly changedDevices: readonly DeviceFieldChange[];
  readonly changedPorts: readonly PortFieldChange[];
  readonly addedLinks: readonly LinkObservation[];
  readonly removedLinks: readonly LinkObservation[];
}

export function diffSnapshots(before: CanvasSnapshot, after: CanvasSnapshot): SnapshotDiff {
  const beforeByName = new Map(before.devices.map(d => [d.name, d]));
  const afterByName = new Map(after.devices.map(d => [d.name, d]));

  const addedDevices: DeviceObservation[] = [];
  const removedDevices: DeviceObservation[] = [];
  const changedDevices: DeviceFieldChange[] = [];
  const changedPorts: PortFieldChange[] = [];

  for (const [name, dev] of afterByName) {
    if (!beforeByName.has(name)) addedDevices.push(dev);
  }
  for (const [name, dev] of beforeByName) {
    if (!afterByName.has(name)) removedDevices.push(dev);
  }

  for (const [name, afterDev] of afterByName) {
    const beforeDev = beforeByName.get(name);
    if (!beforeDev) continue;
    const fc: DeviceFieldChange = compareDeviceFields(beforeDev, afterDev);
    if (fc.model || fc.powered || fc.position) changedDevices.push(fc);

    const beforePorts = new Map(beforeDev.ports.map(p => [p.name, p]));
    for (const ap of afterDev.ports) {
      const bp = beforePorts.get(ap.name);
      if (!bp) continue;
      const portChange = comparePortFields(name, bp, ap);
      if (portChange.ip || portChange.mask || portChange.linked) changedPorts.push(portChange);
    }
  }

  const beforeLinks = new Map(before.links.map(l => [linkKey(l), l]));
  const afterLinks = new Map(after.links.map(l => [linkKey(l), l]));

  const addedLinks: LinkObservation[] = [];
  const removedLinks: LinkObservation[] = [];
  for (const [k, lnk] of afterLinks) if (!beforeLinks.has(k)) addedLinks.push(lnk);
  for (const [k, lnk] of beforeLinks) if (!afterLinks.has(k)) removedLinks.push(lnk);

  return {
    addedDevices,
    removedDevices,
    changedDevices,
    changedPorts,
    addedLinks,
    removedLinks,
  };
}

function compareDeviceFields(b: DeviceObservation, a: DeviceObservation): DeviceFieldChange {
  const out: DeviceFieldChange = { name: a.name };
  if (b.model !== a.model) {
    return { ...out, model: { from: b.model, to: a.model } };
  }
  let withPowered = out;
  if (b.powered !== a.powered) {
    withPowered = { ...withPowered, powered: { from: b.powered, to: a.powered } };
  }
  if (b.x !== a.x || b.y !== a.y) {
    withPowered = {
      ...withPowered,
      position: { from: { x: b.x, y: b.y }, to: { x: a.x, y: a.y } },
    };
  }
  return withPowered;
}

function comparePortFields(
  device: string,
  before: PortObservation,
  after: PortObservation,
): PortFieldChange {
  let out: PortFieldChange = { device, port: after.name };
  if (before.ip !== after.ip) out = { ...out, ip: { from: before.ip, to: after.ip } };
  if (before.mask !== after.mask) out = { ...out, mask: { from: before.mask, to: after.mask } };
  if (before.linked !== after.linked) out = { ...out, linked: { from: before.linked, to: after.linked } };
  return out;
}

export function summarizeDiff(d: SnapshotDiff): string {
  const lines: string[] = [];
  if (d.addedDevices.length === 0 && d.removedDevices.length === 0 &&
      d.changedDevices.length === 0 && d.changedPorts.length === 0 &&
      d.addedLinks.length === 0 && d.removedLinks.length === 0) {
    return "No changes between snapshots.";
  }
  if (d.addedDevices.length > 0) {
    lines.push(`Added devices (${d.addedDevices.length}):`);
    for (const dev of d.addedDevices) lines.push(`  + ${dev.name} (${dev.model})`);
  }
  if (d.removedDevices.length > 0) {
    lines.push(`Removed devices (${d.removedDevices.length}):`);
    for (const dev of d.removedDevices) lines.push(`  - ${dev.name} (${dev.model})`);
  }
  if (d.changedDevices.length > 0) {
    lines.push(`Changed devices (${d.changedDevices.length}):`);
    for (const c of d.changedDevices) {
      const bits: string[] = [];
      if (c.model) bits.push(`model ${c.model.from}->${c.model.to}`);
      if (c.powered) bits.push(`powered ${c.powered.from}->${c.powered.to}`);
      if (c.position) bits.push(`pos (${c.position.from.x},${c.position.from.y})->(${c.position.to.x},${c.position.to.y})`);
      lines.push(`  ~ ${c.name}: ${bits.join(", ")}`);
    }
  }
  if (d.changedPorts.length > 0) {
    lines.push(`Changed ports (${d.changedPorts.length}):`);
    for (const c of d.changedPorts) {
      const bits: string[] = [];
      if (c.ip) bits.push(`ip ${c.ip.from || "<unset>"}->${c.ip.to || "<unset>"}`);
      if (c.mask) bits.push(`mask ${c.mask.from || "<unset>"}->${c.mask.to || "<unset>"}`);
      if (c.linked) bits.push(`linked ${c.linked.from}->${c.linked.to}`);
      lines.push(`  ~ ${c.device}/${c.port}: ${bits.join(", ")}`);
    }
  }
  if (d.addedLinks.length > 0) {
    lines.push(`Added links (${d.addedLinks.length}):`);
    for (const l of d.addedLinks) lines.push(`  + ${l.aDevice}/${l.aPort} <-> ${l.bDevice}/${l.bPort}`);
  }
  if (d.removedLinks.length > 0) {
    lines.push(`Removed links (${d.removedLinks.length}):`);
    for (const l of d.removedLinks) lines.push(`  - ${l.aDevice}/${l.aPort} <-> ${l.bDevice}/${l.bPort}`);
  }
  return lines.join("\n");
}
