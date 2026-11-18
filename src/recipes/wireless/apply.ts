import { isIP } from "node:net";
import type { Bridge } from "../../bridge/http-bridge.js";
import { associateOpenDefault, installWirelessJs, readWirelessAssociation } from "../../ipc/wireless-client.js";
import {
  configureApSsidJs,
  setEndpointDhcpJs,
} from "../../ipc/generator.js";
import {
  apSummary,
  clientSummary,
  standardChannel,
  validateApSsid,
  validateClientAssociation,
  WIRELESS_ENCRYPT,
} from "./cli.js";
import type {
  ApSsidIntent,
  WirelessIntent,
} from "./intents.js";

export interface WirelessAction {
  readonly device: string;
  readonly kind: "ap-ssid" | "client-association";
  readonly detail: string;
  readonly reply: string;
}

export interface WirelessReport {
  readonly actions: readonly WirelessAction[];
  readonly skipped: readonly { readonly target: string; readonly reason: string }[];
}

async function push(bridge: Bridge, label: string, js: string): Promise<string> {
  const reply = await bridge.sendAndWait(js, { timeoutMs: 20_000 });
  if (reply === null) throw new Error(`${label} timed out`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`${label} rejected: ${reply}`);
  }
  return reply;
}

export async function applyApSsids(bridge: Bridge, aps: readonly ApSsidIntent[]): Promise<WirelessAction[]> {
  const actions: WirelessAction[] = [];
  for (const ap of aps) {
    validateApSsid(ap);
    const reply = await push(
      bridge,
      `wireless AP ${ap.device}`,
      configureApSsidJs({
        device: ap.device,
        ssid: ap.ssid,
        encryptType: WIRELESS_ENCRYPT[ap.security],
        ...(ap.psk ? { psk: ap.psk } : {}),
        ...(ap.channel !== undefined ? { standardChannel: standardChannel(ap.channel) } : {}),
      }),
    );
    actions.push({ device: ap.device, kind: "ap-ssid", detail: apSummary(ap), reply });
  }
  return actions;
}

export function validateWirelessAssociations(intent: WirelessIntent): string | undefined {
  if (!intent.clients?.length) return;
  for (const client of intent.clients) {
    validateClientAssociation(client);
    if (client.ssid !== "Default" || client.psk !== undefined) {
      throw new Error("Native client association supports only the open Default profile. Configure arbitrary SSIDs in the GUI.");
    }
  }
  const aps = intent.aps?.filter(ap => ap.ssid === "Default" && ap.security === "open") ?? [];
  if (aps.length !== 1) throw new Error("Client association requires exactly one AP advertising open Default in this intent.");
  return aps[0]!.device;
}

export async function applyWireless(
  bridge: Bridge, intent: WirelessIntent, placedDevices: readonly string[] = [],
): Promise<WirelessReport> {
  const ap = validateWirelessAssociations(intent);
  const actions = await applyApSsids(bridge, intent.aps ?? []);
  if (ap) {
    for (const client of intent.clients ?? []) {
      if (placedDevices.includes(client.device)) {
        await push(bridge, `wireless adapter on ${client.device}`, installWirelessJs(client.device, true));
      }
      let state = await associateOpenDefault(bridge, client.device, ap);
      if (client.dhcp ?? true) {
        await push(bridge, `wireless DHCP on ${client.device}`, setEndpointDhcpJs(client.device, "Wireless0"));
        const deadline = Date.now() + 45_000;
        do {
          await Bun.sleep(500);
          state = await readWirelessAssociation(bridge, client.device);
        } while (!(state.dhcp && assigned(state.ip)) && Date.now() < deadline);
        if (!state.associated || !state.accessPoints.includes(ap) || !state.dhcp || !assigned(state.ip)) {
          throw new Error(`DHCP or association not confirmed for ${client.device} on ${ap}`);
        }
      }
      actions.push({ device: client.device, kind: "client-association", detail: clientSummary(client), reply: JSON.stringify(state) });
    }
  }
  return { actions, skipped: [] };
}

function assigned(ip: string): boolean {
  return isIP(ip) === 4 && ip !== "0.0.0.0" && !ip.startsWith("169.254.");
}

export function summarizeWireless(r: WirelessReport): string {
  if (r.actions.length === 0) return "No wireless actions applied.";
  const ap = r.actions.filter(a => a.kind === "ap-ssid").length;
  const clients = r.actions.filter(a => a.kind === "client-association").length;
  return `Applied wireless actions: ap-ssid=${ap}, client-association=${clients}.`;
}
