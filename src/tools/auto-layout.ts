import { z } from "zod";
import { captureSnapshot } from "../canvas/snapshot.js";
import { gridLayoutCanvas } from "../canvas/layout.js";
import { moveDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  dryRun: z.boolean().optional().describe(
    "When true, return the planned moves without applying them. Useful for " +
    "previewing the new layout before committing.",
  ),
};

const DESCRIPTION =
  "Re-grid the entire live canvas into a clean topology-aware layout. " +
  "Reads every device, classifies it (router / switch / AP / endpoint / " +
  "server / cloud), and assigns coordinates by category row plus column " +
  "alignment with the parent device (switches column-aligned with their " +
  "router, endpoints with their switch). Use this after the AI has built a " +
  "topology with manual coordinates to make it look like a recipe-built " +
  "lab. Idempotent: running it twice on the same canvas is a no-op.";

export const registerAutoLayoutTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_auto_layout",
    DESCRIPTION,
    InputSchema,
    async ({ dryRun }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const snap = await captureSnapshot(bridge);
      const moves = gridLayoutCanvas(snap);

      if (moves.length === 0) {
        return textResult(`Layout already grid-aligned (${snap.devices.length} devices, 0 moves).`);
      }

      if (dryRun) {
        const lines = moves.map(m => `  ${m.name} -> (${m.x},${m.y})`);
        return textResult(`Planned ${moves.length} moves (dry-run):\n${lines.join("\n")}`);
      }

      const failures: string[] = [];
      for (const move of moves) {
        const reply = await bridge.sendAndWait(moveDeviceJs(move.name, move.x, move.y), { timeoutMs: 5_000 });
        if (reply === null || (typeof reply === "string" && reply.startsWith("ERR"))) {
          failures.push(`${move.name}: ${reply ?? "timeout"}`);
        }
      }

      if (failures.length > 0) {
        return errorResult(
          `Applied ${moves.length - failures.length}/${moves.length} moves. Failures:\n${failures.join("\n")}`,
        );
      }
      return textResult(`Re-gridded ${moves.length} device(s) across ${snap.devices.length} placed.`);
    },
  );
};
