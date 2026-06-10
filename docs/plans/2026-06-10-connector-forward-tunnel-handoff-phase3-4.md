# Handoff prompt — Connector Forward Tunnel, Phase 3–4 (connector client + loopback serve)

> Paste everything below the line into a fresh Claude Code session running in
> this repo (`aimeat-protocol`), on branch `feat/connect-forward-tunnel` (Phases
> 0–2 are already merged there). Scope is **Phase 3–4 only** — the Node connector
> tunnel client and the local loopback `serve` daemon. Do **not** touch the
> Python `aimeat-crewai` package (Phase 5) or CI workflows (Phase 6).

---

You are implementing **Phases 3–4** of the Connector Forward Tunnel. The full
design is in `docs/plans/2026-06-10-connector-forward-tunnel.md` — **read it
first; it is the source of truth.** The server side (Phases 0–2) is **done,
audited, and on this branch**: a node exposes `GET /v1/connect/tunnel` (agent-JWT
at upgrade) that multiplexes id-correlated forward calls and pushes realtime
`deliver`/`backlog` frames. Your job is the **client** that holds that socket and
the **local loopback surface** crews talk to.

## Objective

Turn `aimeat connect serve` into a long-lived local daemon that (a) holds **one
persistent WS per agent** to the node, (b) routes every connector/MCP API call
over that socket instead of one-TLS-per-call, and (c) receives realtime task
delivery (push) instead of polling — then exposes all of that on `127.0.0.1` so a
crew attaches over loopback. No upstream polling in steady state.

## Hard scope boundary (do not cross)

- ✅ In scope: `src/cli/connect/**` (new `tunnel-client.ts`, the `AimeatClient`
  transport seam, a loopback `serve` daemon mode, `poller.ts` push migration),
  new unit + e2e tests, and `npm`-package version/CHANGELOG for the CLI.
- ❌ Out of scope (STOP — do not start): anything under `python/aimeat-crewai/**`
  (Phase 5 consumes your loopback surface), `.github/workflows/**` (Phase 6), and
  **any server-side change** under `src/routes/`, `src/services/connect-tunnel.ts`,
  `src/index.ts` — the server contract is frozen; build the client to it. If you
  believe the server needs a change, **stop and report** rather than editing it.

## Read before coding (in this order)

1. `CLAUDE.md` — mandatory rules. Especially Rule 1 (E2E on SQLite+MongoDB), Rule
   2 (file headers), Rule 6 (subagents opus), Rule 7 (lint). Note the "ESM `.js`
   imports", "no SSR" and Express-5 notes.
2. `docs/plans/2026-06-10-connector-forward-tunnel.md` — design + the Phase 3 / 4
   checklists. Tick boxes as you go.
