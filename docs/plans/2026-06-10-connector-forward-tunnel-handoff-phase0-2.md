# Handoff prompt — Connector Forward Tunnel, Phase 0–2 (server foundation)

> Paste everything below the line into a fresh Claude Code session running in
> this repo (`aimeat-protocol`). It is self-contained. Scope is **Phase 0–2
> only** — the server-side forward tunnel + realtime reverse delivery, fully
> E2E-tested. Do **not** touch the Node connector client, `aimeat connect serve`
> lifecycle, or the Python `aimeat-crewai` package — those are Phases 3–6 in a
> later session.

---

You are implementing **Phases 0–2** of the Connector Forward Tunnel. The full
design, protocol, phased checklist, and test strategy are in
`docs/plans/2026-06-10-connector-forward-tunnel.md` — **read it first; it is the
source of truth.** This prompt scopes and sequences the server-side foundation.

## Objective

Give an AIMEAT node a persistent WebSocket endpoint that a connector can hold
open and (a) send forward API calls over (agent→server, multiplexed, id-correlated)
and (b) receive realtime task/message deliveries over (server→agent push), so the
connector never has to poll. In this handoff you build and fully test the
**server side of that tunnel**. The connector and Python clients come later.

## Hard scope boundary (do not cross)

- ✅ In scope: a new server WS endpoint `GET /v1/connect/tunnel`, a
  `ConnectTunnelManager` service, in-process forward dispatch, agent-scoped
  realtime delivery (`deliver`/`ack`/`backlog`), config flag, OpenAPI, and E2E
  suites on both backends.
- ❌ Out of scope (STOP — do not start): `src/cli/connect/**` changes, a local
  loopback proxy, the discovery file, `poller.ts` rewrites, anything under
  `python/aimeat-crewai/**`, CI workflow edits. If you finish Phase 2 early,
  **stop and report** rather than starting Phase 3.

## Read before coding (in this order)

1. `CLAUDE.md` — mandatory rules. Especially: Rule 1 (E2E on SQLite+MongoDB,
   memory backend is deprecated), Rule 2 (file headers), Rule 3 (OpenAPI sync),
   Rule 6 (subagents use opus), Rule 7 (lint), Rule 8 (never add known_gaps
   yourself). Also the **Identity Model (GHII vs GAII)** and **response
   envelope** sections.
2. `docs/plans/2026-06-10-connector-forward-tunnel.md` — the design + checklist.
   Tick the Phase 0–2 boxes as you complete them; record the Phase 0 dispatch
   decision in its "Open implementation question" section.
3. Existing tunnel precedent to mirror (patterns, not direction):
   - `src/services/personal-tunnel.ts` — `TunnelManager`: WS registry, frame
     protocol, heartbeat monitor, request/response correlation, on-connect
     summary push. **Your manager mirrors these patterns** but is keyed by GAII,
     executes forward requests server-side, and is decoupled from personal
     nodes.
   - `src/services/personal-routing.ts` — how the server forwards a full payload
     down a WS and awaits a response (the reverse-delivery pattern for Phase 2).
   - `src/routes/sse.ts` + `src/services/event-bus.ts` — the change-event bus you
     will subscribe to for push.
4. Auth + wiring you must reuse:
   - `src/auth/middleware.ts` — `requireAuth/requireRole/requireScope` and the
     shape of `req.auth` (`sub`, `owner`, `roles`, `scopes`). Forward dispatch
     must produce that exact shape so existing scope enforcement applies.
   - `src/auth/jwt.ts` — the verify function to authenticate the agent JWT at WS
     upgrade (Express middleware can't run on the raw upgrade; verify manually,
     the same way `/v1/personal/tunnel` does).
   - `src/index.ts` — find the existing WS `upgrade` handling (realtime +
     personal tunnel are wired here) and add `/v1/connect/tunnel` alongside.
   - `src/middleware/envelope.ts` — `success()/error()` envelope helpers.
5. Test harness: `test/run-e2e-ci.ts` (the `ALL_SUITES` list + runner) and one
   existing suite (e.g. `test/e2e-agent-tasks.ts`) for the self-reporting
   format (`N passed, M failed`, `✅`/`❌` lines). Note: `e2e-personal-node.ts`
   only tests the anchor REST API — **no suite currently opens a live WS**, so
   you are building the first WS-driving test harness.

## Phase 0 — Dispatch spike (decide before building)

The one real risk is how the server executes a tunneled `request`. Spike both,
pick one, write the decision into the plan doc:

- **Option A — in-process `app.handle()`**: synthesize a minimal `req`/`res`,
  attach `req.auth` built from the WS-verified agent JWT, run it through the
  Express app so `requireAuth/requireScope` enforce normally. No socket. Risk:
  req/res mock fidelity (headers, body, `res.json`, `res.end`, stream).
- **Option B — loopback self-`fetch`**: the server calls its own
  `http://127.0.0.1:<port>` with the agent's bearer. Correct by construction
  (real stack) but needs a forwardable token and opens a localhost socket per
  call **on the server** — acceptable because that is NOT the public-internet
  TLS storm we are eliminating (that is the connector↔node hop), but less ideal.

Recommendation: prefer A for efficiency; fall back to B if mock fidelity proves
fragile. **Correctness and scope-enforcement parity win over micro-efficiency.**
Deliverable: a throwaway spike proving an authed `GET /v1/memory` returns the
envelope and a scope-violating call is rejected, + the recorded decision.

## Phase 1 — Forward tunnel (agent → server)

