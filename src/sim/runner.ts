/**
 * Live execution helpers for the simulation/ops layer (Phase 8).
 *
 * The Script Engine in PT 9 dispatches one expression at a time and returns
 * synchronously, so async commands like ping/traceroute can't be awaited
 * inside a single JS round-trip — the device just queues the command and
 * keeps cooking. The pattern mirrors `scripts/smoke.ts`:
 *
 *  1) push the command via `enterCommandJs`
 *  2) poll `getCommandLine().getOutput()` with a tiny JS reader that returns
 *     the slice since the command marker
 *  3) stop when a known terminator appears (or the deadline hits)
 *
 * The terminators are stable across PT 9 transcripts (see `parsers.ts`):
 *  - PC ping: "Ping statistics for"
 *  - Router IOS ping: "Success rate is"
 *  - PC tracert: "Trace complete." / "Trace terminated."
 *  - Router IOS traceroute: "* * *" repeated, or last hop reaching target
 *  - show running-config (any IOS device): the prompt returns at end
 */

import type { Bridge } from "../bridge/http-bridge.js";
import { bulkCliJs, enterCommandJs } from "../ipc/generator.js";
import { jsStr } from "../ipc/escape.js";
import { withLabel, truncateForLabel } from "../ipc/label.js";
import { parsePing, parseTraceroute, type PingResult, type TracerouteResult } from "./parsers.js";

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_POLL = 1_500;

