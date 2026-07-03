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
from pathlib import Path
from typing import Any, Iterable, Iterator

from .offers_tool import offers_tools
from .paths import aimeat_home

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


# Tool whose per-todo `title` some models omit -- see _install_propose_todos_repair.
_PROPOSE_TODOS_TOOL = "aimeat_task_propose_todos"

# Titles on the AIMEAT side are a short human-readable label; the full text lives
# in the todo's `description`. When we synthesise a title from a description we
# only keep the first meaningful line, trimmed to this many characters.
_DERIVED_TITLE_MAXLEN = 80


def _derive_todo_title(description: Any) -> str:
    """
    Synthesise a short TODO title from its description text.

    Some models (observed with GLM 5.2) emit `aimeat_task_propose_todos` entries
    that carry only a `description` and omit the REQUIRED `title`. Rather than
    let that trip validation and send the model into a retry loop, we derive a
    title from the description: first non-blank line, whitespace collapsed,
    trimmed to a sensible length at a word boundary. The description is left
    untouched. Returns "" when there is nothing to derive from -- an empty
    string still satisfies the schema (`z.string()` accepts "") and is far
    better than a validation failure the model will just repeat.
    """
    if not isinstance(description, str):
        return ""
    line = next((ln.strip() for ln in description.splitlines() if ln.strip()), "")
    if len(line) <= _DERIVED_TITLE_MAXLEN:
        return line
    clipped = line[:_DERIVED_TITLE_MAXLEN].rstrip()
    if " " in clipped:
        clipped = clipped[: clipped.rfind(" ")].rstrip()
    return clipped + "…"  # ellipsis


def _repair_propose_todos_input(raw: Any) -> Any:
    """
    Fill a missing/blank `title` on each proposed TODO from its `description`.

    The AIMEAT node requires `title` on every todo (`z.string()`); `description`
    is optional. When a model produces `{"description": "..."}` with no title,
    BOTH the client-side pydantic args_schema AND the server reject it, and
    CrewAI re-prompts the same agent -- which repeats the same mistake until
    max_iter (the runaway this repair exists to kill). We normalise the payload
    BEFORE validation so a real, present title reaches both layers.

    Only dict payloads shaped like the propose_todos args are touched, and only
    todos with an absent/blank title; anything else is returned unchanged so
    genuinely malformed calls still surface as validation errors instead of
    being silently "fixed". Never mutates the caller's objects.
    """
    if not isinstance(raw, dict):
        return raw
    todos = raw.get("todos")
    if not isinstance(todos, list):
        return raw
    repaired_todos: list[Any] = []
    changed = False
    for todo in todos:
        if not isinstance(todo, dict):
            repaired_todos.append(todo)
            continue
        title = todo.get("title")
        if isinstance(title, str) and title.strip():
            repaired_todos.append(todo)
            continue
        new_todo = dict(todo)
        new_todo["title"] = _derive_todo_title(todo.get("description", ""))
        repaired_todos.append(new_todo)
        changed = True
    if not changed:
        return raw
    patched = dict(raw)
    patched["todos"] = repaired_todos
    return patched


def _install_propose_todos_repair(tool: Any) -> None:
    """
    Make `tool`'s args_schema repair propose_todos payloads before validating.

    Both tool-execution paths in this CrewAI version validate incoming args via
    `args_schema.model_validate(raw)` -- CrewStructuredTool._parse_args and
    BaseTool._validate_kwargs -- and both share the SAME args_schema object
    (to_structured_tool() copies it by reference). Subclassing that schema with
    a `model_validate` that pre-repairs is therefore the single choke point that
    covers every execution path, and it repairs BEFORE validation so the derived
    title satisfies both the client pydantic model and the server's zod schema.
    """
    schema = getattr(tool, "args_schema", None)
    if not isinstance(schema, type):
        return

    class _RepairingProposeTodosSchema(schema):  # type: ignore[valid-type,misc]
        @classmethod
        def model_validate(cls, obj: Any, *args: Any, **kwargs: Any) -> Any:
            return super().model_validate(_repair_propose_todos_input(obj), *args, **kwargs)

    # Keep the original name so validation-error messages and the generated tool
    # description read identically to the unpatched schema.
    _RepairingProposeTodosSchema.__name__ = getattr(schema, "__name__", "ProposeTodosArgs")
    _RepairingProposeTodosSchema.__qualname__ = _RepairingProposeTodosSchema.__name__
    try:
        tool.args_schema = _RepairingProposeTodosSchema
    except Exception:  # pragma: no cover -- defensive; never break tool wiring
        pass


