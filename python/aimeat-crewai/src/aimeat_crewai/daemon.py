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


def _poll_messages(token: str, node_url: str, agent_name: str) -> list[dict[str, Any]]:
    """Return list of unread inbox messages for the agent, or [] on error."""
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/inbox"
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if r.status_code != 200:
            return []
        body = r.json()
        return body.get("data", {}).get("messages", []) or []
    except Exception:
        return []


def _mark_task_active(token: str, node_url: str, agent_name: str, task_id: str) -> None:
    """Transition task from queued -> active before the crew starts. Best-effort."""
    try:
        url = f"{node_url.rstrip('/')}/v1/agents/{agent_name}/tasks/{task_id}/start"
        requests.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception:
        pass


# Type alias: function the caller provides to build a Crew for one task.
# Receives the AIMEAT task dict (id, title, description, ...) and the
# already-instantiated liaison Agent. Must return a crewai.Crew instance.
BuildCrewCallback = Callable[[dict[str, Any], Any], Any]


def run_crew_daemon(
    *,
    agent_name: str,
    build_crew: BuildCrewCallback,
    owner: str | None = None,
    poll_interval_seconds: int = 30,
    listen_for: Iterable[str] = ("tasks",),
    on_idle: Callable[[], None] | None = None,
    on_error: Callable[[Exception], None] | None = None,
    one_shot: bool = False,
) -> None:
    """
    Run a long-lived daemon that polls AIMEAT for work and dispatches it to
    a crew built fresh per task.

    Args:
        agent_name: The AIMEAT agent name (e.g. "demo-crew"). Must have a
            stored token from `aimeat connect add`.
        build_crew: Callback that takes (task_dict, liaison_agent) and
            returns a `crewai.Crew` instance. The Crew should have the
            liaison as one of its agents and at least one Task that asks
            the liaison to call `aimeat_task_complete` with the deliverable
            (the liaison's persona explains this).
        owner: Optional. If two or more owners have an agent with the same
            name in your local connector, pass `owner` to disambiguate.
            With a single-owner install you can omit it.
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

    # The liaison's MCP connection stays open for the whole daemon's lifetime.
    # Each crew.kickoff() reuses the same liaison instance.
    with create_liaison_agent(
        mcp_server_params=stdio_params(agent_name=agent_name),
        agent_name=agent_name,
    ) as liaison:
        print(f"[daemon:{agent_name}] liaison ready, entering poll loop")

        while not stop["flag"]:
            dispatched_this_cycle = False

            try:
                if "tasks" in listen_set:
                    tasks = _poll_tasks(token, node_url, agent_name)
                    for task in tasks:
                        if stop["flag"]:
                            break
                        task_id = task.get("id")
                        title = task.get("title", "(no title)")
                        print(f"[daemon:{agent_name}] dispatching task {task_id}: {title}")
                        _mark_task_active(token, node_url, agent_name, task_id)
                        crew = build_crew(task, liaison)
                        try:
                            result = crew.kickoff()
                            print(f"[daemon:{agent_name}] task {task_id} kickoff done; first 200 chars of result: {str(result)[:200]}")
                        except Exception as inner:
                            print(f"[daemon:{agent_name}] task {task_id} crashed: {inner}")
                            if on_error:
                                try:
                                    on_error(inner)
                                except Exception:
                                    pass
                            # Mark the task failed so it doesn't stay stuck.
                            try:
                                requests.post(
                                    f"{node_url.rstrip('/')}/v1/agents/{agent_name}/tasks/{task_id}/fail",
                                    headers={"Authorization": f"Bearer {token}"},
                                    json={"message": f"Crew crashed: {inner}"},
                                    timeout=10,
                                )
                            except Exception:
                                pass
                        dispatched_this_cycle = True

                if "messages" in listen_set:
                    messages = _poll_messages(token, node_url, agent_name)
                    for msg in messages:
                        if stop["flag"]:
                            break
                        msg_id = msg.get("id")
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
                        try:
                            crew.kickoff()
                        except Exception as inner:
                            print(f"[daemon:{agent_name}] message {msg_id} crashed: {inner}")
                            if on_error:
                                try:
                                    on_error(inner)
                                except Exception:
                                    pass
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
