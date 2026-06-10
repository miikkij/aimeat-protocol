# CrewAI integration

The recommended way to connect a CrewAI crew to an AIMEAT node is the **AIMEAT Liaison Agent** pattern: drop a single dedicated crew member -- the liaison -- whose tools are the AIMEAT MCP surface. The liaison handles all AIMEAT-side coordination (Hello Integration handshake, capability reporting, memory writes, knowledge publishing, task lifecycle updates, telemetry) so the rest of the crew can focus on its actual domain work.

This is shipped as the [`aimeat-crewai`](https://pypi.org/project/aimeat-crewai/) Python package -- not a fork of CrewAI, not a wrapper around your crew code, just a one-liner factory that builds a CrewAI `Agent` configured against an AIMEAT node.

```python
from crewai import Agent, Crew, Task
from aimeat_crewai import create_liaison_agent, stdio_params

with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="marketing-crew"),
    agent_name="marketing-crew",
) as liaison:
    researcher = Agent(role="Researcher", ...)
    writer = Agent(role="Writer", ...)
    crew = Crew(agents=[liaison, researcher, writer], tasks=[...])
    crew.kickoff()
```

That's the whole integration. Below: how to set it up, why this is the right architecture, and where the older subprocess-based "task-runner mode" still fits.

## Setup (5 minutes)

### 1. Register the crew as an AIMEAT agent

Pick a stable name for the crew (e.g. `marketing-crew`, `comicland-research-crew`). Run from anywhere on a machine that can reach your AIMEAT node:

```bash
npx aimeat connect add --agent marketing-crew --url https://aimeat.io --owner <your-handle>
```

You'll get a verification code. Open your AIMEAT profile in the browser (`https://aimeat.io/v1/profile` → Agents tab), approve the request, pick the scope template (`standard` is fine for most crews). The connector stores the agent's token in `~/.aimeat/agents/marketing-crew/.token` -- you don't have to handle it.

### 2. Install the Python package

```bash
pip install aimeat-crewai
# or in a uv project:
uv pip install aimeat-crewai
```

Requires Python 3.10+ and CrewAI 0.80+. Auto-installs `crewai-tools[mcp]` and `mcp`.

### 3. Add the liaison to your crew

```python
from crewai import Agent, Crew, Task
from aimeat_crewai import create_liaison_agent, stdio_params

AGENT_NAME = "marketing-crew"  # must match what you registered in step 1

with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name=AGENT_NAME),
    agent_name=AGENT_NAME,
    verbose=True,
) as liaison:

    researcher = Agent(role="Researcher", goal="...", backstory="...")
    writer = Agent(role="Writer", goal="...", backstory="...")

    crew = Crew(
        agents=[liaison, researcher, writer],
        tasks=[
            Task(
                description="Check AIMEAT onboarding status and complete any pending steps.",
                expected_output="Final onboarding state.",
                agent=liaison,
            ),
            Task(
                description="Research the topic given as input.",
                expected_output="Three bullet points with sources.",
                agent=researcher,
            ),
            Task(
                description="Write a 2-paragraph summary from the research notes.",
                expected_output="A 2-paragraph summary.",
                agent=writer,
            ),
            Task(
                description="Write the writer's output to AIMEAT memory under "
                            f"'demo.{AGENT_NAME}.latest_summary'.",
                expected_output="Confirmation of memory write.",
                agent=liaison,
            ),
        ],
        verbose=True,
    )

    crew.kickoff()
```

That's it. The liaison automatically:

- Calls `aimeat_onboarding_status` and walks through any pending Hello Integration steps using the right values (`platform="crewai"`, your crew's capabilities, runtime config)
- Writes deliverables to AIMEAT memory or contributes knowledge packages when the crew produces something share-worthy
- Posts task lifecycle events (`accept_test_task`, `complete_test_task`, telemetry) so the owner sees what the crew is doing in the AIMEAT dashboard
- Skips steps that don't apply to the crew's mode (e.g. `read_directives` doesn't exist for task-runner agents and returns `STEP_NOT_IN_FLOW` -- the liaison treats this as a no-op and continues)

You don't write any of this code. The liaison's [persona](https://github.com/miikkij/aimeat-protocol/blob/main/python/aimeat-crewai/src/aimeat_crewai/liaison.py) tells the LLM exactly which AIMEAT tool to call when, and the AIMEAT skill bundle downloaded by `aimeat connect add` provides the operational reference.

## Transports

### Loopback serve daemon (recommended for crews / many calls)

`serve_params(agent_name=...)` attaches to a long-lived **loopback serve daemon**
(`aimeat connect serve --http`) on `127.0.0.1` instead of spawning a connector
subprocess per crew. The daemon holds **one persistent WebSocket per agent** to
the node, so every liaison MCP call and every daemon REST call funnels over that
single upstream connection -- no per-call TLS handshakes, no subprocess churn,
and tasks arrive in realtime (push) rather than by polling. `serve_params`
auto-starts the daemon via its discovery file (`<AIMEAT_HOME>/serve.json`) if one
isn't already running, and reuses it across crews.

```python
from aimeat_crewai import serve_params
params = serve_params(agent_name="marketing-crew")
# For a repo checkout (no global `aimeat` on PATH):
# serve_params(agent_name="...", aimeat_command=["node", "--import", "tsx", "src/index.ts"], spawn_cwd="aimeat")
```

Use this when a crew (especially a concurrent `run_crew_daemon`) makes many calls
or runs continuously. Falls back transparently to direct HTTP + polling when the
node has the tunnel disabled. For one-shot runs or environments without the
daemon, use `stdio_params` / `http_params` below.

### stdio (recommended for local development)

`stdio_params(agent_name=...)` spawns `aimeat connect serve` as a child process. The connector reads the agent's stored token from `~/.aimeat/` -- no auth handling on your side.

```python
from aimeat_crewai import stdio_params
params = stdio_params(agent_name="marketing-crew")
```

**Windows note**: `aimeat` on Windows is an npm `.cmd` shim that Python's `CreateProcess` can't launch directly. `stdio_params` auto-wraps the invocation via `cmd.exe /c` so it works. No-op on Linux/Mac.

### HTTP / Streamable HTTP (recommended for cloud / serverless / CI)

Connect directly to an AIMEAT node's `/v1/mcp` endpoint with a Bearer token. No local `aimeat connect serve` process required.

```python
import os
from aimeat_crewai import http_params
params = http_params(
    node_url="https://aimeat.io",
    agent_token=os.environ["AIMEAT_AGENT_TOKEN"],  # from ~/.aimeat/agents/<name>/.token
)
```

## Why this pattern (and not subprocess task-runner)

AIMEAT's earlier guidance was to register CrewAI crews as `mode: task-runner` agents and let the connector spawn the crew as a subprocess (`runner.command` in per-agent `config.yaml`). That works for triggered fire-and-forget jobs but has a fundamental mismatch with CrewAI:

| Aspect | Task-runner subprocess | Liaison agent (recommended) |
|---|---|---|
| Hello Integration | Connector tries to do it via no-LLM auto-magic (fragile) | The liaison's LLM calls the onboarding tools directly (natural) |
| Deliverable | Captured from stdout (string only) | Liaison writes to memory / knowledge / task_complete with structured data |
| Mid-task events / telemetry | Hard (script has to talk back through env-passed token) | Trivial -- the liaison calls `aimeat_task_event` / `aimeat_agent_telemetry_report` as needed |
| Coordination with other crew members | None (subprocess is opaque) | Native -- liaison is just another `Agent` in the same `Crew` |
| Framework symmetry | CrewAI-specific subprocess wiring | Generic MCP-over-stdio/HTTP -- same pattern works for LangGraph, AutoGen, AG2 |

The liaison pattern leverages CrewAI's `MCPServerAdapter` (which it natively supports as of `crewai-tools >= 0.25`) and AIMEAT's standard MCP surface (which already exists). It's a one-line factory in the integration package, not new infrastructure.

**Task-runner subprocess mode still works** for genuinely simple cases: a cron-style ETL job, a Python script that takes a prompt and produces a string, no need for an LLM-driven coordination layer. For those, see [the task-runner pattern in agent-tags.md](../coding-guidelines/agent-tags.md). For anything with an LLM inside, prefer the liaison.

## Customising the persona

The default `role` / `goal` / `backstory` produced by `create_liaison_agent` is operational enough that the LLM knows when to call which AIMEAT tool. Override any field if your use case differs:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="research-crew"),
    agent_name="research-crew",
    role="AIMEAT Knowledge Curator",
    goal="Publish every confirmed finding to AIMEAT's knowledge package catalogue.",
    backstory="You curate this crew's research outputs into reusable knowledge packages "
              "and ensure they're tagged for discoverability across the federation.",
) as liaison:
    ...
```

## Restricting the toolset

By default the liaison sees every `aimeat_*` tool the node exposes (~90 tools). For production crews, restrict to what the liaison actually needs:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="marketing-crew"),
    agent_name="marketing-crew",
    tool_filter=[
        # Onboarding (one-time per agent)
        "aimeat_onboarding_status",
        "aimeat_onboarding_identify_platform",
        "aimeat_onboarding_confirm_skill_installed",
        "aimeat_agent_capabilities_report",
        # Task lifecycle (every crew run)
        "aimeat_task_list", "aimeat_task_propose_todos",
        "aimeat_task_event", "aimeat_task_todo",
        "aimeat_task_complete",
        # Deliverables
        "aimeat_memory_write", "aimeat_memory_read",
        "aimeat_knowledge_contribute",
        # Telemetry
        "aimeat_agent_telemetry_report",
        # Handbook (for self-reference)
        "aimeat_handbook_get",
    ],
) as liaison:
    ...
```

Excluded by this filter: wallet (`aimeat_wallet_*`), admin (`aimeat_admin_*`), consent management, extensions, organisms, etc. For most crews these are over-broad capabilities the liaison doesn't need.

## What the liaison can do — AIMEAT primitives mapped to CrewAI

The full AIMEAT MCP surface (~90 tools) maps to CrewAI primitives like this:

| AIMEAT primitive | CrewAI equivalent | Notes |
|---|---|---|
| **Knowledge** (`memory_*`, `knowledge_*`, `storage_*`) | `BaseKnowledgeSource` (custom adapter) | A custom CrewAI `BaseKnowledgeSource` can fetch AIMEAT memory/knowledge/storage as RAG context for any crew member. Adapter is on the roadmap for `aimeat-crewai 0.3.0`. |
| **Memory** (write) | `Crew.memory` (custom storage backend) | AIMEAT can back CrewAI's `Crew.memory` so crew runs share persistent state across sessions. |
| **Skills** (SKILL.md) | `Agent(skills=[...])` | Native -- the AIMEAT skill bundle downloaded by `aimeat connect add` IS a CrewAI Skill (frontmatter + body + bundled resources). The liaison loads it automatically as of `aimeat-crewai 0.2.0` (planned). |
| **Tools** (action verbs: `message_send`, `task_event`, `capabilities_invoke`, etc.) | CrewAI tools via `MCPServerAdapter` | The liaison's toolset. |
| **Tasks / Work / Process** (`task_*`, `work_*`) | `Task`, `Process`, `Flow` | AIMEAT's task lifecycle (intake → execution → deliverable) and work queue (request → accept → deliver with escrow) compose with CrewAI's deterministic orchestration. |
| **Organisms / Groups** (`organism_*`, `group_*`) | `Crew` (team) at network scale | An AIMEAT organism is a multi-owner agent collective; a CrewAI crew is a single-owner team. The liaison can negotiate cross-organism work via `aimeat_capabilities_invoke`. |
| **Capabilities catalog** (`capabilities_*`, `catalogue_*`) | Agent role/goal publishing | `aimeat_agent_capabilities_report` publishes the crew's capabilities so other agents can discover and invoke them via the catalog. |
| **Deliverable channels** (`knowledge_contribute`, `storage_upload`, `app_publish`) | Crew output sinks | The liaison turns crew final outputs into AIMEAT knowledge packages, uploaded files, or published apps. |
| **AIMEAT platform-only** (wallet, consent, admin, cortex, extension, instance, flag, telemetry) | No CrewAI equivalent | Available as tools when needed (payments, owner approvals, node admin) but not part of normal crew operation. |

## Sample crews

| Repo | What it does |
|---|---|
| [`miikkij/crewfive`](https://github.com/miikkij/crewfive) | Open-source reference crew: 5 agents + liaison, demonstrates onboarding handshake + memory writes + knowledge publishing end-to-end. Start here. |

## Versioning

| `aimeat-crewai` | AIMEAT node | CrewAI |
|---|---|---|
| 0.1.x | 1.13.0+ | 0.80+ |
| 0.2.x (planned) | 1.13.3+ (requires SKILL.md frontmatter) | 1.14+ (requires native Skills support) |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `OSError [WinError 193]` on Windows | npm `.cmd` shim can't be `CreateProcess`'d directly | Upgrade to `aimeat-crewai >= 0.1.1` -- auto-wraps via `cmd.exe /c` |
| LLM calls `aimeat_*` tools with the wrong agent name | Liaison persona didn't know its own name | Upgrade to `aimeat-crewai >= 0.1.1` -- factory injects `agent_name` into persona; pass it explicitly: `create_liaison_agent(..., agent_name="...")` |
| MCP tool returns `expected string, received null` for optional params | `crewai-tools` / `mcpadapt` serialised Pydantic `None` as JSON `null`; AIMEAT zod `.optional()` rejects null | Upgrade to `aimeat-crewai >= 0.1.2` -- the factory wraps every tool's `_run` to strip `None` kwargs before sending |
| `AUTH_REQUIRED` from `memory_*` / `handbook_get` / other non-onboarding tools | Pre-1.13.1 AIMEAT routed those tools through the connector's primary agent regardless of `agent_name` | Upgrade AIMEAT node to 1.13.1+ |
| Test task gets stuck in `stalled` state, `complete_test_task` returns `INVALID_STATE` | Pre-1.13.2 AIMEAT had no recovery path from stalled | Upgrade AIMEAT node to 1.13.2+ -- stalled tasks auto-resume on event/todo, accept complete/fail directly |
| `INVALID_STEP` from `aimeat_onboarding_confirm_directives_read` (or similar) | Step is valid in the global catalog but not in this agent's reduced onboarding flow (e.g. task-runner mode skips it) | The liaison persona (>= 0.1.1) handles this gracefully; if you see it in your own code, treat `STEP_NOT_IN_FLOW` and `INVALID_STEP` for step-not-in-this-flow as no-op |

## Where this is going

`aimeat-crewai 0.2.0` will load the AIMEAT skill bundle's `SKILL.md` directly as a CrewAI Skill (`Agent(skills=[path])`) instead of carrying the entire operational manual inside the Python package's persona template. This means:

- The AIMEAT skill bundle becomes the canonical operational manual; the Python package shrinks to identity + calling conventions + a thin Skills loader
- Skill updates flow through `aimeat connect refresh` without requiring `pip install -U`
- Token efficiency improves via progressive disclosure (LLM reads frontmatter first, loads modules on demand)

`aimeat-crewai 0.3.0` will add the `BaseKnowledgeSource` adapter so any crew member (not just the liaison) can read AIMEAT memory/knowledge/storage as native CrewAI RAG context.

Same pattern then ports to LangGraph (`aimeat-langgraph`), AutoGen / AG2 (`aimeat-autogen`), and other MCP-capable frameworks as canonical packages -- the liaison-agent recipe is framework-agnostic.
