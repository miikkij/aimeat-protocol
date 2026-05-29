"""
AIMEAT Liaison Agent factory.

The liaison is a CrewAI Agent whose tools are an MCPServerAdapter pointed at
an AIMEAT node. It is the single crew member that speaks to AIMEAT; the rest
of the crew focuses on its domain work (research, writing, code, analysis).

The factory returns a context manager so the MCP connection's lifecycle is
managed properly -- without a `with` block, the stdio subprocess can leak.

Typical use:

    from aimeat_crewai import create_liaison_agent, stdio_params

    with create_liaison_agent(
        mcp_server_params=stdio_params(agent_name="company-crew"),
        llm=my_llm,
    ) as liaison:
        crew = Crew(agents=[researcher, writer, liaison], tasks=[...])
        crew.kickoff()

Without a context manager (manual lifecycle):

    liaison_cm = create_liaison_agent(...)
    liaison = liaison_cm.__enter__()
    try:
        crew.kickoff()
    finally:
        liaison_cm.__exit__(None, None, None)
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterable, Iterator

try:
    from crewai import Agent
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "CrewAI is required. Install it with: pip install crewai"
    ) from exc

try:
    from crewai_tools import MCPServerAdapter
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "crewai-tools[mcp] is required. Install it with: pip install 'crewai-tools[mcp]'"
    ) from exc


class AimeatLiaisonError(RuntimeError):
    """Raised when the liaison cannot establish or use an AIMEAT MCP connection."""


# Default agent persona. Overridable per call. The text is intentionally
# operational rather than chatty -- the LLM reads this verbatim and uses it
# to decide when to call which AIMEAT tool, so the more concrete the
# instructions the better the behaviour.
DEFAULT_ROLE = "AIMEAT Integration Specialist"

DEFAULT_GOAL = (
    "Keep the AIMEAT node in sync with everything this crew is doing. On "
    "startup, complete the Hello Integration handshake. As the crew works, "
    "publish state, deliverables, and telemetry through the appropriate "
    "AIMEAT MCP tools so the owner and other agents on the node see what is "
    "happening. Do NOT do the crew's domain work yourself -- you are the "
    "voice of the crew to AIMEAT, not a domain agent."
)

DEFAULT_BACKSTORY = """\
You are the liaison between this CrewAI crew and an AIMEAT node. AIMEAT
(AI Memory Exchange and Action Transfer) is an open protocol that gives every
AI agent a persistent identity, shared memory, capabilities catalog, work
queue with escrow, and federation across nodes. See https://aimeat.io for the
full spec.

You have full access to the AIMEAT MCP tool surface (aimeat_*) through this
crew's registered agent identity. The other crew members focus on their
domain work; you handle ALL AIMEAT-side coordination so they don't have to
learn the protocol.

Your responsibilities, in priority order:

1. ON CREW STARTUP: Call aimeat_onboarding_status. If Hello Integration is
   not yet complete, complete the missing steps in order:

   - aimeat_onboarding_identify_platform with platform="crewai" and
     platform_version=<the installed crewai version, see `crewai.__version__`>
   - aimeat_onboarding_confirm_skill_installed (confirm the local connector
     has the skill bundle; usually true since `aimeat connect add` does this)
   - aimeat_agent_capabilities_report with technical=[{name:"task_execution",
     type:"tool"}], domain=[<this crew's specialty>], languages=[<the languages
     the crew handles>]
   - aimeat_memory_write key="agents.config.<your-agent-name>.runtime",
     value={runtime:"crewai", version:<crewai version>}, visibility="owner"
     -- this satisfies publish_config
   - aimeat_onboarding_confirm_directives_read after reading aimeat_handbook_get

2. WHEN THE OWNER QUEUES A TASK FOR THIS CREW: Use aimeat_task_list to find
   queued tasks. Read the prompt from the task. Pass it to the crew's domain
   work. When the crew produces a deliverable, call aimeat_task_complete with
   it as the completion summary.

3. WHEN THE CREW HAS A DELIVERABLE: Decide whether it is private working
   state (aimeat_memory_write) or public/shared knowledge worth publishing
   to the catalogue (aimeat_knowledge_contribute). Default to memory unless
   the deliverable is something other agents would benefit from.

4. PERIODICALLY: Call aimeat_agent_telemetry_report with the latest LLM/tool
   call counts so the owner sees accurate token usage.

5. WHEN ASKED FOR AIMEAT STATE: Use aimeat_memory_read, aimeat_memory_list,
   aimeat_knowledge_get, aimeat_message_inbox, or aimeat_catalogue_search.

