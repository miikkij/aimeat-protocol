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
    serve_params,
    ensure_serve,
    AimeatServeError,
)
from .daemon import (
    run_crew_daemon,
    BuildCrewCallback,
    DAEMON_DEFAULT_TOOL_FILTER,
)
from .workflow_spec import (
    Sig,
    NONE,
    SignalError,
    validate_signal,
    assess_offer,
    assess_offers_doc,
    is_workflow_compatible,
)
from .offers import (
    build_offer,
    build_offers_doc,
    validate_offers_doc,
    publish_offers,
    resolve_agent_token,
    OfferValidationError,
)
from .offers_tool import offers_check, offers_publish, offers_tools
from .onboarding import (
    run_hello_integration,
    OnboardingError,
    ONBOARDING_CONFIRM_TOOLS,
)
from .messaging import (
    ServeClient,
    serve_client,
    build_question,
    ask,
    read_answers,
    answers_from_dm,
    AimeatMessagingError,
)
from .usage_telemetry import (
    install_usage_telemetry,
    usage_run,
    build_llm_call_payload,
)

__version__ = "0.16.5"

__all__ = [
    "__version__",
    "create_liaison_agent",
    "liaison_tools",
    "AimeatLiaisonError",
    "AimeatServeError",
    "stdio_params",
    "http_params",
    "sse_params",
    "serve_params",
    "ensure_serve",
    "run_crew_daemon",
    "BuildCrewCallback",
    "DAEMON_DEFAULT_TOOL_FILTER",
    # Offers + workflow-compatibility (0.5.0)
    "Sig",
    "NONE",
    "SignalError",
    "validate_signal",
    "assess_offer",
    "assess_offers_doc",
    "is_workflow_compatible",
    "build_offer",
    "build_offers_doc",
    "validate_offers_doc",
    "publish_offers",
    "resolve_agent_token",
    "OfferValidationError",
    "offers_check",
    "offers_publish",
    "offers_tools",
    # Deterministic Hello Integration driver (0.12.0)
    "run_hello_integration",
    "OnboardingError",
    "ONBOARDING_CONFIRM_TOOLS",
    # Interactive messages — federated AskUserQuestion (0.9.0)
    "ServeClient",
    "serve_client",
    "build_question",
    "ask",
    "read_answers",
    "answers_from_dm",
    "AimeatMessagingError",
    # Usage telemetry — per-LLM-call -> node ledger (0.16.0)
    "install_usage_telemetry",
    "usage_run",
    "build_llm_call_payload",
]
