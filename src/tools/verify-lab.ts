import { z } from "zod";
import { runPing } from "../sim/runner.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { ipv4 } from "./integration-common.js";
import { HttpCheckSchema, verifyHttp } from "./server-web.js";
import { InputSchema as DnsSchema, resolvedAddress } from "./verify-dns.js";
import { RoutingCheckSchema, verifyRouting } from "./verify-routing.js";
import type { ToolModule } from "./types.js";

const checks = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ping"), device: z.string().min(1), target: ipv4,
    reachable: z.boolean().default(true) }),
  z.object({ kind: z.literal("dns"), ...DnsSchema, expected_address: ipv4 }),
  z.object({ kind: z.literal("http"), ...HttpCheckSchema }),
  z.object({ kind: z.literal("routing"), ...RoutingCheckSchema }),
]);

export const registerVerifyLabTool: ToolModule = ({ bridge, server }) => {
  server.tool("pt_verify_lab", "Check a matrix of expected IPv4 reachability or isolation, DNS, HTTP and routing in the active lab. Reports every result in input order.", {
    checks: z.array(checks).min(1).max(12),
  }, async args => {
    const blocked = requireConnectedBridge(bridge);
    if (blocked) return blocked;
    const results = [];
    for (const [index, check] of args.checks.entries()) {
      try {
        switch (check.kind) {
          case "ping": {
            const { result } = await runPing(bridge, check.device, check.target);
            const passed = result.complete === true && result.sent > 0 && (result.received > 0) === check.reachable;
            results.push({ index, kind: check.kind, passed, sent: result.sent, received: result.received, status: result.status });
            break;
          }
          case "dns": {
            const { raw } = await runPing(bridge, check.device, check.hostname);
            const address = resolvedAddress(raw) ?? null;
            results.push({ index, kind: check.kind, passed: address === check.expected_address, address });
            break;
          }
          case "http": {
            const result = await verifyHttp(bridge, check);
            results.push({ index, kind: check.kind, passed: result.verified, url: result.url });
            break;
          }
          case "routing": {
            const result = await verifyRouting(bridge, check);
            results.push({ index, kind: check.kind, passed: result.verified === true, result });
            break;
          }
        }
      } catch (error) {
        results.push({ index, kind: check.kind, passed: false, error: String(error) });
      }
    }
    const passed = results.every(result => result.passed);
    return (passed ? textResult : errorResult)(JSON.stringify({ passed, results }));
  });
};
