"""
Long-running crew daemon: keeps the liaison alive, polls AIMEAT for queued
tasks (and optionally inbox messages), kicks off the crew for each, and lets
the liaison report results back to AIMEAT.

This is the second half of the AIMEAT-CrewAI integration story:
  - `create_liaison_agent` (one-shot): proves a single crew invocation can do
    Hello Integration + AIMEAT-side coordination. Useful for testing.
  - `run_crew_daemon` (always-on): keeps a Python process alive that listens
    for AIMEAT tasks/messages and runs the crew per arrival. This is what
    turns a CrewAI crew into a citizen of an AIMEAT network -- other agents
    (Claude Desktop, Hermes, another crew) can queue tasks for it via the
    `aimeat_task_create` MCP tool (AIMEAT >= 1.14.0), and the daemon picks
    them up automatically.

Changelog:
  0.3.6 -- Fix inbox message dispatch. _poll_messages() read the non-existent
    data.messages key (the node returns data.pending_messages / data.items), so
    message-triggered crews never ran. Also: inbox items carry only a ~100-char
    preview, so we now fetch full content per message via
    GET /v1/agents/<agent>/messages?thread_id=, and PATCH the message to
    status=delivered after a successful kickoff so it is not re-dispatched every
    poll cycle (plus a process-local done_ids guard).

Usage:

    from aimeat_crewai import run_crew_daemon, stdio_params
    from crewai import Agent, Crew, Task

    def build_crew_for_task(task, liaison):
        researcher = Agent(role="Researcher", goal="...", backstory="...")
        writer     = Agent(role="Writer",     goal="...", backstory="...")
        return Crew(
            agents=[liaison, researcher, writer],
            tasks=[
                Task(description=task["description"], agent=researcher),
                Task(description="Write up the research as a summary.", agent=writer),
                Task(
                    description=(
                        f"Mark AIMEAT task {task['id']} complete with the writer's "
                        f"output as the deliverable. Use aimeat_task_complete."
                    ),
                    agent=liaison,
                ),
            ],
        )

    run_crew_daemon(
        agent_name="demo-crew",
        build_crew=build_crew_for_task,
    )

Wrap the invocation in your favourite supervisor (systemd, pm2, a small Bash
loop) to restart on crash. The daemon itself does NOT manage its own
restart -- that is intentionally the supervisor's job, and a thrash-detector
in the supervisor should prevent crash loops.
"""
from __future__ import annotations

import os
import signal
import time
from pathlib import Path
from typing import Any, Callable, Iterable

from .liaison import create_liaison_agent, AimeatLiaisonError
from .mcp_client import stdio_params

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `requests` package is required for the daemon. Install: pip install requests"
    ) from exc


def _read_token(agent_name: str, owner: str | None = None) -> tuple[str, str]:
    """
    Locate the agent's stored token + node URL from the connector's layout.

    The connector (`aimeat connect add`) writes:
      ~/.aimeat/tokens/{agent}@{owner}.token      -- bearer token (mode 0600)
      ~/.aimeat/agents/{agent}/config.yaml        -- per-agent config (incl. node_url)

    Earlier versions of this helper looked at `~/.aimeat/<agent>/.token` which
    is the SKILL-BUNDLE directory, not the keychain. That layout never matched
    a real connector install, so the daemon could never start. This rewrite
    uses the actual keychain + per-agent config paths.

    If `owner` is provided, looks for `tokens/{agent}@{owner}.token` directly.
    Otherwise globs `tokens/{agent}@*.token` and uses the single match. Errors
    if zero matches or more than one (the latter means the agent name is
    ambiguous and the caller must pass `owner`).

    Returns (token, node_url).
    """
    import glob

    home_dir = Path(os.environ.get("AIMEAT_HOME") or (Path.home() / ".aimeat"))
    tokens_dir = home_dir / "tokens"
    agent_config_path = home_dir / "agents" / agent_name / "config.yaml"

    # Locate the token file.
    if owner:
        token_path = tokens_dir / f"{agent_name}@{owner}.token"
        if not token_path.is_file():
            raise AimeatLiaisonError(
                f"No token at {token_path}. Run: aimeat connect add --agent {agent_name} --owner {owner} ..."
            )
        token_file = token_path
    else:
        pattern = str(tokens_dir / f"{agent_name}@*.token")
        matches = sorted(glob.glob(pattern))
        if not matches:
            raise AimeatLiaisonError(
                f"No token file matching {pattern}. Run: aimeat connect add --agent {agent_name} --owner <owner> --url <node-url>"
            )
        if len(matches) > 1:
            owners = [Path(m).stem.split("@", 1)[1] for m in matches]
            raise AimeatLiaisonError(
                f"Multiple owners have an agent named '{agent_name}' ({', '.join(owners)}). "
                f"Pass `owner=<name>` to disambiguate."
            )
        token_file = Path(matches[0])

    token = token_file.read_text(encoding="utf-8").strip()

    # Best-effort node_url extraction from per-agent config.yaml.
    node_url = "https://aimeat.io"
    if agent_config_path.is_file():
        text = agent_config_path.read_text(encoding="utf-8")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("node_url:"):
                raw = line.split(":", 1)[1].strip().strip('"').strip("'")
                if raw:
                    node_url = raw
                break

    return token, node_url


