import { z } from "zod";
import { resolveModel } from "../catalog/devices.js";
import { captureSnapshot } from "../canvas/snapshot.js";
import { nextSlotForCategory } from "../canvas/layout.js";
import { addDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  name: z.string().min(1).describe("Final name to assign to the device, e.g. 'R1'."),
  model: z.string().min(1).describe("PT model (e.g. '2911', 'PC-PT') or one of the aliases from pt_list_devices."),
  x: z.number().optional().describe(
    "Logical-view X coordinate. Optional — when omitted, the server places the " +
    "device on a clean grid based on its category (router=top row, switch=mid, " +
    "endpoints=bottom). Recommended: leave x/y blank unless you have a specific " +
    "reason to override placement; manual coordinates often produce ugly canvases.",
  ),
  y: z.number().optional().describe(
    "Logical-view Y coordinate. Optional — see `x` for the auto-placement policy.",
  ),
};

const DESCRIPTION =
  "Place a single device in the active Logical workspace and rename it to the " +
  "requested name. Coordinates are in PT's logical canvas units. " +
  "Auto-placement policy when x/y are omitted: routers at y=100, accesspoints " +
  "at y=175, switches at y=250, endpoints at y=400, servers at y=480, clouds at " +
  "y=20; X advances 250 units per slot in the same row. The server reads the " +
  "live canvas to pick the next free column for the device's category. To get " +
  "a clean topology pass x/y for nothing — let the grid do the work, then call " +
  "pt_auto_layout at the end if you want to re-align everything.";

export const registerAddDeviceTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_add_device",
    DESCRIPTION,
    InputSchema,
    async ({ name, model, x, y }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const resolved = resolveModel(model);
      if (!resolved) return errorResult(`Unknown model '${model}'. Run pt_list_devices to see what is available.`);

      let finalX = x;
      let finalY = y;
      let autoPlaced = false;
      if (finalX === undefined || finalY === undefined) {
        const snap = await captureSnapshot(bridge);
        const slot = nextSlotForCategory(snap, resolved.category);
        finalX = finalX ?? slot.x;
        finalY = finalY ?? slot.y;
        autoPlaced = true;
      }

      const js = addDeviceJs({ name, category: resolved.category, model: resolved.ptType, x: finalX, y: finalY });
      const result = await bridge.sendAndWait(js, { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device: name });
      if (err) return err;
      const placement = autoPlaced ? `auto-grid (${finalX},${finalY})` : `(${finalX},${finalY})`;
      return textResult(`Added ${resolved.displayName} as '${result}' at ${placement}.`);
    },
  );
};
