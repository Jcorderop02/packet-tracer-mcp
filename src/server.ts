import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Bridge } from "./bridge/http-bridge.js";
import { registerResources } from "./resources/index.js";
import { ALL_TOOLS, type ToolModule } from "./tools/index.js";

export interface ServerOptions {
  readonly mcpHost: string;
  readonly mcpPort: number;
  readonly bridgePort: number;
  readonly tools?: readonly ToolModule[];
}

export interface StdioServerOptions {
  readonly bridgePort: number;
  readonly tools?: readonly ToolModule[];
}

export interface RunningServer {
  readonly bridge: Bridge;
  stop(): Promise<void>;
}

const SERVER_INSTRUCTIONS = [
  "packet-tracer-mcp drives Cisco Packet Tracer 9.0 via its native IPC tree.",
  "All write operations require the bootstrap snippet (see pt_bridge_status)",
  "to be executing inside a PT webview.",
  "",
  "## READ FIRST (resources, not tools)",
  "",
  "Before designing any topology, fetch these resources via resources/read:",
  "  - pt://docs/agents              full operational playbook (AGENTS.md)",
  "  - pt://convention/wiring        cabling rules (straight / serial / cross)",
  "  - pt://convention/topology-patterns   user-LAN vs transit-LAN patterns",
  "If your client doesn't auto-fetch resources, call them yourself once per",
  "session. They're short and replace 80% of the LLM mistakes on this server.",
  "",
  "## MANDATORY pre-flight for ≥3 routers or any user-supplied diagram",
  "",
  "Call pt_plan_review FIRST. Declare every device, every link (with cable",
  "and purpose) and every LAN role (user vs transit). The tool returns",
  "errors and warnings BEFORE anything is written to the canvas. Show the",
  "report verbatim to the user, get explicit confirmation, only then start",
  "calling pt_add_device.",
  "",
  "## Hard safety rails enforced by the server (don't fight them)",
  "",
  "  - pt_create_link REFUSES straight/cross Ethernet between two routers",
  "    unless you pass confirm_internal_lan: true. Reason: WAN exterior P2P",
  "    is almost always serial in academic briefs. The error message lists",
  "    the two valid paths.",
  "  - ISR routers (1941/2901/2911/ISR4321/ISR4331) ship with NO serial",
  "    ports. Before pt_create_link cable=\"serial\", call pt_add_module",
  "    HWIC-2T on each router; the link will fail otherwise.",
  "",
  "## Recommended workflow",
  "",
  "  1. pt_bridge_status + pt_query_topology  (see what's live)",
  "  2. pt_plan_review                         (declare plan, show user)",
  "  3. pt_add_device × N                      (no x/y — let grid place)",
  "  4. pt_add_module HWIC-2T × M              (where serial is needed)",
  "  5. pt_create_link × K                     (per cabling conventions)",
  "  6. pt_auto_layout                         (re-grid topology-aware)",
  "  7. pt_run_cli_bulk / apply_* tools        (configuration)",
  "  8. pt_save_pkt                            (persist)",
  "",
  "## When the brief is ambiguous: ASK. Don't guess.",
  "A topology built on the wrong assumption wastes more time than the question.",
].join("\n");

const MCP_SESSION_HEADER = "mcp-session-id";

