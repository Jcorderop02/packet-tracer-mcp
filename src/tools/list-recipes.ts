import { RECIPES } from "../recipes/index.js";
import { textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerListRecipesTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_list_recipes",
    "Enumerate the topology recipes pt_cook_topology can build, with their parameter shape.",
    {},
    async () => {
      const lines: string[] = [`Available recipes (${RECIPES.length}):`, ""];
      for (const r of RECIPES) {
        lines.push(`- ${r.meta.key}: ${r.meta.description}`);
        lines.push(`    params: ${r.meta.paramHint}`);
      }
      return textResult(lines.join("\n"));
    },
  );
};
