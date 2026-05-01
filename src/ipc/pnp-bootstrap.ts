/**
 * Bootstrap an IOS XE 17.x "PNP" device into a privileged-mode CLI (`#`).
 *
 * Affected models (cliMode=="pnp" in src/catalog/devices.ts):
 *   - IR1101, IR8340 (industrial routers)
 *   - IE-9320 (industrial multilayer switch)
 *
 * These chassis ship with a mandatory `Enter enable secret:` gate. Until
 * that gate is cleared every command is consumed as part of the secret
 * flow — you cannot reach `>` / `#` and any `configure terminal` aborts
 * with "% Invalid input". Real PT 9 sequence captured 2026-04-29:
 *
 *   0. (optional) initial config dialog `[yes/no]:` — the helper dismisses
 *      it with `no` if present, so callers don't need a separate
 *      `waitForCliReady` pre-step (which would itself time out on PNP).
 *   1. tail: `% No defaulting allowed\n  Enter enable secret:`
 *      → send PNP_ENABLE_SECRET
 *   2. tail: `Confirm enable secret:`
 *      → send PNP_ENABLE_SECRET again
 *   3. tail: `[menu]\nEnter your selection [2]:`
 *      → send "2" (save and exit)
 *   4. tail: `Building configuration... [OK]\n...\nPress RETURN to get started!`
 *      → send empty enterCommand (= ENTER) to drain it
 *   5. tail: `Router>` / `Switch>` (user mode)
 *      → send `enable`
 *   6. tail: `Password:`
 *      → send PNP_ENABLE_SECRET
 *   7. tail: `Router#` / `Switch#` (privileged mode) — done.
 *
 * Failure modes detected explicitly:
 *   - `% Password strength validation failed` after step 1 — IOS XE rejected
 *     the password under common-criteria policy. Aborts immediately (the
 *     next iteration would just resend the same rejected string).
 *   - Timeout — the device never reached privileged mode.
 *
 * Originally lived in scripts/probe-cli-subset.ts. Extracted 2026-05-01 so
 * that probe-encapsulation-parser, smoke-trunk-multilayer, and any future
 * tool can share the same handshake without copy-paste.
 */

import type { Bridge } from "../bridge/http-bridge.js";
import { dismissBootDialogJs, enterCommandJs, getCliStateJs } from "./generator.js";

/** Strong password used to satisfy IOS XE common-criteria policy. */
export const PNP_ENABLE_SECRET = "Pkt7r@c3r#Mcp9$Q";

export interface PnpBootstrapResult {
  readonly ok: boolean;
  readonly reason: string;
}

export interface PnpBootstrapOptions {
  /** Hard ceiling for the bootstrap; defaults to 30s. */
  readonly maxMs?: number;
  /** Optional progress logger; falls back to silent. */
  readonly log?: (msg: string) => void;
}

