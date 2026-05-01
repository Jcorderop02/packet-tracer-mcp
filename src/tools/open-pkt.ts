import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  fileExistsJs,
  fileNewJs,
  fileOpenJs,
  getDeviceCountJs,
  getFileSizeJs,
} from "../ipc/files.js";
import { listDeviceNamesJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";
import type { Bridge } from "../bridge/http-bridge.js";

const InputSchema = {
  path: z.string().min(1).describe(
    "Absolute path to a .pkt file readable by the Packet Tracer process. Pkz files are NOT supported.",
  ),
  replace: z.boolean().default(true).describe(
    "If true (default), the canvas is wiped via fileNew(false) before opening so the loaded file's devices fully replace the current canvas. If false, fileOpen MERGES the file into the live canvas (PT 9's native behavior).",
  ),
};

// PT 9 encrypts .pkt with per-file key derivation; the leading bytes are
// not a stable magic and cannot be checked server-side. Validity is decided
// by FileOpenReturnValue=0 from PT.
const MIN_PKT_SIZE = 64;

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

export const registerOpenPktTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_open_pkt",
    "Open a .pkt file into the active PT workspace via AppWindow.fileOpen. PT's native fileOpen MERGES the file with the existing canvas; pass replace=true (default) to wipe the canvas first via fileNew(false). PT 9 encrypts .pkt with per-file key derivation so the leading bytes are not a stable magic; validity is decided by FileOpenReturnValue=0 from PT. Returns deviceCount before/after.",
    InputSchema,
    async ({ path, replace }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      if (!isAbsolute(path)) {
        return errorResult(`pt_open_pkt requires an absolute path, got '${path}'.`);
      }
      if (!path.toLowerCase().endsWith(".pkt")) {
        return errorResult(`pt_open_pkt only handles .pkt files (pkz unsupported); got '${path}'.`);
      }

      // Verify the file exists either via the server filesystem or via PT,
      // and is at least MIN_PKT_SIZE bytes (no stable magic to check).
      const fsSeesIt = existsSync(path);
      if (!fsSeesIt) {
        const ptExists = await bridge.sendAndWait(fileExistsJs(path), { timeoutMs: 5_000 });
        const ptErr = checkPtReply(ptExists);
        if (ptErr) return ptErr;
        if ((ptExists ?? "").trim() !== "true") {
          return errorResult(`File not found at ${path} (neither server fs nor PT can see it).`);
        }
      }
      const sizeReply = await bridge.sendAndWait(getFileSizeJs(path), { timeoutMs: 5_000 });
      const sz = parseInt((sizeReply ?? "").trim(), 10);
      if (!Number.isFinite(sz) || sz < MIN_PKT_SIZE) {
        return errorResult(`File at ${path} reports size=${sizeReply ?? "<null>"} via PT — too small to be a real .pkt (min ${MIN_PKT_SIZE} bytes).`);
      }

      const beforeCount = await readDeviceCount(bridge);
      const beforeNames = beforeCount > 0 ? await readDeviceNames(bridge) : [];

      if (replace) {
        const newReply = await bridge.sendAndWait(fileNewJs(false), { timeoutMs: 10_000 });
        const ptErr = checkPtReply(newReply);
        if (ptErr) return ptErr;
        if (!newReply || !newReply.startsWith("OK|")) {
          return errorResult(`fileNew(false) did not run cleanly: ${(newReply ?? "<null>").slice(0, 200)}`);
        }
        const ok = newReply.slice("OK|".length).trim() === "true";
        if (!ok) {
          return errorResult(`fileNew(false) returned false; PT refused to clear the canvas.`);
        }
      }

      const openReply = await bridge.sendAndWait(fileOpenJs(path), { timeoutMs: 30_000 });
      const ptErr = checkPtReply(openReply);
      if (ptErr) return ptErr;
      if (!openReply || !openReply.startsWith("OK|")) {
        return errorResult(`fileOpen did not run cleanly: ${(openReply ?? "<null>").slice(0, 200)}`);
      }
      // Reply is "OK|<typeof>|<value>"; FileOpenReturnValue 0 == OK.
      const tail = openReply.slice("OK|".length).split("|");
      const retValue = tail.length >= 2 ? tail[1] : "";
      if (retValue !== "0") {
        return errorResult(`fileOpen returned non-zero FileOpenReturnValue: ${retValue}. PT refused to load the file.`);
      }

      const afterCount = await readDeviceCount(bridge);
      const afterNames = afterCount > 0 ? await readDeviceNames(bridge) : [];

      const delta = afterCount - (replace ? 0 : beforeCount);
      const lines = [
        `Opened ${path} (${replace ? "replace" : "merge"} mode).`,
        `Devices before: ${beforeCount}, after: ${afterCount} (Δ=${delta >= 0 ? "+" : ""}${delta}).`,
      ];
      if (replace && beforeNames.length > 0) {
        lines.push(`Cleared from canvas: ${beforeNames.slice(0, 25).join(", ")}${beforeNames.length > 25 ? ` (+${beforeNames.length - 25} more)` : ""}.`);
      }
      if (afterNames.length > 0) {
        lines.push(`Now on canvas: ${afterNames.slice(0, 25).join(", ")}${afterNames.length > 25 ? ` (+${afterNames.length - 25} more)` : ""}.`);
      }
      return textResult(lines.join("\n"));
    },
  );
};
