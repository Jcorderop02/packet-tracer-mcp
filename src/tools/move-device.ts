import { z } from "zod";
import { moveDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  name: z.string().min(1).describe("Device to move."),
  x: z.number().describe("New X coordinate on the logical canvas."),
  y: z.number().describe("New Y coordinate on the logical canvas."),
};

export const registerMoveDeviceTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_move_device",
    "Reposition a device on the logical canvas via Device.moveToLocation(x, y).",
    InputSchema,
    async ({ name, x, y }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const result = await bridge.sendAndWait(moveDeviceJs(name, x, y), { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device: name });
      if (err) return err;
      if (result !== "OK") return errorResult(`Unexpected reply: ${result}`);
      return textResult(`Moved '${name}' to (${x},${y}).`);
    },
  );
};
