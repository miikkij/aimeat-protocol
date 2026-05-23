# Plan 5: Governance + Admin Dashboard -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add governance controls (budget limits, task pause, readiness-based access control, action audit trail) and an admin dashboard Agent Integration tab (platform registry, onboarding overview, skill bundle management) for operator-level fleet oversight.

**Architecture:** Budget controls extend `AgentDirectivesRecord`. Readiness-based access control is implemented as middleware that checks the agent's effective readiness score before allowing certain operations. The action audit trail logs every mutating API call. The admin dashboard gets a new Agent Integration tab with three sections: platform registry, onboarding overview, and skill bundle management.

**Tech Stack:** Express 5 middleware, Zod validation, Preact + HTM (admin tab), existing admin dashboard patterns

**Master plan:** `docs/superpowers/plans/2026-05-23-agent-integration-master-plan.md`
**Spec:** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` (Parts 5, 6)
**Depends on:** Plans 1-4 (webhook dispatcher, onboarding, readiness scoring, tab-view UI)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `aimeat/src/middleware/readiness-gate.ts` | Middleware: check agent readiness level before allowing operations |
| `aimeat/src/routes/admin-agent-integration.ts` | Admin endpoints: platform registry CRUD, onboarding overview, bundle management |
| `aimeat/public/views/admin/agent-integration-tab.js` | Admin dashboard: Agent Integration tab (platform registry, onboarding overview, skill bundles) |
| `aimeat/public/js/services/admin-agent-integration.js` | API service for admin agent integration endpoints |
| `aimeat/public/css/views/admin-agent-integration.css` | Admin tab styles (`adm-agi-*` prefix) |
| `test/agent-governance.ts` | E2E tests for governance controls |
| `test/playwright/admin-agent-integration.spec.ts` | Playwright tests for admin dashboard tab |

### Modified Files

| File | What changes |
|------|-------------|
| `aimeat/src/storage/interface.ts` | Add `budgetLimits` to AgentDirectivesRecord, ActionAuditEntry type |
| `aimeat/src/routes/agent-tasks.ts` | Enforce `requireRole('owner')` on `POST /start`, add `POST /pause` endpoint |
| `aimeat/src/routes/agent-directives.ts` | Add `budgetLimits` field to directives schema |
| `aimeat/src/server-bootstrap/routes-loader.ts` | Mount admin integration router |
| `aimeat/public/views/admin/admin.js` | Register Agent Integration tab |
| `aimeat/public/spa.html` | Add importmap entries |
| `aimeat/openapi.yaml` | Admin endpoints, pause endpoint, budget fields |
| `aimeat/locales/en.json` | Governance labels, admin tab text |
| `aimeat/locales/fi.json` | Same in Finnish |

---

## Task 1: Budget Controls in Directives

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Modify: `aimeat/src/models/agent-directives-schemas.ts`
- Modify: `aimeat/src/routes/agent-directives.ts`

Add budget limit fields to the directives system so owners can set token/task caps per agent.

- [ ] **Step 1: Add budgetLimits to AgentDirectivesRecord**

In `aimeat/src/storage/interface.ts`, find the `AgentDirectivesRecord` type and add:

```typescript
budgetLimits?: {
  maxTokensPerTask?: number;
  maxTokensPerDay?: number;
  maxTasksPerDay?: number;
  alertThreshold?: number;
};
```

- [ ] **Step 2: Add Zod schema for budget limits**

In `aimeat/src/models/agent-directives-schemas.ts`, add a `BudgetLimitsSchema`:

```typescript
export const BudgetLimitsSchema = z.object({
  maxTokensPerTask: z.number().int().positive().optional(),
  maxTokensPerDay: z.number().int().positive().optional(),
  maxTasksPerDay: z.number().int().positive().optional(),
  alertThreshold: z.number().int().min(1).max(100).optional(),
}).optional();
```

Add `budgetLimits: BudgetLimitsSchema` to the existing `AgentDirectivesSchema`.

- [ ] **Step 3: Update directives storage (both backends)**

Ensure both SQLite and MongoDB providers handle the new `budgetLimits` field in serialization/deserialization. SQLite stores it as JSON text; MongoDB stores it as a nested BSON object.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/models/agent-directives-schemas.ts aimeat/src/routes/agent-directives.ts aimeat/src/storage/providers/
git commit -m "feat(governance): add budget limits to agent directives"
```

