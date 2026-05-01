/** IGP extras recipe. Adds passive-interface and default-information originate to existing OSPF/EIGRP/RIP processes. */

import type { Bridge } from "../../bridge/http-bridge.js";
import { wrapInConfig } from "../../ipc/cli-prologue.js";
import { bulkCliJs, saveRunningConfigJs } from "../../ipc/generator.js";

export type IgpProtocol = "ospf" | "eigrp" | "rip";

export interface IgpExtrasIntent {
  readonly device: string;
  readonly protocol: IgpProtocol;
  readonly processId?: number;
  readonly passiveInterfaces?: readonly string[];
  readonly defaultOriginate?: boolean;
}

export interface IgpExtrasReport {
  readonly devices: ReadonlyMap<string, readonly IgpExtrasIntent[]>;
}

function validateProcessId(protocol: IgpProtocol, processId: number | undefined): void {
  if (protocol === "rip") {
    if (processId !== undefined) {
      throw new Error("RIP does not accept a processId");
    }
    return;
  }
  if (processId === undefined) return;
  if (!Number.isInteger(processId) || processId < 1 || processId > 65535) {
    throw new Error(`invalid ${protocol.toUpperCase()} processId: ${processId} (must be 1..65535)`);
  }
}

export function igpExtrasCli(intent: IgpExtrasIntent): string {
  validateProcessId(intent.protocol, intent.processId);

  const passives = intent.passiveInterfaces ?? [];
  const hasPassives = passives.length > 0;
  const hasDefault = intent.defaultOriginate === true;
  if (!hasPassives && !hasDefault) return "";

  const lines: string[] = [];
  if (intent.protocol === "ospf") {
    const pid = intent.processId ?? 1;
    lines.push(`router ospf ${pid}`);
    for (const port of passives) lines.push(`passive-interface ${port}`);
    if (hasDefault) lines.push("default-information originate");
  } else if (intent.protocol === "eigrp") {
    const asn = intent.processId ?? 1;
    lines.push(`router eigrp ${asn}`);
    for (const port of passives) lines.push(`passive-interface ${port}`);
    if (hasDefault) lines.push("redistribute static");
  } else {
    lines.push("router rip");
    for (const port of passives) lines.push(`passive-interface ${port}`);
    if (hasDefault) lines.push("default-information originate");
  }
  lines.push("exit");
  return lines.join("\n");
}

export async function applyIgpExtras(
  bridge: Bridge,
  intents: readonly IgpExtrasIntent[],
): Promise<IgpExtrasReport> {
  const grouped = new Map<string, IgpExtrasIntent[]>();
  for (const intent of intents) {
    const body = igpExtrasCli(intent);
    if (body.length === 0) continue;
    const list = grouped.get(intent.device) ?? [];
    list.push(intent);
    grouped.set(intent.device, list);
  }

  const devices = new Map<string, readonly IgpExtrasIntent[]>();
  for (const [device, list] of grouped) {
    const body = list.map(igpExtrasCli).join("\n");
    const reply = await bridge.sendAndWait(
      bulkCliJs(device, wrapInConfig(body)),
      { timeoutMs: 60_000 },
    );
    if (reply === null) throw new Error(`IGP extras CLI on ${device} timed out`);
    if (reply.startsWith("ERROR:") || reply.startsWith("ERR:")) {
      throw new Error(`IGP extras CLI on ${device} rejected: ${reply}`);
    }

    const save = await bridge.sendAndWait(saveRunningConfigJs(device), { timeoutMs: 15_000 });
    if (save === null) throw new Error(`write memory on ${device} timed out`);
    if (save.startsWith("ERR:")) throw new Error(`write memory on ${device} rejected: ${save}`);

    devices.set(device, list);
  }
  return { devices };
}

export function summarizeIgpExtras(r: IgpExtrasReport): string {
  if (r.devices.size === 0) return "No IGP extras applied.";
  const lines: string[] = [`Applied IGP extras on ${r.devices.size} router(s).`];
  for (const [device, list] of r.devices) {
    lines.push(`${device}:`);
    for (const intent of list) {
      const passiveCount = intent.passiveInterfaces?.length ?? 0;
      const defaultInfo = intent.defaultOriginate === true ? "Y" : "N";
      lines.push(`  ${intent.protocol} passives=${passiveCount} default-info=${defaultInfo}`);
    }
  }
  return lines.join("\n");
}
