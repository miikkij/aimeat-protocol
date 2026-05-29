"""
Minimal example: a 3-agent CrewAI crew with an AIMEAT Liaison.

The liaison handles Hello Integration + memory writes + task completion
on the AIMEAT side. The researcher and writer focus on their domain work.

Prerequisites:
  1. AIMEAT 1.13.0+ running somewhere (default: http://localhost:40050)
  2. The crew's agent identity registered:
       aimeat connect add --agent demo-crew --url http://localhost:40050 --owner <you>
  3. This package installed:
       pip install aimeat-crewai
  4. An LLM available (set OPENAI_API_KEY or configure CrewAI's default)

Run:
  python examples/basic_crew.py
"""
from __future__ import annotations

import os
from crewai import Agent, Crew, Task

from aimeat_crewai import create_liaison_agent, stdio_params


def main() -> None:
    # Stdio MCP transport -- spawns `aimeat connect serve` as a child process
    # for the "demo-crew" agent identity. The connector reads the token from
    # ~/.aimeat/ automatically. For remote/cloud deployments, swap in
    # http_params(node_url=..., agent_token=...) instead.
    agent_name = os.environ.get("AIMEAT_AGENT_NAME", "demo-crew")
    mcp_params = stdio_params(agent_name=agent_name)

    # Passing agent_name explicitly here lets the liaison inject it into its
    # persona, so the LLM always passes the right value to AIMEAT tools that
    # need an `agent_name` parameter -- no guessing.
    with create_liaison_agent(
        mcp_server_params=mcp_params,
        agent_name=agent_name,
        verbose=True,
    ) as liaison:
        researcher = Agent(
            role="Researcher",
            goal="Find three recent and credible facts about the topic.",
            backstory="You are a careful researcher who values primary sources.",
            verbose=True,
            allow_delegation=False,
        )

        writer = Agent(
            role="Writer",
            goal="Compose a clear, concise summary suitable for a general audience.",
            backstory="You are a writer who turns research notes into engaging prose.",
            verbose=True,
            allow_delegation=False,
        )

        # Liaison-driven onboarding -- runs ONCE at crew kickoff.
        onboarding_task = Task(
            description=(
                "Check AIMEAT onboarding status with aimeat_onboarding_status. "
                "If any required step is pending, complete it via the appropriate "
                "aimeat_onboarding_* tool. Report the final status."
            ),
            expected_output="Final onboarding state (completed/in_progress) and list of passed steps.",
            agent=liaison,
        )

        research_task = Task(
            description="Research three facts about the AIMEAT protocol.",
            expected_output="Three bullet points with sources.",
            agent=researcher,
        )

        write_task = Task(
            description="Turn the research notes into a 2-paragraph summary.",
            expected_output="A 2-paragraph summary suitable for a blog post.",
            agent=writer,
            context=[research_task],
        )

        publish_task = Task(
            description=(
                "Take the writer's summary. Write it to AIMEAT memory under key "
                "'demo.basic_crew.latest_summary' with visibility=owner. Then call "
                "aimeat_agent_telemetry_report with type='agent_report' and "
                "data={status:'ok', source:'aimeat-crewai/basic_crew example'}."
            ),
            expected_output="Confirmation that the memory write succeeded.",
            agent=liaison,
            context=[write_task],
        )

        crew = Crew(
            agents=[liaison, researcher, writer],
            tasks=[onboarding_task, research_task, write_task, publish_task],
            verbose=True,
        )

        result = crew.kickoff()
        print("\n=== Crew result ===")
        print(result)


if __name__ == "__main__":
    main()
