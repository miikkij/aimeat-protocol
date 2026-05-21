# Agent Dashboard Phase 2: Capabilities + Activity -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent self-reported capabilities (technical + domain) and activity monitoring (stats cards, time-series charts, scheduled jobs view, event log drill-down) as two new sub-tabs in the agent detail view.

**Architecture:** Phase 1 already created the data model foundation (AgentRecord fields, agent_activity table, agent-activity repo). Phase 2 builds the REST endpoints, MCP tools, activity recording logic (task events write to agent_activity), and two frontend sub-tabs (Capabilities, Activity). The existing agent detail view from Phase 1 (with Tasks + Directives sub-tabs) gains two more tabs.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Prisma (MongoDB), Preact + HTM (frontend), Zod (validation), Chart.js (activity charts)

**Design spec:** `docs/design/agent-dashboard-and-sharing-groups-spec.md` -- Part 4 (lines 413-541)

**Pre-existing from Phase 1:**
- `AgentRecord` has `technicalCapabilities?: AgentTechnicalCapability[]`, `domainCapabilities?: string[]`, `activityStats?: AgentActivityStats`
- `agent_activity` table (SQLite) + `AgentActivity` model (Prisma) -- created but empty
- `AgentActivityRepository` interface + SQLite/MongoDB implementations (`recordActivity`, `getActivityHistory`)
- `createdByAgent` field on `ExtensionInstanceRecord`
- Agent detail view with sub-tab system in `agents-tab.js`

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/routes/agent-capabilities.ts` | PUT/GET /v1/agents/:name/capabilities |
| `src/routes/agent-activity.ts` | GET /v1/agents/:name/activity, /activity/log |
| `src/models/agent-capabilities-schemas.ts` | Zod schemas for capability reporting |
| `src/mcp/agent-capabilities.ts` | MCP tools: aimeat_agent_capabilities_report, aimeat_agent_activity |
| `src/services/activity-recorder.ts` | Logic to write agent_activity rows on task events + update activityStats |
| `public/views/profile/agents-capabilities-subtab.js` | Capabilities sub-tab: technical + domain + action queue |
| `public/views/profile/agents-activity-subtab.js` | Activity sub-tab: stats cards, chart, scheduled jobs, event log |
| `public/js/services/agent-capabilities.js` | Frontend API service |
| `public/js/services/agent-activity.js` | Frontend API service |
| `test/e2e-agent-capabilities.ts` | E2E tests for capabilities |
| `test/e2e-agent-activity.ts` | E2E tests for activity recording + retrieval |

### Modified files

| File | Change |
|------|--------|
| `src/server-bootstrap/routes-loader.ts` | Mount new routers |
| `src/mcp/index.ts` | Register new MCP tools |
| `src/routes/agent-tasks.ts` | On task start/complete/fail: call activity recorder |
| `src/routes/prompts.ts` | Extend tier1 with capability reporting instructions |
| `public/views/profile/agents-tab.js` | Add Capabilities + Activity sub-tabs to AGENT_SUBTABS |
| `public/spa.html` | Add importmap entries for new modules |
| `public/css/views/agents-detail.css` | Styles for capability badges, activity chart, stats cards |
| `locales/en.json` | New i18n keys for capabilities + activity |
| `locales/fi.json` | Same |
| `openapi.yaml` | Document new endpoints |

---

## Task 1: Activity Recorder Service

**Files:**
- Create: `aimeat/src/services/activity-recorder.ts`
- Modify: `aimeat/src/routes/agent-tasks.ts`

The activity recorder is the bridge between task events and the activity history table + activityStats on AgentRecord. This must exist before endpoints, because task completion should start recording activity immediately.

- [ ] **Step 1: Create activity-recorder.ts**

```typescript
/**
 * @file activity-recorder.ts
 * @description Records agent activity to the agent_activity table and updates
 *   AgentRecord.activityStats counters on task lifecycle events.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial activity recorder
 */
import type { Storage, AgentActivityStats } from '../storage/interface.js';

export async function recordTaskStarted(storage: Storage, agentGaii: string): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();
  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_started', value: 1 });
}

