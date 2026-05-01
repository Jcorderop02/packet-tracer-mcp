import { z } from "zod";
import { getSimulationStateJs, setSimulationModeJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  mode: z.enum(["simulation", "realtime"]).describe(
    "'simulation' switches PT to Simulation Mode (event-by-event). 'realtime' switches back to Realtime.",
  ),
};

export const registerSimulationModeTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_simulation_mode",
    "Toggle PT between Realtime and Simulation modes via the RSSwitch widget. After switching to simulation, use pt_send_pdu to originate traffic and pt_simulation_play to advance.",
    InputSchema,
    async ({ mode }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      const reply = await bridge.sendAndWait(setSimulationModeJs(mode), { timeoutMs: 8_000 });
      const err = checkPtReply(reply);
      if (err) return err;
      if (reply !== "OK") return errorResult(`Unexpected reply from RSSwitch: ${reply ?? "<null>"}`);
      // Read state back so the caller sees something verifiable.
      const stateRaw = await bridge.sendAndWait(getSimulationStateJs(), { timeoutMs: 5_000 });
      let isPlaying: boolean | undefined;
      if (stateRaw && stateRaw.startsWith("{")) {
        try { isPlaying = JSON.parse(stateRaw).isPlaying; } catch {}
      }
      return textResult(
        `Switched PT to ${mode} mode.` +
        (typeof isPlaying === "boolean" ? ` SimulationPanel.isPlaying=${isPlaying}.` : ""),
      );
    },
  );
};
