# Execution Prompt: Plan 5 -- Governance + Admin Dashboard

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

Implement Plan 5: Governance + Admin Dashboard for the AIMEAT Agent Integration Architecture. This adds budget controls, task pause, readiness-based access control, stall detection extensions, admin fleet management endpoints, and the admin dashboard Agent Integration tab.

## Prerequisites

**Plans 1-4 must be completed first.** This plan depends on:
- Plan 1: Webhook dispatcher, telemetry endpoint, delivery log
- Plan 3: Onboarding records, readiness scoring, platform detection
- Plan 4: Tab-view UI (Activity tab, Integration tab to be extended)

## Files You Must Read Before Starting

Read these files carefully before writing any code. They define exactly what to build:

1. **Implementation plan (your task list):** `docs/superpowers/plans/2026-05-23-plan-5-governance.md`
2. **Design spec (the source of truth):** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- focus on Part 5 (Governance) and Part 6 (Admin Dashboard)
3. **CLAUDE.md** -- mandatory rules for this project (file headers, storage sync, OpenAPI sync, i18n sync, testing, frontend styling)
4. **Frontend development guide:** `docs/frontend-development-guide.md` -- for the admin dashboard tab

## What You Are Building

### Backend
- **Budget controls:** `budgetLimits` field on AgentDirectivesRecord (maxTokensPerTask, maxTokensPerDay, maxTasksPerDay, alertThreshold) with Zod schema
- **Task pause:** `POST /v1/agents/:name/tasks/:taskId/pause` (owner only, fires `task.paused` webhook)
- **Owner-only start:** Enforce `requireRole('owner')` on `POST /tasks/:id/start`
- **Readiness-based access control:** `requireReadiness(minLevel)` middleware that checks the agent's effective readiness level. Agents need 'standard' or higher to PATCH tasks. Owners bypass.
- **Stall detection extensions:** `unreachable` (no inbox poll for 2h, no webhook) and `webhook_down` (10+ consecutive failures) states
- **Admin endpoints:** GET /v1/admin/platforms, GET /v1/admin/agents/onboarding, GET /v1/admin/agents/readiness, GET /v1/admin/skill-bundles, POST /v1/admin/skill-bundles/regenerate

### Frontend
- **Admin Agent Integration tab:** Three sections -- Platform Registry (table), Onboarding Overview (completed/in-progress/stuck counts), Skill Bundle Management (per-platform status + regenerate button)
- **Activity tab governance view:** TODAY'S GOVERNANCE section (token budget, tasks today, policy issues, delivery health) + Governance filter in event log
- **Delivery log UI:** Table in Integration tab's production view (timestamp, event type, channel, result, latency)

## How To Execute

1. **Follow the plan task by task, step by step.** The plan has 12 tasks. Do them in order.
2. **After each task, run `pnpm typecheck`** to catch type errors early.
3. **Commit at the end of each task** (not after every step). One commit per task.
4. **Do NOT deviate from the design spec.** The readiness levels, budget fields, and admin sections are exactly as specified.
5. **Test in the browser** for frontend changes. Start `pnpm dev` and verify.

## Critical Patterns To Follow (from existing codebase)

### Backend Patterns
- **Route pattern:** `export function myRouter(config: AimeatConfig, storage: Storage): Router`
- **Auth:** `requireAuth()`, `requireRole('owner')` for task control, `requireRole('operator')` for admin endpoints
- **Response envelope:** `success(config.nodeId, data)` and `error(config.nodeId, code, message)`
- **Webhook dispatch:** Import and call the dispatcher from Plan 1 for `task.paused` events
- **SSE updates:** `emitChange('agent-tasks')`, `emitChange('agent-onboarding')` after mutations
- **File headers:** `@file`, `@description`, `@structure`, `@version-history`
- **Import extensions:** Always `.js` (ESM requirement)

### Frontend Patterns
- **Admin tab pattern:** Follow existing admin tabs in `public/views/admin/`. Register in `admin.js` ADMIN_TABS array.
- **CSS prefix:** Admin styles use `adm-agi-*` prefix (admin agent integration)
- **CSS variables only:** From `theme.css`. No hardcoded colors, no inline styles.
- **i18n:** All text via `t()`. No hardcoded strings.
- **API service:** Use `apiGet`/`apiPost` from `/js/api.js`
- **Live updates:** Admin tab must listen for `aimeat-live-update` events
- **Importmap:** Add entries for new shared JS modules in `public/spa.html`

## Readiness Gate Levels

| Level | Score Range | What the agent can do |
|-------|-----------|----------------------|
| basic | 0-30 | Read inbox, read directives, report telemetry |
| standard | 31-60 | All of basic + propose todos, execute tasks, send messages |
| full | 61-90 | All of standard + write to memory areas, use external tools |
| expert | 91-100 | Full access, reduced oversight requirements |

**Key rule:** Owners always bypass readiness gates (checked by role, not identity). Readiness gates only restrict agent-role callers.

## Testing Requirements

After ALL 12 tasks are implemented:

