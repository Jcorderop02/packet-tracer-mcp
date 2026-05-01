import { z } from "zod";
import { runTraceroute } from "../sim/runner.js";
import { summarizeTraceroute } from "../sim/parsers.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  device: z.string().min(1).describe("Device that originates the trace (PC or router)."),
  target: z.string().min(1).describe("Destination IPv4 or IPv6 address."),
  timeout_ms: z.number().int().min(15_000).max(120_000).default(60_000)
    .describe("How long to wait for the trace to finish printing."),
};

export const registerTracerouteTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_traceroute",
    "Run `traceroute`/`tracert` on a device and return the parsed hop list. Sends both command names so it works on PCs (tracert) and IOS routers (traceroute); the wrong one is rejected by the parser and ignored.",
    InputSchema,
    async ({ device, target, timeout_ms }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const { raw, result } = await runTraceroute(bridge, device, target, { timeoutMs: timeout_ms });
        const summary = summarizeTraceroute(result);
        const detail =
          `${summary}\n` +
          `source=${result.source}, hops=${result.hops.length}, complete=${result.complete}\n` +
          `--- raw ---\n${raw || "(no output captured)"}`;
        return textResult(detail);
      } catch (e) {
        return errorResult(`pt_traceroute failed on ${device} → ${target}: ${(e as Error).message}`);
      }
    },
  );
};
