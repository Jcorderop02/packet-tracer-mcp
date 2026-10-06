import { z } from "zod";
import { fetchDeviceModel } from "../ipc/device-model.js";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * The Script Engine accepts only single-line `enterCommand` payloads. To run
 * a configuration block (an OSPF stanza, a NAT pool, ACL list, ...) the
 * caller passes the whole block as one string and we split it client-side
 * before sending. The reply uses the structured BULK protocol from
 * `bulkCliJs`: the first line carries the number of commands run and a
 * truncation flag so the caller knows whether the slice is the full
 * transcript or just the tail.
 */
const InputSchema = {
  device: z.string().min(1).describe("Router or switch name."),
  commands: z.string().min(1).describe(
    "Multi-line CLI block. Lines are split, trimmed and sent one-by-one. Empty lines are ignored.",
  ),
  tail_chars: z.number().int().min(100).max(20_000).default(2_000)
    .describe("How many characters of trailing console output to return at most."),
};

export const registerRunCliBulkTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_run_cli_bulk",
    "Push a multi-line CLI block (e.g. an OSPF/EIGRP stanza or a sequence of `ip nat` rules) to a device. Returns a structured payload with the count of commands sent, a truncation flag, and the captured output.",
    InputSchema,
    async ({ device, commands, tail_chars }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      // Pre-process: model-aware encapsulation filter. Two families reject
      // the `switchport trunk encapsulation` subcommand:
      //   - 2950/2960 (legacy IOS): only support 802.1Q implicitly, parser
      //     never exposed the verb.
      //   - 3650/IE-3400/IE-9320 (IOS XE 16.x/17.x): real Cisco kept the
      //     verb but PT 9 only ships dot1q — its IOS XE parser drops the
      //     `encapsulation` keyword and replies "% Invalid input".
      // Only 3560 (IOS 12.x multilayer) accepts AND requires the command
      // — and demands it BEFORE `mode trunk`. Verified empirically with
      // scripts/probe-encapsulation-parser.ts on 2026-05-01.
      const className = await fetchDeviceModel(bridge, device);
      const shouldFilter = classRejectsEncapsulation(className);
      const { filtered, droppedCount, droppedSamples } = shouldFilter
        ? stripEncapsulationLines(commands)
        : { filtered: commands, droppedCount: 0, droppedSamples: [] as string[] };

      try {
        const lines = filtered.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const replies = await runCliBlock(bridge, device, lines);
        const failed = replies.some(r => r.timedOut || r.errors.length);
        const result = { requested: lines.length, executed: replies.length, droppedCount, droppedSamples,
          stoppedOnError: failed, replies: replies.map(r => ({ ...r, truncated: r.output.length > tail_chars, output: r.output.slice(-tail_chars) })) };
        return (failed ? errorResult : textResult)(JSON.stringify(result, null, 2));
      } catch (e) { return errorResult(String(e)); }

    },
  );
};

/**
 * Catalyst chassis whose PT 9 parser rejects
 * `switchport trunk encapsulation ...` with "% Invalid input":
 *
 *   - 2950 / 2950T / 2960 (legacy IOS): only 802.1Q, verb never exposed.
 *   - 3650 / IE-3400 / IE-9320 (IOS XE 16.x/17.x): real Cisco accepts the
 *     verb but PT's IOS XE parser drops it.
 *
 * 3560 (IOS 12.x multilayer) IS the only switch that accepts the command,
 * so we explicitly do NOT match it here. Anything else (including unknown
 * models) gets the benefit of the doubt — we do NOT filter.
 *
 * Verified 2026-05-01 with scripts/probe-encapsulation-parser.ts. Update
 * via probe rerun if Cisco ships a new parser revision.
 */
export function classRejectsEncapsulation(className: string | null): boolean {
  if (!className) return false;
  // Order matters: match "3560" first to short-circuit (it's the only
  // accepting model). Without this, "3560-24PS" could end up in the
  // 3650/IE families if we got the regex wrong.
  if (/3560/i.test(className)) return false;
  return /(2950|2960|3650|IE-3400|IE-9320)/i.test(className);
}

/**
 * Strip `switchport trunk encapsulation ...` lines from a CLI block. Used
 * only when the target switch is known to reject the command (see
 * `classRejectsEncapsulation`). Pure function — exported for unit tests.
 */
export function stripEncapsulationLines(block: string): {
  filtered: string;
  droppedCount: number;
  droppedSamples: string[];
} {
  const lines = block.split(/\r?\n/);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const line of lines) {
    if (/^\s*switchport\s+trunk\s+encapsulation\b/i.test(line)) {
      dropped.push(line.trim());
      continue;
    }
    kept.push(line);
  }
  return {
    filtered: kept.join("\n"),
    droppedCount: dropped.length,
    droppedSamples: dropped.slice(0, 3),
  };
}

