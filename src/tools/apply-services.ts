import { z } from "zod";
import { applyServices, summarizeServices } from "../recipes/services/apply.js";
import type { ServicesIntent } from "../recipes/services/intents.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const AclStandardRule = z.object({
  action: z.enum(["permit", "deny"]),
  source: z.string().min(1),
  remark: z.string().optional(),
});

const AclExtendedRule = z.object({
  action: z.enum(["permit", "deny"]),
  protocol: z.enum(["ip", "tcp", "udp", "icmp"]),
  source: z.string().min(1),
  destination: z.string().min(1),
  portOp: z.enum(["eq", "gt", "lt", "neq", "range"]).optional(),
  ports: z.array(z.union([z.number().int(), z.string().min(1)])).optional(),
  remark: z.string().optional(),
});

const AclSchema = z.object({
  device: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["standard", "extended"]),
  rules: z.array(z.union([AclStandardRule, AclExtendedRule])).min(1),
  applyTo: z.array(z.object({
    port: z.string().min(1),
    direction: z.enum(["in", "out"]),
  })).optional(),
  replaceExisting: z.boolean().optional(),
});

const NatSchema = z.object({
  device: z.string().min(1),
  interfaces: z.array(z.object({
    port: z.string().min(1),
    role: z.enum(["inside", "outside"]),
  })).optional(),
  statics: z.array(z.object({
    insideLocal: z.string().min(1),
    insideGlobal: z.string().min(1),
    protocol: z.enum(["tcp", "udp"]).optional(),
    localPort: z.number().int().min(1).max(65535).optional(),
    globalPort: z.number().int().min(1).max(65535).optional(),
  })).optional(),
  pools: z.array(z.object({
    name: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    netmask: z.string().min(1),
  })).optional(),
  overload: z.object({
    aclName: z.string().min(1),
    poolName: z.string().min(1).optional(),
    outsideInterface: z.string().min(1).optional(),
  }).optional(),
});

const DhcpPoolSchema = z.object({
  device: z.string().min(1),
  name: z.string().min(1),
  network: z.string().min(1),
  defaultRouter: z.string().min(1).optional(),
  dnsServer: z.string().min(1).optional(),
  domainName: z.string().min(1).optional(),
  tftpServer: z.string().min(1).optional().describe(
    "TFTP server IP for DHCP option-150 (needed by IP phones / CME). Emits " +
    "`option 150 ip <ip>` inside the router DHCP pool. Only works on a router " +
    "DHCP server: PT 9 Server-PT does NOT expose option-150 setters.",
  ),
  excluded: z.array(z.object({
    start: z.string().min(1),
    end: z.string().min(1),
  })).optional(),
});

const DhcpRelaySchema = z.object({
  device: z.string().min(1),
  port: z.string().min(1),
  helpers: z.array(z.string().min(1)).min(1),
});

const NtpSchema = z.object({
  device: z.string().min(1),
  servers: z.array(z.string().min(1)).min(1),
  routerModel: z.string().optional().describe(
    "Optional PT model. When set to '1941' and >1 servers are passed, the " +
    "builder fails fast with a transparent error: PT 9 1941 retains only " +
    "the LAST `ntp server` line (VERIFIED.md F3-19).",
  ),
});

const SyslogSchema = z.object({
  device: z.string().min(1),
  hosts: z.array(z.string().min(1)).min(1),
  trapLevel: z.number().int().min(0).max(7).optional(),
  routerModel: z.string().optional().describe(
    "Optional PT model. When set to '1941' and trapLevel is provided, the " +
    "builder fails fast: PT 9 1941 rejects `logging trap <N>` (VERIFIED.md F3-21).",
  ),
});

const InputSchema = {
  acls: z.array(AclSchema).optional().describe("Standard / extended ACLs (optionally bound to interfaces)."),
  nat: z.array(NatSchema).optional().describe("NAT roles, statics, pools and overload directives per device."),
  dhcpPools: z.array(DhcpPoolSchema).optional().describe("DHCP server pools."),
  dhcpRelays: z.array(DhcpRelaySchema).optional().describe("DHCP relay (helper-address) per interface."),
  ntp: z.array(NtpSchema).optional().describe("NTP servers per device."),
  syslog: z.array(SyslogSchema).optional().describe("Syslog hosts and trap level per device."),
};

export const registerApplyServicesTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_apply_services",
    "Apply L3 services (ACLs, NAT, DHCP server/relay, NTP, Syslog) to the live canvas. Each block is grouped per device and pushed as one bulk per service.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const intent: ServicesIntent = {
        ...(raw.acls && raw.acls.length > 0 ? { acls: raw.acls } : {}),
        ...(raw.nat && raw.nat.length > 0 ? { nat: raw.nat } : {}),
        ...(raw.dhcpPools && raw.dhcpPools.length > 0 ? { dhcpPools: raw.dhcpPools } : {}),
        ...(raw.dhcpRelays && raw.dhcpRelays.length > 0 ? { dhcpRelays: raw.dhcpRelays } : {}),
        ...(raw.ntp && raw.ntp.length > 0 ? { ntp: raw.ntp } : {}),
        ...(raw.syslog && raw.syslog.length > 0 ? { syslog: raw.syslog } : {}),
      };

      if (
        !intent.acls && !intent.nat && !intent.dhcpPools &&
        !intent.dhcpRelays && !intent.ntp && !intent.syslog
      ) {
        return errorResult("nothing to apply: pass at least one of acls/nat/dhcpPools/dhcpRelays/ntp/syslog.");
      }

      try {
        const report = await applyServices(bridge, intent);
        const lines = [summarizeServices(report)];
        if (report.actions.length > 0) {
          lines.push("", "Per-device CLI:");
          for (const a of report.actions) lines.push(`  - ${a.device} (${a.kind})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(`services apply failed: ${(err as Error).message}`);
      }
    },
  );
};
