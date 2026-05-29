# Implementation: CrewAI task-runner + multi-agent `aimeat connect serve`

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will implement this in the AIMEAT codebase.
**Repository:** This is the AIMEAT repo. You are already in it.
**No time/effort estimates:** Do not include "this is a 1-week project", "easy/hard", "MVP in N days" etc. anywhere. The user finds those noise.

---

## Context — what AIMEAT is (no prior conversation knowledge required)

**AIMEAT** is an open protocol + reference implementation for AI agent infrastructure. It gives agents persistent identity (GAII), shared memory, capabilities catalogue, knowledge packages, task lifecycle, work queue with escrow, federation between nodes, and a marketplace. v1.10.0 just shipped (2026-05-28) which added the `aimeat connect` CLI and 13-step Hello Integration.

Public docs (read these first):
- Repo overview: [README.md](../../README.md)
- Project conventions: [CLAUDE.md](../../CLAUDE.md) — MANDATORY READ before coding
- Architecture & storage: [docs/coding-guidelines/architecture.md](../coding-guidelines/architecture.md), [docs/coding-guidelines/storage-sync.md](../coding-guidelines/storage-sync.md)
- Identity model (GHII vs GAII): in CLAUDE.md, "Identity Model" section
- Hello Integration / onboarding: [docs/coding-guidelines/getting-started.md](../coding-guidelines/getting-started.md), `aimeat/src/routes/agent-onboarding.ts`
- Public website with live node: https://aimeat.io
- llms.txt for AI agents: https://aimeat.io/llms.txt

**Code paths you will touch (relative to repo root):**
- `aimeat/src/cli/connect/` — the entire Connect CLI
- `aimeat/src/cli/connect/auth.ts` — `aimeat connect` command (device auth, token storage, skill bundle download)
- `aimeat/src/cli/connect/config.ts` — config.yaml load/save + paths to `~/.aimeat/`
- `aimeat/src/cli/connect/keychain.ts` — token storage (file per agent at `~/.aimeat/tokens/{agent}@{owner}.token`)
- `aimeat/src/cli/connect/api-client.ts` — HTTP client (one token per instance currently)
- `aimeat/src/cli/connect/mcp/server.ts` — MCP server entry, loads ONE client from config
- `aimeat/src/cli/connect/mcp/tools/*.ts` — MCP tool registrations (each takes a single AimeatClient + agent name)
- `aimeat/src/cli/connect/mcp/poller.ts` — background poller for ONE agent
- `aimeat/src/cli/connect/mcp/wakeup.ts` — wake-up command/webhook adapter (already documented as security-sensitive)
- `aimeat/src/cli/connect/tool-call.ts` — `aimeat connect call <tool>` shell fallback

---

## What you are building (the picture)

A solo developer runs a CrewAI crew on their laptop. The crew has 5 specialized agents (researcher, analyst, writer, editor, reviewer). The user attaches Claude Desktop to AIMEAT via MCP (one-click config — that's a separate task; assume it's done).

The user says to Claude Desktop:

> "Create a Q3 marketing plan for our new mobile game, including competitor analysis. Assign it to my Marketing Crew."

Claude Desktop creates an AIMEAT task for the agent `marketing-crew`. The task arrives in `aimeat connect serve`'s polling inbox. Because `marketing-crew` is configured as a **task runner** (mode = `task-runner` with a `runner.command` set), the serve process launches a subprocess:

```bash
TASK_PROMPT="Create a Q3 marketing plan ..." \
AIMEAT_TASK_ID="abc123" \
AIMEAT_AGENT_NAME="marketing-crew" \
AIMEAT_TOKEN="..." \
uv run python -m my_crew
```

