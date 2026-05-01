import { z } from "zod";
import { findRecipe } from "../recipes/index.js";
import { cookBlueprint, summarizeCook } from "../recipes/cook.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  recipe: z.string().min(1).describe("Recipe key (chain, star, branch_office). See pt_list_recipes."),
  params: z.record(z.string(), z.unknown()).default({}).describe("Recipe-specific parameters."),
};

export const registerCookTopologyTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_cook_topology",
    "Build a recipe's blueprint and apply it to the live workspace: places devices, wires links, addresses ports, configures routing. Idempotent against partial state.",
    InputSchema,
    async ({ recipe, params }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      const r = findRecipe(recipe);
      if (!r) return errorResult(`unknown recipe '${recipe}'. Try pt_list_recipes.`);
      try {
        const blueprint = r.build(params);
        const report = await cookBlueprint(bridge, blueprint);
        return textResult(summarizeCook(report));
      } catch (err) {
        return errorResult(`cook failed: ${(err as Error).message}`);
      }
    },
  );
};
