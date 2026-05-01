/**
 * IPC builders for Phase 9 — .pkt persistence (save/open).
 *
 * Verified against PT 9 real via `scripts/probe-fase9.ts` and
 * `scripts/probe-fase9b.ts` (2026-04-29):
 *   - `AppWindow.fileSaveAsNoPrompt(path, true)` writes the active canvas
 *     to an absolute path; signals (`fileSaveDone` etc.) are unreachable
 *     from Script Engine, so completion is detected via filesystem
 *     polling (`SystemFileManager.getFileSize`).
 *   - `AppWindow.fileOpen(path)` MERGES into the live canvas, so a clean
 *     load needs `AppWindow.fileNew(false)` first (no modal, verified).
 *   - `IPC.systemFileManager()` exposes synchronous IO returning values
 *     by JS return — no signals needed for stat / checksum / read /
 *     write / remove.
 *
 * Pkz format is intentionally not exposed: `fileSaveAsPkzAsync` silently
 * fails (file never appears) on PT 9.0.0.0810. See memory note
 * `pt9_file_ops_viable.md` for the dead-end analysis.
 */

import { jsStr } from "./escape.js";
import { withLabel } from "./label.js";

const APP = "ipc.appWindow()";
const SFM = "ipc.systemFileManager()";

/**
 * Save the active canvas to `path` (.pkt). The JS call returns immediately
 * (PT performs the write asynchronously); use `getFileSizeJs` polling to
 * detect when the file is stable.
 *
 * Returns "OK" on call dispatch, or "ERR:<reason>" if the AppWindow could
 * not be obtained.
 */
