# Connector Forward Tunnel

How `aimeat connect serve` talks to an AIMEAT node over **one persistent
WebSocket per agent** — carrying forward API calls *and* realtime task delivery —
instead of a storm of short-lived HTTPS requests, and how local clients (CrewAI
crews, MCP runtimes) attach to it over loopback.

## Why this exists

Before the forward tunnel, two independent "socket storms" hit the node:

1. **Connector polling** — `aimeat connect serve` polled `/v1/agents/<a>/tasks`
   and `/inbox` every ~30s, each request with `Connection: close` → a fresh
   TCP+TLS handshake every time.
2. **CrewAI daemon** — `run_crew_daemon` bypassed the connector with bare
   `requests.get/post` (no shared session, new TLS per call), and in concurrent
   mode spawned **one `aimeat connect serve` subprocess per worker**.

The forward tunnel collapses all of that into **one upstream WebSocket per
agent**, multiplexed and id-correlated, with realtime server→agent push so there
is **no polling in the steady state** and **no subprocess churn**.

## The two hops

```mermaid
flowchart LR
  subgraph local["Local machine (loopback 127.0.0.1)"]
    crew["CrewAI crew<br/>liaison (MCP) + daemon (REST)"]
    serve["aimeat connect serve --http<br/>(long-lived loopback daemon)"]
  end
  subgraph remote["AIMEAT node (e.g. aimeat.io)"]
    mgr["ConnectTunnelManager<br/>(/v1/connect/tunnel)"]
    api["Express app<br/>(real routes + auth + scopes)"]
    bus["event bus<br/>(task created/queued)"]
  end

  crew -- "HOP 1: loopback HTTP<br/>/v1/mcp, /v1/*, /local/tasks/next<br/>(keep-alive, ~free)" --> serve
  serve == "HOP 2: ONE persistent WebSocket per agent<br/>(multiplexed request/response + push)" ==> mgr
  mgr -- "forward dispatch (loopback self-fetch,<br/>pinned agent JWT)" --> api
  bus -- "task_assigned (target = agent GAII)" --> mgr
```

- **Hop 1 (local):** crews talk to `serve` over `127.0.0.1` — a local
  Streamable-HTTP MCP endpoint (`/v1/mcp`), a REST proxy (`/v1/*`), and a push
  long-poll (`/local/tasks/next`). Loopback keep-alive is effectively free.
- **Hop 2 (upstream):** `serve` holds **one** WebSocket per agent identity to the
  node and funnels everything through it.

## Components

```mermaid
flowchart TB
  subgraph node["AIMEAT node"]
    direction TB
    upgrade["index.ts WS upgrade<br/>verifies agent JWT, pins identity"]
    ctm["ConnectTunnelManager<br/>· socket registry by GAII<br/>· request→forward dispatch<br/>· deliver / ack / backlog<br/>· heartbeat monitor + stats"]
    eb["event-bus.ts<br/>emitDelivery(target, kind, payload)"]
    routes["agent-tasks.ts etc.<br/>(emit on task create/queue)"]
    upgrade --> ctm
    routes --> eb --> ctm
  end

  subgraph connector["aimeat connect serve --http"]
    direction TB
    tc["tunnel-client.ts<br/>· reconnect + heartbeat<br/>· forward() id-correlation<br/>· onDeliver/onBacklog + auto-ack<br/>· pre-expiry token refresh"]
    seam["AimeatClient transport seam<br/>(MCP tools → tunnel.forward)"]
    ls["local-server.ts<br/>· /v1/mcp (Streamable HTTP)<br/>· /v1/* REST proxy<br/>· /local/tasks/next long-poll<br/>· serve.json discovery"]
    seam --> tc
    ls --> tc
  end

  subgraph py["aimeat-crewai (Python)"]
    sp["serve_params() / ensure_serve()<br/>discover + auto-start serve"]
    api2["_Api shared requests.Session<br/>(X-Aimeat-Agent, loopback)"]
  end

  py -. "http_params(127.0.0.1:port)" .-> ls
  api2 -. "REST over loopback" .-> ls
  tc == "WebSocket /v1/connect/tunnel" ==> ctm
```

## Frame protocol

The tunnel is full-duplex JSON frames, id-correlated where applicable.

| type | dir | payload |
|------|-----|---------|
| `welcome` | S→C | protocol version, heartbeat interval, request timeout, `token_expires_at`, reconnect hints |
| `heartbeat` / `heartbeat_ack` | both | liveness |
| `request` | C→S | `{ id, method, path, query?, headers?, body? }` |
| `response` | S→C | `{ id, status, body }` (AIMEAT envelope) |
| `deliver` | S→C | `{ id, kind, payload }` — **full** task object, realtime |
| `ack` | C→S | `{ id }` — in-session dedup (does **not** suppress backlog) |
| `backlog` | S→C | on-connect snapshot `{ tasks, messages }` from storage |
| `disconnect` | both | graceful close |
| `error` | S→C | `{ code, message }` — malformed/forbidden frame |

## Forward API call (agent → server)

Every MCP tool call and every daemon REST call becomes a `request` frame on the
one socket; the server runs it through the **real** Express stack so auth and
scope enforcement hold by construction.

```mermaid
sequenceDiagram
  participant Crew as Crew (MCP/REST)
  participant Serve as serve (loopback)
  participant Tun as tunnel-client
  participant Node as ConnectTunnelManager
  participant App as Express app

  Crew->>Serve: GET /v1/memory (loopback)
  Serve->>Tun: forward("GET","/v1/memory")
  Tun->>Node: request{id, method, path}
  Node->>App: loopback self-fetch (pinned agent JWT)
  App-->>Node: 200 envelope (requireScope enforced)
  Node-->>Tun: response{id, status, body}
  Tun-->>Serve: {status, body}
  Serve-->>Crew: 200 envelope
```

