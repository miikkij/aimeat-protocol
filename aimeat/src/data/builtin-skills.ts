/**
 * @file builtin-skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Built-in node-scope skills seeded into the skills registry at startup —
 *   the starter library every agent on this node can load: operator runbooks and
 *   user-level how-tos for automating node and profile management. Content is embedded
 *   as template strings (no filesystem reads, works from dist). Each entry is a full
 *   SKILL.md (frontmatter + body) following the shared contract; seeding is
 *   create-if-missing so operator edits are never overwritten.
 * @structure BUILTIN_SKILLS — Array<{ name, skillMd, visibility? }>
 * @usage import { BUILTIN_SKILLS } from '../data/builtin-skills.js';
 * @version-history
 *   v1.16.2 -- 2026-09-25 -- diagnose-a-workflow reads a run the node stopped at its spending limit
 *            (maxCostUsd): the run's reason, its costCap, and each step's costUsd. set-up-content-
 *            pipeline sets that limit when steps call the owner's own model.
 *   v1.16.1 -- 2026-09-25 -- aimeat-node-operations says why the admin tools can be missing: they reach
 *            an operator's agent only while it holds operator:admin. That line put this file past
 *            800, so the two runbooks moved unchanged to builtin-skills.runbooks.ts, spread back in
 *            at the same place in the list.
 *   v1.16.0 -- 2026-09-19 -- add-a-crew-agent describes how an agent is made today: a crew
 *     definition proposed with aimeat_agent_propose and approved by the owner, the basic-agents
 *     button, and the aimeat_crew_* chain for an agent that runs. It described device
 *     authorization only, which is now the path for a runtime the owner hosts themselves. No skill
 *     taught the crew tools before this. hatchery-agent-requests is retired for good
 *     (builtin-skills.retired.ts): there is no agent hatchery.
 *   v1.15.2 -- 2026-09-19 -- Content audit of the game skills: aimeat-game-apps still counted six
 *     area skills when the entry skill has named eight since 2026-09-03, sent the reader to the
 *     `phaser` pack that was deprecated in favour of `phaser4`, taught hand-rolled
 *     generateTexture over AIMEAT.phaser.textures, named the raw realtime pack where
 *     AIMEAT.phaser.net already does the wiring, and asked for a tab-hide pause boot.js performs
 *     by itself. Only that skill was touched.
 *   v1.15.1 -- 2026-09-19 -- Content audit: every claim in the inline skills was compared with the
 *     code. What was wrong was advice a gate cannot see — three tools that report only on the
 *     CALLING agent (aimeat_agent_activity, aimeat_onboarding_status, aimeat_task_list) named as the
 *     way to inspect another one, workflow `resume` and `skip_done` stated as the default when both
 *     are opt-in and off, aimeat_schedule_create credited with a workflow kind it does not have, the
 *     human registration route (POST /v1/ghii, not POST /v1/owners), and a profile page label.
 *   v1.15.0 -- 2026-09-18 -- Six conversation skills join from builtin-skills.conversation.ts:
 *     aimeat-first-conversation, aimeat-welcome-pages, aimeat-activating-a-person,
 *     aimeat-offering-choices, aimeat-paying-for-the-ai and aimeat-mail-to-data. They existed only
 *     as hand-published skills on aimeat.io, so a node somebody else stood up had the chat and none
 *     of its guidance. Moved byte for byte, so aimeat.io adopts its own copies on the next boot.
 *   v1.14.1 -- 2026-09-18 -- Three skills called morsels an economy agents spend from; a morsel is a
 *     pacer, not money. aimeat-node-guide names the device-token route, says the token works at
 *     once, and presents the signature mint as the agent's renewal (RFC Core §6.2 step 6, ruled the
 *     same day); the owner-key login is named as the legacy path it is. Instruction review.
 *   v1.14.0 -- 2026-09-02 -- The seven game skills join from builtin-skills-games.ts: aimeat-phaser
 *     (the entry) plus one per area of the library (boot, assets, saves, controls and the HUD,
 *     menus and levels, audio). They are a module for the same reason aimeat-app-builder was in
 *     v1.12.0: this file was at 672 of its 800 lines and the seven are roughly 1500. The
 *     aimeat-game-apps phaser bullet now names aimeat-phaser as the entry skill.
 *   v1.13.0 -- 2026-09-02 -- aimeat-game-apps: phaser4 through aimeat-phaser is the paved path, and
 *     saves are ONE key per player (myapp.save private, myapp.score public), never one per score.
 *   v1.12.0 -- 2026-08-25 -- aimeat-app-builder moves to its own module AND comes back from the
 *     node. Seeding is create-if-missing, which means a built-in skill can be edited in two places
 *     and reconciled in neither: the node's copy had gained a 2.9 kB section on 2026-08-16 ("Say it
 *     in their words" plus the support@operators escalation) that never came back here, and this
 *     file had just gained a pointer the node never saw. A republish either way would have deleted
 *     the other side's work. builtin-skills.app-builder.ts is the merge, and it is a file because
 *     this one was at 789 of its 800 lines.
 *   v1.11.0 -- 2026-08-25 -- aimeat-app-workstation (public): how a large app is kept from the
 *     author's own machine — assets out of the source, sources split behind a build step, and an
 *     edit loop that does not re-read the whole file. aimeat-app-builder says "no build step",
 *     which is true of the node and was read as advice for a 3 MB app; this is the other half.
 *     Seeding is create-if-missing, so an existing node needs an operator republish to pick it up.
 *   v1.10.0 -- 2026-08-23 -- hatchery-agent-requests (public). aimeat_schedule_create and
 *     aimeat_extension_install have both told the reader to load `node:hatchery-agent-requests`
 *     BEFORE building since July, and the skill did not exist: every agent that obeyed got
 *     NOT_FOUND and then built the thing the instruction was written to prevent. Seeding is
 *     create-if-missing, so an existing node needs an operator republish to pick it up.
 *   v1.9.0 -- 2026-08-11 -- aimeat-app-builder gains the spec token (carry it on publish, read
 *     `spec_check`) and what the publish now REFUSES (unparseable inline script, 404 asset URL)
 *     versus what it merely reports as `app_hints`. Seeding is create-if-missing, so an existing
 *     node needs an operator republish to pick this up.
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 4: `ai-transparency` (public) — when to declare, what the
 *     levels mean, how to state human involvement honestly, and what an absent record means when
 *     reading. Small and cheap to load, attachable to any agent. Seeding is create-if-missing, so an
 *     existing node needs an operator republish to pick it up.
 *   2026-07-19 — Research-first flow (AppDev KB Phase 7): Step 0 + tier decision tree + finish checklist / appdev-flow prompt / handbook module
 *   v1.4.0 -- 2026-07-19 -- aimeat-app-builder (public): the paved path for building apps ON
 *     the node over MCP — spec-first, research-before-building (apps/packs/pitfalls), presigned
 *     publish. Canonical home of the skill formerly shipped only inside the OpenHands runtime image.
 *   v1.8.0 -- 2026-08-09 -- aimeat-open-items (public): how to work someone's open-items list with
 *     them. Named by /v1/prompts/open-items, which is where a chat is told to fetch it, so the
 *     per-kind detail and the GO rule can be corrected centrally rather than in the copies people
 *     have already pasted into their chats.
 *   v1.3.0 -- 2026-07-16 -- aimeat-game-apps (public): game/creative-canvas apps with the
 *     phaser/pixi/p5 library packs — engine selection, v8/instance-mode idioms, AIMEAT glue.
 *   v1.2.0 -- 2026-07-14 -- aimeat-node-guide app section: the agent-face paragraph (Accept:
 *     text/markdown on an app URL → the app's markdown read-surface + affordances footer).
 *     Seeding is create-if-missing, so existing nodes need an operator republish to pick this up.
 *   v1.1.0 -- 2026-07-14 -- aimeat-node-guide: the public "start here" skill (visibility public,
 *     listed in the /.well-known/agent-skills discovery index) + per-skill visibility field
 *   v1.0.0 -- 2026-07-05 -- Initial: 4 runbooks (Skills feature Phase 2b)
 *   (2026-08-27) aimeat-app-builder-atelier joins from its own file (TARGET-074): the Atelier
 *   track's paved path, separate from aimeat-app-builder because the two guides never mix.
 */

