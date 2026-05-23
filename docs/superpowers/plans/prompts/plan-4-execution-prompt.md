# Execution Prompt: Plan 4 -- Agent Detail Tab-View Frontend

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

Implement Plan 4: Agent Detail Tab-View Frontend for the AIMEAT Agent Integration Architecture. This overhauls the agent detail view from a flat card layout to a structured Shared Agent Board + expandable card with Two-Zone Header + 8-tab interface.

## Prerequisites

**Plans 1 and 3 must be completed first.** This plan depends on the webhook, telemetry, onboarding, and readiness scoring APIs.

## Files You Must Read Before Starting

Read these files carefully before writing any code. They define exactly what to build:

1. **Implementation plan (your task list):** `docs/superpowers/plans/2026-05-23-plan-4-agent-tabview-ui.md`
2. **UI design spec (the source of truth):** `docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md` -- the complete tab-view spec
3. **Backend design spec (API reference):** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- for understanding the APIs your UI consumes
4. **CLAUDE.md** -- mandatory rules for this project (file headers, i18n sync, frontend styling rules)
5. **Frontend development guide:** `docs/frontend-development-guide.md` -- Preact + HTM patterns, CSS rules, component library

## What You Are Building

- Agent state detector (`state-detector.js`): determines new/onboarding/production/problem from agent + onboarding data
- API service layer (`agent-integration.js`): wraps onboarding, webhook, telemetry, skill-bundle, delivery log, commands endpoints
- CSS file (`agents-detail.css`): all new styles with `pf-agd-*` prefix
- Shared Agent Board component: fleet-wide overview grid with mini-cards per agent, shared tag summary
- Agent card component: collapsed/expanded states, Two-Zone Header (identity zone + state-dependent status zone), 8-tab bar
- 8 tab components:
  - **Integration**: onboarding checklist (during onboarding) OR production status with connection/platform/readiness/identity/delivery-log sections
  - **Tasks**: existing task list/detail rehoused into the new structure
  - **Messages**: command palette with "/" autocomplete, chat area, slash command discovery
  - **Data Access**: shared tags, memory areas, knowledge packages
  - **Directives**: simplified behavioral instructions (rules editor only)
  - **Agent Config**: config file list with preview and two-way sync
  - **Activity**: event log with governance filter
  - **Services**: declared services list
- Refactored `agents-tab.js` orchestrator using sub-components
- i18n keys (en + fi) for all new UI text
- Playwright tests for tab-view layout, state detection, tab switching

## How To Execute

1. **Follow the plan task by task, step by step.** The plan has 14 tasks. Do them in order.
2. **After each task that involves .ts files, run `pnpm typecheck`** to catch type errors early.
3. **Commit at the end of each task** (not after every step). One commit per task.
4. **Do NOT deviate from the design spec.** The tab order, state detection logic, Two-Zone Header variants, and tab content are exactly as specified.
5. **Test in the browser.** Start the dev server (`pnpm dev`) and verify the UI renders correctly after implementing each tab. Type checking and test suites verify code correctness, not feature correctness.

## Critical Patterns To Follow (from existing codebase)

