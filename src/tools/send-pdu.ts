import { z } from "zod";
import { addSimplePduJs, deletePduJs, firePduJs, setSimulationModeJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  source: z.string().min(1).describe("Source device name (must be on the canvas)."),
  dest: z.string().min(1).describe(
    "Destination device NAME — IPs are not accepted by UserCreatedPDU.addSimplePdu.",
  ),
  fire: z.boolean().default(true).describe(
    "If true, fire the PDU immediately after creating it (then delete it from the scenario list to leave no trace). If false, just queue it and leave it in the PDU list.",
  ),
  switch_to_simulation: z.boolean().default(true).describe(
    "If true, switch PT to Simulation Mode before firing — required for the PDU to actually move. Set to false if the caller handles the mode toggle.",
  ),
};

export const registerSendPduTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_send_pdu",
    "Originate a Simple PDU (ICMP echo) from one device to another via UserCreatedPDU.addSimplePdu. Returns the scenario index assigned to the PDU. Verified on PT 9 real (probe-fase8b 2026-04-29).",
    InputSchema,
    async ({ source, dest, fire, switch_to_simulation }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      if (switch_to_simulation) {
        const modeReply = await bridge.sendAndWait(setSimulationModeJs("simulation"), { timeoutMs: 8_000 });
        const modeErr = checkPtReply(modeReply);
        if (modeErr) return modeErr;
      }

      const addReply = await bridge.sendAndWait(addSimplePduJs(source, dest), { timeoutMs: 8_000 });
      const err = checkPtReply(addReply);
      if (err) return err;
      if (!addReply || !addReply.startsWith("OK|")) {
        return errorResult(`UserCreatedPDU.addSimplePdu rejected (source=${source}, dest=${dest}): ${addReply ?? "<null>"}`);
      }
      const idx = Number(addReply.slice("OK|".length));

      if (!fire) {
        return textResult(`Queued Simple PDU ${source} → ${dest} at scenario index ${idx}. Use pt_simulation_play forward/play to advance.`);
      }

      const fireReply = await bridge.sendAndWait(firePduJs(idx), { timeoutMs: 8_000 });
      const fireErr = checkPtReply(fireReply);
      if (fireErr) return fireErr;
      if (fireReply !== "OK") {
        return errorResult(`UserCreatedPDU.firePDU(${idx}) failed: ${fireReply ?? "<null>"}`);
      }

      // Best-effort cleanup so the scenario list doesn't grow on every call.
      await bridge.sendAndWait(deletePduJs(idx), { timeoutMs: 5_000 });

      return textResult(
        `Fired Simple PDU ${source} → ${dest} (scenario idx=${idx}, then deleted).` +
        ` Use pt_simulation_play forward to step through the captured events.`,
      );
    },
  );
};
