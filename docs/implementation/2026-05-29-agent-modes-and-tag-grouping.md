# Implementation: Agent mode classification + tag-based grouping UI

**Created:** 2026-05-29
**Intended audience:** A fresh Claude Code session that will implement this in the AIMEAT codebase.
**Repository:** This is the AIMEAT repo. You are already in it.
**No time/effort estimates:** Do not include "this is a 1-week project", "easy/hard", "MVP in N days" etc. anywhere. The user finds those noise.

---

## Context — what AIMEAT is

**AIMEAT** is an open protocol + reference implementation for AI agent infrastructure. v1.10.0 added the 13-step Hello Integration that REQUIRES every newly connected agent to publish commands + config before onboarding completes.

Public docs:
- Repo overview: [README.md](../../README.md)
- Project conventions: [CLAUDE.md](../../CLAUDE.md) — MANDATORY READ before coding
- Hello Integration: `aimeat/src/routes/agent-onboarding.ts`, `aimeat/src/models/agent-onboarding-schemas.ts`, `aimeat/src/services/onboarding-validator.ts`
- Public site: https://aimeat.io

**Code paths you will touch:**
- `aimeat/src/storage/interface.ts` — AgentRecord type
- `aimeat/src/storage/providers/sqlite/{index,schema}.ts` — SQLite columns
- `aimeat/src/storage/providers/mongodb/index.ts` + `aimeat/prisma/schema.prisma` — MongoDB schema
- `aimeat/src/routes/agents.ts` — agent CRUD routes
- `aimeat/src/routes/agent-onboarding.ts` — onboarding flow (must become mode-aware)
- `aimeat/src/models/agent-onboarding-schemas.ts` — step definitions
- `aimeat/public/views/profile/agents/agent-card.js` — agent card UI
- `aimeat/public/views/profile/agents-tab.js` — agents list UI

---

## Why this matters (the picture)

Today every agent in AIMEAT goes through the same 13-step Hello Integration. This works for **autonomous** agents (Hermes, OpenClaw — they live continuously) and **interactive** agents (Claude Code, Falcon — they respond to user requests). But it doesn't fit **task runners** (CrewAI crews, custom workers) that are triggered, do one job, and exit. A task runner shouldn't have to publish slash commands (it doesn't expose commands to the owner — it's not interactive). It shouldn't have to declare capabilities the same way.

Different agent types ALSO benefit from different UI grouping. A user might have:
- 1 Hermes agent (autonomous, always-on)
- 1 Claude Code agent (interactive, paired with their IDE)
- 5 CrewAI-crew agents that belong together as one "Marketing Crew"
- 2 custom task runners

The Your Agents list currently shows these as a flat list of 9 cards. The user wants visual grouping by source / crew / role.

---

## Specific implementation tasks

### Task 1: Agent mode classification

Add a new field to AgentRecord: `mode: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator'`.

**Definitions (use these verbatim in code comments + docs):**

- **`autonomous`** — agent runs continuously on its own schedule, decides when to act, monitors environment. Hermes, OpenClaw, Auto-GPT-style. Full Hello Integration required (all 13 steps): publishes commands, config, capabilities, telemetry, completes test task.
- **`interactive`** — agent responds to user requests in a chat or IDE session. Claude Code, Cursor, Cline, Falcon-style. Full Hello Integration required (same 13 steps).
- **`task-runner`** — agent is triggered by a task arrival, runs the task, exits. No interactive command surface, no continuous presence. CrewAI crews, Inngest-style workers. **Reduced Hello Integration**: only `authenticate`, `identify_platform`, `install_skill`, `report_capabilities` (technical only — what runtime + what tools), and `publish_config` (so user knows what runner is configured). Other steps (`send_test_message`, `report_telemetry`, `accept_test_task`, `complete_test_task`, `publish_commands`, `declare_services`) are NOT REQUIRED for this mode — they're skipped automatically with status `not_applicable`.
- **`coordinator`** — agent orchestrates other agents (Claude Desktop with MCP, LangGraph supervisor, CrewAI Manager Agent). It IS interactive, so same Hello Integration as interactive. The mode is informational for UI grouping ("show me my orchestrators").

