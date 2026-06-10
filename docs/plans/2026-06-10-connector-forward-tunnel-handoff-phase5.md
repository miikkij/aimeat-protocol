# Handoff prompt — Connector Forward Tunnel, Phase 5 (Python aimeat-crewai → loopback serve)

> Paste everything below the divider into a fresh Claude Code session running in
> this repo (`aimeat-protocol`), on branch `feat/connect-forward-tunnel` (Phases
> 0–4 are merged there). Scope is **Phase 5 only** — point the CrewAI integration
> at the local loopback `serve` daemon. **Edit only `python/aimeat-crewai/**`.**
> Do NOT touch the Node connector/server (frozen + verified) or CI (Phase 6), and
> **do NOT publish or tag the PyPI package** — version bump only.

---

You are implementing **Phase 5** of the Connector Forward Tunnel. Design + phased
checklist: `docs/plans/2026-06-10-connector-forward-tunnel.md`. The server
(Phases 0–2) and the Node connector + loopback `serve` daemon (Phases 3–4) are
**done, audited, and on this branch**. Your job: make the CrewAI integration talk
to the **local loopback serve** instead of spawning a connector subprocess per
worker and hitting the node directly with bare `requests`.

## Objective

Today the CrewAI integration has two wasteful paths (this is the whole reason for
the project):
1. **MCP** — `create_liaison_agent(stdio_params())` spawns `aimeat connect serve`
   as a stdio subprocess; concurrent mode spawns **one per EXECUTE worker**
   (subprocess churn).
2. **Daemon REST** — `run_crew_daemon` hits the node directly with bare
   `requests.get/post`, no shared `Session`, new TLS per call.

Phase 5 points BOTH at the long-lived loopback `serve` daemon: the liaison's MCP
goes to `http://127.0.0.1:<port>/v1/mcp`, the daemon's REST helpers go to the
same loopback base through a **shared `requests.Session`**, and per-worker
subprocess spawning is removed (loopback HTTP is naturally concurrent, so the
"shared stdio can't be parallel" constraint disappears). Result: one upstream WS,
loopback keep-alive that's effectively free, zero subprocess churn.

## Hard scope boundary (do not cross)

- ✅ In scope: `python/aimeat-crewai/**` (new `serve_params()`, daemon loopback
  rewiring, drop subprocess churn, pytest, version bump in `pyproject.toml` +
  `__init__.py` + CHANGELOG).
- ❌ Out of scope (STOP — do not start): any Node code (`aimeat/**` is frozen —
  the loopback contract below is the API you consume, never edit it), CI
  (`.github/workflows/**` — Phase 6), and **publishing**: the Python package is
  released by a git tag → PyPI workflow. Bump the version, but **do NOT create a
  tag, push a tag, or run any publish step** — that is a human release decision.
  If something seems to need a Node-side change, **stop and report**.

## Read before coding (in this order)

1. `python/aimeat-crewai/README.md` and `CLAUDE.md` (repo rules — note Rule 5
   dependency management if you add any package; prefer stdlib/`requests`).
2. `docs/plans/2026-06-10-connector-forward-tunnel.md` — Phase 5 checklist.
3. **The package you are changing:**
   - `python/aimeat-crewai/src/aimeat_crewai/mcp_client.py` — `stdio_params()`,
     `http_params(node_url, agent_token, mcp_path='/v1/mcp')`, `sse_params()`.
     You add `serve_params()` next to these. `http_params` is what you'll return.
   - `python/aimeat-crewai/src/aimeat_crewai/daemon.py` — `_read_token()` (reads
     `~/.aimeat/tokens/{agent}@{owner}.token` + `agents/{agent}/config.yaml`),
     the bare-`requests` helpers (`_poll_tasks`, `_poll_messages`,
     `_is_cancelled`, `_fetch_*`, `_mark_message_delivered`, `_fail_cancelled`),
     and `run_crew_daemon` / `_execute_worker` (the per-worker
     `create_liaison_agent(stdio_params())` subprocess spawn).
   - `python/aimeat-crewai/src/aimeat_crewai/liaison.py`, `__init__.py` (exports,
     `__version__`).

## The loopback contract you build against (frozen — from the Phase 3–4 daemon)

`aimeat connect serve --http` runs a long-lived loopback daemon and writes a
discovery file. Everything below is on `http://127.0.0.1:<port>`:

- **Discovery file** — `<AIMEAT_HOME or ~/.aimeat>/serve.json`:
  `{ schema_version: 1, port, pid, agents: [{agent, owner, node_url, transport}],
  started_at }`. Validate `pid` is alive; auto-start `aimeat connect serve --http`
  if the file is absent or its pid is dead, then wait for the file to appear.
- **MCP** — `http://127.0.0.1:<port>/v1/mcp` (Streamable HTTP, **no auth** —
  loopback is the trust boundary). Feed it to `http_params(node_url=...)`. The
  multi-agent selection is the usual MCP `agent_name` tool parameter; no header
  needed for MCP.
- **REST proxy** — any `/v1/...` path on the same base; responses are the node's
  own status + envelope. Agent selected by the `X-Aimeat-Agent: <name>` header
  (or `?agent=`), defaulting to the registry's primary.
