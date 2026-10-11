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
 *   v1.25.3 -- 2026-10-11 -- add-a-crew-agent moves unchanged to builtin-skills.crew-agent.ts (max-file-lines).
 *   v1.25.2 -- 2026-10-11 -- add-a-crew-agent: "What it offers". A definition's first `offers`
 *     entry is published by the crew runtime at each start, which is what puts the agent on the
 *     owner's offers page; the node completes an entry and adds one when there is none.
 *   v1.25.1 -- 2026-10-11 -- add-a-crew-agent, step 4: the approval gives the new agent its work
 *     once, as a task with its name and its purpose, so the purpose is written to read as that task.
 *   v1.25.0 -- 2026-10-11 -- diagnose-a-workflow: an agent the owner stopped is not reachable for a
 *     step and its scheduled run is skipped with outcome `stopped`; start it with aimeat_agent_start.
 *   2026-10-11 — The word a person reads for a connector is "computer" (laptop, server, cloud, AIMEAT instance), never "machine" (Jouni, 2026-10-11).
 *   v1.24.0 -- 2026-10-10 -- add-a-crew-agent: which machine. aimeat_connector_list names the owner's
 *     connectors, the proposal's `connector` orders the agent to one, and it waits for that one.
 *   v1.23.8 -- 2026-10-08 -- set-up-content-pipeline names an extension step's input_from (and the
 *     memory:read it costs); diagnose-a-workflow reads an input field that arrived null.
 *   v1.23.7 -- 2026-10-08 -- add-a-crew-agent: an agent approved with no connector connected waits and
 *     gets its key when the connector next connects; Attach is for a connector that refused it.
 *   v1.23.6 -- 2026-10-05 -- diagnose-a-workflow: a run's ai steps ask the model as its aiCaller, so
 *     the owner's rules for that agent or app apply (secaudit 2026-10, AI-3).
 *   v1.23.5 -- 2026-10-05 -- diagnose-a-workflow: a 402 QUOTA_EXHAUSTED on the node's key names a
 *     spent allowance or an operator's daily cap (secaudit 2026-10, AI-1).
 *   v1.23.4 -- 2026-10-02 -- add-a-crew-agent: a resident proposal is stored as spawn where the connector
 *     runs by spawning, and a proposal carries ai:use when the owner's crews think through the node.
 *   v1.23.3 -- 2026-10-02 -- add-a-crew-agent: a crew agent needs memory:read and memory:write, and
 *     the node adds both to every proposal and approval.
 *   v1.23.2 -- 2026-10-02 -- add-a-crew-agent: with nothing chosen, an agent holding ai:use thinks
 *     through the node when the node can pay; the menu's `effective` says which choice applies.
 *   v1.23.1 -- 2026-10-02 -- diagnose-a-workflow: an AI refusal carries `fix` and `settingsUrl` for
 *     the owner.
 *   v1.23.0 -- 2026-10-02 -- add-a-crew-agent: aimeat_crew_llm_set's {kind:"node"} choice and the
 *     rules a pinned model is held to; an agent's own runtime report needs no agent:write either.
 *   v1.22.1 -- 2026-10-02 -- add-a-crew-agent: a crew agent needs memory:write and no agent:write;
 *     its own tags need no word.
 *   v1.22.0 -- 2026-10-02 -- add-a-crew-agent: the node makes the agent, so never an outside builder;
 *     read the organisms and workspaces it will work on before designing; hand the person the
 *     approval address; a clock comes after, as an agent_task schedule.
 *   v1.21.0 -- 2026-10-01 -- aimeat-organisms (builtin-skills.organisms.ts): what an organism is for,
 *     the starting shapes, access, and how a place stays current.
 *   v1.20.0 -- 2026-10-01 -- aimeat-guided-journey (builtin-skills.guided-journey.ts): the path in seven
 *     stages, walked by the person's own AI one stage per conversation.
 *   v1.19.0 -- 2026-09-30 -- aimeat-node-guide and add-a-crew-agent: name the scopes in device-authorize
 *     (none gives the default set, which cannot take work), and a refused call is kept on the card, the
 *     open tasks, aimeat_agents_list `refusals` and GET /v1/agents/{name}/refusals.
 *   v1.18.1 -- 2026-09-29 -- The app-building skill points to the app catalogue at /v1/appcat instead of /app-catalog.html (Jouni).
 *   v1.18.0 -- 2026-09-29 -- aimeat-refinery (builtin-skills.refinery.ts): the mail refinery from chat.
 *   v1.17.0 -- 2026-09-28 -- aimeat-ai-capabilities (builtin-skills.ai-capabilities.ts), System 2 plan V5;
 *            set-up-content-pipeline names the ai step's op (image, transcribe).
 *   v1.16.11 -- 2026-09-28 -- diagnose-a-workflow names the refusal reason too-costly (model catalogue, V4).
 *   v1.16.10 -- 2026-09-28 -- ai-transparency and configure-routing move to builtin-skills.ai.ts, unchanged
 *            and in the same places of BUILTIN_SKILLS (pure move; the file was at 800 lines).
 *   v1.16.9 -- 2026-09-28 -- ai-transparency says what the node records by itself: pictures and
 *            transcripts now get an observed provenance record like text and speech (System 2, V1).
 *   v1.16.8 -- 2026-09-26 -- diagnose-a-workflow reads a step's openCalls, which hold until the call
 *            answers, and an estimate of one attempt; set-up-content-pipeline says a step expected to
 *            cost more than the whole limit runs once, alone.
 *   v1.16.7 -- 2026-09-26 -- diagnose-a-workflow reads costCap.neededUsd, estimateUsd and reservedUsd,
 *            and an ai step left pending while another runs; set-up-content-pipeline says an ai
 *            step starts only when its expected cost fits under maxCostUsd.
 *   v1.16.6 -- 2026-09-26 -- diagnose-a-workflow: a stopped run's costCap is what the run spent on AI,
 *            the judging of its llm signals included, and the run carries that part as signalCostUsd.
 *   v1.16.5 -- 2026-09-26 -- ai-transparency asks the declarer to name its own model, and names the
 *            publish hint a declaration without one gets.
 *   v1.16.4 -- 2026-09-25 -- set-up-content-pipeline: a step that dispatches to an agent costs
 *            work:request of whoever saves the workflow.
 *   v1.16.3 -- 2026-09-25 -- diagnose-a-workflow reads a refused trigger start; set-up-content-pipeline
 *            says the schedule runs on the saver's permissions.
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
import { GUIDED_JOURNEY_SKILL_ENTRY } from './builtin-skills.guided-journey.js';
import { ORGANISMS_SKILL_ENTRY } from './builtin-skills.organisms.js';
import { WORKSTATION_SKILL_ENTRY } from './builtin-skills.workstation.js';
import { APP_BUILDER_SKILL_ENTRY } from './builtin-skills.app-builder.js';
import { APP_BUILDER_ATELIER_SKILL_ENTRY } from './builtin-skills.app-builder-atelier.js';
import { GAME_SKILL_ENTRIES } from './builtin-skills-games.js';
import { DECIDE_SKILL_ENTRY } from './builtin-skills.decide.js';
import { REFINERY_SKILL_ENTRY } from './builtin-skills.refinery.js';
import { RUNBOOK_SKILL_ENTRIES } from './builtin-skills.runbooks.js';
import { CREW_AGENT_SKILL_ENTRY } from './builtin-skills.crew-agent.js';
import { AI_TRANSPARENCY_SKILL_ENTRY, CONFIGURE_ROUTING_SKILL_ENTRY, AI_MODEL_POLICY_SKILL_ENTRY } from './builtin-skills.ai.js';
import { AI_CAPABILITIES_SKILL_ENTRY } from './builtin-skills.ai-capabilities.js';

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
  GUIDED_JOURNEY_SKILL_ENTRY,
  ORGANISMS_SKILL_ENTRY,
  WORKSTATION_SKILL_ENTRY,
  APP_BUILDER_SKILL_ENTRY,
  APP_BUILDER_ATELIER_SKILL_ENTRY,
  DECIDE_SKILL_ENTRY,
  REFINERY_SKILL_ENTRY,
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

