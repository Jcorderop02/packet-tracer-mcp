/**
 * IPC builders for Phase 8 — simulation, PDU origination, canvas reset and
 * workspace screenshots. All signatures verified against PT 9 real via
 * `scripts/probe-fase8b.ts` (2026-04-29) and cross-checked with the Cisco
 * docs in `docs/pt-api/classes/` (RSSwitch, SimulationPanel, UserCreatedPDU,
 * AppWindow, LogicalWorkspace).
 *
 * Same shape as the rest of `src/ipc/`: each function returns a single
 * self-contained JS expression that the Script Engine can run via
 * `$se('runCode', expr)`. No locals leak between calls.
 */

import { jsStr } from "./escape.js";
import { withLabel } from "./label.js";

const APP = "ipc.appWindow()";
const LW = `${APP}.getActiveWorkspace().getLogicalWorkspace()`;
const NET = "ipc.network()";

export type SimulationMode = "simulation" | "realtime";

/**
 * Toggle between Realtime and Simulation modes via the RSSwitch widget. The
 * mode change is asynchronous in PT (the toolbar repaints on the next event
 * loop tick) so the caller may need a small delay before reading isPlaying.
 */
export function setSimulationModeJs(mode: SimulationMode): string {
  const fn = mode === "simulation" ? "showSimulationMode" : "showRealtimeMode";
  return withLabel(
    `Cambiando a modo ${mode === "simulation" ? "Simulation" : "Realtime"}`,
    `(function(){` +
      `var sw=${APP}.getRSSwitch();` +
      `if(!sw)return "ERR:no_rsswitch";` +
      `sw.${fn}();` +
      `return "OK";` +
    `})()`,
  );
}

/**
 * Read the current simulation panel state. Returns JSON `{isPlaying:bool}`.
 * Note: the RSSwitch itself doesn't expose a getter (`isInSimulationMode`
 * does NOT exist on PT 9 — verified by probe), so we infer "in simulation"
 * indirectly via `SimulationPanel.isPlaying()` which is only meaningful
 * once Simulation Mode is active.
 */
export function getSimulationStateJs(): string {
  return withLabel(
    "Leyendo estado de simulación",
    `(function(){` +
      `var p=${APP}.getSimulationPanel();` +
      `if(!p)return "ERR:no_sim_panel";` +
      `var playing=false;` +
      `try{playing=!!p.isPlaying();}catch(e){}` +
      `return JSON.stringify({isPlaying:playing});` +
    `})()`,
  );
}

export type SimulationAction = "play" | "back" | "forward" | "reset";

/**
 * Trigger one of the simulation control buttons. Returns "OK" on success.
 * Caller is responsible for switching to Simulation Mode first if needed —
 * `play` from Realtime is a no-op.
 */
export function simulationControlJs(action: SimulationAction): string {
  const method =
    action === "play" ? "play" :
    action === "back" ? "back" :
    action === "forward" ? "forward" :
    "resetSimulation";
  const verb =
    action === "play" ? "Reproduciendo" :
    action === "back" ? "Retrocediendo paso de" :
    action === "forward" ? "Avanzando paso de" :
    "Reseteando";
  return withLabel(
    `${verb} simulación`,
    `(function(){` +
      `var p=${APP}.getSimulationPanel();` +
      `if(!p)return "ERR:no_sim_panel";` +
      `p.${method}();` +
      `return "OK";` +
    `})()`,
  );
}

/**
 * Add a "Simple PDU" (an ICMP echo) from `source` to `dest` via
 * `UserCreatedPDU.addSimplePdu(srcName, dstName)`. The PT method returns an
 * ADD_PDU_ERROR code (0 = OK, non-zero = error). We return that code as
 * `OK|<idx>` for success or `ERR:add_pdu|<code>` for any non-zero. The
 * caller maps `<idx>` to the simulation scenario slot for `firePDU`.
 *
 * Verified by probe-fase8b: `addSimplePdu("PC1","PC2")` → 0 (success);
 * `addSimplePdu("PC1","192.168.99.20")` → 30 (an error code, IPs not
 * accepted as second arg — only device names work).
 */
