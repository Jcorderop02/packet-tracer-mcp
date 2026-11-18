import { z } from "zod";
import { makeGuard, nativeCall } from "./integration-common.js";
import { listAliases, listModels } from "../catalog/devices.js";
import { textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerListDevicesTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool(
    "pt_list_devices",
    "List supported models in the MCP catalog, or enumerate the installed Packet Tracer palette by category.",
    { source: z.enum(["catalog", "palette"]).default("catalog") },
    async ({ source }) => {
      if (source === "palette") return guard(async () => {
        const result = JSON.parse(await nativeCall(bridge, `(function(){
          var box=ipc.appWindow().getNetworkComponentBox(),types=box.getDeviceTypes(),rows=[];
          for(var i=0;i<types.length;i++){
            var models=box.getDeviceModels(types[i]),names=[];
            for(var j=0;j<models.length;j++)names.push(String(models[j]));
            rows.push({category:String(types[i]),models:names});
          }
          return JSON.stringify(rows);
        })()`)) as { category: string; models: string[] }[];
        const supported = new Set(listModels().map(model => model.ptType));
        return JSON.stringify(result.map(category => ({
          category: category.category,
          models: category.models.map(name => ({ name, supported: supported.has(name) })),
        })));
      });
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