def _install_agent_name_default(tool: Any, agent_name: str) -> None:
    """
    Default a tool's `agent_name` arg to THIS liaison's agent when the caller leaves it blank.

    A SHARED ``aimeat connect serve`` daemon fronts every agent in a fleet; each aimeat_* tool routes
    by its ``agent_name`` parameter and FALLS BACK to the daemon's PRIMARY agent when it is absent. A
    caller that omits agent_name -- the deterministic Hello Integration driver, or any raw liaison tool
    call -- therefore reads/writes the WRONG agent: e.g. ``aimeat_onboarding_status`` returns the
    primary's completed 7/7, so the driver concludes "done" and never drives THIS agent's steps, and it
    stalls at its auto-passed steps. (Proven: same tool with/without agent_name returns 4/7 vs 7/7.)

    Inject agent_name BEFORE validation (so the None-strip in _strip_none_kwargs can't drop it), only
    for tools whose schema actually declares agent_name, and only when the caller left it blank -- an
    explicit agent_name always wins. Same single-choke-point trick as _install_propose_todos_repair.
    """
    schema = getattr(tool, "args_schema", None)
    if not isinstance(schema, type):
        return
    if "agent_name" not in getattr(schema, "model_fields", {}):
        return  # this tool does not route by agent_name -- nothing to default

    class _AgentNameDefaultedSchema(schema):  # type: ignore[valid-type,misc]
        @classmethod
        def model_validate(cls, obj: Any, *args: Any, **kwargs: Any) -> Any:
            if isinstance(obj, dict) and not obj.get("agent_name"):
                obj = {**obj, "agent_name": agent_name}
            return super().model_validate(obj, *args, **kwargs)

    _AgentNameDefaultedSchema.__name__ = getattr(schema, "__name__", "Args")
    _AgentNameDefaultedSchema.__qualname__ = _AgentNameDefaultedSchema.__name__
    try:
        tool.args_schema = _AgentNameDefaultedSchema
    except Exception:  # pragma: no cover -- defensive; never break tool wiring
        pass


def _strip_none_kwargs(tool: Any) -> Any:
    """
    Wrap a CrewAI tool so its `_run` filters out kwargs where the value is None
    before passing them through to the underlying MCP call.

    Why this exists: When the LLM correctly OMITS an optional parameter
    (e.g. `tags`, `ttl_hours`, `module`), the crewai-tools / mcpadapt layer
    still materialises the args as a Pydantic model with field defaults of
    `None`. JSON serialisation then turns those into explicit `null` values
    in the MCP request payload. The AIMEAT server uses zod `.optional()` which
    matches `undefined` and absent fields -- NOT `null` -- so it rejects the
    request with "expected string, received null". Persona instructions to
    "omit instead of null" don't help: the LLM did omit, but Python re-added.

    The fix is to intercept after the LLM's call reaches the Python tool but
    before the request hits MCP transport, and drop any kwargs whose value is
    None. The kwarg simply won't be in the payload, which is what the LLM
    intended and what zod `.optional()` accepts. Real None values that the
    caller MEANT to pass cannot be distinguished here from default-Nones, but
    AIMEAT's MCP surface has no field where explicit null is meaningful
    (every optional is "if present, validate; otherwise skip"), so this is
    safe in practice.
    """
    # CrewAI tools expose `_run(self, **kwargs)` as the inner entry point that
    # MCPServerAdapter overrides to forward to the MCP transport. We replace
    # it with a closure that filters and delegates.
    original_run = tool._run

    def wrapped_run(*args: Any, **kwargs: Any) -> Any:
        clean = {k: v for k, v in kwargs.items() if v is not None}
        return original_run(*args, **clean)

    tool._run = wrapped_run

    # Disable CrewAI's cache for AIMEAT tools. CrewAI defaults to caching
    # every tool result by (tool_name, args) and only the agent itself can
    # opt out per-tool. That default is correct for pure, idempotent tools
    # (a calculator) but wrong for every category AIMEAT exposes:
    #   - Time-varying reads (aimeat_onboarding_status, aimeat_task_list,
    #     aimeat_memory_list, aimeat_message_inbox) return different data on
    #     identical args as the world progresses. With cache on, the liaison
    #     calls onboarding_status, sees "all pending", marks a step passed
    #     server-side, calls onboarding_status again -- and gets the CACHED
    #     "all pending" back forever, never observes its own progress, and
    #     loops until max_iter.
    #   - Side-effecting writes (aimeat_memory_write, aimeat_task_complete,
    #     aimeat_*_set) should always reach the server.
    # Caching is therefore wrong on every axis for this tool surface.
    try:
        tool.cache_function = lambda *_args, **_kwargs: False
    except Exception:  # pragma: no cover -- defensive; CrewAI may rename later
        pass

    # Tool-specific argument normalisation. aimeat_task_propose_todos requires a
    # `title` on every todo; some models omit it and loop on the rejection until
    # max_iter. Repair the payload before validation so the call succeeds once.
    if getattr(tool, "name", None) == _PROPOSE_TODOS_TOOL:
        _install_propose_todos_repair(tool)

    return tool


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
    "happening. Your scope is AIMEAT coordination -- the other crew members "
    "handle the domain work."
)

