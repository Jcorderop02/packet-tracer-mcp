import { z } from "zod";
import { runShowRunning } from "../sim/runner.js";
import { bulkCliJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface BgpRow {
  readonly status: string;
  readonly network: string;
  readonly nextHop: string;
  readonly metric: string;
  readonly localPref: string;
  readonly weight: string;
  readonly path: string;
}

/**
 * `show ip bgp` rows look like (Cisco IOS canonical output):
 *
 *   *>i 192.168.10.0/24    10.0.0.6   0    100   0      65002 i
 *   *> 10.0.0.0/30          0.0.0.0   0         32768   i
 *
 * The first column is the status code (1–3 chars), then the network, then
 * 5 numeric/text columns. We tolerate missing metric/localpref by reading
 * the line as whitespace-separated tokens and lining them up from the right.
 */
function parseBgp(out: string): BgpRow[] {
  const rows: BgpRow[] = [];
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!/^[*>sd irRSh]/.test(trimmed)) continue;
    const m = trimmed.match(/^([*>sdiRSh ]{1,4})\s+(\S+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const [, status, network, nextHop, rest] = m;
    const tokens = (rest ?? "").trim().split(/\s+/).filter(Boolean);
    // Path is the trailing tokens that include `i|e|?` at the very end.
    let path = "";
    let metric = "";
    let localPref = "";
    let weight = "";
    if (tokens.length > 0) {
      const tail = tokens[tokens.length - 1] ?? "";
      if (/^[ie?]$/.test(tail)) {
        path = tokens.slice(-Math.min(tokens.length, 4)).join(" ");
        const head = tokens.slice(0, Math.max(0, tokens.length - path.split(" ").length));
        metric = head[0] ?? "";
        localPref = head[1] ?? "";
        weight = head[2] ?? "";
      } else {
        metric = tokens[0] ?? "";
        localPref = tokens[1] ?? "";
        weight = tokens[2] ?? "";
        path = tokens.slice(3).join(" ");
      }
    }
    rows.push({
      status: (status ?? "").trim(),
      network: network ?? "",
      nextHop: nextHop ?? "",
      metric,
      localPref,
      weight,
      path,
    });
  }
  return rows;
}

const InputSchema = {
  device: z.string().min(1).describe("Router running BGP."),
  vrf: z.string().optional().describe("Optional VRF name. If unset, uses the global table."),
};

export const registerShowBgpRoutesTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_show_bgp_routes",
    "Run `show ip bgp` on a router and parse the BGP table into rows (status, network, next-hop, metric, localpref, weight, path). PT 9 has no BgpProcess JS API, so this is the only way to inspect live BGP state.",
    InputSchema,
    async ({ device, vrf }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const cmd = vrf ? `show ip bgp vpnv4 vrf ${vrf}` : "show ip bgp";
      const block = ["enable", "terminal length 0", cmd].join("\n");
      const raw = await bridge.sendAndWait(bulkCliJs(device, block, 16_000), { timeoutMs: 30_000 });
      if (raw === null) return errorResult("Timed out waiting for PT to answer.");
      if (raw === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
      if (raw.startsWith("ERR:") || raw.startsWith("ERROR:")) {
        return errorResult(`PT raised on '${cmd}': ${raw}`);
      }
      // Unwrap bulkCli envelope: `BULK|<count>|<truncated>\n<output>`.
      const newlineIdx = raw.indexOf("\n");
      const out = newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : raw;

      if (/% BGP not active/i.test(out) || /No active TCP connection/i.test(out)) {
        return errorResult(`BGP is not active on '${device}'.`);
      }
      // Some IOS variants reject `terminal length 0` — fallback to runShowRunning.
      if (/Invalid input/i.test(out) && !/Network/i.test(out)) {
        const fallback = await runShowRunning(bridge, device, undefined, 16_000)
          .catch(e => `ERR:${(e as Error).message}`);
        if (fallback.startsWith("ERR:")) return errorResult(`Fallback failed: ${fallback}`);
      }

      const rows = parseBgp(out);
      const lines = [
        `BGP table on '${device}'${vrf ? ` (vrf ${vrf})` : ""}: ${rows.length} entries`,
      ];
      if (rows.length > 0) {
        lines.push(`  Status\tNetwork\tNext-Hop\tMetric\tLocPref\tWeight\tPath`);
        for (const r of rows) {
          lines.push(
            `  ${r.status}\t${r.network}\t${r.nextHop}\t${r.metric || "-"}\t${r.localPref || "-"}\t${r.weight || "-"}\t${r.path || "-"}`,
          );
        }
      } else {
        lines.push("--- raw output ---", out.trim() || "(empty)");
      }
      return textResult(lines.join("\n"));
    },
  );
};
