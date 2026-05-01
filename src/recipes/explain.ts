/**
 * Read-only narrator for the live canvas. Turns a snapshot into a paragraph
 * a human can read at a glance: how many of each kind of device, which
 * routers carry which subnets, and what ports are dangling.
 */

import { ipToInt, parseCidr } from "../canvas/subnetting.js";
import type { CanvasSnapshot, DeviceObservation } from "../canvas/types.js";

interface Bucket {
  routers: DeviceObservation[];
  switches: DeviceObservation[];
  endpoints: DeviceObservation[];
  others: DeviceObservation[];
}

function bucket(snap: CanvasSnapshot): Bucket {
  const out: Bucket = { routers: [], switches: [], endpoints: [], others: [] };
  for (const d of snap.devices) {
    if (d.className === "Router") out.routers.push(d);
    else if (d.className === "Switch") out.switches.push(d);
    else if (d.className === "PC" || d.className === "Server" || d.className === "Laptop") out.endpoints.push(d);
    else out.others.push(d);
  }
  return out;
}

function maskBits(mask: string): number {
  if (!mask) return 0;
  try {
    const m = ipToInt(mask);
    let count = 0;
    for (let i = 31; i >= 0; i--) if (((m >>> i) & 1) === 1) count++;
    return count;
  } catch {
    return 0;
  }
}

export function explainCanvas(snap: CanvasSnapshot): string {
  const b = bucket(snap);
  const lines: string[] = [];

  lines.push(`Snapshot taken at ${snap.capturedAt}.`);
  lines.push(
    `Inventory: ${b.routers.length} router(s), ${b.switches.length} switch(es), ` +
    `${b.endpoints.length} endpoint(s), ${b.others.length} other device(s).`,
  );
  lines.push(`Total wired links: ${snap.links.length}.`);

  if (b.routers.length > 0) {
    lines.push("", "Routers:");
    for (const r of b.routers) {
      const subs: string[] = [];
      for (const p of r.ports) {
        if (!p.ip || !p.mask) continue;
        const bits = maskBits(p.mask);
        try {
          const net = parseCidr(`${p.ip}/${bits}`);
          subs.push(`${p.name} ${p.ip}/${bits} (net ${net.network}/${bits})`);
        } catch {
          subs.push(`${p.name} ${p.ip}/${bits} (invalid)`);
        }
      }
      lines.push(`  - ${r.name} [${r.model}] @ (${r.x},${r.y}) — ${subs.length === 0 ? "no addressed ports" : subs.join("; ")}`);
    }
  }

  if (b.endpoints.length > 0) {
    lines.push("", "Endpoints:");
    for (const e of b.endpoints) {
      const linked = e.ports.some(p => p.linked);
      const addressed = e.ports.find(p => p.ip);
      const status = !linked ? "unwired" : addressed ? `${addressed.name} ${addressed.ip}/${maskBits(addressed.mask)}` : "wired (no IP)";
      lines.push(`  - ${e.name} [${e.model}] — ${status}`);
    }
  }

  const dangling = snap.devices.flatMap(d =>
    d.ports.filter(p => !p.linked && p.ip !== "").map(p => `${d.name}/${p.name}`),
  );
  if (dangling.length > 0) {
    lines.push("", `Addressed but not wired: ${dangling.join(", ")}.`);
  }

  return lines.join("\n");
}
