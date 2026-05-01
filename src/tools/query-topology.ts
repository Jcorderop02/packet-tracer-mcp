import { listDevicesJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface ParsedDevice {
  name: string;
  model: string;
  className: string;
  x: string;
  y: string;
}

function parseSnapshot(raw: string): { count: number; rows: ParsedDevice[] } | null {
  const lines = raw.split("\n");
  const count = Number.parseInt(lines[0] ?? "", 10);
  if (Number.isNaN(count)) return null;
  const rows: ParsedDevice[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split("|");
    if (parts.length < 5) continue;
    rows.push({
      name: parts[0]!,
      model: parts[1]!,
      className: parts[2]!,
      x: parts[3]!,
      y: parts[4]!,
    });
  }
  return { count, rows };
}

export const registerQueryTopologyTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_query_topology",
    "Snapshot the live topology in Packet Tracer: returns name, model, classname and coordinates for every user-placed device.",
    {},
    async () => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const raw = await bridge.sendAndWait(listDevicesJs(), { timeoutMs: 10_000 });
      if (raw === null) return errorResult("Timed out waiting for PT to answer.");
      if (raw.startsWith("ERROR:")) return errorResult(`PT raised: ${raw}`);

      const parsed = parseSnapshot(raw);
      if (!parsed) return errorResult(`Unrecognized snapshot payload: ${raw}`);
      if (parsed.count === 0) return textResult("No user-placed devices in the active workspace.");

      const out = [`Devices in Packet Tracer (${parsed.count}):`, ""];
      for (const d of parsed.rows) {
        out.push(`- ${d.name}  model=${d.model}  class=${d.className}  pos=(${d.x},${d.y})`);
      }
      return textResult(out.join("\n"));
    },
  );
};
