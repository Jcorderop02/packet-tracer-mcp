import { z } from "zod";
import { applyWireless, summarizeWireless } from "../recipes/wireless/apply.js";
import type { WirelessIntent } from "../recipes/wireless/intents.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const Security = z.enum(["open", "wpa2-psk"]);

const ApSchema = z.object({
  device: z.string().min(1),
  ssid: z.string().min(1),
  security: Security,
  psk: z.string().min(1).optional(),
  channel: z.number().int().min(1).max(11).optional(),
  vlanId: z.number().int().min(1).max(4094).optional(),
});

const ClientSchema = z.object({
  device: z.string().min(1),
  ssid: z.string().min(1),
  psk: z.string().min(1).optional(),
  dhcp: z.boolean().optional(),
});

const InputSchema = {
  aps: z.array(ApSchema).optional().describe("AP SSIDs/security to configure through PT native WirelessServer API."),
  clients: z.array(ClientSchema).optional().describe("Wireless client associations to configure through PT native WirelessClient API."),
};

export const registerApplyWirelessTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_wireless",
    "Apply wireless SSID/security on APs and associate wireless clients through Packet Tracer's native WirelessServer/WirelessClient IPC processes.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const intent: WirelessIntent = {
        ...(raw.aps && raw.aps.length > 0 ? { aps: raw.aps } : {}),
        ...(raw.clients && raw.clients.length > 0 ? { clients: raw.clients } : {}),
      };
      if (!intent.aps && !intent.clients) {
        return errorResult("nothing to apply: pass aps and/or clients.");
      }

      try {
        const report = await applyWireless(bridge, intent);
        const lines = [summarizeWireless(report)];
        if (report.actions.length > 0) {
          lines.push("", "Wireless actions:");
          for (const a of report.actions) lines.push(`  - ${a.device} (${a.kind}) ${a.detail}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`wireless apply failed: ${(err as Error).message}`);
      }
    },
  );
};
