# Scheduled Tasks / Scheduler for Agents — Implementation Plan

**Status:** Approved — in progress
**Date:** 2026-06-03
**Authors:** Jouni Miikki (concept), Claude (codebase grounding)
**Related:** `docs/design/agent-dashboard-and-sharing-groups-spec.md`

## Context

AIMEAT has a production **server-side cron engine** (`aimeat/src/services/scheduler.ts`, `croner`) that runs two job kinds — `extension` (sandboxed, zero-token) and `core` (built-in maintenance handlers) — with full lifecycle (`addJob`/`removeJob`/`reschedule`/`triggerNow`/`enabled`), `nextRunAt`, per-run `ExecutionLogEntry`, and an admin UI. Agent **tasks** are mature (`AgentTaskRecord`, rich lifecycle, stall detection, webhook/MCP/poller wake-up) but have **no recurrence**. There is no way for an owner — or an agent on the owner's behalf — to say "do X every morning," and no single place to see everything that is scheduled.

We want recurring scheduled events that: run reliably (survive agent disconnect), are **owner-cancellable instantly** (including anything an agent created), can be **created by agents via MCP**, and reuse existing systems (no shadow scheduler). The extension sandbox can `fetch`/read+write memory/`notify`/`email` at zero token but **cannot call AI** (`ctx.ai` is unimplemented), so AI work needs dedicated paths.

### Decision — who owns scheduling

**Hybrid, with scheduling _authority_ on the server.** The AIMEAT server owns the clock, the schedule record, and cancellation (reusing `Scheduler` + `ScheduledJobRecord`). *Execution* is split across kinds. Agents may **propose/create** schedules and **execute dispatched occurrences**, but never hold the authoritative clock. Agents that run their **own** internal schedulers self-report them into a structured memory entry, which AIMEAT **mirrors read-only** for display (it does not control them).

### Execution kinds (all server-clocked) + one mirror

| Kind | Runs where | AI? | Survives agent offline? | Use case |
|------|-----------|-----|--------------------------|----------|
| `extension` (exists) | QuickJS sandbox, server | no | yes | "get morning/evening news" → fetch + store, zero token |
| `ai` (NEW) | server, owner's OpenRouter key | yes | yes | "translate the shared-memory news every morning", "summarize & notify" |
| `agent_task` (NEW) | dispatched to the agent's env | yes (agent's own) | task queues, picked up on reconnect | work needing the agent's own tools/runtime |
| `agent-internal` (NEW, mirror) | agent's own runtime (not AIMEAT) | n/a | n/a | agent self-reports its own cron; AIMEAT only displays it |

### Three UI surfaces

1. **Profile › Scheduler tab (NEW, master view)** — every scheduled event the owner has running: AIMEAT-managed (`extension` + `ai` + `agent_task`), the owner's **extension cron jobs** (which extension, when, purpose), and each agent's **internal** schedules — grouped: **AIMEAT-managed** vs **Agent internal**.
2. **Profile › Agents › [agent] › Schedules sub-tab (NEW)** — that agent's schedules in two groups: **AIMEAT-dispatched** (server-managed, targeting this agent) and **Agent internal** (the mirror).
3. **Admin › Scheduler tab (exists)** — node-wide operator view; extend with the new types/columns.

---

## 1. Data model

### 1a. Extend `ScheduledJobRecord` (`src/storage/interface.ts`) — all additive/optional

```ts
type: 'extension' | 'core' | 'ai' | 'agent_task';   // ADD 'ai', 'agent_task'
ownerScope?: string;        // GHII owner — powers profile-scheduler scoping + authz
agentName?: string;         // target/associated agent (agent_task; optional for ai/extension)
agentGaii?: string;
createdByAgent?: boolean;   // true = created via MCP by an agent
displayName?: string;       // "Morning news translation"
description?: string;       // human description
purpose?: string;           // shown in master scheduler ("why this runs")
timezone?: string;          // IANA tz for "every morning" (DST-correct via croner)
constraints?: ScheduleConstraint[];   // budget framework — §4
runCount?: number;          // lifetime successful fires (constraint state)
// `ai`-kind config + `agent_task` template live in the existing `input` JSON field:
//   ai:         input = { inputKeys, inputNamespaces?, prompt, systemPrompt?, model?, outputKey?, outputVisibility? }
//   agent_task: input = { taskTemplate: { title, description, scope?, rules?, verification?, resources? } }
```

`ExecutionLogEntry`: widen `type` to include `'ai'`/`'agent_task'`; add optional `taskId?` to link an `agent_task` fire to its spawned `AgentTaskRecord`.

`AgentTaskRecord`: **reused unchanged** — each `agent_task` fire materializes a normal task with `parentTaskId = scheduleId` and a `scope` entry `{name:'schedule', type:'cron', value:<cron>}`.

`AgentRecord`: add `scheduleConstraintDefaults?: ScheduleConstraint[]` (agent-level defaults). `dailySpendLimit` (already present, unenforced) becomes the value source for the `daily_limit` constraint.

### 1b. Migration

