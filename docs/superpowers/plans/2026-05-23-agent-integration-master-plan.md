# Agent Integration -- Master Implementation Plan

> **For agentic workers:** Each sub-plan below is a standalone document with its own task list. Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task-by-task.

**Goal:** Implement the full Agent Integration Architecture (backend) and Agent Detail Tab-View (frontend) across 5 sequential plans.

**Specs:**
- `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` (backend)
- `docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md` (frontend)

---

## Plan Decomposition

The specs define 3 backend phases (A, B, C) and a frontend overhaul. These decompose into 5 implementation plans, each producing working, testable software independently.

### Dependency Graph

```
Plan 1: Push Layer Foundation ──────┐
                                    ├──> Plan 3: Hello Integration Backend
Plan 2: Skill Bundle Generator ─────┘          │
                                               ├──> Plan 5: Governance + Admin
Plan 4: Agent Detail Tab-View Frontend ────────┘
```

Plans 1 and 2 have no dependency on each other and can run in parallel. Plans 3 and 4 require Plan 1. Plan 5 requires Plans 1-4.

---

### Plan 1: Push Layer Foundation (Phase A core)

**File:** `docs/superpowers/plans/2026-05-23-plan-1-push-layer.md`

**What it builds:**
- Webhook fields on AgentRecord (storage sync across SQLite + MongoDB)
- Webhook payload Zod schemas (`webhook-schemas.ts`, v1 vendor contract)
- Webhook dispatcher service (parallel MCP + webhook fire)
- Webhook CRUD routes (`agent-webhook.ts`)
- Telemetry endpoint (`agent-telemetry.ts`)
- Inbox delta endpoint with cursor semantics
- MCP notification integration
- E2E tests for all new endpoints
- OpenAPI + i18n sync

**Estimated tasks:** 10
**Estimated effort:** 2-3 days

---

### Plan 2: Skill Bundle Generator (Phase A)

**File:** `docs/superpowers/plans/2026-05-23-plan-2-skill-bundle.md`

**What it builds:**
- Skill bundle generator core (`references/` content from node config + agent record)
- Hermes adapter (`aimeat-hermes` ZIP: SKILL.md + scripts/ + config/)
- Generic adapter (fallback: references/ only)
- REST endpoint (`GET /v1/agents/:name/skill-bundle?runtime=hermes`)
- Bundle versioning endpoint
- E2E tests

**Estimated tasks:** 7
**Estimated effort:** 1-2 days

---

### Plan 3: Hello Integration Backend (Phase B)

**File:** `docs/superpowers/plans/2026-05-23-plan-3-hello-integration.md`

**Depends on:** Plan 1 (webhook dispatcher, telemetry endpoint)

**What it builds:**
- Platform fields on AgentRecord + platform detector service
- Known platforms registry (config/DB)
- AgentOnboardingRecord + storage in both backends
- Onboarding REST endpoints (start, step/:id, status)
- Automatic step validation (capabilities, delivery, telemetry checks)
- Test task generation (steps 9-10)
- Readiness scoring (baseline + 7-day rolling health)
- Onboarding auto-start trigger on agent approval
- E2E tests for full onboarding flow

**Estimated tasks:** 11
**Estimated effort:** 3-4 days

---

### Plan 4: Agent Detail Tab-View Frontend (Phase B frontend)

**File:** `docs/superpowers/plans/2026-05-23-plan-4-agent-tabview-ui.md`

**Depends on:** Plan 1 (webhook + telemetry APIs), Plan 3 (onboarding API)

**What it builds:**
- Page structure refactor (Shared Agent Board above agent cards)
- Collapsed card with platform/readiness/federation badges
- Expanded card with Two-Zone Header (identity + state-dependent status zone)
- Agent state detection logic (new/onboarding/production/problem)
- Smart default tab selection
- 8 tabs:
  - Integration tab (onboarding checklist + production status + identity)
  - Tasks tab (unchanged, rehoused)
  - Messages tab (command palette + "/" autocomplete)
  - Data Access tab (tags, memory areas, knowledge packages)
  - Directives tab (simplified -- behavioral only)
  - Agent Config tab (file list + preview + two-way sync)
  - Activity tab (governance filter + governance events)
  - Services tab (unchanged, rehoused)
- CSS (`pf-agd-*` prefix)
- i18n keys (en + fi)
- Playwright tests

**Estimated tasks:** 14
**Estimated effort:** 4-5 days

---

### Plan 5: Governance + Admin Dashboard (Phase C)

**File:** `docs/superpowers/plans/2026-05-23-plan-5-governance.md`

**Depends on:** Plans 1-4

**What it builds:**
- Budget controls (tokens/day, tasks/day) in directives
- `requireRole('owner')` enforcement on `POST /tasks/:id/start`
- `POST /tasks/:id/pause` endpoint
- Readiness-based access control middleware
- Action audit trail with policy violation marking
- Activity tab governance view (budget, policy, delivery health)
- Stall detection extensions (unreachable, webhook_down)
- Delivery log UI in Integration tab
- Admin dashboard: Agent Integration tab (platform registry, onboarding overview, skill bundle management)
- E2E + Playwright tests

**Estimated tasks:** 12
**Estimated effort:** 3-4 days

---

## Total Estimated Effort

| Plan | Effort | Depends on |
|------|--------|-----------|
| 1. Push Layer | 2-3 days | -- |
| 2. Skill Bundle | 1-2 days | -- |
| 3. Hello Integration | 3-4 days | Plan 1 |
| 4. Tab-View Frontend | 4-5 days | Plans 1, 3 |
| 5. Governance + Admin | 3-4 days | Plans 1-4 |
| **Total** | **13-18 days** | |

Plans 1 and 2 can run in parallel (critical path: Plan 1 -> Plan 3 -> Plan 4 -> Plan 5).

---

## Execution Strategy

Start with Plan 1 (Push Layer Foundation) -- it unblocks everything else. Each plan is a self-contained document with TDD steps, exact file paths, complete code, and test commands.
