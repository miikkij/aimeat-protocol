"""
aimeat-crewai -- AIMEAT Liaison Agent for CrewAI.

Drop-in crew member that handles all communication with an AIMEAT node so the
rest of the crew can focus on its actual domain work (research, writing, code,
analysis, whatever).

Typical use:

    from crewai import Agent, Crew, Task
    from aimeat_crewai import create_liaison_agent, stdio_params

    # Liaison agent uses MCP to talk to AIMEAT through the local `aimeat connect serve`
    # subprocess, which authenticates as the configured agent.
    liaison = create_liaison_agent(
        mcp_server_params=stdio_params(agent_name="company-crew"),
        llm=my_llm,
    )

    researcher = Agent(role="Researcher", ...)
    writer = Agent(role="Writer", ...)

    crew = Crew(agents=[researcher, writer, liaison], tasks=[...])
    crew.kickoff()

See the package README and `examples/` for full recipes.
"""
from .liaison import (
    create_liaison_agent,
    liaison_tools,
    AimeatLiaisonError,
)
from .mcp_client import (
    stdio_params,
    http_params,
    sse_params,
)

__version__ = "0.2.2"

__all__ = [
    "__version__",
    "create_liaison_agent",
    "liaison_tools",
    "AimeatLiaisonError",
    "stdio_params",
    "http_params",
    "sse_params",
]
