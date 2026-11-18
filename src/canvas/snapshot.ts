/**
 * Build a single PT script that walks the live workspace once and emits a
 * line-oriented dump describing every user-placed device, every port, and
 * every link. Parsing is done client-side; the bridge stays a thin pipe.
 *
 * Format (UTF-8, lines separated by \n, fields separated by |):
 *   DEV|name|model|className|x|y|powered
 *   PORT|name|ip|mask|connected
 *   LINKPAIR|deviceA|portA|deviceB|portB
 *
 * DEV always introduces a new device; PORT lines that follow attach to it until the next DEV. LINKPAIR records
 * identify both endpoints independently. We deliberately do not use JSON: PT's Script
 * Engine is more reliable on plain string concatenation, and recovery from
 * truncated payloads is easier.
 */

import { resolveModel } from "../catalog/devices.js";
import type { Bridge } from "../bridge/http-bridge.js";
import { withLabel } from "../ipc/label.js";
import {
  type CanvasSnapshot,
  type DeviceObservation,
  type LinkObservation,
  type PortObservation,
  linkKey,
} from "./types.js";

const LW = "ipc.appWindow().getActiveWorkspace().getLogicalWorkspace()";
const NET = "ipc.network()";

export function snapshotCanvasJs(): string {
  return withLabel(
    "Snapshot del canvas (dispositivos + enlaces + posiciones)",
    `(function(){` +
      `var net=${NET};` +
      `void ${LW};` + // touch the logical workspace so PT activates it
      `var n=net.getDeviceCount();` +
      `var out=[],seen=Object.create(null);` +
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
          `if(lnk){try{` +
            `var id=String(lnk.getObjectUuid()||"");` +
            `if(!id||!seen[id]){` +
              `var a=lnk.getPort1(),b=lnk.getPort2();` +
              `if(a&&b){out.push("LINKPAIR|"+a.getOwnerDevice().getName()+"|"+a.getName()+"|"+b.getOwnerDevice().getName()+"|"+b.getName());` +
                `if(id)seen[id]=true;}` +
            `}` +
          `}catch(e){}}` +
        `}` +
      `}` +
      `var radios={};for(var a=0;a<n;a++){try{var ap=net.getDeviceAt(a),wr=ap.getProcess("WirelessServerProcess"),rp=wr.getPort();radios[String(rp.getMacAddress()).toLowerCase()]={device:ap.getName(),port:rp.getName()};}catch(e){}}` +
      `for(var c=0;c<n;c++){try{var client=net.getDeviceAt(c),wc=client.getProcess("WirelessClientProcess"),parent=radios[String(wc.getCurrentApMac()).toLowerCase()];if(!parent)continue;for(var j=0;j<client.getPortCount();j++){var cp=client.getPortAt(j);if(cp.isWirelessPort()&&cp.getLink())out.push("LINKPAIR|"+parent.device+"|"+parent.port+"|"+client.getName()+"|"+cp.getName());}}catch(e){}}` +
      `return out.join("\\n");` +
    `})()`,
  );
}

/**
 * Read the dump produced by snapshotCanvasJs and rebuild a typed snapshot.
 * Tolerates trailing blank lines but errors out on malformed DEV/PORT/LINKPAIR
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

export async function captureSnapshot(
  bridge: Bridge,
  opts: CaptureOptions = {},
): Promise<CanvasSnapshot> {
  const raw = await bridge.sendAndWait(snapshotCanvasJs(), {
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
  if (raw === null) throw new Error("snapshot timed out — is the PT bridge polling?");
  if (raw.startsWith("ERROR:")) throw new Error(`PT raised during snapshot: ${raw}`);
  const snapshot = parseSnapshotDump(raw);
  const names = new Set(snapshot.devices.map(device => device.name));
  return { ...snapshot, links: snapshot.links.filter(link => names.has(link.aDevice) && names.has(link.bDevice)) };
}
