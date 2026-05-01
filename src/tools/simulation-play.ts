import { z } from "zod";
import { getSimulationStateJs, simulationControlJs } from "../ipc/sim.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  action: z.enum(["play", "back", "forward", "reset"]).describe(
    "Simulation panel action: 'play' = auto-capture, 'forward' = single step forward, 'back' = step back, 'reset' = wipe captured events.",
  ),
};

export const registerSimulationPlayTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_simulation_play",
    "Trigger one of the SimulationPanel buttons (play/back/forward/reset). Caller must put PT in Simulation mode first via pt_simulation_mode — calling 'play' from Realtime is a no-op.",
    InputSchema,
    async ({ action }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;
      const reply = await bridge.sendAndWait(simulationControlJs(action), { timeoutMs: 8_000 });
      const err = checkPtReply(reply);
      if (err) return err;
      if (reply !== "OK") return errorResult(`Unexpected reply from SimulationPanel: ${reply ?? "<null>"}`);
      const stateRaw = await bridge.sendAndWait(getSimulationStateJs(), { timeoutMs: 5_000 });
      let isPlaying: boolean | undefined;
      if (stateRaw && stateRaw.startsWith("{")) {
        try { isPlaying = JSON.parse(stateRaw).isPlaying; } catch {}
      }
      return textResult(
        `SimulationPanel.${action}() triggered.` +
        (typeof isPlaying === "boolean" ? ` isPlaying=${isPlaying}.` : ""),
      );
    },
  );
};
