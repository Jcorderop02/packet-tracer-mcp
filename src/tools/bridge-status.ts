import { buildBootstrap } from "../bridge/bootstrap.js";
import { textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

export const registerBridgeStatusTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_bridge_status",
    "Report whether the packet-tracer-mcp bridge is currently being polled by Packet Tracer, and emit the bootstrap snippet that activates the polling loop inside PT's webview.",
    {},
    async () => {
      const s = bridge.status();
      const bootstrap = buildBootstrap(s.port);
      const lines = [
        `connected: ${s.connected}`,
        `port:      ${s.port}`,
        `queue:     ${s.queueLength}`,
        `lastSeen:  ${s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : "never"}`,
        "",
        "Bootstrap (paste into a PT webview editor and execute it once per session):",
        "",
        bootstrap,
      ];
      return textResult(lines.join("\n"));
    },
  );
};
