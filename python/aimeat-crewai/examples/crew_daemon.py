"""
Long-running CrewAI crew daemon.

Polls AIMEAT for queued tasks. When one arrives, builds a fresh crew with
the AIMEAT Liaison + your domain agents, runs it, and lets the liaison
report results back to AIMEAT (memory_write, knowledge_contribute,
task_complete). Stays alive between tasks.

How to give this crew a task from elsewhere:
- Browser: Profile -> Agents -> demo-crew -> Tasks tab -> + New Task
- Claude Desktop (or any AIMEAT-connected agent): use the
  `aimeat_task_create` MCP tool with target_agent="demo-crew"
- REST: POST /v1/agents/demo-crew/tasks with an owner JWT

Run as:
    python crew_daemon.py

Or wrap in a supervisor (see watchdog.sh / watchdog.ps1 examples next to
this file) to restart on crash with crash-loop protection.
"""
from __future__ import annotations

import os
from typing import Any

from crewai import Agent, Crew, Task
from aimeat_crewai import run_crew_daemon


AGENT_NAME = os.environ.get("AIMEAT_AGENT_NAME", "demo-crew")


def build_crew_for_task(task: dict[str, Any], liaison: Agent) -> Crew:
    """Called for every incoming AIMEAT task. Build & return a Crew."""

    researcher = Agent(
        role="Researcher",
        goal="Find accurate, recent, primary-source-backed facts on the given topic.",
        backstory=(
            "You are a careful researcher who values primary sources and "
            "explicit citations. You distrust LLM-generated 'summaries' that "
            "lack provenance."
        ),
        allow_delegation=False,
        verbose=True,
    )

    writer = Agent(
        role="Writer",
        goal="Turn research notes into a clear, well-structured summary suitable for a general audience.",
        backstory=(
            "You write tight, engaging prose without filler. You preserve "
            "all citations the researcher provided."
        ),
        allow_delegation=False,
        verbose=True,
    )

    prompt = task.get("description") or task.get("title") or "(no prompt provided)"
    task_id = task.get("id", "(unknown id)")

    return Crew(
        agents=[liaison, researcher, writer],
        tasks=[
            Task(
                description=(
                    f"Research the following topic, including primary sources where possible:\n\n"
                    f"---\n{prompt}\n---\n\n"
                    "Return 3-5 bullet points of facts with sources."
                ),
                expected_output="Bullet points with sources.",
                agent=researcher,
            ),
            Task(
                description=(
                    "Turn the researcher's notes into a 2-3 paragraph summary "
                    "suitable for a general audience. Preserve citations."
                ),
                expected_output="A 2-3 paragraph summary with inline citations.",
                agent=writer,
            ),
            Task(
                description=(
                    f"You are the AIMEAT Liaison. The crew has produced a summary "
                    f"(see the previous task's output) and the AIMEAT task is already "
                    f"in 'active' status with a proposed TODO list. Complete the task "
                    f"in three steps:\n\n"
                    f"1. Read the current task with aimeat_task_get task_id='{task_id}' "
                    f"to see the TODOs that were proposed in the PROPOSE phase.\n\n"
                    f"2. For each TODO whose verification is now satisfied by the crew's "
                    f"work, call aimeat_task_todo with task_id='{task_id}', the todo's "
                    f"id, and status='done'. One call per TODO.\n\n"
                    f"3. Write the summary to AIMEAT memory with aimeat_memory_write: "
                    f"key='deliverables.{AGENT_NAME}.{task_id}', value being a JSON "
                    f"object with fields 'title' (from the task), 'prompt', 'summary' "
                    f"(the writer's output), and 'completed_at' (ISO timestamp). Set "
                    f"visibility='owner'.\n\n"
                    f"4. Call aimeat_task_complete ONCE with task_id='{task_id}' and "
                    f"message=<the summary>. That is the final action -- trust the "
                    f"success response."
                ),
                expected_output="Confirmation of TODO updates, memory write, and task completion.",
                agent=liaison,
            ),
        ],
        verbose=True,
    )


if __name__ == "__main__":
    # tool_filter defaults to DAEMON_DEFAULT_TOOL_FILTER (~25 curated tools).
    # That keeps the LLM's schema package small enough that adapters like
    # litellm + smaller models don't choke. Pass tool_filter=None to get
    # the full ~95-tool set, or pass an explicit list to override.
    run_crew_daemon(
        agent_name=AGENT_NAME,
        build_crew=build_crew_for_task,
        poll_interval_seconds=int(os.environ.get("AIMEAT_POLL_INTERVAL", "30")),
        listen_for=("tasks",),  # add "messages" if you also want inbox triggers
        on_idle=lambda: None,    # could log a heartbeat here
    )
