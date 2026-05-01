import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { workspaceImageBase64Js } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  format: z.enum(["PNG", "JPG"]).default("PNG").describe("Image format. PNG is lossless and ~half the bytes for the same canvas."),
  output_path: z.string().optional().describe(
    "Where to save the image. Relative paths resolve against `docs/screenshots/`. If omitted, the file is written to `docs/screenshots/pt-<timestamp>.<ext>`.",
  ),
};

const SCREENSHOTS_DIR = "docs/screenshots";

function resolveOutputPath(input: string | undefined, format: "PNG" | "JPG"): string {
  const ext = format.toLowerCase();
  if (input && isAbsolute(input)) return input;
  if (input) return join(SCREENSHOTS_DIR, input);
  const ts = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
  return join(SCREENSHOTS_DIR, `pt-${ts}.${ext}`);
}

export const registerScreenshotTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_screenshot",
    "Capture the Logical workspace as a PNG/JPG file via LogicalWorkspace.getWorkspaceImage. Returns the path of the saved file. The image is base64-streamed over the bridge then decoded and written on disk by the server.",
    InputSchema,
    async ({ format, output_path }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(workspaceImageBase64Js(format), { timeoutMs: 30_000 });
      const err = checkPtReply(reply);
      if (err) return err;
      if (!reply || !reply.startsWith("B64|")) {
        return errorResult(`Unexpected reply from getWorkspaceImage: ${(reply ?? "<null>").slice(0, 80)}`);
      }
      const b64 = reply.slice("B64|".length);
      const buf = Buffer.from(b64, "base64");
      if (buf.length === 0) {
        return errorResult("getWorkspaceImage returned empty bytes after base64 decode.");
      }

      const target = resolveOutputPath(output_path, format);
      try {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, buf);
      } catch (e) {
        return errorResult(`Failed to write screenshot to ${target}: ${(e as Error).message}`);
      }
      return textResult(`Saved ${format} screenshot (${buf.length} bytes) to ${target}.`);
    },
  );
};
