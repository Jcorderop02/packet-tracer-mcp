import { z } from "zod";
import { diffSnapshots, summarizeDiff } from "../canvas/diff.js";
import { captureSnapshot } from "../canvas/snapshot.js";
import type { CanvasSnapshot } from "../canvas/types.js";
import { loadSnapshot } from "../persistence/snapshots.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * Compare two snapshots and report what changed. Either side can be:
 *   - a saved snapshot name (resolved via loadSnapshot)
 *   - the literal "live" — captures the live canvas at call time
 *
 * Common shapes:
 *   diff(before='2025-04-25-prod', after='live')   → "what drifted since"
 *   diff(before='backup', after='current')         → "what was rolled out"
 *   diff(before='live')                            → defaults after to 'live' (no-op)
 */
const InputSchema = {
  before: z.string().min(1).describe("Saved snapshot name, or 'live' to capture the canvas now."),
  after:  z.string().min(1).default("live").describe("Saved snapshot name, or 'live' (default) for the live canvas."),
};

async function resolveSide(
  side: string,
  bridge: Parameters<ToolModule>[0]["bridge"],
): Promise<{ ok: true; snap: CanvasSnapshot; label: string } | { ok: false; error: string }> {
  if (side === "live") {
    if (!bridge.status().connected) {
      return { ok: false, error: "Bridge not connected — cannot capture 'live'." };
    }
    try {
      return { ok: true, snap: await captureSnapshot(bridge), label: "live canvas" };
    } catch (err) {
      return { ok: false, error: `Failed to capture live snapshot: ${(err as Error).message}` };
    }
  }
  try {
    const loaded = await loadSnapshot(side);
    return { ok: true, snap: loaded.snapshot, label: `snapshot '${side}'` };
  } catch (err) {
    return { ok: false, error: `Failed to load snapshot '${side}': ${(err as Error).message}` };
  }
}

export const registerDiffSnapshotsTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_diff_snapshots",
    "Compare two snapshots (or one snapshot vs the live canvas) and describe what changed: added/removed devices and links, changed IPs, masks, link state and power state.",
    InputSchema,
    async ({ before, after }) => {
      const lhs = await resolveSide(before, bridge);
      if (!lhs.ok) return errorResult(lhs.error);
      const rhs = await resolveSide(after, bridge);
      if (!rhs.ok) return errorResult(rhs.error);

      if (before === "live" && after === "live") {
        // Avoid surprising users with a "no changes" report from racing two captures.
        const blocked = requireConnectedBridge(bridge);
        if (blocked) return blocked;
        return textResult("Both sides resolved to the live canvas — nothing to diff.");
      }

      const diff = diffSnapshots(lhs.snap, rhs.snap);
      const header = `Diff: ${lhs.label} → ${rhs.label}\n`;
      return textResult(header + summarizeDiff(diff));
    },
  );
};