3. **The server contract you are building against (read, don't change):**
   - `src/services/connect-tunnel.ts` — the wire protocol. The `ConnectFrame`
     type is the exact frame set: `welcome`, `heartbeat`/`heartbeat_ack`,
     `request{id,method,path,query?,headers?,body?}`, `response{id,status,body}`,
     `deliver{id,kind,payload}`, `ack{id}`, `backlog{tasks,messages}`,
     `disconnect`, `error{code,message}`. **The `welcome` payload advertises**
     `protocol_version`, `heartbeat_interval_ms`, `offline_threshold_ms`,
     `request_timeout_ms`, `token_expires_at` (epoch seconds), and a
     `reconnect_hint` (base_ms/max_ms/jitter) — your client MUST consume these.
   - `src/index.ts` upgrade block (~line 880) — how the server authenticates the
     socket: agent JWT via `Authorization: Bearer` (preferred) or `?token=`.
     Non-agent → 403, invalid → 401. The forward bearer is that same pinned JWT.
   - Server invariants you must respect: backlog is storage-truth (a task stays
     until its status changes); `ack` is in-session dedup only; the server does
     NOT auto-close at token expiry (your client must reconnect with a fresh
     token before `token_expires_at`).
4. **The connector you are extending:**
   - `src/cli/connect/api-client.ts` — `AimeatClient`: get/post/put/patch/delete
     do direct `fetch` with `Connection: close`. **This is the transport seam.**
   - `src/cli/connect/agent-registry.ts` — `buildRegistry()` constructs one
     `AimeatClient` per agent; tool handlers call `entry.client.get/post(...)`.
     Route the client through the tunnel here and every tool flows over it with
     zero per-tool edits.
   - `src/cli/connect/mcp/server.ts` — `runServe()`: today loads agents, builds
     the registry, registers MCP tools, starts `poller`s, connects a
     `StdioServerTransport`. You add the daemon mode here.
   - `src/cli/connect/mcp/poller.ts` — the upstream poll loop + wake adapter +
     task-runner hook you will replace with a push subscription.
   - `src/cli/connect/config.ts` (`AimeatPerAgentConfig`, `loadAllAgents`) and
     `src/cli/connect/keychain.ts` (`getToken(agent,owner)`, `listAllTokens`).
     **Token model:** RFC 8628 device-auth, long-lived (~90 day) tokens, **no
     refresh flow**. On auth failure the poller stops and tells the user to run
     `aimeat connect` — mirror that; do not invent a refresh protocol.
   - `src/services/personal-tunnel.ts` → the browser `aimeat-tunnel.js` client in
     `src/routes/lib-tunnel.ts` — a complete reconnect/heartbeat/correlation
     client to mirror in Node (`ws`).

## Phase 3 — Connector tunnel client (Node)

Build `src/cli/connect/tunnel-client.ts` — a `ws`-based client, one instance per
agent. Mirror the `aimeat-tunnel.js` patterns. It must:

- **Connect** to `<node_url>/v1/connect/tunnel` with `Authorization: Bearer
  <token>` (prefer the header; the server accepts it). Re-read the token from the
  keychain on **every (re)connect** so a user who re-ran `aimeat connect` is
  picked up.
- **Handshake:** parse `welcome`; adopt `heartbeat_interval_ms`, the
  `reconnect_hint`, and stash `token_expires_at`.
- **Heartbeat** at the advertised interval; detect a dead socket (no
  `heartbeat_ack` within ~3× interval) and force-reconnect. The server reaps at
  `offline_threshold_ms` (~90s) — never drift past it.
- **Forward API:** `forward(method, path, opts?) → Promise<{status, body}>` that
  sends a `request` frame with a fresh id and resolves on the correlated
  `response` (or rejects/relays a synthetic 504 on `request_timeout_ms`).
- **Reverse delivery:** on `deliver`, emit to an `onDeliver(kind, payload, id)`
  listener and send `ack{id}`. On `backlog`, emit `onBacklog({tasks, messages})`.
- **Reconnect:** exponential backoff + jitter from the hint. Proactively
  reconnect with a fresh token shortly **before** `token_expires_at`. On a `401`
  forward `response` or an upgrade `401/403`, surface the existing "Run: `aimeat
  connect`" guidance (mirror `poller.ts` `AUTH_ERROR_CODES`) and stop that
  agent's client — do not hot-loop.
- **Graceful close** (`disconnect` frame + socket close) on shutdown.

**Tests:** `test/unit/connect-tunnel-client.test.ts` against a mock `ws` server —
request/response correlation, request timeout, heartbeat + dead-socket reconnect,
`deliver`→`ack`, `backlog` emit, reconnect backoff, auth-failure→guidance (no
hot-loop). **Gate: `pnpm exec node --import tsx test/unit/connect-tunnel-client.test.ts`
green; `pnpm typecheck` + `pnpm lint` clean. Commit.**

## Phase 4 — Loopback `serve` daemon (Option A surface)

The crew talks to `serve` over loopback; `serve` funnels everything into the one
upstream WS. Preserve the existing **stdio** MCP behavior (CI/serverless spawn
serve directly) — the loopback surface is **additive**, gated behind a new mode
(e.g. `aimeat connect serve --http` / `--daemon`). Only the daemon mode writes
the discovery file and binds a port (so per-crew stdio spawns don't collide).

- **Transport seam** — `api-client.ts`: introduce a `Transport` the
  `AimeatClient` uses for get/post/etc. Default = today's direct `fetch` (keep
  `Connection: close` for one-shot CLI). Tunnel transport = `tunnelClient.forward`.
  In the daemon, `buildRegistry` wires each client to its agent's tunnel client.
  **Result: every MCP tool routes over the tunnel unchanged.**
- **Tunnel lifecycle** — `runServe` (daemon mode): start one `tunnel-client` per
  loaded agent. **Graceful degradation:** if the node has the tunnel disabled or
  is too old (upgrade `404`/`403`/connect failure), fall back to the existing
  direct-`fetch` transport **and** the existing `poller` loop, logging the
  downgrade. The tunnel is opt-in server-side (default off) — your integration
  tests must launch the node with `AIMEAT_CONNECT_TUNNEL_ENABLED=true`.
- **Local HTTP server** — Express bound to **`127.0.0.1:<ephemeral>`** only:
  - **Local MCP** at `/v1/mcp` via the `@modelcontextprotocol/sdk`
    Streamable-HTTP server transport (mirror how the node mounts its own
    `/v1/mcp` — find it server-side and reuse the same transport), so a crew can
    point `http_params(node_url=http://127.0.0.1:PORT)` at serve.
  - **REST proxy** — `app.all('/v1/*', …)` forwards method/path/query/body via
    `tunnelClient.forward` and relays status+body. Backed by the same tunnel.
  - **Push surface** — a loopback long-poll (`GET /local/tasks/next?wait=…`) and/
    or SSE fed by the tunnel's `deliver`/`backlog`, so a synchronous client gets
    realtime work without spinning. Keep a small in-memory cache seeded by
    `backlog` and updated by `deliver`.
- **Discovery file** — `~/.aimeat/serve.json`: `{ schema_version, port, pid,
  agents:[…], started_at }`. Write atomically on start, remove on clean exit,
  and **stale-detect by pid** (overwrite if the recorded pid is dead). Loopback
  bind is the trust boundary; note (don't necessarily build) the option of a
  local shared secret echoed by clients.
- **poller.ts → push** — in daemon+tunnel mode, the wake adapter + task-runner
  hook fire from `onDeliver`/`onBacklog` (dedup by task id), not from a poll
  diff. Keep the poll loop strictly as the degraded-mode fallback.

**Tests:** `test/e2e-connect-serve-loopback.ts` (register in `ALL_SUITES`) — the
runner starts the node; the suite uses a temp `AIMEAT_HOME`, creates an agent on
the test node + stores its token + writes a per-agent config pointing at the test
node, launches the serve daemon, reads the discovery file for the port, then
asserts:
- **Forward-proxy parity** — a REST call to the loopback proxy returns the same
  status + envelope as the equivalent direct node call.
- **Realtime delivery** — creating a task on the node surfaces via the loopback
  long-poll within a tight bound (push, not poll).
- **Discovery file** — present with correct port/pid; removed on clean shutdown.
- **Degraded fallback** — with `AIMEAT_CONNECT_TUNNEL_ENABLED=false` on the node,
  serve still works via direct transport + poll (no crash).

**Gate:** the suite passes on **SQLite and MongoDB**; `pnpm typecheck` + `pnpm
lint` clean. Bump the CLI version + CHANGELOG. Commit.

## Working rules

- Commit at each phase gate; end messages with the `Co-Authored-By: Claude …`
  trailer. **Evidence before assertions** — paste real test output for each gate;
  during iteration run only the affected suite(s), full cross-backend at the
  Phase 4 gate.
- File headers (Rule 2) on every new `.ts`; lint + `pnpm typecheck` clean before
  each commit. ESM `.js` import extensions. Loopback-only bind. Don't add
  `known_gaps.md` entries yourself (Rule 8) — surface gaps in the report.
- The server contract is frozen. If something seems to require a server change,
  **stop and document it** rather than editing `src/services/connect-tunnel.ts`,
  `src/index.ts`, or routes.
- If you run long, at minimum land **Phase 3** (tunnel-client + unit tests) as a
  committed, green milestone before starting Phase 4.

## When done (or blocked) — report back with

1. **What shipped:** files created/changed (paths), the `Transport` seam shape,
   the daemon-mode entry point + discovery-file format, and how push replaced
   polling (with the degraded-mode fallback).
2. **Test evidence:** actual runner output for the unit test and
   `connect-serve-loopback` on SQLite **and** MongoDB, plus `pnpm typecheck` +
   `pnpm lint`. State which invariants (forward-proxy parity, realtime delivery,
   discovery file, degraded fallback) map to which assertions.
3. **Reconnect/token handling:** how you used `token_expires_at`, and the
   auth-failure path (no hot-loop, surfaces re-auth guidance).
4. **Plan-doc state:** which Phase 3–4 boxes are ticked.
5. **Open issues / risks for Phase 5 (Python):** the exact loopback contract the
   crew will consume — the `/v1/mcp` URL shape, the REST proxy base, the
   long-poll/SSE endpoint + payload, and how to discover the port from
   `serve.json`. This is what Phase 5 builds against.
6. **Explicitly confirm** you did NOT touch Python, CI, or any server-side code.

Do not start Phase 5. Stop at the Phase 4 gate and report.
