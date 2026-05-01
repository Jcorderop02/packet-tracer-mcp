import { listSnapshots, snapshotRoot } from "../persistence/snapshots.js";
import { errorResult, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerListSnapshotsTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_list_snapshots",
    "List every persisted canvas snapshot, sorted from newest to oldest.",
    {},
    async () => {
      try {
        const list = await listSnapshots();
        if (list.length === 0) return textResult(`No snapshots stored under ${snapshotRoot()}.`);
        const lines: string[] = [`Snapshots in ${snapshotRoot()} (${list.length}):`, ""];
        for (const m of list) {
          lines.push(
            `- ${m.name} — ${m.devices} device(s), ${m.links} link(s), captured ${m.capturedAt}` +
            (m.hasBlueprint ? " (with blueprint)" : ""),
          );
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`list snapshots failed: ${(err as Error).message}`);
      }
    },
  );
};
