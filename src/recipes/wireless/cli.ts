import type { ApSsidIntent, ClientAssociationIntent } from "./intents.js";

export const WIRELESS_ENCRYPT = {
  open: 0,
  "wpa2-psk": 4,
} as const;

export function standardChannel(channel: number): number {
  if (!Number.isInteger(channel) || channel < 1 || channel > 11) {
    throw new Error("wireless channel must be an integer in 1..11");
  }
  return channel - 1;
}

export function validateApSsid(i: ApSsidIntent): void {
  if (!i.ssid.trim()) throw new Error("AP SSID cannot be empty");
  if (i.security === "wpa2-psk" && !i.psk) throw new Error(`AP ${i.device} uses wpa2-psk but psk is missing`);
  if (i.security === "open" && i.psk) throw new Error(`AP ${i.device} is open but psk was provided`);
  if (i.channel !== undefined) standardChannel(i.channel);
  if (i.vlanId !== undefined && (!Number.isInteger(i.vlanId) || i.vlanId < 1 || i.vlanId > 4094)) {
    throw new Error("wireless vlanId must be in 1..4094");
  }
}

export function validateClientAssociation(i: ClientAssociationIntent): void {
  if (!i.ssid.trim()) throw new Error("client SSID cannot be empty");
}

export function apSummary(i: ApSsidIntent): string {
  const parts = [`ssid=${i.ssid}`, `security=${i.security}`];
  if (i.channel !== undefined) parts.push(`channel=${i.channel}`);
  if (i.vlanId !== undefined) parts.push(`vlan=${i.vlanId}`);
  return parts.join(" ");
}

export function clientSummary(i: ClientAssociationIntent): string {
  return `ssid=${i.ssid}${i.dhcp === false ? " static" : " dhcp"}`;
}