def _poll_tasks(token: str, node_url: str, agent_name: str, status: str = "queued") -> list[dict[str, Any]]:
    """Return list of tasks for the agent in the given status, or [] on error."""
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/tasks"
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"status": status},
            timeout=15,
        )
        if r.status_code != 200:
            return []
        body = r.json()
        return body.get("data", {}).get("tasks", []) or []
    except Exception:
        return []


def _fetch_message_content(
    token: str, node_url: str, agent_name: str, thread_id: str, msg_id: str
) -> str:
    """Return the full body of a single message, or "" on error.

    The /inbox endpoint only returns a ~100-char preview, so we fetch the full
    message from the thread listing (GET /v1/agents/<agent>/messages?thread_id=)
    and pick out the matching id. That endpoint returns complete records,
    including the `content` field.
    """
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/messages"
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"thread_id": thread_id, "per_page": 100},
            timeout=15,
        )
        if r.status_code != 200:
            return ""
        msgs = r.json().get("data", {}).get("messages", []) or []
        for m in msgs:
            if m.get("id") == msg_id:
                return m.get("content", "") or ""
        return ""
    except Exception:
        return ""


def _mark_message_delivered(token: str, node_url: str, agent_name: str, msg_id: str) -> bool:
    """Mark an inbox message delivered so it stops being re-dispatched.

    listPendingMessages only returns status=='pending' inbound messages, so
    PATCHing to 'delivered' after a successful kickoff removes it from the next
    poll cycle. Returns True on success.
    """
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/messages/{msg_id}"
        r = requests.patch(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json={"status": "delivered"},
            timeout=15,
        )
        return r.status_code == 200
    except Exception:
        return False


def _poll_messages(token: str, node_url: str, agent_name: str) -> list[dict[str, Any]]:
    """Return list of pending inbox messages for the agent, or [] on error.

    Each entry has its full `content` resolved (the /inbox endpoint only carries
    a truncated preview, so we fetch the body per message).
    """
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/inbox"
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if r.status_code != 200:
            return []
        data = r.json().get("data", {})
        # The node returns inbox items under `pending_messages` (and a unified
        # `items`); there is no `messages` key. Fall back to `items` for safety.
        stubs = data.get("pending_messages") or data.get("items") or []
        out: list[dict[str, Any]] = []
        for s in stubs:
            msg_id = s.get("id")
            thread_id = s.get("thread_id")
            content = ""
            if msg_id and thread_id:
                content = _fetch_message_content(token, node_url, agent_name, thread_id, msg_id)
            out.append({
                "id": msg_id,
                "thread_id": thread_id,
                "from": s.get("from"),
                # Fall back to the preview if the full fetch failed, so the crew
                # still gets *something* rather than "(empty)".
                "content": content or s.get("preview", ""),
            })
        return out
    except Exception:
        return []


