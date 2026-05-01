import { z } from "zod";
import { setEndpointDhcpJs, setEndpointStaticIpJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

/**
 * Endpoints (PC-PT, Laptop-PT, Server-PT) toggle between DHCP and static IP
 * via `setDhcpFlag(...)` plus, in the static case, `port.setIpSubnetMask` and
 * optionally `port.setDefaultGateway`. Routers configure their interfaces via
 * the CLI instead, so this tool only targets endpoints.
 *
 * The schema is intentionally flat — `mode` selects DHCP vs static, and the
 * IP/mask/gateway fields are validated at runtime when `mode='static'`.
 */
const InputSchema = {
  device: z.string().min(1).describe("Endpoint name."),
  mode: z.enum(["static", "dhcp"]).describe("Addressing mode."),
  port: z.string().min(1).default("FastEthernet0").describe("Port to configure for static mode."),
  ip: z.string().optional().describe("IPv4 address; required when mode='static'."),
  mask: z.string().optional().describe("Subnet mask; required when mode='static'."),
  gateway: z.string().optional().describe("Default gateway; optional, static mode only."),
};

export const registerSetPcTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_set_pc",
    "Configure an endpoint (PC, laptop, server) for static IP or DHCP. In static mode you must pass ip+mask; gateway is optional.",
    InputSchema,
    async ({ device, mode, port, ip, mask, gateway }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      let js: string;
      if (mode === "dhcp") {
        js = setEndpointDhcpJs(device);
      } else {
        if (!ip || !mask) {
          return errorResult("Static mode requires both 'ip' and 'mask'.");
        }
        js = setEndpointStaticIpJs({
          device,
          port,
          ip,
          mask,
          ...(gateway !== undefined ? { gateway } : {}),
        });
      }

      const result = await bridge.sendAndWait(js, { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device, port });
      if (err) return err;
      if (result !== "OK") return errorResult(`Unexpected reply: ${result}`);

      return mode === "dhcp"
        ? textResult(`'${device}' set to DHCP.`)
        : textResult(
            `'${device}' configured static on ${port}: ${ip}/${mask}` +
            (gateway ? `, gw ${gateway}` : ""),
          );
    },
  );
};