# Slim backstory used when the AIMEAT skill bundle has been loaded as a CrewAI
# Skill (default since 0.2.0). The detailed operational guidance lives in the
# skill's SKILL.md, which the LLM reads through CrewAI's progressive-disclosure
# mechanism -- duplicating it in the backstory would just waste tokens and risk
# the two sources of truth drifting apart.
SLIM_BACKSTORY_TEMPLATE = """\
You are the AIMEAT liaison for this CrewAI crew. AIMEAT is an open protocol
for AI agent infrastructure (https://aimeat.io). Your registered agent name
on the AIMEAT node is "{agent_name}".

You have access to the AIMEAT MCP tool surface (aimeat_*) and to the
"{agent_name}" Skill (loaded from the node's skill bundle). The Skill contains
the full operational manual -- consult it for handshake sequences, tool
semantics, deliverable conventions, and module-specific guidance.

Calling conventions for AIMEAT tools:

- Always pass "{agent_name}" as the `agent_name` parameter when a tool
  accepts one. This value comes from your registered identity above.

- For `aimeat_onboarding_identify_platform` and
  `aimeat_onboarding_confirm_skill_installed`, use platform="crewai" --
  that is your runtime. (The `aimeat_runtime: generic` value visible in
  skill metadata refers to the bundle adapter; your runtime is `crewai`.)

- Onboarding has ONLY five `aimeat_onboarding_*` tools: status,
  identify_platform, confirm_skill_installed, confirm_directives_read,
  declare_services. There is NO `aimeat_onboarding_<stepId>` tool for any
  other step -- never construct one. `aimeat_onboarding_status` returns a
  `step_guide` and a `howTo` on each step: for any pending step call the tool
  named in its `howTo.tool` with `howTo.args` (e.g. send_test_message ->
  `aimeat_message_send`, report_capabilities -> `aimeat_agent_capabilities_report`,
  report_telemetry -> `aimeat_agent_telemetry_report`, publish_commands /
  publish_config -> `aimeat_memory_write`). Skip steps whose `howTo.tool` is
  null (e.g. configure_delivery) -- the server passes those once you are active.
  Stop as soon as `summary.completable` is true.

- For `aimeat_memory_write` to publish runtime config, use the literal key
  `agents.config.{agent_name}.runtime`. The agent-name segment is what the
  publish_config validator looks for.

- Trust every success response. When any aimeat_onboarding_*, aimeat_task_*,
  or aimeat_memory_* call returns success, the operation is final on the
  server. Advance directly to the next pending item using your original
  snapshot. One success response is enough for the entire onboarding and
  task lifecycle.

- Pass only the parameters you actually need; optional ones default cleanly.

- On AUTH_REQUIRED: report the response verbatim in your task output so the
  operator can investigate the connector token wiring.

- On STEP_NOT_IN_FLOW or INVALID_STEP for an onboarding step: that step is
  outside your agent's reduced flow. Treat the response as a successful
  no-op and advance to the next pending step.

Completing the onboarding test task (and the canonical task lifecycle):

1. Call `aimeat_task_propose_todos` ONCE with your TODO plan.
2. Wait for the owner to approve -- the task transitions to 'active'.
   For task-runner mode agents the server auto-activates, so this
   happens immediately and you can proceed to step 3 in the same cycle.
3. Mark each TODO 'done' with `aimeat_task_todo` (one call per TODO)
   as the work completes.
4. Call `aimeat_task_complete` ONCE with the task id.

`aimeat_task_complete` is the final action OF THE TEST TASK. It satisfies the
onboarding step `complete_test_task` AND fulfils any TODO whose verification is
"task status is completed" -- one call covers both. The test task is NOT the
end of Hello Integration: after it succeeds, call `aimeat_onboarding_status`
again and complete `summary.next_required_step` via its `howTo.tool` until
`summary.completable` is true. The optional offers-ladder steps below
(declare_offerings / make_workflow_compatible / price_offer) never block
completion -- publish them only if you actually intend to.

When a task comes back in status 'revision_requested':

The owner saw your proposed TODOs and asked for a different plan. The
change request is delivered both as an inbound message (visible via
`aimeat_message_inbox` with linked_task_id set to that task) and as a
task event of type 'revision_requested'. Read the owner's message,
then call `aimeat_task_propose_todos` again with the revised plan. The
server preserves your prior proposal as 'outdated' history and flips
the task back to 'queued' for the owner to review again.

Publishing your command catalogue (onboarding step `publish_commands`):

Register the owner-facing slash commands this crew actually understands by
writing memory key `agents.{agent_name}.commands` with `aimeat_memory_write`
(visibility="owner"). The value MUST be a non-empty flat array of
`{{ "name", "description", "category" }}` objects, each name starting with "/".
List the real commands the owner can send you in AIMEAT Messages -- not the
aimeat_* MCP tool names, and never an empty array to silence the check. This
step is REQUIRED for an interactive crew: onboarding stays incomplete until it
passes. (If your crew genuinely has no command surface -- a pure task-runner --
the step is outside your reduced flow and returns STEP_NOT_IN_FLOW; treat that
as a no-op and move on.)

Publishing offers (make the crew legible, chainable, optionally sellable):

An offer is what this crew can do, published to memory key
`agents.{agent_name}.offers`. It makes the crew findable in the owner's Offers
surface, lets the mesh pick it, and lets a workflow step inherit its signals.
Three optional, additive levels (full spec:
docs/building-an-aimeat-compatible-agent.md; GET /v1/prompts/draft-offer for a
guided template; GET /v1/agents/me/handbook/offerings for the how-to):
- offering: id + title + ask (incl. what it does NOT do).
- workflow-compatible: + success_signal (output OK) + required_to_function
  (input needed, or "none" for a source) + deliverable.location (a STABLE key).
- priced: + price + visibility:"public" + callable (sell to other owners).
You hold two local tools for this: call `aimeat_offers_check` to validate a
draft offers document offline (it reports which levels each offer reaches and
what is missing), then `aimeat_offers_publish` (pass the document + your agent
name) to write it to `agents.{agent_name}.offers`. Publish at least one offer
at the workflow-compatible level so this crew can be chained as a workflow step;
add price + public visibility + callable ONLY if you actually intend to sell it
(most crews skip pricing). Your onboarding declare_offerings /
make_workflow_compatible / price_offer steps auto-tick once your published
offers satisfy each level.

You speak to AIMEAT on the crew's behalf. The other crew members focus on
their domain work; you handle all AIMEAT-side coordination so they can stay
inside their domain. Your role is the AIMEAT coordinator.
"""

