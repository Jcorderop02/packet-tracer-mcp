import { z } from "zod";
import { ipv4 } from "./integration-common.js";
import { maskNumber } from "../ipc/dhcp-validation.js";
import { readEndpointJs } from "../ipc/endpoint-state.js";
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
  port: z.string().min(1).optional().describe("Port for DHCP or static mode. DHCP auto-selects if omitted; static defaults to FastEthernet0."),
  ip: ipv4.optional().describe("IPv4 address; required when mode='static'."),
  mask: ipv4.optional().describe("Subnet mask; required when mode='static'."),
  dns: ipv4.optional().describe("DNS IPv4 server for static mode."),
  gateway: ipv4.optional().describe("Default gateway; optional, static mode only."),
};

export const registerSetPcTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_set_pc",
    "Configure an endpoint (PC, laptop, server) for static IP or DHCP. In static mode you must pass ip+mask; gateway is optional.",
    InputSchema,
    async ({ device, mode, port, ip, mask, gateway, dns }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      if(mode === "dhcp" && [ip,mask,gateway,dns].some(v=>v!==undefined))return errorResult("DHCP gets addressing and DNS from its lease; static fields require mode=static.");
      if(mask!==undefined){try{maskNumber(mask);}catch(e){return errorResult(String(e));}}
      let js: string;
      if (mode === "dhcp") {
        js = setEndpointDhcpJs(device, port);
      } else {
        if (!ip || !mask) {
          return errorResult("Static mode requires both 'ip' and 'mask'.");
        }
        js = setEndpointStaticIpJs({
          device,
          port: port ?? "FastEthernet0",
          dns,
          ip,
          mask,
          ...(gateway !== undefined ? { gateway } : {}),
        });
      }

      const result = await bridge.sendAndWait(js, { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device, port });
      if (err) return err;
      if (!result || !/^OK(?::|$)/.test(result)) return errorResult(`Unexpected reply: ${result}`);

      const readback = await bridge.sendAndWait(readEndpointJs(device));
      if (!readback || /^(ERR|ERROR):/.test(readback)) return errorResult(`Configuration dispatched but readback failed: ${readback}`);
      const observed = JSON.parse(readback) as {ports:{name:string;ip:string;mask:string;dhcp:boolean}[]};
      const actual = observed.ports.find(p=>p.name===(port ?? (mode==="static"?"FastEthernet0":undefined)));
      if(mode==="static" && (!actual || actual.ip!==ip || actual.mask!==mask))return errorResult(`Static configuration readback mismatch: ${readback}`);
      if(mode==="dhcp" && (port ? !actual?.dhcp : !observed.ports.some(p=>p.dhcp)))return errorResult(`DHCP flag not enabled on requested interface: ${readback}`);
      return textResult(`${result}\nObserved interfaces (DHCP may still be acquiring): ${readback}`);

    },
  );
};