You do NOT take initiative outside AIMEAT coordination. You do NOT do the
crew's domain work. You speak to AIMEAT, and let the rest of the crew speak
to the world.
"""


@contextmanager
def create_liaison_agent(
    *,
    mcp_server_params: Any,
    llm: Any = None,
    role: str = DEFAULT_ROLE,
    goal: str = DEFAULT_GOAL,
    backstory: str = DEFAULT_BACKSTORY,
    tool_filter: Iterable[str] | None = None,
    verbose: bool = False,
    allow_delegation: bool = False,
    **agent_kwargs: Any,
) -> Iterator[Agent]:
    """
    Build a CrewAI Agent that uses an AIMEAT-MCP-backed toolset.

    This is a context manager: the underlying MCP connection (stdio
    subprocess, HTTP session, etc.) is opened on `__enter__` and closed on
    `__exit__`. Always use with `with` -- leaking the connection can leave
    a hung `aimeat connect serve` subprocess around.

    Args:
        mcp_server_params: Connection params -- a StdioServerParameters
            object (use `stdio_params()`) or a dict for HTTP/SSE (use
            `http_params()` / `sse_params()`). Required.
        llm: CrewAI-compatible LLM to use for the liaison's reasoning.
            If None, CrewAI's default LLM resolution applies.
        role / goal / backstory: Override the default agent persona. Sensible
            defaults are provided; override only if you need to specialise.
        tool_filter: If provided, only AIMEAT tools whose names appear in this
            iterable will be exposed to the liaison. Useful when you want to
            restrict the liaison to e.g. memory + knowledge only and forbid
            it from touching the wallet. Tool names are exact (e.g.
            "aimeat_memory_write"). If None (default), the liaison sees the
            full surface the AIMEAT node exposes.
        verbose: Pass through to crewai.Agent for verbose logging.
        allow_delegation: Pass through to crewai.Agent. Default False because
            the liaison's role is narrow.
        **agent_kwargs: Any extra kwargs forwarded to crewai.Agent.

    Yields:
        A configured crewai.Agent ready to drop into a Crew(agents=[...]).

    Raises:
        AimeatLiaisonError: If the MCP connection cannot be established or
            no AIMEAT tools can be discovered through it.
    """
    if mcp_server_params is None:
        raise AimeatLiaisonError(
            "mcp_server_params is required. Use stdio_params() or http_params()."
        )

    adapter = MCPServerAdapter(mcp_server_params)
    try:
        all_tools = adapter.tools
        if not all_tools:
            raise AimeatLiaisonError(
                "No tools discovered through the MCP connection. Is the AIMEAT "
                "node reachable and the token valid? Check `aimeat connect tools` "
                "or hit the node's /v1/mcp endpoint directly to verify."
            )

        if tool_filter is not None:
            wanted = set(tool_filter)
            tools = [t for t in all_tools if getattr(t, "name", None) in wanted]
            missing = wanted - {getattr(t, "name", None) for t in all_tools}
            if missing:
                raise AimeatLiaisonError(
                    f"tool_filter requested tools that the MCP server did not "
                    f"expose: {sorted(missing)}. Available: "
                    f"{sorted(getattr(t, 'name', '?') for t in all_tools)}"
                )
        else:
            tools = list(all_tools)

        agent_args: dict[str, Any] = {
            "role": role,
            "goal": goal,
            "backstory": backstory,
            "tools": tools,
            "verbose": verbose,
            "allow_delegation": allow_delegation,
        }
        if llm is not None:
            agent_args["llm"] = llm
        agent_args.update(agent_kwargs)

        agent = Agent(**agent_args)
        yield agent
    finally:
        # MCPServerAdapter handles its own subprocess/HTTP cleanup; we just
        # have to ensure stop() is called even if the crew kickoff threw.
        stop = getattr(adapter, "stop", None)
        if callable(stop):
            try:
                stop()
            except Exception:  # pragma: no cover -- best-effort cleanup
                pass


def liaison_tools(mcp_server_params: Any) -> list[Any]:
    """
    Return the raw list of AIMEAT MCP tools without wrapping them in a CrewAI
    Agent. Use this when you want to attach AIMEAT tools to your OWN custom
    agent or to multiple agents.

    NOTE: This does NOT manage the MCP connection lifecycle for you. The
    returned tools share a single MCPServerAdapter that stays open for the
    process's lifetime. For predictable cleanup, prefer `create_liaison_agent`
    as a context manager.

    Args:
        mcp_server_params: Same as `create_liaison_agent`.

    Returns:
        The list of tool objects discovered through the MCP adapter.
    """
    adapter = MCPServerAdapter(mcp_server_params)
    return list(adapter.tools)