**Default for backward compatibility:** existing agents (created before this field exists) default to `interactive`. New agents are required to declare their mode at registration time.

**Schema changes:**

1. `AgentRecord` interface: add `mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator'`
2. SQLite: `safeAddColumn('agents', 'mode', "TEXT DEFAULT 'interactive'")`
3. Prisma: add `mode String?` field on `Agent` model
4. SQLite `updateAgent`: include `mode = ?` in UPDATE, persist
5. SQLite `deserializeAgent`: read row.mode
6. MongoDB `toAgentRecord`: include `mode: row.mode ?? 'interactive'`
7. MongoDB `createAgent`: include `mode: agent.mode ?? 'interactive'`

**Routes:**

- `POST /v1/agents/device-authorize` and `POST /v1/agents/device-token` (agent registration): accept optional `mode` parameter, persist
- `GET /v1/agents` list: include `mode` in response
- `PATCH /v1/agents/:name`: allow owner to update mode

**Onboarding integration:**

In `aimeat/src/routes/agent-onboarding.ts` (the GET handler that initialises an onboarding record) and in `aimeat/src/services/onboarding-validator.ts`:

- When `mode === 'task-runner'`:
  - `createDefaultSteps()` produces a reduced list: only `authenticate`, `identify_platform`, `install_skill`, `report_capabilities`, `publish_config`
  - The omitted steps don't exist in the record (not `pending`, not `skipped`, just absent)
  - Onboarding auto-completes when those 5 are passed
- When `mode === 'coordinator'`: same as `interactive` for now
- When `mode === 'autonomous'` or `'interactive'`: existing 13-step flow (no change)

Update `createDefaultSteps(mode)` in `aimeat/src/models/agent-onboarding-schemas.ts` to take a mode parameter and filter accordingly.

### Task 2: Tag-based UI grouping for Your Agents list

`AgentRecord.tags?: string[]` already exists. The UI just needs to surface and use it.

**Convention** (document this in `docs/coding-guidelines/agent-tags.md`):
- `crew:<name>` — agent is part of a multi-agent crew (e.g., `crew:marketing-001`)
- `source:<name>` — agent's underlying runtime/framework (e.g., `source:crewai`, `source:hermes`, `source:claude-code`)
- `role:<name>` — agent's role within a crew (e.g., `role:researcher`, `role:editor`)
- `project:<name>` — agent is dedicated to a specific project (e.g., `project:comicland-v2`)
- Free-form tags also allowed for owner's own use

**UI changes in `aimeat/public/views/profile/agents-tab.js`:**

1. **New filter bar at the top of Your Agents:**
   - Pill row of all unique tags across all agents, sorted by frequency
   - Each pill shows the tag name + count
   - Clicking a pill filters the agent list to only agents with that tag
   - Multi-select supported (AND filter — agent must have ALL selected tags)
   - "Clear filters" pill when any are active

2. **Group-by toggle:**
   - Default view: flat list (current behaviour)
   - Toggle to "Group by tag" → agents cluster under expandable headers per primary tag
   - Primary tag is the first one starting with `crew:` (if any), then `project:` (if any), else "Other"

3. **Agent card chip strip** (in `aimeat/public/views/profile/agents/agent-card.js`):
   - Already shows capabilities and language chips
   - Add a row above those showing tags as small grey pills
   - Owner can click the pencil icon (existing pattern) → modal to add/remove tags
   - Tags `mode:*` are NOT shown as user-editable tags (mode is a separate field, not a tag)