export function fileSaveAsNoPromptJs(path: string): string {
  return withLabel(
    `Guardando .pkt en ${path}`,
    `(function(){` +
      `var a=${APP};` +
      `if(!a)return "ERR:no_app_window";` +
      `try{a.fileSaveAsNoPrompt(${jsStr(path)},true);return "OK";}` +
      `catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Open `path` into the active workspace. PT 9 MERGES the file into the
 * existing canvas, so callers that want a replace semantics MUST issue
 * `fileNewJs(false)` immediately before this call.
 *
 * Returns the numeric `FileOpenReturnValue` from PT (0 = OK).
 */
export function fileOpenJs(path: string): string {
  return withLabel(
    `Abriendo .pkt desde ${path}`,
    `(function(){` +
      `var a=${APP};` +
      `if(!a)return "ERR:no_app_window";` +
      `try{var r=a.fileOpen(${jsStr(path)});return "OK|"+(typeof r)+"|"+String(r);}` +
      `catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * `AppWindow.fileNew(promptUser)`. Verified: passing `false` does NOT show
 * the "save before new?" modal and reliably empties the canvas. Used as a
 * pre-step for `pt_open_pkt` when the caller wants replace semantics.
 */
export function fileNewJs(promptUser: boolean): string {
  return withLabel(
    `Vaciando workspace y creando uno nuevo${promptUser ? " (con diálogo)" : ""}`,
    `(function(){` +
      `var a=${APP};` +
      `if(!a)return "ERR:no_app_window";` +
      `try{var r=a.fileNew(${promptUser ? "true" : "false"});return "OK|"+String(r);}` +
      `catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

export function fileExistsJs(path: string): string {
  return withLabel(
    `Comprobando si existe el archivo ${path}`,
    `(function(){try{return String(${SFM}.fileExists(${jsStr(path)}));}catch(e){return "ERR:"+e.message;}})()`,
  );
}

export function getFileSizeJs(path: string): string {
  return withLabel(
    `Leyendo tamaño en bytes de ${path}`,
    `(function(){try{return String(${SFM}.getFileSize(${jsStr(path)}));}catch(e){return "ERR:"+e.message;}})()`,
  );
}

export function getFileCheckSumJs(path: string): string {
  return withLabel(
    `Calculando checksum de ${path}`,
    `(function(){try{return String(${SFM}.getFileCheckSum(${jsStr(path)}));}catch(e){return "ERR:"+e.message;}})()`,
  );
}

export function removeFileJs(path: string): string {
  return withLabel(
    `Eliminando archivo ${path}`,
    `(function(){try{return String(${SFM}.removeFile(${jsStr(path)}));}catch(e){return "ERR:"+e.message;}})()`,
  );
}

/**
 * Returns the first `n` raw bytes of `path` as a hex string (no separators,
 * lowercase). Used for magic-byte sniffing without having to transfer the
 * full base64 of the file. The PT Script Engine has no `parseInt` hex
 * helper for byte values, so we build the hex by hand from base64 chars.
 */
export function getFileMagicHexJs(path: string, n: number): string {
  const need = Math.max(1, Math.min(n, 32));
  return withLabel(
    `Leyendo magic bytes (${need}) de ${path}`,
    `(function(){` +
      `try{` +
        `var b64=${SFM}.getFileBinaryContents(${jsStr(path)});` +
        `if(!b64)return "ERR:empty";` +
        `var alpha="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";` +
        `var idx={};for(var i=0;i<alpha.length;i++)idx[alpha.charAt(i)]=i;` +
        `var bytes=[];` +
        `for(var j=0;j<b64.length&&bytes.length<${need};j+=4){` +
          `var c1=idx[b64.charAt(j)]||0;` +
          `var c2=idx[b64.charAt(j+1)]||0;` +
          `var c3=b64.charAt(j+2)==="="?0:(idx[b64.charAt(j+2)]||0);` +
          `var c4=b64.charAt(j+3)==="="?0:(idx[b64.charAt(j+3)]||0);` +
          `bytes.push((c1<<2)|(c2>>4));` +
          `if(b64.charAt(j+2)!=="="&&bytes.length<${need})bytes.push(((c2&15)<<4)|(c3>>2));` +
          `if(b64.charAt(j+3)!=="="&&bytes.length<${need})bytes.push(((c3&3)<<6)|c4);` +
        `}` +
        `var hex="";var hh="0123456789abcdef";` +
        `for(var k=0;k<bytes.length;k++){var v=bytes[k]&0xFF;hex+=hh.charAt(v>>4)+hh.charAt(v&15);}` +
        `return "HEX|"+hex;` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Number of devices currently on the canvas. Single-line helper used by
 * `pt_open_pkt` to detect that a file actually loaded something.
 */
export function getDeviceCountJs(): string {
  return withLabel(
    "Contando dispositivos en el canvas",
    `String(ipc.network().getDeviceCount())`,
  );
}

/**
 * Get a writable, PT-visible directory for staging temp .pkt files.
 * Tries `getUserFolder()` first (always present per Cisco 8.1 docs and
 * verified in probe-fase9), falls back to `getDefaultFileSaveLocation()`.
 * Returns "DIR|<path>" or "ERR:<reason>".
 */
export function getPtTempDirJs(): string {
  return withLabel(
    "Resolviendo carpeta de usuario de Packet Tracer",
    `(function(){` +
      `try{` +
        `var a=${APP};` +
        `if(!a)return "ERR:no_app_window";` +
        `var u="";try{u=a.getUserFolder()||"";}catch(e){}` +
        `if(!u){try{u=a.getDefaultFileSaveLocation()||"";}catch(e){}}` +
        `if(!u)return "ERR:no_writable_dir";` +
        `return "DIR|"+u;` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Returns the full base64 contents of `path` via
 * `SystemFileManager.getFileBinaryContents`. Wraps the value in
 * `LEN|<n>|<base64>` so the server can sanity-check length before parsing.
 * Useful for small files (<100 KB); larger files should use the chunked
 * variant `getFileBinaryContentsChunkJs` to avoid bridge transport limits.
 */
export function getFileBinaryContentsJs(path: string): string {
  return withLabel(
    `Leyendo contenido binario de ${path}`,
    `(function(){` +
      `try{` +
        `var b=${SFM}.getFileBinaryContents(${jsStr(path)});` +
        `if(b===null||b===undefined)return "ERR:null";` +
        `return "LEN|"+b.length+"|"+b;` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Returns a slice `[offset, offset+len)` of the base64 contents of `path`.
 * Used to assemble files larger than the bridge transport budget by
 * issuing N requests and concatenating server-side. The first call should
 * also fetch `getFileBinaryLengthJs` to know how many chunks to ask for.
 */
export function getFileBinaryContentsChunkJs(path: string, offset: number, len: number): string {
  const o = Math.max(0, Math.floor(offset));
  const l = Math.max(1, Math.floor(len));
  return withLabel(
    `Leyendo chunk [${o}, ${o + l}) de ${path}`,
    `(function(){` +
      `try{` +
        `var b=${SFM}.getFileBinaryContents(${jsStr(path)});` +
        `if(b===null||b===undefined)return "ERR:null";` +
        `return b.substring(${o},${o + l});` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Returns the total base64 length for `path` (cheap pre-check before
 * issuing chunked reads). Format: bare number string or "ERR:<reason>".
 */
export function getFileBinaryLengthJs(path: string): string {
  return withLabel(
    `Leyendo longitud base64 de ${path}`,
    `(function(){` +
      `try{` +
        `var b=${SFM}.getFileBinaryContents(${jsStr(path)});` +
        `return String(b?b.length:-1);` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

/**
 * Write a base64 blob to disk via `SystemFileManager.writeBinaryToFile`.
 * The bridge transports the full base64 inline as a JS string literal —
 * works fine for typical .pkt sizes (probe-fase9b validated 68 KB
 * one-shot). For very large blobs, callers should split the write or
 * fall back to disk-based handoff.
 */
export function writeBinaryToFileJs(path: string, base64: string): string {
  return withLabel(
    `Escribiendo binario en ${path} (${base64.length} chars b64)`,
    `(function(){` +
      `try{` +
        `var ok=${SFM}.writeBinaryToFile(${jsStr(path)},${jsStr(base64)});` +
        `return "OK|"+(ok?"true":"false");` +
      `}catch(e){return "ERR:"+(e&&e.message?e.message:String(e));}` +
    `})()`,
  );
}