---

## Task 2: Task Pause Endpoint + Owner-Only Start

**Files:**
- Modify: `aimeat/src/routes/agent-tasks.ts`

Two changes: enforce `requireRole('owner')` on `POST /tasks/:id/start`, and add `POST /tasks/:id/pause`.

- [ ] **Step 1: Enforce owner role on task start**

In `aimeat/src/routes/agent-tasks.ts`, find the `POST /v1/agents/:name/tasks/:taskId/start` handler and add `requireRole('owner')` to the middleware chain:

```typescript
router.post('/v1/agents/:name/tasks/:taskId/start',
  requireAuth(), requireRole('owner'),
  async (req, res) => { ... }
);
```

This enforces the "propose before start" rule at the code level: only the owner can transition a task from `queued` to `active`.

- [ ] **Step 2: Add POST /tasks/:id/pause endpoint**

Add a new handler for `POST /v1/agents/:name/tasks/:taskId/pause`:

```typescript
router.post('/v1/agents/:name/tasks/:taskId/pause',
  requireAuth(), requireRole('owner'),
  async (req, res) => {
    const taskId = req.params.taskId as string;
    const task = await storage.getAgentTask(taskId);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }
    if (task.status !== 'active') {
      res.status(400).json(error(config.nodeId, 'INVALID_STATE', `Cannot pause task in '${task.status}' state`));
      return;
    }

    const updated = await storage.updateAgentTask(taskId, {
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });

    // Fire webhook: task.paused
    await dispatchWebhookEvent(task.agentGaii, 'task.paused', {
      task_id: taskId,
      title: task.title,
      status: 'paused',
      paused_at: new Date().toISOString(),
    }, config, storage);

    emitChange('agent-tasks');
    res.json(success(config.nodeId, { task: updated }));
  }
);
```

Note: The `paused` status may need to be added to the allowed task statuses in the storage interface if it does not already exist.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/agent-tasks.ts
git commit -m "feat(governance): enforce owner-only task start, add task pause endpoint"
```

---

## Task 3: Readiness-Based Access Control Middleware

**Files:**
- Create: `aimeat/src/middleware/readiness-gate.ts`
- Modify: `aimeat/src/routes/agent-tasks.ts`

Middleware that checks the agent's readiness level before allowing certain operations.

- [ ] **Step 1: Create the readiness gate middleware**

Create `aimeat/src/middleware/readiness-gate.ts`:

```typescript
/**
 * @file readiness-gate.ts
 * @description Middleware that checks agent readiness level before allowing operations.
 *   Readiness levels (basic/standard/full/expert) determine what the agent can do.
 * @structure
 *   - requireReadiness(minLevel) -- middleware factory that checks readiness
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase C
 */

import type { Request, Response, NextFunction } from 'express';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { error } from './envelope.js';
import { buildGAII } from '../utils/gaii.js';

const LEVEL_ORDER = ['basic', 'standard', 'full', 'expert'] as const;
type ReadinessLevel = typeof LEVEL_ORDER[number];

function levelIndex(level: string): number {
  return LEVEL_ORDER.indexOf(level as ReadinessLevel);
}

