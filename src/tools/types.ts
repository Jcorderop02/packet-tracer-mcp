import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../bridge/http-bridge.js";

/**
 * Every tool module exports a `register` function that wires its handlers
 * into the shared MCP server. Keeping registration explicit makes it easy to
 * compose alternate servers (read-only, lab-only, etc.) by importing only
 * a subset.
 */
export interface ToolContext {
  readonly bridge: Bridge;
  readonly server: McpServer;
}

export type ToolModule = (ctx: ToolContext) => void;
