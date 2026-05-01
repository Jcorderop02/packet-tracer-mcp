import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Bridge } from "../bridge/http-bridge.js";

export function requireConnectedBridge(bridge: Bridge): CallToolResult | null {
  const status = bridge.status();
  if (status.connected) return null;
  return {
    content: [{
      type: "text",
      text:
        `Bridge not seeing PT (port ${status.port}). ` +
        `Paste the bootstrap (see pt_bridge_status) into a webview-capable PT extension and try again.`,
    }],
    isError: true,
  };
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
