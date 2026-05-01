/**
 * Centralised runtime configuration. Reads from env vars, falls back to
 * sensible defaults that match what PT 9.0 expects.
 *
 * MCP clients connect to PACKETTRACER_MCP_HOST:PACKETTRACER_MCP_PORT/mcp.
 * Packet Tracer's webview polls PACKETTRACER_BRIDGE_PORT.
 */

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

const envStr = (name: string, fallback: string): string => process.env[name] ?? fallback;

export interface RuntimeConfig {
  readonly mcpHost: string;
  readonly mcpPort: number;
  readonly bridgePort: number;
}

export function loadConfig(): RuntimeConfig {
  return {
    mcpHost:    envStr("PACKETTRACER_MCP_HOST", "127.0.0.1"),
    mcpPort:    envInt("PACKETTRACER_MCP_PORT", 39001),
    bridgePort: envInt("PACKETTRACER_BRIDGE_PORT", 54321),
  };
}
