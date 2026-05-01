#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { loadConfig } from "./config.js";
import { startServer, startStdioServer, type RunningServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  // Bun-only: we use `Bun.serve` and JSON import attributes that Node won't
  // parse the same way. Fail loud and early instead of crashing later with a
  // cryptic ReferenceError deep inside the bridge.
  if (typeof Bun === "undefined") {
    process.stderr.write(
      "[packet-tracer-mcp] error: este servidor requiere Bun (>=1.2). " +
      "Instálalo desde https://bun.sh y ejecuta: bun run src/index.ts\n",
    );
    process.exit(1);
  }

  const cfg = loadConfig();
  const useStdio = args.includes("--stdio");

  // All log output MUST go to stderr. In stdio mode the stdout stream is the
  // JSON-RPC protocol channel — a single stray byte there breaks the client.
  // We keep the same convention in HTTP mode for consistency.
  const log = (msg: string) => process.stderr.write(`${msg}\n`);

  const running = useStdio
    ? await startStdioServer({ bridgePort: cfg.bridgePort })
    : await startServer(cfg);

  if (useStdio) {
    // Stdio: minimal output. The MCP client spawning us as a subprocess
    // logs stderr to a debug pane — keep it quiet unless something's wrong.
    log(`[packet-tracer-mcp] stdio listo · bridge en :${cfg.bridgePort}`);
  } else {
    // HTTP: someone is running this interactively. Print a friendly banner.
    printBanner(cfg.mcpHost, cfg.mcpPort, cfg.bridgePort);
  }

  // Surface bridge connection transitions so the user knows whether the
  // bootstrap snippet is actually running inside PT. Without this they'd see
  // the banner and then complete silence even if the extension never connects.
  const bridgeWatcher = watchBridgeConnection(running, log);

  // Don't let an unhandled rejection or uncaught exception kill the process
  // silently — log it loudly. We keep the process alive: a single failed tool
  // call shouldn't take down the whole server.
  process.on("unhandledRejection", (reason) => {
    log(`[packet-tracer-mcp] promesa no capturada: ${formatError(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    log(`[packet-tracer-mcp] excepción no capturada: ${formatError(err)}`);
  });

  const shutdown = async (signal: string) => {
    log(`\n[packet-tracer-mcp] ${signal} recibido, cerrando…`);
    clearInterval(bridgeWatcher);
    await running.stop();
    process.exit(0);
  };
  process.on("SIGINT",  () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Polls the bridge status every 2s and logs only the edges:
 *   disconnected → connected  ("Extensión PT conectada")
 *   connected    → disconnected ("Extensión PT desconectada")
 * Polling itself stays silent — the PT webview hits /next every 500ms and
 * we don't want to spam stderr with one line per poll.
 */
function watchBridgeConnection(running: RunningServer, log: (msg: string) => void): NodeJS.Timeout {
  let wasConnected = false;
  const timer = setInterval(() => {
    const connected = running.bridge.status().connected;
    if (connected && !wasConnected) {
      log("[packet-tracer-mcp] Extensión PT conectada");
    } else if (!connected && wasConnected) {
      log("[packet-tracer-mcp] Extensión PT desconectada");
    }
    wasConnected = connected;
  }, 2_000);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

function printHelp(): void {
  const text = [
    `packet-tracer-mcp v${pkg.version}`,
    "Servidor MCP para Cisco Packet Tracer 9.",
    "",
    "Uso:",
    "  bun run src/index.ts            Arranca en modo HTTP (Streamable HTTP)",
    "  bun run src/index.ts --stdio    Arranca en modo stdio (Claude Desktop, etc.)",
    "",
    "Opciones:",
    "  --stdio          Habla JSON-RPC por stdin/stdout en lugar de HTTP",
    "  -v, --version    Imprime la versión y sale",
    "  -h, --help       Muestra esta ayuda",
    "",
    "Variables de entorno:",
    "  MCP_HOST         Host del transporte HTTP (default: 127.0.0.1)",
    "  MCP_PORT         Puerto MCP HTTP (default: 39001)",
    "  BRIDGE_PORT      Puerto del bridge interno hacia PT (default: 54321)",
    "",
    `Documentación: ${pkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? ""}`,
    "",
  ].join("\n");
  process.stdout.write(text);
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}

function printBanner(host: string, port: number, bridgePort: number): void {
  const author = (pkg.author ?? "").replace(/<[^>]*>/, "").trim();
  const repo = pkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? "";
  const lines = [
    "",
    "  ╔══════════════════════════════════════════════════════════════════╗",
    `  ║  packet-tracer-mcp  v${pkg.version.padEnd(44)}║`,
    "  ║  Servidor MCP para Cisco Packet Tracer 9                         ║",
    "  ╠══════════════════════════════════════════════════════════════════╣",
    `  ║  Autor      ${author.padEnd(53)}║`,
    `  ║  GitHub     ${repo.padEnd(53)}║`,
    `  ║  Licencia   ${pkg.license.padEnd(53)}║`,
    "  ╚══════════════════════════════════════════════════════════════════╝",
    "",
    `  MCP      http://${host}:${port}/mcp`,
    `  Bridge   http://127.0.0.1:${bridgePort}   (esperando polling de la extensión de PT)`,
    "",
    "  Pulsa Ctrl+C para parar.",
    "",
  ];
  for (const line of lines) process.stderr.write(line + "\n");
}

main().catch((err) => {
  process.stderr.write(`[packet-tracer-mcp] error fatal: ${formatError(err)}\n`);
  process.exit(1);
});
