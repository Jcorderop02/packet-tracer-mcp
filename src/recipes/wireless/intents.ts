/**
 * Wireless intents target Packet Tracer's native WirelessServer /
 * WirelessClient process APIs rather than IOS CLI. The surface is documented
 * in docs/pt-api/classes/WirelessServerProcess.md and
 * WirelessClientProcess.md; smoke still has to verify behaviour on live PT.
 */

export type WirelessSecurity = "open" | "wpa2-psk";

export interface ApSsidIntent {
  readonly device: string;
  readonly ssid: string;
  readonly security: WirelessSecurity;
  readonly psk?: string;
  /** 2.4 GHz channel, 1..11. PT's StandardChannel enum is zero-based. */
  readonly channel?: number;
  /** Informational for now; put the wired AP switchport in this VLAN. */
  readonly vlanId?: number;
}

export interface ClientAssociationIntent {
  readonly device: string;
  readonly ssid: string;
  readonly psk?: string;
  /** Defaults to true because wireless clients usually rely on the LAN DHCP pool. */
  readonly dhcp?: boolean;
}

export interface WirelessIntent {
  readonly aps?: readonly ApSsidIntent[];
  readonly clients?: readonly ClientAssociationIntent[];
}
