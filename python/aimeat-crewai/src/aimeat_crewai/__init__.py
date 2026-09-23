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
from .daemon import (
    DAEMON_DEFAULT_TOOL_FILTER,
    BuildCrewCallback,
    InvokeHandler,
    run_crew_daemon,
    run_invoke_listener,
)
from .datapackage import (
    AimeatPackageError,
    DataPackage,
    QualityGateRefused,
    package_versions,
    publish_package,
    read_package,
    rows_of,
    to_dataframe,
    to_parquet,
)

# NOTE, because the AttributeError it causes names nothing useful: the function `decide` below
# SHADOWS the submodule `aimeat_crewai.decide` on this package object. `from aimeat_crewai import
# decide` and `from aimeat_crewai.decide import rules` both do what they look like; but
# `import aimeat_crewai.decide as m` binds the FUNCTION, so `m.rules` raises. Reach the module with
# `importlib.import_module("aimeat_crewai.decide")` when you need it by name (a test patching it,
# say). Renaming either one would be the alternative, and both names are the right ones.
from .decide import (
    DIRECT_ENV as DECIDE_DIRECT_ENV,
)
from .decide import (
    STATS_GROUPS,
    DecideError,
    DecideRefused,
    DecideUnreachable,
    Decision,
    GateVerdict,
    decide,
    decision_stats,
    decisions,
    direct_enabled,
    evaluate_rule,
    gate,
    pick_one,
    push_direct_log,
    read_direct_log,
    review,
    rule,
    rule_tools_data,
    rules,
    scale,
    settings,
    yes_no,
)
from .decide_tool import decide_tools, parse_selector, rule_tool_name, run_rule
from .files import (
    AimeatFileError,
    attachments_of,
    delegate_file,
    file_handle,
    inbox_files,
    read_file,
    split_ref,
    task_files,
    upload_file,
)
from .liaison import (
    AimeatLiaisonError,
    create_liaison_agent,
    liaison_tools,
)
from .mcp_client import (
    AimeatServeError,
    ensure_serve,
    http_params,
    serve_params,
    sse_params,
    stdio_params,
)
from .messaging import (
    AimeatMessagingError,
    ServeClient,
    answers_from_dm,
    ask,
    build_question,
    read_answers,
    serve_client,
)
from .offers import (
    OfferValidationError,
    build_offer,
    build_offers_doc,
    publish_offers,
    resolve_agent_token,
    validate_offers_doc,
)
from .offers_tool import offers_check, offers_publish, offers_tools
from .onboarding import (
    ONBOARDING_CONFIRM_TOOLS,
    OnboardingError,
    run_hello_integration,
)
from .provenance import (
    SPEC as PROVENANCE_SPEC,
)
from .provenance import (
    HumanInvolvement,
    Level,
    Method,
    declare,
    is_model_written,
    read_provenance,
    source,
)
from .usage_telemetry import (
    build_llm_call_payload,
    install_usage_telemetry,
    usage_run,
)
from .workflow_spec import (
    NONE,
    Sig,
    SignalError,
    assess_offer,
    assess_offers_doc,
    is_workflow_compatible,
    validate_signal,
)

# Kept in step with pyproject BY HAND, which is why it was wrong: 0.20.0 shipped announcing
# itself as 0.19.0, and the first crew to install it reported the mismatch before we saw it.
__version__ = "0.28.0"

__all__ = [  # noqa: RUF022 -- grouped by topic with the version each group arrived in; alphabetical order would scatter those comments away from what they name
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
    # Server-initiated invokes — the Crew tab's Validate and Try (0.22.0)
    "run_invoke_listener",
    "InvokeHandler",
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
    # Decision rules — the owner's questions, thresholds and bands, as tools (0.27.0).
    # The QUESTIONS, THRESHOLDS AND BANDS ARE THE OWNER'S: a caller that names a rule sends only
    # the state, and there is deliberately no export here for overriding any of the three.
    "yes_no",
    "pick_one",
    "scale",
    "decide",
    "rules",
    "rule",
    "rule_tools_data",
    "decisions",
    # The quality numbers thresholds are tuned from, counted in the store (0.27.1)
    "decision_stats",
    "STATS_GROUPS",
    "review",
    "settings",
    "gate",
    "GateVerdict",
    "evaluate_rule",
    "Decision",
    "DecideError",
    "DecideRefused",
    "DecideUnreachable",
    # One CrewAI tool per allowed rule; the crew JSON selects `decide` or `decide:<rule>`
    "decide_tools",
    "run_rule",
    "rule_tool_name",
    "parse_selector",
    # Direct mode — a run with no node, behind an explicit switch, keeping a local log
    "DECIDE_DIRECT_ENV",
    "direct_enabled",
    "read_direct_log",
    "push_direct_log",
    # Files: getting a document to and from an agent (0.17.0)
    "AimeatFileError",
    "split_ref",
    "file_handle",
    "read_file",
    "upload_file",
    "attachments_of",
    "inbox_files",
    "task_files",
    "delegate_file",
    # Data packages (0.20.0): read one correctly, publish one from a crew
    "AimeatPackageError",
    "QualityGateRefused",
    "DataPackage",
    "read_package",
    "package_versions",
    "to_dataframe",
    "rows_of",
    "publish_package",
    "to_parquet",
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
    # AI provenance — declare how content was made, read how it was made (0.18.0).
    # `declare(provider=...)` — who SERVED the model — is 0.19.0; pin >=0.19.0 to call it, because
    # on 0.18.0 it raises TypeError. Mirrors the node contract; the NODE SCHEMA WINS on any mismatch.
    "PROVENANCE_SPEC",
    "Level",
    "Method",
    "HumanInvolvement",
    "declare",
    "source",
    "read_provenance",
    "is_model_written",
]
