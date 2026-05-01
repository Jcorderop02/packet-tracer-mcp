import { z } from "zod";
import { runShowRunning } from "../sim/runner.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  devices: z.array(z.string().min(1)).min(1).max(20)
    .describe("Routers/switches to dump. Each name is queried separately."),
  section: z.string().optional()
    .describe("Optional `| section <pattern>` filter — e.g. 'ipv6', 'interface GigabitEthernet0/0', 'router ospf'."),
  tail_chars: z.number().int().min(1_000).max(20_000).default(6_000)
    .describe("Per-device cap on captured output length (chars)."),
};

export const registerShowRunningTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_show_running",
    "Capture `show running-config` (optionally filtered by `| section`) on one or more devices. Returns a banner per device followed by its captured config slice. Useful for snapshotting state, diffing recipes, or confirming an applier landed on PT real.",
    InputSchema,
    async ({ devices, section, tail_chars }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      const blocks: string[] = [];
      const errors: string[] = [];
      for (const device of devices) {
        try {
          const out = await runShowRunning(bridge, device, section, tail_chars);
          const header = section
            ? `=== ${device} :: show running-config | section ${section} ===`
            : `=== ${device} :: show running-config ===`;
          blocks.push(`${header}\n${out || "(empty)"}`);
        } catch (e) {
          errors.push(`${device}: ${(e as Error).message}`);
        }
      }
      if (blocks.length === 0) {
        return errorResult(`pt_show_running failed on every device:\n${errors.join("\n")}`);
      }
      const trailer = errors.length > 0 ? `\n\n--- errors ---\n${errors.join("\n")}` : "";
      return textResult(blocks.join("\n\n") + trailer);
    },
  );
};
