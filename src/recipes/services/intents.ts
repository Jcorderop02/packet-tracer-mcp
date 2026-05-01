/**
 * L3 service intents — small, declarative shapes that the apply step turns
 * into Cisco IOS configuration. Each intent always names the device it
 * targets so the appliers can group everything per-device and push a single
 * bulk per service per device.
 */

export type AclProtocol = "ip" | "tcp" | "udp" | "icmp";

/**
 * Source / destination spec. Accepts:
 *   - "any"
 *   - "host 10.1.1.1"
 *   - "10.1.0.0 0.0.0.255"  (network + wildcard)
 *   - or a CIDR like "10.1.0.0/24" — appliers convert it to wildcard form.
 */
export type AclEndpoint = string;

export interface AclStandardRule {
  readonly action: "permit" | "deny";
  readonly source: AclEndpoint;
  readonly remark?: string;
}

export interface AclExtendedRule {
  readonly action: "permit" | "deny";
  readonly protocol: AclProtocol;
  readonly source: AclEndpoint;
  readonly destination: AclEndpoint;
  readonly portOp?: "eq" | "gt" | "lt" | "neq" | "range";
  readonly ports?: readonly (number | string)[];
  readonly remark?: string;
}

export type AclRule = AclStandardRule | AclExtendedRule;

export interface AclApplyPoint {
  readonly port: string;
  readonly direction: "in" | "out";
}

export interface AclIntent {
  readonly device: string;
  /** Numeric (1-99 standard, 100-199 extended) or named ACL. */
  readonly name: string;
  readonly kind: "standard" | "extended";
  readonly rules: readonly AclRule[];
  readonly applyTo?: readonly AclApplyPoint[];
  /** When true, the ACL is wiped (`no access-list NAME`) before re-emitting. */
  readonly replaceExisting?: boolean;
}

export type NatRole = "inside" | "outside";

export interface NatInterfaceRole {
  readonly port: string;
  readonly role: NatRole;
}

export interface NatStaticIntent {
  /** "ip <inside-local> <inside-global>" or with explicit protocol/port. */
  readonly insideLocal: string;
  readonly insideGlobal: string;
  readonly protocol?: "tcp" | "udp";
  readonly localPort?: number;
  readonly globalPort?: number;
}

export interface NatPoolIntent {
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly netmask: string;
}

export interface NatOverloadIntent {
  /** Name of an ACL that matches the inside hosts to translate. */
  readonly aclName: string;
  /** Either a pool or an interface — pick exactly one. */
  readonly poolName?: string;
  readonly outsideInterface?: string;
}

export interface NatIntent {
  readonly device: string;
  readonly interfaces?: readonly NatInterfaceRole[];
  readonly statics?: readonly NatStaticIntent[];
  readonly pools?: readonly NatPoolIntent[];
  readonly overload?: NatOverloadIntent;
}

export interface DhcpExcludedRange {
  readonly start: string;
  readonly end: string;
}

export interface DhcpPoolIntent {
  readonly device: string;
  readonly name: string;
  /** CIDR like "192.168.10.0/24" or "<network> <mask>" pair. */
  readonly network: string;
  readonly defaultRouter?: string;
  readonly dnsServer?: string;
  readonly domainName?: string;
  readonly excluded?: readonly DhcpExcludedRange[];
  /** TFTP server IP advertised via DHCP option 150 — needed for IP Phones to
   *  download their configuration from CME. */
  readonly tftpServer?: string;
}

export interface DhcpRelayIntent {
  readonly device: string;
  readonly port: string;
  readonly helpers: readonly string[];
}

export interface NtpIntent {
  readonly device: string;
  readonly servers: readonly string[];
  /** Optional PT model — used by the CLI builder to gate verbs that PT 9
   *  silently truncates (e.g. 1941 only retains the LAST `ntp server`,
   *  see VERIFIED.md F3-19). Trust-by-default when omitted. */
  readonly routerModel?: string;
}

export interface SyslogIntent {
  readonly device: string;
  readonly hosts: readonly string[];
  readonly trapLevel?: number;
  /** Optional PT model — used by the CLI builder to gate verbs that PT 9
   *  rejects with `% Invalid input` (e.g. 1941 drops `logging trap <N>`,
   *  see VERIFIED.md F3-21). Trust-by-default when omitted. */
  readonly routerModel?: string;
}

export interface ServicesIntent {
  readonly acls?: readonly AclIntent[];
  readonly nat?: readonly NatIntent[];
  readonly dhcpPools?: readonly DhcpPoolIntent[];
  readonly dhcpRelays?: readonly DhcpRelayIntent[];
  readonly ntp?: readonly NtpIntent[];
  readonly syslog?: readonly SyslogIntent[];
}