# Type alias: function the caller provides to build a Crew for one task.
# Receives the AIMEAT task dict (id, title, description, ...) and the
# already-instantiated liaison Agent. Must return a crewai.Crew instance.
BuildCrewCallback = Callable[[dict[str, Any], Any], Any]


def _default_propose_crew(task: dict[str, Any], liaison: Any) -> Any:
    """
    Default PROPOSE-phase crew used by run_crew_daemon when the caller
    does not supply `build_propose_crew`. The liaison alone, one task:
    call `aimeat_task_propose_todos` ONCE with a TODO plan for the AIMEAT
    task, then stop. The crew does NOT start work, mark TODOs done, or
    complete the task -- those happen later, in the EXECUTE phase, after
    the owner has approved the proposed plan (or auto-approval kicks in
    for task-runner mode agents).

    Defined lazily so importing aimeat_crewai does not force a CrewAI
    import at module load time -- CrewAI is only required when actually
    spinning up a crew.
    """
    from crewai import Crew, Task  # local import keeps module-load light

    task_id = task.get("id", "(unknown id)")
    title = task.get("title", "(no title)")
    description = task.get("description") or title

    return Crew(
        agents=[liaison],
        tasks=[
            Task(
                description=(
                    f"You are the AIMEAT Liaison. AIMEAT task {task_id} is queued for "
                    f"this crew (title: {title}).\n\n"
                    f"---\n{description}\n---\n\n"
                    f"Propose a TODO plan for completing this task. Call "
                    f"`aimeat_task_propose_todos` ONCE with task_id='{task_id}' and a "
                    f"todos array of 2-6 concrete steps that this crew will take to "
                    f"deliver. Each todo should be one specific action with a clear "
                    f"verification criterion.\n\n"
                    f"After the propose call returns successfully, your job for this "
                    f"phase is done -- report the proposed plan and stop. Do not start "
                    f"working on the task, do not mark todos done, and do not call "
                    f"`aimeat_task_complete`. Those happen in the next phase, after "
                    f"the owner approves the plan (or auto-approval activates the task "
                    f"for task-runner mode agents)."
                ),
                expected_output="Confirmation that aimeat_task_propose_todos was called and the proposed TODO plan.",
                agent=liaison,
            ),
        ],
        verbose=False,
    )


# Curated subset of AIMEAT MCP tools that a daemon-mode liaison actually
# needs. Loading all ~95 AIMEAT tools into a CrewAI agent overflows some LLM
# adapters (litellm / smaller models choke on the schema package) and slows
# down even the ones that don't. This list covers the canonical liaison flow:
# Hello Integration, capability self-reporting, task lifecycle (read + take a
# task, propose+update TODOs, complete/fail), deliverable persistence
# (memory + knowledge), telemetry, and handbook self-reference. Wallet,
# admin, consent, cortex, extension, organism, board, app, and group tools
# are excluded because a default liaison doesn't need them.
#
# Override by passing `tool_filter=[...]` explicitly to run_crew_daemon, or
# `tool_filter=None` for the unfiltered ~95-tool set.
DAEMON_DEFAULT_TOOL_FILTER: tuple[str, ...] = (
    # Onboarding (Hello Integration)
    "aimeat_handbook_get",
    "aimeat_onboarding_status",
    "aimeat_onboarding_identify_platform",
    "aimeat_onboarding_confirm_skill_installed",
    "aimeat_onboarding_confirm_directives_read",
    "aimeat_onboarding_declare_services",
    # Capabilities + identity (what this crew can do, who it is)
    "aimeat_agent_capabilities_report",
    "aimeat_agents_list",
    # Task lifecycle (the daemon's core loop)
    "aimeat_task_list",
    "aimeat_task_get",
    "aimeat_task_propose_todos",
    "aimeat_task_todo",
    "aimeat_task_event",
    "aimeat_task_complete",
    "aimeat_task_fail",
    "aimeat_task_create",  # for crew-to-crew delegation
    # Deliverables
    "aimeat_memory_write",
    "aimeat_memory_read",
    "aimeat_memory_list",
    "aimeat_knowledge_contribute",
    "aimeat_knowledge_get",
    # Telemetry
    "aimeat_agent_telemetry_report",
    # Messages (so the daemon can listen for owner messages too)
    "aimeat_message_inbox",
    "aimeat_message_send",
)


