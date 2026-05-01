import { z } from "zod";
import { applyIpv6, summarizeIpv6 } from "../recipes/ipv6/apply.js";
import type { Ipv6Intent } from "../recipes/ipv6/intents.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InterfaceSchema = z.object({
  device: z.string().min(1),
  port: z.string().min(1),
  address: z.string().min(1).describe("IPv6 address in CIDR form (e.g. 2001:db8:1::1/64)."),
  enableLinkLocal: z.boolean().optional(),
  ospfPid: z.number().int().min(1).max(65535).optional(),
  ospfArea: z.number().int().min(0).optional(),
});

const OspfSchema = z.object({
  device: z.string().min(1),
  pid: z.number().int().min(1).max(65535),
  routerId: z.string().min(1).optional().describe("Dotted-quad router-id, e.g. 1.1.1.1."),
});

const StaticRouteSchema = z.object({
  device: z.string().min(1),
  prefix: z.string().min(1).describe("Destination prefix (e.g. 2001:db8:2::/64 or ::/0)."),
  nextHop: z.string().min(1),
  distance: z.number().int().min(1).max(255).optional(),
});

const EndpointSchema = z.object({
  device: z.string().min(1),
  address: z.string().min(1).describe("IPv6 address in CIDR form (e.g. 2001:db8:1::2/64)."),
  gateway: z.string().min(1),
});

const InputSchema = {
  unicastRouting: z.boolean().optional().describe("Emit `ipv6 unicast-routing` (default true) on every router with IPv6 intents."),
  interfaces: z.array(InterfaceSchema).optional(),
  ospf: z.array(OspfSchema).optional(),
  staticRoutes: z.array(StaticRouteSchema).optional(),
  endpoints: z.array(EndpointSchema).optional().describe("PC/Laptop/Server IPv6 host configuration via `ipv6config`."),
};

export const registerApplyIpv6Tool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_ipv6",
    "Configure dual-stack IPv6 on routers (unicast-routing, interface addresses, OSPFv3, static routes) and IPv6 hosts on PCs/laptops/servers.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const intent: Ipv6Intent = {
        ...(raw.unicastRouting !== undefined ? { unicastRouting: raw.unicastRouting } : {}),
        ...(raw.interfaces && raw.interfaces.length > 0 ? { interfaces: raw.interfaces } : {}),
        ...(raw.ospf && raw.ospf.length > 0 ? { ospf: raw.ospf } : {}),
        ...(raw.staticRoutes && raw.staticRoutes.length > 0 ? { staticRoutes: raw.staticRoutes } : {}),
        ...(raw.endpoints && raw.endpoints.length > 0 ? { endpoints: raw.endpoints } : {}),
      };
      if (!intent.interfaces && !intent.ospf && !intent.staticRoutes && !intent.endpoints) {
        return errorResult("nothing to apply: pass at least one of interfaces/ospf/staticRoutes/endpoints.");
      }

      try {
        const report = await applyIpv6(bridge, intent);
        const lines = [summarizeIpv6(report)];
        if (report.actions.length > 0) {
          lines.push("", "IPv6 actions:");
          for (const a of report.actions) lines.push(`  - ${a.device} (${a.kind}) ${a.detail}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`ipv6 apply failed: ${(err as Error).message}`);
      }
    },
  );
};
