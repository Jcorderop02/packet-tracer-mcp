import { z } from "zod";
import { linkRegistry } from "../canvas/link-registry.js";
import { listDevicesJs, removeDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  name: z.string().min(1).describe("Exact device name to remove."),
};

export const registerDeleteDeviceTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_delete_device",
    "Remove a device (and all of its links) from the active workspace. Self-verifies the deletion by re-snapshotting the topology.",
    InputSchema,
    async ({ name }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      await bridge.sendAndWait(removeDeviceJs(name), { timeoutMs: 10_000 });

      const verify = await bridge.sendAndWait(listDevicesJs(), { timeoutMs: 10_000 });
      if (verify === null) return errorResult("Removal sent, but verification timed out.");
      const stillThere = verify.split("\n").some(line => line.split("|")[0] === name);
      if (stillThere) return errorResult(`PT still reports '${name}' present after removeDevice.`);
      linkRegistry.forgetDevice(name);
      return textResult(`Removed '${name}'.`);
    },
  );
};