Path safety: the server pins the resolved request origin to loopback, so a
protocol-relative path (`//evil/…`) can never make the node fetch an off-host
URL. Forwarded headers are allowlisted; `Authorization`/`Cookie`/`Host` are
stripped — the pinned JWT is the only credential.

## Realtime task delivery (server → agent, no polling)

When a task is created/queued for an agent, the node pushes the **full task**
down that agent's socket immediately; the crew picks it up via a loopback
long-poll that returns the instant it arrives.

```mermaid
sequenceDiagram
  participant Owner as Owner / API
  participant App as agent-tasks route
  participant Bus as event bus
  participant Node as ConnectTunnelManager
  participant Tun as tunnel-client
  participant Serve as serve cache
  participant Crew as Crew daemon

  Crew->>Serve: GET /local/tasks/next?wait=25000 (parks)
  Owner->>App: create task for agent X
  App->>Bus: emitDelivery(target=X, task_assigned, task)
  Bus->>Node: delivery event
  Node->>Tun: deliver{id, kind, payload=full task}
  Tun->>Serve: onDeliver → cache + wake
  Tun-->>Node: ack{id}
  Serve-->>Crew: 200 {task} (sub-second, push)
```

## Reconnect + backlog = no loss

If the socket is down when a task is queued, nothing is lost: the task stays in
storage and is replayed on reconnect via a `backlog` snapshot. The backlog is
always computed from storage truth (queued + active), so an `ack` never causes a
task to be skipped — even if the agent acked then crashed mid-work.

```mermaid
sequenceDiagram
  participant Node as ConnectTunnelManager
  participant Store as storage
  participant Tun as tunnel-client

  Note over Tun,Node: socket drops (network blip / restart)
  Tun->>Node: reconnect (fresh token from keychain)
  Node->>Tun: welcome
  Node->>Store: list queued + active tasks, pending messages
  Store-->>Node: outstanding items
  Node->>Tun: backlog{tasks, messages}
  Note over Tun: dedup by id; a task leaves backlog only<br/>when its STATUS changes (done/failed)
```

## Graceful degradation

The tunnel is **opt-in** on the node (`AIMEAT_CONNECT_TUNNEL_ENABLED`, off by
default). If a node has it disabled or is too old, `serve` falls back
transparently — direct HTTP transport + the legacy poll loop — so crews keep
working.

```mermaid
flowchart TD
  start["serve --http starts a tunnel per agent"] --> probe{"tunnel.start() outcome"}
  probe -- online --> tun["transport = tunnel<br/>forward over WS + push delivery<br/>(no upstream poll)"]
  probe -- "unsupported / unreachable" --> direct["transport = direct<br/>direct HTTP + legacy poll loop"]
  probe -- auth_failed --> stop["print 'Run: aimeat connect'<br/>start nothing (no hot-loop)"]
```

## CrewAI integration

`aimeat-crewai` (≥ 0.4.0) attaches to the daemon via `serve_params()`, which
discovers a running `serve` (or auto-starts one) and returns loopback
`http_params`. The daemon's REST helpers share one `requests.Session` against the
loopback proxy, and the idle wait parks on `/local/tasks/next` when the tunnel is
live. `stdio_params` / `http_params` remain for one-shot / CI use. See
`docs/integrations/crewai.md`.

## Discovery file & operations

- **Endpoint:** `GET /v1/connect/tunnel?token=<agentJWT>` (WS upgrade; agent JWT,
  preferred via `Authorization` header). Opt-in via
  `AIMEAT_CONNECT_TUNNEL_ENABLED=true`.
- **Discovery file:** `<AIMEAT_HOME or ~/.aimeat>/serve.json` —
  `{ schema_version, port, pid, agents:[{agent, owner, node_url, transport}],
  started_at }`. Written atomically on start, removed on clean exit,
  stale-detected by pid (a live pid refuses a second daemon).
- **Local endpoints (loopback only):** `/v1/mcp` (Streamable HTTP MCP, no auth —
  loopback is the trust boundary), `/v1/*` (REST proxy; agent via
  `X-Aimeat-Agent` header or `?agent=`), `/local/tasks/next` (long-poll),
  `/local/status`, `POST /local/shutdown`.

## Security model

- The WS upgrade authenticates the **agent JWT** once; forward `request`s run
  through the real `requireAuth`/`requireScope` middleware, so the tunnel grants
  no privilege the agent didn't already have.
- Forward dispatch is **loopback-origin-pinned** (no SSRF) with an HTTP-method
  allowlist and a header allowlist; the WS frame size is capped.
- The local `serve` surface binds **127.0.0.1 only**; the daemon holds the token,
  so local clients never handle credentials.
- The forward bearer is the pinned JWT (no server-side expiry close — ~90-day
  agent JWTs overflow a single timer); the client reconnects with a fresh token
  before `token_expires_at`.

## Source map

| Concern | File |
|---|---|
| Server tunnel manager | `aimeat/src/services/connect-tunnel.ts` |
| WS upgrade + auth | `aimeat/src/index.ts` |
| Agent-scoped push | `aimeat/src/services/event-bus.ts`, `aimeat/src/routes/agent-tasks.ts` |
| Node tunnel client | `aimeat/src/cli/connect/tunnel-client.ts` |
| Transport seam | `aimeat/src/cli/connect/api-client.ts` |
| Loopback daemon | `aimeat/src/cli/connect/mcp/local-server.ts` |
| Python integration | `python/aimeat-crewai/src/aimeat_crewai/mcp_client.py`, `daemon.py` |
| Design + phases | `docs/plans/2026-06-10-connector-forward-tunnel.md` |
