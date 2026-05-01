import { z } from "zod";
import {
  ROUTER_SLOT_CATALOG,
  resolveSlotCatalogKey,
  validateModuleFamily,
  validateModuleSlot,
} from "../catalog/router-slots.js";
import { fetchDeviceModel } from "../ipc/device-model.js";
import { addModuleJs, inspectModuleSlotJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

/**
 * Hardware modules in PT 9.0 are inserted into a chassis sub-slot identified
 * by the path `chassis/bay` (e.g. `"0/1"`). Two pitfalls the underlying JS
 * builder already takes care of, but worth restating:
 *   - Passing an integer slot silently fails (PT returns `false`).
 *   - The router must be powered down for the insert to land; we toggle
 *     `setPower` and call `skipBoot()` so the caller doesn't have to wait.
 *
 * This tool is idempotent: it inspects the slot first, and reports success
 * without touching the chassis if the requested module is already there.
 * That makes re-running a recipe safe — no spurious power cycles.
 */
const InputSchema = {
  device: z.string().min(1).describe("Router name to install the module into."),
  slot: z.string().regex(/^\d+\/\d+$/).describe("Slot path 'chassis/bay', e.g. '0/1'."),
  module: z.string().min(1).describe("Module model, e.g. 'NIM-2T', 'HWIC-2T', 'NIM-ES2-4'."),
};

export const registerAddModuleTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_add_module",
    "Install a hardware module (NIM-2T, HWIC-2T, NIM-ES2-4, ...) into a router slot. Idempotent: if the slot already holds the requested module, returns success without touching the chassis.",
    InputSchema,
    async ({ device, slot, module }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      // Pre-flight: per-chassis slot validation. Catches the silent failure
      // where PT returns "false" because the bay path doesn't exist on this
      // model (e.g. trying to use 0/2 on a 1941 — which only has 0/0 and 0/1).
      //
      // Note: the family check (HWIC vs NIM) is intentionally NOT enforced
      // as a hard error here. PT 9 has been observed to accept HWIC-2T in
      // ISR4xxx NIM bays "por compatibilidad" (see AGENTS.md). We surface
      // the mismatch as a hint after the install succeeds, but don't gate
      // the call — being stricter than PT would block legitimate use.
      const model = await fetchDeviceModel(bridge, device);
      const catalogKey = resolveSlotCatalogKey(model);
      if (catalogKey) {
        const slotErr = validateModuleSlot(model!, slot);
        if (slotErr) {
          const info = ROUTER_SLOT_CATALOG[catalogKey]!;
          return errorResult(
            slotErr +
              `\n\nTip: ${catalogKey} accepts ${info.families.join("/")} cards in bays ${info.bays.join(", ")}. ` +
              `Re-call pt_add_module with one of those.`,
          );
        }
      }
      const familyHint = catalogKey ? validateModuleFamily(model!, module) : null;

      // 1) Inspect the slot to make this idempotent.
      const probe = await bridge.sendAndWait(inspectModuleSlotJs(device, slot), { timeoutMs: 10_000 });
      const probeErr = checkPtReply(probe, { device, slot });
      if (probeErr) return probeErr;
      if (probe && probe.startsWith("MODULE|")) {
        const installed = probe.slice("MODULE|".length);
        if (installed === module) {
          return textResult(`Slot ${slot} on ${device} already holds ${module} — nothing to do.`);
        }
        return errorResult(
          `Slot ${slot} on ${device} is occupied by '${installed}', not '${module}'. ` +
          `Remove the current module manually before retrying.`,
        );
      }
      // probe is "EMPTY" or "UNKNOWN" — proceed with the insert.

      // 2) Insert.
      const result = await bridge.sendAndWait(addModuleJs(device, slot, module), { timeoutMs: 30_000 });
      const err = checkPtReply(result, { device, slot });
      if (err) return err;
      const hint = familyHint ? `\n\nNote: ${familyHint}` : "";
      return textResult(`Installed ${module} on ${device} at slot ${slot}.${hint}`);
    },
  );
};

