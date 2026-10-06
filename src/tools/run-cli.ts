import { z } from "zod";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  device: z.string().min(1).describe("Router or switch name."),
  command: z.string().min(1).describe("CLI command, e.g. 'show ip interface brief'."),
  mode: z.string().optional().describe("Optional mode hint: '', 'enable' or 'global'. Empty string auto-detects."),
};

export const registerRunCliTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_run_cli",
    "Send a CLI command to a router or switch and return the slice of console output produced by it. Uses the device's getCommandLine().enterCommand() entry point.",
    InputSchema,
    async ({ device, command, mode }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      try {
        const prefix = mode === "global" ? ["enable", "configure terminal"] : mode === "enable" ? ["enable"] : [];
        const replies = await runCliBlock(bridge, device, [...prefix, command]);
        const failed = replies.some(r => r.timedOut || r.errors.length);
        return (failed ? errorResult : textResult)(JSON.stringify(replies, null, 2));
      } catch (e) { return errorResult(String(e)); }

    },
  );
};
