/**
 * Wire-level shape of the live Packet Tracer canvas.
 *
 * Everything in this module is *observable* — every field is filled by reading
 * the live workspace. There is no in-memory plan being shadowed; the snapshot
 * is the truth of the canvas at the instant it was captured.
 */

import type { DeviceCategory } from "../ipc/constants.js";

export interface PortObservation {
  readonly name: string;
  /** IPv4 host address, "" if unset. */
  readonly ip: string;
  /** Subnet mask in dotted form, "" if unset. */
  readonly mask: string;
  /** True when the port currently sits at one end of a Link. */
  readonly linked: boolean;
}

export interface DeviceObservation {
  readonly name: string;
  readonly model: string;
  /** Java class name reported by PT (e.g. "Router", "Switch", "PC"). */
  readonly className: string;
  /** Resolved category drawn from our own catalog, undefined for unknowns. */
  readonly category?: DeviceCategory;
  readonly x: number;
  readonly y: number;
  readonly powered: boolean;
  readonly ports: readonly PortObservation[];
}

export interface LinkObservation {
  readonly aDevice: string;
  readonly aPort: string;
  readonly bDevice: string;
  readonly bPort: string;
}

export interface CanvasSnapshot {
  /** ISO timestamp captured locally just after the IPC roundtrip returns. */
  readonly capturedAt: string;
  readonly devices: readonly DeviceObservation[];
  readonly links: readonly LinkObservation[];
}

/** Canonical, order-independent identifier for a link end. */
export function linkKey(o: LinkObservation): string {
  const a = `${o.aDevice}:${o.aPort}`;
  const b = `${o.bDevice}:${o.bPort}`;
  return a < b ? `${a}--${b}` : `${b}--${a}`;
}

export function deviceByName(snap: CanvasSnapshot, name: string): DeviceObservation | undefined {
  return snap.devices.find(d => d.name === name);
}

export function portByName(dev: DeviceObservation, port: string): PortObservation | undefined {
  return dev.ports.find(p => p.name === port);
}
