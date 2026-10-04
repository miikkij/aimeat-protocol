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

Changelog:
  0.32.1 -- 2026-10-04 -- An optional field the model left out is no longer sent as null inside a
    list item. CrewAI's MCP tool adapter gives every optional field the default None, nested ones
    included, and the top-level None strip did not reach them, so the node refused a todo with
    "expected string, received null at todos[0].description" (crewfive, 73176d1). Each tool's
    validated arguments are now dumped with exclude_unset, at every depth. The daemon's default tool
    list carries aimeat_task_decline (node: POST /v1/agents/:name/tasks/:id/decline), so a crew that
    refuses a request with its reason ends the task as declined, not failed.
  0.32.0 -- 2026-10-02 -- A crew can think through the node with the owner's own key. `llm_for_choice`
    builds the LLM for the owner's `{kind:'node', role?}` crew choice (crews.llm.<agent>) with
    `node_llm`, and `unsafe_choice_reason` applies the node's guard to a `model` choice on read (the
    key variable must be a provider key, every address public https). `node_llm` finds the token the
    hosted fleet writes (tokens/<agent>@<owner>.token) and the node address in the connector home's
    config.yaml, and an agent with no stored token (a key-based agent) goes through the connector
    daemon's /v1/llm pass-through, which attaches its current credential. `effective_llm_choice` reads
    the choice that applies, as the node decides it (GET /v1/agents/{name}/crew/llm): the agent's own,
    the owner's default, the node when the agent has ai:use and the node can pay, else None.
  0.31.1 -- 2026-09-30 -- The liaison's backstory (slim and full) says what to do with classified
    content: a `classification_warning` is said to the person and the content is not repeated
    outward, a CLASSIFIED refusal is not retried, and an exception is the person's own step in their
    Data Wallet, not the crew's.
  0.31.0 -- 2026-09-30 -- A task run the node refused is no longer reported as a success. After each
    kickoff the daemon asks the node for this agent's refusals since the run started; a refusal
    raises `NodeRefusedDuringRun` (exported), which reaches `on_error` and fails an EXECUTE task with
    the call and the permission named. A refused PROPOSE is not retried.
  0.30.1 -- 2026-09-28 -- `node_llm(role=...)` runs the crew's calls as one of the owner's AI roles
    (GET /v1/ai/roles): the role is sent in the X-AIMEAT-AI-Role header on every call, on both
    CrewAI code paths, and the owner's role names the providers and models.
  0.30.0 -- 2026-09-28 -- `node_llm()` returns a CrewAI LLM that calls the node's /v1/llm route with
    the agent's token, so the owner's model policy, key order and budget apply to the crew's calls;
    `capabilities()` reads GET /v1/ai/capabilities (what is on, which model, and why one is off).
  0.29.0 -- 2026-09-24 -- `serve_auth_headers` is exported: the header carrying the serve daemon's
    per-start secret, for a client that builds its own session against the daemon.
"""
from .ai import (
    CAPABILITIES as AI_CAPABILITIES,
)
from .ai import (
    NODE_CHOOSES_MODEL,
    AiError,
    AiRefused,
    AiUnreachable,
    capabilities,
    node_llm,
)
from .crew_llm import (
    effective_llm_choice,
    is_node_choice,
    llm_for_choice,
    unsafe_choice_reason,
)
from .daemon import (
    DAEMON_DEFAULT_TOOL_FILTER,
    BuildCrewCallback,
    InvokeHandler,
    NodeRefusedDuringRun,
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
    serve_auth_headers,
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
__version__ = "0.32.1"

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
    # The serve daemon's per-start secret, for a client that builds its own session (0.29.0)
    "serve_auth_headers",
    "run_crew_daemon",
    "BuildCrewCallback",
    "DAEMON_DEFAULT_TOOL_FILTER",
    # What `on_error` receives when the node refused a run's calls for a missing permission (0.31.0)
    "NodeRefusedDuringRun",
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
    # The node's AI for a crew (0.30.0): an LLM on the node's /v1/llm route, and what is on
    "node_llm",
    "capabilities",
    # The owner's crew model choice, read safely (0.32.0)
    "llm_for_choice",
    "effective_llm_choice",
    "is_node_choice",
    "unsafe_choice_reason",
    "NODE_CHOOSES_MODEL",
    "AI_CAPABILITIES",
    "AiError",
    "AiRefused",
    "AiUnreachable",
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
