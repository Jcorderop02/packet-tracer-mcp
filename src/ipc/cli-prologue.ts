/**
 * Single source of truth for the CLI prologue/epilogue.
 *
 * Until 2026-05-01 every recipe re-declared its own `wrapInConfig`, with five
 * verbatim copies (switching/voip/ipv6/services/configure-subinterface) plus
 * nine inline `\`enable\\nconfigure terminal\\n…\\nend\`` template strings in
 * routing and addressing recipes. The duplication hid four operational bugs
 * surfaced live against PT 9 on 2026-05-01:
 *
 *   1. Boot wizard `[yes/no]` left undismissed because PT 9's `skipBoot()`
 *      no longer dismisses it. `enable` from the wrapper is treated as a
 *      non-yes/no answer and the dialog re-prompts → all subsequent commands
 *      vanish into the wizard.
 *   2. Devices stuck in user mode `>` (downstream of #1).
 *   3. `--More--` paginator stalling on long `show` output.
 *   4. `Translating "<word>"...domain server` blocking the buffer for ~30s
 *      when a stray priv-EXEC token is interpreted as a hostname (see the
 *      note in `saveRunningConfigJs`).
 *
 * The fix is centralised here so every CLI bulk picks it up automatically:
 *
 *   - `bulkCliJs` itself prepends the boot-dialog dismissal trio (idempotent;
 *     does nothing if the device is already at `>`/`#`).
 *   - `wrapInConfig` (this module) emits `terminal length 0` after `enable`
 *     and `no ip domain-lookup` after `configure terminal` so paginated show
 *     output and DNS-translation hangs cannot bite.
 */

/**
 * Wrap a CLI body in the canonical privileged-EXEC + global-config envelope
 * with the safety lines that prevent the four PT 9 hangs documented above.
 *
 * Output shape:
 *   enable
 *   terminal length 0
 *   configure terminal
 *   no ip domain-lookup
 *   <body>
 *   end
 */
export function wrapInConfig(body: string): string {
  return [
    "enable",
    "terminal length 0",
    "configure terminal",
    "no ip domain-lookup",
    body,
    "end",
  ].join("\n");
}