- **Frontend stack:** Preact + HTM (no JSX, no build step). Use `import { h } from 'preact'; import htm from 'htm'; const html = htm.bind(h);`
- **No inline styles:** All CSS in external `.css` files with prefix-scoped class names. Never `style=""` attributes for layout/colors/spacing.
- **CSS variables only:** Use `var(--card)`, `var(--border)`, `var(--text)`, `var(--success)`, `var(--warning)`, `var(--danger)`, `var(--info)`, etc. from `theme.css`. Never hardcode colors.
- **No `rgba(255,255,255,...)`:** These are dark-theme-only. Use CSS variables.
- **No `class="btn btn-*"`:** The design guide classes (`.btn-primary`, `.btn-outline`, etc.) are self-contained. There is no `.btn` base class.
- **i18n:** All user-visible text via `t()` function from `/js/i18n.js`. No hardcoded strings in any language.
- **API service:** Use `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `/js/api.js`. They return parsed JSON.
- **Importmap:** When adding a new shared JS module with an absolute path (`/js/services/foo.js`), add an identity entry to the importmap in `public/spa.html`.
- **Live updates:** Every tab showing server data must listen for `aimeat-live-update` events to auto-refresh.
- **CSS prefix:** All new classes use `pf-agd-` prefix (profile agent detail).
- **File headers:** Every new `.js` file needs `@file`, `@description`, `@version-history` header comment.
- **Existing components:** Use `Spinner`, `Modal`, `CopyButton`, `Badge`, etc. from the component library. Check `public/components/` and `public/views/profile/shared.js`.

## State Detection Logic

| State | Condition | Default Tab | Zone 2 Color |
|-------|-----------|-------------|--------------|
| **new** | No onboarding record or status = pending | Integration | var(--warning) |
| **onboarding** | Onboarding status = in_progress | Integration | var(--info) |
| **production** | Onboarding completed, no delivery issues | Tasks | var(--success) |
| **problem** | webhookFailCount >= 5 OR no telemetry for 24h | Integration | var(--danger) |

## Tab Bar

8 tabs, always visible. Tab IDs: `integration`, `tasks`, `messages`, `data-access`, `directives`, `agent-config`, `activity`, `services`.

Smart default: state determines which tab opens first when a card is expanded.

## Testing Requirements

After ALL 14 tasks are implemented:

1. **Run typecheck:** `pnpm typecheck` -- must pass with 0 errors (server files)
2. **Run lint:** `pnpm lint` -- must pass
3. **Run Playwright tests:**
   ```
   pnpm test:playwright:mongodb
   ```
   Target: 0 failures. Both new and existing agent tests must pass.
4. **Run E2E API tests** (verify frontend changes don't break APIs):
   ```
   pnpm test:e2e:mongodb
   ```
   Target: 0 failures.
5. **Fix any failures before proceeding to the gap audit.**

## Gap Audit (MANDATORY -- Do This After All Tests Pass)

After implementation is complete and tests pass, perform a thorough gap audit. This is not optional.

### Audit Step 1: Design Spec Coverage

Re-read the UI design spec (`docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md`) section by section. For each requirement, verify it was implemented:

**Page Structure:**
- [ ] Section header with title, description, agent count
- [ ] Shared Agent Board above agent cards (one mini-card per agent with name, state, current activity, tags)
- [ ] Shared tag summary below the board grid
- [ ] Agent cards list below the board

**Collapsed Card:**
- [ ] Single-line with: expand arrow, agent icon, name, platform badge, readiness badge, federation badge, delivery status, last seen
- [ ] Click expands the card

**Expanded Card / Two-Zone Header:**
- [ ] Zone 1 (Identity): agent name, GAII, badges (platform, readiness, federation)
- [ ] Zone 2 (Status): 4 variants based on state:
  - New: call-to-action banner with skill bundle install instructions
  - Onboarding: progress bar with step count
  - Production: delivery method + last activity summary
  - Problem: error description with remediation link
- [ ] State-dependent border/background colors

**Tab Bar:**
- [ ] 8 tabs always visible: Integration, Tasks, Messages, Data Access, Directives, Agent Config, Activity, Services
- [ ] Smart default tab selection based on agent state
- [ ] Active tab highlight
- [ ] Tab content area below tab bar

**Integration Tab:**
- [ ] Onboarding state: 11-step checklist with status icons, progress bar, skill bundle install section
- [ ] Production state: Connection section, Platform & Skill section, Readiness section with step pills, Identity section, Delivery Log table

**Tasks Tab:**
- [ ] Task list with status filters
- [ ] Task detail view

**Messages Tab:**
- [ ] Command palette (fetches from `agents.{name}.commands` memory key)
- [ ] Commands grouped by category with [Send] button
- [ ] Chat input with "/" autocomplete dropdown

**Data Access Tab:**
- [ ] Shared Tags section with add/remove
- [ ] Memory Areas section
- [ ] Knowledge Packages section

**Directives Tab:**
- [ ] Behavioral instructions only (rules editor)
- [ ] Memory areas and config files NOT here (moved to other tabs)

**Agent Config Tab:**
- [ ] Config file list with preview
- [ ] Empty state when no config files synced

**Activity Tab:**
- [ ] Event log with filter buttons (All, Tasks, Messages, Governance, System)
- [ ] Timestamps and event type badges

**Services Tab:**
- [ ] Declared services list with active/inactive status
- [ ] Empty state when no services declared

**General:**
- [ ] All empty states have descriptive messages
- [ ] All text uses `t()` i18n function
- [ ] All CSS uses CSS variables from theme.css
- [ ] No inline styles
- [ ] CSS classes use `pf-agd-` prefix
- [ ] Importmap entries for new shared modules
- [ ] Live update listeners on data-displaying tabs
- [ ] i18n keys in both en.json and fi.json

### Audit Step 2: Code Quality Scan

Check for:
- [ ] No TODO/FIXME/STUB comments in new files
- [ ] No hardcoded color values (use CSS variables)
- [ ] No inline `style=""` attributes
- [ ] No `btn btn-*` class patterns (use self-contained button classes)
- [ ] No `rgba(255,255,255,...)` in CSS
- [ ] All new files have proper file headers
- [ ] All user-visible text uses `t()` function

### Audit Step 3: Fix Everything Found

If the audit found ANY gaps:
1. List all gaps found
2. Fix each one
3. Run `pnpm test:playwright:mongodb` again
4. Re-audit: re-read the design spec and verify the fixes
5. Repeat until clean

### Final State

When done, report:
- Number of tasks completed
- Number of new files created
- Number of files modified
- Playwright test results
- E2E API test results
- Any design spec requirements that were intentionally deferred and why