export async function recordTaskCompleted(
  storage: Storage, agentGaii: string,
  telemetry?: { tokensIn?: number; tokensOut?: number; aiCalls?: number }
): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();

  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_completed', value: 1 });

  if (telemetry?.tokensIn || telemetry?.tokensOut) {
    const totalTokens = (telemetry.tokensIn ?? 0) + (telemetry.tokensOut ?? 0);
    await storage.recordActivity({ agentGaii, date, hour, metric: 'tokens_used', value: totalTokens });
  }
  if (telemetry?.aiCalls) {
    await storage.recordActivity({ agentGaii, date, hour, metric: 'ai_calls', value: telemetry.aiCalls });
  }

  // Update embedded activityStats on AgentRecord
  await updateAgentStats(storage, agentGaii, 'completed', telemetry);
}

export async function recordTaskFailed(storage: Storage, agentGaii: string): Promise<void> {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();
  await storage.recordActivity({ agentGaii, date, hour, metric: 'tasks_failed', value: 1 });
  await updateAgentStats(storage, agentGaii, 'failed');
}

async function updateAgentStats(
  storage: Storage, agentGaii: string, outcome: 'completed' | 'failed',
  telemetry?: { tokensIn?: number; tokensOut?: number; aiCalls?: number }
): Promise<void> {
  const agent = await storage.getAgent(agentGaii);
  if (!agent) return;
  const stats: AgentActivityStats = agent.activityStats ?? {
    tasksCompleted: 0, tasksFailed: 0, tokensUsed30d: 0,
    aiCalls30d: 0, successRate: 0, extensionsCreated: 0, appsPublished: 0,
  };

  if (outcome === 'completed') {
    stats.tasksCompleted++;
    stats.lastTaskAt = new Date().toISOString();
  } else {
    stats.tasksFailed++;
  }

  const total = stats.tasksCompleted + stats.tasksFailed;
  stats.successRate = total > 0 ? Math.round((stats.tasksCompleted / total) * 100) : 0;

  if (telemetry) {
    stats.tokensUsed30d += (telemetry.tokensIn ?? 0) + (telemetry.tokensOut ?? 0);
    stats.aiCalls30d += telemetry.aiCalls ?? 0;
  }

  await storage.updateAgent(agentGaii, { activityStats: stats });
}
```

- [ ] **Step 2: Wire into agent-tasks.ts lifecycle endpoints**

In `agent-tasks.ts`, import the recorder and call it:
- In the `/start` handler: `await recordTaskStarted(storage, task.agentGaii);`
- In the `/complete` handler: `await recordTaskCompleted(storage, task.agentGaii, task.telemetry);`
- In the `/fail` handler: `await recordTaskFailed(storage, task.agentGaii);`

- [ ] **Step 3: Verify compile**

Run: `cd aimeat && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/services/activity-recorder.ts aimeat/src/routes/agent-tasks.ts
git commit -m "feat: add activity recorder service, wire into task lifecycle"
```

---

## Task 2: Capabilities REST Endpoints

**Files:**
- Create: `aimeat/src/routes/agent-capabilities.ts`
- Create: `aimeat/src/models/agent-capabilities-schemas.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create Zod schemas**

Create `aimeat/src/models/agent-capabilities-schemas.ts`:

```typescript
import { z } from 'zod';

export const AgentCapabilitiesUpdateSchema = z.object({
  technical: z.array(z.object({
    name: z.string().min(1).max(256),
    type: z.enum(['mcp', 'skill', 'tool']),
  })).max(100).optional().default([]),
  domain: z.array(z.string().min(1).max(256)).max(50).optional().default([]),
  languages: z.array(z.string().min(1).max(10)).max(20).optional(),
});
```

- [ ] **Step 2: Create capabilities route handler**

Create `aimeat/src/routes/agent-capabilities.ts`:

```
PUT  /v1/agents/:name/capabilities    -- agent reports its capabilities (requireAuth, requireRole('agent'))
GET  /v1/agents/:name/capabilities    -- get capabilities (requireAuth)
```

The PUT endpoint:
1. Validates body with `AgentCapabilitiesUpdateSchema`
2. For each technical capability with `type: 'mcp'`: check if an MCP session exists for this agent to set `verified: true`, otherwise `verified: false`
3. Stores `technicalCapabilities` and `domainCapabilities` on the AgentRecord via `storage.updateAgent()`
4. If `languages` provided, merge into `domainCapabilities` as entries like `"Language: fi"`, `"Language: en"`

The GET endpoint returns the agent's current capabilities. For owner sessions, resolve the agent by name. Include the `activityStats` summary too for convenience.

- [ ] **Step 3: Mount route**

