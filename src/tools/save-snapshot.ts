import { z } from "zod";
import { captureSnapshot } from "../canvas/snapshot.js";
import { saveSnapshot } from "../persistence/snapshots.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  name: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/).describe("Snapshot identifier; only letters, digits, dot, dash, underscore."),
};

export const registerSaveSnapshotTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_save_snapshot",
    "Capture the current live workspace and persist it to disk under the given name. Useful for diff/audit later.",
    InputSchema,
    async ({ name }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const snap = await captureSnapshot(bridge);
        const meta = await saveSnapshot({ name, snapshot: snap });
        return textResult(
          `Saved snapshot '${meta.name}' to ${meta.path}: ` +
          `${meta.devices} device(s), ${meta.links} link(s), captured ${meta.capturedAt}.`,
        );
      } catch (err) {
        return errorResult(`save snapshot failed: ${(err as Error).message}`);
      }
    },
  );
};
