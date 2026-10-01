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
 *   v1.5.0 — 2026-10-01 — manage-my-agents: which agent the owner needs, asked by what it should do, with
 *     where each kind runs and who pays, and the picture of the four places (guided journey P4).
 *   v1.4.2 — 2026-10-01 — manage-my-agents: reading the address book needs contacts:read, and an
 *     agent approved before it existed is refused until the owner gives it.
 *   v1.4.1 — 2026-09-30 — aimeat-node-operations: aimeat_admin_config reports the classification
 *     switch, and aimeat_classification switch_set is what changes it (TARGET-082).
 *   v1.4.0 — 2026-09-30 — manage-my-agents: aimeat_agents_list carries the permissions, the calls the
 *     node refused an agent for a missing one, and what it asked for; read them when tasks do not move.
 *   v1.3.0 — 2026-09-26 — aimeat-node-operations names the start step for the app grants, personal
 *     access tokens and sessions of deleted accounts, and that the tokens of a held grant or token stay
 *     refused.
 *   v1.2.0 — 2026-09-26 — aimeat-node-operations names the start step for the cortexes and ecosystem
 *     apps of deleted accounts, and that a held app can still act for the account until the owner
 *     decides.
 *   v1.1.0 — 2026-09-26 — aimeat-node-operations says what an update does at start: nothing runs by
 *     hand, what a step cannot place becomes one incident, and how the operator decides its names.
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
5. \`aimeat_admin_config\` — current node configuration. It is read-only. It also reports the
   classification switch (\`classification_mode\`: off, owner or all). You change it with
   \`aimeat_classification\` action \`switch_set\` (it needs the same \`operator:admin\` permission), and
   only with the owner's confirmation: turning it
   on, or from owner to all, applies at once; turning it off, or from all to owner, is refused from
   an AI, because the operator does that on the admin Config page.

## After an update
Every step an update brings runs by itself when the node starts: there is no script to run by hand,
and the node starts whatever its data holds. When a step cannot place some data on evidence, it
leaves that data as it is and opens one incident, which \`aimeat_admin_security_overview\` lists with
the others. The move of each person's older records to their full identity is such a step. So is
the step after it, which settles the cortexes and ecosystem apps of deleted accounts: those of a
username that no account holds go as an account deletion takes them, and those older than the
account that holds the name now join the same incident. Such an ecosystem app can still act for
that account until the owner decides. So is the step after that, which settles the app grants,
personal access tokens and sessions of deleted accounts the same way; an app grant or access token
older than the account joins the same incident, and its tokens stay refused whatever the owner
decides. The incident names each username whose records are older than the account that holds the
name now, with the counts and the hooks bound to its actions. Show the owner each name and its
counts, and wait for their decision on each one before you call
\`aimeat_admin_incident_resolve\` with \`name\` and \`resolution\`: "holder" when the records belong to
the account that holds the name now, "previous" when they were a previous holder's. The incident
closes with the last name. A gate bound to an action that no longer exists lets everything pass
until it is bound again on the Hooks page.

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

## Which agent the owner needs
Ask what the agent should do, then name the kind, where it runs and who pays:
- **Answer when they ask:** their chat AI, connected over MCP (as you are). It works while they talk
  to it, and they pay with their subscription to that AI.
- **Work while they are away:** a worker. Ask where it should run.
  - On their computer: it needs the connector, a small program that keeps one connection open to
    this AIMEAT (\`npx aimeat connect --url <this node> --owner <them>\`, then
    \`npx aimeat connect serve\`), and the computer stays on while it works. Propose the agent with
    \`aimeat_agent_propose\` (a name, its purpose, a crew definition); the owner approves it on the
    Agents page or in their open items, and approving creates it. It thinks with the model in their
    settings and they pay with their own AI key.
  - On this AIMEAT: a scheduled AI job (\`aimeat_schedule_create\`). Nothing to install, it runs
    with their own AI key, and the computer can be off.
- **The same thing on a timetable:** a schedule (\`aimeat_schedule_create\`).
- **Work for an app:** the app's own agent. Installing the app's package proposes it, and it waits
  for the owner's approval in their open items. Nothing runs before they approve it.
- **Starts work by itself** is the mode \`task-runner\` (\`aimeat_agent_mode_set\`): work sent to the
  agent starts without asking the owner. Say that in those words before you set it.

Where agents run, for the owner:

\`\`\`mermaid
flowchart LR
  subgraph V["The AI vendor's cloud"]
    V1["Your chat AI<br/>acts while you talk to it<br/>paid by your subscription"]
  end
  subgraph N["This AIMEAT"]
    N1["Schedules and the chat here<br/>paid by your own AI key"]
  end
  subgraph Y["Your computer"]
    Y1["Connector"]
    Y2["Your agents: the two basic agents,<br/>agents of your own, CrewAI crews<br/>paid by your own AI key"]
    Y1 --- Y2
  end
  subgraph X["Someone else's service"]
    X1["A service's agent<br/>paid at the price you agreed"]
  end
  V1 -- "MCP" --> N
  Y1 -- "one outgoing connection" --> N
  N -- "contract, paid work" --> X1
\`\`\`

## Common tasks
- **List agents:** \`aimeat_agents_list\` — name, GAII, tags, mode, last-seen, and its permissions
  (\`default_scopes\`).
- **Why an agent's tasks do not move:** in the same list, \`refusals\` names every call the node
  refused the agent for a permission it still lacks (the permission, the call, how many times,
  when last), and \`scope_request\` says what the agent asked for at its last approval. A refusal is
  often why a task waits or a run looked fine and wrote nothing. Tell the owner which permission is
  missing, in words, and that they give it in Profile → Agents → Manage access rights. A refusal
  goes away when the permission is given. Reading the owner's address book (\`aimeat_contact_list\`)
  needs its own permission, contacts:read, since 2026-10-01; an agent approved before then holds only
  messages:read for it and is refused until the owner gives contacts:read.
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
