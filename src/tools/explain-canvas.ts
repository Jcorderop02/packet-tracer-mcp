import { captureSnapshot } from "../canvas/snapshot.js";
import { explainCanvas } from "../recipes/explain.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerExplainCanvasTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_explain_canvas",
    "Render a human-readable narration of the live workspace: inventory counts, per-router subnets, dangling addresses. Read-only.",
    {},
    async () => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const snap = await captureSnapshot(bridge);
        return textResult(explainCanvas(snap));
      } catch (err) {
        return errorResult(`explain failed: ${(err as Error).message}`);
      }
    },
  );
};