SQLite: add nullable columns via the existing `safeAddColumn` pattern, widen the `type` CHECK, update the scheduler repo serialize/deserialize. Prisma: matching optional columns + migration. All additive — existing `core`/`extension` rows read back unchanged. Set `ownerScope` on **new** extension jobs at install; the aggregator resolves `ownerScope` for legacy extension jobs via `extension.installedBy`.

### 1c. Agent-internal scheduler mirror (no new table — a memory record)

Predefined structure at owner-visibility key **`agents.<name>.scheduler`** (same convention/read path as `agents.<name>.readme`):

```jsonc
{ "version": 1, "updatedAt": "<ISO>", "entries": [
  { "id": "...", "name": "...", "description": "...", "purpose": "...",
    "cron": "0 7 * * *", "timezone": "Europe/Helsinki",
    "schedule": "Every day 07:00",
    "lastRunAt": "...", "nextRunAt": "...",
    "status": "active" | "paused", "kind": "..." } ] }
```

Documented in `/v1/prompts/tier1` + integration kit; written via a validating MCP helper (§5).

---

## 2. Execution paths in the scheduler

Add branches to `executeJob` and pass `{ timezone: job.timezone }` to `new Cron(...)`:

- **`extension`** → existing `executeExtensionJob` (unchanged, zero token).
- **`ai` (NEW `executeAiJob`)**: read `input.inputKeys` from memory (owner namespace, or `inputNamespaces`), compose `prompt` + inputs, call the AI completion service (§3) with the owner's key, write the result to `input.outputKey` (or auto-generate) at `outputVisibility` (default `private`). No agent involved.
- **`agent_task` (NEW `executeAgentTaskJob`)**: build an `AgentTaskRecord` from `input.taskTemplate`, `status:'queued'` (or auto-`active` for task-runner-mode agents), `createAgentTask`, append `started`, then fire the existing wake fan-out (`dispatchWebhookEvent('task.queued')` + `emitResourceUpdated` + `emitChange('agent-tasks')`).

Constraint checks run **before** execution; `runCount`/state update **after** (§4). The existing post-run block records `lastRunAt`/`lastRunResult`/`nextRunAt` + log entry for all kinds. In-flight overlap guard: in-memory "executing" set keyed by `job.id`; `agent_task` also skips if a non-terminal occurrence with the same `parentTaskId` exists.

---

## 3. Server-side AI completion service (extraction)

Extract the core of `src/routes/ai.ts` `POST /v1/ai/complete` into `src/services/ai-completion.ts`:

```ts
completeForOwner(storage, config, ownerGaii, { prompt, systemPrompt?, model?, maxTokens? })
  -> { text, usage, costUsd }
```

Loads `openrouter.apikey` + `openrouter.settings`, decrypts via `decrypt/getEncryptionKey`, calls `complete(...)`, records usage into `ai-usage.<gaii>.<day>`. The HTTP route is refactored onto the service (no behavior change); the scheduler `ai` path calls it directly. The `daily_limit` constraint reads the same `ai-usage` record.

---

## 4. Budget constraints framework (extensible, opt-in)

**Selectable, off-by-default, easily extended, configured in the agent config tab, starting with a daily limit + maxRuns.**

New `src/services/schedule-constraints.ts` — a small registry:

```ts
interface ScheduleConstraint { type: string; enabled: boolean; params: Record<string,unknown>; state?: Record<string,unknown>; }
interface ConstraintDef { type: string; check(schedule, ctx): {allow:boolean; reason?:string};
                          onAfterRun?(schedule, ctx): Partial<ScheduleConstraint['state']>; }
const REGISTRY: Record<string, ConstraintDef> = { /* register here */ };
export function evaluateConstraints(schedule, ctx): {allow, reason?};
export function applyAfterRun(schedule, ctx): ScheduleConstraint[];
```

v1 constraint types (disabled unless toggled):
- **`max_runs`** — `params.limit`; on exceed, `enabled:false` + `removeJob`, log `result:'skipped'`.
- **`daily_limit`** — `params.limit` (morsels/USD-est per day) sourced from / falling back to `AgentRecord.dailySpendLimit`; checks today's `ai-usage`/wallet spend before an `ai`/`agent_task` fire; on exceed, skip + log + optional push.

"Instant cancel" is the pause/delete control (always available), not a constraint. New constraint types later = one `REGISTRY` entry + a UI row (no schema change — constraints are JSON). Agent-level defaults live on `AgentRecord.scheduleConstraintDefaults`, edited in the **Agent Config tab**; a schedule inherits them at creation and may override per-schedule. Profile-level `ai` schedules carry their own `constraints`.

---

## 5. API surface

### REST — new router `src/routes/schedules.ts` (authz copied from `agent-tasks.ts`)

