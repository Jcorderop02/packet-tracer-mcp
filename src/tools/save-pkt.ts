import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import {
  fileExistsJs,
  fileSaveAsNoPromptJs,
  getFileCheckSumJs,
  getFileSizeJs,
} from "../ipc/files.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";
import type { Bridge } from "../bridge/http-bridge.js";

const InputSchema = {
  path: z.string().min(1).describe(
    "Absolute filesystem path where the .pkt should be written. Parent directory is created if missing. Existing files are overwritten without confirmation.",
  ),
  overwrite: z.boolean().default(true).describe(
    "If false and the target file already exists, the tool fails before calling PT. Default true (matches fileSaveAsNoPrompt semantics).",
  ),
};

const POLL_MAX_MS = 30_000;
const POLL_TICK_MS = 200;
const POLL_STABLE_MS = 800;

interface SizeProbe { size: number; err?: string; }

async function probeSize(bridge: Bridge, path: string): Promise<SizeProbe> {
  const reply = await bridge.sendAndWait(getFileSizeJs(path), { timeoutMs: 5_000 });
  if (!reply) return { size: -1, err: "no_reply" };
  if (reply.startsWith("ERR:")) return { size: -1, err: reply.slice(4) };
  const n = parseInt(reply.trim(), 10);
  if (Number.isNaN(n)) return { size: -1, err: `bad_size:${reply.slice(0, 80)}` };
  return { size: n };
}

async function pollStable(bridge: Bridge, path: string): Promise<{ ok: boolean; size: number; tookMs: number; err?: string }> {
  const start = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  while (Date.now() - start < POLL_MAX_MS) {
    const p = await probeSize(bridge, path);
    if (p.size > 0) {
      if (p.size === lastSize) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= POLL_STABLE_MS) {
          return { ok: true, size: p.size, tookMs: Date.now() - start };
        }
      } else {
        lastSize = p.size;
        stableSince = 0;
      }
    }
    await new Promise(r => setTimeout(r, POLL_TICK_MS));
  }
  return { ok: false, size: lastSize, tookMs: Date.now() - start, err: "timeout" };
}

export const registerSavePktTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_save_pkt",
    "Save the active PT canvas to a .pkt file at an absolute path via AppWindow.fileSaveAsNoPrompt. Returns the final size in bytes and a SHA-1 checksum for verification. Pkz format is intentionally not supported (PT 9 silently fails to write it).",
    InputSchema,
    async ({ path, overwrite }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      if (!isAbsolute(path)) {
        return errorResult(`pt_save_pkt requires an absolute path, got '${path}'.`);
      }
      if (!path.toLowerCase().endsWith(".pkt")) {
        return errorResult(`pt_save_pkt only writes .pkt files (pkz unsupported); got '${path}'.`);
      }

      if (!overwrite) {
        const existsReply = await bridge.sendAndWait(fileExistsJs(path), { timeoutMs: 5_000 });
        const ptErr = checkPtReply(existsReply);
        if (ptErr) return ptErr;
        if (existsReply && existsReply.trim() === "true") {
          return errorResult(`File already exists at ${path}. Pass overwrite=true to replace it.`);
        }
      }

      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch (e) {
        return errorResult(`Failed to create parent directory for ${path}: ${(e as Error).message}`);
      }

      const saveReply = await bridge.sendAndWait(fileSaveAsNoPromptJs(path), { timeoutMs: 10_000 });
      const ptErr = checkPtReply(saveReply);
      if (ptErr) return ptErr;
      if (!saveReply || saveReply.trim() !== "OK") {
        return errorResult(`fileSaveAsNoPrompt did not dispatch cleanly: ${(saveReply ?? "<null>").slice(0, 200)}`);
      }

      const stable = await pollStable(bridge, path);
      if (!stable.ok) {
        return errorResult(
          `Timed out waiting for ${path} to become stable after fileSaveAsNoPrompt ` +
          `(last size=${stable.size}, ${stable.tookMs}ms). PT may still be writing or the path is not visible.`,
        );
      }

      const sumReply = await bridge.sendAndWait(getFileCheckSumJs(path), { timeoutMs: 10_000 });
      let sha1 = "";
      if (sumReply && !sumReply.startsWith("ERR:")) sha1 = sumReply.trim().toLowerCase();

      // Cross-check existence via fs (best-effort, only if PT and server share the filesystem).
      const fsSeesIt = existsSync(path);

      return textResult(
        `Saved ${stable.size} bytes to ${path} in ${stable.tookMs}ms. ` +
        (sha1 ? `SHA-1: ${sha1}. ` : "") +
        (fsSeesIt ? "Server filesystem confirms the file." : "Server filesystem cannot see the file (PT-only path)."),
      );
    },
  );
};
