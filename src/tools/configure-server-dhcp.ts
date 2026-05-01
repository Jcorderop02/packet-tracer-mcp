import { z } from "zod";
import { configureServerDhcpJs } from "../ipc/dhcp-server.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const PoolSchema = z.object({
  name: z.string().min(1),
  network: z.string().min(1).describe("Network address (e.g. 172.16.50.0). Required: PT 9's setNetworkMask is actually a 2-arg setter (network, mask)."),
  subnetMask: z.string().min(1).describe("Subnet mask in dotted form (e.g. 255.255.255.0)."),
  defaultRouter: z.string().min(1).optional(),
  dnsServer: z.string().min(1).optional(),
  startIp: z.string().min(1).optional(),
  endIp: z.string().min(1).optional(),
  maxUsers: z.number().int().min(1).max(1024).optional(),
});

const ExclusionSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

const InputSchema = {
  device: z.string().min(1).describe("Server-PT device name (must already exist on canvas)."),
  port: z.string().min(1).optional().describe("Port name where the DHCP service runs. Default: FastEthernet0."),
  enable: z.boolean().optional().describe("Toggle the DHCP service on/off."),
  pools: z.array(PoolSchema).optional().describe(
    "DHCP pools to create or update. Idempotent: if a pool with the same name " +
    "exists, only its setters are reapplied. Network address is inferred by PT " +
    "from startIp + subnetMask (no setter exposed).",
  ),
  removePools: z.array(z.string().min(1)).optional().describe("Pool names to delete first."),
  exclusions: z.array(ExclusionSchema).optional().describe("Excluded address ranges (port-wide, not per pool)."),
};

const DESCRIPTION =
  "Configure DHCP service on a Server-PT device using the native IPC API " +
  "(addPool + setNetworkMask/setDefaultRouter/setStartIp/setEndIp/setDnsServerIp/" +
  "setMaxUsers + addExcludedAddress). " +
  "LIMITS — confirmed dead-ends in PT 9.0 via prototype reflection: " +
  "(a) TFTP server / DHCP option-150 has NO setter on Server-PT — pool exposes " +
  "getTftpAddress but no setTftpAddress, no setOption*, no setBootFile, no setSiaddr; " +
  "addNewPool's documented 8-arg signature returns Invalid arguments for arities 1..12. " +
  "(b) Domain name has no setter (only getDomainName). " +
  "(c) maxUsers and endIp are coupled: PT recalculates one when you set the other. " +
  "If you pass both, ensure they're consistent (endIp - startIp + 1 == maxUsers); " +
  "the tool applies maxUsers first then endIp, so endIp wins. " +
  "If you need option-150 (typical for VoIP IP phones), DO NOT use this tool — " +
  "tell the user to make the router the DHCP server instead, and call pt_apply_services " +
  "with dhcpPools[].tftpServer set: that emits CLI `option 150 ip <ip>` inside the pool.";

export const registerConfigureServerDhcpTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_configure_server_dhcp",
    DESCRIPTION,
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const hasWork =
        raw.enable !== undefined ||
        (raw.pools && raw.pools.length > 0) ||
        (raw.removePools && raw.removePools.length > 0) ||
        (raw.exclusions && raw.exclusions.length > 0);
      if (!hasWork) {
        return errorResult("nothing to do: pass at least one of enable/pools/removePools/exclusions.");
      }

      const js = configureServerDhcpJs({
        device: raw.device,
        port: raw.port,
        enable: raw.enable,
        pools: raw.pools,
        removePools: raw.removePools,
        exclusions: raw.exclusions,
      });
      const result = await bridge.sendAndWait(js, { timeoutMs: 20_000 });
      if (result === null) return errorResult("timeout waiting for PT bridge response");
      if (result.startsWith("ERR")) return errorResult(result);
      return textResult(result);
    },
  );
};
