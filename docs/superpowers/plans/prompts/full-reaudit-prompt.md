# Full Re-Audit Prompt: Plans 1-5 Agent Integration Architecture

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

You are performing a FULL RE-AUDIT of the Agent Integration Architecture implementation (Plans 1-5). Previous audits reported everything as "PASS" but the UI is visibly broken -- translation keys show as raw key paths, features may be missing or half-implemented. **Trust nothing. Verify everything by reading actual code.**

## CRITICAL CONTEXT: Known Root Cause

The frontend JS files use `t('agents.detail.xxx')` but the locale files store keys under `profile.agents.detail.xxx`. This namespace mismatch causes ALL `agents.detail.*` translations to show as raw key paths in the UI. There are ~100 broken translation references across all Plan 4/5 frontend files. This was reported as "PASS" in previous audits -- which means previous audits were unreliable. Treat every previous "PASS" as unverified.

## Files You Must Read

1. **Design spec:** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md`
2. **Tab-view design spec:** `docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md`
3. **Plans 1-5:**
   - `docs/superpowers/plans/2026-05-23-plan-1-push-layer.md`
   - `docs/superpowers/plans/2026-05-23-plan-2-skill-bundle.md`
   - `docs/superpowers/plans/2026-05-23-plan-3-hello-integration.md`
   - `docs/superpowers/plans/2026-05-23-plan-4-agent-tabview-ui.md`
   - `docs/superpowers/plans/2026-05-23-plan-5-governance.md`
4. **CLAUDE.md** -- mandatory project rules
5. **Frontend guide:** `docs/frontend-development-guide.md`

## How To Audit

**Do NOT skim. Do NOT trust previous reports. Read the actual source files and verify each item.**

For each check, read the actual code, grep for the actual strings, and report what you find. If something is broken, report the exact file, line number, and what's wrong.

---

## PART A: i18n Audit (HIGHEST PRIORITY -- This Is Visibly Broken)

### A1. Namespace Mismatch Scan

The frontend uses `t('key.path')` to look up translations. The `t()` function resolves keys against the locale JSON structure. Find EVERY mismatch between what code passes to `t()` and what exists in the locale files.

**Steps:**

1. Extract ALL unique `t('...')` key paths from these frontend files:
   - `public/views/profile/agents/agent-card.js`
   - `public/views/profile/agents/shared-board.js`
   - `public/views/profile/agents/state-detector.js`
   - `public/views/profile/agents/tab-integration.js`
   - `public/views/profile/agents/tab-tasks.js`
   - `public/views/profile/agents/tab-messages.js`
   - `public/views/profile/agents/tab-data-access.js`
   - `public/views/profile/agents/tab-directives.js`
   - `public/views/profile/agents/tab-agent-config.js`
   - `public/views/profile/agents/tab-activity.js`
   - `public/views/profile/agents/tab-services.js`
   - `public/views/profile/agents-tab.js`
   - `public/views/profile/agents-tasks-subtab.js`
   - `public/views/profile/agents-directives-subtab.js`
   - `public/views/profile/agents-services-subtab.js`
   - `public/views/admin/agent-integration-tab.js`

2. For EACH key path found, verify it resolves to a value in `locales/en.json`. The key `agents.detail.tabs.integration` means the JSON must have `{ "agents": { "detail": { "tabs": { "integration": "..." } } } }` -- but the JSON likely has it under `{ "profile": { "agents": { "detail": { ... } } } }`.

3. Check how `t()` resolves keys. Read `public/js/i18n.js` to understand the key resolution. Does it add a prefix? Does it flatten? What namespace does it expect?

4. Report EVERY broken key with: file, line number, key used in code, where the key actually lives in en.json (if it exists at all), and what needs to change (fix the code or fix the JSON).

5. After fixing en.json, verify fi.json has the same structure.

### A2. Hardcoded Strings Scan

Search ALL Plan 4/5 frontend files for user-visible English text not wrapped in `t()`:
- Hardcoded strings in HTML template literals
- Error message fallbacks like `'Failed to ...'`
- Default values like `'General'`, `'Unnamed'`, `'Free'`
- Section titles, button labels, status text

### A3. Missing Translation Keys

For each tab component, verify ALL user-visible text has a corresponding key in both en.json and fi.json:
- Tab names (8 tabs)
- State labels (new, onboarding, production, problem)
- Zone 2 messages (all 4 state variants)
- Empty state messages (for each tab)
- Button labels (Start, Rerun, Send, Copy, Download, etc.)
- Section headers in each tab
- Filter labels in Activity tab
- Error messages in all tabs
- Governance section labels
- Admin tab section headers and column labels
- Step titles and descriptions (11 onboarding steps)
- Readiness level labels
- Platform name labels

---

## PART B: Plan 1 -- Push Layer Foundation

### B1. Webhook Infrastructure
- [ ] 6 webhook fields on AgentRecord in interface.ts (webhookUrl, webhookSecret, webhookEnabled, webhookLastSuccess, webhookLastFailure, webhookFailCount)
- [ ] All 6 fields synced to SQLite schema.ts + sqlite/index.ts
- [ ] All 6 fields synced to MongoDB prisma/schema.prisma + mongodb/index.ts
- [ ] Webhook CRUD routes: PUT, GET, DELETE + POST test (agent-webhook.ts)
- [ ] HMAC-SHA256 signing in webhook dispatcher
- [ ] 3x retry with backoff (5s, 30s, 120s) in dispatcher
- [ ] Auto-disable after 10 consecutive failures
- [ ] SSRF validation on webhook URLs
- [ ] Delivery log: last 50 per agent, GET endpoint

### B2. Telemetry
- [ ] POST /v1/agents/:name/telemetry (append)
- [ ] GET /v1/agents/:name/telemetry (list with ?since=, ?type=, ?per_page=)
- [ ] TelemetryEvent storage type in both backends

### B3. Inbox Cursor
- [ ] ?since= parameter on inbox route with cursor format `{ISO}@{event_id_prefix}`
- [ ] cursor_status field: "exact" or "approximate"
- [ ] has_more with page limit

### B4. Webhook Schemas
- [ ] 7 event types: task.queued, task.approved, task.updated, task.paused, message.inbound, directive.updated, onboarding.step
- [ ] Zod schemas for all 7 in webhook-schemas.ts
- [ ] Webhook payload envelope: version, event, timestamp, node_id, agent_gaii, data

### B5. MCP Notifications
- [ ] emitResourceUpdated() calls in task and message routes
- [ ] Parallel with webhook dispatch, not fallback

### B6. Tests & Docs
- [ ] E2E tests for webhook CRUD (e2e-agent-webhook.ts)
- [ ] E2E tests for telemetry (e2e-agent-telemetry.ts)
- [ ] E2E tests for inbox cursor (e2e-inbox-cursor.ts)
- [ ] OpenAPI entries for all new endpoints
- [ ] i18n keys in en.json AND fi.json

---

## PART C: Plan 2 -- Skill Bundle Generator

### C1. Core Generator
- [ ] BundleFile, BundleMetadata, BundleContent, BundleContext types (types.ts)
- [ ] RuntimeAdapter interface with { runtime, bundleName, generate() }
- [ ] 6 reference documents generated (api-overview, task-lifecycle, message-protocol, telemetry-protocol, capability-report, error-protocol)
- [ ] SHA-256 content hash versioning (first 12 hex chars, deterministic)

### C2. Adapters
- [ ] Hermes adapter: SKILL.md + 3 scripts + 2 configs
- [ ] Generic adapter: SKILL.md + references only
- [ ] ?runtime=hermes selects Hermes, default is generic
- [ ] Unknown runtime falls back to generic

### C3. REST Endpoints
- [ ] GET /v1/agents/:name/skill-bundle (ZIP download)
- [ ] GET /v1/agents/:name/skill-bundle/version (JSON)
- [ ] X-Bundle-Version, X-Bundle-Runtime, Content-Disposition headers
- [ ] Auth: both owner and agent, scoped to own agents
- [ ] 403 for cross-agent/cross-owner access

### C4. Tests & Docs
- [ ] E2E tests including 403 cases
- [ ] OpenAPI entries for both endpoints
- [ ] i18n keys in en.json AND fi.json

---

## PART D: Plan 3 -- Hello Integration Backend

### D1. Storage
- [ ] AgentOnboardingRecord type with ALL fields (verify each one in interface.ts)
- [ ] AgentOnboardingStep type with ALL fields
- [ ] Repository interface in repositories/
- [ ] Prisma model, SQLite CREATE TABLE, both CRUD implementations

### D2. Services
- [ ] 11 step IDs as constants, step 11 optional
- [ ] Zod schemas for 4 step payloads
- [ ] Platform detector: UA matching (5 platforms), MCP fallback, message content fallback
- [ ] Onboarding validator: each step validated against REAL system state (not just trusted)
- [ ] Readiness scorer: baseline (9pts/required + 10 optional), health (0.4/0.3/0.3 weights), floor(baseline * health)
- [ ] Readiness override support (check expiresAt)

### D3. Routes
- [ ] GET /v1/agents/:name/onboarding (auto-check observable steps on every request)
- [ ] POST /v1/agents/:name/onboarding/start (owner only, creates test task, auto-passes step 1)
- [ ] POST /v1/agents/:name/onboarding/step/:id (validates, auto-completes if all required pass)
- [ ] DELETE /v1/agents/:name/onboarding (owner only)
- [ ] POST /v1/agents/connect (connectivity key flow with auto-start)
- [ ] Auto-start on device auth approval
- [ ] emitChange('agent-onboarding') after mutations

### D4. Tests & Docs
- [ ] E2E tests: full 11-step flow reaching completed status
- [ ] E2E tests: readiness score verification
- [ ] E2E tests: auto-check on GET
- [ ] OpenAPI entries with 401/403 responses
- [ ] i18n: step titles, descriptions, readiness labels, platform labels, error messages -- ALL in en.json AND fi.json

---

## PART E: Plan 4 -- Agent Detail Tab-View Frontend

### E1. Core Infrastructure
- [ ] State detector (state-detector.js): 4 states with correct logic, default tabs, colors
- [ ] API service (agent-integration.js): wraps ALL endpoints including confirmOnboardingStep()
- [ ] CSS file (agents-detail.css): pf-agd-* prefix, CSS variables only, no hardcoded hex, no rgba(255,255,255)
- [ ] Importmap entries in spa.html for all new shared modules

### E2. Page Structure
- [ ] Section header with title, description, agent count
- [ ] Shared Agent Board: grid of mini-cards (name, state, activity, tags) + tag summary
- [ ] Agent cards list below board

### E3. Collapsed Card
- [ ] Expand arrow, agent icon, name, platform badge, readiness badge, federation badge, delivery status, last seen
- [ ] Click expands

### E4. Expanded Card / Two-Zone Header
- [ ] Zone 1: agent name, GAII, badges
- [ ] Zone 2: 4 state variants (new CTA, onboarding progress, production summary, problem alert)
- [ ] State-dependent border/background colors

### E5. Tab Bar
- [ ] 8 tabs always visible with correct IDs
- [ ] Smart default tab based on state
- [ ] Active tab highlight

### E6. Integration Tab
- [ ] Onboarding state: 11-step checklist with status icons, progress bar, skill bundle section
- [ ] Production state: Connection, Platform, Readiness, Identity, Delivery Log sections
- [ ] Delivery Log: 5 columns (timestamp, event, channel, result, latency) + Show all toggle

### E7. Tasks Tab
- [ ] Task list with status groups
- [ ] Task detail view

### E8. Messages Tab
- [ ] Command palette with category grouping + Send button
- [ ] Chat input with "/" autocomplete
- [ ] Message history

### E9. Data Access Tab
- [ ] Shared Tags with add/remove
- [ ] Memory Areas section
- [ ] Knowledge Packages section

### E10. Directives Tab
- [ ] Rules editor only (no memory areas or config files here)

### E11. Agent Config Tab
- [ ] Config file list with preview
- [ ] Empty state

### E12. Activity Tab
- [ ] Filter buttons: All, Tasks, Messages, Governance, System
- [ ] Event log with timestamps and type badges
- [ ] TODAY'S GOVERNANCE section (token budget, tasks today, policy issues, delivery health)

### E13. Services Tab
- [ ] Service list with active/inactive
- [ ] Empty state

### E14. Code Quality
- [ ] No inline style="" for layout/colors/spacing (dynamic width for progress bars is OK)
- [ ] No "btn btn-*" pattern
- [ ] All text uses t() -- NO hardcoded strings
- [ ] ALL t() keys actually resolve in en.json and fi.json (THIS IS THE MAIN KNOWN BUG)
- [ ] Live update listeners on all data-displaying tabs
- [ ] All files have @file headers

### E15. Playwright Tests
- [ ] Tests exist for: board rendering, tab bar, tab switching, state detection, collapse/expand, empty states

---

## PART F: Plan 5 -- Governance + Admin Dashboard

### F1. Budget Controls
- [ ] BudgetLimits on AgentDirectivesRecord (4 fields)
- [ ] Zod schema
- [ ] Stored in both backends
- [ ] GET/PUT directives include budget limits

### F2. Task Governance
- [ ] POST /v1/agents/:name/tasks/:id/pause (owner only, active tasks only, fires webhook)
- [ ] Owner-only task start enforcement
- [ ] paused status in enum

### F3. Readiness Gate
- [ ] requireReadiness(minLevel) middleware
- [ ] Owner bypass
- [ ] Applied to task PATCH, events, complete (standard level)
- [ ] 403 with READINESS_INSUFFICIENT

### F4. Stall Detection
- [ ] unreachable: no activity 2h + no webhook
- [ ] webhook_down: failCount >= 10

### F5. Admin Endpoints
- [ ] GET /v1/admin/platforms
- [ ] GET /v1/admin/agents/onboarding
- [ ] GET /v1/admin/agents/readiness
- [ ] GET /v1/admin/skill-bundles
- [ ] POST /v1/admin/skill-bundles/regenerate
- [ ] All require operator role

### F6. Admin Dashboard UI
- [ ] Tab registered in admin.js
- [ ] Platform Registry table (with detect pattern column)
- [ ] Onboarding Overview (completed/in-progress/stuck + stuck agent list)
- [ ] Skill Bundle Management (per-platform + regenerate button)
- [ ] CSS: adm-agi-* prefix, no inline styles, CSS variables
- [ ] All text uses t() with keys that actually resolve

### F7. Tests & Docs
- [ ] OpenAPI entries for task pause + 5 admin endpoints
- [ ] i18n keys in both en.json and fi.json
- [ ] No TODO/FIXME/STUB markers

---

## How To Report

For each section, report:

**PASS** -- verified working, cite the file and line
**FAIL** -- broken or missing, cite what's wrong and where to fix it
**PARTIAL** -- partially implemented, cite what works and what doesn't

At the end, produce a **FIX LIST** sorted by priority:

1. **CRITICAL** -- visibly broken in UI (i18n key mismatches, runtime errors, missing features)
2. **HIGH** -- functionally broken but not immediately visible (wrong validation, missing auto-complete, etc.)
3. **MEDIUM** -- code quality violations (inline styles, hardcoded strings, missing tests)
4. **LOW** -- minor deviations from spec (extra fields, slightly different status codes, etc.)

For each fix, provide: file path, line number(s), what's wrong, what it should be.

## Test Credentials

- Owner: `buildertest` / `Test1234` (has agent `test-agent`)
- Admin: `happyadmin` (operator role)
- Admin password (.env): `***REMOVED***`
- Dev server: `pnpm dev` on port 40050