4. **Mode badge:**
   - Add a small badge to each agent card showing mode: 🤖 Autonomous, 💬 Interactive, ⚙️ Task Runner, 🎯 Coordinator
   - In flat list, mode badge appears next to the agent name
   - In grouped view, group headers can optionally show mode breakdown ("Marketing Crew · 5 task runners")

**No emoji policy reminder:** the existing UI does not use emojis (per CLAUDE.md). For mode badges, use coloured chips with text labels instead (small green chip for autonomous, blue for interactive, purple for task-runner, orange for coordinator). The above emoji examples are JUST illustrative — replace with text-only chips matching existing design system (`.pf-agd-badge--*` classes).

### Task 3: MCP / API surface for tag and mode management

- Add `aimeat_agent_tags_set` MCP tool: `{ agent_name, tags: string[] }` → updates the agent's tags
- Add `aimeat_agent_mode_set` MCP tool: `{ agent_name, mode }` → updates the agent's mode (owner-only)
- `aimeat_admin_agents` should return mode + tags in its listing

### Task 4: Migration / backfill

For existing agents (pre-this-feature):
- Auto-set `mode = 'interactive'` for all (they already went through full Hello Integration)
- No tags backfilled — owner can add manually

Add a one-time migration log line at server startup: "Backfilled {count} agents with mode='interactive'".

### Task 5: Documentation

Create `docs/coding-guidelines/agent-tags.md`:
- Tag conventions (the list above)
- How to combine tags (`crew:` + `role:` is a common combo)
- How owner can set tags (UI + MCP tool)
- How tags affect UI grouping

Update `docs/coding-guidelines/architecture.md` "Identity Model" section to mention agent modes.

Update README.md (the "Connect AI agents" section): add a short paragraph about modes.

---

## Acceptance test

1. Create a fresh agent with `mode: 'task-runner'` via API:
   ```
   POST /v1/agents/device-authorize  { ..., mode: "task-runner" }
   ```
2. Approve, get token
3. `GET /v1/agents/me/onboarding` shows only 5 steps (not 13)
4. Pass those 5 steps via API → onboarding flips to `completed` (no need to call `aimeat_message_send`, no `accept_test_task`, no `publish_commands`)
5. View in UI: agent card shows "Task Runner" badge (text chip, not emoji)
6. Set tags `["crew:marketing-001", "source:crewai", "role:researcher"]` via UI
7. Tags appear on the card as small chips
8. Filter bar shows `crew:marketing-001` pill — click it → only this agent shows
9. Toggle "Group by tag" → agents cluster under "Marketing 001" header
10. Existing interactive agents (created before migration) still appear correctly as `interactive` mode with full Hello Integration history visible

---

## Things you should NOT do

- Do NOT remove modes that aren't in this list (`autonomous | interactive | task-runner | coordinator`). Keep the union strict for now.
- Do NOT make tags part of the `mode` system. Tags are owner-managed labels; mode is a fundamental agent type.
- Do NOT use emojis in UI per CLAUDE.md frontend guide — use text chips.
- Do NOT add a sixth mode or split task-runner into sub-types in this iteration. Keep it minimal.
- Do NOT include time/effort estimates anywhere.
- Do NOT silently change existing agents to a different mode. Only backfill to `interactive` (the safest default).

---

## When you're done

1. Typecheck + lint:
   ```
   pnpm typecheck
   pnpm lint
   ```
2. Affected E2E suites on SQLite:
   ```
   cd aimeat
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding --test=agent-tasks
   ```
   - The onboarding test suite needs updates to cover the task-runner mode reduced flow. Add new tests:
     - "Task-runner agent gets only 5 steps"
     - "Task-runner agent auto-completes onboarding when all 5 pass"
     - "Mode is persisted across reads"
3. Playwright (if frontend changes — per CLAUDE.md Rule 1b):
   ```
   pnpm test:playwright:sqlite -- profile-agents
   ```
4. Brief PR description (no time estimates): what was added, manual acceptance test, what changes for existing users.
