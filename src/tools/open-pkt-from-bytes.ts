import { z } from "zod";
import {
  fileNewJs,
  fileOpenJs,
  getDeviceCountJs,
  getFileSizeJs,
  getPtTempDirJs,
  removeFileJs,
  writeBinaryToFileJs,
} from "../ipc/files.js";
import { listDeviceNamesJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";
import type { Bridge } from "../bridge/http-bridge.js";

const InputSchema = {
  bytes_base64: z.string().min(8).describe(
    "Base64-encoded contents of a .pkt file. PT 9 encrypts .pkt with a per-file key derivation, so there is no stable magic to validate server-side; the authoritative validity check is FileOpenReturnValue=0 after PT loads the blob.",
  ),
  replace: z.boolean().default(true).describe(
    "If true (default), the canvas is wiped via fileNew(false) before opening so the loaded file's devices fully replace the current canvas. If false, fileOpen MERGES into the live canvas (PT 9 native behavior).",
  ),
  max_bytes: z.number().int().positive().default(2_000_000).describe(
    "Maximum decoded blob size to accept (bytes). Default 2 MB. The bridge transports the full base64 inline, so very large blobs strain the request payload; use pt_open_pkt(path) for large files instead.",
  ),
};

const MIN_PKT_SIZE = 64;

function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  if (dir.includes("\\") && !dir.includes("/")) return dir + "\\" + name;
  return dir + "/" + name;
}

async function readDeviceCount(bridge: Bridge): Promise<number> {
  const r = await bridge.sendAndWait(getDeviceCountJs(), { timeoutMs: 5_000 });
  const n = parseInt((r ?? "").trim(), 10);
  return Number.isNaN(n) ? -1 : n;
}

async function readDeviceNames(bridge: Bridge): Promise<string[]> {
  const r = await bridge.sendAndWait(listDeviceNamesJs(), { timeoutMs: 5_000 });
  if (!r || !r.startsWith("[")) return [];
  try { return JSON.parse(r) as string[]; } catch { return []; }
}

export const registerOpenPktFromBytesTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_open_pkt_from_bytes",
    "Open a .pkt provided as base64 bytes (no permanent file required on disk). The server asks PT to write the bytes to a temp path inside its user folder via SystemFileManager.writeBinaryToFile, then triggers fileNew(false)+fileOpen and removes the temp. PT 9 encrypts .pkt with per-file key derivation so there is no stable magic to validate server-side; validity is decided by FileOpenReturnValue=0 from PT. Useful when bytes come from a remote source (DB, MCP client) and the server filesystem is not visible to PT.",
    InputSchema,
    async ({ bytes_base64, replace, max_bytes }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      // 1) Decode + size sanity. PT 9 encrypts .pkt files with per-file
      // key derivation, so the leading bytes are NOT a stable magic and
      // cannot be checked server-side. The authoritative validity check
      // is fileOpen returning FileOpenReturnValue=0 (step 4 below).
      let decoded: Buffer;
      try {
        decoded = Buffer.from(bytes_base64, "base64");
      } catch (e) {
        return errorResult(`bytes_base64 is not valid base64: ${(e as Error).message}`);
      }
      if (decoded.length < MIN_PKT_SIZE) {
        return errorResult(`Decoded blob is only ${decoded.length} bytes; a real PT 9 .pkt is at least ${MIN_PKT_SIZE} bytes.`);
      }
      if (decoded.length > max_bytes) {
        return errorResult(`Decoded blob is ${decoded.length} bytes; exceeds max_bytes=${max_bytes}. Use pt_open_pkt(path) for large files.`);
      }

      // Re-encode to canonical base64 in case the caller's b64 had whitespace/padding quirks.
      const canonical = decoded.toString("base64");

      // 2) Pick a writable PT-side directory.
      const dirReply = await bridge.sendAndWait(getPtTempDirJs(), { timeoutMs: 5_000 });
      const dirErr = checkPtReply(dirReply);
      if (dirErr) return dirErr;
      if (!dirReply || !dirReply.startsWith("DIR|")) {
        return errorResult(`Could not resolve a writable PT-side directory: ${(dirReply ?? "<null>").slice(0, 200)}`);
      }
      const ptDir = dirReply.slice("DIR|".length);
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const tempPath = joinPath(ptDir, `pt-mcp-from-bytes-${stamp}.pkt`);

      // 3) Write the blob to disk via PT.
      const writeReply = await bridge.sendAndWait(
        writeBinaryToFileJs(tempPath, canonical),
        { timeoutMs: 60_000 },
      );
      const wErr = checkPtReply(writeReply);
      if (wErr) return wErr;
      if (!writeReply || !writeReply.startsWith("OK|")) {
        return errorResult(`writeBinaryToFile failed: ${(writeReply ?? "<null>").slice(0, 200)}`);
      }
      if (writeReply.slice("OK|".length).trim() !== "true") {
        return errorResult(`writeBinaryToFile returned false; PT refused to write ${tempPath}.`);
      }

      // Sanity-check: PT-reported size matches decoded size.
      const sizeReply = await bridge.sendAndWait(getFileSizeJs(tempPath), { timeoutMs: 5_000 });
      const ptSize = parseInt((sizeReply ?? "").trim(), 10);
      if (Number.isFinite(ptSize) && ptSize !== decoded.length) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`PT-reported size ${ptSize} != decoded size ${decoded.length} after writeBinaryToFile.`);
      }

      // 4) Snapshot canvas before, optionally clear, then fileOpen.
      const beforeCount = await readDeviceCount(bridge);
      const beforeNames = beforeCount > 0 ? await readDeviceNames(bridge) : [];

      if (replace) {
        const newReply = await bridge.sendAndWait(fileNewJs(false), { timeoutMs: 10_000 });
        const ptErr = checkPtReply(newReply);
        if (ptErr) {
          await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
          return ptErr;
        }
        if (!newReply || !newReply.startsWith("OK|") || newReply.slice("OK|".length).trim() !== "true") {
          await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
          return errorResult(`fileNew(false) did not return OK|true: ${(newReply ?? "<null>").slice(0, 200)}`);
        }
      }

      const openReply = await bridge.sendAndWait(fileOpenJs(tempPath), { timeoutMs: 30_000 });
      const oErr = checkPtReply(openReply);
      if (oErr) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return oErr;
      }
      if (!openReply || !openReply.startsWith("OK|")) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`fileOpen did not run cleanly: ${(openReply ?? "<null>").slice(0, 200)}`);
      }
      const tail = openReply.slice("OK|".length).split("|");
      const retValue = tail.length >= 2 ? tail[1] : "";
      if (retValue !== "0") {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`fileOpen returned non-zero FileOpenReturnValue: ${retValue}.`);
      }

      const afterCount = await readDeviceCount(bridge);
      const afterNames = afterCount > 0 ? await readDeviceNames(bridge) : [];

      // 5) Cleanup the temp.
      const rmReply = await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 });
      const cleaned = (rmReply ?? "").trim() === "true";

      const delta = afterCount - (replace ? 0 : beforeCount);
      const lines = [
        `Loaded ${decoded.length} bytes from base64 (${replace ? "replace" : "merge"} mode).`,
        `Devices before: ${beforeCount}, after: ${afterCount} (Δ=${delta >= 0 ? "+" : ""}${delta}).`,
      ];
      if (replace && beforeNames.length > 0) {
        lines.push(`Cleared from canvas: ${beforeNames.slice(0, 25).join(", ")}${beforeNames.length > 25 ? ` (+${beforeNames.length - 25} more)` : ""}.`);
      }
      if (afterNames.length > 0) {
        lines.push(`Now on canvas: ${afterNames.slice(0, 25).join(", ")}${afterNames.length > 25 ? ` (+${afterNames.length - 25} more)` : ""}.`);
      }
      lines.push(cleaned ? `PT temp removed.` : `(warn) PT temp not removed at ${tempPath}.`);
      return textResult(lines.join("\n"));
    },
  );
};
