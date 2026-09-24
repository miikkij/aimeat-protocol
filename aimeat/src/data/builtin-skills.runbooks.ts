/**
 * @file src/data/builtin-skills.runbooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two built-in runbooks: `aimeat-node-operations` (an operator inspecting the node)
 *   and `manage-my-agents` (an owner looking after their own agents).
 *
 *   Moved out of builtin-skills.ts unchanged on 2026-09-25, when one added line put that file past
 *   the 800-line limit. The two sit together because they answer the same kind of question from
 *   the two sides of the account: what does the node hold, and what do my agents hold.
 * @structure RUNBOOK_SKILL_ENTRIES (two skills, in the order builtin-skills.ts listed them)
 * @usage
 *   import { RUNBOOK_SKILL_ENTRIES } from './builtin-skills.runbooks.js';
 * @version-history
 *   v1.0.0 — 2026-09-25 — Moved out of builtin-skills.ts, text unchanged, including the line that
 *     says the admin tools reach an operator's agent only while it holds operator:admin.
 */
/**
 * The shape of a built-in skill entry, stated here and not imported: builtin-skills.ts imports this
 * file, so importing its type back is an import cycle (check:deps). builtin-skills.ts spreads these
 * entries into a BuiltinSkill[], so a field this lacks or spells differently fails the type check.
 */
interface BuiltinSkill { name: string; skillMd: string; visibility?: 'members' | 'public' }

export const RUNBOOK_SKILL_ENTRIES: BuiltinSkill[] = [
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
1. \`aimeat_admin_stats\` — node totals: agents, active agents, actions, boards, work items,
   morsels in circulation. For owners and memory, \`aimeat_admin_statistics\`.
2. \`aimeat_admin_agents\` (or \`aimeat_agents_list\` for your own owner) — who is registered,
   their owner, trust, morsel balance, last-seen.
3. \`aimeat_organism_list\` + \`aimeat_organism_overview\` — the shared workspaces and what lives in them.
4. \`aimeat_discover\` with \`mode: "map"\` — a faceted map of every content type (skills,
   knowledge, workflows, apps, documents) the caller can see.
5. \`aimeat_admin_config\` — current node configuration.

## Principles
- Read-only tools first; never modify configuration without the owner's explicit confirmation.
- Prefer specific evidence ("agent X last reported telemetry at T") over general claims.
- If a check needs a tool this session does not have, say which tool is missing rather than guessing.
- The \`aimeat_admin_*\` tools reach an agent only while its operator has given it the
  \`operator:admin\` permission in the agent's settings. When they are missing, tell the owner that
  this permission is what is missing.
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
- **List agents:** \`aimeat_agents_list\` — name, GAII, tags, mode, last-seen.
- **Inspect one:** \`aimeat_agent_profile\` — capabilities, trust, linked skills; pass the agent's GAII.
- **Onboarding state:** \`aimeat_onboarding_status\` — which Hello-Integration steps remain. It
  reports the calling agent's own onboarding only.
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
];
