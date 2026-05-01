import { z } from "zod";
import { runPing } from "../sim/runner.js";
import { summarizePing } from "../sim/parsers.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  device: z.string().min(1).describe("Device that originates the ping (PC name or router/switch name)."),
  target: z.string().min(1).describe("Destination IPv4 or IPv6 address (e.g. 192.168.1.1, 2001:DB8:1::1)."),
  timeout_ms: z.number().int().min(5_000).max(60_000).default(25_000)
    .describe("How long to wait for the device to finish printing the ping output."),
};

export const registerPingTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_ping",
    "Run `ping <target>` on a device (PC or router) and return the parsed result: sent/received/lost/success rate plus the raw transcript. Auto-detects PC vs router output format.",
    InputSchema,
    async ({ device, target, timeout_ms }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const { raw, result } = await runPing(bridge, device, target, { timeoutMs: timeout_ms });
        const summary = summarizePing(result);
        const detail =
          `${summary}\n` +
          `source=${result.source}, sent=${result.sent}, received=${result.received}, lost=${result.lost}, successRate=${result.successRate}\n` +
          `--- raw ---\n${raw || "(no output captured)"}`;
        return textResult(detail);
      } catch (e) {
        return errorResult(`pt_ping failed on ${device} → ${target}: ${(e as Error).message}`);
      }
    },
  );
};
