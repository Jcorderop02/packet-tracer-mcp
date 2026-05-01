import { z } from "zod";
import { describeDeviceJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface PortInfo {
  readonly port: string;
  readonly ip: string;
  readonly mask: string;
  readonly connected: boolean;
}

interface DeviceDetails {
  readonly model: string;
  readonly type: string;
  readonly power: boolean;
  readonly ports: PortInfo[];
}

/**
 * Parse the pipe-separated rows produced by describeDeviceJs into a typed
 * structure. The format is fixed by the generator and covered by its tests.
 */
function parseDetails(raw: string): DeviceDetails {
  const ports: PortInfo[] = [];
  let model = "";
  let type = "";
  let power = false;

  for (const line of raw.split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "MODEL" && parts[1] !== undefined) model = parts[1];
    else if (parts[0] === "TYPE" && parts[1] !== undefined) type = parts[1];
    else if (parts[0] === "POWER" && parts[1] !== undefined) power = parts[1] === "true";
    else if (parts[0] === "PORT" && parts.length >= 5) {
      ports.push({
        port: parts[1] ?? "",
        ip: parts[2] ?? "",
        mask: parts[3] ?? "",
        connected: parts[4] === "1",
      });
    }
  }
  return { model, type, power, ports };
}

const InputSchema = {
  name: z.string().min(1).describe("Device name to inspect."),
};

export const registerGetDeviceDetailsTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_get_device_details",
    "Inspect a single device: model, type, power state, and live port-by-port snapshot (IP, mask, connection state).",
    InputSchema,
    async ({ name }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const raw = await bridge.sendAndWait(describeDeviceJs(name), { timeoutMs: 15_000 });
      if (raw === null) return errorResult("Timed out waiting for PT to answer.");
      if (raw === "ERR:not_found") return errorResult(`Device '${name}' not found.`);
      if (raw.startsWith("ERROR:")) return errorResult(`PT raised: ${raw}`);

      const details = parseDetails(raw);
      const lines: string[] = [
        `Device: ${name}`,
        `Model:  ${details.model}`,
        `Type:   ${details.type}`,
        `Power:  ${details.power ? "on" : "off"}`,
        `Ports (${details.ports.length}):`,
      ];
      for (const p of details.ports) {
        const ipPart = p.ip ? ` ${p.ip}/${p.mask}` : "";
        lines.push(`  - ${p.port}${ipPart} ${p.connected ? "[linked]" : "[free]"}`);
      }
      return textResult(lines.join("\n"));
    },
  );
};
