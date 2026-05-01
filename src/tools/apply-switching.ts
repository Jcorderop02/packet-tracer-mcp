import { z } from "zod";
import { applySwitching, summarizeSwitching } from "../recipes/switching/apply.js";
import type { SwitchingIntent } from "../recipes/switching/intents.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const VlanSchema = z.object({
  switch: z.string().min(1),
  id: z.number().int().min(1).max(4094),
  name: z.string().optional(),
  accessPorts: z.array(z.string()).optional(),
});

const TrunkSchema = z.object({
  switch: z.string().min(1),
  switchModel: z.string().optional(),
  port: z.string().min(1),
  allowed: z.array(z.number().int().min(1).max(4094)).optional(),
  native: z.number().int().min(1).max(4094).optional(),
  encapsulation: z.enum(["dot1q", "isl"]).optional(),
});

const PortSecuritySchema = z.object({
  switch: z.string().min(1),
  port: z.string().min(1),
  maxMac: z.number().int().min(1).max(4096).optional(),
  sticky: z.boolean().optional(),
  violation: z.enum(["shutdown", "restrict", "protect"]).optional(),
});

const EtherChannelSchema = z.object({
  switch: z.string().min(1),
  ports: z.array(z.string().min(1)).min(2),
  group: z.number().int().min(1).max(48),
  mode: z.enum(["active", "passive", "on", "auto", "desirable"]).optional(),
  // PT 9 platform-aware filter: IE-9320 drops `channel-group` (verified
  // 2026-05-01). Pass switchModel so the recipe can fail fast with a
  // transparent error before the bulk hits PT.
  switchModel: z.string().optional(),
});

const InputSchema = {
  vlans: z.array(VlanSchema).optional().describe("VLAN definitions and access ports per switch."),
  trunks: z.array(TrunkSchema).optional().describe("Trunk port configuration per switch."),
  portSecurity: z.array(PortSecuritySchema).optional().describe("Port-security rules per switch."),
  etherChannels: z.array(EtherChannelSchema).optional().describe("EtherChannel groups per switch (>=2 ports each)."),
};

export const registerApplySwitchingTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_switching",
    "Apply L2 switching intents (VLANs, trunks, port-security, EtherChannel) to switches on the live canvas. Each helper groups CLI per device and pushes one bulk per switch.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const intent: SwitchingIntent = {
        ...(raw.vlans && raw.vlans.length > 0 ? { vlans: raw.vlans } : {}),
        ...(raw.trunks && raw.trunks.length > 0 ? { trunks: raw.trunks } : {}),
        ...(raw.portSecurity && raw.portSecurity.length > 0 ? { portSecurity: raw.portSecurity } : {}),
        ...(raw.etherChannels && raw.etherChannels.length > 0 ? { etherChannels: raw.etherChannels } : {}),
      };

      if (!intent.vlans && !intent.trunks && !intent.portSecurity && !intent.etherChannels) {
        return errorResult("nothing to apply: pass at least one of vlans/trunks/portSecurity/etherChannels.");
      }

      try {
        const report = await applySwitching(bridge, intent);
        const lines = [summarizeSwitching(report)];
        if (report.actions.length > 0) {
          lines.push("", "Per-switch CLI:");
          for (const a of report.actions) {
            lines.push(`  - ${a.switch} (${a.kind})`);
          }
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`switching apply failed: ${(err as Error).message}`);
      }
    },
  );
};
