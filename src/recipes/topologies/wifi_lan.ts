/**
 * Simple wireless LAN: one router provides the wired gateway + DHCP pool, one
 * AccessPoint-PT publishes an SSID, and N Laptop-PT clients associate to it.
 * Wireless configuration uses PT native processes, not IOS CLI.
 */

import {
  DEFAULT_LAN_POOL,
  type Blueprint,
  type DeviceIntent,
  type LanIntent,
  type LinkIntent,
} from "../blueprint.js";
import {
  prefixToMask,
  SubnetIterator,
  subnetHosts,
} from "../../canvas/subnetting.js";
import type { WirelessSecurity } from "../wireless/intents.js";

export interface WifiLanOptions {
  readonly clients: number;
  readonly ssid?: string;
  readonly security?: WirelessSecurity;
  readonly psk?: string;
  readonly channel?: number;
  readonly routerModel?: string;
  readonly apModel?: string;
  readonly clientModel?: string;
  readonly lanPool?: string;
}

const ROUTER_LAN_PORT = "GigabitEthernet0/0";
const AP_WIRED_PORT = "Port 0";

export function wifiLan(opts: WifiLanOptions): Blueprint {
  if (opts.clients < 1) throw new Error("wifi_lan needs at least 1 wireless client");
  if (opts.clients > 12) throw new Error("wifi_lan caps at 12 clients to keep the canvas readable");

  const ssid = opts.ssid ?? "PT-WIFI";
  if (!ssid.trim()) throw new Error("ssid cannot be empty");
  const security = opts.security ?? "wpa2-psk";
  const psk = opts.psk ?? (security === "wpa2-psk" ? "packettracer" : undefined);
  if (security === "wpa2-psk" && !psk) throw new Error("wpa2-psk requires psk");
  if (security === "open" && psk) throw new Error("open wifi_lan cannot include psk");

  const routerModel = opts.routerModel ?? "1941";
  const apModel = opts.apModel ?? "AccessPoint-PT";
  const clientModel = opts.clientModel ?? "Laptop-PT";
  const lanPool = opts.lanPool ?? DEFAULT_LAN_POOL;
  const lan = new SubnetIterator(lanPool, 24).next();

  const devices: DeviceIntent[] = [
    { name: "WGW", model: routerModel, x: 300, y: 220 },
    { name: "AP1", model: apModel, x: 300, y: 380 },
  ];
  const links: LinkIntent[] = [
    {
      aDevice: "WGW",
      aPort: ROUTER_LAN_PORT,
      bDevice: "AP1",
      bPort: AP_WIRED_PORT,
      cable: "straight",
    },
  ];
  const clientNames: string[] = [];
  for (let i = 0; i < opts.clients; i++) {
    const name = `WCLIENT${i + 1}`;
    clientNames.push(name);
    devices.push({ name, model: clientModel, x: 120 + i * 75, y: 540 });
  }

  const lans: LanIntent[] = [
    {
      gatewayDevice: "WGW",
      gatewayPort: ROUTER_LAN_PORT,
      endpoints: [],
      cidr: `${lan.network}/${lan.prefix}`,
      dhcp: true,
    },
  ];

  return {
    name: `wifi-lan-${opts.clients}c`,
    devices,
    links,
    lans,
    routing: "none",
    addressing: { lanPool },
    wireless: {
      aps: [{
        device: "AP1",
        ssid,
        security,
        ...(psk ? { psk } : {}),
        ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
      }],
      clients: clientNames.map(device => ({
        device,
        ssid,
        ...(psk ? { psk } : {}),
        dhcp: true,
      })),
    },
  };
}

export function previewWifiLan(opts: WifiLanOptions): { network: string; gateway: string; mask: string } {
  const sub = new SubnetIterator(opts.lanPool ?? DEFAULT_LAN_POOL, 24).next();
  const hosts = subnetHosts(sub);
  return {
    network: `${sub.network}/${sub.prefix}`,
    gateway: hosts[0] ?? "",
    mask: prefixToMask(sub.prefix),
  };
}
