import { readProjectMetadataJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface ProjectMetadata {
  description: string;
  version: string;
  filename: string;
}

function parseMetadata(raw: string): ProjectMetadata {
  const out: ProjectMetadata = { description: "", version: "", filename: "" };
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("|");
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (key === "description") out.description = value;
    else if (key === "version") out.version = value;
    else if (key === "filename") out.filename = value;
  }
  return out;
}

export const registerReadProjectMetadataTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_read_project_metadata",
    "Read NetworkFile metadata of the .pkt currently open in PT: description, file version, and the on-disk filename if it has been saved.",
    {},
    async () => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(readProjectMetadataJs(), { timeoutMs: 8_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);

      const meta = parseMetadata(reply);
      const lines = [
        "Project metadata:",
        `  filename:    ${meta.filename || "(unsaved)"}`,
        `  version:     ${meta.version || "(unknown)"}`,
        `  description: ${meta.description || "(empty)"}`,
      ];
      return textResult(lines.join("\n"));
    },
  );
};
