/**
 * Build a single PT script that walks the live workspace once and emits a
 * line-oriented dump describing every user-placed device, every port, and
 * every link. Parsing is done client-side; the bridge stays a thin pipe.
 *
 * Format (UTF-8, lines separated by \n, fields separated by |):
 *   DEV|name|model|className|x|y|powered
 *   PORT|name|ip|mask|connected
 *   LINK|portName|otherDevice|otherPort
 *
 * DEV always introduces a new device; the PORT/LINK lines that follow attach
 * to it until the next DEV. We deliberately do not use JSON: PT's Script
 * Engine is more reliable on plain string concatenation, and recovery from
 * truncated payloads is easier.
 */

import { resolveModel } from "../catalog/devices.js";
import type { Bridge } from "../bridge/http-bridge.js";
import { withLabel } from "../ipc/label.js";
import { linkRegistry } from "./link-registry.js";
import {
  type CanvasSnapshot,
  type DeviceObservation,
  type LinkObservation,
  type PortObservation,
  linkKey,
} from "./types.js";

const LW = "ipc.appWindow().getActiveWorkspace().getLogicalWorkspace()";
const NET = "ipc.network()";

/**
 * Cómo se construyen los enlaces en el snapshot:
 *
 * El JS sólo emite filas DEV / PORT (con `linked=1|0`). NO intenta resolver
 * los endpoints del Link desde la API JS de PT 9 — está roto: el objeto
 * Link es opaco (`getDeviceA/B`, `getPortA/B`, `getEndpointA/B`,
 * `getOtherEnd`, `getId`, `toString` lanzan TypeError o devuelven null) y
 * `port.getConnectedPort()` ni siquiera existe. Verificado empíricamente
 * 2026-05-01 con `scripts/probe-link-api.ts`.
 *
 * En su lugar, las parejas de cable las aporta `linkRegistry` (estado
 * mantenido en proceso por `pt_create_link` / `pt_delete_link` /
 * `pt_delete_device`). `captureSnapshot` mergea ambas fuentes: PT da
 * dispositivos+puertos+coordenadas, el registry da los enlaces.
 *
 * Limitación conocida: si el usuario carga un .pkt existente con
 * `pt_load_project` el registry está vacío y los cables del fichero no
 * aparecen como `links`. Documentado en `canvas/link-registry.ts`.
 */
export function snapshotCanvasJs(): string {
  return withLabel(
    "Snapshot del canvas (dispositivos + enlaces + posiciones)",
    `(function(){` +
      `var net=${NET};` +
      `void ${LW};` + // touch the logical workspace so PT activates it
      `var n=net.getDeviceCount();` +
      `var out=[];` +
      `for(var i=0;i<n;i++){` +
        `var d=net.getDeviceAt(i);` +
        `var m=d.getModel();` +
        `if(m==="Power Distribution Device")continue;` +
        `var pwr;try{pwr=d.getPower()?"1":"0";}catch(e){pwr="?";}` +
        `out.push("DEV|"+d.getName()+"|"+m+"|"+d.getClassName()+"|"+d.getXCoordinate()+"|"+d.getYCoordinate()+"|"+pwr);` +
        `var pc=d.getPortCount();` +
        `for(var j=0;j<pc;j++){` +
          `var p=d.getPortAt(j);` +
          `var ip="";var mk="";` +
          `try{ip=p.getIpAddress()||"";}catch(e){}` +
          `try{mk=p.getSubnetMask()||"";}catch(e){}` +
          `var lnk=null;try{lnk=p.getLink();}catch(e){}` +
          `out.push("PORT|"+p.getName()+"|"+ip+"|"+mk+"|"+(lnk?"1":"0"));` +
        `}` +
      `}` +
      `return out.join("\\n");` +
    `})()`,
  );
}

/**
 * Read the dump produced by snapshotCanvasJs and rebuild a typed snapshot.
 * Tolerates trailing blank lines but errors out on malformed DEV/PORT/LINK
 * rows so misbehaviour from PT surfaces loudly instead of being papered over.
 */