In `routes-loader.ts`:
```typescript
import { agentCapabilitiesRouter } from '../routes/agent-capabilities.js';
app.use(agentCapabilitiesRouter(config, storage));
```

- [ ] **Step 4: Verify compile + commit**

```bash
git add aimeat/src/routes/agent-capabilities.ts aimeat/src/models/agent-capabilities-schemas.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add agent capabilities REST endpoints (PUT/GET)"
```

---

## Task 3: Activity REST Endpoints

**Files:**
- Create: `aimeat/src/routes/agent-activity.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create activity route handler**

```
GET  /v1/agents/:name/activity        -- stats + history (?days=30, ?granularity=daily|hourly)
GET  /v1/agents/:name/activity/log    -- event log drill-down (?page=, ?per_page=)
```

The `/activity` endpoint:
1. Returns `activityStats` from AgentRecord (summary counters)
2. Returns `history` from `storage.getActivityHistory(agentGaii, { days, granularity })`
3. Returns `scheduledJobs` -- query `storage.listScheduledJobs()` filtered by extensions where `createdByAgent === agentGaii`. Tag each as `aimeat` (extension cron) or `agent` (agent's own).

The `/activity/log` endpoint:
1. Lists all task events for this agent's tasks, ordered by timestamp descending
2. Paginated with `page` and `per_page`
3. Includes task title alongside each event for context

- [ ] **Step 2: Mount route + verify + commit**

```bash
git add aimeat/src/routes/agent-activity.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add agent activity REST endpoints (stats, history, log)"
```

---

## Task 4: Capabilities + Activity MCP Tools

**Files:**
- Create: `aimeat/src/mcp/agent-capabilities.ts`
- Modify: `aimeat/src/mcp/index.ts`

- [ ] **Step 1: Create MCP tools**

Two tools following `aimeat_{singular}_{verb}` convention:

`aimeat_agent_capabilities_report`:
- Input: `technical` (array of {name, type}), `domain` (string array), `languages` (string array)
- Calls the same logic as `PUT /v1/agents/:name/capabilities`
- Returns updated capabilities

`aimeat_agent_activity`:
- Input: `days` (optional, default 30), `granularity` (optional, daily|hourly)
- Returns activityStats + history

- [ ] **Step 2: Register in index.ts**

```typescript
import { registerAgentCapabilityTools } from './agent-capabilities.js';
registerAgentCapabilityTools(mcp, storage, config, getAgentGaii);
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/mcp/agent-capabilities.ts aimeat/src/mcp/index.ts
git commit -m "feat: add agent capabilities and activity MCP tools"
```

---

## Task 5: Capabilities Sub-tab (Frontend)

**Files:**
- Create: `aimeat/public/views/profile/agents-capabilities-subtab.js`
- Create: `aimeat/public/js/services/agent-capabilities.js`
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/spa.html`

- [ ] **Step 1: Create API service**

```javascript
export async function getCapabilities(agentName) {
  const resp = await fetch(`/v1/agents/${agentName}/capabilities`, { headers: authHeaders() });
  return resp.json();
}
export async function updateCapabilities(agentName, data) {
  const resp = await fetch(`/v1/agents/${agentName}/capabilities`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.json();
}
```

- [ ] **Step 2: Create Capabilities sub-tab component**

Three sections from the design spec:

**Technical Skills** -- list of badges. Each shows name, type badge (MCP/skill/tool), verified/self-reported badge. Data from `agent.technicalCapabilities[]`.

**Domain Knowledge** -- list of domain expertise strings + language badges. Data from `agent.domainCapabilities[]`.

**Action Queue Support** -- shows what the agent can do for other agents. Derived from the agent's scopes: does it have `work:accept`? `work:deliver`? Show checkmarks.

Owner can manually add/remove capabilities via edit buttons. Agent reports its own via the PUT endpoint.

- [ ] **Step 3: Add sub-tab to agents-tab.js**

Add to `AGENT_SUBTABS`:
```javascript
{ id: 'capabilities', key: 'profile.agents.subtabs.capabilities' },
```

Import and render `AgentCapabilitiesSubtab` when this tab is active.

- [ ] **Step 4: Add importmap entry + commit**

```bash
git add aimeat/public/views/profile/agents-capabilities-subtab.js aimeat/public/js/services/agent-capabilities.js aimeat/public/views/profile/agents-tab.js aimeat/public/spa.html
git commit -m "feat: add Capabilities sub-tab with technical and domain skill display"
```