# Full backstory kept for installs that pass `skill_path=None` (skill bundle
# not loaded into the Skill mechanism). In that fallback mode the persona has
# to carry the operational manual itself, so it stays long.
FULL_BACKSTORY_TEMPLATE = """\
You are the liaison between this CrewAI crew and an AIMEAT node. AIMEAT
(AI Memory Exchange and Action Transfer) is an open protocol that gives every
AI agent a persistent identity, shared memory, capabilities catalog, work
queue with escrow, and federation across nodes. See https://aimeat.io for the
full spec.

YOUR AIMEAT IDENTITY: Your registered agent name on the AIMEAT node is
"{agent_name}". Whenever an AIMEAT tool accepts an `agent_name` parameter,
pass exactly "{agent_name}". This value comes from your registered identity.

You have full access to the AIMEAT MCP tool surface (aimeat_*) through this
crew's registered agent identity. The other crew members focus on their
domain work; you handle all AIMEAT-side coordination so they can stay
inside their domain.

CALLING CONVENTIONS (read before any tool call):

- Pass only the parameters you actually need. Optional parameters default
  cleanly. Example: aimeat_memory_write needs key/value/visibility for
  most use cases; leave `tags`, `ttl_hours`, `group_id` out unless you
  need them.
- For ENUM parameters (like visibility: "private"|"owner"|"public"), pick
  one explicit value.
- On AUTH_REQUIRED: report the response verbatim in your task output so
  the operator can investigate the connector token wiring.
- On INVALID_STEP or STEP_NOT_IN_FLOW for an onboarding step: that step is
  outside your agent's reduced flow. Treat the response as a successful
  no-op and advance to the next pending step.
- Trust every success response. When any aimeat_onboarding_*, aimeat_task_*,
  or aimeat_memory_* call returns success, the operation is final on the
  server. Advance directly to the next pending item using your original
  snapshot. One success response is enough for the entire onboarding +
  task lifecycle.
- Onboarding has ONLY five aimeat_onboarding_* tools: status,
  identify_platform, confirm_skill_installed, confirm_directives_read,
  declare_services. There is NO aimeat_onboarding_<stepId> tool for any other
  step -- never construct one. aimeat_onboarding_status returns a step_guide
  and a howTo on each step: for any pending step call the tool named in its
  howTo.tool with howTo.args (the per-step tools are listed in responsibility 1).
  Skip steps whose howTo.tool is null (the server passes those once you are
  active). Stop when summary.completable is true.

YOUR RESPONSIBILITIES, in priority order:

1. ON CREW STARTUP: Call aimeat_onboarding_status. Look at which steps are
   "pending". Complete those in order. Common steps for any mode:

   - aimeat_onboarding_identify_platform with platform="crewai" and
     platform_version=<the installed crewai version, see `crewai.__version__`>
   - aimeat_onboarding_confirm_skill_installed with platform="crewai" and
     version="v2" (confirm the local connector has the skill bundle; usually
     true since `aimeat connect add` does this)
   - aimeat_agent_capabilities_report with technical=[{{"name":"task_execution",
     "type":"tool"}}], domain=[<this crew's specialty>], languages=["en"]
   - aimeat_memory_write key="agents.config.{agent_name}.runtime",
     value={{"runtime":"crewai", "version":"<crewai version>"}},
     visibility="owner" -- this satisfies publish_config
   - aimeat_onboarding_confirm_directives_read AFTER first calling
     aimeat_handbook_get (empty input is fine)
   - aimeat_memory_write key="agents.{agent_name}.commands" with a non-empty
     flat array of {{"name":"/<cmd>", "description":"<what it does>",
     "category":"<group>"}} -- the owner-facing slash commands this crew can
     answer in AIMEAT Messages, NOT the aimeat_* tool names. This satisfies the
     REQUIRED publish_commands step; an empty array does not count. (A pure
     task-runner with no command surface gets STEP_NOT_IN_FLOW here -- treat as
     a no-op.)
   - PUBLISH OFFERS so this crew is findable + chainable: call
     aimeat_offers_check to validate a draft offers document, then
     aimeat_offers_publish (document + this agent name) to write
     agents.{agent_name}.offers. At minimum publish one offer at the
     workflow-compatible level (id + title + ask + success_signal +
     required_to_function + deliverable.location) -- this satisfies
     declare_offerings and make_workflow_compatible. Add price + public
     visibility + callable only if you intend to sell it (most crews skip
     price_offer; left pending it is auto-marked 'skipped' at completion).

   The test task (step 2) is NOT the end of onboarding -- after it succeeds,
   re-check aimeat_onboarding_status and complete summary.next_required_step
   via its howTo.tool until summary.completable is true. The offers above are
   optional and never block completion.

   If aimeat_onboarding_confirm_directives_read returns INVALID_STEP or
   STEP_NOT_IN_FLOW, that step is outside your flow. Advance to the next
   pending step.

2. COMPLETING THE ONBOARDING TEST TASK (canonical task lifecycle):

   a. Call aimeat_task_propose_todos ONCE with your TODO plan for the test task.
   b. Wait for the owner to approve. The task transitions to 'active' when
      approved (task-runner mode agents auto-activate, no wait needed).
   c. Mark each TODO 'done' with aimeat_task_todo (one call per TODO).
   d. Call aimeat_task_complete ONCE with the task id.

   aimeat_task_complete is the final action: it satisfies the onboarding
   step `complete_test_task` AND fulfils any TODO whose verification is
   "task status is completed" -- one call covers both. When it returns
   success, the test task is finished; advance to the next pending step
   from your original onboarding snapshot.

   If a task comes back in status 'revision_requested', the owner asked
   for a different plan. Read the change request from the linked inbox
   message (use aimeat_message_inbox; the message has linked_task_id
   set), then call aimeat_task_propose_todos again with the revised plan.
   The server keeps your prior proposal as 'outdated' history and flips
   the task back to 'queued' for owner review.

3. WHEN THE OWNER QUEUES A TASK FOR THIS CREW: Use aimeat_task_list to find
   queued tasks for "{agent_name}". Read the prompt from the task. Pass it
   to the crew's domain work. When the crew produces a deliverable, follow
   the same propose-todos -> (revise if asked) -> wait-for-active ->
   mark-todos-done -> task_complete lifecycle from step 2.

4. WHEN THE CREW HAS A DELIVERABLE: Decide whether it is private working
   state (aimeat_memory_write) or public/shared knowledge worth publishing
   to the catalogue (aimeat_knowledge_contribute). Default to memory unless
   the deliverable is something other agents would benefit from.

5. PERIODICALLY: Call aimeat_agent_telemetry_report with type="agent_report"
   and data describing your latest activity so the owner sees usage.

6. WHEN ASKED WHAT EXISTS / WHERE TO FIND SOMETHING: reach for
   aimeat_discover FIRST -- the master directory. One faceted query spans
   every domain (capabilities, workflows, knowledge, decisions, research,
   produced material, companies + offerings, documents, apps, memory).
   Use mode="map" for a cheap catalog-of-catalogs (counts by type/tag) to
   see WHAT exists before pulling content, then mode="find" with q / type /
   tags to get ranked entries. scope: "own" (default), "public", or
   "shared". Fall back to the per-domain tools (aimeat_memory_read /
   aimeat_memory_list / aimeat_knowledge_get / aimeat_message_inbox /
   aimeat_catalogue_search) only when you already know the exact domain.

Your scope is AIMEAT coordination. Other crew members handle the domain
work. You speak to AIMEAT on the crew's behalf, and the crew speaks to
the world through their own tools.
"""

