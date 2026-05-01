import { z } from "zod";
import { listVlansJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface VlanRow {
  readonly id: number;
  readonly name: string;
  readonly isDefault: boolean;
  readonly macCount: number;
}

function parseVlans(raw: string): VlanRow[] {
  const lines = raw.split("\n").slice(1);
  const out: VlanRow[] = [];
  for (const line of lines) {
    if (!line) continue;
    const [id, name, def, mac] = line.split("|");
    out.push({
      id: Number.parseInt(id ?? "0", 10),
      name: name ?? "",
      isDefault: def === "1",
      macCount: Number.parseInt(mac ?? "-1", 10),
    });
  }
  return out;
}

const InputSchema = {
  device: z.string().min(1).describe("Switch name (or any device exposing a VlanManager process)."),
};

export const registerReadVlansTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_read_vlans",
    "Read the live VLAN database of a switch via VlanManager (id, name, default flag, MAC table size).",
    InputSchema,
    async ({ device }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(listVlansJs(device), { timeoutMs: 10_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
      if (reply === "ERR:no_vlan_manager") {
        return errorResult(`Device '${device}' does not expose a VlanManager (probably not an L2/L3 switch).`);
      }
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);

      const vlans = parseVlans(reply);
      const lines = [`VLANs on '${device}': ${vlans.length}`];
      for (const v of vlans) {
        const tag = v.isDefault ? "[default]" : "";
        const mac = v.macCount >= 0 ? ` macs=${v.macCount}` : "";
        lines.push(`  ${v.id}\t${v.name} ${tag}${mac}`.trimEnd());
      }
      return textResult(lines.join("\n"));
    },
  );
};
