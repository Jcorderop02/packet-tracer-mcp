import { z } from "zod";
import { enterCommandJs } from "../ipc/generator.js";
import { requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
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

      const js = enterCommandJs(device, command, mode ?? "");
      const result = await bridge.sendAndWait(js, { timeoutMs: 15_000 });
      const err = checkPtReply(result, { device });
      if (err) return err;
      return textResult(result && result.length > 0 ? result : "(empty output)");
    },
  );
};