export function requireReadiness(
  minLevel: ReadinessLevel,
  config: AimeatConfig,
  storage: Storage,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isAgent = req.auth?.roles.includes('agent') ?? false;
    if (!isAgent) {
      next();
      return;
    }

    const agentGaii = req.auth!.sub;
    const onboarding = await storage.getOnboarding(agentGaii);

    if (!onboarding) {
      res.status(403).json(error(config.nodeId, 'READINESS_REQUIRED',
        `Agent readiness level '${minLevel}' required. No onboarding record found.`));
      return;
    }

    const effectiveLevel = onboarding.readinessLevel ?? 'basic';

    // Check for override
    if (onboarding.readinessOverride) {
      const override = onboarding.readinessOverride;
      const now = new Date().toISOString();
      if (override.expiresAt > now) {
        if (levelIndex(override.level) >= levelIndex(minLevel)) {
          next();
          return;
        }
      }
    }

    if (levelIndex(effectiveLevel) < levelIndex(minLevel)) {
      res.status(403).json(error(config.nodeId, 'READINESS_INSUFFICIENT',
        `Agent readiness level '${minLevel}' required, current level is '${effectiveLevel}'.`));
      return;
    }

    next();
  };
}
```

- [ ] **Step 2: Apply readiness gates to task routes**

In `aimeat/src/routes/agent-tasks.ts`, add readiness checks:

- `PATCH /tasks/:id` (propose todos): requires `standard` level
- Task execution events (`POST /tasks/:id/event`, `POST /tasks/:id/complete`): requires `standard` level
- These only apply when the caller is an agent (owner bypasses via role check)

```typescript
import { requireReadiness } from '../middleware/readiness-gate.js';

// On task PATCH (agent proposes todos):
router.patch('/v1/agents/:name/tasks/:taskId',
  requireAuth(),
  requireReadiness('standard', config, storage),
  async (req, res) => { ... }
);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/middleware/readiness-gate.ts aimeat/src/routes/agent-tasks.ts
git commit -m "feat(governance): add readiness-based access control middleware"
```

---

## Task 4: Stall Detection Extensions

**Files:**
- Modify: `aimeat/src/services/stall-detector.ts` (or equivalent)

Extend existing stall detection with two new conditions: `unreachable` (no inbox poll for 2h) and `webhook_down` (10 consecutive failures).

- [ ] **Step 1: Find the stall detection service**

Locate the existing stall detection logic. It may be in `src/services/` or within the task routes. The current logic marks tasks as stalled if no events for 30 minutes.

- [ ] **Step 2: Add new stall conditions**

Extend with:
- **Unreachable:** Agent has not polled inbox for 2 hours AND has no webhook configured. Mark as `unreachable` in the UI.
- **Webhook down:** Agent has `webhookFailCount >= 10`. Mark as `webhook_down`. Auto-fallback to polling.

These conditions are checked during the existing periodic stall check (if it exists) or during the readiness health recalculation.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/services/
git commit -m "feat(governance): extend stall detection with unreachable and webhook_down states"
```

---

## Task 5: Admin Agent Integration -- Backend Endpoints

