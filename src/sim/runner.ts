/** CLI operations share the per-device asynchronous runner: output offsets,
 * pagination, completion polling and serialization prevent stale transcripts
 * or concurrent commands from being mistaken for completed operations. */

import type { Bridge } from "../bridge/http-bridge.js";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { jsStr } from "../ipc/escape.js";
import { parsePing, parseTraceroute, type PingResult, type TracerouteResult } from "./parsers.js";

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export async function runPing(
  bridge: Bridge,
  device: string,
  target: string,
  opts: RunOptions = {},
): Promise<{ raw: string; result: PingResult }> {
  const replies = await runCliBlock(bridge, device, [`ping ${target}`], opts.timeoutMs ?? 25000);
  const reply = replies.at(-1)!;
  if (reply.errors.length) throw new Error(reply.errors.join("\n"));
  const result = parsePing(reply.output, target);
  return { raw: reply.output, result: reply.timedOut ? { ...result, complete: false, status: "timeout" } : result };
}

export async function runTraceroute(
  bridge: Bridge,
  device: string,
  target: string,
  opts: RunOptions = {},
): Promise<{ raw: string; result: TracerouteResult }> {
  const kind = await bridge.sendAndWait(`(function(){var d=ipc.network().getDevice(${jsStr(device)});if(!d)return "ERR:not_found";return String(d.getClassName());})()`);
  if (!kind || /^(ERR|ERROR):/.test(kind)) throw new Error(kind ?? "Device lookup timeout");
  const command = `${/PC|Laptop|Server/i.test(kind) ? "tracert" : "traceroute"} ${target}`;
  const replies = await runCliBlock(bridge, device, [command], opts.timeoutMs ?? 60000);
  const reply = replies.at(-1)!;
  if (reply.errors.length) throw new Error(reply.errors.join("\n"));
  const result = parseTraceroute(reply.output, target);
  return { raw: reply.output, result: reply.timedOut ? { ...result, complete: false } : result };
}

/** Read running config through the asynchronous, pagination-aware CLI runner. */
export async function runShowRunning(
  bridge: Bridge,
  device: string,
  section?: string,
  tailChars = 6_000,
): Promise<string> {
  const cmd = section ? `show running-config | section ${section}` : "show running-config";
  const replies = await runCliBlock(bridge, device, ["enable", cmd]);
  if (replies.some(r => r.timedOut || r.errors.length)) throw new Error(JSON.stringify(replies));
  return replies.at(-1)!.output.slice(-tailChars);
}

/**
 * `show running-config | include <pattern>` — alternative to
 * `runShowRunning` when the caller knows exactly which line(s) to look
 * for. The `| include` filter cuts output below PT 9's pagination
 * threshold even on switches that don't accept `terminal length 0`.
 */
export async function runShowRunningInclude(
  bridge: Bridge,
  device: string,
  pattern: string,
  tailChars = 4_000,
): Promise<string> {
  const cmd = `show running-config | include ${pattern}`;
  const replies = await runCliBlock(bridge, device, ["enable", cmd]);
  if (replies.some(r => r.timedOut || r.errors.length)) throw new Error(JSON.stringify(replies));
  return replies.at(-1)!.output.slice(-tailChars);
}
