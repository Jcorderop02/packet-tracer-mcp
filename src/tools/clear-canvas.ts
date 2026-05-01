import { z } from "zod";
import { linkRegistry } from "../canvas/link-registry.js";
import { clearCanvasJs, listDeviceNamesJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  confirm: z.literal(true).describe(
    "Must be literally true. Forces the caller to acknowledge that this wipes the canvas.",
  ),
  prompt_user: z.boolean().default(false).describe(
    "If true, PT shows the 'save before new?' modal interactively. Default false skips the modal entirely (correct for scripted use).",
  ),
};

export const registerClearCanvasTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_clear_canvas",
    "Wipe the entire PT canvas (File > New) via AppWindow.fileNew. DESTRUCTIVE: removes every device, link, note and PDU in the active workspace. Requires confirm=true. Returns the list of device names that existed before the wipe.",
    InputSchema,
    async ({ confirm, prompt_user }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      if (confirm !== true) {
        return errorResult("pt_clear_canvas requires `confirm: true` — refusing to wipe the canvas.");
      }

      const namesRaw = await bridge.sendAndWait(listDeviceNamesJs(), { timeoutMs: 5_000 });
      let beforeNames: string[] = [];
      if (namesRaw && namesRaw.startsWith("[")) {
        try { beforeNames = JSON.parse(namesRaw); } catch {}
      }

      const reply = await bridge.sendAndWait(clearCanvasJs(prompt_user), { timeoutMs: 15_000 });
      const err = checkPtReply(reply);
      if (err) return err;
      if (!reply || !reply.startsWith("OK|")) {
        return errorResult(`AppWindow.fileNew did not return a usable result: ${reply ?? "<null>"}`);
      }
      const ok = reply.slice("OK|".length) === "true";
      if (!ok) {
        return errorResult(
          `AppWindow.fileNew(${prompt_user ? "true" : "false"}) returned false. ` +
          (prompt_user ? "User likely cancelled the modal." : "PT refused the new-file action."),
        );
      }
      linkRegistry.clear();

      const verifyRaw = await bridge.sendAndWait(listDeviceNamesJs(), { timeoutMs: 5_000 });
      let after: string[] = [];
      if (verifyRaw && verifyRaw.startsWith("[")) {
        try { after = JSON.parse(verifyRaw); } catch {}
      }

      const lines = [
        `Canvas wiped. Devices before: ${beforeNames.length}, after: ${after.length}.`,
      ];
      if (beforeNames.length > 0) {
        lines.push(`Removed: ${beforeNames.slice(0, 25).join(", ")}${beforeNames.length > 25 ? ` (+${beforeNames.length - 25} more)` : ""}`);
      }
      if (after.length > 0) {
        lines.push(`Still present (unexpected): ${after.join(", ")}`);
      }
      return textResult(lines.join("\n"));
    },
  );
};
