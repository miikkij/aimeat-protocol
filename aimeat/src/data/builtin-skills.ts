/**
 * @file builtin-skills.ts
 * @description Built-in node-scope skills seeded into the skills registry at startup —
 *   the starter library every agent on this node can load: operator runbooks and
 *   user-level how-tos for automating node and profile management. Content is embedded
 *   as template strings (no filesystem reads, works from dist). Each entry is a full
 *   SKILL.md (frontmatter + body) following the shared contract; seeding is
 *   create-if-missing so operator edits are never overwritten.
 * @structure BUILTIN_SKILLS — Array<{ name, skillMd, visibility? }>
 * @usage import { BUILTIN_SKILLS } from '../data/builtin-skills.js';
 * @version-history
 *   2026-07-19 — Research-first flow (AppDev KB Phase 7): Step 0 + tier decision tree + finish checklist / appdev-flow prompt / handbook module
 *   v1.4.0 -- 2026-07-19 -- aimeat-app-builder (public): the paved path for building apps ON
 *     the node over MCP — spec-first, research-before-building (apps/packs/pitfalls), presigned
 *     publish. Canonical home of the skill formerly shipped only inside the OpenHands runtime image.
 *   v1.3.0 -- 2026-07-16 -- aimeat-game-apps (public): game/creative-canvas apps with the
 *     phaser/pixi/p5 library packs — engine selection, v8/instance-mode idioms, AIMEAT glue.
 *   v1.2.0 -- 2026-07-14 -- aimeat-node-guide app section: the agent-face paragraph (Accept:
 *     text/markdown on an app URL → the app's markdown read-surface + affordances footer).
 *     Seeding is create-if-missing, so existing nodes need an operator republish to pick this up.
 *   v1.1.0 -- 2026-07-14 -- aimeat-node-guide: the public "start here" skill (visibility public,
 *     listed in the /.well-known/agent-skills discovery index) + per-skill visibility field
 *   v1.0.0 -- 2026-07-05 -- Initial: 4 runbooks (Skills feature Phase 2b)
 */