Build per the plan's "Phase 1" checklist. Concretely:

- `src/config.ts` — add `connectTunnelEnabled` (default off is fine for now, but
  E2E must enable it) + heartbeat/timeout settings; wire `loadConfig()` +
  `.env.example`.
- `src/services/connect-tunnel.ts` — `ConnectTunnelManager`: socket registry by
  GAII; `welcome` handshake (protocol version, heartbeat interval, reconnect
  hints — copy the shape from `TunnelManager`); `heartbeat`/`heartbeat_ack`
  monitor; `request`→forward-dispatch→`response` correlation by `id`; metrics
  (`getStats()` exposing active connection count — needed by the single-socket
  invariant test); clean teardown on close.
- `src/index.ts` — register the `/v1/connect/tunnel` upgrade; verify the agent
  JWT (roles include `agent`) from the `?token=` query at upgrade; reject
  non-agent / invalid tokens; pin the identity to the socket.
- Frame protocol — implement exactly the table in the plan doc (`welcome`,
  `heartbeat`/`heartbeat_ack`, `request`, `response`, `disconnect`; add
  `deliver`/`ack`/`backlog` in Phase 2). JSON frames, id-correlated.
- `openapi.yaml` — document the endpoint (Rule 3) + `pnpm generate:types`.
- `test/helpers/tunnel-harness.ts` — reusable WS test client: open the tunnel
  with an agent JWT, send `request` and await the correlated `response`, buffer
  `deliver`/`event`/`backlog` frames, force-drop + reconnect.
- `test/e2e-connect-tunnel.ts` — connect/handshake, forward GET+POST execute
  under the agent's scopes, scope violation rejected identically to a direct
  call (**scope-enforcement invariant**), forward result equals the direct HTTP
  result (**forward-proxy parity invariant**), exactly one active connection
  after N calls (**single-socket invariant**), malformed-frame rejection,
  heartbeat, reconnect. Register it in `ALL_SUITES`. Self-report pass/fail in
  the existing format.
- **Gate:** `pnpm exec node --env-file=.env.test.sqlite --import tsx
  test/run-e2e-ci.ts --test=connect-tunnel` passes; `pnpm typecheck` + `pnpm
  lint` clean. Commit.

## Phase 2 — Reverse delivery + realtime push (server → agent)

Build per the plan's "Phase 2" checklist:

- `src/services/event-bus.ts` — enrich change events with a target identity so
  push is agent-scoped (today events are coarse). Don't break existing SSE
  consumers.
- `ConnectTunnelManager` — when a task is created/queued for agent X, push
  `deliver{kind:'task_assigned', payload:<full task>}` to X's socket if
  connected; else leave it `queued` (durable). On connect, send a `backlog`
  snapshot of queued tasks + pending messages (mirror
  `TunnelManager.sendMailboxSummary()`), then live-push. Handle `ack{id}` to
  mark delivered and drop from the next backlog. Dedup by id.
- Hook the task create/queue path (find where tasks are created — see
  `src/routes/agent-tasks.ts` / the task service) to notify the manager.
- `test/e2e-connect-tunnel-delivery.ts` — connected agent receives
  `deliver{task_assigned}` on queue within a tight latency bound
  (**push-latency invariant**, e.g. <250ms); an agent offline at queue time
  receives it via `backlog` exactly once on reconnect (**no-loss invariant**);
  id-dedup holds; `ack` drops it from the next backlog. Register in `ALL_SUITES`.
- **Gate:** the delivery suite passes on **both** SQLite and MongoDB
  (`--test=connect-tunnel-delivery` under each `.env.test.*`); `pnpm typecheck`
  + `pnpm lint` clean. Commit.

## Working rules

- **Branch first** (not `main`). Commit at each phase gate with a clear message;
  end commit messages with the `Co-Authored-By: Claude ...` trailer per the
  repo convention.
- **Evidence before assertions** (Rule 1.5): never claim a gate passed without
  pasting the actual test output. During iteration run only the affected
  suite(s); the cross-backend sweep is the Phase 2 gate.
- **File headers** (Rule 2) on every new `.ts`. **OpenAPI** (Rule 3) updated for
  the new route. **Lint** (Rule 7) and `pnpm typecheck` clean before each commit.
- ESM imports use `.js` extensions. Express 5 `req.params.x` is `string |
  string[]` — cast. No SSR in routes. Don't add `known_gaps.md` entries
  yourself (Rule 8) — surface gaps in your report instead.
- If you hit a genuine ambiguity or a blocker (e.g. the spike shows both
  dispatch options are unworkable, or the event-bus change risks breaking SSE),
  **stop and document it** in the report rather than guessing.

## When done (or blocked) — report back with

1. **Dispatch decision** (Phase 0): which option, why, and the spike evidence.
2. **What shipped:** files created/changed (paths), the frame protocol as
   implemented, and any deviations from the plan (with reasons).
3. **Test evidence:** the actual runner output for
   `connect-tunnel` (SQLite) and `connect-tunnel-delivery` (SQLite **and**
   MongoDB), plus `pnpm typecheck` + `pnpm lint` results. State which invariants
   are covered by which assertions.
4. **Plan doc state:** which Phase 0–2 checkboxes are ticked.
5. **Open issues / risks** for the Phase 3+ session (connector client, serve
   lifecycle, Python) — anything you learned that should shape them.
6. **Explicitly confirm** you did NOT touch connector/serve/Python/CI code.

Do not start Phase 3. Stop at the Phase 2 gate and report.
