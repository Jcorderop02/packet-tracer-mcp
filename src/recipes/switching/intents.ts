/**
 * L2 switching intents — a small declarative shape that the
 * `apply.ts` recipe turns into concrete CLI batches and pushes to
 * switches via the bridge.
 *
 * These intents are meant to compose alongside L3 addressing/routing in a
 * Blueprint. They never describe a *plan that lives in memory*; the canvas
 * remains the source of truth and the apply step re-snapshots before acting.
 */

export interface VlanIntent {
  /** Switch device name. */
  readonly switch: string;
  /** VLAN id 1–4094 (1 is reserved as default by the platform). */
  readonly id: number;
  /** Optional human-readable name. */
  readonly name?: string;
  /** Ports that should sit in `switchport access vlan <id>`. */
  readonly accessPorts?: readonly string[];
}

export interface TrunkIntent {
  readonly switch: string;
  readonly port: string;
  /** Optional PT model for platform-specific CLI quirks. */
  readonly switchModel?: string;
  /** When omitted, the trunk allows all VLANs (the IOS default). */
  readonly allowed?: readonly number[];
  readonly native?: number;
  readonly encapsulation?: "dot1q" | "isl";
}

export type PortSecurityViolation = "shutdown" | "restrict" | "protect";

export interface PortSecurityIntent {
  readonly switch: string;
  readonly port: string;
  readonly maxMac?: number;
  readonly sticky?: boolean;
  readonly violation?: PortSecurityViolation;
}

export type EtherChannelMode = "active" | "passive" | "on" | "auto" | "desirable";

export interface EtherChannelIntent {
  readonly switch: string;
  readonly ports: readonly string[];
  readonly group: number;
  readonly mode?: EtherChannelMode;
  /** Optional PT model — used to filter platforms whose IOS XE parser
   *  stub drops `channel-group` (e.g. IE-9320 in PT 9). */
  readonly switchModel?: string;
}

export interface SwitchingIntent {
  readonly vlans?: readonly VlanIntent[];
  readonly trunks?: readonly TrunkIntent[];
  readonly portSecurity?: readonly PortSecurityIntent[];
  readonly etherChannels?: readonly EtherChannelIntent[];
}
