# Examples

## `basic_crew.py` — one-shot test

A 3-agent crew (Researcher + Writer + AIMEAT Liaison) that runs ONCE: kicks off, completes Hello Integration, produces one summary, writes it to memory, exits. Use this to verify the connection works.

```bash
AIMEAT_AGENT_NAME=demo-crew python basic_crew.py
```

## `crew_daemon.py` — long-running daemon (recommended)

The same crew but as a daemon: starts up, opens the liaison's MCP connection, then **polls AIMEAT for new tasks indefinitely**. When a task arrives, builds the crew, runs it, lets the liaison report results back. Stays alive between tasks.

Use this when you want the crew to be a reachable target in the AIMEAT network — other agents can queue tasks for it via `aimeat_task_create` (AIMEAT 1.14.0+) and the daemon picks them up automatically.

```bash
AIMEAT_AGENT_NAME=demo-crew python crew_daemon.py
```

## `watchdog.sh` / `watchdog.ps1` — supervisor with crash-loop protection

Wrappers around `crew_daemon.py` that restart on crash, but give up after too many fast crashes in a row (default: 5 crashes in <30s each). Prevents runaway crash-loops if the daemon has a config error that fails instantly.

Linux / macOS:
```bash
./watchdog.sh
```

Windows / PowerShell:
```powershell
.\watchdog.ps1
```

For production, prefer systemd (Linux), launchd (macOS), or pm2 (cross-platform Node-driven supervisor) over these example wrappers. The wrappers are useful for local dev and as a reference for what supervisor semantics should look like.

## How to give the daemon a task

Once `crew_daemon.py` (or watchdog → crew_daemon.py) is running:

1. **Browser**: Profile → Agents → expand the crew → Tasks tab → "+ New Task" → write a prompt → Create
2. **Claude Desktop** (or any AIMEAT-connected agent): use the `aimeat_task_create` MCP tool
   ```
   aimeat_task_create
     target_agent: "demo-crew"
     title: "Research 2026 agent orchestration trends"
     description: "Find 3-5 trends with sources..."
   ```
3. **REST** (with an owner JWT): `POST /v1/agents/demo-crew/tasks` with the same JSON shape

The daemon picks up the queued task within `poll_interval_seconds` (default 30s).
