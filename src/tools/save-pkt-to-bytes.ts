import { createHash } from "node:crypto";
import { z } from "zod";
import {
  fileSaveAsNoPromptJs,
  getFileBinaryContentsChunkJs,
  getFileBinaryLengthJs,
  getFileCheckSumJs,
  getFileSizeJs,
  getPtTempDirJs,
  removeFileJs,
} from "../ipc/files.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";
import type { Bridge } from "../bridge/http-bridge.js";

const InputSchema = {
  max_bytes: z.number().int().positive().default(5_000_000).describe(
    "Maximum decoded file size to accept (bytes). Default 5 MB; raise for unusually large canvases.",
  ),
};

// Each chunked read pulls this many base64 chars per request. Keep well
// below the bridge response budget for safety; probe-fase9b confirmed 4000
// chars per chunk works reliably and yields ~17 chunks for a 51 KB .pkt.
const CHUNK_B64_CHARS = 4000;
const POLL_MAX_MS = 30_000;
const POLL_TICK_MS = 200;
const POLL_STABLE_MS = 800;

function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  if (dir.includes("\\") && !dir.includes("/")) return dir + "\\" + name;
  return dir + "/" + name;
}

async function probePtSize(bridge: Bridge, path: string): Promise<number> {
  const r = await bridge.sendAndWait(getFileSizeJs(path), { timeoutMs: 5_000 });
  if (!r) return -1;
  if (r.startsWith("ERR:")) return -1;
  const n = parseInt(r.trim(), 10);
  return Number.isNaN(n) ? -1 : n;
}

async function pollPtSizeStable(bridge: Bridge, path: string): Promise<{ ok: boolean; size: number; tookMs: number; err?: string }> {
  const start = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  while (Date.now() - start < POLL_MAX_MS) {
    const sz = await probePtSize(bridge, path);
    if (sz > 0) {
      if (sz === lastSize) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= POLL_STABLE_MS) {
          return { ok: true, size: sz, tookMs: Date.now() - start };
        }
      } else {
        lastSize = sz;
        stableSince = 0;
      }
    }
    await new Promise(r => setTimeout(r, POLL_TICK_MS));
  }
  return { ok: false, size: lastSize, tookMs: Date.now() - start, err: "timeout" };
}

export const registerSavePktToBytesTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_save_pkt_to_bytes",
    "Save the active PT canvas and return the .pkt as base64 bytes (no permanent file). PT writes to a temp path inside its own user folder via fileSaveAsNoPrompt, the server reads the bytes back chunked through SystemFileManager.getFileBinaryContents, then PT removes the temp. Useful when the server and PT do not share a filesystem (remote PT) or the caller wants the bytes in-memory.",
    InputSchema,
    async ({ max_bytes }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      // 1) Pick a writable PT-side directory.
      const dirReply = await bridge.sendAndWait(getPtTempDirJs(), { timeoutMs: 5_000 });
      const dirErr = checkPtReply(dirReply);
      if (dirErr) return dirErr;
      if (!dirReply || !dirReply.startsWith("DIR|")) {
        return errorResult(`Could not resolve a writable PT-side directory: ${(dirReply ?? "<null>").slice(0, 200)}`);
      }
      const ptDir = dirReply.slice("DIR|".length);
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const tempPath = joinPath(ptDir, `pt-mcp-bytes-${stamp}.pkt`);

      // 2) Save the canvas to that path.
      const saveReply = await bridge.sendAndWait(fileSaveAsNoPromptJs(tempPath), { timeoutMs: 10_000 });
      const ptErr = checkPtReply(saveReply);
      if (ptErr) return ptErr;
      if (!saveReply || saveReply.trim() !== "OK") {
        return errorResult(`fileSaveAsNoPrompt did not dispatch cleanly: ${(saveReply ?? "<null>").slice(0, 200)}`);
      }

      // 3) Wait for PT to flush.
      const stable = await pollPtSizeStable(bridge, tempPath);
      if (!stable.ok) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`Timed out waiting for PT to flush ${tempPath} (last size=${stable.size}).`);
      }
      if (stable.size > max_bytes) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`File size ${stable.size} bytes exceeds max_bytes=${max_bytes}. Use pt_save_pkt(path) for large canvases.`);
      }

      // 4) Fetch the total base64 length, then read in chunks.
      const lenReply = await bridge.sendAndWait(getFileBinaryLengthJs(tempPath), { timeoutMs: 10_000 });
      const lenErr = checkPtReply(lenReply);
      if (lenErr) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return lenErr;
      }
      const totalB64Len = parseInt((lenReply ?? "").trim(), 10);
      if (!Number.isFinite(totalB64Len) || totalB64Len <= 0) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`getFileBinaryContents returned empty/invalid base64 length: ${lenReply}`);
      }

      let assembled = "";
      for (let off = 0; off < totalB64Len; off += CHUNK_B64_CHARS) {
        const chunkReply = await bridge.sendAndWait(
          getFileBinaryContentsChunkJs(tempPath, off, CHUNK_B64_CHARS),
          { timeoutMs: 15_000 },
        );
        if (!chunkReply || chunkReply.startsWith("ERR:")) {
          await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
          return errorResult(`Chunk read failed at offset ${off}: ${(chunkReply ?? "<null>").slice(0, 200)}`);
        }
        assembled += chunkReply;
      }
      if (assembled.length !== totalB64Len) {
        await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 }).catch(() => {});
        return errorResult(`Reassembled base64 length=${assembled.length} != reported total=${totalB64Len}.`);
      }

      // 5) Cross-check via PT's own SHA-1.
      const sumReply = await bridge.sendAndWait(getFileCheckSumJs(tempPath), { timeoutMs: 10_000 });
      const ptSha1 = sumReply && !sumReply.startsWith("ERR:") ? sumReply.trim().toLowerCase() : "";
      const decoded = Buffer.from(assembled, "base64");
      const serverSha1 = createHash("sha1").update(decoded).digest("hex");
      const sha1Match = !ptSha1 || ptSha1 === serverSha1;

      // 6) Cleanup.
      const rmReply = await bridge.sendAndWait(removeFileJs(tempPath), { timeoutMs: 5_000 });
      const cleaned = (rmReply ?? "").trim() === "true";

      if (!sha1Match) {
        return errorResult(
          `SHA-1 mismatch between PT (${ptSha1}) and server-decoded bytes (${serverSha1}). ` +
          `Temp ${cleaned ? "cleaned" : "left"} at ${tempPath}.`,
        );
      }
      if (decoded.length !== stable.size) {
        return errorResult(
          `Decoded byte length ${decoded.length} != PT-reported size ${stable.size}. ` +
          `Temp ${cleaned ? "cleaned" : "left"} at ${tempPath}.`,
        );
      }

      const lines = [
        `Captured ${decoded.length} bytes (.pkt) from active canvas.`,
        `SHA-1: ${serverSha1}.`,
        `Base64 length: ${assembled.length} chars.`,
        cleaned ? `PT temp removed.` : `(warn) PT temp not removed at ${tempPath}.`,
        ``,
        `--- BEGIN .pkt base64 ---`,
        assembled,
        `--- END .pkt base64 ---`,
      ];
      return textResult(lines.join("\n"));
    },
  );
};
