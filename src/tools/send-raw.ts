import { z } from "zod";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { withLabel, truncateForLabel } from "../ipc/label.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  code: z.string().min(1).describe("JS expression evaluated inside PT's Script Engine. Implicitly wrapped, so you can use 'return ...'."),
  wait: z.boolean().optional().describe("If true (default) wait for the return value; if false, fire-and-forget."),
  timeout_ms: z.number().int().positive().max(60_000).optional(),
};

export const registerSendRawTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_send_raw",
    "Escape hatch: ship arbitrary JS to PT's Script Engine. Useful when no specialised tool covers what you need yet — call e.g. 'return ipc.network().getDeviceCount();'. Prefer the typed tools when they exist.",
    InputSchema,
    async ({ code, wait, timeout_ms }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const rawLabel = `pt_send_raw → ${truncateForLabel(code, 60)}`;

      if (wait === false) {
        bridge.enqueue(withLabel(rawLabel, code));
        return textResult("queued (fire-and-forget)");
      }

      const result = await bridge.sendAndWait(code, { timeoutMs: timeout_ms ?? 10_000, label: rawLabel });
      if (result === null) return errorResult("Timed out waiting for PT to answer.");
      return textResult(result);
    },
  );
};
