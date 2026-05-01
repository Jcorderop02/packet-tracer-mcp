import { z } from "zod";
import { applyBgp, summarizeBgp } from "../recipes/routing/bgp.js";
import type { BgpIntent } from "../recipes/routing/bgp.js";
import { applyHsrp, summarizeHsrp } from "../recipes/routing/hsrp.js";
import type { HsrpIntent } from "../recipes/routing/hsrp.js";
import { applyIgpExtras, summarizeIgpExtras } from "../recipes/routing/igp-extras.js";
import type { IgpExtrasIntent } from "../recipes/routing/igp-extras.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const BgpNeighborSchema = z.object({
  ip: z.string().min(1),
  remoteAs: z.number().int().min(1).max(65535),
  description: z.string().optional(),
});

const BgpSchema = z.object({
  device: z.string().min(1),
  asn: z.number().int().min(1).max(65535),
  routerId: z.string().optional(),
  neighbors: z.array(BgpNeighborSchema),
  networks: z.array(z.string()).optional(),
  redistribute: z.array(z.enum(["ospf", "eigrp", "rip", "connected", "static"])).optional(),
});

const HsrpSchema = z.object({
  device: z.string().min(1),
  port: z.string().min(1),
  group: z.number().int().min(0).max(4095),
  virtualIp: z.string().min(1),
  priority: z.number().int().min(1).max(255).optional(),
  preempt: z.boolean().optional(),
  authKey: z.string().optional(),
  version: z.union([z.literal(1), z.literal(2)]).optional(),
});

const IgpExtrasSchema = z.object({
  device: z.string().min(1),
  protocol: z.enum(["ospf", "eigrp", "rip"]),
  processId: z.number().int().min(1).max(65535).optional(),
  passiveInterfaces: z.array(z.string()).optional(),
  defaultOriginate: z.boolean().optional(),
});

const InputSchema = {
  bgp: z.array(BgpSchema).optional().describe("BGP intents per router (router bgp <asn> with neighbors/networks/redistribute)."),
  hsrp: z.array(HsrpSchema).optional().describe("HSRP per-interface intents (standby <group> ip <vip> with priority/preempt)."),
  igpExtras: z.array(IgpExtrasSchema).optional().describe("Extra directives for existing OSPF/EIGRP/RIP processes (passive-interface, default-information originate)."),
};

export const registerApplyAdvancedRoutingTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_advanced_routing",
    "Apply advanced routing intents (BGP, HSRP, IGP extras like passive-interface and default-information originate) to routers on the live canvas. Each block writes running→startup per device.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const bgp = (raw.bgp ?? []) as readonly BgpIntent[];
      const hsrp = (raw.hsrp ?? []) as readonly HsrpIntent[];
      const igpExtras = (raw.igpExtras ?? []) as readonly IgpExtrasIntent[];

      if (bgp.length === 0 && hsrp.length === 0 && igpExtras.length === 0) {
        return errorResult("nothing to apply: pass at least one of bgp/hsrp/igpExtras.");
      }

      const lines: string[] = [];
      try {
        if (igpExtras.length > 0) {
          const r = await applyIgpExtras(bridge, igpExtras);
          lines.push(summarizeIgpExtras(r));
        }
        if (bgp.length > 0) {
          const r = await applyBgp(bridge, bgp);
          lines.push(summarizeBgp(r));
        }
        if (hsrp.length > 0) {
          const r = await applyHsrp(bridge, hsrp);
          lines.push(summarizeHsrp(r));
        }
        return textResult(lines.join("\n\n"));
      } catch (err) {
        return errorResult(`advanced routing apply failed: ${(err as Error).message}`);
      }
    },
  );
};