1. **Run typecheck:** `pnpm typecheck` -- must pass with 0 errors
2. **Run lint:** `pnpm lint` -- must pass
3. **Run E2E tests on both backends:**
   ```
   pnpm test:e2e:mongodb
   pnpm test:e2e:sqlite
   ```
   Target: 0 failures. Both backends must pass.
4. **Run Playwright tests:**
   ```
   pnpm test:playwright:mongodb
   ```
   Target: 0 failures. New and existing tests must pass.
5. **Fix any failures before proceeding to the gap audit.**

## Gap Audit (MANDATORY -- Do This After All Tests Pass)

After implementation is complete and tests pass, perform a thorough gap audit. This is not optional.

### Audit Step 1: Design Spec Coverage

Re-read the design spec (`docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md`, Parts 5, 6) section by section. For each requirement, verify it was implemented:

**Budget Controls (Part 5):**
- [ ] `budgetLimits` field on AgentDirectivesRecord with: maxTokensPerTask, maxTokensPerDay, maxTasksPerDay, alertThreshold
- [ ] Zod schema for budget limits validation
- [ ] Budget limits stored in both backends (SQLite JSON field, MongoDB nested object)
- [ ] Budget limits returned in GET /directives response
- [ ] Budget limits settable via PUT /directives

**Task Governance (Part 5):**
- [ ] Owner-only task start: `POST /tasks/:id/start` requires `requireRole('owner')`
- [ ] Task pause endpoint: `POST /v1/agents/:name/tasks/:taskId/pause`
- [ ] Task pause: only works on `active` tasks, returns 400 for wrong state
- [ ] Task pause: fires `task.paused` webhook event
- [ ] Task pause: owner only (403 for agents)
- [ ] `paused` status added to task status enum if not already present

**Readiness-Based Access Control (Part 5):**
- [ ] `requireReadiness(minLevel)` middleware
- [ ] Readiness check: fetches onboarding record, compares effective level
- [ ] Readiness override support (checks expiresAt before applying)
- [ ] Owner bypass: owners are never blocked by readiness gates
- [ ] Applied to task PATCH (propose todos): requires 'standard'
- [ ] Applied to task events and complete: requires 'standard'
- [ ] Returns 403 with READINESS_INSUFFICIENT error code

**Stall Detection (Part 5):**
- [ ] `unreachable` condition: no inbox poll for 2 hours AND no webhook configured
- [ ] `webhook_down` condition: webhookFailCount >= 10

**Admin Endpoints (Part 6):**
- [ ] GET /v1/admin/platforms -- list known platforms with agent counts
- [ ] GET /v1/admin/agents/onboarding -- aggregate onboarding status (completed, in-progress, stuck)
- [ ] GET /v1/admin/agents/readiness -- readiness level distribution
- [ ] GET /v1/admin/skill-bundles -- per-platform bundle status
- [ ] All admin endpoints require `requireRole('operator')`

**Admin Dashboard UI (Part 6):**
- [ ] Agent Integration tab registered in admin.js
- [ ] Section 1: Platform Registry table (ID, display name, agent count, adapter, detect pattern)
- [ ] Section 2: Onboarding Overview (completed/in-progress/stuck counts, stuck agent list with current step)
- [ ] Section 3: Skill Bundle Management (per-platform agent count, outdated count, regenerate button)

**Activity Tab Governance View:**
- [ ] TODAY'S GOVERNANCE section with token budget, tasks today, policy issues, delivery health
- [ ] Governance filter button in event log filter bar
- [ ] Governance events shown with distinct styling

**Delivery Log UI:**
- [ ] Delivery log table in Integration tab's production view
- [ ] Columns: timestamp, event type, channel, result, latency
- [ ] [Show all] link to expand to full history

**General:**
- [ ] OpenAPI spec entries for: task pause, admin platforms, admin onboarding, admin readiness, admin skill-bundles
- [ ] i18n keys in both en.json and fi.json (governance labels, admin tab text, readiness gate messages)

### Audit Step 2: Code Quality Scan

Search for problems:

```
grep -r "TODO\|FIXME\|HACK\|STUB\|PLACEHOLDER\|TBD\|not implemented\|throw new Error('Not" aimeat/src/middleware/readiness-gate.ts aimeat/src/routes/admin-agent-integration.ts
```

Check for:
- [ ] No TODO/FIXME/STUB comments left in new files
- [ ] No placeholder implementations
- [ ] No empty catch blocks
- [ ] All new files have proper file headers
- [ ] All imports use `.js` extension (ESM requirement)
- [ ] No inline styles in frontend code
- [ ] No hardcoded colors in CSS (use CSS variables)
- [ ] All user-visible text uses `t()` function

### Audit Step 3: Fix Everything Found

If the audit found ANY gaps:
1. List all gaps found
2. Fix each one
3. Run `pnpm typecheck && pnpm lint` again
4. Run `pnpm test:e2e:mongodb && pnpm test:e2e:sqlite` again
5. Run `pnpm test:playwright:mongodb` again
6. Re-audit: re-read the design spec sections and verify the fixes
7. Repeat until clean

### Final State

When done, report:
- Number of tasks completed
- Number of new files created
- Number of files modified
- E2E test results (pass count on both backends)
- Playwright test results
- Any design spec requirements that were intentionally deferred and why
