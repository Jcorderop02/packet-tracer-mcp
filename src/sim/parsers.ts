/**
 * Parsers for simulation/ops output. Pure functions — no IO — so they're
 * easy to test against canned PT 9 transcripts. The tools layer is in
 * charge of running the command via the bridge and feeding the output to
 * these parsers.
 *
 * PT 9 output formats verified empirically (see scripts/probe-ipv6.ts and
 * the existing smoke transcripts under docs/smoke-runs/):
 *
 *  - PC ping (Windows-like):
 *      Pinging 192.168.1.1 with 32 bytes of data:
 *      Reply from 192.168.1.1: bytes=32 time=1ms TTL=255
 *      Request timed out.
 *      Ping statistics for 192.168.1.1:
 *          Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),
 *
 *  - Router IOS ping:
 *      Type escape sequence to abort.
 *      Sending 5, 100-byte ICMP Echos to 1.1.1.1, timeout is 2 seconds:
 *      !!!!!
 *      Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms
 *
 *  - PC tracert (Windows-like):
 *      Tracing route to 8.8.8.8 over a maximum of 30 hops:
 *        1   1 ms     0 ms     1 ms     192.168.1.1
 *        2   *        *        *        Request timed out.
 *      Trace complete.
 *
 *  - Router IOS traceroute:
 *      Tracing the route to 8.8.8.8
 *        1 192.168.1.1 4 msec 0 msec 0 msec
 *        2 * * *
 */

export interface PingResult {
  readonly target: string;
  readonly sent: number;
  readonly received: number;
  readonly lost: number;
  readonly successRate: number;
  readonly source: "pc" | "router";
  readonly raw: string;
}

export interface TracerouteHop {
  readonly hop: number;
  readonly address: string | null;
  readonly times: readonly (number | null)[];
}

export interface TracerouteResult {
  readonly target: string;
  readonly hops: readonly TracerouteHop[];
  readonly complete: boolean;
  readonly source: "pc" | "router";
  readonly raw: string;
}

const PC_PING_STATS_RE = /Packets:\s*Sent\s*=\s*(\d+)\s*,\s*Received\s*=\s*(\d+)\s*,\s*Lost\s*=\s*(\d+)/i;
const ROUTER_PING_RATE_RE = /Success rate is (\d+)\s*percent\s*\((\d+)\s*\/\s*(\d+)\)/i;
const PC_PING_HEADER_RE = /Pinging\s+([^\s]+)/i;
const ROUTER_PING_HEADER_RE = /ICMP Echos? to\s+([^\s,]+)/i;

export function parsePing(raw: string, target: string): PingResult {
  if (!raw) {
    return { target, sent: 0, received: 0, lost: 0, successRate: 0, source: "pc", raw };
  }
  const routerMatch = ROUTER_PING_RATE_RE.exec(raw);
  if (routerMatch) {
    const successRate = Number(routerMatch[1]);
    const received = Number(routerMatch[2]);
    const sent = Number(routerMatch[3]);
    const headerTarget = ROUTER_PING_HEADER_RE.exec(raw)?.[1] ?? target;
    return {
      target: headerTarget,
      sent,
      received,
      lost: sent - received,
      successRate,
      source: "router",
      raw,
    };
  }
  const pcMatch = PC_PING_STATS_RE.exec(raw);
  if (pcMatch) {
    const sent = Number(pcMatch[1]);
    const received = Number(pcMatch[2]);
    const lost = Number(pcMatch[3]);
    const headerTarget = PC_PING_HEADER_RE.exec(raw)?.[1] ?? target;
    return {
      target: headerTarget,
      sent,
      received,
      lost,
      successRate: sent > 0 ? Math.round((received / sent) * 100) : 0,
      source: "pc",
      raw,
    };
  }
  // Fallback: count "Reply from" / "!" markers — useful for partial output.
  const replyCount = (raw.match(/Reply from/gi) ?? []).length;
  const bangCount = (raw.match(/!/g) ?? []).length;
  if (bangCount > 0 || replyCount > 0) {
    const received = Math.max(replyCount, bangCount);
    return { target, sent: received, received, lost: 0, successRate: 100, source: replyCount > 0 ? "pc" : "router", raw };
  }
  return { target, sent: 0, received: 0, lost: 0, successRate: 0, source: "pc", raw };
}

