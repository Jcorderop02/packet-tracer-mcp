import { z } from "zod";
import { findRecipe } from "../recipes/index.js";
import {
  generateConfigs,
  summarizeGenerateConfigs,
} from "../recipes/generate-offline.js";
import { errorResult, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  recipe: z.string().min(1).describe("Recipe key (see pt_list_recipes)."),
  params: z.record(z.string(), z.unknown()).default({}).describe("Recipe-specific parameters."),
  format: z
    .enum(["summary", "json", "concat"])
    .default("summary")
    .describe(
      "summary: human report. json: structured devices array. concat: every device's IOS config back-to-back, banner-separated.",
    ),
};

export const registerGenerateConfigsTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_generate_configs",
    "Offline generator. Builds a recipe blueprint and synthesises the IOS CLI each device would receive — without touching PT or the bridge. Useful for documentation, classroom material, or replicating the lab on real hardware. Endpoints (PCs, APs, phones) get human-readable notes instead of CLI.",
    InputSchema,
    async ({ recipe, params, format }) => {
      const r = findRecipe(recipe);
      if (!r) return errorResult(`unknown recipe '${recipe}'. Try pt_list_recipes.`);
      try {
        const blueprint = r.build(params);
        const result = generateConfigs(blueprint);

        if (format === "summary") {
          return textResult(summarizeGenerateConfigs(result));
        }
        if (format === "concat") {
          const blocks: string[] = [];
          for (const d of result.devices) {
            blocks.push(`! === ${d.device} (${d.category} / ${d.model}) ===`);
            if (d.config.length > 0) blocks.push(d.config);
            for (const note of d.notes) blocks.push(`! note: ${note}`);
            blocks.push("");
          }
          return textResult(blocks.join("\n"));
        }
        // json
        const json = {
          blueprint: result.blueprint,
          devices: result.devices.map(d => ({
            device: d.device,
            model: d.model,
            category: d.category,
            config: d.config,
            notes: d.notes,
          })),
          allocations: {
            transit: Object.fromEntries(result.allocations.transit),
            lans: Object.fromEntries(result.allocations.lans),
          },
          warnings: result.warnings,
        };
        return textResult(JSON.stringify(json, null, 2));
      } catch (err) {
        return errorResult(`generate-configs failed: ${(err as Error).message}`);
      }
    },
  );
};