export function parseSnapshotDump(raw: string): CanvasSnapshot {
  const devices: DeviceObservation[] = [];
  const linkSet = new Map<string, LinkObservation>();

  let current: {
    name: string;
    model: string;
    className: string;
    category?: ReturnType<typeof resolveModel>;
    x: number;
    y: number;
    powered: boolean;
    ports: PortObservation[];
  } | null = null;

  const finalizeCurrent = () => {
    if (!current) return;
    devices.push({
      name: current.name,
      model: current.model,
      className: current.className,
      ...(current.category ? { category: current.category.category } : {}),
      x: current.x,
      y: current.y,
      powered: current.powered,
      ports: current.ports,
    });
    current = null;
  };

  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("|");
    const tag = parts[0];

    if (tag === "DEV") {
      finalizeCurrent();
      const [, name, model, className, xStr, yStr, pwr] = parts;
      if (!name || !model || !className || xStr === undefined || yStr === undefined) {
        throw new Error(`malformed DEV row: ${line}`);
      }
      current = {
        name,
        model,
        className,
        category: resolveModel(model),
        x: Number(xStr),
        y: Number(yStr),
        powered: pwr === "1",
        ports: [],
      };
      continue;
    }

    if (tag === "PORT") {
      if (!current) throw new Error(`PORT row without enclosing DEV: ${line}`);
      const [, pname, ip, mask, connected] = parts;
      if (!pname || ip === undefined || mask === undefined || connected === undefined) {
        throw new Error(`malformed PORT row: ${line}`);
      }
      current.ports.push({
        name: pname,
        ip,
        mask,
        linked: connected === "1",
      });
      continue;
    }

    // LINK / LINKPAIR rows are no longer emitted by snapshotCanvasJs (PT 9
    // Link API is opaque — see the comment on snapshotCanvasJs). We tolerate
    // them silently for forward/backward compat in case a probe script or a
    // future PT release re-introduces them.
    if (tag === "LINK") {
      if (!current) throw new Error(`LINK row without enclosing DEV: ${line}`);
      const [, pname, otherDev, otherPort] = parts;
      if (!pname || otherDev === undefined || otherPort === undefined) {
        throw new Error(`malformed LINK row: ${line}`);
      }
      if (otherDev === "" || otherPort === "") continue;
      const obs: LinkObservation = {
        aDevice: current.name,
        aPort: pname,
        bDevice: otherDev,
        bPort: otherPort,
      };
      const key = linkKey(obs);
      if (!linkSet.has(key)) linkSet.set(key, obs);
      continue;
    }

    if (tag === "LINKPAIR") {
      const [, aDevice, aPort, bDevice, bPort] = parts;
      if (!aDevice || !aPort || !bDevice || !bPort) {
        throw new Error(`malformed LINKPAIR row: ${line}`);
      }
      const obs: LinkObservation = { aDevice, aPort, bDevice, bPort };
      const key = linkKey(obs);
      if (!linkSet.has(key)) linkSet.set(key, obs);
      continue;
    }

    throw new Error(`unknown row tag in snapshot dump: ${line}`);
  }

  finalizeCurrent();

  return {
    capturedAt: new Date().toISOString(),
    devices,
    links: [...linkSet.values()],
  };
}

export interface CaptureOptions {
  readonly timeoutMs?: number;
}

/**
 * Roundtrip the bridge once and merge the result with the in-process link
 * registry. PT 9's JS Link API is opaque (verified via probe-link-api.ts),
 * so live cables are tracked stateful by `linkRegistry` — see
 * `canvas/link-registry.ts` for the full rationale.
 *
 * Merge policy: any link the JS script managed to resolve (via DEV/LINK
 * rows, e.g. on a hypothetical future PT release that restores the API)
 * survives; the registry adds anything else it knows about. Both sides
 * share the same `linkKey` dedupe so duplicates collapse.
 */
export async function captureSnapshot(
  bridge: Bridge,
  opts: CaptureOptions = {},
): Promise<CanvasSnapshot> {
  const raw = await bridge.sendAndWait(snapshotCanvasJs(), {
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
  if (raw === null) throw new Error("snapshot timed out — is the PT bridge polling?");
  if (raw.startsWith("ERROR:")) throw new Error(`PT raised during snapshot: ${raw}`);
  const parsed = parseSnapshotDump(raw);
  const known = new Set(parsed.links.map(linkKey));
  const merged = [...parsed.links];
  const deviceNames = new Set(parsed.devices.map(d => d.name));
  for (const obs of linkRegistry.all()) {
    // Filter out links that reference devices PT no longer reports —
    // typically because the user removed them through the GUI without
    // going through pt_delete_device. Keeps the snapshot consistent
    // with the actual canvas instead of phantom edges.
    if (!deviceNames.has(obs.aDevice) || !deviceNames.has(obs.bDevice)) continue;
    const key = linkKey(obs);
    if (!known.has(key)) {
      known.add(key);
      merged.push(obs);
    }
  }
  return { ...parsed, links: merged };
}