# Kept as the 0.1.x-era default for backwards compat. 0.2.0+ chooses between
# SLIM_BACKSTORY_TEMPLATE (when skill bundle loaded) and FULL_BACKSTORY_TEMPLATE
# (fallback) automatically based on whether skill_path resolves to a real file.
DEFAULT_BACKSTORY_TEMPLATE = FULL_BACKSTORY_TEMPLATE

# Backwards-compat alias: code that imported DEFAULT_BACKSTORY in 0.1.0
# still works, but the {agent_name} placeholder will leak through unless they
# format() it. Most users should pass `agent_name` to create_liaison_agent
# instead and let the factory format the template.
DEFAULT_BACKSTORY = DEFAULT_BACKSTORY_TEMPLATE.replace("{agent_name}", "<your-aimeat-agent-name>")


def _resolve_skill_path(agent_name: str | None) -> Path | None:
    """
    Auto-detect where the AIMEAT connector dropped the agent's skill bundle.

    By convention `aimeat connect add --agent <name>` extracts the bundle into
    `~/.aimeat/<agent_name>/` with `SKILL.md` at its root. CrewAI's Skills
    loader treats the parent directory containing a SKILL.md file as a single
    Skill, so we return the path to the AGENT directory (not the SKILL.md
    file itself). Passing this path to `Agent(skills=[path])` makes CrewAI
    load the bundle as a first-class skill named after the agent.

    Returns None if the conventional path doesn't exist -- either the
    connector hasn't run for this agent, the user has a custom AIMEAT config
    dir, or HTTP transport is in use (no local bundle). The caller falls
    back to the longer persona that contains the operational manual inline.

    Args:
        agent_name: The AIMEAT agent name. If None, we can't guess where to
            look; returns None.

    Returns:
        Path to the agent's bundle directory if SKILL.md exists, else None.
    """
    if not agent_name:
        return None

    # Same precedence the connector uses: AIMEAT_HOME env var wins, else
    # <cwd>/.aimeat. Single source of truth in paths.aimeat_home().
    candidate = aimeat_home() / agent_name
    skill_md = candidate / "SKILL.md"
    return candidate if skill_md.is_file() else None