export async function bootstrapPnpEnableSecret(
  bridge: Bridge,
  dev: string,
  options: PnpBootstrapOptions = {},
): Promise<PnpBootstrapResult> {
  const maxMs = options.maxMs ?? 30_000;
  const log = options.log ?? (() => {});
  const deadline = Date.now() + maxMs;
  let secretSent = false;
  let confirmSent = false;
  let menuSelected = false;

  log(`[pnp] bootstrap start ${dev}`);
  let dialogDismissed = false;
  const tailPreview = (s: string): string => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 80 ? "…" + t.slice(-80) : t;
  };
  const readTail = async (): Promise<string | null> => {
    const reply = await bridge.sendAndWait(getCliStateJs(dev), { timeoutMs: 3_000 });
    if (!reply || reply.startsWith("ERR")) return null;
    try {
      return (JSON.parse(reply) as { tail?: string }).tail ?? "";
    } catch {
      return "";
    }
  };

  // Phase 1 — state-driven: drive the device past the mandatory secret /
  // confirm / menu prompts. Each prompt is a one-shot input that the device
  // immediately consumes, so we use sticky flags to avoid re-sending.
  while (Date.now() < deadline && !menuSelected) {
    const tail = await readTail();
    if (tail === null) return { ok: false, reason: "getCliState error during bootstrap" };
    log(`[pnp] tail: ${tailPreview(tail)}`);

    if (secretSent && /Password strength validation failed/i.test(tail)) {
      return {
        ok: false,
        reason: "IOS XE rejected PNP_ENABLE_SECRET as weak (update password in src/ipc/pnp-bootstrap.ts)",
      };
    }

    // Step 0 — boot dialog. Some PNP chassis open with the standard
    // "Would you like to enter the initial configuration dialog? [yes/no]:"
    // before the secret prompt. The helper dismisses it with `no` so
    // callers can skip the separate `waitForCliReady` pre-step (which
    // itself times out on PNP because the secret prompt arrives after).
    if (!dialogDismissed && /\[yes\/no\]/i.test(tail)) {
      log(`[pnp] step0 → dismissing initial config dialog`);
      await bridge.sendAndWait(dismissBootDialogJs(dev), { timeoutMs: 4_000 });
      dialogDismissed = true;
      await sleep(1_500);
      continue;
    }

    // Highest-priority match first: menu after both passwords.
    if (confirmSent && /Enter your selection/i.test(tail)) {
      log(`[pnp] step3 → selecting menu option 2 (save and exit)`);
      await bridge.sendAndWait(enterCommandJs(dev, "2"), { timeoutMs: 4_000 });
      menuSelected = true;
      await sleep(2_500);
      break;
    }
    if (/Confirm enable secret:/i.test(tail) && !confirmSent) {
      log(`[pnp] step2 → confirming secret`);
      await bridge.sendAndWait(enterCommandJs(dev, PNP_ENABLE_SECRET), { timeoutMs: 4_000 });
      confirmSent = true;
      await sleep(1_500);
      continue;
    }
    if (/Enter enable secret:/i.test(tail) && !secretSent) {
      log(`[pnp] step1 → sending secret`);
      await bridge.sendAndWait(enterCommandJs(dev, PNP_ENABLE_SECRET), { timeoutMs: 4_000 });
      secretSent = true;
      await sleep(800);
      continue;
    }
    if (!secretSent && /[>#]\s*$/.test(tail)) {
      log(`[pnp] edge: device already past secret/menu, fast-forwarding`);
      menuSelected = true;
      break;
    }
    await sleep(400);
  }

  if (!menuSelected) {
    return {
      ok: false,
      reason: `timeout in phase1 (state: dialogDismissed=${dialogDismissed} secretSent=${secretSent} confirmSent=${confirmSent})`,
    };
  }

  // Phase 2 — assertive linear sequence: post-menu the tail is volatile
  // (syslog floods can push the prompt out of the tail window). Drive blind
  // with paced sleeps:
  //   a. drain "Press RETURN to get started!" if any
  //   b. send `enable`
  //   c. send the secret as `Password:` response
  //   d. read tail and check for `#` anywhere (privileged confirmed)
  log(`[pnp] phase2 → assertive enable sequence`);
  await bridge.sendAndWait(enterCommandJs(dev, ""), { timeoutMs: 4_000 });
  await sleep(1_200);
  await bridge.sendAndWait(enterCommandJs(dev, "enable"), { timeoutMs: 4_000 });
  await sleep(1_000);
  await bridge.sendAndWait(enterCommandJs(dev, PNP_ENABLE_SECRET), { timeoutMs: 4_000 });
  await sleep(1_500);

  const finalTail = await readTail();
  if (finalTail === null) return { ok: false, reason: "getCliState error after enable sequence" };
  log(`[pnp] tail (post-enable): ${tailPreview(finalTail)}`);
  // Match `#` anywhere in the recent tail — `getOutput()` is cumulative so
  // syslog noise can append after the prompt without invalidating the climb.
  if (
    /[#]\s*$/.test(finalTail) ||
    /[A-Za-z][>#]\s*\n[^>#]*$/.test(finalTail) ||
    /Switch#|Router#/.test(finalTail.slice(-200))
  ) {
    log(`[pnp] step7 → privileged mode reached`);
    return { ok: true, reason: "reached privileged mode" };
  }
  if (/Bad secrets/i.test(finalTail)) {
    return { ok: false, reason: "enable rejected with 'Bad secrets' — secret persisted differently" };
  }
  return { ok: false, reason: `phase2 done but no '#' in final tail (last 80: ${tailPreview(finalTail)})` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
