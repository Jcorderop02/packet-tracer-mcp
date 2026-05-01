import { captureSnapshot } from "../canvas/snapshot.js";
import { inspect, summarizeIssues } from "../canvas/inspect.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerInspectCanvasTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_inspect_canvas",
    "Snapshot the live workspace and report duplicate IPs, unaddressed router uplinks, mismatched router-peer subnets, and similar findings. Read-only.",
    {},
    async () => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const snap = await captureSnapshot(bridge);
        const issues = inspect(snap);
        return textResult(summarizeIssues(issues));
      } catch (err) {
        return errorResult(`inspection failed: ${(err as Error).message}`);
      }
    },
  );
};
