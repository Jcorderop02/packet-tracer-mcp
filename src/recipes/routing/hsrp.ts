/** HSRP recipe. Applies per-interface `standby` directives to routers and persists running→startup. */

import type { Bridge } from "../../bridge/http-bridge.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs, saveRunningConfigJs } from "../../ipc/generator.js";

export interface HsrpIntent {
  readonly device: string;
  readonly port: string;
  readonly group: number;
  readonly virtualIp: string;
  readonly priority?: number;
  readonly preempt?: boolean;
  readonly authKey?: string;
  readonly version?: 1 | 2;
}

export interface HsrpReport {
  readonly devices: ReadonlyMap<string, readonly HsrpIntent[]>;
}

function isDottedQuad(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (p.length === 0 || !/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

export function hsrpCli(intent: HsrpIntent): string {
  const version = intent.version ?? 1;
  const groupMax = version === 2 ? 4095 : 255;
  if (!Number.isInteger(intent.group) || intent.group < 0 || intent.group > groupMax) {
    throw new Error(`HSRP group ${intent.group} out of range [0, ${groupMax}] for HSRPv${version}`);
  }
  if (intent.priority !== undefined) {
    if (!Number.isInteger(intent.priority) || intent.priority < 1 || intent.priority > 255) {
      throw new Error(`HSRP priority ${intent.priority} out of range [1, 255]`);
    }
  }
  if (!isDottedQuad(intent.virtualIp)) {
    throw new Error(`HSRP virtualIp '${intent.virtualIp}' is not a valid dotted-quad IPv4 address`);
  }

  const lines: string[] = [`interface ${intent.port}`];
  if (intent.version !== undefined) lines.push(` standby version ${intent.version}`);
  lines.push(` standby ${intent.group} ip ${intent.virtualIp}`);
  if (intent.priority !== undefined) lines.push(` standby ${intent.group} priority ${intent.priority}`);
  if (intent.preempt === true) lines.push(` standby ${intent.group} preempt`);
  if (intent.authKey !== undefined) lines.push(` standby ${intent.group} authentication ${intent.authKey}`);
  lines.push(" no shutdown", " exit");
  return lines.join("\n");
}

function groupByDevice(intents: readonly HsrpIntent[]): Map<string, HsrpIntent[]> {
  const m = new Map<string, HsrpIntent[]>();
  for (const it of intents) {
    const list = m.get(it.device) ?? [];
    list.push(it);
    m.set(it.device, list);
  }
  return m;
}

async function pushCli(bridge: Bridge, device: string, body: string): Promise<void> {
  const reply = await bridge.sendAndWait(
    bulkCliJs(device, wrapInConfig(body)),
    { timeoutMs: 60_000 },
  );
  if (reply === null) throw new Error(`HSRP CLI on ${device} timed out`);
  if (reply.startsWith("ERR:") || reply.startsWith("ERROR:")) {
    throw new Error(`HSRP CLI on ${device} rejected: ${reply}`);
  }
}

async function saveStartup(bridge: Bridge, device: string): Promise<void> {
  const reply = await bridge.sendAndWait(saveRunningConfigJs(device), { timeoutMs: 15_000 });
  if (reply === null) throw new Error(`write memory on ${device} timed out`);
  if (reply.startsWith("ERR:")) throw new Error(`write memory on ${device} rejected: ${reply}`);
}

export async function applyHsrp(bridge: Bridge, intents: readonly HsrpIntent[]): Promise<HsrpReport> {
  const devices = new Map<string, readonly HsrpIntent[]>();
  for (const [device, list] of groupByDevice(intents)) {
    const body = list.map(hsrpCli).join("\n");
    await pushCli(bridge, device, body);
    await saveStartup(bridge, device);
    devices.set(device, list);
  }
  return { devices };
}

export function summarizeHsrp(r: HsrpReport): string {
  if (r.devices.size === 0) return "No HSRP intents applied.";
  const lines: string[] = [`Configured HSRP on ${r.devices.size} router(s).`];
  for (const [dev, list] of r.devices) {
    lines.push(`${dev}:`);
    for (const it of list) lines.push(`  ${it.port} group=${it.group} vip=${it.virtualIp}`);
  }
  return lines.join("\n");
}
