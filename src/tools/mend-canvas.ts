import { mendCanvas, summarizeMend } from "../recipes/mend.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerMendCanvasTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_mend_canvas",
    "Inspect the live workspace and apply safe, conservative repairs (e.g. powering on devices that have active links). Reports remaining issues that need a human decision.",
    {},
    async () => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      try {
        const report = await mendCanvas(bridge);
        return textResult(summarizeMend(report));
      } catch (err) {
        return errorResult(`mend failed: ${(err as Error).message}`);
      }
    },
  );
};