def _extract_agent_name_from_params(mcp_server_params: Any) -> str | None:
    """
    Pull the agent name out of an stdio_params() result so we can inject it
    into the persona without making the caller pass it twice. Returns None
    for HTTP/SSE params -- the caller must pass `agent_name` explicitly in
    that case (HTTP transport has no `--agent` flag for us to read).
    """
    args = getattr(mcp_server_params, "args", None)
    if not isinstance(args, list):
        return None
    try:
        idx = args.index("--agent")
    except ValueError:
        return None
    if idx + 1 >= len(args):
        return None
    return args[idx + 1]


# Sentinel for the `skill_path` kwarg: lets us distinguish "user didn't pass
# it -> auto-detect" from "user explicitly disabled with None -> use fallback
# persona, no skill bundle".
_AUTO_DETECT = object()


@contextmanager
def create_liaison_agent(
    *,
    mcp_server_params: Any,
    agent_name: str | None = None,
    skill_path: Any = _AUTO_DETECT,
    llm: Any = None,
    role: str = DEFAULT_ROLE,
    goal: str = DEFAULT_GOAL,
    backstory: str | None = None,
    tool_filter: Iterable[str] | None = None,
    include_offers_tools: bool = True,
    verbose: bool = False,
    allow_delegation: bool = False,
    max_iter: int = 10,
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
            full surface the AIMEAT node exposes. The local offers tools
            (see `include_offers_tools`) are NOT subject to this filter --
            they are appended after filtering.
        include_offers_tools: When True (default), append the two local
            CrewAI offers tools (`aimeat_offers_check` / `aimeat_offers_publish`)
            to the toolset so the liaison can self-validate and publish its
            `agents.{name}.offers` document during Hello Integration (the
            declare_offerings / make_workflow_compatible / price_offer steps).
            These run offline + over REST; they are not MCP tools, so a
            `tool_filter` never strips them. Set False to omit them.
        verbose: Pass through to crewai.Agent for verbose logging.
        allow_delegation: Pass through to crewai.Agent. Default False because
            the liaison's role is narrow.
        max_iter: Hard ceiling on the agent's reasoning iterations, forwarded to
            crewai.Agent. Defaults to 10 -- well below CrewAI's own default of
            25 (widely regarded as too high, since every iteration re-sends the
            accumulated context, so a runaway costs 5-10x). This is a bounded
            backstop, not headroom: the per-tool argument repair (e.g.
            propose_todos title backfill) is the primary loop preventer, so the
            cap only needs to stop pathological loops cheaply. 10 comfortably
            covers a deterministic-driver Hello Integration (where this agent's
            LLM is barely used). If you run the liaison as a PURE model-driven
            agent that walks a full onboarding + task lifecycle in one task
            (~15-18 sequential tool calls), raise this accordingly. Note it only
            caps agents built by THIS factory; a crew that attaches AIMEAT tools
            to its own agents via `liaison_tools()` sets max_iter on those
            agents itself.
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

    # Resolve agent_name: explicit kwarg wins; otherwise try to read it from
    # stdio_params (--agent flag). HTTP/SSE callers must pass it explicitly.
    if agent_name is None:
        agent_name = _extract_agent_name_from_params(mcp_server_params)

    # Resolve skill_path:
    #   _AUTO_DETECT (default) -> look in ~/.aimeat/<agent_name>/SKILL.md
    #   None                   -> explicit "don't load a skill" (fallback persona)
    #   str / Path             -> use as-is
    resolved_skill_path: Path | None
    if skill_path is _AUTO_DETECT:
        resolved_skill_path = _resolve_skill_path(agent_name)
    elif skill_path is None:
        resolved_skill_path = None
    else:
        resolved_skill_path = Path(skill_path)
        if not (resolved_skill_path / "SKILL.md").is_file():
            # Be strict on explicit paths so typos / wrong dirs surface early.
            raise AimeatLiaisonError(
                f"skill_path {resolved_skill_path} does not contain a SKILL.md file. "
                f"Pass the directory that holds SKILL.md, not the SKILL.md file itself."
            )

    # Build the final backstory. If caller provided one, use it verbatim
    # (assume they templated agent_name themselves if they cared). Otherwise:
    #   - skill bundle loaded   -> SLIM template (Skill carries the manual)
    #   - no skill bundle       -> FULL template (persona carries the manual)
    if backstory is None:
        template = SLIM_BACKSTORY_TEMPLATE if resolved_skill_path else FULL_BACKSTORY_TEMPLATE
        fmt_name = agent_name or "<unknown -- pass agent_name=... to create_liaison_agent>"
        backstory = template.format(agent_name=fmt_name)

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

        # Strip None-valued kwargs from each tool's _run so the LLM's correctly-
        # omitted optionals don't leak through as JSON null and trip AIMEAT's
        # zod .optional() validation. See _strip_none_kwargs docstring.
        tools = [_strip_none_kwargs(t) for t in tools]

        # Default agent_name to THIS agent on every routed tool, so a SHARED serve daemon does not
        # answer as its PRIMARY agent when a caller (the onboarding driver, a raw tool call) omits it.
        # See _install_agent_name_default. Requires the resolved agent_name.
        if agent_name:
            for t in tools:
                _install_agent_name_default(t, agent_name)

        # Append the local offers tools (offline validate + REST publish). They
        # are NOT part of the MCP surface, so the tool_filter above never reaches
        # them -- without this, the backstory's references to aimeat_offers_check
        # / aimeat_offers_publish point at tools the agent doesn't actually hold,
        # and the make_workflow_compatible / price_offer onboarding steps have no
        # way to complete. crewai is guaranteed importable here (we build an
        # Agent below), so offers_tools() will not raise.
        if include_offers_tools:
            tools.extend(offers_tools())

        agent_args: dict[str, Any] = {
            "role": role,
            "goal": goal,
            "backstory": backstory,
            "tools": tools,
            "verbose": verbose,
            "allow_delegation": allow_delegation,
            "max_iter": max_iter,
        }
        if llm is not None:
            agent_args["llm"] = llm
        if resolved_skill_path is not None:
            # CrewAI Skills entry: pre-load the bundle into a Skill object and
            # pass that. Passing the directory path as a string would make
            # CrewAI treat it as a discovery PARENT (scanning subdirs for
            # */SKILL.md) -- our bundle has SKILL.md AT THE DIRECTORY ROOT,
            # so the discovery-parent interpretation finds nothing and the
            # agent's .skills attribute ends up None. Going through
            # load_skill_metadata explicitly says "this directory IS the
            # skill" so the bundle is registered properly.
            #
            # Import lazily so the package still loads on CrewAI versions
            # that don't have Skills support (skill_path=None covers that path).
            from crewai.skills.parser import load_skill_metadata  # type: ignore[import-not-found]
            agent_args["skills"] = [load_skill_metadata(resolved_skill_path)]
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


def liaison_tools(mcp_server_params: Any, agent_name: str | None = None) -> list[Any]:
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
        agent_name: When set, every routed tool defaults its `agent_name` arg to
            this value so a SHARED `aimeat connect serve` daemon does not answer
            as its PRIMARY agent for calls that omit it (the cause of onboarding
            stalls on multi-agent fleets). Pass the agent these tools speak for.

    Returns:
        The list of tool objects discovered through the MCP adapter.
    """
    adapter = MCPServerAdapter(mcp_server_params)
    tools = [_strip_none_kwargs(t) for t in adapter.tools]
    if agent_name:
        for t in tools:
            _install_agent_name_default(t, agent_name)
    return tools
