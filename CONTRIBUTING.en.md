# Contributing to packet-tracer-mcp

Thanks for taking an interest in the project. It is an experiment built
in spare time, with no stable release yet, so issue reports and
contributions are very welcome.

> Languages: [español](./CONTRIBUTING.md) · this document (English)

---

## Before you open anything

- Read [`README.en.md`](./README.en.md) end to end. The Status section
  makes it clear what counts as "verified against real PT 9" and what
  is marked `partial` or `dead-end`.
- Skim [`docs/COVERAGE.md`](./docs/COVERAGE.md). If a piece is marked
  `dead-end`, that means PT 9's public JS API does not support it —
  re-enabling it usually requires Cisco, not this repo.
- Confirm the bug reproduces against **Cisco Packet Tracer 9.0.0.0810**
  exactly. Newer versions or differently-signed builds can change the
  native IPC API without warning.

## Reporting a bug

Open an issue with:

1. Exact PT version (`Help > About` inside PT).
2. OS + Bun version (`bun --version`).
3. The MCP command that triggered the issue, including its parameters.
4. Bridge output: if `pt_bridge_status` reports `connected: true` and
   it still fails, attach that. If the extension window is yellow or
   red, say so.
5. What you expected vs. what happened. A canvas screenshot beats a
   paragraph describing what looks wrong.

## Proposing a feature

Before writing code, open an issue describing the use case. The project
follows a *canvas-first* philosophy (no plan in memory, everything is
validated against the live canvas) and breaking that by accident is
easy. Talking it through first saves rewrites.

---

## Local setup

```bash
git clone https://github.com/jcorderop02/packet-tracer-mcp.git
cd packet-tracer-mcp
bun install
bun test                 # 348 tests, no PT required
bun run start            # starts the MCP server on :39001
```

For end-to-end tests against a real PT:

1. Open Packet Tracer 9 and install `extension/dist/mcp-bridge.pts`
   (instructions in [`docs/BOOTSTRAP.md`](./docs/BOOTSTRAP.md)).
2. Mark the extension active and open the
   `Extensions > MCP Bridge` window.
3. Run `bun run start` in a terminal.
4. Verify with `pt_bridge_status` that the indicator is green.
5. Run the (private) smoke suite or drive your recipe by hand from an
   MCP client.

---

## Conventions

### Project layout

- `src/tools/` — one file per MCP tool. Each tool exports its Zod
  schema, JS builder and decoder. `src/tools/index.ts` aggregates them
  in `ALL_TOOLS`.
- `src/recipes/` — high-level orchestration. Recipes read a canvas
  snapshot, decide what is missing and emit IPC operations.
- `src/canvas/` — snapshot, inspection, diff, subnetting arithmetic.
  This is the source of truth for "what's in PT right now".
- `src/ipc/` — pure string-in/string-out JS generators for PT's Script
  Engine. No side effects.
- `src/bridge/` — local HTTP bridge polled by the PT webview.

### Style

- Strict TypeScript. No `any` except at IPC boundaries, and even there
  it is commented.
- No decorative comments. If a line needs a comment, it is because PT
  9's API does something non-obvious — write the *why*, not the
  *what*.
- Pure functions whenever possible. Tools and recipes are functions
  that take a `BridgeClient` and return a `Result`.

### Tests

- If you add a tool, drop its tests in `tests/tools/` before touching
  `src/tools/index.ts`. The suite is `bun test` and must not require
  PT to be running.
- If your change can only be verified against real PT, open the PR
  anyway but mark the matching piece in `docs/COVERAGE.md` as
  `contract-verified` (not `verified-pt9`) until you have a smoke run
  to back it up.
- Don't lower test coverage. The current suite is 348 tests; PRs that
  remove tests without replacing them with better ones will be
  rejected.

### Commits

- Imperative present tense, in English (matching the repo history):
  `add pt_apply_voip recipe`, not `added` or `adds`.
- One commit = one coherent change. If your PR mixes refactor +
  feature, split it.

### Pull requests

- The PR describes **what changes and why**. The *what* is in the
  diff; the *why* is not.
- If you add a tool, update:
  - `src/tools/index.ts` (registry)
  - `README.md` § Capacidades and `README.en.md` § Capabilities
    (count + group)
  - `docs/ARCHITECTURE.md` § Tools MCP
  - `docs/COVERAGE.md` (state and evidence)
- If you break a tool's compatibility, call it out *explicitly* in the
  PR. v0.1.0 is experimental, but silent breakage is not.

---

## What is NOT going to land (at least for now)

- Support for PT < 9. The native IPC layer changed at the root;
  maintaining two paths is not worth it.
- Fallbacks that hide errors. If an operation fails, it must fail
  visibly.
- Wrappers around third-party libraries to talk to PT. The only thing
  between the server and PT is the project's own HTTP bridge plus the
  native Script Engine.
- Telemetry, analytics, any kind of phone-home. The server runs
  locally and stays local.

---

## License

By contributing, you agree to publish your code under the project's
[MIT license](./LICENSE).

## Code of conduct

Interactions in issues, PRs and discussions are subject to the
[Code of Conduct](./CODE_OF_CONDUCT.md). Read it before participating.