export interface BuiltinSkill {
  name: string;
  skillMd: string;
  /** Registry visibility at seed time. Default 'members'; 'public' additionally allows
   *  anonymous reads and lists the skill in the Agent Skills discovery index. */
  visibility?: 'members' | 'public';
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
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
2. \`GET /llms.txt\` — the full agent-facing manual for everything on the node.
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
and federation each have a handbook module or llms.txt section — discover them from steps
1-2 above. The economy runs on morsels: the owner holds one balance, agents spend from it
within a daily allowance (\`aimeat_wallet_balance\`).

## Principles

- Read before you write; propose before you change the owner's data.
- Use the paved paths above instead of guessing endpoints — every list here is served
  fresh by the node itself.
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

- **phaser** — a GAME: scenes, physics, collisions, input, score, sound. The default for games.
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

- **High scores / leaderboard**: one PUBLIC memory key per player
  (\`myapp.highscore\`, \`{ score, by, at }\`) written with aimeat-data; read everyone's with
  \`AIMEAT.data.search('myapp.highscore')\`. Gate saving on login (aimeat-auth), render a
  top-10. The comp-phaser-arcade template shows the exact pattern.
- **Save games**: private memory key per user (\`visibility: 'private'\`).
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
  {
    name: 'aimeat-app-builder',
    visibility: 'public',
    skillMd: `---
name: aimeat-app-builder
description: Build and publish apps ON an AIMEAT node over MCP (the aimeat_* tools) or REST. The paved path for any "build/make/publish an app, game or tool on AIMEAT" request — fetch the canonical build spec first, research what already exists, build a single-file app from a template, verify, publish, and report the live URL. Use whenever an owner asks for an app on the node.
license: MIT
metadata:
  audience: agent
---

# Building AIMEAT apps

An **AIMEAT app** is a **single self-contained HTML file**. The node hosts it and serves it
on its own subdomain (e.g. \`https://<name>.apps.<node-domain>/\`). It logs the user in, reads
and writes their data, and uses node-hosted UI/AI libraries — all from \`<script>\` tags
pointing at the node. There is **no build step and no backend to write**: the node is the
backend. If you have the \`aimeat_*\` MCP tools, publish directly over MCP — you do not need
the web UI.

## The one rule that matters: fetch the canonical spec first

The node serves the **authoritative, always-current build-app specification** — the single
source of truth for available libraries, allowed script URLs, required \`<meta>\` tags,
auth/data APIs, and templates. **Before writing any app, fetch it and follow it exactly:**

\`\`\`
GET /v1/prompts/build-app        ← the spec (law; re-fetch every time, it changes)
GET /v1/app-templates            ← starter templates (start from one, do not invent structure)
GET /v1/appdev/pitfalls          ← curated "what bites app builders" registry
\`\`\`

Everything the app loads at runtime — CSS, auth, data, UI libraries — must be a URL
**listed in that spec**. Never invent script/style \`src\` URLs; they 404 and break the app.

## Research before building (research → frame → propose → build → finish)

Before writing code, look at what already exists on the node and reuse it. ONE call gives
the big picture: \`aimeat_appdev_overview\` (pass your model id) — the owner's existing apps
and **template proposals** (often the fastest correct starting point: fork or copy their
patterns), library packs with per-model proofs, T1/T2/T3 templates, and the pitfalls
(curated + learned) for the areas you will touch. Drill down from there:
\`GET /v1/library-packs/{id}\` (per-pack AI doc), \`GET /v1/appdev/pitfalls\` (curated
registry), \`aimeat_appdev_pitfall_list\` (learned, model-filterable), \`aimeat_skill_list\`
\`binding=app:{owner}/{file}\` (how existing apps want to be driven).

Frame the build from the research (tier T1/T2/T3, packs, whether the app needs its own
users → aimeat-iam decided NOW), propose the frame to the user in 3-5 lines, then build.
If the user says to just build it the usual way, skip the research and go.

## Finish — this is where the acceleration compounds

After a successful publish (the publish response's \`next_steps\` shows what is missing):
1. Publish the app's **agent face** + bind a **skill** (\`metadata.binding\`
   \`app:{owner}/{filename}\`) so the app is agent-facing by default.
2. If anything generalizes, record a template: \`aimeat_app_template_propose\`
   (your model id required) — the next build starts from it.
3. Report what bit you: \`aimeat_appdev_pitfall_report\` (model required; upserts by slug;
   \`share: true\` publishes it platform-wide) — the next builder skips your mistake.

## Workflow

1. **Fetch the spec** (above). Skim the templates; pick the closest one.
2. **Build one HTML file.** Single file, no bundler. Include the required meta tags the
   spec lists (at minimum \`aimeat-app\` + \`aimeat-scopes\`). Use
   \`AIMEAT.auth.mountLoginButton(...)\` + \`AIMEAT.auth.login()\` for sign-in,
   \`AIMEAT.data.get/set(key, value, { visibility })\` for storage, and the node UI helpers.
   Respect the light/dark theme via \`data-theme\` + CSS variables — never hardcode colors.
3. **Verify locally before publishing.** Syntax-check the inline JS (\`node --check\` on the
   extracted script); verify the script tags resolve to real node URLs.
4. **Publish over MCP.** \`aimeat_app_publish\` — for any file over ~1 KB use **presigned
   upload** (omit the content param → PUT the raw HTML to the returned \`upload_url\`).
   Re-publishing the same \`filename\` bumps the version — it does not duplicate.
5. **Return the live URL** and confirm with \`aimeat_app_list\` if unsure.

## When the app needs external data (an extension)

A third-party API call belongs in an **AIMEAT extension** (sandboxed server-side function),
not in the browser: it owns its \`ext:<name>\` memory namespace, makes outbound HTTP via
\`ctx.fetch()\`, and exports actions as \`export default async function (ctx, input) {...}\`.
The app reads it **through** the node's cortex libs, never directly. Most apps need NO
extension — just auth + data + UI libs.

## Do / Don't

- **Do** fetch \`/v1/prompts/build-app\` every time — it is canonical and it changes.
- **Do** research existing apps/packs/pitfalls first; start from a template.
- **Do** verify locally, publish over MCP (presigned for >1 KB), hand back the live URL.
- **Don't** invent library/script URLs or reference files the spec doesn't list.
- **Don't** build a separate backend, a bundler, or a multi-file app.
- **Don't** hardcode brand colors or bypass the AIMEAT auth/data/UI libraries.
`,
  },
];
