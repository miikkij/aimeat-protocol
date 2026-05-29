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
                    f"(see the previous task's output). Do TWO things in order:\n\n"
                    f"1. Write the summary to AIMEAT memory using aimeat_memory_write "
                    f"with key='deliverables.{AGENT_NAME}.{task_id}', value being a JSON "
                    f"object with fields 'title' (from the task), 'prompt', 'summary' (the "
                    f"writer's output), and 'completed_at' (current ISO timestamp). "
                    f"Set visibility='owner'.\n\n"
                    f"2. Mark the AIMEAT task complete using aimeat_task_complete "
                    f"with task_id='{task_id}' and message=<the summary>.\n\n"
                    f"Report back with the IDs / confirmations you got from those two "
                    f"tool calls. Do NOT call any other AIMEAT tools beyond these two."
                ),
                expected_output="Confirmation of memory write and task completion.",
                agent=liaison,
            ),
        ],
        verbose=True,
    )


if __name__ == "__main__":
    run_crew_daemon(
        agent_name=AGENT_NAME,
        build_crew=build_crew_for_task,
        poll_interval_seconds=int(os.environ.get("AIMEAT_POLL_INTERVAL", "30")),
        listen_for=("tasks",),  # add "messages" if you also want inbox triggers
        on_idle=lambda: None,    # could log a heartbeat here
    )