function readSinceMarkerJs(device: string, marker: string): string {
  return withLabel(
    `Leyendo CLI de ${device} desde marker "${truncateForLabel(marker, 30)}"`,
    `(function(){` +
      `var d=ipc.network().getDevice(${jsStr(device)});` +
      `if(!d)return "ERR:not_found";` +
      `var out=d.getCommandLine().getOutput();` +
      `var marker=${jsStr(marker)};` +
      `var i=out.lastIndexOf(marker);` +
      `return i>=0?out.substring(i):out;` +
    `})()`,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send `command` to `device` and poll the CLI output until any of `done`
 * regexes matches the slice produced after the command, or the deadline
 * expires. Returns the captured slice (raw transcript including the echoed
 * command line).
 */
async function runAndWait(
  bridge: Bridge,
  device: string,
  command: string,
  done: readonly RegExp[],
  opts: RunOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL;

  const sent = await bridge.sendAndWait(enterCommandJs(device, command), { timeoutMs: 10_000 });
  if (sent === null) throw new Error(`Bridge timeout sending '${command}' to ${device}.`);
  if (sent.startsWith("ERR:") || sent.startsWith("ERROR:")) {
    throw new Error(`PT raised on '${command}' (${device}): ${sent}`);
  }

  const deadline = Date.now() + timeoutMs;
  let last = sent;
  while (Date.now() < deadline) {
    const slice = await bridge.sendAndWait(readSinceMarkerJs(device, command), { timeoutMs: 8_000 });
    if (slice !== null && !slice.startsWith("ERR:") && !slice.startsWith("ERROR:")) {
      last = slice;
      if (done.some(re => re.test(last))) return last;
    }
    await sleep(pollIntervalMs);
  }
  return last;
}

const PING_DONE = [/Ping statistics for/i, /Success rate is/i, /Destination host unreachable/i];
const TRACE_DONE = [/Trace complete\./i, /Trace terminated/i, /Success rate is/i];

export async function runPing(
  bridge: Bridge,
  device: string,
  target: string,
  opts: RunOptions = {},
): Promise<{ raw: string; result: PingResult }> {
  const cmd = `ping ${target}`;
  const raw = await runAndWait(bridge, device, cmd, PING_DONE, {
    timeoutMs: opts.timeoutMs ?? 25_000,
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL,
  });
  return { raw, result: parsePing(raw, target) };
}

export async function runTraceroute(
  bridge: Bridge,
  device: string,
  target: string,
  opts: RunOptions = {},
): Promise<{ raw: string; result: TracerouteResult }> {
  // PC uses `tracert`, IOS routers use `traceroute`. Send both — the wrong
  // one prints `Invalid input` and is ignored; the right one runs. This
  // keeps the tool agnostic to device type without an extra IPC round-trip
  // to introspect the device kind.
  const cmd = `traceroute ${target}`;
  const tracert = `tracert ${target}`;
  // Send `traceroute` first (works on routers), then `tracert` after a
  // short delay (works on PCs). The poller waits for either terminator.
  const sent1 = await bridge.sendAndWait(enterCommandJs(device, cmd), { timeoutMs: 10_000 });
  if (sent1 === null) throw new Error(`Bridge timeout sending '${cmd}' to ${device}.`);
  await sleep(800);
  await bridge.sendAndWait(enterCommandJs(device, tracert), { timeoutMs: 10_000 });

  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let last = "";
  while (Date.now() < deadline) {
    // Read since the earliest of the two echoed commands.
    const slice = await bridge.sendAndWait(readSinceMarkerJs(device, "race"), { timeoutMs: 8_000 });
    if (slice !== null && !slice.startsWith("ERR:") && !slice.startsWith("ERROR:")) {
      last = slice;
      if (TRACE_DONE.some(re => re.test(last))) break;
    }
    await sleep(opts.pollIntervalMs ?? DEFAULT_POLL);
  }
  return { raw: last, result: parseTraceroute(last, target) };
}

/**
 * Bulk-execute `show running-config` (optionally filtered by a `| section`
 * pattern) on a single device. Uses bulkCliJs so it goes through the
 * privileged-exec gate on routers that need `enable` first.
 *
 * Pagination caveat: PT 9's switch IOS subset (2950/2960/3560/3650/IE-3xxx/
 * IE-9320) DOES NOT implement `terminal length 0` (verified 2026-05-01 via
 * `scripts/probe-multilayer-cli-coverage.ts` — every switch responds
 * `% Invalid input detected at '^' marker` to that command). PT routers do
 * accept it but the helper can't tell apart router vs switch from `device`
 * alone, so it does NOT preemptively try to disable pagination. Callers
 * that hit `--More--` (running > ~24 lines) MUST narrow the output with a
 * `| section <pattern>` filter or use `runShowRunningInclude` below; if
 * pagination kicks in, the bulk reply truncates at the first page AND
 * subsequent commands on this device are eaten by the paginator until it
 * times out.
 *
 * Source on missing verb: Cisco Community confirms PT only ships an IOS
 * subset and "if a command is not there, there is no workaround"
 * (https://community.cisco.com/t5/routing-and-sd-wan/how-to-stop-paging-of-commands-output-on-cisco-ios-devices/td-p/5080418).
 */
export async function runShowRunning(
  bridge: Bridge,
  device: string,
  section?: string,
  tailChars = 6_000,
): Promise<string> {
  const cmd = section ? `show running-config | section ${section}` : "show running-config";
  const block = ["enable", cmd].join("\n");
  const raw = await bridge.sendAndWait(bulkCliJs(device, block, tailChars), { timeoutMs: 30_000 });
  if (raw === null) throw new Error(`Bridge timeout running '${cmd}' on ${device}.`);
  if (raw.startsWith("ERR:") || raw.startsWith("ERROR:")) {
    throw new Error(`PT raised on '${cmd}' (${device}): ${raw}`);
  }
  // bulkCliJs returns `BULK|<count>|<truncated>\n<output>`; strip the header.
  const newlineIdx = raw.indexOf("\n");
  return newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : raw;
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
  const block = ["enable", cmd].join("\n");
  const raw = await bridge.sendAndWait(bulkCliJs(device, block, tailChars), { timeoutMs: 30_000 });
  if (raw === null) throw new Error(`Bridge timeout running '${cmd}' on ${device}.`);
  if (raw.startsWith("ERR:") || raw.startsWith("ERROR:")) {
    throw new Error(`PT raised on '${cmd}' (${device}): ${raw}`);
  }
  const newlineIdx = raw.indexOf("\n");
  return newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : raw;
}
