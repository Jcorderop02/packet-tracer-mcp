type BunServer = ReturnType<typeof Bun.serve>;

/**
 * Endpoints exposed on the bridge port.
 *   GET  /next     -> dequeue next JS command for the webview to run
 *   GET  /ping     -> "pong"
 *   GET  /status   -> { connected, port, queue, hasResult }
 *   GET  /result   -> long-poll for the next result hex-encoded by PT
 *   POST /result   -> webview reports a result (hex-encoded text)
 *   POST /queue    -> server-side enqueue helper (not used by PT directly)
 *
 * Wire encoding for /result: hex string of UTF-16 char codes. The Script
 * Engine has neither `window` nor `XMLHttpRequest`, so the snippet built by
 * `wrapForResult` hex-encodes the payload server-side and hands it to the
 * extension's `__mcpPostResult` helper, which injects the XHR into the
 * webview via the captured `mcpBridgeWindow` reference.
 */

export interface BridgeStatus {
  readonly connected: boolean;
  readonly port: number;
  readonly queueLength: number;
  readonly hasPendingResult: boolean;
  readonly lastSeenAt: number | null;
}

export interface SendAndWaitOptions {
  readonly timeoutMs?: number;
  /**
   * Human-readable description of what this command does (es. "Creando router R1").
   * The bridge emits it as a leading block comment in the wire payload so the
   * extension UI can show a friendly line in its log instead of the raw JS.
   * Generators may also embed their own leading block comment and it is preserved.
   */
  readonly label?: string;
}

/**
 * CORS wildcard so PT 9 webviews (served from `pt-sm://` custom scheme) can
 * hit the bridge via XHR without a same-origin error. Chromium requires the
 * explicit header even for non-http origins; without it the fetch fails with
 * `status=0 readyState=4` before the server ever sees the request.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, *",
  "Access-Control-Max-Age": "86400",
} as const;

const HEADERS_TEXT = { "Content-Type": "text/plain", ...CORS_HEADERS } as const;
const HEADERS_JSON = { "Content-Type": "application/json", ...CORS_HEADERS } as const;

export class Bridge {
  private readonly queue: string[] = [];
  private readonly resultWaiters: Array<(value: string | null) => void> = [];
  private bunServer: BunServer | null = null;
  private lastSeenAt: number | null = null;

  constructor(public readonly port: number = 54321) {}

  start(): void {
    if (this.bunServer) return;
    this.bunServer = Bun.serve({
      port: this.port,
      fetch: (req) => this.handle(req),
    });
  }

  stop(): void {
    this.bunServer?.stop(true);
    this.bunServer = null;
    this.flushWaiters(null);
  }

  status(): BridgeStatus {
    const since = this.lastSeenAt;
    const connected = since !== null && Date.now() - since < 5_000;
    return {
      connected,
      port: this.port,
      queueLength: this.queue.length,
      hasPendingResult: this.resultWaiters.length > 0,
      lastSeenAt: since,
    };
  }

  enqueue(jsCommand: string): void {
    this.queue.push(jsCommand);
  }

  /**
   * Wait for the next result posted by PT (from any source: a sendAndWait
   * reply, an event callback that calls `__mcpPostResult`, etc.). Resolves
   * with the decoded text or `null` on timeout.
   */
  waitForNext(timeoutMs: number): Promise<string | null> {
    return this.waitForResult(timeoutMs);
  }

  /**
   * Wrap a JS expression so its return value is hex-encoded and POSTed back
   * to `/result` through the extension's `__mcpPostResult` helper. Resolves
   * with the decoded text or `null` on timeout. Errors thrown inside PT come
   * back as `"ERROR:<message>"`.
   */
  async sendAndWait(jsExpression: string, opts: SendAndWaitOptions = {}): Promise<string | null> {
    const wrapped = wrapForResult(jsExpression, this.port, opts.label);
    this.enqueue(wrapped);
    return this.waitForResult(opts.timeoutMs ?? 10_000);
  }

  private waitForResult(timeoutMs: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let done = false;
      const settle = (value: string | null) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      this.resultWaiters.push(settle);
      setTimeout(() => {
        const idx = this.resultWaiters.indexOf(settle);
        if (idx >= 0) this.resultWaiters.splice(idx, 1);
        settle(null);
      }, timeoutMs);
    });
  }

  private deliverResult(text: string): void {
    const next = this.resultWaiters.shift();
    if (next) next(text);
  }

  private flushWaiters(value: string | null): void {
    while (this.resultWaiters.length > 0) {
      const w = this.resultWaiters.shift();
      w?.(value);
    }
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    this.lastSeenAt = Date.now();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (method === "GET" && url.pathname === "/ping") {
      return new Response("pong", { headers: HEADERS_TEXT });
    }
    if (method === "GET" && url.pathname === "/status") {
      return new Response(JSON.stringify(this.status()), { headers: HEADERS_JSON });
    }
    if (method === "GET" && url.pathname === "/next") {
      const cmd = this.queue.shift() ?? "";
      return new Response(cmd, { headers: HEADERS_TEXT });
    }
    if (method === "POST" && url.pathname === "/queue") {
      const body = await req.text();
      this.enqueue(body);
      return new Response("queued", { headers: HEADERS_TEXT });
    }
    if (method === "POST" && url.pathname === "/result") {
      const hexBody = await req.text();
      this.deliverResult(hexFromBridgeToText(hexBody));
      return new Response("ok", { headers: HEADERS_TEXT });
    }
    if (method === "GET" && url.pathname === "/result") {
      const timeoutMs = Number(url.searchParams.get("timeout_ms") ?? 9_000);
      const text = await this.waitForResult(timeoutMs);
      if (text === null) return new Response("", { status: 204, headers: HEADERS_TEXT });
      return new Response(text, { headers: HEADERS_TEXT });
    }

    return new Response("not found", { status: 404, headers: HEADERS_JSON });
  }
}

function hexFromBridgeToText(hex: string): string {
  const cleaned = hex.replace(/[^0-9a-f]/gi, "");
  let out = "";
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    out += String.fromCharCode(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Builds the Script Engine snippet that computes `jsExpression` via the
 * extension-side `__mcpEval` helper. The actual try/catch + hex-encode + post
 * lives there, so the wire payload is just `__mcpEval("...",54321);` per
 * call — the ~250-char inline wrapper is gone.
 *
 * If the caller (or the generator) prepends a leading block comment to the
 * expression — or passes `explicitLabel` — we strip it from the inner code
 * (so it doesn't pollute the JSON literal handed to `__mcpEval`) and re-emit
 * it *outside* the eval call. The Script Engine ignores the leading comment;
 * the extension UI parses it and shows a friendly line in its log.
 */
const LABEL_RE = /^\s*\/\*\s*([^*][^]*?)\s*\*\/\s*/;

function wrapForResult(jsExpression: string, port: number, explicitLabel?: string): string {
  const match = jsExpression.match(LABEL_RE);
  const embeddedLabel = match?.[1] ? match[1].replace(/\s+/g, " ").trim() : null;
  const code = match ? jsExpression.slice(match[0].length) : jsExpression;
  const label = explicitLabel?.trim() || embeddedLabel || null;
  const prefix = label ? `/* ${label} */ ` : "";
  return `${prefix}__mcpEval(${JSON.stringify(code)},${port});`;
}
