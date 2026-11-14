/**
 * @file src/data/builtin-skills.app-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-app-agents` built-in skill: how an app brings an agent of its own, from
 *   the one block in the page that declares it to the person's approval and the check afterwards.
 *
 *   It exists because on 2026-11-11 nothing an app builder reads said how: the build prompt, the
 *   built-in skills, the app builder's handbook and the curated pitfalls had no line on it, and the
 *   only mention was the `cortex_agents` parameter of aimeat_app_publish, which did not state the
 *   shape. Three apps on a production node carried five agents, and none of the five asked for a
 *   permission.
 *
 *   The facts come from models/crew-def-schemas.ts (the fields and the limits),
 *   services/app/bundled-crews.ts (the block, what a publish reads and the two hints),
 *   services/app/agent-propose.ts (which permissions a proposal asks for) and
 *   services/app/agent-deploy.ts (the four actions and the states). The curated pitfalls
 *   bundled-agent-block and bundled-agent-permissions point here.
 * @structure APP_AGENTS_SKILL_ENTRY
 * @usage import { APP_AGENTS_SKILL_ENTRY } from './builtin-skills.app-agents.js';
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial (wish-sovelluksen-mukana-tulevat-agentit-k-ytt-notto-hyv-ksynn-ll-).
 */
// The entry's shape is BuiltinSkill (builtin-skills.ts). It is not imported from there, because
// builtin-skills.ts imports this file and the type import would close an import cycle.
export const APP_AGENTS_SKILL_ENTRY: { name: string; skillMd: string } = {
  name: 'aimeat-app-agents',
  skillMd: `---
name: aimeat-app-agents
description: How an app on an AIMEAT node brings an agent of its own. One aimeat-crews block in the app's HTML declares the agent (what it is for, the permissions its job needs, its crew and its tasks); a person adds it with one press and one approval; it then works on their account. Use when an app needs work done while nobody has it open (a summary every morning, a record checked when it arrives, an order followed up), when you publish an app that should come with an agent, and when a bundled agent was approved and its work is refused. Triggers on bundled agent, app agent, an agent for my app, aimeat-crews, cortex_agents, agent_deploy, crew definition in an app, sovelluksen agentti, agente de la aplicación.
license: MIT
metadata:
  audience: agent
---

# An agent that comes with your app

An app is a page, so it works while a person has it open. Work that happens when nobody is
looking needs an agent: a summary every morning, a record checked when it arrives, an order
followed up. An app can bring that agent with it. The person who uses the app adds the agent
with one press and one approval, and it then works on their account, in their name, with the
permissions they read before approving.

Before you add an agent, read \`aimeat_skill_get { name: "aimeat-agent-capability" }\`: a
capability other AIs should call is built as an app tool, and an agent is for work that runs on
its own.

## 1. Declare it in the page

One block in the app's HTML, anywhere in the document, holding a list of at most five definitions:

\`\`\`html
<script type="application/json" id="aimeat-crews">
[
  {
    "agent_name": "meeting-summarizer",
    "description": "Reads the meeting notes you keep and writes a short summary with the decisions and who does what.",
    "scopes": ["organism:read", "task:write"],
    "agents": [
      { "role": "Reader", "goal": "Find the decisions and the open questions in the notes", "tools": ["memory"] },
      { "role": "Writer", "goal": "Write a summary a busy person reads in one minute", "tools": ["memory"] }
    ],
    "tasks": [
      { "id": "read", "description": "Read the notes named here: {{ctx.prompt}}", "expected_output": "A list of decisions and open questions", "agent": "Reader" },
      { "id": "write", "description": "Write the summary from the list", "expected_output": "A summary of at most ten lines", "agent": "Writer", "context": ["read"] }
    ]
  }
]
</script>
\`\`\`

| Field | What it is |
|---|---|
| \`agent_name\` | 3 to 32 lowercase letters, digits and hyphens, starting with a letter. The person's agent is named from it and from the app. |
| \`description\` | One or two sentences on what the agent does for the person. They read it on the app's page and on the proposal they approve. |
| \`scopes\` | The permissions the job needs (section 2). |
| \`agents\` | The crew, 1 to 10 members: \`role\`, \`goal\`, optional \`backstory\`, \`tools\` and \`skills\`. |
| \`tasks\` | 1 to 20 steps: \`description\`, \`expected_output\`, and \`agent\`, the role that does it. \`context\` names the \`id\` of earlier tasks whose results this one reads. |
| \`process\`, \`llm_profile\`, \`temperature\`, \`tags\`, \`readme_md\`, \`offers\` | Optional, as in any crew definition (skill \`add-a-crew-agent\`). |

What the node checks:

- At least one task description contains \`{{ctx.prompt}}\`. It is replaced with the request the
  agent is given, and without it the agent answers the same thing every run.
- Every task's \`agent\` is the \`role\` of one member, and \`context\` names earlier tasks only.
- A tool name is lowercase letters, digits, \`_\` and \`-\`, with at most one \`:\` and a selector
  (\`decide:sort-a-message\`). The names are the ones a crew runtime resolves:
  \`aimeat_crew_menu { target_agent_name }\` on one of your own crew agents lists them.

The definition is data. The node validates it and stores it, and never runs code from the app.

## 2. Ask for the permissions the job needs

An agent approved from the definition holds exactly this: the permissions in \`scopes\`, plus
\`memory:read\` and \`memory:write\`, which every crew runtime needs for itself, plus \`ai:use\` when
the person's agents think through their AIMEAT. Nothing else. A tool that calls the node for
anything more is refused, and the task ends as refused after the crew did the work.

- List the smallest set that does the job. The person reads the list as sentences before approving.
- \`*\` and the permissions an owner grants one by one (\`account:security\` and the like) are never
  taken from an app. They come back in \`scopes_left_out\`, and the owner can grant them on the
  agent's page.
- Match the tools: a tool that reads shared workspaces needs \`organism:read\`, one that makes tasks
  needs \`task:write\`, the marketplace tools need \`exchange:read\` and \`exchange:write\`, and an
  extension action needs \`ext:invoke\`.

## 3. Publish

Publish as usual with \`aimeat_app_publish\` and leave \`cortex_agents\` out. The block is the
declaration on every route: a plain publish, a draft and a package made from the app.

Read the answer:

- \`manifest.cortex.agents\` lists the agents the node read.
- \`app_hints\` with pitfall \`bundled-agent-block\`: the block was not used (not valid JSON, not a
  list, a definition that does not validate), and the app kept the agents of its previous version.
  The message names the problem. Fix the block and publish again.
- \`app_hints\` with pitfall \`bundled-agent-permissions\`: an agent names tools and asks for no
  permissions. Add \`scopes\`.

\`cortex_agents\` on the publish call still works and wins over the block for that version. A
package reads only the block, so keep the two the same or use the block alone. To take every agent
away from an app, publish with \`cortex_agents: []\`: removing the block alone keeps the agents of
the previous version.

## 4. How a person gets the agent

- **On the screen.** The app's page in the App Catalog shows "Bundled agents": what each agent
  does, what it may do, and "Add this agent".
- **Through their AI.** \`aimeat_app_manage { action: "agent_deploy", owner, filename, bundled_agent }\`.
  The answer has \`kind: "proposed"\`. Then read \`agent_status\` and give the person its
  \`approval_url\`: nothing exists until they approve there.
- **With a package.** Installing a package or an install set that carries the app proposes its
  agents in the same way.

\`aimeat_app_manage { action: "agent_status", ... }\` answers the caller's own copy:

| \`state\` | Meaning | What to do |
|---|---|---|
| \`none\` | They do not have it. \`scopes\` is what a proposal would ask for. | \`agent_deploy\` |
| \`waiting\` | A proposal waits for the owner. | Give them \`approval_url\`. |
| \`running\` | The agent exists and takes work. | Give it work as any agent: a task, a schedule, a message. |
| \`stopped\` | The owner stopped it; work waits. | \`agent_deploy\` starts it again. |

\`definition_current: false\` means the app now declares a newer definition than the agent runs.
\`agent_deploy\` again publishes it to the agent; the agent's own runtime validates it first, so
its computer has to be connected. \`agent_undeploy\` stops the agent (it takes \`agent:write\`, or
the owner in person); the agent, its permissions and what it wrote stay. Removing an agent is the
owner's act on the agent's page.

An approved agent runs where the person's agents run: on a computer of theirs that runs
\`aimeat connect serve\`, or in the AIMEAT they bought. With none connected it waits and starts by
itself when one connects (skill \`add-a-crew-agent\`).

## 5. Check before you call it done

1. The publish answer lists your agent in \`manifest.cortex.agents\` and has no \`bundled-agent-\` hint.
2. \`agent_status\` shows the \`scopes\` you meant, and \`scopes_left_out\` is empty.
3. Say in the app's own skill and on its page what the agent does and how a person adds it.
`,
};
