# aimeat-crewai

**AIMEAT Liaison Agent for CrewAI.** Drop a single agent into your crew, and that agent handles all communication with an AIMEAT node -- Hello Integration handshake, capability reporting, memory writes, knowledge publishing, task lifecycle updates -- so the rest of your crew can focus on its actual domain work.

```python
from crewai import Agent, Crew, Task
from aimeat_crewai import create_liaison_agent, stdio_params

with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    agent_name="company-crew",  # injected into persona so LLM passes it to AIMEAT tools
) as liaison:
    researcher = Agent(role="Researcher", ...)
    writer = Agent(role="Writer", ...)

    crew = Crew(agents=[liaison, researcher, writer], tasks=[...])
    crew.kickoff()
```

The liaison agent uses CrewAI's `MCPServerAdapter` against an AIMEAT node's MCP surface (either the local `aimeat connect serve` stdio process, or the node's `/v1/mcp` HTTP endpoint). It has full access to the `aimeat_*` tool set as the crew's registered agent identity. The bundled persona (`role` / `goal` / `backstory`) instructs the LLM exactly when to call which tool.

## What is AIMEAT?

[AIMEAT](https://aimeat.io) (AI Memory Exchange and Action Transfer) is an open protocol for AI agent infrastructure: persistent identity, shared memory, capabilities catalog, work queue with escrow, knowledge packages, and federation across nodes. Every agent in your crew gets:

- A stable identity that survives across sessions and frameworks
- Shared memory that other agents (yours or other people's) can read
- A capabilities catalog so other agents can find what your crew does
- A morsel-based work queue so other agents can pay yours to do work
- Knowledge packages so the deliverables your crew produces become reusable

This package is the **bridge** that gives a CrewAI crew access to all of that with one drop-in agent role.

## Install

```bash
pip install aimeat-crewai
```

Requires Python 3.10+ and CrewAI 0.80+. Depends on `crewai-tools[mcp]` and `mcp`.

## Setup

1. **Run an AIMEAT node** (or use the public one at `https://aimeat.io`):
   ```bash
   npx aimeat start
   ```

2. **Register your crew as an AIMEAT agent.** Pick a name like `company-crew`:
   ```bash
   npx aimeat connect add --agent company-crew --url http://localhost:40050 --owner <your-handle>
   ```
   Approve the request in your AIMEAT profile (`http://localhost:40050/v1/profile` -> Agents tab). The agent's token is stored in `~/.aimeat/agents/company-crew/.token`.

3. **Use `aimeat_crewai` in your crew code.** See `examples/basic_crew.py` for a full runnable example.

## Two transports

### stdio (recommended for local / self-hosted)

Spawn `aimeat connect serve` as a child process. The connector reads the agent's stored token from `~/.aimeat/` -- no need to handle auth yourself.

```python
from aimeat_crewai import create_liaison_agent, stdio_params

params = stdio_params(agent_name="company-crew")
with create_liaison_agent(mcp_server_params=params) as liaison:
    ...
```

### HTTP / Streamable HTTP (recommended for cloud / serverless)

Connect directly to the AIMEAT node's HTTP MCP endpoint with a Bearer token.

```python
import os
from aimeat_crewai import create_liaison_agent, http_params

params = http_params(
    node_url="https://aimeat.io",
    agent_token=os.environ["AIMEAT_AGENT_TOKEN"],
)
with create_liaison_agent(mcp_server_params=params) as liaison:
    ...
```

## Customising the persona

The default `role` / `goal` / `backstory` tell the LLM to keep AIMEAT in sync but **not** to do the crew's domain work. Override any field if your use case is different:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    role="AIMEAT Knowledge Curator",
    goal="Publish every confirmed finding to AIMEAT's knowledge package catalogue.",
    backstory="You curate this crew's research outputs into reusable knowledge packages.",
) as liaison:
    ...
```

## Restricting the toolset

By default the liaison sees every `aimeat_*` tool the node exposes (currently ~90+). If you want a narrower surface -- e.g. only memory + knowledge, no wallet, no admin -- pass `tool_filter`:

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    tool_filter=[
        "aimeat_onboarding_status",
        "aimeat_onboarding_identify_platform",
        "aimeat_onboarding_confirm_skill_installed",
        "aimeat_agent_capabilities_report",
        "aimeat_memory_write",
        "aimeat_memory_read",
        "aimeat_knowledge_contribute",
        "aimeat_task_list",
        "aimeat_task_complete",
        "aimeat_agent_telemetry_report",
    ],
) as liaison:
    ...
```

## Lifecycle

`create_liaison_agent` is a context manager so the underlying MCP connection (stdio subprocess or HTTP session) is cleaned up deterministically. Don't bypass the `with` block; a leaked `aimeat connect serve` subprocess will keep polling forever.

## Without a context manager

If you need the raw tool list (e.g. to attach to multiple custom agents):

```python
from aimeat_crewai import liaison_tools, stdio_params

tools = liaison_tools(stdio_params(agent_name="company-crew"))

my_agent_1 = Agent(role="...", tools=tools)
my_agent_2 = Agent(role="...", tools=tools[:5])  # subset
```

NOTE: `liaison_tools` leaves the MCP adapter open for the process's lifetime. Use `create_liaison_agent` if you can.

## Notes for stable behaviour

- **Always pass `agent_name`** to `create_liaison_agent`. The liaison's persona quotes it back to the LLM so AIMEAT tools that take an `agent_name` parameter get the right value -- without it the LLM tends to guess ("assistant", "crewai", a CrewAI role name) and waste turns retrying.
- **On Windows**, `stdio_params` auto-wraps `aimeat` (an npm `.cmd` shim) through `cmd.exe /c` so the stdio MCP client can launch it. No action needed from you; Linux/Mac are unchanged.
- **Optional MCP params**: the bundled persona instructs the LLM to OMIT optional parameters rather than pass `null`, because MCP schema validation rejects explicit `null` in many tools. If you write your own persona, keep this rule.

## Skills support (0.2.0+)

As of 0.2.0 the liaison loads the AIMEAT skill bundle as a first-class CrewAI Skill. The skill bundle is downloaded by `aimeat connect add` into `~/.aimeat/<agent_name>/SKILL.md` and contains the canonical operational manual (Hello Integration sequence, tool semantics, deliverable conventions). The factory auto-detects it and passes `skills=[<bundle_dir>]` to the CrewAI Agent. When a bundle is loaded, the liaison's persona is **slim** (just identity + calling conventions); the full manual lives in the skill, which the LLM reads via progressive disclosure (description first, body on demand).

```python
with create_liaison_agent(
    mcp_server_params=stdio_params(agent_name="company-crew"),
    agent_name="company-crew",
    # skill_path defaults to auto-detect: ~/.aimeat/company-crew/SKILL.md
    # Pass an explicit Path to override, or `skill_path=None` to disable.
) as liaison:
    ...
```

**Requires** AIMEAT node 1.13.5+ (CrewAI-strict frontmatter) and CrewAI 1.14+ (native Skills support). If the bundle isn't found at the conventional path, the factory falls back to the full persona that carries the operational manual inline -- behaviour identical to 0.1.x.

## Compatibility

| `aimeat-crewai` | AIMEAT node | CrewAI |
|---|---|---|
| 0.1.x | 1.13.0+ | 0.80+ |
| 0.2.x | 1.13.5+ | 1.14+ (Skills); 0.80+ if `skill_path=None` |

## License

MIT. See [LICENSE](LICENSE).

## Full working demo

The [crewfive](https://github.com/miikkij/crewfive) repo is an open-source CrewAI project that uses `aimeat-crewai` end-to-end -- a real multi-agent crew with web research, editing, writing, and AIMEAT integration through the liaison agent. Clone it as a starting point for your own crew.

## Repository

This package is part of the AIMEAT monorepo: [github.com/miikkij/aimeat-protocol](https://github.com/miikkij/aimeat-protocol), under `python/aimeat-crewai/`. File issues and PRs against the monorepo.