import { OPEN_ITEMS_SKILL_ENTRY } from './builtin-skills.open-items.js';
import { RECURRING_WORK_SKILL_ENTRIES } from './builtin-skills.recurring-work.js';
import { CONVERSATION_SKILL_ENTRIES } from './builtin-skills.conversation.js';
import { WORKSTATION_SKILL_ENTRY } from './builtin-skills.workstation.js';
import { APP_BUILDER_SKILL_ENTRY } from './builtin-skills.app-builder.js';
import { APP_BUILDER_ATELIER_SKILL_ENTRY } from './builtin-skills.app-builder-atelier.js';
import { GAME_SKILL_ENTRIES } from './builtin-skills-games.js';
import { DECIDE_SKILL_ENTRY } from './builtin-skills.decide.js';
import { RUNBOOK_SKILL_ENTRIES } from './builtin-skills.runbooks.js';

export interface BuiltinSkill {
  name: string;
  skillMd: string;
  /** Registry visibility at seed time. Default 'members'; 'public' additionally allows
   *  anonymous reads and lists the skill in the Agent Skills discovery index. */
  visibility?: 'members' | 'public';
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  OPEN_ITEMS_SKILL_ENTRY,
  ...RECURRING_WORK_SKILL_ENTRIES,
  ...CONVERSATION_SKILL_ENTRIES,
  WORKSTATION_SKILL_ENTRY,
  APP_BUILDER_SKILL_ENTRY,
  APP_BUILDER_ATELIER_SKILL_ENTRY,
  DECIDE_SKILL_ENTRY,
  ...GAME_SKILL_ENTRIES,
  {
    name: 'aimeat-node-guide',
    visibility: 'public',
    skillMd: `---
name: aimeat-node-guide
description: Start here — how to work with this AIMEAT node. Covers what the node is, discovering its interfaces, human registration and login, connecting an AI agent, memory, loading skills and handbooks, building apps, and where every other feature's guide lives. Use when you first encounter an AIMEAT node or need the paved path to any of its features.
license: MIT
metadata:
  audience: agent
---

# Working with this AIMEAT node

AIMEAT (AI Memory Exchange and Action Transfer) is an open protocol for AI-agent
infrastructure. A node gives humans and their AI agents persistent memory, identity,
shared workspaces (organisms), skills, tasks/workflows, app hosting, and morsel
pacing — over plain REST and MCP.

## Discover the node

Fetch these in order of depth; each is self-describing:

1. \`GET /\` with \`Accept: application/json\` (or \`/?format=json\`) — the machine-readable
   getting-started guide: endpoints, auth options, current feature set.
2. \`GET /llms-full.txt\` — the full agent-facing manual for everything on the node
   (\`/llms.txt\` is its index, if you want the map first).
3. \`GET /.well-known/aimeat\` — node id, type, public key, capabilities.
4. \`GET /v1/spec\` — the complete OpenAPI contract; \`GET /.well-known/api-catalog\` links
   every machine interface; \`GET /.well-known/mcp.json\` describes the MCP server.
5. \`GET /.well-known/agent-skills/index.json\` — this index: the node's public skills.

## Identity — three principal types, never confused

- **GHII** \`owner@node-id\` — a human. Owns everything: data, morsel balance, agents.
- **GAII** \`agent#owner@node-id\` — an AI agent with owner-approved scopes and its own trust.
- **GEAI** \`eco:app#owner@node-id\` — an ecosystem app connected with agent-like consent.

## Humans: register and log in

- Register: \`POST /v1/ghii\` with \`{ username, display_name, password, email }\` — it creates the
  owner account and the GHII profile in one step — or use the web portal at \`/\`.
- Log in (web/API): \`POST /v1/ghii/login\` with \`{ username, password }\` → a session JWT.
- An owner holding an older Ed25519 key can still log in with it (\`POST /v1/auth/token\` with
  \`owner\`, a timestamp and a signature). That is a legacy path; the password login above is the
  one to use.

## Agents: connect via device authorization (RFC 8628)

Agents are never created implicitly. The paved path:

1. The agent calls \`POST /v1/agents/device-authorize\` and shows the returned code.
2. The owner approves it in the portal (profile → Agents), selecting least-privilege scopes.
3. The agent polls \`POST /v1/agents/device-token\` and receives its access token, its GAII and
   its Ed25519 key. The token works at once, with the full approved scope.
4. To renew without a new approval, the agent signs \`gaii + timestamp\` with its key and calls
   \`POST /v1/auth/token\`. The node issues the scopes as the owner has them set at that moment,
   so narrowing them or removing the agent takes effect at once.

Connected agents use REST (Bearer JWT) or MCP at \`POST /v1/mcp\` (streamable-http, OAuth —
tools are named \`aimeat_*\`). New agents: run the onboarding checks
(\`aimeat_onboarding_status\`) and read your handbook first.

## Handbooks — the per-feature manuals

- \`GET /v1/agents/me/handbook\` — your operating handbook: directives, task queue, economy.
- \`GET /v1/agents/me/handbook/{module}\` — deep dives: tasks, messages, work, services,
  memory, activity, social, collaboration, appdev, mcp.
- \`GET /v1/agents/me/handbook/offerings\` — publishing offers and workflow-compatible services.
- MCP equivalent: \`aimeat_handbook_get\`.

## Memory — where all data lives

Everything is a memory record under an identity, keyed by namespaced paths
(\`settings.\`, \`agents.{name}.\`, \`organism.{org}.w.{ws}.\`). Read/write via
\`GET|POST /v1/memory\` or \`aimeat_memory_read|write|list|search\`. Visibility ladder:
private < owner < group < workspace < members < public. Raise visibility only with the
owner's explicit confirmation.

## Skills — load expertise on demand

This node runs a skills registry (SKILL.md packs, Anthropic-compatible):

- Browse: \`GET /v1/skills\` (your library: node + personal + workspace scopes) or
  \`aimeat_skill_list\`.
- Load one: \`GET /v1/skills/{name}\` or \`aimeat_skill_get\` — apply what it teaches.
- Attach to an agent: \`aimeat_skill_link\` — links are references, always fetched fresh.
- Install elsewhere: \`GET /v1/skills/{name}/zip\` is upload-ready for Claude-style skill dirs.

Start with \`manage-my-agents\`, \`manage-my-profile-data\`, and \`use-app-bound-skills\`
from the node library.

## Build and publish apps

- \`GET /v1/prompts/build-app\` (public; \`?format=txt\` for plain text) — the canonical guided
  prompt for building a single-file HTML app on this node.
- \`GET /v1/app-templates\` — starter scaffolds. Publish with \`POST /v1/apps\`;
  browse the catalog at \`/app-catalog.html\`. Apps can bind skills that teach agents to
  drive them — check \`GET /v1/apps/{owner}/{filename}/skills\` before operating any app.

Every published app also has an **agent face** — request its URL with
\`Accept: text/markdown\` (or \`?format=md\`) and the node serves the app's markdown
read-surface instead of HTML: the app's declared face record when it publishes one, else
the converted page, always ending in an "Agent affordances" footer that links the app's
WebMCP tools, its bound skills, and agent registration. Read the face first; act through
the tools; load the bound skill for anything deeper — never scrape the app's HTML.

## Everything else

Organisms (shared workspaces), agent tasks and workflows, offers and commerce, knowledge,
and federation each have a handbook module or llms-full.txt section — discover them from steps
1-2 above. Morsels are a pacer, not money: the owner holds one balance, it accrues each day and
through what they contribute, and what their agents write and call draws on it
(\`aimeat_wallet_balance\`).

## Principles

- Read before you write; propose before you change the owner's data.
- Use the paved paths above instead of guessing endpoints — every list here is served
  fresh by the node itself.
`,
  },
  {
    name: 'ai-transparency',
    visibility: 'public',
    skillMd: `---
name: ai-transparency
description: How to declare and read AI provenance on an AIMEAT node — when to declare, what the levels mean, how to state human involvement honestly, and what a publishing surface does with your declaration. Use whenever you write content a person may read, or read content back and need to say how it was made.
license: MIT
metadata:
  audience: agent
---

# Saying how content was made

This node records how every piece of content was made. You are part of that record, and
the rules are short.

## The one thing to remember

**Silence is recorded as model-written.** When a non-human principal writes content and
declares nothing, the node stamps it \`ai-generated\` with \`humanInvolvement: none\`, marks
that the stamp was inferred rather than observed, and moves on. That default is deliberate:
the alternative — reading silence as "a person wrote this" — would be a false statement
about authorship, and it is the one mistake that cannot be corrected later.

So the case that needs you to speak up is **relaying a person's words**. If you are
copying, forwarding or transcribing what a human wrote, say so.

## Declaring

Every write tool takes an optional \`ai_provenance\` block:

\`\`\`json
{
  "level": "ai-generated",
  "method": "summarized",
  "human_involvement": "none",
  "model": "anthropic/claude-opus-5",
  "sources": [{ "url": "https://…", "role": "primary" }]
}
\`\`\`

Only \`level\` is required once you send the block. The node fills in who you are, which
node, when, and a hash of the exact bytes — you are never asked to assert those, and
anything you do say about identity is discarded.

Declaring needs the \`provenance:write\` scope, because a declaration can assert that a
person wrote or reviewed something. If you do not hold it, the call is refused with that
message; omit the block and the node records what it observed instead. Recording is never
gated — only asserting is.

## \`level\` — how much of the content a model made

| Value | Means |
|---|---|
| \`original\` | A person wrote it. No model involved. Use this when you relay human text. |
| \`assisted\` | A person wrote it; a model edited, refined or filled in. |
| \`synthesized\` | A model combined real sources into new content, at someone's direction. |
| \`ai-generated\` | A model produced it. |

## \`human_involvement\` — whether anyone checked

This is the field that decides whether a visible label is owed, so be strict with it.

| Value | Means |
|---|---|
| \`none\` | Nobody read the substance before it went out. |
| \`light-review\` | Someone glanced: spelling, formatting, a skim. |
| \`editorial-control\` | A person examined the substance and could approve, alter or reject it. |
| \`full-human\` | A person authored or rewrote it. |

**Only a step where a person reads the substance and can reject it counts.** Clicking
publish is not that step. An owner approving a queue of twenty items in one gesture is not
that step. If you are unsure whether review happened, it did not — say \`none\`.

Note that \`level\` and \`human_involvement\` are independent. \`assisted\` + \`none\` is not a
contradiction: it means a person wrote it, a model edited it, and nobody checked what the
model did.

## Reading it back

Read tools return an \`ai_provenance\` block beside the content — \`aimeat_memory_read\`,
\`aimeat_workspace_read\` (when you open records by id), \`aimeat_knowledge_get\`,
\`aimeat_dm_thread\`, \`aimeat_exchange_offering_get\`.

**An absent block means the origin is UNSTATED.** It does not mean a person wrote it. If
you are summarising several items for a person, you can say "two of these were written by
a model" only for the ones that carry a record; for the rest, say the origin is not stated.

Each record carries a pre-rendered \`disclosure\` with the exact words the node uses, in
every language it ships. Quote those rather than composing your own — they are compliance
text, not description.

## What the publishing surfaces do with it

- A public page renders the EU AI transparency label when the record says one is owed.
- The served HTML carries machine-readable marks and a link to the addressable record at
  \`/v1/provenance/<id>\`, which anyone can resolve without an account once the content is public.
- Markdown faces carry the record in frontmatter and one human-readable line in the body.
- The record is joined to the exact bytes by a SHA-256 hash, so a third party holding the
  content can ask this node whether it produced them.

## What never goes in a record

Prompt text and anything private or commercially sensitive. The record is published
alongside the content it describes. Keep \`notes\` to what a reader needs in order to
interpret the rest.

## The node's statement

\`GET /v1/ai-transparency\` is this node's machine-readable transparency statement.
`,
  },
  ...RUNBOOK_SKILL_ENTRIES,
  {
    name: 'manage-my-profile-data',
    skillMd: `---
name: manage-my-profile-data
description: User-level runbook for the owner's data on an AIMEAT node — reading and writing memory, choosing visibility levels, sharing via consents, and finding content with discovery. Use when the owner asks what data they have, how to share or protect it, or where something is stored.
license: MIT
metadata:
  audience: owner
---

# Manage my profile data

## Where data lives
Everything is MEMORY records under the owner's identity (GHII) or their agents' identities
(GAII). Keys are namespaced paths (e.g. \`settings.\`, \`agents.{name}.\`, \`organism.{id}.w.{ws}.\`).

## Common tasks
- **What do I have?** \`aimeat_memory_list\` (prefix filters), \`aimeat_memory_search\` for
  content search, \`aimeat_discover\` for a cross-domain map.
- **Read/write:** \`aimeat_memory_read\` / \`aimeat_memory_write\`.
- **Visibility ladder** (low → high reach): private < owner < group < workspace < members < public.
  \`public\` is federated — visible beyond this node. \`workspace\` is a REST-only tier today:
  \`aimeat_memory_write\` takes the other five. Never raise visibility without the
  owner's explicit confirmation.
- **Sharing with people/organisms:** consents (\`aimeat_consent_grant\` / \`aimeat_consent_list\` /
  \`aimeat_consent_revoke\`) grant scoped read access without copying data.

## Principles
- Data is the owner's: propose, show the exact key + visibility change, then act on confirmation.
- Prefer consent grants over visibility increases when sharing with a specific party.
`,
  },
  {
    name: 'add-a-crew-agent',
    skillMd: `---
name: add-a-crew-agent
description: How a new agent comes into being on an AIMEAT node. You design it as a crew definition (a JSON document of roles, tasks and tools), propose it with aimeat_agent_propose, and the owner approves it with one press. Also covers the two agents every owner can create from a button, connecting a runtime of your own by device authorization, changing a running agent's definition, scopes, skills, tags, and checking that it came online. Use when the owner wants a new agent, a new crew, or a new AI runtime connected.
license: MIT
metadata:
  audience: operator
---

# Add a crew agent

An agent is never created implicitly, and never by another agent alone. Adding one changes the
owner's account, so the last step is always the owner's own press. Everything before it is yours.

## 0. Look before you add

\`aimeat_agents_list\` shows what the owner already has. \`aimeat_agent_basics_get\` says whether
the two basic agents exist: \`concierge\`, which answers what arrives, and \`workflow-manager\`,
which orders work from the owner's other agents. If they are missing and would do the job,
\`aimeat_agent_basics_request\` puts one line on the owner's open items, and the button behind it
creates both with their definitions. Design a new agent only for a job those two do not cover.

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
   (it is the sentence they read), \`scopes\`, \`mode\`, \`run_mode\` and the \`crew_def\`. The
   definition is checked before the proposal is written, so a broken one is refused now. Nothing
   is created. One line appears on the owner's open items.
4. **The owner presses approve.** That one press creates the agent, gives it the definition and
   hands it to the owner's connector, which runs it on the owner's own machine
   (\`aimeat connect serve\`). The answer says which of four states it ended in. If the connector
   could not be reached, the agent exists with its instructions and nothing runs it: the owner
   starts the connector and presses Attach.

Always send the \`crew_def\`. An agent approved without one exists and cannot start, and
\`aimeat_crew_publish\` cannot repair that, because publishing asks the agent's own runtime to
validate and a new agent has none.

**Scopes and modes.** Name each scope, never \`*\`, and never more than you hold yourself. An agent
that reads and writes the owner's memory needs \`memory:read\` and \`memory:write\`; one that takes
queued work also needs \`work:read\` and \`work:accept\`. \`mode: "task-runner"\` lets a queued task
start without asking the owner each time, so say that in the purpose. \`run_mode: "spawn"\` starts
a worker per piece of work and suits bursty jobs; \`"resident"\` stays up and suits a front door.

## 2. A runtime of your own: device authorization

For a Python crew built on \`aimeat-crewai\`, or any other runtime the owner hosts themselves, the
agent side starts device authorization (RFC 8628): \`POST /v1/agents/device-authorize\`, which the
runtime or the connect CLI does, and it shows a code. The owner approves in profile → Agents and
chooses the scopes. If that agent is to run a JSON definition and has none yet,
\`aimeat_crew_seed\` gives it its first one; it is refused when a definition already exists. A
crew that needs a tool of its own, outside the runtime's menu, is a Python crew and not a
definition.

## 3. Changing an agent that runs

\`aimeat_crew_get\` reads the live definition, the draft, the kept revisions and whether the agent
is online. Edit the document, then \`aimeat_crew_validate\` (the agent's own runtime answers, and
its messages go to the owner unchanged), \`aimeat_crew_try\` (one run with a prompt, nothing
stored), \`aimeat_crew_publish\` (live within seconds, the last ten revisions stay restorable).
\`aimeat_crew_draft\` keeps half-finished edits. \`aimeat_crew_llm_set\` chooses the model for one
agent or the owner's default. Never write \`crews.registry.<agent>\` with \`aimeat_memory_write\`:
it lands in YOUR namespace, where neither the runtime nor the Crew tab looks.

## 4. After it exists

- **Teach it:** attach skills with \`aimeat_skill_link\` (browse \`aimeat_skill_list\` view
  "library" first). Crew runtimes fetch linked skills at start via
  \`GET /v1/agents/{name}/skills\`.
- **Organize it:** tags via \`aimeat_agent_tags_set\`; mode and display via
  \`aimeat_operator_agent_configure\` (propose, then confirm: show the owner the diff).
- **Verify it came online:** \`aimeat_agents_list\`. The new agent's row carries \`last_seen\`,
  \`mode\` and \`tags\`. \`aimeat_agent_activity\` and \`aimeat_onboarding_status\` report on the
  CALLING agent only, so neither one can answer for the agent you just added.

## Principles
- Never mint or paste credentials yourself; approval is the owner's own action.
- One agent per purpose beats one agent with every scope.
- The definition is the agent. Propose the two together.
`,
  },
  {
    name: 'set-up-content-pipeline',
    skillMd: `---
name: set-up-content-pipeline
description: Operator runbook for setting up a recurring content pipeline on an AIMEAT node — chaining agents with a workflow definition, scheduling it, and delivering results into a workspace. Use when the owner wants recurring produced content (reports, digests, articles) from their agents.
license: MIT
metadata:
  audience: operator
---

# Set up a content pipeline

A pipeline = a WORKFLOW definition (chained steps dispatched to agents) + a TRIGGER
(schedule) + a DESTINATION (workspace records/documents).

1. **Check the workers:** \`aimeat_agents_list\` — which agents exist, their capabilities and
   linked skills (\`aimeat_skill_list\` view "linked"). Attach domain skills first
   (e.g. an editorial-style skill) so output quality is set by reference, not by prompt copies.
2. **Author the workflow:** \`aimeat_workflow_get\` an existing one as a template, then
   \`aimeat_workflow_save\`. Steps signal each other through memory keys; set \`resume: true\` in
   the definition to have the engine re-evaluate steps against reality on retry, which is off
   by default (the default is restart-and-skip).
3. **Dry-run:** \`aimeat_workflow_run\` with \`mode: "signals-only"\` before scheduling.
4. **Schedule the trigger:** the trigger is part of the definition, not a separate schedule —
   put \`trigger: { kind: "schedule", cron: "0 7 * * *", timezone: "Europe/Helsinki" }\` in the
   \`aimeat_workflow_save\` descriptor and the save creates the backing cron; verify with
   \`aimeat_workflow_get\`.
5. **Deliver to a workspace:** the final step writes via \`aimeat_workspace_write\` (drafts) —
   publish stays a human decision unless the owner says otherwise.

## Principles
- Show the owner the workflow definition BEFORE saving; \`aimeat_workflow_save\` is a write.
- Start with a manual run, then schedule.
- When steps call the owner's own model (\`action.kind: "ai"\`), set \`maxCostUsd\` on the
  definition: a run that goes wrong then stops before its next ai step at a known cost, and says
  so on the run.
`,
  },
  {
    name: 'configure-routing',
    skillMd: `---
name: configure-routing
description: Operator runbook for inspecting and adjusting how AI calls are routed and budgeted on an AIMEAT node — which provider/models are available, per-user AI budgets, and which agent handles which work. Use when the owner asks about AI providers, model routing, spend, or "which agent should do X".
license: MIT
metadata:
  audience: operator
---

# Configure routing & budget

Three separate "routing" layers — identify which one the owner means:

1. **AI provider/model routing** (whose key, which models): configured per-owner in
   profile → AI. Inspect availability via \`GET /v1/ai/available\`;
   spend history via \`GET /v1/ai/usage/history\` (surfaced on the Home usage card and the
   admin AI-usage tab). Changing the provider/key is an owner UI action — guide, don't do.
2. **Work routing** (which agent does what): driven by agent capabilities, tags, and offers.
   Inspect with \`aimeat_agents_list\` + \`aimeat_agent_profile\`; adjust tags/mode via
   \`aimeat_operator_agent_configure\` (propose-then-confirm) and teach specialization by
   linking skills (\`aimeat_skill_link\`).
3. **Morsel balance** (the pacer, not money): \`aimeat_wallet_balance\` / \`aimeat_wallet_transactions\` for
   the owner's balance; escrow holds show as in_escrow.

## Principles
- Model routing and the daily budget go through \`aimeat_operator_ai_config\`: call it without
  \`confirm_token\` to get current/proposed/diff, show the owner the diff, then call again with
  the token. The API key can never be read or changed through it.
- When spend looks wrong, correlate \`/v1/ai/usage/history\` with schedules (\`aimeat_schedule_list\`)
  before blaming a model.
`,
  },
  {
    name: 'use-app-bound-skills',
    skillMd: `---
name: use-app-bound-skills
description: How to discover and load the skills bound to an AIMEAT app before driving it — and how to bind one when you author app expertise. Use whenever you are asked to operate, automate, or build on top of a published app.
license: MIT
metadata:
  audience: agent
---

# Use app-bound skills

An AI-boosted app's usage knowledge lives WITH the app as bound skills, not in your prompt.
Before driving any app, check for them.

## Before operating an app
1. \`aimeat_skill_list\` with \`binding: "app:{owner}/{filename}"\` (or
   \`GET /v1/apps/{owner}/{filename}/skills\`) — the skills that teach this app.
2. If any exist, load each with \`aimeat_skill_get\` and APPLY it — a description saying
   "use whenever operating X" is required reading, not optional.
3. Nothing bound? Proceed with the app's own docs, and consider authoring a skill once you
   have learned the app (below) so the next agent starts smarter.

## Authoring app expertise
Put the binding in the SKILL.md frontmatter so it travels with the skill:

    ---
    name: my-app-guide
    description: How to use {app} well. Use whenever operating {app}.
    metadata:
      binding: app:{owner}/{filename}
    ---

Publish with \`aimeat_skill_publish\`. Owners can also attach/detach an existing skill from
the profile Apps tab. The app catalog shows bound skills on the app's detail page.

## Principles
- One skill per app, focused on OPERATING it (workflow, data keys, quirks) — not a copy of
  the app's marketing description.
- Update the skill when the app changes; republish bumps the version, and consumers always
  fetch fresh.
`,
  },
  {
    name: 'install-skills-locally',
    skillMd: `---
name: install-skills-locally
description: How to install an AIMEAT registry skill into Claude Code, Claude Desktop/Cowork, or claude.ai — and how to check for updates. Use when the owner asks to "install" a skill from the node, or wants a registry skill available without the AIMEAT connector.
license: MIT
metadata:
  audience: agent
---

# Install AIMEAT skills locally

AIMEAT's SKILL.md contract IS the Anthropic agent-skill format, so installing = writing the
skill's files where that Claude reads skills from. (With the AIMEAT connector attached you
often need NO install: \`aimeat_skill_get\` loads expertise on demand. Install when the skill
should work without the connector, or auto-trigger via Claude's native skill discovery.)

## Claude Code / Claude Desktop Cowork (filesystem available)
1. \`aimeat_skill_get\` with the ref (pin it: \`user:{owner}/{name}@{version}\` for stability).
2. Write each file of \`fileContents\` under:
   - personal (all projects): \`~/.claude/skills/{name}/\`
   - project-scoped: \`{repo}/.claude/skills/{name}/\`
3. Stamp provenance INTO the SKILL.md frontmatter metadata so updates are checkable:
   \`aimeat_ref: {ref}@{version}\` and \`aimeat_node: {node url}\`.
4. CLI alternative (no MCP needed): \`aimeat skill install {ref} [--dir <path>] [--project]\`.

## claude.ai / Claude Desktop chat (no filesystem)
- Zero-install: keep using \`aimeat_skill_get\` through the connector.
- Real install: download \`GET /v1/skills/{name}/zip\` (the profile/workspace Skills tabs have
  a Download .zip button) and upload it in claude.ai Settings → Skills — the ZIP is already in the
  expected \`{name}/SKILL.md\` layout.

## Checking for updates
1. Read the local SKILL.md's \`metadata.aimeat_ref\` (e.g. \`node:manage-my-agents@1.0.0\`).
2. \`aimeat_skill_get\` with \`manifest_only: true\` on the UNPINNED ref — compare \`version\`.
3. Newer? Re-fetch and overwrite the local directory (remove files not in the new index).

## Principles
- Always stamp provenance — an unstamped local skill cannot be updated or traced.
- Prefer pinned installs for anything production-critical; latest for personal convenience.
`,
  },
  {
    name: 'diagnose-a-workflow',
    skillMd: `---
name: diagnose-a-workflow
description: Runbook for diagnosing AIMEAT agent workflows — a run that stalled, a step that timed out, or a schedule that did not fire. Use when the owner reports a workflow or scheduled job misbehaving.
license: MIT
metadata:
  audience: owner
---

# Diagnose a workflow

## Steps
1. **Get the definition:** \`aimeat_workflow_get\` with the workflow id — read the step chain,
   triggers, and signal conditions.
2. **Dry-run the signals:** \`aimeat_workflow_run\` with \`mode: "signals-only"\` — evaluates each
   step's signals against current memory WITHOUT dispatching work. A step whose signal never
   becomes true is usually the stall point.
3. **Check the trigger:** \`aimeat_workflow_get\` returns the trigger and the recent runs. A
   workflow's backing cron is not in \`aimeat_schedule_list\`, which returns only the schedules an
   agent created. Every user schedule logs each run; only the node's internal \`core\` ticks leave
   their successes out of the log.
4. **Check the worker:** \`aimeat_agents_list\` for the agent a step dispatches to — is it
   connected and seen recently (\`last_seen\`, \`mode\`)? \`aimeat_agent_activity\` and
   \`aimeat_task_list\` report on the CALLING agent only, so neither reads the worker's queue.
5. **Retry semantics:** both are flags on the definition and both are off unless the workflow
   sets them — \`resume: true\` re-evaluates steps against reality instead of restart-and-skip,
   and \`skip_done: true\` leaves a step whose output already exists alone. Safe to suggest a
   retry after fixing the cause.
6. **A run the node ended itself:** status \`stopped\` means the run reached its spending limit
   (\`maxCostUsd\`, US dollars per run): its \`reason\` and \`costCap\` say what the ai steps had spent
   and which ai step did not start, and each step carries its own \`costUsd\`. Raising the limit
   is a change to the definition, so it waits for the owner like any other.

## Principles
- Diagnose before touching: collect the evidence from steps 1-4 and present the likely cause.
- Fixes that change the workflow definition go through \`aimeat_workflow_save\` only after the
  owner confirms the diff.
`,
  },
  {
    name: 'aimeat-game-apps',
    visibility: 'public',
    skillMd: `---
name: aimeat-game-apps
description: Build 2D games and creative-canvas apps on an AIMEAT node with the self-hosted library packs — phaser4 through aimeat-phaser (full game engine), pixi (fast 2D WebGL rendering) and p5 (creative coding). Covers pack selection, the correct modern API idioms per engine, single-file-app asset strategy, AIMEAT high-score/leaderboard glue, and realtime multiplayer wiring. Use when the owner wants a game, arcade, generative-art or heavy-2D-animation app.
license: MIT
metadata:
  audience: agent
---

# Building game & creative-canvas apps

The node self-hosts three engines as library packs — fetch each pack's live doc before
coding: \`GET /v1/library-packs/phaser4\` (or \`pixi\` / \`p5\`). Never load engines
from an external CDN; the include line in the pack doc points at this node's /lib/ copy.

## Pick the right engine

- **phaser4** (\`GET /v1/library-packs/phaser4\`) — a GAME: scenes, physics, collisions, input,
  score, sound. The default for games. **Load the skill \`node:aimeat-phaser\` first: it is the
  entry point, and it names the eight area skills (boot, assets, saves, controls and the HUD, menus
  and levels, audio and juice, the world, the story) for whichever part you are working on.** Load the library THROUGH \`aimeat-phaser\`
  (\`GET /v1/library-packs/aimeat-phaser\`): \`AIMEAT.phaser.game()\` boots into an element with
  fit / resize / fixed scaling and fullscreen, \`textures\` generate tiles and a character with
  animations, \`preloadPack\` draws the loading bar, \`audio\` is the bus, \`saves\` is the
  memory shape, \`controls\` unifies keyboard, gamepad and touch, \`titleScene\` / \`menuItems\` /
  \`pauseMenu\` / \`transition\` are the menus, \`platformer\` turns an ASCII map into a level and
  \`settingsPanel\` is the settings page on the Atelier kit. The Design Book's Phaser page shows
  each one running; copy from there rather than from memory. The old \`phaser\` pack is v3 and
  stays only for the games that name it.
- **pixi** — heavy 2D RENDERING without game logic: particles, dashboards with thousands of
  moving sprites, visual effects. You write the loop; no physics/input engine. NOTE v8 API:
  async \`app.init()\`, \`app.canvas\`, Graphics \`shape().fill()\` chain, \`PIXI.Assets.load\`.
- **p5** — CREATIVE CODING: generative art, sketches, playful interactions. Instance mode only.
- Plain drawing (brush/undo/save): the \`aimeat-canvas\` cortex is lighter than any of these.

## Single-file-app asset strategy

Published AIMEAT apps are one HTML file — avoid external asset files entirely:
- Phaser: \`AIMEAT.phaser.textures.tiles(this)\` and \`textures.character(this, { key: 'hero' })\`
  draw the art on the page's own colours, and \`textures.shapes()\` takes anything else you draw.
  A game not using \`aimeat-phaser\` generates its own from Graphics (\`g.generateTexture('name', w, h)\`).
- Sound: the \`aimeat-audio\` SDK lib (instruments + synth) instead of audio files.
- If real images are needed, upload once via \`AIMEAT.storage\` (public) and load by URL.

## AIMEAT glue that makes it a platform app (not just a canvas)

- **Saves, scores, levels, settings**: ONE private memory key per player
  (\`myapp.save\`: { version, profile, settings, levels, scores, inventory }) and ONE public
  key per player for the leaderboard (\`myapp.score\`: { name, best, level, updated }), read
  across owners with \`AIMEAT.data.search('myapp.score')\`. \`AIMEAT.phaser.saves()\` does
  exactly this, keeps a guest copy in the browser until sign-in and merges it then, and
  version-gates the record. Never one key per score or per level: the budget is 1000 keys per
  person.
- **Multiplayer**: in a Phaser game, \`AIMEAT.phaser.net({ room, app, onPeer, onInput })\` already
  does the wiring (find or make the room, elect the host as the lowest peer id, throttle and
  change-gate \`sendInput\`); add \`/lib/realtime.js\` to the page and sign in first, because a
  room belongs to an account. Anywhere else, the \`realtime\` pack itself (AimeatRealtime rooms —
  WS + WebRTC + Yjs): broadcast inputs/state deltas, never frames; throttle to ~30ms; register
  handlers BEFORE connect().
- **Theme**: read the app CSS variables for colors so the game respects light/dark.

## Checklist before publishing

1. Boots from a cold load while signed OUT (game playable; saving prompts sign-in).
2. Works at mobile width (Phaser Scale.FIT / p5 windowResized / pixi resizeTo).
3. Pauses when the tab hides (battery): \`AIMEAT.phaser.game()\` already does this unless you
   passed \`pauseOnHide: false\`; \`h.sleep()\` / \`h.wake()\` are for your own pauses.
4. High-score write → read back → visible on the leaderboard without a reload.
`,
  },
];
