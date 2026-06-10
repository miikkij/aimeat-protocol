# Upgrade prompt — move a CrewAI crew to the loopback serve daemon (aimeat-crewai ≥ 0.4.0)

> Copy everything below the divider into your AI coding assistant (or follow it
> by hand) to migrate an existing CrewAI + AIMEAT project onto the new
> `serve_params()` loopback transport. It is safe and incremental — `stdio_params`
> still works, so you can roll back by reverting one line.

---

You are upgrading a CrewAI project that integrates with AIMEAT via the
`aimeat-crewai` package. Move it from the per-crew **stdio subprocess** transport
to the new **loopback serve daemon** (`aimeat-crewai >= 0.4.0`). Goal: one
persistent WebSocket per agent to the node, realtime task delivery instead of
polling, and zero per-worker subprocess churn — without changing the crew's
domain logic.

## What changed in 0.4.0 (context)

- New `serve_params(agent_name=...)` attaches the crew to a long-lived
  `aimeat connect serve --http` **loopback daemon** on `127.0.0.1` (auto-started
  if not already running). The daemon holds ONE persistent WS per agent to the
  node and multiplexes every MCP tool call + daemon REST call over it.
- `run_crew_daemon` now rides one shared `requests.Session` against the loopback
  proxy, drops the per-worker `aimeat connect serve` subprocess, and parks on a
  push long-poll when the tunnel is live (no busy-polling).
- `stdio_params()` / `http_params()` / `sse_params()` are unchanged — keep using
  them for one-shot runs or environments without the daemon.

## Steps

1. **Bump the dependency** to `aimeat-crewai>=0.4.0` (in `requirements.txt` /
   `pyproject.toml` / `pip install -U aimeat-crewai`). Confirm
   `python -c "import aimeat_crewai; print(aimeat_crewai.__version__)"` is ≥ 0.4.0.

2. **Swap the transport** at every `create_liaison_agent` / `liaison_tools` /
   `run_crew_daemon` call site. Change `stdio_params(...)` → `serve_params(...)`,
   keeping the same `agent_name`:

   ```python
   # before
   from aimeat_crewai import create_liaison_agent, stdio_params
   with create_liaison_agent(mcp_server_params=stdio_params(agent_name="marketing-crew"), llm=llm) as liaison:
       ...

   # after
   from aimeat_crewai import create_liaison_agent, serve_params
   with create_liaison_agent(mcp_server_params=serve_params(agent_name="marketing-crew"), llm=llm) as liaison:
       ...
   ```

   For a **repo checkout** (no global `aimeat` CLI on PATH), tell `serve_params`
   how to launch the daemon:

   ```python
   serve_params(
       agent_name="marketing-crew",
       aimeat_command=["node", "--import", "tsx", "src/index.ts"],
       spawn_cwd="aimeat",
   )
   ```

3. **`run_crew_daemon`** needs no code change beyond the import swap — it picks up
   the loopback daemon automatically. If you pass custom serve options, forward
   them via its `serve_options` passthrough.

4. **Prerequisite for the realtime path:** the AIMEAT node must have the tunnel
   enabled (`AIMEAT_CONNECT_TUNNEL_ENABLED=true`). If it is off or the node is
   older, `serve_params` still works — it transparently degrades to direct HTTP +
   polling (no crash), you just don't get push delivery. Check the active mode via
   `GET http://127.0.0.1:<port>/local/status` or the `transport` field in
   `<AIMEAT_HOME>/serve.json`.

5. **Verify** end to end:
   - Run the crew once; confirm the liaison's AIMEAT tool calls succeed.
   - Confirm a `serve.json` appears under `~/.aimeat/` (or `$AIMEAT_HOME`) with a
     live `pid` and `transport: "tunnel"`.
   - For a daemon crew, queue a task on the node and confirm it is picked up in
     ~1s (push) rather than after a full poll interval.
   - Confirm no `aimeat connect serve` subprocess is spawned per worker (one
     shared daemon process instead).

## Guardrails

- Do not change the crew's domain agents/tasks or the liaison persona — only the
  transport.
- Keep a `stdio_params` fallback path if you run in CI/serverless without the
  daemon; `serve_params` is for long-lived local crews / many calls.
- Don't hardcode the loopback port — always discover it via `serve_params` /
  `serve.json`.

Reference: `docs/integrations/crewai.md` ("Transports") and
`docs/connector-forward-tunnel.md` (architecture + diagrams).
