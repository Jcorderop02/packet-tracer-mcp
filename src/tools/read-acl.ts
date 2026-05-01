import { z } from "zod";
import { readAclsJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

const InputSchema = {
  device: z.string().min(1).describe("Router (or any device exposing AclProcess)."),
};

export const registerReadAclTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_read_acl",
    "Read the live ACLs of a router via AclProcess: per-ACL canonical commands as PT would render them in 'show running-config | section access-list'.",
    InputSchema,
    async ({ device }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(readAclsJs(device), { timeoutMs: 10_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
      if (reply === "ERR:no_acl_process") {
        return errorResult(`Device '${device}' does not expose an AclProcess.`);
      }
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);

      const lines = reply.split("\n");
      const total = Number.parseInt(lines[0] ?? "0", 10);
      const body = lines.slice(1).join("\n");
      return textResult(`ACLs on '${device}': ${total}\n${body || "(none configured)"}`);
    },
  );
};