- **Push** — `GET /local/tasks/next?wait=<ms ≤120000>[&agent=]` → `200 {ok,
  data:{agent, owner, via, received_at, task}}` or `204` on timeout. Each task is
  handed out **once per daemon lifetime** — pair with `GET /v1/agents/<a>/tasks`
  for re-sync.
- **Introspection** — `GET /local/status` (per-agent `transport` + `tunnel_status`),
  `POST /local/shutdown`.
- **Degraded-mode caveats:** if an agent's `transport` is `direct` (node has the
  tunnel off / too old), the long-poll **always 204s** — the crew must poll the
  REST proxy for tasks instead (check `transport` via `serve.json` or
  `/local/status`). Messages have **no live deliver** server-side — they surface
  via the wake adapter / backlog only, so read them through the REST proxy.

## Phase 5 — the work

### Core (Option A — do this first, get it working before any push enhancement)
- **`serve_params()`** in `mcp_client.py`: locate `serve.json` (honor
  `AIMEAT_HOME`, else `~/.aimeat`); if absent or its pid is dead, spawn
  `aimeat connect serve --http` (detached) and wait (bounded) for the file; read
  the port; return `http_params(node_url=f"http://127.0.0.1:{port}")`. The local
  MCP ignores auth, so pass the stored token if convenient or a placeholder —
  document that it's loopback-trusted. Keep `stdio_params`/`http_params`/`sse_params`
  unchanged and working (CI/serverless without serve still use them).
- **`daemon.py` loopback rewiring:** introduce a shared `requests.Session`. Point
  every REST helper's base at the loopback serve (from `serve_params`/the
  discovery file) instead of `node_url`, add the `X-Aimeat-Agent: <agent>` header
  (loopback needs no Bearer — the daemon holds the token). Keep the existing poll
  loop (now hitting loopback — cheap keep-alive).
- **Drop subprocess churn:** `_execute_worker` (and the concurrent path) must NOT
  spawn `aimeat connect serve` per worker. All workers share the one loopback
  serve via `serve_params()` → `http_params` (HTTP is concurrent, so the
  shared-stdio limitation is gone). The shared liaison + per-worker liaisons all
  target the same loopback MCP.

### Optional enhancement (only if core is solid + tested — do not over-build)
- True push: when an agent's `transport` is `tunnel`, consume
  `GET /local/tasks/next` (long-poll) for tasks instead of busy-polling; fall back
  to REST polling when `transport` is `direct`. Messages stay on the REST path.
  Gate this on transport detection so degraded mode never blocks on a long-poll
  that always 204s.

### Version
- Bump `pyproject.toml` version + `__init__.py` `__version__` + add a CHANGELOG
  entry. **No tag, no publish.**

## Tests (scoped — this is important)

Run ONLY the Python tests for this package. **Do NOT run the Node `pnpm test:e2e`
sweep** — the Node side is frozen and already verified on both backends; running
it here is wasted time. (Repo convention + an explicit standing preference: test
only the area the change affects.)

- `python/aimeat-crewai/tests/test_serve_loopback.py` (pytest): start a node with
  `AIMEAT_CONNECT_TUNNEL_ENABLED=true`, lay down a temp `AIMEAT_HOME` with an
  agent token + per-agent config pointing at that node, then:
  - `serve_params()` auto-starts the daemon and returns a loopback URL; the
    discovery file appears with a live pid.
  - A liaison MCP tool call succeeds over the loopback `/v1/mcp`.
  - A daemon REST helper (e.g. `_poll_tasks`) succeeds over the loopback proxy and
    returns the node's envelope.
  - **No per-task `aimeat connect serve` subprocess is spawned** (assert the
    worker path reuses the one loopback daemon — e.g. count child processes / that
    `_execute_worker` no longer calls `stdio_params`).
  - Clean shutdown via `POST /local/shutdown` (or terminate the daemon) leaves no
    orphan.
- **Gate:** the pytest suite passes; the example crew (`examples/`) wiring still
  imports/constructs. Commit.

## Working rules

- Get the **core** working and tested before the optional push enhancement.
- `requests` is already a dependency; avoid adding new packages (Rule 5). No
  publish/tag. Surface any gap in the report — do not add `known_gaps.md` entries.
- The Node loopback contract is frozen. If it seems to need a change, **stop and
  report** rather than editing `aimeat/**`.

## When done (or blocked) — report back with

1. **What shipped:** `serve_params()` behavior (discovery + auto-start), the
   daemon's shared-Session loopback wiring, and exactly how per-worker subprocess
   churn was removed.
2. **Test evidence:** the actual `pytest` output for `test_serve_loopback.py`,
   and confirmation you did NOT run the Node e2e sweep.
3. **Backward compat:** confirm `stdio_params`/`http_params`/`sse_params` still
   work for the no-serve path.
4. **Version:** the new version string; confirm **no tag/publish** was done.
5. **Plan-doc state:** which Phase 5 boxes are ticked.
6. **Open issues for Phase 6:** the CI Python job that should run these tests, the
   `--http` help-text gap in `src/index.ts`, and any docs needing the new
   `serve_params()` flow.
7. **Explicitly confirm** you touched only `python/aimeat-crewai/**` — no Node, no
   CI, no publish.

Do not start Phase 6. Stop at the Phase 5 gate and report.
