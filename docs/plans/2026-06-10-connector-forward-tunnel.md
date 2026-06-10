# Connector Forward Tunnel — `aimeat connect serve` as local proxy + single upstream WS

**Date:** 2026-06-10
**Status:** Proposed (awaiting go-ahead to implement)

## Problem

`aimeat connect serve` and the CrewAI integration talk to aimeat.io over many
short-lived HTTPS requests with no connection reuse — two independent socket
storms:

1. **Connector pollers** (`src/cli/connect/mcp/poller.ts`) — per-agent loops
   hitting `/v1/agents/<a>/tasks` + `/inbox` every 30s, each request sent with
   `Connection: close` (`src/cli/connect/api-client.ts`), so every poll is a
   fresh TCP+TLS handshake.
2. **CrewAI daemon** (`python/aimeat-crewai/.../daemon.py`) — bypasses the
   connector entirely with bare `requests.get/post` (no shared `Session`),
   polling tasks/inbox/integration-kit/cancel-markers ×N every 30s; and in
   concurrent mode **spawns one `aimeat connect serve` stdio subprocess per
   EXECUTE worker** (subprocess churn).

## Target architecture — two hops

```
CrewAI crew (Python)        aimeat connect serve            aimeat.io
- liaison (MCP tools)   HOP 1 (local daemon)        HOP 2  (server)
- daemon REST helpers  ──────▶ - local HTTP + MCP  ──────▶  ONE persistent
  shared Session       loopback - holds 1 upstream  multiplex  WS tunnel
                       127.0.0.1   WS per identity   request/   (forward +
                                 - push cache        response   push)
```

- **Hop 2 — connector forward tunnel (new, dedicated):** `serve` holds one
  persistent WS per agent identity to aimeat.io. Outbound calls are framed as
  `request` with an id and matched to a correlated `response`. Server→client
  `event` frames carry agent-scoped push (new task / message). Borrows the
  framing/heartbeat/reconnect patterns from the existing personal-node
  `TunnelManager`/`TunnelClient` but is a **separate endpoint**, decoupled from
  the personal-node anchor/slot/mailbox model.
- **Hop 1 — local proxy (Option A, HTTP loopback):** `serve` exposes the same
  surfaces on `127.0.0.1`: a local Streamable-HTTP MCP endpoint (so the liaison
  uses `http_params(node_url=http://127.0.0.1:PORT)` instead of a per-crew
  stdio subprocess) **and** REST proxy routes for the daemon. Loopback
  keep-alive via a shared `requests.Session` is effectively free. Everything
  funnels into the one upstream WS.

### Decisions (locked)

- Scope: full forward proxy now.
- Tunnel: new dedicated connector tunnel (not the personal-node tunnel).
- Local client surface: Option A (HTTP loopback), shared `requests.Session`.
- Serve lifecycle: long-lived local daemon; **ephemeral 127.0.0.1 port +
  `~/.aimeat/serve.json` discovery file** (port, pid, agents, started_at).
  Crews read it to attach; auto-start serve if absent; stale-detect by pid.
- Push: shipped **together** with the proxy — the upstream poll is gone day one
  (connector no longer runs upstream poll loops; push events drive the wake
  adapter / task-runner). The daemon may still poll *loopback* cheaply.

## Protocol (Hop 2)

Endpoint: `GET /v1/connect/tunnel?token=<agentJWT>` (WS upgrade). Auth: agent
JWT (roles include `agent`) validated at upgrade; identity pinned to the socket.

Frames (JSON, id-correlated where applicable):

| type | dir | payload |
|------|-----|---------|
| `welcome` | S→C | protocol version, heartbeat interval, reconnect hints |
| `heartbeat` / `heartbeat_ack` | both | liveness |
| `request` | C→S | `{ id, method, path, query?, headers?, body? }` |
| `response` | S→C | `{ id, status, body }` (AIMEAT envelope) |
| `deliver` | S→C | `{ id, kind: 'task_assigned'\|'message'\|…, payload }` — **full** object, realtime reverse delivery |
| `ack` | C→S | `{ id }` — agent acknowledges a `deliver` (lets server mark delivered, drop from backlog) |
| `backlog` | S→C | on-connect snapshot of queued tasks + pending messages (mirrors `sendMailboxSummary`) |
| `disconnect` | both | graceful close |