---

## Task 6: Activity Sub-tab (Frontend)

**Files:**
- Create: `aimeat/public/views/profile/agents-activity-subtab.js`
- Create: `aimeat/public/js/services/agent-activity.js`
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/css/views/agents-detail.css`
- Modify: `aimeat/public/spa.html`

- [ ] **Step 1: Create API service**

```javascript
export async function getActivity(agentName, days = 30, granularity = 'daily') {
  const resp = await fetch(`/v1/agents/${agentName}/activity?days=${days}&granularity=${granularity}`, { headers: authHeaders() });
  return resp.json();
}
export async function getActivityLog(agentName, page = 1, perPage = 20) {
  const resp = await fetch(`/v1/agents/${agentName}/activity/log?page=${page}&per_page=${perPage}`, { headers: authHeaders() });
  return resp.json();
}
```

- [ ] **Step 2: Create Activity sub-tab component**

Four sections from the design spec mockup:

**Stats Summary Cards** -- 3 cards: tasks completed (number), tokens used 30d (number), success rate (percentage). Data from `activityStats`.

**Activity Chart** -- bar chart showing daily activity over the selected period. Uses Chart.js (already available in the admin stats tab). X-axis = dates, Y-axis = task count or token usage. Time range selector: 7d / 30d / 90d.

**Scheduled Jobs** -- list of cron jobs associated with this agent's extensions. Each tagged `AIMEAT` (green, zero tokens) or `agent env` (amber). Shows: job name, cron expression, last run, result, next run.

**Recent Event Log** -- scrollable list of recent task events. Each shows: timestamp, event type icon, message, token count if available. "View full log" link for pagination.

- [ ] **Step 3: Add CSS for stats cards and chart container**

Add to `agents-detail.css`:
```css
.agd-stats-grid { display: flex; gap: 8px; margin-bottom: 16px; }
.agd-stat-card { flex: 1; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
.agd-stat-value { font-size: 1.5rem; font-weight: 600; }
.agd-stat-label { font-size: 0.75rem; color: var(--text-muted); }
.agd-chart-container { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
.agd-log-entry { display: flex; gap: 8px; padding: 6px 10px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 3px; font-size: 0.8rem; }
.agd-job-badge-aimeat { background: rgba(74,222,128,0.15); color: #4ade80; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; }
.agd-job-badge-agent { background: rgba(245,158,11,0.15); color: #f59e0b; padding: 2px 6px; border-radius: 3px; font-size: 0.7rem; }
```

- [ ] **Step 4: Add sub-tab to agents-tab.js + importmap**

Add to `AGENT_SUBTABS`:
```javascript
{ id: 'activity', key: 'profile.agents.subtabs.activity' },
```

- [ ] **Step 5: Commit**

```bash
git add aimeat/public/views/profile/agents-activity-subtab.js aimeat/public/js/services/agent-activity.js aimeat/public/views/profile/agents-tab.js aimeat/public/css/views/agents-detail.css aimeat/public/spa.html
git commit -m "feat: add Activity sub-tab with stats cards, chart, scheduled jobs, event log"
```

---

## Task 7: Tier1 Prompt Extension for Capabilities

**Files:**
- Modify: `aimeat/src/routes/prompts.ts`

- [ ] **Step 1: Add capability reporting section to tier1**

In the tier1 prompt template, add after the existing task/directives sections:

```
CAPABILITY REPORTING (on first connect and when capabilities change)

Report your capabilities so the system knows what you can do:
  PUT /v1/agents/{name}/capabilities
  Body: {
    technical: [
      { name: "description of capability", type: "mcp|skill|tool" }
    ],
    domain: ["area of expertise", "another area"],
    languages: ["fi", "en"]
  }

Keep this updated. When you learn new skills or connect new tools, report them.
This helps the system route tasks to agents with the right capabilities.
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: extend tier1 prompt with capability reporting instructions"
```

---

## Task 8: i18n Keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add keys to both files**

Keys needed (add to both en.json and fi.json simultaneously):

```json
{
  "profile.agents.subtabs.capabilities": "Capabilities" / "Kyvykkyydet",
  "profile.agents.subtabs.activity": "Activity" / "Aktiivisuus",
  "profile.agents.capabilities.technical": "Technical Skills" / "Tekniset taidot",
  "profile.agents.capabilities.domain": "Domain Knowledge" / "Osaamisalueet",
  "profile.agents.capabilities.actionQueue": "Action Queue Support" / "Toimintajonotuki",
  "profile.agents.capabilities.verified": "verified" / "vahvistettu",
  "profile.agents.capabilities.selfReported": "self-reported" / "itse ilmoitettu",
  "profile.agents.capabilities.empty": "No capabilities reported yet" / "Kyvykkyyksia ei vielä ilmoitettu",
  "profile.agents.activity.tasksCompleted": "Tasks Completed" / "Tehtäviä suoritettu",
  "profile.agents.activity.tokensUsed": "Tokens Used (30d)" / "Tokeneita käytetty (30pv)",
  "profile.agents.activity.successRate": "Success Rate" / "Onnistumisprosentti",
  "profile.agents.activity.scheduledJobs": "Scheduled Jobs" / "Ajastetut tehtävät",
  "profile.agents.activity.recentLog": "Recent Log" / "Viimeisimmät tapahtumat",
  "profile.agents.activity.viewFullLog": "View full log" / "Näytä koko loki",
  "profile.agents.activity.noActivity": "No activity recorded yet" / "Ei vielä aktiivisuutta",
  "profile.agents.activity.aimeatJob": "AIMEAT (system)" / "AIMEAT (järjestelmä)",
  "profile.agents.activity.agentJob": "Agent environment" / "Agentti-ympäristö"
}
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add i18n keys for capabilities and activity sub-tabs"
```

---

## Task 9: OpenAPI Documentation

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Document new endpoints**

Add to openapi.yaml:
```
PUT  /v1/agents/{name}/capabilities     -- update capabilities (request body: technical, domain, languages)
GET  /v1/agents/{name}/capabilities     -- get capabilities
GET  /v1/agents/{name}/activity         -- get activity stats + history (query: days, granularity)
GET  /v1/agents/{name}/activity/log     -- get event log (query: page, per_page)
```

Response schemas should reference the `AgentTechnicalCapability` and `AgentActivityStats` types from the design spec.

- [ ] **Step 2: Commit**

```bash
git add openapi.yaml
git commit -m "feat: document capabilities and activity endpoints in OpenAPI spec"
```

---

## Task 10: E2E Tests

**Files:**
- Create: `aimeat/test/e2e-agent-capabilities.ts`
- Create: `aimeat/test/e2e-agent-activity.ts`
- Modify: `aimeat/test/run-e2e-ci.ts`

- [ ] **Step 1: Capabilities E2E tests**

Test scenarios:
1. PUT capabilities with technical + domain + languages
2. GET capabilities returns what was set
3. Overwrite capabilities (full replace, not merge)
4. Empty arrays clear capabilities
5. MCP tool: aimeat_agent_capabilities_report works

- [ ] **Step 2: Activity E2E tests**

Test scenarios:
1. Create and complete a task -> activityStats updated (tasksCompleted incremented)
2. Create and fail a task -> tasksFailed incremented, successRate recalculated
3. GET /activity returns stats + history rows
4. GET /activity?days=7 filters to last 7 days
5. GET /activity?granularity=hourly returns hourly breakdown
6. GET /activity/log returns paginated events from the agent's tasks
7. MCP tool: aimeat_agent_activity returns stats

- [ ] **Step 3: Register in CI runner**

Add both test files to `run-e2e-ci.ts` test list.

- [ ] **Step 4: Run tests**

```bash
pnpm test:e2e
pnpm test:e2e:mongodb
```

Expected: all new tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add aimeat/test/e2e-agent-capabilities.ts aimeat/test/e2e-agent-activity.ts aimeat/test/run-e2e-ci.ts
git commit -m "test: add E2E tests for agent capabilities and activity"
```

---

## Task Dependency Graph

```
Task 1 (activity recorder) ─── Task 3 (activity endpoints) ─── Task 6 (activity UI)
                            └── Task 10 (tests)
Task 2 (capabilities endpoints) ─── Task 4 (MCP tools) ─── Task 5 (capabilities UI)
                                 └── Task 7 (tier1 prompt)
Task 8 (i18n) -- can run in parallel with any task
Task 9 (OpenAPI) -- can run in parallel with any task
Task 10 (tests) -- depends on Tasks 1-4
```

Tasks 1+2 can run in parallel (no dependencies).
Tasks 3+4+5+6+7 depend on 1 and/or 2.
Tasks 8+9 are independent.
Task 10 is the final verification.
