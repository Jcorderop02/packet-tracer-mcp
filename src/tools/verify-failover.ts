import { z } from "zod";
import type { Bridge } from "../bridge/http-bridge.js";
import { jsStr } from "../ipc/escape.js";
import { nativeDevice } from "../ipc/integration-common.js";
import { runCliBlock, runCliBlockUnlocked, withCliLock, type CliReply } from "../ipc/reliable-cli.js";
import { runPing } from "../sim/runner.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { ipv4, nativeCall } from "./integration-common.js";
import { ipv4Prefix } from "./verify-routing.js";
import type { ToolModule } from "./types.js";

const running = new WeakSet<Bridge>();
const routeSchema = z.object({
  observer: z.string().min(1), prefix: ipv4Prefix,
  primary_next_hop: ipv4, backup_next_hop: ipv4,
});

export function routeNextHops(output: string, prefix: string): string[] {
  const hops = new Set<string>();
  let matched = false;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = /^\s*[A-Z][A-Z0-9* ]*\s+((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})(?:\s|$)/.exec(line);
    if (row) matched = row[1] === prefix;
    else if (!/^\s+\[\d+\/\d+\]\s+via\s/i.test(line)) matched = false;
    const hop = matched ? /\bvia\s+((?:\d{1,3}\.){3}\d{1,3})(?:,|\s|$)/i.exec(line)?.[1] : undefined;
    if (hop) hops.add(hop);
  }
  return [...hops];
}

function requireCli(replies: CliReply[], expected: number): string {
  const bad = replies.find(reply => reply.timedOut || reply.errors.length);
  if (bad || replies.length !== expected) {
    throw new Error(bad ? `CLI failed at '${bad.command}': ${bad.errors.join("\n") || `timeout (${bad.output.slice(-180) || "no output"})`}` : "Incomplete CLI response");
  }
  return replies.at(-1)!.output;
}

export const registerVerifyFailoverTool: ToolModule = ({ bridge, server }) => {
  server.tool("pt_verify_failover", "Temporarily shut down an up physical router interface in the active simulation. Measure ping recovery and optionally the alternate IPv4 route. Restore and verify the interface before returning.", {
    router: z.string().min(1),
    interface: z.string().regex(/^[A-Za-z]+\d+(?:\/\d+){0,3}$/),
    source: z.string().min(1), target: ipv4,
    confirm: z.literal(true),
    timeout_ms: z.number().int().min(5000).max(90_000).default(35_000),
    route: routeSchema.optional(),
  }, async args => {
    const blocked = requireConnectedBridge(bridge);
    if (blocked) return blocked;
    const { router, interface: port, source, target, route } = args;
    if (router === source || router === route?.observer) return errorResult("Use another device for the probe and route observer.");
    if (route && route.primary_next_hop === route.backup_next_hop) return errorResult("Primary and backup next hops must differ.");
    if (running.has(bridge)) return errorResult("Another failover test is running.");
    running.add(bridge);
    try {
      return await withCliLock(bridge, router, async () => {
        const portCode = nativeDevice(router, `
          var p=d.getPort(${jsStr(port)});
          if(!p||!p.getLink())return "ERR:physical_link_not_found";
          return JSON.stringify({up:p.isPortUp(),protocol:p.isProtocolUp()});
        `);
        const portState = async () => JSON.parse(await nativeCall(bridge, portCode)) as { up: boolean; protocol: boolean };
        const ios = async (commands: string[]) => requireCli(await runCliBlockUnlocked(bridge, router, commands, 5000), commands.length);
        const checkPing = async () => (await runPing(bridge, source, target, { timeoutMs: 12_000 })).result;
        const hops = async () => route ? routeNextHops(requireCli(
          await runCliBlock(bridge, route.observer, ["enable", "show ip route"], 5000), 2), route.prefix) : [];
        const initial = await portState();
        if (!initial.up || !initial.protocol) return errorResult("The tested link must initially be up/up.");
        const baseline = await checkPing();
        if (!baseline.complete || !baseline.received) return errorResult("Baseline ping failed. The link was untouched.");
        const baselineHops = await hops();
        if (route && (!baselineHops.includes(route.primary_next_hop) || baselineHops.includes(route.backup_next_hop))) {
          return errorResult(JSON.stringify({ error: "Expected only the primary route before the change", baselineHops }));
        }

        let recoveryMs: number | null = null, observedHops: string[] = [], failure: string | undefined;
        let restored = false, observationError: string | undefined;
        try {
          await ios(["enable", "configure terminal", `interface ${port}`]);
          const start = Date.now();
          await ios(["shutdown", "end"]);
          if ((await portState()).up) throw new Error("Shutdown verification failed.");
          do {
            const ping = await checkPing();
            try {
              observedHops = await hops();
              observationError = undefined;
            } catch (error) {
              observationError = String(error);
            }
            if (!observationError && ping.complete && ping.received > 0 && (!route ||
                observedHops.includes(route.backup_next_hop) && !observedHops.includes(route.primary_next_hop))) {
              recoveryMs = Date.now() - start;
              break;
            }
            await Bun.sleep(500);
          } while (Date.now() - start < args.timeout_ms);
          if (recoveryMs === null || recoveryMs > args.timeout_ms) {
            failure = `Recovery was not confirmed within the observation window.${observationError ? " " + observationError : ""}`;
          }
        } catch (error) {
          failure = String(error);
        } finally {
          try {
            const prompt = await nativeCall(bridge, nativeDevice(router, 'return String(d.getCommandLine().getPrompt()||"");'));
            if (/\(config/.test(prompt)) await ios(["end"]);
            await ios(["enable", "configure terminal", `interface ${port}`, "no shutdown", "end"]);
            const deadline = Date.now() + 10_000;
            do {
              const state = await portState();
              if (state.up && state.protocol) { restored = true; break; }
              await Bun.sleep(500);
            } while (Date.now() < deadline);
            if (!restored) throw new Error("Interface did not return to up/up.");
          } catch (error) {
            failure = [failure, `Restoration unverified for ${router} ${port}: ${error}`].filter(Boolean).join(" ");
          }
        }
        return (failure || !restored ? errorResult : textResult)(JSON.stringify({
          recoveryMs, restored, baselineHops, observedHops, ...(failure ? { error: failure } : {}),
        }));
      });
    } catch (error) {
      return errorResult(String(error));
    } finally {
      running.delete(bridge);
    }
  });
};
