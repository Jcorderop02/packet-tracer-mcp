import { z } from "zod";
import { findRecipe } from "../recipes/index.js";
import { forecast, summarizeForecast } from "../recipes/forecast.js";
import { errorResult, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  recipe: z.string().min(1).describe("Recipe key, e.g. 'chain', 'star', 'branch_office'."),
  params: z.record(z.string(), z.unknown()).default({}).describe("Recipe-specific parameters; see pt_list_recipes for shape."),
};

export const registerForecastTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_forecast",
    "Dry-run estimator. Build the blueprint for a recipe and report what it would allocate, without touching the live canvas.",
    InputSchema,
    async ({ recipe, params }) => {
      const r = findRecipe(recipe);
      if (!r) return errorResult(`unknown recipe '${recipe}'. Try pt_list_recipes.`);
      try {
        const blueprint = r.build(params);
        return textResult(summarizeForecast(forecast(blueprint)));
      } catch (err) {
        return errorResult(`forecast failed: ${(err as Error).message}`);
      }
    },
  );
};
