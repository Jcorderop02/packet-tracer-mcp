import type { Bridge } from "../../bridge/http-bridge.js";
import {
  configureApSsidJs,
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
  ClientAssociationIntent,
  WirelessIntent,
} from "./intents.js";

/**
 * Mensaje de error compartido. Se lanza cuando el blueprint declara clientes
 * wireless. Documentado en docs/ROADMAP.md (fase 6) y docs/VERIFIED.md
 * (F6-03/04/05): la JS IPC pública de PT 9 expone setters de
 * `WirelessClientProcess`, pero no dispara la asociación radio. La GUI
 * asocia vía código nativo C++ no expuesto a `ipc.network()`. Verificado
 * con scripts/probe-wireless-associate.ts (siete estrategias, todas dead-end).
 */
const WIRELESS_ASSOC_DEAD_END =
  "PT 9 IPC does not trigger wireless association: the JS API exposes " +
  "WirelessClientProcess setters but the radio link is established by " +
  "native C++ code that is not reachable from ipc.network(). " +
  "See docs/ROADMAP.md fase 6 and scripts/probe-wireless-associate.ts.";

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

export async function applyClientAssociations(
  _bridge: Bridge,
  clients: readonly ClientAssociationIntent[],
): Promise<WirelessAction[]> {
  if (clients.length === 0) return [];
  // Validamos para que errores de configuración afloren antes que el dead-end
  // (así quien lea el error sabe que su intent estaba bien formado, el
  // problema es la API).
  for (const client of clients) validateClientAssociation(client);
  const targets = clients.map(c => `${c.device}->${c.ssid}`).join(", ");
  throw new Error(`${WIRELESS_ASSOC_DEAD_END} Affected clients: ${targets}.`);
}

export async function applyWireless(bridge: Bridge, w: WirelessIntent): Promise<WirelessReport> {
  const actions: WirelessAction[] = [];
  if (w.aps && w.aps.length > 0) actions.push(...await applyApSsids(bridge, w.aps));
  if (w.clients && w.clients.length > 0) actions.push(...await applyClientAssociations(bridge, w.clients));
  return { actions, skipped: [] };
}

export function summarizeWireless(r: WirelessReport): string {
  if (r.actions.length === 0) return "No wireless actions applied.";
  const ap = r.actions.filter(a => a.kind === "ap-ssid").length;
  const clients = r.actions.filter(a => a.kind === "client-association").length;
  return `Applied wireless actions: ap-ssid=${ap}, client-association=${clients}.`;
}
