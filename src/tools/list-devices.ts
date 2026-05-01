import { listAliases, listModels } from "../catalog/devices.js";
import { textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerListDevicesTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_list_devices",
    "Enumerate the device models that packet-tracer-mcp knows how to instantiate, with their port lists and the alias shortcuts accepted by other tools.",
    {},
    async () => {
      const lines: string[] = [];
      for (const m of listModels()) {
        lines.push(`${m.displayName} [pt_type=${m.ptType}, category=${m.category}]`);
        const ports = m.ports.map(p => p.fullName).join(", ");
        lines.push(`  ports: ${ports}`);
      }
      lines.push("", "Aliases:");
      for (const [alias, target] of Object.entries(listAliases())) {
        lines.push(`  ${alias} -> ${target}`);
      }
      return textResult(lines.join("\n"));
    },
  );
};