```
GET    /v1/schedules                      Master aggregate (managed + owner extension cron + agent mirrors, grouped)
POST   /v1/schedules                      Create (owner; profile-level or agent-targeted)
GET    /v1/schedules/:id                  Detail + recent ExecutionLogEntry
PATCH  /v1/schedules/:id                  Edit cron/enabled/constraints/input -> scheduler.reschedule
DELETE /v1/schedules/:id                  Cancel (owner can delete ANYTHING incl. agent-created)
POST   /v1/schedules/:id/trigger          Run now -> scheduler.triggerNow
GET    /v1/agents/:name/schedules         Same data filtered to one agent (managed + that agent's mirror)
POST   /v1/agents/:name/schedules         Create targeting this agent
```
Every mutation calls `emitChange('scheduler')`. **Authz:** owner GHII passes for every schedule it owns; an agent may only touch schedules where `ownerScope == its owner` (its own `createdByAgent` ones).

### MCP — new `src/mcp/agent-schedules.ts` (self-scoped)

```
aimeat_schedule_create / list / get / update / pause / resume / delete
aimeat_schedule_report_internal   write/validate the agents.<name>.scheduler mirror
```
Register in `mcp/index.ts` + catalog descriptions/annotations. Validate the split rule.

---

## 6. UI

- **6a. Profile › Scheduler (master)** — NEW `public/views/profile/scheduler-tab.js`; register in `profile.js` TABS + `spa.html` importmap. Sections: AIMEAT-managed (grouped by kind/agent), owner extension cron, agent-internal (read-only). "New schedule" modal with kind selector + cron presets + tz picker + kind-specific fields + constraint toggles. Subscribe to `aimeat-live-update` + 10s poll.
- **6b. Agent detail › Schedules** — NEW `public/views/profile/agents/tab-schedules.js`; add to `agent-card.js` TABS (after `activity`). Groups: AIMEAT-dispatched (full controls) + Agent internal (read-only). `pf-agd-*`/`agd-*` CSS.
- **6c. Agent Config** — extend `tab-agent-config.js`: "Budget constraints" section (`max_runs`, `daily_limit`, off by default) → `AgentRecord.scheduleConstraintDefaults`/`dailySpendLimit`.
- **6d. Admin scheduler** — extend `public/views/admin/scheduler-tab.js`: `ai`/`agent_task` badges + owner/agent columns.
- **6e. Services** — NEW `public/js/services/agent-schedules.js` + `schedules.js`; importmap entries.

---

## 7. Notifications
- **SSE**: mutations + fires `emitChange('scheduler')`; `agent_task` materialization `emitChange('agent-tasks')`.
- **Push**: on `result:'error'` and constraint auto-pause, `push.sendNotification(owner, {title, body, url, tag})`.
- **In-app**: `ai` output written to memory + `extension` `ctx.notify`.

## 8. Lifecycle edge cases
- **Agent offline (agent_task)**: occurrence persists `queued`, picked up on reconnect — schedule never misses.
- **Failed run**: no auto-retry (matches current scheduler); logged; next tick retries.
- **Missed/overlapping**: croner no backfill — default skip; overlap guard. Optional `catchUp`.
- **Timezone/DST**: store IANA `timezone`, pass to croner.
- **Pause/cancel**: server-side, instant. Already-materialized occurrences left intact. Agent-internal = read-only in v1.

## 9. File touch list
Storage (`interface.ts`, sqlite schema + scheduler repo, prisma + migration); Services (`scheduler.ts`, new `ai-completion.ts`, new `schedule-constraints.ts`); Routes (new `schedules.ts`, refactor `ai.ts`, routes-loader mount, `admin-scheduler.ts`); MCP (new `agent-schedules.ts` + `mcp/index.ts` + catalog); agent prompt/kit (`tier1` + integration-kit mirror schema); Frontend (new `scheduler-tab.js`, new `agents/tab-schedules.js`, `agent-card.js`, `profile.js`, `tab-agent-config.js`, `admin/scheduler-tab.js`, new services, `spa.html`, CSS); i18n (`en.json` + `fi.json`); OpenAPI + `pnpm generate:types`. Headers/version-history on every touched file.

## 10. Verification
- E2E (SQLite then MongoDB): `schedules` (CRUD + owner cancels agent-created + cross-owner 403), `scheduler-ai` (fire reads input keys → AI service (mocked) → writes output), `scheduler-agent-task` (fire materializes task + webhook/SSE; offline → queued; overlap skip), `schedule-constraints` (max_runs auto-disable; daily_limit skip; off-by-default), storage round-trip.
- Server-side AI smoke (create `ai` schedule, trigger, confirm output key + `ai-usage`).
- Frontend (Playwright MCP): Profile › Scheduler create/run/pause/cancel; Agents › Schedules groups; Agent Config constraint toggle; owner cancels agent-created.
- `pnpm typecheck` + `pnpm lint` clean.

## 11. Trade-offs & risks
- Two-provider schema migration of `scheduled_jobs` (+ widened `type`) is riskiest — all-nullable columns, `safeAddColumn`, round-trip test first.
- `ScheduledJobRecord` semantic overload accepted for reuse; new `ownerScope`/`agentGaii` columns carry filtering. Promote to dedicated `AgentScheduleRecord` later if needed.
- Server-side AI spend runs on the owner's key — opt-in constraints + instant cancel + usage logging; defaults off.
- Agent-internal mirror is self-reported (display only, labelled as agent-managed).
- Coarse SSE (no per-domain scoping) — tabs refetch on any change; optimizable later.