Name the scopes the agent needs in step 1 (\`scopes\`): an agent that names none gets the node's
default set, which cannot take work. The owner's agent card shows what was asked for beside what
was granted. A call the node refuses for a missing scope answers 403 \`SCOPE_DENIED\` and is kept:
on the owner's agent card, on the agent's open tasks, and for the agent at
\`GET /v1/agents/{name}/refusals\` (with \`since\`, a run's own window).

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
  browse the catalog at \`/v1/appcat\`. Apps can bind skills that teach agents to
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
  AI_TRANSPARENCY_SKILL_ENTRY,
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
  CREW_AGENT_SKILL_ENTRY,
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
  definition: an ai step then starts only when what one attempt is expected to cost fits in what
  is left, so a run that goes wrong stops at a known cost, and says so on the run. A step expected
  to cost more than the whole limit still runs once, alone. An ai step can also make a picture
  (\`op: "image"\`) or transcribe a stored recording (\`op: "transcribe"\`, \`audio_key\`); check the
  capability with \`aimeat_ai_capabilities\` before saving, because one that is off stops the step.
- The schedule runs on the saver's permissions. The agent that saves the workflow must keep every
  permission its steps need; if the owner later takes one away, the scheduled run is refused and
  the owner is asked, once. Chaining agents is giving them work, so a step that dispatches to an
  agent costs \`work:request\`: ask the owner for it before saving, or the save answers SCOPE_DENIED.
- An extension step reads the run's vars, and nothing else, unless it names what it takes:
  \`input_from: { proposal: "x.{ref}.proposal", decision: "x.{ref}.decision" }\` hands it an
  earlier step's \`result_to_key\` or a person's \`answer_to_key\` as input fields. A key with no record
  arrives as null, so the extension must throw on a field it cannot act without. Naming keys there is
  a read of the owner's records, so the saver needs \`memory:read\`.
`,
  },
  CONFIGURE_ROUTING_SKILL_ENTRY,
  AI_MODEL_POLICY_SKILL_ENTRY,
  AI_CAPABILITIES_SKILL_ENTRY,
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
3. Nothing bound? Proceed with the app's own docs. When the app is your owner's own, consider
   authoring a skill once you have learned it (below) so the next agent starts smarter.
   \`GET /v1/apps/{owner}/{filename}/skills\` needs no sign-in, and lists public skills only.

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
A skill under your owner's name binds only to an app of that same owner: the node refuses a
binding to another account's app (422 BAD_FIELD), because the app's public pages list a bound
skill as that app's own guide.

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
   Read \`stopped\` on the same row: an agent the owner stopped counts as not reachable for a
   step, and a schedule's run for it is logged as skipped with outcome \`stopped\`. Nothing is
   broken then. Tell the owner the agent is stopped, and when they say so, start it with
   \`aimeat_agent_start\`; a skipped run is not made up, the next one happens at its time.
5. **Retry semantics:** both are flags on the definition and both are off unless the workflow
   sets them — \`resume: true\` re-evaluates steps against reality instead of restart-and-skip,
   and \`skip_done: true\` leaves a step whose output already exists alone. Safe to suggest a
   retry after fixing the cause.
6. **A run the node ended itself:** status \`stopped\` means the run stopped at its spending limit
   (\`maxCostUsd\`, US dollars per run): its \`reason\` and \`costCap\` say what the run had spent on
   AI and which ai step did not start. When \`costCap.neededUsd\` is present, the run had not spent
   the limit: that step was expected to cost \`neededUsd\` (its \`estimateUsd\`, the most one attempt
   of it cost in the workflow's last ten finished runs), and that did not fit in what was left. Each
   step carries its own \`costUsd\`, and \`signalCostUsd\` is what the node's model cost judging the
   run's \`llm\` signals. An ai step whose earlier steps are done and that stays \`pending\` while a
   model call is open is waiting for room under the limit. A step's \`openCalls\` lists its calls
   still running, each with what it holds (\`reservedUsd\`) until it answers, even when the watchdog
   already moved the step on; a restart clears them on a run in flight. Raising the limit
   is a change to the definition, so it waits for the owner like any other. Status \`refused\`
   means the trigger did not start the run: the agent or app that saved the workflow
   (\`savedBy\`) is disconnected or lost a permission its steps need, and \`refusal.missing\` names
   it. The owner either runs it once as themselves from the notification, approves the
   permission again, or saves the workflow in person so the trigger runs on their authority.
7. **An ai step that failed on its provider:** the error names the refusal. 400
   \`AI_CAPABILITY_UNAVAILABLE\` lists each provider with the reason it was left out (\`untested\`,
   \`failing\`, \`no-key\`, \`no-model\`, \`capability-off\`, \`leaves-machine\`, and \`too-costly\` when the
   owner's routing sets a ceiling per call that the model's catalogue price exceeds); \`aimeat_ai_providers\`
   shows each provider's health, and \`aimeat_ai_provider_test\` checks one again. A provider that
   failed three times in a row is gone round for five minutes while another can answer, and one
   whose key was refused waits for the owner's test or a new key. The refusal's details carry
   \`fix\`, the sentence to tell the owner, and \`settingsUrl\`, the link that opens their AI settings
   at the provider to fix. An answer that did come carries \`route\`: when \`fellBack\` is true, the
   first provider failed and the attempts say why. A 402 \`QUOTA_EXHAUSTED\` on the node's key means
   the owner's allowance is spent and the operator's setting refuses, or a daily cap the operator
   set was reached; its message says which. The owner's own key, or more allowance, is the fix.
   The run's ai steps ask the model as the run's \`aiCaller\`: the agent or app that started it, the
   saver for a trigger's run, or the owner for "Run as me". So the owner's model rules and daily cap
   for that agent or app apply, and they can refuse a step that the owner's own call would pass.
8. **An extension step that got null for an input field:** its \`input_from\` named a key that held no
   record when the step started. Usually the step that should write it is not in the step's \`after\`
   list, wrote a different key, or ran in a sandbox run under the run's key prefix; a classification
   label that keeps the record from the node's own work hides it too. Read the key with
   \`aimeat_memory_read\` and compare it with the writing step's \`result_to_key\` or \`answer_to_key\`.

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
