/**
 * In-memory registry of cables we've created via `pt_create_link`.
 *
 * Why this exists: PT 9's JavaScript IPC exposes `port.getLink()` but the
 * Link object it returns is opaque — every accessor we tried (`getDeviceA`,
 * `getDeviceB`, `getPortA`, `getPortB`, `getEndpointA/B`, `getDevices`,
 * `getPorts`, `getOtherEnd`, `getId`, `getName`, `toString`) throws or
 * returns null. `port.getConnectedPort()` does not exist either, and
 * `LogicalWorkspace.getLinkCount/getLinkAt` are absent. Verified empirically
 * 2026-05-01 with `scripts/probe-link-api.ts`.
 *
 * Without a way to resolve link endpoints from the live canvas, every
 * derived feature breaks: `pt_auto_layout` cannot place children under
 * their routers, the topology explainer reports orphans, smoke runs print
 * empty link counts. The fix is stateful: every time a tool successfully
 * creates a link we record both endpoints here, and `captureSnapshot`
 * merges this registry into the snapshot's `links` array.
 *
 * Limitations (transparent to the caller — no silent fallback):
 *   - Topologies loaded via `pt_load_project` start with an empty registry,
 *     so links from the loaded `.pkt` are unknown. Until PT exposes a
 *     usable Link API or we add a `.pkt`-sidecar persistence layer, the
 *     loaded canvas behaves as if it had no cables. The user is warned
 *     in the layout / explain tools when the registry contradicts the
 *     observed `linked=true` ports.
 *   - The registry is per-process. Restarting the MCP server clears it.
 *
 * Direction is normalised on `register`: endpoints are sorted lexicographically
 * by `(device, port)` so `(R1:Gi0/0 ↔ SW1:Gi0/1)` and `(SW1:Gi0/1 ↔ R1:Gi0/0)`
 * collapse to the same key. This keeps `register` and `unregister` symmetric.
 */

import type { LinkObservation } from "./types.js";

interface LinkKey {
  readonly aDevice: string;
  readonly aPort: string;
  readonly bDevice: string;
  readonly bPort: string;
}

function normalise(a: string, ap: string, b: string, bp: string): LinkKey {
  if (a < b || (a === b && ap <= bp)) {
    return { aDevice: a, aPort: ap, bDevice: b, bPort: bp };
  }
  return { aDevice: b, aPort: bp, bDevice: a, bPort: ap };
}

function keyOf(k: LinkKey): string {
  return `${k.aDevice}\x00${k.aPort}\x00${k.bDevice}\x00${k.bPort}`;
}

class LinkRegistry {
  private readonly entries = new Map<string, LinkKey>();

  register(deviceA: string, portA: string, deviceB: string, portB: string): void {
    const k = normalise(deviceA, portA, deviceB, portB);
    this.entries.set(keyOf(k), k);
  }

  unregister(deviceA: string, portA: string, deviceB: string, portB: string): void {
    const k = normalise(deviceA, portA, deviceB, portB);
    this.entries.delete(keyOf(k));
  }

  /** Drop every link that touches `deviceName`. Used on `pt_delete_device`. */
  forgetDevice(deviceName: string): void {
    for (const [key, value] of this.entries) {
      if (value.aDevice === deviceName || value.bDevice === deviceName) {
        this.entries.delete(key);
      }
    }
  }

  /** Rename every reference to `oldName` → `newName`. Used on `pt_rename_device`. */
  renameDevice(oldName: string, newName: string): void {
    const replacements: LinkKey[] = [];
    for (const [key, value] of this.entries) {
      if (value.aDevice === oldName || value.bDevice === oldName) {
        this.entries.delete(key);
        replacements.push({
          aDevice: value.aDevice === oldName ? newName : value.aDevice,
          aPort: value.aPort,
          bDevice: value.bDevice === oldName ? newName : value.bDevice,
          bPort: value.bPort,
        });
      }
    }
    for (const r of replacements) {
      const norm = normalise(r.aDevice, r.aPort, r.bDevice, r.bPort);
      this.entries.set(keyOf(norm), norm);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  /** Return every registered link as a `LinkObservation` (read-only snapshot). */
  all(): LinkObservation[] {
    return [...this.entries.values()].map(k => ({
      aDevice: k.aDevice,
      aPort: k.aPort,
      bDevice: k.bDevice,
      bPort: k.bPort,
    }));
  }
}

/**
 * Process-wide singleton. There is exactly one bridge / one MCP server per
 * process today; if that ever changes, replace this with a per-bridge
 * instance threaded through `ToolContext`.
 */
export const linkRegistry = new LinkRegistry();
