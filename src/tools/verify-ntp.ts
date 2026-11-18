import { z } from "zod";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { ipv4 } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export function parseNtp(status: string, associations: string) {
  const clock = /Clock is (unsynchronized|synchronized)(?:, stratum (\d+))?(?:, reference is ([\d.]+))?/i.exec(status);
  const peers = [...associations.matchAll(/^\s*([*#+x~\-]*)\s*((?:\d{1,3}\.){3}\d{1,3})\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(\d+)/gm)]
    .map(([, flags, address, stratum, reach]) => ({
      address, selected: flags!.includes("*"), stratum: Number(stratum), reach,
    }));
  return { synchronized: clock ? /^synchronized$/i.test(clock[1]!) : null,
    stratum: clock?.[2] ? Number(clock[2]) : null, reference: clock?.[3] ?? null, peers };
}

export const registerVerifyNtpTool: ToolModule = ({ bridge, server }) => {
  server.tool("pt_verify_ntp", "Check actual NTP synchronization and the selected peer on a simulated router.", {
    router: z.string().min(1), expected_server: ipv4.optional(),
  }, async ({ router, expected_server }) => {
    const blocked = requireConnectedBridge(bridge);
    if (blocked) return blocked;
    try {
      const replies = await runCliBlock(bridge, router, ["enable", "show ntp status", "show ntp associations"]);
      const error = replies.find(reply => reply.errors.length || reply.timedOut);
      if (error || replies.length !== 3) throw new Error(error?.errors.join("\n") || "NTP lookup did not complete.");
      const ntp = parseNtp(replies[1]!.output, replies[2]!.output);
      const verified = ntp.synchronized === true && (!expected_server ||
        ntp.reference === expected_server || ntp.peers.some(peer => peer.selected && peer.address === expected_server));
      return (verified ? textResult : errorResult)(JSON.stringify({ router, ...ntp, verified }));
    } catch (error) {
      return errorResult(String(error));
    }
  });
};
