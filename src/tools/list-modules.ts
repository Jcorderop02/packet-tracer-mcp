import { z } from "zod";
import { listInstalledModulesJs, listModulesJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * Two complementary modes:
 *
 *   - Catalog mode (no `device`): walks the full hardware factory and lists
 *     every module PT 9 ships (~199), filterable by substring. Useful for
 *     discovering what's available before adding modules to a chassis.
 *   - Installed mode (`device` set): walks the live module tree of one
 *     device and reports what's physically installed in each bay
 *     (slotPath → moduleName). Useful for diffing recipes or inventorying
 *     a hand-built lab.
 */
const InputSchema = {
  filter: z.string().default("").describe("Catalog mode: case-insensitive substring of the module name. Ignored in installed mode."),
  limit: z.number().int().min(1).max(500).default(50).describe("Catalog mode: max rows. Ignored in installed mode."),
  device: z.string().optional().describe("Installed mode: device name. When set, lists modules physically present in that chassis instead of the global catalog."),
};

export const registerListModulesTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_list_modules",
    "Enumerate hardware modules. Without `device`: PT's full catalog (filterable). With `device`: the modules physically installed in that chassis right now (slotPath → name).",
    InputSchema,
    async ({ filter, limit, device }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      if (device) {
        const raw = await bridge.sendAndWait(listInstalledModulesJs(device), { timeoutMs: 15_000 });
        if (raw === null) return errorResult("Timed out waiting for PT to answer.");
        if (raw === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
        if (raw.startsWith("ERR:")) return errorResult(`PT raised: ${raw}`);
        const lines = raw.split("\n");
        const total = Number.parseInt(lines[0] ?? "0", 10);
        const rows = lines.slice(1);
        const head = `Modules installed on '${device}': ${total} entries`;
        return textResult(`${head}\n${rows.map(r => "  " + r).join("\n")}`);
      }

      const raw = await bridge.sendAndWait(listModulesJs(), { timeoutMs: 20_000 });
      if (raw === null) return errorResult("Timed out waiting for PT to answer.");
      if (raw.startsWith("ERROR:")) return errorResult(`PT raised: ${raw}`);

      const lines = raw.split("\n");
      const total = Number.parseInt(lines[0] ?? "0", 10);
      const rows = lines.slice(1);
      const needle = filter.trim().toLowerCase();
      const matched = needle
        ? rows.filter(r => (r.split("|")[0] ?? "").toLowerCase().includes(needle))
        : rows;

      const shown = matched.slice(0, limit);
      const head = needle
        ? `Modules matching '${filter}': ${matched.length}/${total}. Showing ${shown.length}.`
        : `Modules total: ${total}. Showing ${shown.length} (limit=${limit}).`;
      const body = shown.map(r => "  " + r).join("\n");
      return textResult(`${head}\n${body}`);
    },
  );
};