**Forward dispatch (server):** each `request` runs in-process against the
Express app with `req.auth` injected from the socket's pinned identity, so the
real `requireAuth/requireRole/requireScope` middleware enforces scopes — no new
escalation surface. Implementation choice: synthetic req/res through
`app.handle()` (preferred, no socket) vs. server-to-self loopback `fetch`
(simpler, one local socket per call on the server — not the public TLS storm).
Recommend in-process; loopback-self is the fallback if req/res mocking proves
fiddly. **Main implementation risk lives here.**

**Push fan-out (server):** `ConnectTunnelManager` subscribes to the event bus
(`src/services/event-bus.ts`) and emits `deliver` frames to the matching agent.
Requires enriching change events with a target identity so push is
agent-scoped (today they're coarse, e.g. `'personal'`).

### Bidirectional / realtime reverse delivery

The tunnel is full duplex — the same socket carries forward calls AND
server→agent delivery, so tasks reach agents in realtime instead of by polling.
Pattern copied from `personal-routing.ts` (forwards a full payload down the WS,
awaits the agent's response) and `TunnelManager.sendMailboxSummary()` (dumps the
queue on connect, then pushes live).

- **Full-payload delivery:** when a task is created/queued for agent X, the
  server pushes a `deliver{kind:'task_assigned', payload:<full task>}` down X's
  socket — zero round-trip, agent acts immediately.
- **Offline fallback (no loss):** if X's tunnel is down, the task stays
  `queued` in the store. On reconnect the server sends a `backlog` snapshot
  (queued tasks + pending messages) first, then live-pushes. Dedup by task id
  (connector already tracks seen ids).
- **Acks (phase 2):** the agent's `ack{id}` lets the server mark the task
  delivered and stop including it in the next `backlog`. Until acks land, the
  store remains the source of truth and backlog-on-connect covers gaps.
- **CrewAI caveat (synchronous pull tools):** the crew can't be interrupted
  mid-kickoff, so on the local hop push becomes either (a) loopback poll
  answered instantly from a `serve` cache populated by upstream `deliver`
  frames — no upstream traffic; or (b) a loopback long-poll/SSE on `serve` that
  blocks and returns the instant a `deliver` arrives — true realtime, no spin.
  Path (b) is the realtime story for the daemon; both are loopback-only.

## Work breakdown

### Server (aimeat/)
1. `src/services/connect-tunnel.ts` — `ConnectTunnelManager`: socket registry by
   GAII, frame handling, request/response correlation, in-process forward
   dispatch, push fan-out, heartbeat monitor, metrics.
2. `src/index.ts` — register the `/v1/connect/tunnel` WS upgrade (alongside the
   realtime + personal-tunnel upgrades already there).
3. `src/services/event-bus.ts` — enrich change events with target identity for
   agent-scoped push. Task create/queue → `deliver{task_assigned}` to the
   target socket if connected, else leave `queued` for backlog-on-connect.
4. `src/config.ts` — `connectTunnelEnabled` flag + heartbeat/timeout settings.
5. `openapi.yaml` — document the endpoint (Rule 3).
6. E2E suite — connect, forward GET/POST executes with correct scope
   enforcement, push event delivered on task queue, reconnect/heartbeat.

### Connector (aimeat/src/cli/connect/)
7. `tunnel-client.ts` — Node `ws` client: auto-reconnect (backoff+jitter),
   heartbeat, request/response correlation; `forward(method, path, body)` and an
   `onEvent` emitter. Unit tests.
8. Local server module — Express bound to `127.0.0.1:<ephemeral>`: local
   Streamable-HTTP `/v1/mcp` + REST proxy routes (both backed by
   `tunnelClient.forward`) + a **push cache** updated from `deliver` frames and
   a loopback long-poll/SSE endpoint so local clients get tasks in realtime
   without spinning. Writes/removes `~/.aimeat/serve.json`.
9. `api-client.ts` — introduce a transport seam so `AimeatClient` runs over
   `tunnelClient.forward` inside serve (real fetch stays for one-shot CLI).
10. `mcp/server.ts` + `poller.ts` — start one tunnel-client per agent; replace
    the upstream poll loop with a push subscription that drives the existing
    wake adapter + task-runner hook.

### Python (python/aimeat-crewai/)
11. `mcp_client.py` — `serve_params()`: read `~/.aimeat/serve.json` (auto-start
    serve if absent), return `http_params(node_url=http://127.0.0.1:PORT)`.
12. `daemon.py` — shared `requests.Session` against the local serve; drop the
    per-worker subprocess spawn (HTTP loopback is naturally concurrent, so the
    "shared stdio can't be parallel" constraint disappears).
13. Version bump + README/CHANGELOG.

### Docs
14. Connector guide + README transport section; note stdio stays for
    CI/serverless without serve.

## Phased implementation checklist

Each phase is independently testable and leaves the tree green. Ticking every
box in a phase is the gate to starting the next. Phases 1–2 are server-only;
3–4 connector; 5 Python; 6 verification.

### Phase 0 — Dispatch spike (de-risk before committing)
- [x] Spike in-process `app.handle()` with a synthetic `req`/`res` carrying an
      injected `req.auth`; confirm an authed `GET /v1/memory` returns the
      envelope and a scope-violating call is rejected by existing middleware.
- [x] Spike the loopback-self `fetch` fallback for comparison (latency, body
      streaming, header fidelity).
- [x] Decide the mechanism; record the choice + reasoning in this doc's "Open
      implementation question" section. → **Option B (loopback self-fetch)**.

### Phase 1 — Server forward tunnel (agent → server over WS)
- [x] `src/config.ts` — add `connectTunnelEnabled` flag + heartbeat/timeout
      settings; wire into `loadConfig()` and `.env.example`. (+ `config-schema.ts`)
- [x] `src/services/connect-tunnel.ts` — `ConnectTunnelManager`: socket registry
      keyed by GAII, `welcome` handshake, `heartbeat`/`heartbeat_ack` monitor,
      `request`/`response` correlation, forward dispatch (Option B loopback),
      metrics counters (`getStats()`).
- [x] `src/index.ts` — register the `/v1/connect/tunnel` WS upgrade + agent-JWT
      auth at upgrade; pin identity to the socket.
- [x] `openapi.yaml` — document the endpoint + stats route (Rule 3); types regen'd.
- [x] `test/helpers/tunnel-harness.ts` — reusable WS test client (the first
      live-WS-driving harness; reused by all later tunnel suites).
- [x] E2E suite `test/e2e-connect-tunnel.ts` — connect, forward GET + POST under
      scope, scope violation rejected, heartbeat + reconnect; asserts the
      **forward-proxy parity**, **single-socket**, and **scope-enforcement**
      invariants. Registered in `ALL_SUITES`. **Gate: 17/17 passes on SQLite.**

### Phase 2 — Reverse delivery + push (server → agent, realtime)
- [x] `src/services/event-bus.ts` — added a dedicated agent-scoped `delivery`
      channel carrying `{target, kind, id, payload}` (deviation from "enrich the
      change event" — a separate channel keeps full task payloads off the coarse
      SSE `change` broadcast while still achieving agent-scoped push).
- [x] `ConnectTunnelManager` — `deliver{task_assigned}` fan-out to the target
      socket; `backlog` snapshot on connect (queued+active tasks + pending
      messages, mirrors `sendMailboxSummary`); `ack` handling + dedup; offline →
      leave `queued` (durable store).
      **Post-review correction:** backlog now reflects **storage truth** — `ack`
      does NOT suppress backlog entries (it means "received the push", not
      "done"; suppressing would lose a task if the agent acked then crashed
      mid-work). `ack` is an in-session live-dedup marker only, cleared on
      disconnect (also bounds the map). A task leaves the backlog when its
      **status** changes (done/failed), not on ack — both behaviours are
      asserted in the delivery suite.
      **Security hardening (post-review):** forward dispatch pins the resolved
      origin to loopback (a protocol-relative path like `//evil/x` passed
      `startsWith('/')` → **SSRF** with the agent's bearer); HTTP-method
      allowlist; WS `maxPayload` cap (was the 100 MiB ws default → memory DoS);
      `welcome` advertises `token_expires_at` for proactive client reconnect.
- [x] Task create/queue path — `emitDelivery` on create when queued/auto-active;
      pushed live if the agent socket is connected, else durable-queue only.
- [x] E2E `test/e2e-connect-tunnel-delivery.ts` — connected agent receives
      `deliver{task_assigned}` on queue; offline agent receives it via `backlog`
      on reconnect; id-dedup holds; ack drops it from the next backlog; asserts
      the **push-latency** (<250ms) and **no-loss-on-disconnect** invariants.
      Registered in `ALL_SUITES`. **Gate: 8/8 on SQLite + MongoDB.**

### Phase 3 — Connector tunnel client (Node)
- [ ] `src/cli/connect/tunnel-client.ts` — `ws` client: auto-reconnect
      (backoff+jitter), heartbeat with dead-conn detection, `request`/`response`
      correlation, `forward(method, path, body)`, `onDeliver`/`onEvent` emitter.
- [ ] Unit tests `test/unit/connect-tunnel-client.test.ts` — correlation,
      reconnect, heartbeat-timeout, frame parsing. **Gate: unit green.**

### Phase 4 — Connector local serve daemon (loopback proxy)
- [ ] `api-client.ts` — transport seam so `AimeatClient` runs over
      `tunnelClient.forward` inside serve (real `fetch` stays for one-shot CLI).
- [ ] Local server module — Express on `127.0.0.1:<ephemeral>`: local
      Streamable-HTTP `/v1/mcp` + REST proxy routes (backed by `forward`).
- [ ] Push cache + loopback long-poll/SSE endpoint fed by `deliver` frames so
      local clients get tasks in realtime without spinning.
- [ ] `~/.aimeat/serve.json` discovery file — write on start, remove on clean
      exit, stale-detect by pid.
- [ ] `mcp/server.ts` + `poller.ts` — start one tunnel-client per agent; replace
      the upstream poll loop with a `deliver`/`event` subscription that drives
      the existing wake adapter + task-runner hook.
- [ ] E2E / manual — liaison tool call and a REST poll both flow over one
      upstream socket; queued task reaches a loopback long-poll in realtime.
      **Gate: no upstream poll in steady state.**

### Phase 5 — Python CrewAI integration (Option A)
- [ ] `mcp_client.py` — `serve_params()`: read `~/.aimeat/serve.json`
      (auto-start serve if absent), return
      `http_params(node_url=http://127.0.0.1:PORT)`.
- [ ] `daemon.py` — shared `requests.Session` against local serve for all
      helpers; drop the per-worker `aimeat connect serve` subprocess spawn
      (loopback HTTP is concurrent — the shared-stdio constraint disappears).
- [ ] Optional: daemon consumes serve's loopback long-poll/SSE instead of its
      own poll loop (true push-driven crew).
- [ ] Version bump + README/CHANGELOG. **Gate: example crew runs end-to-end via
      serve with zero subprocess churn.**

### Phase 6 — Docs + full verification + CI gating
- [ ] Connector guide + README transport section; note stdio stays for
      CI/serverless without serve.
- [ ] Python pytest `test_serve_loopback.py` (loopback proxy works, no per-task
      subprocess churn).
- [ ] CI: tunnel suites run on every PR on both backends; add a Python job for
      `python/aimeat-crewai/tests/` (extend `.github/workflows/`).
- [ ] `pnpm test:e2e:sqlite` + `pnpm test:e2e:mongodb` full sweep, 0 failures.
- [ ] `pnpm lint` + `pnpm typecheck` clean.

## E2E test automation & CI (verifiable under heavy churn)

This area will move fast, so every phase ships automated coverage that runs on
**both persistent backends** in CI. Tests are the contract; a phase is not done
until its suites are registered and green.

### Harness conventions (match the existing runner)
- E2E suites are standalone `test/e2e-*.ts` files registered in `ALL_SUITES`
  (`test/run-e2e-ci.ts`). The runner auto-starts the server, cleans the DB and
  restarts the server **between suites** for isolation, and self-reports
  `N passed / M failed`. New suites must follow that self-reporting format.
- They run via the existing entry points — no new test framework:
  `pnpm test:e2e:sqlite` / `pnpm test:e2e:mongodb`, or a single suite with
  `--test=connect-tunnel` (see Rule 1).
- **Gap to fill:** no current suite opens a live WS (`e2e-personal-node.ts` only
  exercises the anchor REST API). Phase 1 introduces the first WS-driving
  harness; it’s reused by every later phase and can backfill personal-node WS
  coverage later.

### New test artifacts
- `test/helpers/tunnel-harness.ts` — reusable WS client for tests: open
  `/v1/connect/tunnel` with an agent JWT, send `request` frames and await the
  correlated `response`, collect `deliver`/`event`/`backlog` frames into an
  inspectable buffer, force-drop/reconnect. Every tunnel suite builds on this.
- `test/e2e-connect-tunnel.ts` — Phase 1: connect/handshake, forward GET+POST,
  scope enforcement, malformed-frame rejection, heartbeat, reconnect.
- `test/e2e-connect-tunnel-delivery.ts` — Phase 2: reverse `deliver` on queue,
  `backlog` on reconnect, id-dedup, `ack` drops from next backlog,
  offline→durable-queue→delivered-on-reconnect.
- `test/unit/connect-tunnel-client.test.ts` — connector client against a mock WS
  server: correlation, reconnect backoff, heartbeat-timeout, frame parsing.
- `python/aimeat-crewai/tests/test_serve_loopback.py` — pytest: start a node +
  `serve`, point `serve_params()` at the discovery file, assert a liaison tool
  call and a daemon REST helper both succeed over loopback and that **no
  per-task connector subprocess** is spawned.

### Cross-cutting invariants (the regression guards that matter most)
Encoded as explicit assertions so drift fails CI rather than silently degrading:
1. **Forward-proxy parity** — for a representative route matrix, a call over the
   tunnel returns the **same status + envelope** as the equivalent direct HTTP
   call. This is the single strongest guard against the proxy diverging from the
   real API as routes change (mirrors the existing
   `test/unit/connector-cli-parity.test.ts` philosophy). New tunneled surfaces
   add a parity case — campsite rule.
2. **Single-socket invariant** — after N forwarded calls,
   `ConnectTunnelManager.getStats()` reports exactly **one** active connection
   per agent and zero per-call sockets. Directly asserts the bandwidth goal.
3. **Scope enforcement** — a forwarded request outside the agent’s scopes is
   rejected identically to the direct call (no escalation via the tunnel).
4. **Push latency** — a queued task produces a `deliver` frame within a tight
   bound (e.g. < 250 ms), asserting realtime rather than incidental polling.
5. **No-loss on disconnect** — task queued while the socket is down arrives via
   `backlog` exactly once on reconnect.

### CI wiring
- [ ] Register the new suites in `ALL_SUITES`; they run inside the existing
      `test:e2e:sqlite` + `test:e2e:mongodb` jobs automatically.
- [ ] CI gate runs the tunnel suites on **every PR** on both backends; failure
      blocks merge.
- [ ] Add a Python job (extend `.github/workflows/`) running
      `python/aimeat-crewai/tests/` so the loopback/no-churn contract is gated
      too — not just published on release.
- [ ] Keep each tunnel suite < ~30s so the fast SQLite loop stays usable for
      iteration.

## Compatibility & security

- **stdio transport preserved** for CI/serverless without serve; serve-HTTP is
  the preferred local path, auto-detected via the discovery file.
- Local server binds **loopback only**; optional local shared secret.
- Tunnel authenticates the agent JWT once; forward dispatch runs through the
  real auth middleware, so scope enforcement is unchanged.
- One upstream WS per agent identity (N agents = N sockets total, not N×polls).

## Open implementation question

- Forward dispatch mechanism: in-process `app.handle()` (preferred) vs.
  loopback-self `fetch` (fallback). Decide during step 1 of the build order.

### DECISION (2026-06-10, Phase 0 spike) — Option B, loopback self-`fetch`

A throwaway spike (`test/spike-dispatch.ts`, since removed) booted a real
server, created a `memory:read`-only agent, and exercised **both** mechanisms:

| Mechanism | `GET /v1/memory` | Scope-violating `POST /v1/memory` |
|-----------|------------------|-----------------------------------|
| **B — loopback self-`fetch`** (agent bearer) | `200`, `protocol:aimeat` envelope | `403 SCOPE_DENIED` |
| **A — `app.handle()`** (hand-rolled req/res mock, injected `req.auth`) | `200`, `protocol:aimeat` envelope | (not run) |

Both returned the envelope for a simple GET. **Chosen: Option B.** Rationale:
A's mock *worked only for a trivial GET* — a faithful req/res mock for POST
bodies, header negotiation, streaming, and error paths would need ongoing
hardening, and any Express/route change risks silent divergence from the real
stack. That divergence is precisely what the **forward-proxy-parity** invariant
exists to prevent, so a mechanism that can drift from the real pipeline
undermines the guarantee. Option B runs every forward `request` through the
**real** Express stack (same `requireAuth`/`requireScope`/envelope), so parity
and scope-enforcement hold *by construction* with zero mock maintenance. The
only cost — one `127.0.0.1` socket per forwarded call **on the server** — is
explicitly acceptable: it is not the public-internet TLS storm being eliminated
(that is the connector↔node hop). The agent's WS-upgrade JWT is reused verbatim
as the forward `Authorization: Bearer`, so no new forwardable token is minted.