/**
 * Idle-session sweep interval. Sessions whose client never sent a DELETE and
 * whose SSE never errored back will leak otherwise. We GC after 30 minutes of
 * inactivity, which is well past any reasonable tool-call sequence.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_SWEEP_MS = 5 * 60 * 1000;

interface SessionRecord {
  readonly transport: StreamableHTTPServerTransport;
  readonly mcpServer: McpServer;
  lastSeenAt: number;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const bridge = new Bridge(opts.bridgePort);
  bridge.start();

  const tools = opts.tools ?? ALL_TOOLS;
  const sessions = new Map<string, SessionRecord>();

  // Single shared event store for resumability. When a client's SSE drops
  // mid-tool-call, it can reconnect with `Last-Event-ID` and the SDK replays
  // the messages it missed instead of leaving the call orphaned.
  const eventStore = new InMemoryEventStore();

  const buildSession = async (): Promise<SessionRecord> => {
    const mcpServer = new McpServer({
      name: "packet-tracer-mcp",
      version: "0.1.0",
    }, {
      instructions: SERVER_INSTRUCTIONS,
    });
    for (const register of tools) {
      register({ bridge, server: mcpServer });
    }
    registerResources(mcpServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      eventStore,
      // Suggest a 1s reconnect to the client when SSE drops. Keeps the gap
      // short enough that a sequence of tool calls survives a network blip.
      retryInterval: 1_000,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, mcpServer, lastSeenAt: Date.now() });
      },
      onsessionclosed: (id) => {
        const rec = sessions.get(id);
        sessions.delete(id);
        rec?.mcpServer.close().catch(() => {});
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) {
        const rec = sessions.get(id);
        sessions.delete(id);
        rec?.mcpServer.close().catch(() => {});
      }
    };

    await mcpServer.connect(transport);
    const record: SessionRecord = { transport, mcpServer, lastSeenAt: Date.now() };
    return record;
  };

  // Idle GC: sessions that haven't been touched in SESSION_IDLE_MS get torn
  // down. The SDK doesn't expose its own keep-alive, so we check the
  // record's `lastSeenAt` (refreshed on every request).
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, rec] of sessions) {
      if (now - rec.lastSeenAt > SESSION_IDLE_MS) {
        sessions.delete(id);
        rec.transport.close().catch(() => {});
        rec.mcpServer.close().catch(() => {});
      }
    }
  }, SESSION_SWEEP_MS);
  // Don't keep the event loop alive just for the sweep.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  const httpServer: HttpServer = createServer((req, res) => {
    handleHttp(req, res, sessions, buildSession).catch((err) => {
      writeJsonError(res, 500, "internal_error", err instanceof Error ? err.message : String(err));
    });
  });

  await listen(httpServer, opts.mcpPort, opts.mcpHost);

  return {
    bridge,
    async stop() {
      clearInterval(sweepTimer);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      bridge.stop();
      for (const rec of sessions.values()) {
        await rec.transport.close().catch(() => {});
        await rec.mcpServer.close().catch(() => {});
      }
      sessions.clear();
    },
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SessionRecord>,
  buildSession: () => Promise<SessionRecord>,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/mcp") {
    // Claude Code / Cursor MCP SDKs probe well-known OAuth paths on connect
    // (`/.well-known/oauth-protected-resource`, etc.). When they receive a
    // non-JSON body they choke with `Invalid OAuth error response: SyntaxError`
    // and the whole session aborts. Returning a JSON 404 keeps the probe
    // graceful: the SDK reads it as "no OAuth metadata" and falls through to
    // the standard transport on `/mcp`.
    return writeJsonError(res, 404, "not_found", "endpoint not found");
  }

  const body = req.method === "POST" ? await readJson(req) : undefined;
  const sessionIdHeader = readHeader(req, MCP_SESSION_HEADER);

  // Fast path: existing session — refresh its lastSeenAt and route through
  // the same transport so the SDK can resume any in-flight stream.
  if (sessionIdHeader && sessions.has(sessionIdHeader)) {
    const rec = sessions.get(sessionIdHeader)!;
    rec.lastSeenAt = Date.now();
    await rec.transport.handleRequest(req, res, body);
    return;
  }

  // Stale or missing session ID on a non-init request: tell the client
  // explicitly so its SDK can reinitialize instead of looping on 404.
  if (sessionIdHeader && !sessions.has(sessionIdHeader)) {
    return writeJsonError(
      res,
      404,
      "session_not_found",
      "Session expired or unknown. Reinitialize by sending an `initialize` request without `mcp-session-id`.",
    );
  }

  // No session ID. The only legal case is an `initialize` request, which
  // creates a fresh session. Anything else is a client bug — surface it as
  // 400 so the SDK doesn't silently retry forever.
  if (req.method === "POST" && isInitializeRequest(body)) {
    const rec = await buildSession();
    rec.lastSeenAt = Date.now();
    await rec.transport.handleRequest(req, res, body);
    return;
  }

  return writeJsonError(
    res,
    400,
    "bad_request",
    "Missing `mcp-session-id` header. Start with an `initialize` request.",
  );
}

function readHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function writeJsonError(res: ServerResponse, status: number, code: string, message: string): void {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
  }
  res.end(JSON.stringify({ error: code, error_description: message }));
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

/**
 * Stdio variant. Single-session, single-client: an MCP host like Claude
 * Desktop spawns the binary as a subprocess and talks JSON-RPC over the
 * child's stdin/stdout. The bridge HTTP server still listens internally so
 * the PT 9 webview can poll it — only the MCP transport changes.
 *
 * Critical: nothing in this code path may write to stdout. The stream is
 * the protocol channel. All logs go to stderr (see src/index.ts).
 */
export async function startStdioServer(opts: StdioServerOptions): Promise<RunningServer> {
  const bridge = new Bridge(opts.bridgePort);
  bridge.start();

  const tools = opts.tools ?? ALL_TOOLS;
  const mcpServer = new McpServer({
    name: "packet-tracer-mcp",
    version: "0.1.0",
  }, {
    instructions: SERVER_INSTRUCTIONS,
  });
  for (const register of tools) {
    register({ bridge, server: mcpServer });
  }
  registerResources(mcpServer);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  return {
    bridge,
    async stop() {
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
      bridge.stop();
    },
  };
}
