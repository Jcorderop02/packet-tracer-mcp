/**
 * Pure CLI builders for L3 services. Same conventions as switching/cli.ts:
 * one function per intent, returns a `\n`-separated body to be wrapped by
 * the applier via `wrapInConfig` (see src/ipc/cli-prologue.ts).
 */

import { parseCidr, prefixToMask, prefixToWildcard } from "../../canvas/subnetting.js";
import type {
  AclEndpoint,
  AclExtendedRule,
  AclIntent,
  AclStandardRule,
  DhcpPoolIntent,
  DhcpRelayIntent,
  NatIntent,
  NtpIntent,
  SyslogIntent,
} from "./intents.js";

/**
 * Convert an ACL endpoint (any | host X | "ip wildcard" | CIDR) into the
 * canonical IOS form used inside ACL rules.
 */
export function normaliseAclEndpoint(ep: AclEndpoint): string {
  const t = ep.trim();
  if (t === "any") return "any";
  if (t.startsWith("host ")) return t;
  if (t.includes("/")) {
    const sub = parseCidr(t);
    if (sub.prefix === 32) return `host ${sub.network}`;
    return `${sub.network} ${prefixToWildcard(sub.prefix)}`;
  }
  // Already "<ip> <wildcard>" or another raw form.
  return t;
}

function aclRulePrefix(name: string, isStandard: boolean): string {
  if (/^\d+$/.test(name)) return `access-list ${name}`;
  return isStandard ? "access-list" : "access-list"; // both numeric and named go through "ip access-list" below for named
}

export function aclCli(a: AclIntent): string {
  const lines: string[] = [];
  if (a.replaceExisting) {
    if (/^\d+$/.test(a.name)) lines.push(`no access-list ${a.name}`);
    else lines.push(`no ${a.kind === "standard" ? "ip access-list standard" : "ip access-list extended"} ${a.name}`);
  }

  if (/^\d+$/.test(a.name)) {
    // Numbered ACL — global config form: `access-list <num> <action> ...`
    for (const r of a.rules) {
      if (r.remark) lines.push(`access-list ${a.name} remark ${r.remark}`);
      if (a.kind === "standard") {
        const sr = r as AclStandardRule;
        lines.push(`access-list ${a.name} ${sr.action} ${normaliseAclEndpoint(sr.source)}`);
      } else {
        const er = r as AclExtendedRule;
        lines.push(`access-list ${a.name} ${extendedRuleBody(er)}`);
      }
    }
  } else {
    // Named ACL — sub-mode under `ip access-list ...`.
    lines.push(`${a.kind === "standard" ? "ip access-list standard" : "ip access-list extended"} ${a.name}`);
    for (const r of a.rules) {
      if (r.remark) lines.push(` remark ${r.remark}`);
      if (a.kind === "standard") {
        const sr = r as AclStandardRule;
        lines.push(` ${sr.action} ${normaliseAclEndpoint(sr.source)}`);
      } else {
        const er = r as AclExtendedRule;
        lines.push(` ${extendedRuleBody(er)}`);
      }
    }
    lines.push(" exit");
  }

  for (const apply of a.applyTo ?? []) {
    lines.push(
      `interface ${apply.port}`,
      ` ip access-group ${a.name} ${apply.direction}`,
      " exit",
    );
  }
  // Touch helper to avoid unused warning if ACL is numeric only.
  void aclRulePrefix;
  return lines.join("\n");
}

function extendedRuleBody(r: AclExtendedRule): string {
  const parts: string[] = [r.action, r.protocol, normaliseAclEndpoint(r.source), normaliseAclEndpoint(r.destination)];
  if (r.portOp && r.ports && r.ports.length > 0) {
    parts.push(r.portOp, ...r.ports.map(String));
  }
  return parts.join(" ");
}

export function natCli(n: NatIntent): string {
  const lines: string[] = [];
  for (const r of n.interfaces ?? []) {
    lines.push(
      `interface ${r.port}`,
      ` ip nat ${r.role}`,
      " exit",
    );
  }
  for (const s of n.statics ?? []) {
    if (s.protocol && s.localPort !== undefined && s.globalPort !== undefined) {
      lines.push(
        `ip nat inside source static ${s.protocol} ${s.insideLocal} ${s.localPort} ${s.insideGlobal} ${s.globalPort}`,
      );
    } else {
      lines.push(`ip nat inside source static ${s.insideLocal} ${s.insideGlobal}`);
    }
  }
  for (const p of n.pools ?? []) {
    lines.push(`ip nat pool ${p.name} ${p.start} ${p.end} netmask ${p.netmask}`);
  }
  if (n.overload) {
    if (!!n.overload.poolName === !!n.overload.outsideInterface) {
      throw new Error("overload requires exactly one of poolName | outsideInterface");
    }
    if (n.overload.poolName) {
      lines.push(`ip nat inside source list ${n.overload.aclName} pool ${n.overload.poolName} overload`);
    } else {
      lines.push(`ip nat inside source list ${n.overload.aclName} interface ${n.overload.outsideInterface} overload`);
    }
  }
  return lines.join("\n");
}

