import { z } from "zod";
import { captureSnapshot } from "../canvas/snapshot.js";
import { diffSnapshots, summarizeDiff } from "../canvas/diff.js";
import { loadSnapshot } from "../persistence/snapshots.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  name: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/).describe("Snapshot identifier to load and diff against the live canvas."),
};

export const registerLoadSnapshotTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_load_snapshot",
    "Load a saved snapshot and diff it against the live workspace. Reports added/removed/changed devices, ports, and links since the snapshot was taken.",
    InputSchema,
    async ({ name }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const saved = await loadSnapshot(name);
        const live = await captureSnapshot(bridge);
        const diff = diffSnapshots(saved.snapshot, live);
        const header = `Diff between snapshot '${saved.name}' (captured ${saved.snapshot.capturedAt}) and live canvas (${live.capturedAt}):\n`;
        return textResult(header + summarizeDiff(diff));
      } catch (err) {
        return errorResult(`load snapshot failed: ${(err as Error).message}`);
      }
    },
  );
};
