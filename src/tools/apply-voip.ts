import { z } from "zod";
import { applyVoip, summarizeVoip } from "../recipes/voip/apply.js";
import type { VoipIntent } from "../recipes/voip/intents.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const CmeSchema = z.object({
  device: z.string().min(1),
  maxEphones: z.number().int().min(1).max(240),
  maxDn: z.number().int().min(1).max(720),
  sourceIp: z.string().min(1),
  sourcePort: z.number().int().min(1).max(65535).optional(),
  autoAssign: z
    .object({ first: z.number().int().min(1), last: z.number().int().min(1) })
    .optional(),
  systemMessage: z.string().min(1).optional(),
});

const EphoneDnSchema = z.object({
  device: z.string().min(1),
  dnTag: z.number().int().min(1),
  number: z.string().min(1),
  name: z.string().min(1).optional(),
});

const EphoneButtonSchema = z.union([
  z.number().int().min(1),
  z.object({ button: z.number().int().min(1), dnTag: z.number().int().min(1) }),
]);

const EphoneSchema = z.object({
  device: z.string().min(1),
  ephoneNumber: z.number().int().min(1),
  mac: z.string().min(1),
  type: z.string().min(1).optional(),
  buttons: z.array(EphoneButtonSchema).min(1),
});

const VoiceVlanSchema = z.object({
  switch: z.string().min(1),
  port: z.string().min(1),
  voiceVlanId: z.number().int().min(1).max(4094),
  dataVlanId: z.number().int().min(1).max(4094).optional(),
  trustCiscoPhone: z.boolean().optional(),
});

const InputSchema = {
  cme: z.array(CmeSchema).optional().describe("CME (telephony-service) blocks per router."),
  ephoneDns: z.array(EphoneDnSchema).optional().describe("ephone-dn extensions to provision on a CME router."),
  ephones: z.array(EphoneSchema).optional().describe("ephone (phone) registrations referencing ephone-dn tags."),
  voiceVlans: z.array(VoiceVlanSchema).optional().describe("Switchport voice/data VLAN configuration for IP Phone access ports."),
};

export const registerApplyVoipTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_voip",
    "Configure CME (telephony-service / ephone-dn / ephone) on a router and voice VLANs on an access switch through IOS CLI.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const intent: VoipIntent = {
        ...(raw.cme && raw.cme.length > 0 ? { cme: raw.cme } : {}),
        ...(raw.ephoneDns && raw.ephoneDns.length > 0 ? { ephoneDns: raw.ephoneDns } : {}),
        ...(raw.ephones && raw.ephones.length > 0 ? { ephones: raw.ephones } : {}),
        ...(raw.voiceVlans && raw.voiceVlans.length > 0 ? { voiceVlans: raw.voiceVlans } : {}),
      };
      if (!intent.cme && !intent.ephoneDns && !intent.ephones && !intent.voiceVlans) {
        return errorResult("nothing to apply: pass at least one of cme/ephoneDns/ephones/voiceVlans.");
      }

      try {
        const report = await applyVoip(bridge, intent);
        const lines = [summarizeVoip(report)];
        if (report.actions.length > 0) {
          lines.push("", "VoIP actions:");
          for (const a of report.actions) lines.push(`  - ${a.device} (${a.kind}) ${a.detail}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`voip apply failed: ${(err as Error).message}`);
      }
    },
  );
};
