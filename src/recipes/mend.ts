/**
 * Mend recipe. Inspects the live canvas, attempts a small set of safe
 * repairs, then re-inspects so the caller sees what is left over.
 *
 * What we automatically try to fix:
 *   - DEVICE_POWERED_OFF (warning) — power on + skipBoot.
 *   - ROUTER_UPLINK_UNADDRESSED (warning) — leave to the addressing recipe;
 *     mend just reports them with a hint.
 *
 * What we never auto-fix (we surface them and stop):
 *   - DUPLICATE_IP, INVALID_MASK, INVALID_IP, ROUTER_PEER_DIFFERENT_SUBNET —
 *     these almost always require the user to make an intent decision.
 */

import type { Bridge } from "../bridge/http-bridge.js";
import { captureSnapshot } from "../canvas/snapshot.js";
import { inspect, type Issue } from "../canvas/inspect.js";
import { setDevicePowerJs } from "../ipc/generator.js";

export interface MendAction {
  readonly device: string;
  readonly applied: "powered-on";
  readonly detail: string;
}

export interface MendReport {
  readonly issuesBefore: readonly Issue[];
  readonly issuesAfter: readonly Issue[];
  readonly actions: readonly MendAction[];
}

export async function mendCanvas(bridge: Bridge): Promise<MendReport> {
  const snapBefore = await captureSnapshot(bridge);
  const issuesBefore = inspect(snapBefore);

  const actions: MendAction[] = [];

  for (const issue of issuesBefore) {
    if (issue.code !== "DEVICE_POWERED_OFF") continue;
    const dev = issue.devices[0];
    if (!dev) continue;
    const reply = await bridge.sendAndWait(setDevicePowerJs(dev, true), { timeoutMs: 30_000 });
    if (reply !== null && reply.startsWith("OK")) {
      actions.push({ device: dev, applied: "powered-on", detail: "setPower(true)+skipBoot" });
    }
  }

  const snapAfter = actions.length > 0 ? await captureSnapshot(bridge) : snapBefore;
  const issuesAfter = actions.length > 0 ? inspect(snapAfter) : issuesBefore;

  return {
    issuesBefore,
    issuesAfter,
    actions,
  };
}

export function summarizeMend(r: MendReport): string {
  const lines: string[] = [];
  lines.push(`Issues before: ${r.issuesBefore.length}.`);
  lines.push(`Issues after:  ${r.issuesAfter.length}.`);
  if (r.actions.length === 0) {
    lines.push("No automatic repairs applied.");
  } else {
    lines.push("", "Applied:");
    for (const a of r.actions) lines.push(`  - ${a.device}: ${a.applied} (${a.detail})`);
  }
  if (r.issuesAfter.length > 0) {
    lines.push("", "Remaining issues:");
    for (const i of r.issuesAfter) lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
  }
  return lines.join("\n");
}
