/**
 * @file src/data/builtin-skills.crew-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in skill `add-a-crew-agent`: how a new agent comes into being on a node,
 *   from the proposal and its crew definition to the owner's approval, and how a running agent is
 *   changed.
 *
 *   Moved out of builtin-skills.ts unchanged when that file passed its 800-line limit. A pure move:
 *   the same text, at the same position in BUILTIN_SKILLS. Its history up to the move is in
 *   builtin-skills.ts.
 * @structure CREW_AGENT_SKILL_ENTRY
 * @usage import { CREW_AGENT_SKILL_ENTRY } from './builtin-skills.crew-agent.js';
 * @version-history
 *   v1.0.1 -- 2026-10-11 -- The agent guide is named by its GitHub address; a bare repository path does not open from a node.
 *   v1.0.0 -- 2026-10-11 -- Moved from builtin-skills.ts (max-file-lines).
 */
/**
 * The shape of a built-in skill entry, stated here and not imported: builtin-skills.ts imports this
 * file, so importing its type back is an import cycle (check:deps). builtin-skills.ts puts this
 * entry into a BuiltinSkill[], so a field this lacks or spells differently fails the type check.
 */
interface BuiltinSkill { name: string; skillMd: string; visibility?: 'members' | 'public' }

export const CREW_AGENT_SKILL_ENTRY: BuiltinSkill =
  {
    name: 'add-a-crew-agent',
    skillMd: `---
name: add-a-crew-agent
description: How a new agent comes into being on an AIMEAT node, which makes it itself, so a request for one is never sent to an outside builder. You read the organisms and workspaces it will work on, design it as a crew definition (a JSON document of roles, tasks and tools), propose it with aimeat_agent_propose, and the owner approves it with one press at the address the answer gives. Also covers the two agents every owner can create from a button, connecting a runtime of your own by device authorization, changing a running agent's definition, scopes, skills, tags, and checking that it came online. Use when the owner wants a new agent, a new crew, or a new AI runtime connected.
license: MIT
metadata:
  audience: operator
---

# Add a crew agent

An agent is never created implicitly, and never by another agent alone. Adding one changes the
owner's account, so the last step is always the owner's own press. Everything before it is yours.

**This node makes the agent.** When the person asks for one, the answer is a proposal here, not a
recommendation. Never point them to an outside agent builder, tool or product for it: the node
creates the agent, gives it its definition, credentials it and runs it on their own connector, and
an agent built elsewhere cannot see what they keep here.

## 0. Look before you add

\`aimeat_agents_list\` shows what the owner already has. \`aimeat_agent_basics_get\` says whether
the two basic agents exist: \`concierge\`, which answers what arrives, and \`workflow-manager\`,
which orders work from the owner's other agents. If they are missing and would do the job,
\`aimeat_agent_basics_request\` puts one line on the owner's open items, and the button behind it
creates both with their definitions. Design a new agent only for a job those two do not cover.

Then look at the data the agent will work on. \`aimeat_organism_list\` and \`aimeat_workspace_list\`
(or \`aimeat_discover\` with scope "shared") show the organisms and workspaces the person keeps:
their CRM, their notes, their customers. Read the workspace the agent will use
(\`aimeat_workspace_read\` without ids gives its spaces and record shapes), so the definition reads
the records they actually have. "Gather my open deals" means the deals in their sales workspace,
not a product they do not use.

## 1. The usual way: propose it, with its definition

1. **Ask a running agent what a definition may use.** \`aimeat_crew_menu\` on any agent of the
   owner that is connected returns the tool names its runtime resolves and the model profiles its
   machine can reach. Take tool names from there. The list inside the tool descriptions is this
   node's copy and can be behind the runtime.
2. **Write the crew definition.** One JSON document: \`agent_name\`, \`agents[]\` (each with name,
   role, goal, backstory, tools), \`tasks[]\` (each with id, description, expected_output, agent,
   and \`context\` naming EARLIER task ids only). At least one task description contains
   \`{{ctx.prompt}}\`, which is where the incoming work lands. \`listen_for\` says what wakes the
   crew: it defaults to \`["tasks"]\`, and that is wrong for an agent whose work arrives as a
   message or a DM. The full shape is in the \`doc\` parameter of \`aimeat_crew_publish\`.
3. **Propose it.** \`aimeat_agent_propose\` with \`name\`, a \`purpose\` the owner can decide from
   (it is the sentence they read, so name their data in it: "reads the open deals in your Sales
   workspace each morning and lists what to act on"), \`scopes\`, \`mode\`, \`run_mode\` and the
   \`crew_def\`. The definition is checked before the proposal is written, so a broken one is
   refused now. Nothing is created. One line appears on the owner's open items.
   **Which computer.** A person can have more than one connector: their own laptop or computer, a
   server, a computer in the cloud, the one that comes with an AIMEAT instance from the store. To
   the person each one is a computer: say that word and its name, never "machine" or "connector".
   When they say where the agent is to run, or they have more than one,
   \`aimeat_connector_list\` gives each computer's name and whether it is connected; pass the name
   or the id as \`connector\`. The agent is then offered to that computer only. With one connector
   there is nothing to choose, and \`connector\` is left out.
4. **Tell the owner where to approve.** The answer carries \`approval_url\`, the page where the
   proposal waits, and \`next_step\`, a sentence written for them. Give them both in their own
   words. Their one press there creates the agent, gives it the definition and hands it to their
   connector, which runs it on their own computer (\`aimeat connect serve\`). The approval's answer
   says which state it ended in. If no connector was connected (\`waiting_for_connector\` true), the
   agent exists with its instructions and waits: when the owner's connector next connects, the node
   gives it its key and the connector starts it, with nothing to press. An agent proposed or
   approved for one named connector waits for that connector (the answer's \`connector\` names it),
   and another computer of the owner's connecting is not given it. If a connector was reached
   and did not take it on, the owner updates the connector and presses Attach. The approval also
   gives the new agent its work once, as a task that carries its name and its purpose, so the owner
   sees that it works and has a first result; write the \`purpose\` so that it reads as that task.
5. **Work on a clock comes after.** "Every morning" is a schedule of kind \`agent_task\` for the new
   agent (\`aimeat_schedule_create\`), made once the agent exists. Say so when you propose it.

Always send the \`crew_def\`. An agent approved without one exists and cannot start, and
\`aimeat_crew_publish\` cannot repair that, because publishing asks the agent's own runtime to
validate and a new agent has none.

**Scopes and modes.** Name each scope, never \`*\`, and never more than you hold yourself. An agent
run by a crew runtime needs \`memory:read\` and \`memory:write\` whatever its job: the runtime reads
its own definition with the first and stores the result with the second. The node adds both to
every proposal and every approval, so you need not ask for them (measured 2026-10-02: an agent
approved with \`memory:write\` alone could not read its definition and never ran).
It needs no \`agent:write\` to report its own tags or its own runtime; that word lets an agent approve new agents and
change other agents' settings, so give it only to an agent whose job is that. An agent
that reads and writes the owner's memory needs \`memory:read\` and \`memory:write\`; one that takes
queued work also needs \`work:read\` and \`work:accept\`; one that uses the owner's AI (text, pictures,
transcription, embeddings, or the node's \`/v1/llm\` through \`node_llm()\`) needs \`ai:use\`. \`mode: "task-runner"\` lets a queued task
start without asking the owner each time, so say that in the purpose. \`run_mode: "spawn"\` starts
a worker per piece of work and suits bursty jobs; \`"resident"\` stays up and suits a front door.
Ask for \`"resident"\` only when the owner's connector can keep an agent up: \`aimeat connect serve\`
and a hosted place run every agent by spawning, so the node stores such a proposal as \`spawn\` and
says so in \`run_mode_corrected\`. When the owner's crews think through the node (their default model
choice is the node, or the node has a key to pay with), the proposal carries \`ai:use\` on its own.

**What it offers.** A definition may carry \`offers\`, a list of offer entries, and the crew runtime
publishes the FIRST entry to the agent's offers each time the agent starts. That published offer is
what puts the agent on the owner's "Ask your agents" page, so write one entry when you propose:
\`id\` (lowercase with hyphens), \`title\`, and \`ask\`, a plain invitation that says what to give the
agent, what comes back and what it does not do; an \`example\` helps. The node completes the entry
with the other keys the runtime reads (\`cost\`, \`latency\`, \`repeatability\`, \`verification\`,
\`consequences\`), and a definition with no entry gets one made from the agent's name and purpose.
The entry carries no price and no visibility, so the offer is the owner's own: it is not on the
Exchange until the owner prices and lists it, and it is a workflow step only once it declares its
signals (https://github.com/miikkij/aimeat-protocol/blob/main/docs/building-an-aimeat-compatible-agent.md).

## 2. A runtime of your own: device authorization

For a Python crew built on \`aimeat-crewai\`, or any other runtime the owner hosts themselves, the
agent side starts device authorization (RFC 8628): \`POST /v1/agents/device-authorize\`, which the
runtime or the connect CLI does, and it shows a code. The runtime names the scopes it needs in that
call; one that names none gets the node's default set, which cannot take work. The owner approves in
profile → Agents and chooses the scopes, and the agent's card keeps what was asked for beside what
was granted. If that agent is to run a JSON definition and has none yet,
\`aimeat_crew_seed\` gives it its first one; it is refused when a definition already exists. A
crew that needs a tool of its own, outside the runtime's menu, is a Python crew and not a
definition.

## 3. Changing an agent that runs

\`aimeat_crew_get\` reads the live definition, the draft, the kept revisions and whether the agent
is online. Edit the document, then \`aimeat_crew_validate\` (the agent's own runtime answers, and
its messages go to the owner unchanged), \`aimeat_crew_try\` (one run with a prompt, nothing
stored), \`aimeat_crew_publish\` (live within seconds, the last ten revisions stay restorable).
\`aimeat_crew_draft\` keeps half-finished edits. \`aimeat_crew_llm_set\` chooses the model for one
agent or the owner's default; \`{kind: "node"}\` makes the crew think through this node, so the
owner's own key pays before the node's (the agent needs \`ai:use\`), and a pinned \`model\` may name
only a provider key variable and a public https address. With nothing chosen, an agent holding
\`ai:use\` thinks through this node when the node has a key to pay with; without \`ai:use\`, or with no
key, it uses the key on the machine that runs it, even when the owner's default says the node.
\`aimeat_crew_menu\` answers which choice applies as \`effective\`. Never write \`crews.registry.<agent>\` with \`aimeat_memory_write\`:
it lands in YOUR namespace, where neither the runtime nor the Crew tab looks.

## 4. After it exists

- **Teach it:** attach skills with \`aimeat_skill_link\` (browse \`aimeat_skill_list\` view
  "library" first). Crew runtimes fetch linked skills at start via
  \`GET /v1/agents/{name}/skills\`.
- **Organize it:** tags via \`aimeat_agent_tags_set\`; mode and display via
  \`aimeat_operator_agent_configure\` (propose, then confirm: show the owner the diff).
- **Verify it came online:** \`aimeat_agents_list\`. The new agent's row carries \`last_seen\`,
  \`mode\` and \`tags\`, and \`refusals\`: the calls the node refused it for a scope it lacks. An
  agent that looks connected and does nothing usually has one there. \`aimeat_agent_activity\` and \`aimeat_onboarding_status\` report on the
  CALLING agent only, so neither one can answer for the agent you just added.

## Principles
- Never mint or paste credentials yourself; approval is the owner's own action.
- One agent per purpose beats one agent with every scope.
- The definition is the agent. Propose the two together.
- Build on what the person keeps here. An outside tool or product is never the answer to a
  request this node fulfils itself.
`,
  };
