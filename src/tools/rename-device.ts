import { z } from "zod";
import { linkRegistry } from "../canvas/link-registry.js";
import { renameDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  old_name: z.string().min(1).describe("Current device name."),
  new_name: z.string().min(1).describe("Desired new name."),
};

export const registerRenameDeviceTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_rename_device",
    "Rename a device. Refuses if the new name is already taken so you don't accidentally collapse two devices into one.",
    InputSchema,
    async ({ old_name, new_name }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      if (old_name === new_name) return textResult("Old and new name match — nothing to do.");

      const result = await bridge.sendAndWait(renameDeviceJs(old_name, new_name), { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device: old_name });
      if (err) return err;
      if (result !== "OK") return errorResult(`Unexpected reply: ${result}`);
      linkRegistry.renameDevice(old_name, new_name);
      return textResult(`Renamed '${old_name}' -> '${new_name}'.`);
    },
  );
};
