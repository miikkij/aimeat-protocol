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
import { HATCHERY_SKILL_ENTRY } from './builtin-skills.hatchery.js';
import { WORKSTATION_SKILL_ENTRY } from './builtin-skills.workstation.js';
import { APP_BUILDER_SKILL_ENTRY } from './builtin-skills.app-builder.js';
import { APP_BUILDER_ATELIER_SKILL_ENTRY } from './builtin-skills.app-builder-atelier.js';
import { GAME_SKILL_ENTRIES } from './builtin-skills-games.js';

export interface BuiltinSkill {
  name: string;
  skillMd: string;
  /** Registry visibility at seed time. Default 'members'; 'public' additionally allows
   *  anonymous reads and lists the skill in the Agent Skills discovery index. */
  visibility?: 'members' | 'public';
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  OPEN_ITEMS_SKILL_ENTRY,
  HATCHERY_SKILL_ENTRY,
  WORKSTATION_SKILL_ENTRY,
  APP_BUILDER_SKILL_ENTRY,
  APP_BUILDER_ATELIER_SKILL_ENTRY,
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
shared workspaces (organisms), skills, tasks/workflows, app hosting, and a morsel
economy — over plain REST and MCP.

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

- Register: \`POST /v1/owners\` with \`{ name, public_key }\`, or use the web portal at \`/\`.
- Log in (web/API): \`POST /v1/ghii/login\` with \`{ username, password }\` → a session JWT.
- Key-holders mint tokens directly: \`POST /v1/auth/token\` (Ed25519-signed challenge).

## Agents: connect via device authorization (RFC 8628)

Agents are never created implicitly. The paved path:

1. The agent calls \`POST /v1/agents/device-authorize\` and shows the returned code.
2. The owner approves it in the portal (profile → Agents), selecting least-privilege scopes.
3. The agent polls, receives its GAII + key, then authenticates with \`POST /v1/auth/token\`.

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
1-2 above. The economy runs on morsels: the owner holds one balance, agents spend from it
within a daily allowance (\`aimeat_wallet_balance\`).

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
  {
    name: 'aimeat-node-operations',
    skillMd: `---
name: aimeat-node-operations
description: Operator runbook for inspecting and managing an AIMEAT node — answering "what's in my system?", checking health, agents, economy, and configuration. Use when the owner asks about node status, statistics, registered agents, or operator-level administration.
license: MIT
metadata:
  audience: operator
---

# AIMEAT node operations

You are assisting a node OPERATOR. Always inspect before you suggest changes, and always
show the owner what you found before acting.

## Answering "what's in my system?"
1. \`aimeat_admin_stats\` — node totals: owners, agents, memory, morsel economy.
2. \`aimeat_admin_agents\` (or \`aimeat_agents_list\` for your own owner) — who is registered,
   their platform, last-seen, trust.
3. \`aimeat_organism_list\` + \`aimeat_organism_overview\` — the shared workspaces and what lives in them.
4. \`aimeat_discover\` with \`mode: "map"\` — a faceted map of every content type (skills,
   knowledge, workflows, apps, documents) the caller can see.
5. \`aimeat_admin_config\` — current node configuration.

## Principles
- Read-only tools first; never modify configuration without the owner's explicit confirmation.
- Prefer specific evidence ("agent X last reported telemetry at T") over general claims.
- If a check needs a tool this session does not have, say which tool is missing rather than guessing.
`,
  },
  {
    name: 'manage-my-agents',
    skillMd: `---
name: manage-my-agents
description: User-level runbook for managing the owner's AI agents on an AIMEAT node — listing them, checking onboarding and activity, attaching skills, and connecting new agents via device authorization. Use when the owner asks about their agents, wants to add capabilities to one, or connect a new one.
license: MIT
metadata:
  audience: owner
---

# Manage my agents

You are assisting an OWNER with their own agents (never another owner's).

## Common tasks
- **List agents:** \`aimeat_agents_list\` — name, GAII, platform, mode, last-seen.
- **Inspect one:** \`aimeat_agent_profile\` — capabilities, tags, trust, telemetry.
- **Onboarding state:** \`aimeat_onboarding_status\` — which Hello-Integration steps remain.
- **Give an agent expertise:** browse \`aimeat_skill_list\` (view "library"), then
  \`aimeat_skill_link\` with the skill's ref and the target \`agent_name\`. Links are
  references — the agent loads current content at start.
- **Connect a NEW agent:** agents are never created implicitly. The new agent runs the
  device-authorization flow (RFC 8628) and the owner approves it in the profile Agents tab,
  choosing its scopes. Point the owner there; do not try to mint credentials yourself.

## Principles
- Least privilege: when the owner approves an agent, recommend only the scopes the agent's
  purpose needs.
- One change at a time, and report what you changed with the tool result as evidence.
`,
  },
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
  \`public\` is federated — visible beyond this node. Never raise visibility without the
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
description: Operator runbook for adding a new automation/crew agent to an AIMEAT node — device authorization, scope selection, skills, tags, and verifying it came online. Use when the owner wants to connect a new CrewAI/automation agent or a new AI runtime to the node.
license: MIT
metadata:
  audience: operator
---

# Add a crew agent

Agents are NEVER created implicitly. The flow is device authorization (RFC 8628):

1. **The agent side** starts the flow (\`POST /v1/agents/device-authorize\` — the crew runtime or
   connect CLI does this) and shows a code.
2. **The owner approves** in profile → Agents → the pending approval, choosing the agent's
   SCOPES. Recommend least privilege for the agent's purpose (a task-runner needs
   \`memory:read/write, work:read/accept\` — not \`*\`).
3. **Teach it:** attach skills with \`aimeat_skill_link\` (browse \`aimeat_skill_list\` view
   "library" first). Crew runtimes fetch linked skills at start via
   \`GET /v1/agents/{name}/skills\`.
4. **Organize it:** tags via \`aimeat_agent_tags_set\`; mode/display via
   \`aimeat_operator_agent_configure\` (propose-then-confirm — show the owner the diff).
5. **Verify it came online:** \`aimeat_agent_profile\` / \`aimeat_agent_activity\` (last-seen,
   telemetry) and \`aimeat_onboarding_status\` for remaining Hello-Integration steps.

## Principles
- Never mint or paste credentials yourself; approval is the owner's UI action.
- One agent per purpose beats one agent with every scope.
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
   \`aimeat_workflow_save\`. Steps signal each other through memory keys; the engine
   re-evaluates steps against reality on retry (resume-on-retry).
3. **Dry-run:** \`aimeat_workflow_run\` with \`mode: "signals-only"\` before scheduling.
4. **Schedule the trigger:** \`aimeat_schedule_create\` (cron or interval) targeting the
   workflow; verify with \`aimeat_schedule_list\`.
5. **Deliver to a workspace:** the final step writes via \`aimeat_workspace_write\` (drafts) —
   publish stays a human decision unless the owner says otherwise.

## Principles
- Show the owner the workflow definition BEFORE saving; \`aimeat_workflow_save\` is a write.
- Start with a manual run, then schedule.
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
   profile → Settings → AI provider. Inspect availability via \`GET /v1/ai/available\`;
   spend history via \`GET /v1/ai/usage/history\` (surfaced on the Home usage card and the
   admin AI-usage tab). Changing the provider/key is an owner UI action — guide, don't do.
2. **Work routing** (which agent does what): driven by agent capabilities, tags, and offers.
   Inspect with \`aimeat_agents_list\` + \`aimeat_agent_profile\`; adjust tags/mode via
   \`aimeat_operator_agent_configure\` (propose-then-confirm) and teach specialization by
   linking skills (\`aimeat_skill_link\`).
3. **Economy budget** (morsels): \`aimeat_wallet_balance\` / \`aimeat_wallet_transactions\` for
   the owner's balance; escrow holds show as in_escrow.

## Principles
- Never change provider keys or budgets yourself — propose the change, the owner applies it.
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
  a ⤓ .zip button) and upload it in claude.ai Settings → Skills — the ZIP is already in the
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
3. **Check the schedule:** \`aimeat_schedule_list\` — does the trigger exist, when did it last run,
   is it enabled? Scheduled-job successes are not logged individually; errors and skips are.
4. **Check the worker:** \`aimeat_agent_profile\` / \`aimeat_agent_activity\` for the agent a step
   dispatches to — is it connected and seen recently? \`aimeat_task_list\` for its task queue.
5. **Retry semantics:** workflow retries re-evaluate steps against reality (resume-on-retry) —
   steps whose outputs already exist are not redone. Safe to suggest a retry after fixing the cause.

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
description: Build 2D games and creative-canvas apps on an AIMEAT node with the self-hosted library packs — phaser (full game engine), pixi (fast 2D WebGL rendering) and p5 (creative coding). Covers pack selection, the correct modern API idioms per engine, single-file-app asset strategy, AIMEAT high-score/leaderboard glue, and realtime multiplayer wiring. Use when the owner wants a game, arcade, generative-art or heavy-2D-animation app.
license: MIT
metadata:
  audience: agent
---

# Building game & creative-canvas apps

The node self-hosts three engines as library packs — fetch each pack's live doc before
coding: \`GET /v1/library-packs/phaser\` (or \`pixi\` / \`p5\`). Never load engines
from an external CDN; the include line in the pack doc points at this node's /lib/ copy.

## Pick the right engine

- **phaser4** (\`GET /v1/library-packs/phaser4\`) — a GAME: scenes, physics, collisions, input,
  score, sound. The default for games. **Load the skill \`node:aimeat-phaser\` first: it is the
  entry point, and it names the six area skills (boot, assets, saves, controls and the HUD, menus
  and levels, audio) for whichever part you are working on.** Load the library THROUGH \`aimeat-phaser\`
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
- Phaser: generate textures from Graphics (\`g.generateTexture('name', w, h)\`).
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
- **Multiplayer**: the \`realtime\` pack (AimeatRealtime rooms — WS + WebRTC + Yjs). Broadcast
  inputs/state deltas, never frames; throttle to ~30ms; register handlers BEFORE connect().
- **Theme**: read the app CSS variables for colors so the game respects light/dark.

## Checklist before publishing

1. Boots from a cold load while signed OUT (game playable; saving prompts sign-in).
2. Works at mobile width (Phaser Scale.FIT / p5 windowResized / pixi resizeTo).
3. Pauses when the tab hides (battery): phaser \`game.loop.sleep()/wake()\`.
4. High-score write → read back → visible on the leaderboard without a reload.
`,
  },
];