export function dhcpPoolCli(p: DhcpPoolIntent): string {
  const lines: string[] = [];
  for (const ex of p.excluded ?? []) {
    lines.push(`ip dhcp excluded-address ${ex.start} ${ex.end}`);
  }
  lines.push(`ip dhcp pool ${p.name}`);
  if (p.network.includes("/")) {
    const sub = parseCidr(p.network);
    lines.push(` network ${sub.network} ${prefixToMask(sub.prefix)}`);
  } else {
    lines.push(` network ${p.network}`);
  }
  if (p.defaultRouter) lines.push(` default-router ${p.defaultRouter}`);
  if (p.dnsServer)     lines.push(` dns-server ${p.dnsServer}`);
  if (p.domainName)    lines.push(` domain-name ${p.domainName}`);
  if (p.tftpServer)    lines.push(` option 150 ip ${p.tftpServer}`);
  lines.push(" exit");
  return lines.join("\n");
}

export function dhcpRelayCli(r: DhcpRelayIntent): string {
  const lines = [`interface ${r.port}`];
  for (const h of r.helpers) lines.push(` ip helper-address ${h}`);
  lines.push(" exit");
  return lines.join("\n");
}

/**
 * PT 9 platform-aware filters for service verbs. Same DRY pattern as
 * `supportsExplicitTrunkEncapsulation` and `supportsEtherChannel` in
 * switching/cli.ts: `undefined` means trust-by-default (caller did not
 * provide a model), `false` means a known-broken combo and the builder
 * MUST throw a transparent error before any bulk hits PT.
 *
 * Evidence: scripts/probe-router-services-cli-coverage.ts run on
 * 2026-05-01 against all 6 PT 9 router models confirms the limitation
 * is UNIVERSAL — not specific to 1941:
 *
 *   | router  | ntp-multi          | logging-trap (numeric/severity) |
 *   |---------|--------------------|---------------------------------|
 *   | 1941    | accepted-with-diff | rejected / rejected             |
 *   | 2901    | accepted-with-diff | rejected / rejected             |
 *   | 2911    | accepted-with-diff | rejected / rejected             |
 *   | ISR4321 | accepted-with-diff | rejected / rejected             |
 *   | IR1101  | accepted-with-diff | rejected / rejected             |
 *   | IR8340  | accepted-with-diff | rejected / silent               |
 *
 * For ntp-multi: every router silently keeps only the LAST `ntp server`
 * line (the second one overwrites the first in running-config).
 * For logging-trap: every router rejects with `% Invalid input` (or
 * silent on IR8340 + severity-name). Tracked in VERIFIED.md F3-19/F3-21.
 *
 * If Cisco ships a new router model in a future PT update, add it to the
 * list below ONLY after running the probe and confirming the same
 * pattern. Trust-by-default keeps unknown models safe.
 */
const PT9_ROUTERS_WITH_BROKEN_NTP_MULTI = new Set([
  "1941", "2901", "2911", "ISR4321", "IR1101", "IR8340",
]);

const PT9_ROUTERS_WITH_BROKEN_LOGGING_TRAP = new Set([
  "1941", "2901", "2911", "ISR4321", "IR1101", "IR8340",
]);

export function supportsMultipleNtpServers(model: string | undefined): boolean | undefined {
  if (!model) return undefined;
  const m = model.trim().toUpperCase();
  if (PT9_ROUTERS_WITH_BROKEN_NTP_MULTI.has(m)) return false;
  return undefined;
}

export function supportsLoggingTrap(model: string | undefined): boolean | undefined {
  if (!model) return undefined;
  const m = model.trim().toUpperCase();
  if (PT9_ROUTERS_WITH_BROKEN_LOGGING_TRAP.has(m)) return false;
  return undefined;
}

export function ntpCli(n: NtpIntent): string {
  if (n.servers.length === 0) {
    throw new Error("ntpCli needs at least 1 server");
  }
  if (n.servers.length > 1 && supportsMultipleNtpServers(n.routerModel) === false) {
    throw new Error(
      `Multiple NTP servers not supported on '${n.routerModel}' in PT 9 ` +
        `(only the LAST 'ntp server' line is retained — verified 2026-05-01 ` +
        `via scripts/probe-router-services-cli-coverage.ts on all 6 PT 9 routers). ` +
        `Pass exactly one server, or omit routerModel to bypass the guard.`,
    );
  }
  return n.servers.map(s => `ntp server ${s}`).join("\n");
}

export function syslogCli(s: SyslogIntent): string {
  const lines: string[] = [];
  for (const h of s.hosts) lines.push(`logging host ${h}`);
  if (s.trapLevel !== undefined) {
    if (supportsLoggingTrap(s.routerModel) === false) {
      throw new Error(
        `'logging trap <N>' not supported on '${s.routerModel}' in PT 9 ` +
          `(parser rejects with '% Invalid input' — verified 2026-05-01 ` +
          `via scripts/probe-router-services-cli-coverage.ts on all 6 PT 9 routers). ` +
          `Omit trapLevel for this device, or omit routerModel to bypass the guard.`,
      );
    }
    lines.push(`logging trap ${s.trapLevel}`);
  }
  return lines.join("\n");
}

export { wrapInConfig } from "../../ipc/cli-prologue.js";