const PC_HOP_RE = /^\s*(\d+)\s+(.*)$/;
const PC_HOP_TIMES_RE = /(\*|\d+\s*ms)/g;
const ROUTER_HOP_RE = /^\s*(\d+)\s+([^\s]+)\s+(.*)$/;
const ROUTER_HOP_TIMES_RE = /(\*|\d+\s*msec)/g;
const ROUTER_HOP_STARS_RE = /^\s*(\d+)\s+\*\s+\*\s+\*\s*$/;
const IPV4_OR_IPV6_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9A-Fa-f:]+)$/;

export function parseTraceroute(raw: string, target: string): TracerouteResult {
  if (!raw) {
    return { target, hops: [], complete: false, source: "pc", raw };
  }

  const isPc = /Tracing route to/i.test(raw);
  const isRouter = /Tracing the route to/i.test(raw) || /Type escape sequence/i.test(raw);
  const source: "pc" | "router" = isPc ? "pc" : isRouter ? "router" : "pc";
  const complete = /Trace complete/i.test(raw) || /Trace terminated/i.test(raw) || /Success rate is/i.test(raw);

  const hops: TracerouteHop[] = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (source === "pc") {
      const m = PC_HOP_RE.exec(line);
      if (!m) continue;
      const hopNum = Number(m[1]);
      const rest = m[2] ?? "";
      // Address is the last token on the line if it's not "*" or a stat.
      const tokens = rest.split(/\s+/);
      const last = tokens[tokens.length - 1] ?? "";
      const address = IPV4_OR_IPV6_RE.test(last) ? last : null;
      const timesMatches = [...rest.matchAll(PC_HOP_TIMES_RE)].map(t => t[1] ?? "");
      const times = timesMatches.map(t => (t === "*" ? null : Number(t.replace(/\s*ms/i, ""))));
      hops.push({ hop: hopNum, address, times });
    } else {
      // Router IOS — handle "  1 1.2.3.4 1 msec 1 msec 1 msec" and "  1 * * *".
      if (ROUTER_HOP_STARS_RE.test(line)) {
        const m = ROUTER_HOP_STARS_RE.exec(line)!;
        hops.push({ hop: Number(m[1]), address: null, times: [null, null, null] });
        continue;
      }
      const m = ROUTER_HOP_RE.exec(line);
      if (!m) continue;
      const hopNum = Number(m[1]);
      const addrTok = m[2] ?? "";
      const rest = m[3] ?? "";
      if (!IPV4_OR_IPV6_RE.test(addrTok)) continue;
      const timesMatches = [...rest.matchAll(ROUTER_HOP_TIMES_RE)].map(t => t[1] ?? "");
      const times = timesMatches.map(t => (t === "*" ? null : Number(t.replace(/\s*msec/i, ""))));
      hops.push({ hop: hopNum, address: addrTok, times });
    }
  }

  return { target, hops, complete, source, raw };
}

export function summarizePing(r: PingResult): string {
  return `ping ${r.target} (${r.source}): ${r.received}/${r.sent} replies, ${r.successRate}% success`;
}

export function summarizeTraceroute(r: TracerouteResult): string {
  const lines = [`traceroute ${r.target} (${r.source}): ${r.hops.length} hop(s)${r.complete ? "" : " — incomplete"}`];
  for (const h of r.hops) {
    const addr = h.address ?? "*";
    const times = h.times.map(t => (t === null ? "*" : `${t}ms`)).join(" ");
    lines.push(`  ${h.hop}  ${addr}  ${times}`);
  }
  return lines.join("\n");
}
