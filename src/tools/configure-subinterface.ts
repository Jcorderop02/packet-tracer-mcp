import { z } from "zod";
import { wrapInConfig } from "../ipc/cli-prologue.js";
import { bulkCliJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

/**
 * Router-on-a-stick subinterface configuration. Builds the IOS block:
 *
 *   interface <parent>
 *    no shutdown
 *    exit
 *   interface <parent>.<vlan>
 *    description ...
 *    encapsulation dot1Q <vlan>
 *    ip address <ip> <mask>
 *    no shutdown
 *    exit
 *   ... (one block per VLAN)
 *
 * The parent interface is brought up first because PT 9 routers boot with
 * Gi0/0..Gi0/2 administratively down; subinterfaces inherit the L1 state
 * of the parent, so without `no shutdown` on the parent dot1Q tagging never
 * leaves the chassis.
 *
 * Encapsulation note: only Gigabit/Fast Ethernet parents accept `dot1Q`
 * — serial subinterfaces use `encapsulation frame-relay`/`hdlc` and are not
 * covered by this tool.
 */

export interface SubinterfaceSpec {
  readonly vlan: number;
  readonly ip: string;
  readonly mask: string;
  readonly description?: string;
}

export interface SubinterfaceIntent {
  readonly parent: string;
  readonly subinterfaces: readonly SubinterfaceSpec[];
}

const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;

const SubinterfaceSchema = z.object({
  vlan: z.number().int().min(1).max(4094)
    .describe("802.1Q VLAN tag carried by this subinterface."),
  ip: z.string().regex(ipv4Re, "Must be a dotted-quad IPv4 address.")
    .describe("Gateway IP for the VLAN (usually .1 of the LAN /24)."),
  mask: z.string().regex(ipv4Re, "Must be a dotted-quad subnet mask.")
    .describe("Subnet mask in dotted-quad form (e.g. '255.255.255.0' for /24)."),
  description: z.string().min(1).optional()
    .describe("Optional 'description' line; useful for operators reading the running-config."),
});

const InputSchema = {
  device: z.string().min(1).describe("Router name on the live canvas."),
  parent: z.string().min(1).describe(
    "Full parent interface name (e.g. 'GigabitEthernet0/0'). Brought up with 'no shutdown' before subinterfaces are configured.",
  ),
  subinterfaces: z.array(SubinterfaceSchema).min(1).describe(
    "One block per VLAN. Each generates 'interface <parent>.<vlan>' + 'encapsulation dot1Q <vlan>' + 'ip address ...'.",
  ),
};

/**
 * Build the CLI body for one router-on-a-stick block. Pure function —
 * exported for unit tests. Does NOT include the `enable / configure terminal
 * / ... / end` wrapper (that lives in `wrapInConfig`).
 */
export function subinterfaceCli(intent: SubinterfaceIntent): string {
  const lines: string[] = [`interface ${intent.parent}`, " no shutdown", " exit"];
  for (const s of intent.subinterfaces) {
    lines.push(`interface ${intent.parent}.${s.vlan}`);
    if (s.description) lines.push(` description ${s.description}`);
    lines.push(` encapsulation dot1Q ${s.vlan}`);
    lines.push(` ip address ${s.ip} ${s.mask}`);
    lines.push(" no shutdown");
    lines.push(" exit");
  }
  return lines.join("\n");
}

export const registerConfigureSubinterfaceTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_configure_subinterface",
    "Build router-on-a-stick: configure 802.1Q subinterfaces on a router's parent interface (one block per VLAN). Brings the parent up first, then emits 'encapsulation dot1Q <vlan> + ip address' per VLAN. Pair with a switch trunk (pt_apply_switching trunk) to complete the inter-VLAN routing setup.",
    InputSchema,
    async (raw) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const vlans = raw.subinterfaces.map((s) => s.vlan);
      const seen = new Set<number>();
      for (const v of vlans) {
        if (seen.has(v)) {
          return errorResult(
            `VLAN ${v} appears more than once on parent ${raw.parent}; PT only allows one subinterface per VLAN tag.`,
          );
        }
        seen.add(v);
      }

      const body = subinterfaceCli({ parent: raw.parent, subinterfaces: raw.subinterfaces });
      const reply = await bridge.sendAndWait(
        bulkCliJs(raw.device, wrapInConfig(body)),
        { timeoutMs: 60_000 },
      );
      const err = checkPtReply(reply, { device: raw.device });
      if (err) return err;
      if (!reply) return errorResult(`subinterface CLI on ${raw.device} timed out`);

      const newlineIdx = reply.indexOf("\n");
      const output = newlineIdx > -1 ? reply.slice(newlineIdx + 1) : reply;

      const summary =
        `Configured ${raw.subinterfaces.length} subinterface(s) on ${raw.device} ` +
        `(parent ${raw.parent}, VLANs ${vlans.join(", ")}).`;
      return textResult(`${summary}\n--- output ---\n${output.length > 0 ? output : "(empty)"}`);
    },
  );
};
