import { z } from "zod";
import { captureSnapshot } from "../canvas/snapshot.js";
import { runCliBlock } from "../ipc/reliable-cli.js";
import { makeGuard } from "./integration-common.js";
import type { ToolModule } from "./types.js";

function stpPorts(output: string) {
  return [...output.matchAll(/^\s*(\S+\d)\s+(Root|Desg|Altn|Back|Mstr)\s+(FWD|BLK|LRN|LIS|DSC)\s+/gim)]
    .map(([, port, role, state]) => ({ port, role: role!.toUpperCase(), state: state!.toUpperCase() }));
}

function macEntries(output: string, vlan: number) {
  return [...output.matchAll(/^\s*(\d+)\s+([0-9a-f]{4}(?:\.[0-9a-f]{4}){2})\s+(\S+)\s+(\S+)/gim)]
    .filter(match => Number(match[1]) === vlan)
    .map(([, , mac, type, port]) => ({ mac, type, port }));
}

export const registerDiagnoseL2Tool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_diagnose_l2", "Read switch links, spanning-tree state, MAC table and trunk output for a VLAN in the active lab.", {
    switches: z.array(z.string().min(1)).min(1).max(8),
    vlan: z.number().int().min(1).max(4094),
  }, ({ switches, vlan }) => guard(async () => {
    const snapshot = await captureSnapshot(bridge);
    const devices = [];
    for (const device of new Set(switches)) {
      if (!snapshot.devices.some(item => item.name === device && item.category === "switch")) {
        devices.push({ device, error: "Switch not found in the active workspace" });
        continue;
      }
      const [, stp, mac, trunk] = await runCliBlock(bridge, device, [
        "enable", `show spanning-tree vlan ${vlan}`, "show mac address-table", "show interfaces trunk",
      ]);
      const links = snapshot.links.filter(link => link.aDevice === device || link.bDevice === device);
      const error = [stp, mac, trunk].find(reply => !reply || reply.timedOut || reply.errors.length);
      const complete = Boolean(stp && mac && trunk && !error);
      const stpOutput = stp?.output ?? "";
      const root = /Root ID[\s\S]*?Address\s+([\da-f.]+)/i.exec(stpOutput)?.[1] ?? null;
      const ports = stpPorts(stpOutput);
      devices.push({
        device, links, complete,
        spanningTree: { root, isRoot: root ? /This bridge is the root/i.test(stpOutput) : null,
          rootPort: ports.find(port => port.role === "ROOT")?.port ?? null, ports },
        macEntries: macEntries(mac?.output ?? "", vlan),
        trunks: trunk?.output ?? null,
        ...(!complete ? { error: error?.errors.join("\n") || "CLI did not complete all L2 checks" } : {}),
      });
    }
    return JSON.stringify({ vlan, devices });
  }));
};