**Files:**
- Create: `aimeat/src/routes/admin-agent-integration.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

Admin endpoints for platform registry CRUD, onboarding overview, readiness distribution, and skill bundle management.

- [ ] **Step 1: Create the admin route file**

Create `aimeat/src/routes/admin-agent-integration.ts`:

```typescript
/**
 * @file admin-agent-integration.ts
 * @description Admin dashboard endpoints for agent integration management.
 *   Platform registry CRUD, onboarding overview, readiness distribution,
 *   and skill bundle management.
 * @structure
 *   - GET    /v1/admin/platforms                -- List platforms + agent counts
 *   - POST   /v1/admin/platforms                -- Add platform
 *   - PUT    /v1/admin/platforms/:id            -- Update platform
 *   - DELETE /v1/admin/platforms/:id            -- Remove platform
 *   - GET    /v1/admin/agents/onboarding        -- Aggregate onboarding status
 *   - GET    /v1/admin/agents/readiness         -- Readiness distribution
 *   - GET    /v1/admin/skill-bundles            -- Bundle version status per platform
 *   - POST   /v1/admin/skill-bundles/regenerate -- Force regenerate + notify
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase C
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { getKnownPlatforms } from '../services/platform-detector.js';

export function adminAgentIntegrationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const auth = [requireAuth(), requireRole('operator')];

  /* -- GET /v1/admin/platforms -- */
  router.get('/v1/admin/platforms', ...auth, async (_req, res) => {
    const platforms = getKnownPlatforms();
    const agents = await storage.listAgents();

    const platformCounts: Record<string, number> = {};
    for (const agent of agents) {
      const p = agent.platform ?? 'other';
      platformCounts[p] = (platformCounts[p] || 0) + 1;
    }

    const result = platforms.map(p => ({
      ...p,
      agentCount: platformCounts[p.id] ?? 0,
    }));

    res.json(success(config.nodeId, { platforms: result }));
  });

  /* -- GET /v1/admin/agents/onboarding -- */
  router.get('/v1/admin/agents/onboarding', ...auth, async (_req, res) => {
    const allOnboarding = await storage.listOnboardingByStatus('in_progress');
    const completed = await storage.listOnboardingByStatus('completed');

    const stuckThreshold = Date.now() - 24 * 60 * 60 * 1000;
    const stuck = allOnboarding.filter(o => {
      const lastStep = o.steps
        .filter(s => s.validatedAt)
        .sort((a, b) => (b.validatedAt! > a.validatedAt! ? 1 : -1))[0];
      if (!lastStep?.validatedAt) return true;
      return new Date(lastStep.validatedAt).getTime() < stuckThreshold;
    });

    res.json(success(config.nodeId, {
      completed: completed.length,
      inProgress: allOnboarding.length,
      stuck: stuck.map(o => ({
        agentGaii: o.agentGaii,
        currentStep: o.steps.find(s => s.status === 'pending')?.title ?? 'Unknown',
        stuckSince: o.steps.filter(s => s.validatedAt).sort((a, b) =>
          b.validatedAt! > a.validatedAt! ? 1 : -1)[0]?.validatedAt,
      })),
    }));
  });

  /* -- GET /v1/admin/agents/readiness -- */
  router.get('/v1/admin/agents/readiness', ...auth, async (_req, res) => {
    const completed = await storage.listOnboardingByStatus('completed');
    const distribution = { expert: 0, full: 0, standard: 0, basic: 0 };
    for (const o of completed) {
      const level = o.readinessLevel ?? 'basic';
      if (level in distribution) distribution[level as keyof typeof distribution]++;
    }

    res.json(success(config.nodeId, { distribution, total: completed.length }));
  });

  /* -- GET /v1/admin/skill-bundles -- */
  router.get('/v1/admin/skill-bundles', ...auth, async (_req, res) => {
    const agents = await storage.listAgents();
    const allOnboarding = await storage.listOnboardingByStatus('completed');

    const platformBundles: Record<string, { agents: number; outdated: number }> = {};
    for (const agent of agents) {
      const p = agent.platform ?? 'generic';
      if (!platformBundles[p]) platformBundles[p] = { agents: 0, outdated: 0 };
      platformBundles[p].agents++;
    }

    res.json(success(config.nodeId, { bundles: platformBundles }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in routes-loader.ts**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add:

```typescript
import { adminAgentIntegrationRouter } from '../routes/admin-agent-integration.js';
```

And mount:

```typescript
app.use(adminAgentIntegrationRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/admin-agent-integration.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(admin): add Agent Integration admin endpoints (platforms, onboarding, readiness)"
```

---

## Task 6: Admin Dashboard -- Agent Integration Tab (Frontend)

**Files:**
- Create: `aimeat/public/views/admin/agent-integration-tab.js`
- Create: `aimeat/public/js/services/admin-agent-integration.js`
- Create: `aimeat/public/css/views/admin-agent-integration.css`
- Modify: `aimeat/public/views/admin/admin.js`
- Modify: `aimeat/public/spa.html`

New admin tab with three sections: Platform Registry, Onboarding Overview, Skill Bundle Management.

- [ ] **Step 1: Create the admin API service**

Create `aimeat/public/js/services/admin-agent-integration.js`:

```javascript
/**
 * @file admin-agent-integration.js
 * @description API service for admin agent integration endpoints.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase C
 */

import { apiGet, apiPost } from '/js/api.js';

export async function getPlatforms() {
  return apiGet('/v1/admin/platforms');
}

export async function getOnboardingOverview() {
  return apiGet('/v1/admin/agents/onboarding');
}

export async function getReadinessDistribution() {
  return apiGet('/v1/admin/agents/readiness');
}

export async function getSkillBundles() {
  return apiGet('/v1/admin/skill-bundles');
}

export async function regenerateBundles() {
  return apiPost('/v1/admin/skill-bundles/regenerate');
}
```

- [ ] **Step 2: Create the admin tab component**

Create `aimeat/public/views/admin/agent-integration-tab.js`:

Follow the existing admin tab pattern from `public/views/admin/shared.js`. The component should:

- **Section 1: Platform Registry** -- Table showing platform ID, display name, agent count, adapter name, auto-detect pattern. Read-only for now (CRUD in Phase C+1).
- **Section 2: Onboarding Overview** -- Aggregate stats: completed/in-progress/not-started counts. "Stuck agents" list with agent name, current step, and time stuck.
- **Section 3: Skill Bundle Management** -- Per-platform bundle status: platform name, agent count, outdated count. [Regenerate all bundles] button.

Use `t()` for all text, `adm-agi-*` CSS prefix, and the `aimeat-live-update` event listener for real-time updates.

- [ ] **Step 3: Create the admin tab CSS**

Create `aimeat/public/css/views/admin-agent-integration.css` with styles using the `adm-agi-` prefix:

- `.adm-agi-section` -- section container
- `.adm-agi-table` -- data table
- `.adm-agi-stuck` -- stuck agent highlight
- `.adm-agi-stats` -- stat cards (completed/in-progress/stuck)

Use CSS variables from `theme.css`.

- [ ] **Step 4: Register the tab in admin.js**

In `aimeat/public/views/admin/admin.js`, add the Agent Integration tab to the admin tab list:

```javascript
import AgentIntegrationTab from './agent-integration-tab.js';

// Add to ADMIN_TABS array:
{ id: 'agent-integration', key: 'admin.tabs.agentIntegration', component: AgentIntegrationTab }
```

- [ ] **Step 5: Update importmap in spa.html**

Add entries for the new admin modules:

```json
"/js/services/admin-agent-integration.js": "/js/services/admin-agent-integration.js"
```

- [ ] **Step 6: Link CSS in spa.html**

Add:
```html
<link rel="stylesheet" href="/css/views/admin-agent-integration.css">
```

- [ ] **Step 7: Commit**

```bash
git add aimeat/public/views/admin/agent-integration-tab.js aimeat/public/js/services/admin-agent-integration.js aimeat/public/css/views/admin-agent-integration.css aimeat/public/views/admin/admin.js aimeat/public/spa.html
git commit -m "feat(admin): add Agent Integration tab to admin dashboard"
```

---

## Task 7: Activity Tab Governance View (Profile Frontend)

**Files:**
- Modify: `aimeat/public/views/profile/agents/tab-activity.js`

Extend the Activity tab (created in Plan 4) with a governance section showing today's budget usage, policy issues, and delivery health.

- [ ] **Step 1: Add governance section**

In `tab-activity.js`, add a "TODAY'S GOVERNANCE" section above the event log:

```
TODAY'S GOVERNANCE

  Token budget:  12,450 / 50,000 (24.9%)
  Tasks today:   2 completed, 1 active, 0 failed
  Policy issues: 1 (self-start attempt at 14:29)
  Telemetry:     47 events received today

  Delivery health:
    MCP: active    Webhook: 23/23 delivered
```

This section is only visible when the agent has completed onboarding and has governance data available.

- [ ] **Step 2: Add governance event filter**

Add a "Governance" filter button to the activity log filter bar. Governance events include:
- Owner approvals (task start, scope changes)
- Policy violations (self-start attempts, budget exceeded)
- Readiness level changes

These are identified by a `governance` type or tag in the event data.

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-activity.js
git commit -m "feat(agents-ui): add governance view to Activity tab"
```

---

## Task 8: Delivery Log UI in Integration Tab

**Files:**
- Modify: `aimeat/public/views/profile/agents/tab-integration.js`

Add delivery log table to the Integration tab's production state view.

- [ ] **Step 1: Add delivery log section**

In the production state of `tab-integration.js`, add a "DELIVERY LOG" section showing the last 20 deliveries:

- Timestamp
- Event type (`task.queued`, `message.inbound`, etc.)
- Delivery channel (webhook / MCP)
- Result (checkmark / X)
- Latency (e.g., "0.3s")
- [Show all] link to expand to full history

Fetch data via `getDeliveryLog(agentName)` from the API service.

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-integration.js
git commit -m "feat(agents-ui): add delivery log to Integration tab production view"
```

---

## Task 9: OpenAPI + i18n Sync

**Files:**
- Modify: `aimeat/openapi.yaml`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add governance and admin endpoints to openapi.yaml**

Add:
- `POST /v1/agents/{name}/tasks/{taskId}/pause` -- Pause active task
- `GET /v1/admin/platforms` -- List platforms
- `GET /v1/admin/agents/onboarding` -- Onboarding overview
- `GET /v1/admin/agents/readiness` -- Readiness distribution
- `GET /v1/admin/skill-bundles` -- Bundle status
- `POST /v1/admin/skill-bundles/regenerate` -- Regenerate bundles

Also add `budgetLimits` to the directives schema.

- [ ] **Step 2: Add English i18n keys**

```json
"governance": {
  "title": "Governance",
  "tokenBudget": "Token budget",
  "tasksToday": "Tasks today",
  "policyIssues": "Policy issues",
  "telemetryEvents": "Telemetry events today",
  "deliveryHealth": "Delivery health",
  "budgetLimits": {
    "title": "Budget Limits",
    "maxTokensPerTask": "Max tokens per task",
    "maxTokensPerDay": "Max tokens per day",
    "maxTasksPerDay": "Max tasks per day",
    "alertThreshold": "Alert threshold (%)"
  },
  "readinessGate": {
    "insufficient": "Readiness level insufficient",
    "required": "Required level"
  }
},
"admin": {
  "tabs": {
    "agentIntegration": "Agent Integration"
  },
  "agentIntegration": {
    "platformRegistry": "Platform Registry",
    "onboardingOverview": "Onboarding Overview",
    "skillBundles": "Skill Bundles",
    "completed": "Completed",
    "inProgress": "In Progress",
    "stuck": "Stuck",
    "stuckSince": "Stuck since",
    "regenerateAll": "Regenerate all bundles",
    "outdated": "Outdated",
    "agentCount": "Agents",
    "adapter": "Adapter",
    "detectPattern": "Auto-detect pattern"
  }
}
```

- [ ] **Step 3: Add Finnish i18n keys**

```json
"governance": {
  "title": "Hallinto",
  "tokenBudget": "Token-budjetti",
  "tasksToday": "Tehtävät tänään",
  "policyIssues": "Sääntörikkomukset",
  "telemetryEvents": "Telemetriatapahtumia tänään",
  "deliveryHealth": "Toimituksen tila",
  "budgetLimits": {
    "title": "Budjettirajat",
    "maxTokensPerTask": "Max tokenit per tehtävä",
    "maxTokensPerDay": "Max tokenit per päivä",
    "maxTasksPerDay": "Max tehtävät per päivä",
    "alertThreshold": "Hälytysraja (%)"
  },
  "readinessGate": {
    "insufficient": "Valmiustaso riittämätön",
    "required": "Vaadittu taso"
  }
},
"admin": {
  "tabs": {
    "agentIntegration": "Agenttiintegraatio"
  },
  "agentIntegration": {
    "platformRegistry": "Alustarekisteri",
    "onboardingOverview": "Perehdytyksen yleiskuva",
    "skillBundles": "Taitopaketit",
    "completed": "Valmiit",
    "inProgress": "Käynnissä",
    "stuck": "Jumissa",
    "stuckSince": "Jumissa lähtien",
    "regenerateAll": "Luo kaikki paketit uudelleen",
    "outdated": "Vanhentunut",
    "agentCount": "Agentit",
    "adapter": "Adapteri",
    "detectPattern": "Tunnistuskaava"
  }
}
```

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/openapi.yaml aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "docs(governance): add OpenAPI spec and i18n keys for governance + admin"
```

---

## Task 10: E2E Tests -- Governance

**Files:**
- Create: `test/agent-governance.ts`

Test budget controls, owner-only task start, task pause, and readiness gates.

- [ ] **Step 1: Create governance E2E tests**

Create `test/agent-governance.ts`:

Test cases:
1. **Owner-only start:** Agent cannot call POST /tasks/:id/start (403). Owner can (200).
2. **Task pause:** Owner can pause active task (200). Agent cannot (403). Pausing queued task fails (400).
3. **Budget limits in directives:** PUT directives with budgetLimits succeeds. GET directives returns budgetLimits.
4. **Readiness gate:** Agent with 'basic' readiness cannot PATCH tasks (403 READINESS_INSUFFICIENT). Agent with 'standard' or higher can.
5. **Admin endpoints:** Operator can access GET /admin/platforms (200). Non-operator gets 403. Readiness distribution returns valid counts.

- [ ] **Step 2: Run tests**

Run: `pnpm test:e2e -- agent-governance`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/agent-governance.ts
git commit -m "test(governance): add E2E tests for budget, readiness gate, task pause"
```

---

## Task 11: Playwright Tests -- Admin Tab

**Files:**
- Create: `test/playwright/admin-agent-integration.spec.ts`

Test the admin dashboard Agent Integration tab renders correctly.

- [ ] **Step 1: Create Playwright tests**

Create `test/playwright/admin-agent-integration.spec.ts`:

Test cases:
1. **Tab appears in admin dashboard** -- Agent Integration tab is visible in the admin tab bar
2. **Platform Registry renders** -- table showing known platforms with agent counts
3. **Onboarding Overview renders** -- completed/in-progress/stuck counts
4. **Readiness Distribution renders** -- expert/full/standard/basic counts
5. **Skill Bundles section renders** -- per-platform bundle status

Follow the existing admin Playwright test patterns.

- [ ] **Step 2: Run Playwright tests**

Run: `pnpm test:playwright:mongodb -- admin-agent-integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/playwright/admin-agent-integration.spec.ts
git commit -m "test(admin): add Playwright tests for Agent Integration admin tab"
```

---

## Task 12: Run Full Test Suite

**Files:** None (validation only)

- [ ] **Step 1: Run E2E API tests on both backends**

Run: `pnpm test:e2e:mongodb`
Expected: PASS (0 failures)

Run: `pnpm test:e2e:sqlite`
Expected: PASS (0 failures)

- [ ] **Step 2: Run Playwright tests (full suite)**

Run: `pnpm test:playwright:mongodb`
Expected: PASS (0 failures)

- [ ] **Step 3: Fix any failures**

If tests fail, fix them before marking Plan 5 complete.

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(governance): address test failures from governance + admin implementation"
```