export function addSimplePduJs(source: string, dest: string): string {
  return withLabel(
    `Añadiendo Simple PDU ${source} → ${dest}`,
    `(function(){` +
      `var u=${APP}.getUserCreatedPDU();` +
      `if(!u)return "ERR:no_user_pdu";` +
      `try{var code=u.addSimplePdu(${jsStr(source)},${jsStr(dest)});` +
        `if(code===0||code==="0")return "OK|0";` +
        `return "ERR:add_pdu|"+code;` +
      `}catch(e){return "ERR:add_pdu_throw|"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Send the PDU at the given scenario index. Returns "OK" on success.
 */
export function firePduJs(index: number): string {
  return withLabel(
    `Lanzando PDU #${index|0} del escenario`,
    `(function(){` +
      `var u=${APP}.getUserCreatedPDU();` +
      `if(!u)return "ERR:no_user_pdu";` +
      `try{u.firePDU(${index|0});return "OK";}` +
      `catch(e){return "ERR:fire_pdu|"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Delete the PDU at the given scenario index. Returns "OK" or
 * "ERR:delete_pdu|<msg>" if the index is out of range.
 */
export function deletePduJs(index: number): string {
  return withLabel(
    `Eliminando PDU #${index|0} del escenario`,
    `(function(){` +
      `var u=${APP}.getUserCreatedPDU();` +
      `if(!u)return "ERR:no_user_pdu";` +
      `try{u.deletePDU(${index|0});return "OK";}` +
      `catch(e){return "ERR:delete_pdu|"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Wipe the canvas via `AppWindow.fileNew(prompt)`. With `prompt=true` PT
 * shows the "save before new?" modal — useful in interactive sessions.
 * With `prompt=false` it skips the modal entirely (correct for scripted
 * use). Returns the boolean result wrapped as `OK|true` / `OK|false` so
 * the caller can distinguish "user cancelled" from "real success".
 */
export function clearCanvasJs(prompt: boolean): string {
  return withLabel(
    `Limpiando canvas${prompt ? " (con diálogo)" : ""}`,
    `(function(){` +
      `try{var ok=${APP}.fileNew(${prompt ? "true" : "false"});` +
        `return "OK|"+(ok?"true":"false");` +
      `}catch(e){return "ERR:file_new|"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

export type ImageFormat = "PNG" | "JPG";

/**
 * Capture the Logical workspace as a base64-encoded image in the requested
 * format. Returns `B64|<base64>` on success.
 *
 * `LogicalWorkspace.getWorkspaceImage(format)` returns a `vector<byte>` —
 * the bridge transports text, so we base64-encode in JS before returning.
 * The PT Script Engine doesn't expose `btoa`, so we encode by hand using
 * the standard alphabet. Probe verified the byte stream is a valid
 * PNG/JPEG file (correct magic bytes), len ~18 KB for an empty canvas.
 */
export function workspaceImageBase64Js(format: ImageFormat): string {
  return withLabel(
    `Capturando workspace lógico como ${format} (base64)`,
    `(function(){` +
      `var bytes=${LW}.getWorkspaceImage(${jsStr(format)});` +
      `if(!bytes||bytes.length===0)return "ERR:empty_image";` +
      `var A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";` +
      `var out="";` +
      `for(var i=0;i<bytes.length;i+=3){` +
        `var b1=bytes[i]&0xFF;` +
        `var b2=i+1<bytes.length?bytes[i+1]&0xFF:0;` +
        `var b3=i+2<bytes.length?bytes[i+2]&0xFF:0;` +
        `out+=A.charAt(b1>>2);` +
        `out+=A.charAt(((b1&3)<<4)|(b2>>4));` +
        `out+=i+1<bytes.length?A.charAt(((b2&15)<<2)|(b3>>6)):"=";` +
        `out+=i+2<bytes.length?A.charAt(b3&63):"=";` +
      `}` +
      `return "B64|"+out;` +
    `})()`,
  );
}

/**
 * Enumerate all device names currently on the canvas via
 * `network().getDeviceCount()` + `getDeviceAt(i).getName()`. Smoke
 * `RCP-SIM-OPS` 2026-04-29 confirmed that `getDeviceAt(i)` returns a
 * Device object (not a string as the early probe seemed to suggest),
 * so we have to call `.getName()` on it. Returns a JSON array of names.
 *
 * Useful as the introspection step for `pt_clear_canvas` (so the tool can
 * report what got wiped) and for any future audit/diff.
 */
export function listDeviceNamesJs(): string {
  return withLabel(
    "Listando nombres de dispositivos del canvas",
    `(function(){` +
      `var n=${NET};` +
      `var c=n.getDeviceCount();` +
      `var names=[];` +
      `for(var i=0;i<c;i++){` +
        `try{` +
          `var d=n.getDeviceAt(i);` +
          `if(d){` +
            `var nm="";` +
            `try{nm=String(d.getName&&d.getName()||"");}catch(e){}` +
            `if(!nm)nm=String(d);` +
            `names.push(nm);` +
          `}` +
        `}catch(e){}` +
      `}` +
      `return JSON.stringify(names);` +
    `})()`,
  );
}
