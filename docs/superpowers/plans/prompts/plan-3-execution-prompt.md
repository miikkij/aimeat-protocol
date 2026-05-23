# Execution Prompt: Plan 3 -- Hello Integration Backend

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

Implement Plan 3: Hello Integration Backend for the AIMEAT Agent Integration Architecture. This is the structured 11-step onboarding handshake that validates each agent's capabilities before it enters production.

## Prerequisites

**Plan 1 (Push Layer Foundation) must be completed first.** This plan depends on webhook fields on AgentRecord, the telemetry endpoint, and webhook delivery infrastructure.

## Files You Must Read Before Starting

Read these files carefully before writing any code. They define exactly what to build:

1. **Implementation plan (your task list):** `docs/superpowers/plans/2026-05-23-plan-3-hello-integration.md`
2. **Design spec (the source of truth):** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- focus on Part 3 (Hello Integration) and Part 4 (Readiness Scoring)
3. **CLAUDE.md** -- mandatory rules for this project (file headers, storage sync, OpenAPI sync, i18n sync, testing)
4. **Storage sync guide:** `docs/coding-guidelines/storage-sync.md` -- you are adding a new storage type (AgentOnboardingRecord) which requires syncing across both backends

## What You Are Building

- AgentOnboardingRecord + AgentOnboardingStep types in storage interface
- AgentOnboarding repository interface
- Prisma model for MongoDB + SQLite table with migration
- Storage implementation in both SQLite and MongoDB providers
- 11 onboarding step definitions as constants + Zod validation schemas for step confirmation payloads
- Platform detector service (auto-detect from User-Agent, MCP metadata, or message content)
- Onboarding validator service (validates each step against real system state, not trusting the agent's word)
- Readiness scorer: composite score = onboarding baseline (0-100) * 7-day operational health multiplier (0.0-1.0)
- REST endpoints: GET /v1/agents/:name/onboarding, POST /start, POST /step/:id, DELETE (cancel)
- Onboarding auto-start when agent is approved (both device auth and connectivity key flows)
- E2E tests for the full onboarding flow
- OpenAPI + i18n sync

## How To Execute

1. **Follow the plan task by task, step by step.** The plan has 10 tasks, each broken into concrete steps with code. Do them in order.
2. **Follow TDD rhythm:** write test/schema first, then implement, then verify.
3. **After each task, run `pnpm typecheck`** to catch type errors early.
4. **Commit at the end of each task** (not after every step). One commit per task.
5. **Do NOT deviate from the design spec.** The 11 steps, their validation methods, and the readiness scoring formula are exactly as specified.

## Critical Patterns To Follow (from existing codebase)

- **Storage sync:** When adding AgentOnboardingRecord, update: `interface.ts` (type + Storage intersection), `repositories/` (new repo file + index), `prisma/schema.prisma`, `sqlite/schema.ts` (CREATE TABLE), `sqlite/index.ts` (CRUD with JSON serialize/deserialize), `mongodb/index.ts` (Prisma CRUD + mapper). Read `docs/coding-guidelines/storage-sync.md`.
- **Repository pattern:** Create `src/storage/repositories/agent-onboarding.repository.ts`, export from `index.ts`, add to Storage intersection type
- **Route pattern:** `export function myRouter(config: AimeatConfig, storage: Storage): Router`
- **Auth:** `requireAuth()`, `requireRole('owner')` for start/cancel, both owner and agent for step confirm and status check
- **Identity:** Use `buildGAII()` from `src/utils/gaii.ts`
- **Response envelope:** `success(config.nodeId, data, hints?)` and `error(config.nodeId, code, message)`
- **SSE updates:** Call `emitChange('agent-onboarding')` from `src/services/event-bus.js` after mutations
- **File headers:** Every new `.ts` file needs `@file`, `@description`, `@structure`, `@version-history` header comment
- **Route mounting:** Mount BEFORE `agentsRouter` in `routes-loader.ts`
- **SQLite JSON fields:** Use `JSON.stringify()` on write, `JSON.parse()` on read for complex fields (steps, healthComponents, readinessOverride)
- **MongoDB Date conversion:** Convert Prisma Date objects to ISO strings in the mapper

## The 11 Onboarding Steps

| # | ID | Title | Validation Method | Required |
|---|-----|-------|-------------------|----------|
| 1 | authenticate | Authenticate | Automatic (agent record exists) | Yes |
| 2 | identify_platform | Identify Platform | API call (self-report) or automatic (User-Agent) | Yes |
| 3 | install_skill | Install Skill Bundle | API call (version reported) | Yes |
| 4 | report_capabilities | Report Capabilities | Automatic (capabilities non-empty) | Yes |
| 5 | read_directives | Read Directives | API call (confirmed) | Yes |
| 6 | send_test_message | Send Test Message | Automatic (outbound message exists) | Yes |
| 7 | configure_delivery | Configure Delivery | Automatic (webhook registered) | Yes |
| 8 | report_telemetry | Report Telemetry | Automatic (telemetry event exists) | Yes |
| 9 | accept_test_task | Accept Test Task | Automatic (test task has todos) | Yes |
| 10 | complete_test_task | Complete Test Task | Automatic (test task status = done) | Yes |
| 11 | declare_services | Declare Services | API call (services list) | No |

## Readiness Scoring Formula

- **Baseline** (set once at onboarding completion): 9 pts per required step passed + 10 pts for optional services step. Max = 100.
- **Health** (7-day rolling): `delivery_health * 0.4 + telemetry_continuity * 0.3 + task_completion * 0.3`. Range: 0.0 to 1.0.
- **Effective score:** `floor(baseline * health)`
- **Levels:** basic (0-30), standard (31-60), full (61-90), expert (91-100)

## Testing Requirements

After ALL 10 tasks are implemented:

1. **Run typecheck:** `pnpm typecheck` -- must pass with 0 errors
2. **Run lint:** `pnpm lint` -- must pass
3. **Run E2E tests on both backends:**
   ```
   pnpm test:e2e:mongodb
   pnpm test:e2e:sqlite
   ```
   Target: 0 failures. Both backends must pass.
4. **Fix any failures before proceeding to the gap audit.**

## Gap Audit (MANDATORY -- Do This After All Tests Pass)

After implementation is complete and tests pass, perform a thorough gap audit. This is not optional.

### Audit Step 1: Design Spec Coverage

Re-read the design spec (`docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md`, Parts 3, 4) section by section. For each requirement, verify it was implemented:

- [ ] AgentOnboardingRecord with all fields: agentGaii, status, startedAt, completedAt, steps[], readinessScore, readinessLevel, detectedPlatform, installedRuntime, onboardingBaseline, operationalHealth, healthComponents, healthRecalculatedAt, readinessOverride
- [ ] AgentOnboardingStep with all fields: id, order, title, description, status (pending/passed/failed/skipped), required, validatedAt, validationMethod, details, failureReason
- [ ] All 11 step IDs defined as constants (ONBOARDING_STEP_IDS)
- [ ] Step 1 (authenticate) auto-passed on onboarding start
- [ ] Step 2 (identify_platform) auto-detected from User-Agent when available
- [ ] Steps 9-10 use a test task created during onboarding start
- [ ] Step 11 (declare_services) is optional (required: false)
- [ ] Platform detector: User-Agent pattern matching for Hermes, Claude Code, Copilot, Codex, Gemini
- [ ] Platform detector: MCP metadata fallback
- [ ] Platform detector: message content parsing fallback
- [ ] Onboarding validator: each step validated against real system state, not just trusted
- [ ] Validate capabilities: checks agent has non-empty technicalCapabilities or domainCapabilities
- [ ] Validate test message: checks at least one outbound message exists
- [ ] Validate delivery: checks webhookUrl is set and webhookEnabled is true
- [ ] Validate telemetry: checks at least one telemetry event exists
- [ ] Validate test task: checks test task has todos (step 9) and status = done (step 10)
- [ ] Auto-check: GET /onboarding auto-validates observable steps on every request
- [ ] Auto-complete: when all required steps pass, status transitions to completed + readiness score calculated
- [ ] Readiness baseline: 9 pts per required step, 10 pts for optional services
- [ ] Readiness health: 7-day delivery health (0.4 weight) + telemetry continuity (0.3) + task completion (0.3)
- [ ] Readiness levels: basic (0-30), standard (31-60), full (61-90), expert (91-100)
- [ ] Readiness override: level, setBy, setAt, expiresAt, reason
- [ ] REST: GET /v1/agents/:name/onboarding (status + auto-check)
- [ ] REST: POST /v1/agents/:name/onboarding/start (owner only, creates test task)
- [ ] REST: POST /v1/agents/:name/onboarding/step/:id (agent confirms, server validates)
- [ ] REST: DELETE /v1/agents/:name/onboarding (owner only, cancel)
- [ ] Onboarding auto-start on device auth approval
- [ ] Onboarding auto-start on connectivity key flow (POST /v1/agents/connect)
- [ ] Zod schemas for step-specific payloads (identify_platform, install_skill, read_directives, declare_services)
- [ ] OpenAPI spec entries for all onboarding endpoints
- [ ] i18n keys in both en.json and fi.json (step titles, readiness labels, platform labels)

### Audit Step 2: Storage Sync Completeness

For AgentOnboardingRecord:
- [ ] TypeScript interface in `interface.ts`
- [ ] Repository interface in `repositories/agent-onboarding.repository.ts`
- [ ] Repository exported from `repositories/index.ts`
- [ ] Repository added to Storage intersection type
- [ ] Prisma model in `schema.prisma`
- [ ] SQLite CREATE TABLE in `schema.ts`
- [ ] SQLite CRUD implementation in `sqlite/index.ts` (JSON serialize/deserialize for steps, healthComponents, readinessOverride)
- [ ] MongoDB CRUD implementation in `mongodb/index.ts` (Prisma + mapper with Date-to-ISO conversion)

### Audit Step 3: Code Quality Scan

Search the codebase for problems:

```
grep -r "TODO\|FIXME\|HACK\|STUB\|PLACEHOLDER\|TBD\|not implemented\|throw new Error('Not" aimeat/src/services/platform-detector.ts aimeat/src/services/onboarding-validator.ts aimeat/src/services/readiness-scorer.ts aimeat/src/routes/agent-onboarding.ts aimeat/src/models/agent-onboarding-schemas.ts
```

Check for:
- [ ] No TODO/FIXME/STUB comments left in new files
- [ ] No placeholder implementations
- [ ] No empty catch blocks
- [ ] All new files have proper file headers
- [ ] All imports use `.js` extension (ESM requirement)

### Audit Step 4: Fix Everything Found

If the audit found ANY gaps:
1. List all gaps found
2. Fix each one
3. Run `pnpm typecheck && pnpm lint` again
4. Run `pnpm test:e2e:mongodb && pnpm test:e2e:sqlite` again
5. Re-audit: re-read the design spec sections and verify the fixes are correct
6. Repeat until clean

### Final State

When done, report:
- Number of tasks completed
- Number of new files created
- Number of files modified
- Test results (pass count on both backends)
- Any design spec requirements that were intentionally deferred and why
