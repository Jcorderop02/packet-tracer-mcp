import { z } from "zod";
import { setDevicePowerJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  device: z.string().min(1).describe("Device name on the live canvas."),
  on: z.boolean().describe("Target power state: true=on, false=off."),
};

export const registerSetDevicePowerTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_set_device_power",
    "Toggle a device's power switch (Device.setPower). Idempotent: returns 'already' when the requested state is already in effect. After power-on the boot dialog is dismissed via skipBoot.",
    InputSchema,
    async ({ device, on }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(setDevicePowerJs(device, on), { timeoutMs: 8_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);
      return textResult(`Device '${device}' power → ${on ? "on" : "off"} (${reply})`);
    },
  );
};
