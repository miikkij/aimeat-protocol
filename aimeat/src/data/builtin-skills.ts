/**
 * @file builtin-skills.ts
 * @description Built-in node-scope skills seeded into the skills registry at startup —
 *   the starter library every agent on this node can load: operator runbooks and
 *   user-level how-tos for automating node and profile management. Content is embedded
 *   as template strings (no filesystem reads, works from dist). Each entry is a full
 *   SKILL.md (frontmatter + body) following the shared contract; seeding is
 *   create-if-missing so operator edits are never overwritten.
 * @structure BUILTIN_SKILLS — Array<{ name, skillMd }>
 * @usage import { BUILTIN_SKILLS } from '../data/builtin-skills.js';
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial: 4 runbooks (Skills feature Phase 2b)
 */

export interface BuiltinSkill {
  name: string;
  skillMd: string;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
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
];