The Python script (the user's CrewAI script) runs the crew, produces a deliverable as JSON, prints it to stdout. The serve process captures it and posts `aimeat_task_complete` with the deliverable as the summary. Optionally during the run, the crew script calls back to AIMEAT through `aimeat connect call <tool>` to fetch knowledge packages or save intermediate artifacts to memory/storage.

**What the user sees in Claude Desktop:**
- "Marketing Crew started working on task #abc123"
- (~10-30 minutes later) "Marketing Crew completed task #abc123 — here is the deliverable: ..."
- They never see the CrewAI internal agent chatter. The crew is a black box that produces a result.

**What you must NOT do:**
- Do NOT instrument every CrewAI internal step. The internal CrewAI agent dialog is noise; do not surface it to AIMEAT.
- Do NOT write a Python wrapper package (`aimeat-py`, `aimeat-crewai`) for the MVP. The CLI fallback (`aimeat connect call`) is enough for the crew script to interact with AIMEAT.
- Do NOT require the user to install AIMEAT into their CrewAI Python project as a dependency. Subprocess invocation only.

---

## Specific implementation tasks

### Task 1: Multi-agent token loading in `aimeat connect serve`

Currently `aimeat connect serve` loads a single agent via `AimeatClient.fromConfig()`. Needs to support N agents.

**Changes to `keychain.ts`:** Add `listAllTokens()` that returns `Array<{ agent, owner, token }>` by reading every file in `~/.aimeat/tokens/`. File naming is `{agent}@{owner}.token` so it parses cleanly.

**Changes to `config.ts`:**
- Keep the existing single `~/.aimeat/config.yaml` for global settings (default node URL, etc.)
- Add per-agent config at `~/.aimeat/agents/{agent}/config.yaml` for per-agent settings (mode, task runner config, etc.)
- New `loadAllAgents()` returns `Array<{ agent, owner, token, perAgentConfig }>`

**Changes to `mcp/server.ts`:**
- Replace the single `AimeatClient.fromConfig()` call with `loadAllAgents()`, building a `Map<agentName, AimeatClient>`
- Pass this map to all tool registration functions instead of a single client
- Log on startup: `Loaded N agents: name1, name2, ...`

**Changes to tool registrations (`mcp/tools/*.ts` + `tool-call.ts`):**
- Every MCP tool now accepts an `agent_name` parameter
- If only 1 agent is loaded → parameter is optional, defaults to that one
- If 2+ are loaded → parameter is required; if missing, return MCP error with list of available agent names
- Internal: look up the right `AimeatClient` from the map by `agent_name`, use it for the API call

**Changes to `mcp/poller.ts`:**
- Poll inbox for EVERY loaded agent in parallel (or staggered)
- Each agent's task arrivals trigger that agent's wake-up adapter (existing wake config still applies)
- Logs include `[agent:name]` prefix so multiple agents' polling output is distinguishable

**New CLI commands:**
- `aimeat connect add` (alias `aimeat connect`) — existing connect flow, but adds to existing pool instead of replacing the single agent. Walks user through device auth for an additional agent. Saves token to `~/.aimeat/tokens/{agent}@{owner}.token` and per-agent config to `~/.aimeat/agents/{agent}/config.yaml`.
- `aimeat connect list` — shows all configured agents with their mode + status
- `aimeat connect remove <agent>` — removes one agent (deletes its token + per-agent config, asks for confirmation)

**Backward compatibility:**
- If only `~/.aimeat/config.yaml` exists (old single-agent setup) and one matching token in `~/.aimeat/tokens/`, treat as single-agent installation. Continue working.

### Task 2: Per-agent task-runner configuration

Add new optional field to per-agent config at `~/.aimeat/agents/{agent}/config.yaml`:

```yaml
agent: marketing-crew
owner: happydude500001
mode: task-runner               # NEW: see Task 3 below for mode classification
runner:
  command: uv
  args: ["run", "python", "-m", "my_marketing_crew"]
  prompt_env: AIMEAT_TASK_PROMPT       # env var name for the task prompt (default: AIMEAT_TASK_PROMPT)
  task_id_env: AIMEAT_TASK_ID          # env var for task id (default: AIMEAT_TASK_ID)
  agent_name_env: AIMEAT_AGENT_NAME    # env var for agent name (default: AIMEAT_AGENT_NAME)
  token_env: AIMEAT_TOKEN              # env var for AIMEAT token (default: AIMEAT_TOKEN)
  cwd: /path/to/crew/project           # optional working directory (default: current)
  timeout_seconds: 1800                # optional max runtime (default: 3600)
  output_capture: stdout               # stdout | file:<path> (default: stdout)
  on_failure: report                   # report | retry (default: report)
```

### Task 3: Task arrival → subprocess launch

When the poller sees a queued task for an agent whose mode is `task-runner` and has a `runner` config:

1. Skip the "wait for user approval" flow (no proposal needed — runner just executes)
2. Mark the task as `active` immediately via `aimeat_task_event` ("Task runner starting")
3. Spawn subprocess via `child_process.spawn`:
   - Env vars set per runner config
   - cwd, timeout per config
   - Capture stdout (or read file from `output_capture: file:<path>`)
4. While subprocess runs, periodically emit `aimeat_task_event` with "Runner still working" heartbeat (every 5 min)
5. On subprocess exit:
   - Exit code 0 → call `aimeat_task_complete` with summary = captured output (truncated to 64KB; if larger, upload to storage via `aimeat_storage_upload` and reference the URI in summary)
   - Non-zero exit code → call `aimeat_task_fail` with reason = stderr (truncated)
   - Timeout → call `aimeat_task_fail` with reason "Runner exceeded {timeout_seconds}s timeout"
6. Subprocess can ALSO call AIMEAT itself during the run via `aimeat connect call <tool> --json '{...}'` — the token env var is already set, so calls authenticate as the right agent

**Security notes** (the `runner.command` foot-gun pattern is already documented in `wakeup.ts`):
- The `runner.command` runs ANYTHING the user configured in `~/.aimeat/agents/{agent}/config.yaml`
- Surface a warning when reading runner config: "WARNING: runner.command will be exec'd. Trust this config."
- Print the resolved command + args once at serve startup so user can verify
- Same security note as existing `wake.command` foot-gun: only trust your own ~/.aimeat/ contents

### Task 4: Sample CrewAI demo script

Create `examples/crewai-marketing-demo/` in the repo:

```
examples/crewai-marketing-demo/
├── README.md              # how to run
├── pyproject.toml         # uv-managed
├── my_marketing_crew.py   # CrewAI script
└── aimeat-config-snippet.yaml   # what to put in ~/.aimeat/agents/marketing-crew/config.yaml
```

**`my_marketing_crew.py`** should:
- Read `AIMEAT_TASK_PROMPT`, `AIMEAT_TASK_ID`, `AIMEAT_AGENT_NAME`, `AIMEAT_TOKEN` from env
- Run a simple CrewAI crew with 3 agents (researcher, analyst, writer) using `Process.sequential`
- Use a stub web search tool (no actual API calls) so the demo runs without external API keys
- During the run, call `aimeat connect call aimeat_memory_write --json '{...}'` once to save an intermediate research note (demonstrates bidirectional integration)
- Final output: a JSON object `{ title, summary, sections: [...], recommendations: [...] }` printed to stdout
- Exit 0 on success

**`README.md`** explains the full flow: install uv, install AIMEAT CLI globally (`npm i -g aimeat`), connect a `marketing-crew` agent (`aimeat connect --agent marketing-crew --url https://aimeat.io --owner <yours>`), drop in the per-agent config, run `aimeat connect serve`, then test by either creating a task via UI or asking Claude Desktop "create a Q3 plan task for marketing-crew".

### Task 5: Documentation

Create `docs/integrations/crewai.md`:
- What this integration does (one paragraph)
- Why it doesn't require a Python package (subprocess + CLI is enough)
- Per-agent config example
- How CrewAI agents call AIMEAT back during execution
- How to register multiple crews (each is its own agent in AIMEAT)
- Mode classification: why CrewAI crews are `task-runner` mode and skip most Hello Integration steps (see sibling agent-modes implementation doc for the mode system)
- Troubleshooting: common errors and fixes

Update [README.md](../../README.md) — add a short paragraph under "Connect AI agents" mentioning CrewAI task-runner mode and link to `docs/integrations/crewai.md`.

---

## Acceptance test

When a fresh user follows these steps end-to-end, it should work:

1. `npm i -g aimeat@latest`
2. `aimeat connect --agent falcon --url https://aimeat.io --owner mytest` (interactive agent — Falcon-style)
3. Approve via aimeat.io UI
4. `aimeat connect add --agent marketing-crew --url https://aimeat.io --owner mytest` (task runner)
5. Approve
6. Set `~/.aimeat/agents/marketing-crew/config.yaml` with `mode: task-runner` + runner config pointing to the demo script
7. `aimeat connect serve`
8. From another terminal: `aimeat connect call aimeat_task_list --json '{"agent_name":"marketing-crew"}'` → sees zero tasks
9. Create a task via aimeat.io UI for marketing-crew: title "Test plan", description "Make me a small marketing plan for a fake product."
10. Within ~30s the serve process logs `[agent:marketing-crew] Task arrived: <id>`, then `[agent:marketing-crew] Launching subprocess: uv run python -m my_marketing_crew`
11. The subprocess runs, produces JSON, prints it
12. Within ~30s of subprocess exit, the AIMEAT task shows status `done` with the JSON as the completion summary
13. Memory key written by the crew during the run is visible in aimeat.io UI under marketing-crew's memory

If all 13 steps work, the implementation is done.

---

## Things you should NOT do

- Do not modify the Hello Integration step list for task-runner agents in THIS implementation. That's in the sibling `agent-modes-and-tag-grouping.md` implementation doc.
- Do not write a Python package. CLI subprocess only.
- Do not add real CrewAI Memory backend integration. The crew can call `aimeat_memory_write` via CLI if it wants — that's enough.
- Do not surface CrewAI internal events to AIMEAT activity log. Only the final result.
- Do not include time/effort estimates anywhere.
- Do not skip the security warning about runner.command — match the existing tone in wakeup.ts.

---

## When you're done

1. Run typecheck + lint (per CLAUDE.md Rule 1 and 7):
   ```
   pnpm typecheck
   pnpm lint
   ```
2. Run affected E2E suites on SQLite (per CLAUDE.md Rule 1 — testing policy):
   ```
   cd aimeat
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-tasks --test=agent-onboarding
   ```
3. Write a brief PR description (no time estimates!) explaining: what was added, what's the manual acceptance test, what's NOT in scope (Python package, internal event instrumentation, mode classification).