# Sentinel marker. `run_crew_daemon(..., tool_filter=<SENTINEL>)` (the
# default) means "use DAEMON_DEFAULT_TOOL_FILTER". Passing `None` explicitly
# means "no filter, give me every tool the connector exposes". Passing a
# concrete iterable uses that exact set.
_USE_DAEMON_DEFAULT_FILTER = object()


def run_crew_daemon(
    *,
    agent_name: str,
    build_crew: BuildCrewCallback,
    build_propose_crew: BuildCrewCallback | None = None,
    owner: str | None = None,
    llm: Any = None,
    tool_filter: Any = _USE_DAEMON_DEFAULT_FILTER,
    poll_interval_seconds: int = 30,
    listen_for: Iterable[str] = ("tasks",),
    on_idle: Callable[[], None] | None = None,
    on_error: Callable[[Exception], None] | None = None,
    one_shot: bool = False,
) -> None:
    """
    Run a long-lived daemon that polls AIMEAT for work and dispatches it to
    a crew built fresh per task.

    The daemon runs the AIMEAT task lifecycle in two phases per poll cycle:

      PROPOSE: Pick up tasks in status='queued' that the daemon has not
        proposed yet, run the propose-phase crew (which calls
        aimeat_task_propose_todos once and stops). Owner approval (or
        task-runner mode's auto-activation) then flips the task to 'active'.
      EXECUTE: Pick up tasks in status='active' (or 'stalled') the daemon
        has not yet completed, run the caller's build_crew (which should
        finish the work and call aimeat_task_complete).

    For task-runner mode agents the AIMEAT node auto-activates tasks on
    create, so the daemon's PROPOSE phase still runs (idempotent propose
    of todos) and the same task is picked up by EXECUTE in the SAME cycle
    or the next one -- no owner approval required.

    Args:
        agent_name: The AIMEAT agent name (e.g. "demo-crew"). Must have a
            stored token from `aimeat connect add`.
        build_crew: Callback that takes (task_dict, liaison_agent) and
            returns a `crewai.Crew` instance for the EXECUTE phase. The
            Crew should have the liaison as one of its agents and at least
            one Task that asks the liaison to mark each todo done with
            aimeat_task_todo and then call aimeat_task_complete (the
            liaison's persona explains this).
        build_propose_crew: Optional override for the PROPOSE phase crew.
            Defaults to a liaison-only crew that calls
            aimeat_task_propose_todos once with a 2-6 step TODO plan and
            stops. Override if you want a richer plan (e.g. the same
            domain agents from build_crew running in 'plan only' mode).
        owner: Optional. If two or more owners have an agent with the same
            name in your local connector, pass `owner` to disambiguate.
            With a single-owner install you can omit it.
        llm: CrewAI-compatible LLM to use for the liaison's reasoning.
            Forwarded to create_liaison_agent. When None, CrewAI's default
            LLM resolution applies -- which falls back to the OpenAI native
            provider and crashes the daemon's finalize step if
            OPENAI_API_KEY is not set. Pass an explicit LLM
            (e.g. crewai.LLM(model="openrouter/...", api_key=...)) for any
            non-OpenAI runtime.
        tool_filter: Which AIMEAT MCP tools the liaison should load.
            Defaults to `DAEMON_DEFAULT_TOOL_FILTER` (a curated ~25-tool
            set covering Hello Integration, task lifecycle, memory,
            knowledge, telemetry, and messages). Pass `None` for the
            unfiltered ~95-tool set (some LLM adapters choke on it). Pass
            a list of tool names to use that exact subset.
        poll_interval_seconds: How often to check AIMEAT for new work
            when idle. Default 30s; raise for low-priority crews, lower
            for snappy interactive feel (but mind rate limits).
        listen_for: Iterable of "tasks" and/or "messages". Default
            ("tasks",). When "messages" is included, inbox messages also
            become triggers: they're wrapped into a synthetic task dict
            with the message body as description.
        on_idle: Optional callback fired once per poll cycle when no work
            arrived. Useful for heartbeat logging.
        on_error: Optional callback fired with any unhandled exception
            during a poll/dispatch cycle. The daemon does NOT exit on
            errors -- it logs and continues so the supervisor's
            crash-loop detector doesn't get spurious restarts.
        one_shot: If True, return after the first dispatched task (or
            after one idle cycle if no work). Useful for testing the
            wiring without a long-running process.

    The daemon traps SIGINT and SIGTERM cleanly so Ctrl+C and `kill`
    shut it down with the liaison's MCP connection properly closed.
    """
    token, node_url = _read_token(agent_name, owner=owner)
    listen_set = set(listen_for)

    stop = {"flag": False}

    def _handle_signal(signum: int, _frame: Any) -> None:  # pragma: no cover -- OS signals
        print(f"[daemon:{agent_name}] received signal {signum}, shutting down...")
        stop["flag"] = True

    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)

    print(f"[daemon:{agent_name}] starting against {node_url}, polling every {poll_interval_seconds}s, listening for {sorted(listen_set)}")

    # Resolve tool_filter:
    #   sentinel (default) -> DAEMON_DEFAULT_TOOL_FILTER (curated ~25 tools)
    #   None               -> no filter, every MCP tool the connector exposes
    #   iterable           -> use as-is
    if tool_filter is _USE_DAEMON_DEFAULT_FILTER:
        resolved_tool_filter: Iterable[str] | None = DAEMON_DEFAULT_TOOL_FILTER
    else:
        resolved_tool_filter = tool_filter

    if resolved_tool_filter is not None:
        try:
            count = len(list(resolved_tool_filter))  # iterable -> list (consumes generators)
            # Re-create as tuple for re-use below; lists are also fine.
            resolved_tool_filter = tuple(resolved_tool_filter) if not isinstance(resolved_tool_filter, (list, tuple)) else resolved_tool_filter
            print(f"[daemon:{agent_name}] loading liaison with {count} tool(s) via tool_filter")
        except TypeError:
            pass  # not a sized iterable, let create_liaison_agent surface the error
    else:
        print(f"[daemon:{agent_name}] loading liaison with NO tool_filter (every available MCP tool)")

    # Resolve PROPOSE crew builder: caller's override or the package default.
    propose_builder: BuildCrewCallback = build_propose_crew or _default_propose_crew

    # Idempotency sets, process-local. A task is proposed at most once and
    # executed at most once per daemon lifetime. Server-side the AIMEAT task
    # has a single lifecycle (queued -> active -> done|failed), so re-running
    # the same phase on the same task would just churn the LLM. On daemon
    # restart these sets are lost; the persona's "trust every success
    # response" rule + the server's idempotent propose/complete semantics
    # cover the small remaining churn surface.
    proposed_ids: set[str] = set()
    done_ids: set[str] = set()

    def _dispatch(phase_label: str, task: dict[str, Any], builder: BuildCrewCallback) -> bool:
        """Run one crew against one task. Returns True on success, False on error."""
        task_id = task.get("id", "(unknown id)")
        title = task.get("title", "(no title)")
        print(f"[daemon:{agent_name}] {phase_label} task {task_id}: {title}")
        crew = builder(task, liaison)
        try:
            result = crew.kickoff()
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} done; first 200 chars: {str(result)[:200]}")
            return True
        except Exception as inner:
            print(f"[daemon:{agent_name}] {phase_label} task {task_id} crashed: {inner}")
            if on_error:
                try:
                    on_error(inner)
                except Exception:
                    pass
            # Only mark failed during the EXECUTE phase. A PROPOSE-phase crash
            # is recoverable -- the task is still queued, the next poll cycle
            # will retry. Marking it failed would close it off prematurely.
            if phase_label == "EXECUTE":
                try:
                    requests.post(
                        f"{node_url.rstrip('/')}/v1/agents/{agent_name}/tasks/{task_id}/fail",
                        headers={"Authorization": f"Bearer {token}"},
                        json={"message": f"Crew crashed: {inner}"},
                        timeout=10,
                    )
                except Exception:
                    pass
            return False

    # The liaison's MCP connection stays open for the whole daemon's lifetime.
    # Each crew.kickoff() reuses the same liaison instance.
    with create_liaison_agent(
        mcp_server_params=stdio_params(agent_name=agent_name),
        agent_name=agent_name,
        tool_filter=resolved_tool_filter,
        llm=llm,
    ) as liaison:
        print(f"[daemon:{agent_name}] liaison ready, entering poll loop")

        while not stop["flag"]:
            dispatched_this_cycle = False

            try:
                if "tasks" in listen_set:
                    # PROPOSE phase: queued tasks the daemon hasn't proposed yet.
                    # Owner-created tasks land in 'queued'; the daemon proposes a
                    # plan and waits for owner approval (or for task-runner mode's
                    # auto-active route to flip the task to 'active' directly).
                    for task in _poll_tasks(token, node_url, agent_name, status="queued"):
                        if stop["flag"]:
                            break
                        task_id = task.get("id")
                        if not task_id or task_id in proposed_ids:
                            continue
                        _dispatch("PROPOSE", task, propose_builder)
                        proposed_ids.add(task_id)
                        dispatched_this_cycle = True

                    # EXECUTE phase: tasks the owner has approved (active) and any
                    # the stall detector flagged (stalled -- the owner can resume by
                    # re-starting in the dashboard, which keeps them as 'active'
                    # again, but we also pick them up here so a daemon restart
                    # mid-task doesn't lose the task).
                    for task_status in ("active", "stalled"):
                        for task in _poll_tasks(token, node_url, agent_name, status=task_status):
                            if stop["flag"]:
                                break
                            task_id = task.get("id")
                            if not task_id or task_id in done_ids:
                                continue
                            ok = _dispatch("EXECUTE", task, build_crew)
                            if ok:
                                done_ids.add(task_id)
                            dispatched_this_cycle = True

                if "messages" in listen_set:
                    messages = _poll_messages(token, node_url, agent_name)
                    for msg in messages:
                        if stop["flag"]:
                            break
                        msg_id = msg.get("id")
                        # Guard against re-dispatch within this process even if
                        # the mark-delivered call below fails or races a poll.
                        if not msg_id or msg_id in done_ids:
                            continue
                        body = msg.get("content") or msg.get("body") or "(empty)"
                        print(f"[daemon:{agent_name}] dispatching message {msg_id}: {str(body)[:100]}")
                        synthetic_task = {
                            "id": f"msg-{msg_id}",
                            "title": "Inbox message",
                            "description": body,
                            "_source": "message",
                            "_original": msg,
                        }
                        crew = build_crew(synthetic_task, liaison)
                        kickoff_ok = False
                        try:
                            crew.kickoff()
                            kickoff_ok = True
                        except Exception as inner:
                            print(f"[daemon:{agent_name}] message {msg_id} crashed: {inner}")
                            if on_error:
                                try:
                                    on_error(inner)
                                except Exception:
                                    pass
                        # Mark delivered so the node stops returning it as pending;
                        # only after a successful kickoff so a crash leaves it for
                        # retry. Track locally regardless to avoid tight re-loops.
                        if kickoff_ok:
                            _mark_message_delivered(token, node_url, agent_name, msg_id)
                            done_ids.add(msg_id)
                        dispatched_this_cycle = True

            except Exception as outer:
                # The poll itself failed (e.g. network blip). Don't exit;
                # let the supervisor decide if a restart is warranted.
                print(f"[daemon:{agent_name}] poll cycle error: {outer}")
                if on_error:
                    try:
                        on_error(outer)
                    except Exception:
                        pass

            if not dispatched_this_cycle and on_idle:
                try:
                    on_idle()
                except Exception:
                    pass

            if one_shot:
                print(f"[daemon:{agent_name}] one_shot=True, exiting after one cycle")
                break

            # Sleep in small increments so signal handlers can interrupt.
            slept = 0
            while slept < poll_interval_seconds and not stop["flag"]:
                time.sleep(min(1, poll_interval_seconds - slept))
                slept += 1

        print(f"[daemon:{agent_name}] poll loop ended, releasing liaison")
