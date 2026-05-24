# UI Design Compliance Audit: Agent Detail Tab-View

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

You are performing a UI DESIGN COMPLIANCE AUDIT. During the brainstorming/design phase, specific decisions were made about how the Agent Detail Tab-View should look and behave. Those decisions are documented in two design specs. Your job is to verify that the actual implementation matches what was designed.

**This is NOT a code quality audit.** Don't check for lint errors, missing headers, or test coverage. This audit answers one question: **Does the built UI match the agreed design?**

## How To Audit

For each design decision, read the actual frontend code and verify it matches. If it doesn't match, report exactly what was designed vs what was built.

**Do NOT trust comments or variable names.** Read the actual rendered HTML structure and behavior logic.

## Design Specs (Read These First)

1. `docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md` -- the frontend design spec
2. `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- the backend architecture spec (Part 4 covers UI, Part 6 covers admin)

## Frontend Files To Check

Profile agent views:
- `public/views/profile/agents-tab.js`
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
- `public/views/profile/agents-tasks-subtab.js`
- `public/views/profile/agents-directives-subtab.js`
- `public/views/profile/agents-services-subtab.js`

Admin view:
- `public/views/admin/agent-integration-tab.js`

Shared/service:
- `public/js/services/agent-integration.js`
- `public/css/views/agents-detail.css`
- `public/spa.html` (importmap entries)

i18n:
- `locales/en.json`
- `locales/fi.json`

i18n resolution:
- `public/js/i18n.js` (the `t()` function flattens JSON at load time and does direct key lookup -- `t('profile.agents.detail.tabs.integration')` requires that exact path in the JSON)

---

## PART 1: Page Structure (Design Spec Part 1)

The design specifies three layers top to bottom:

### 1.1 Section Header
- [ ] Title "My Agents" with agent count badge visible
- [ ] "+ Connect Agent" button that opens connectivity key flow

**Verify:** Read `agents-tab.js` and check what renders at the top of the agents section.

### 1.2 Shared Agent Board
The design specifies a dedicated panel ABOVE all agent cards with fleet-wide overview.

- [ ] Board is a distinct component above the agent cards list
- [ ] Shows a responsive grid of mini-cards (one per agent)
- [ ] Each mini-card shows: agent name (bold, colored by state), current activity summary (one line), tags (comma-separated), left border color matching state
- [ ] State colors: green = active, yellow = onboarding, red = problem, gray = idle
- [ ] Shared tag summary below the grid showing tags with agent counts (e.g., "[grocery] (2 agents)")
- [ ] Board is always visible (not collapsible), disappears only when zero agents
- [ ] Clicking an agent name in the board scrolls to and expands that agent's card
- [ ] Board updates via SSE live updates (`aimeat-live-update` event listener)

**Verify:** Read `shared-board.js` and check the rendered HTML structure matches the spec.

### 1.3 Agent Cards
- [ ] One card per registered agent below the Shared Agent Board
- [ ] Cards have two states: collapsed and expanded

---

## PART 2: Collapsed Agent Card (Design Spec Part 2)

The collapsed card is a single-line summary with specific elements left to right:

### 2.1 Layout Elements (left to right)
- [ ] Expand arrow (`>`)
- [ ] Agent icon or avatar
- [ ] Agent name
- [ ] Platform badge (shown if identified)
- [ ] Readiness badge (score shown if scored, `--` if not)
- [ ] Federation badge (`FEDERATED`, only if federated)
- [ ] Right-aligned: delivery status + last seen + today's stats

### 2.2 State-Dependent Collapsed Content
The right-aligned content changes per state:

- [ ] **New:** Readiness shows `--`, right side shows `Last seen: just now | Next: Install skill bundle`
- [ ] **Onboarding:** Readiness shows `Onboarding: 6/11` (yellow), right side shows `Last seen: 5 min | Next: Configure Delivery`
- [ ] **Production:** Readiness shows score like `Full (87)` (green), right side shows `Delivery: MCP+WH | Last seen: 16s | Today: 2 done, 1 active`
- [ ] **Problem:** Readiness shows score with degradation (orange), right side shows webhook failure info

### 2.3 Problem State Border
- [ ] Problem state collapsed card has a red-tinted border (`border-color` change)

### 2.4 Interactions
- [ ] Clicking anywhere on the collapsed card expands it
- [ ] Expanded card replaces collapsed card in place (no modal, no navigation)

**Verify:** Read `agent-card.js` -- find the collapsed card rendering and check each element.

---

## PART 3: Expanded Card -- Two-Zone Header (Design Spec Part 3)

### 3.1 Zone 1: Identity Zone
Always the same regardless of state. The stable anchor.

- [ ] Collapse arrow (down arrow, clicking collapses the card)
- [ ] Agent name (bold)
- [ ] GAII displayed (e.g., `hermes-spider#jouni@node-id`)
- [ ] Platform badge with version if known
- [ ] Readiness badge (color-coded: green full/expert, blue standard, yellow onboarding, orange degraded, gray no score)
- [ ] Federation badge (green-tinted, only if federated)
- [ ] Last seen timestamp (right-aligned, gray)

### 3.2 Zone 2: Status Zone -- 4 State Variants

**State: New Agent**
- [ ] Yellow left border, warm background
- [ ] Title: "ONBOARDING NOT STARTED" (or equivalent translated text)
- [ ] Description about installing skill bundle
- [ ] Call-to-action button: "Go to Integration tab" that navigates to Integration tab

**State: Onboarding In Progress**
- [ ] Blue left border, cool background
- [ ] Title showing progress: "HELLO INTEGRATION: X / 11" with "Next: [step name]"
- [ ] Visual progress bar with percentage
- [ ] Step pills showing pass/pending state with abbreviated step names

**State: Production (healthy)**
- [ ] Minimal -- single line of stats, no colored border
- [ ] Shows: Delivery method, Tasks today, Tokens today, Tags inline

**State: Problem**
- [ ] Red left border, dark red background
- [ ] Title: "DELIVERY ISSUE" (or equivalent)
- [ ] Description of the specific problem (webhook failures, etc.)
- [ ] Action buttons contextual to the problem: Test webhook, Update URL, Override readiness

### 3.3 State Detection Logic (Design Spec Part 3)
The UI determines agent state from these conditions checked in ORDER:

| Priority | Condition | State |
|----------|-----------|-------|
| 1 | `onboarding.status === 'pending'` or no onboarding record | New |
| 2 | `onboarding.status === 'in_progress'` | Onboarding |
| 3 | `webhookFailCount >= 5` or readiness level dropped | Problem |
| 4 | Everything else | Production |

- [ ] `state-detector.js` implements this exact priority order
- [ ] Problem state is checked AFTER onboarding completion (agent in onboarding cannot be "problem")

**Verify:** Read `state-detector.js` and compare the logic to the spec table above.

---

## PART 4: Tab Bar and Smart Defaults (Design Spec Part 4)

### 4.1 Tab Order
Eight tabs, always visible regardless of agent state:

```
[ Integration | Tasks | Messages | Data Access | Directives | Agent Config | Activity | Services ]
```

- [ ] Exactly 8 tabs in this exact order
- [ ] All 8 tabs are always visible (none hidden based on state)
- [ ] Tab IDs match the design (integration, tasks, messages, data-access, directives, agent-config, activity, services)

### 4.2 Smart Default Tab Selection
When the owner expands an agent card, the initially selected tab depends on state:

| Agent state | Default tab |
|-------------|-------------|
| New | Integration |
| Onboarding | Integration |
| Production | Tasks |
| Problem | Integration |

- [ ] Default is applied on FIRST expand only
- [ ] If owner switches tabs, their selection is preserved until card is collapsed

### 4.3 Tab Empty States
Tabs with no content show explanatory messages:

- [ ] Tasks: "No tasks yet. Create a task to give this agent work."
- [ ] Messages: "No messages yet. Send a message or use a command."
- [ ] Data Access: "No data access configured. Add memory areas or tags using the controls above."
- [ ] Agent Config: "No configuration files. The agent will push its config files after the skill bundle is installed."
- [ ] Activity: "No activity recorded yet. Events will appear here once the agent starts working."
- [ ] Services: "No services declared. The agent can declare services during Hello Integration Step 11."
- [ ] Integration and Directives always have content (no empty state needed)

**Verify:** Read each tab component file and check for empty state rendering.

---

## PART 5: Integration Tab (Design Spec Part 5)

The Integration tab has two major content states:

### 5.1 Onboarding State Content
- [ ] Checklist header: "HELLO INTEGRATION" with overall readiness score
- [ ] 11-step onboarding checklist, each showing:
  - Step number and name
  - Status icon (checkmark = passed, circle = pending, X = failed)
  - Timestamp when validated
  - Validation details (e.g., "Hermes (auto-detected)", "MCP: 3, Domain: 2")
- [ ] Progress counter: "Progress: X/11"
- [ ] Skill bundle section:
  - Install command (platform-specific)
  - [Copy] and [Download ZIP] buttons
- [ ] [Re-run Hello Integration] button

### 5.2 Production State Content
Five sections top to bottom:

**Connection section:**
- [ ] Delivery method with status indicator (green/red)
- [ ] Webhook URL with last success time and failure count
- [ ] Polling status (fallback interval)
- [ ] Last seen timestamp
- [ ] [Edit webhook] action

**Platform & Skill section:**
- [ ] Platform name, version, detection method
- [ ] Skill bundle version with update status
- [ ] [Re-install] [Update] actions

**Readiness summary section:**
- [ ] Step pills showing pass/warn/fail per step (compact horizontal row)
- [ ] Strengths and gaps text summary
- [ ] Last validated timestamp
- [ ] [Re-run Hello Integration] action

**Identity details section (IMPORTANT: moved from old header):**
- [ ] GAII (full `agent#owner@node` format)
- [ ] Public key (truncated)
- [ ] Created date
- [ ] Roles badge

**Delivery log section:**
- [ ] Last N deliveries with 5 columns: timestamp, event type, delivery channel, result, latency
- [ ] [Show all] toggle/link

**Verify:** Read `tab-integration.js` and check both onboarding and production rendering paths.

---

## PART 6: Tasks Tab (Design Spec Part 6)

- [ ] No structural changes from existing task UI
- [ ] Task list with status filters (active, queued, completed, failed)
- [ ] Task detail view with todos, events, scope, rules
- [ ] This is the production agent's default tab

**Verify:** Read `tab-tasks.js` (or `agents-tasks-subtab.js`).

---

## PART 7: Messages Tab (Design Spec Part 7)

### 7.1 Command Palette
A collapsible panel at the top of the Messages tab:

- [ ] Shows all commands the agent supports (from memory key `agents.{name}.commands`)
- [ ] Commands grouped by category with category headers
- [ ] Each command shows: name (e.g., `/model`), description, [Send] button
- [ ] [Send] button immediately sends the command as a regular inbound message
- [ ] Collapsible with header showing command count
- [ ] Fallback: if no commands registered, shows "No commands registered" message

### 7.2 Chat Input Enhancement
- [ ] "/" autocomplete: when owner types "/" in input, dropdown shows matching commands
- [ ] Hint text below input: "Type / to see available commands"

### 7.3 Chat Area
- [ ] Existing message display
- [ ] Command messages (starting with "/") displayed like normal messages but agent response shown as reply

**Verify:** Read `tab-messages.js`.

---

## PART 8: Data Access Tab (Design Spec Part 8)

Three sections managing data access:

### 8.1 Shared Tags (Section 1)
- [ ] Tags shown at top with [+ Add tag] button
- [ ] Per tag: tag name, memory prefix (`agents.tag.{name}.*`), sharing indicator ("with: {other-agents}" or "only you"), [x] remove button
- [ ] Help text explaining how tags create shared memory areas

### 8.2 Agent Memory Areas (Section 2)
- [ ] Memory area list with [+ Add area] button
- [ ] Per area: key prefix, description, permission level (read+write or read only)

### 8.3 Knowledge Packages (Section 3)
- [ ] Knowledge package list with [+ Link package] button
- [ ] Per package: name, description, document count

### 8.4 Effective Scope Summary
- [ ] Read-only summary at the bottom showing complete data access picture
- [ ] Text mentions it is included in the agent's skill bundle

**Verify:** Read `tab-data-access.js`.

---

## PART 9: Directives Tab -- Simplified (Design Spec Part 9)

Key design decision: Directives was SIMPLIFIED. Memory areas, knowledge packages, and config files were moved OUT to their own tabs.

### 9.1 What Should NOT Be Here
- [ ] NO memory areas (moved to Data Access tab)
- [ ] NO knowledge packages (moved to Data Access tab)
- [ ] NO config files (moved to Agent Config tab)

### 9.2 What Should Be Here
- [ ] Behavioral directives only -- structured text editor for rules, scope boundaries, communication preferences
- [ ] [Edit] button that switches to textarea editor
- [ ] Footer note: "Directives are included in every skill bundle update..."
- [ ] Save triggers `directive.updated` webhook

**Verify:** Read `tab-directives.js` (or `agents-directives-subtab.js`).

---

## PART 10: Agent Config Tab (Design Spec Part 10)

This is a NEW tab. It shows platform-specific configuration files.

### 10.1 File List
- [ ] Lists all config files for the agent
- [ ] Per file: filename, description, platform tag, active indicator

### 10.2 File Preview
- [ ] Selected file content displayed as read-only text
- [ ] Action buttons: [Edit] [Copy] [Download]
- [ ] Edit mode uses plain textarea (NOT a code editor like Monaco/CodeMirror)

### 10.3 Upload
- [ ] [+ Upload config file] button
- [ ] Accepts .md, .yaml, .json files

### 10.4 Empty State
- [ ] "No configuration files. The agent will push its config files after the skill bundle is installed."

**Verify:** Read `tab-agent-config.js`.

---

## PART 11: Activity Tab -- Enhanced (Design Spec Part 12)

### 11.1 Filter Bar
Horizontal filter pills at the top:

- [ ] [All] [Tasks] [Messages] [Governance] [System] -- exactly these 5 filters
- [ ] "All" is the default

### 11.2 Event Display
Each event row shows:

- [ ] Timestamp (HH:MM format)
- [ ] Category badge (color-coded pill: Tasks green, Messages blue, Governance yellow/orange, System gray)
- [ ] Event description (one line)
- [ ] Details (secondary line with context)

### 11.3 Governance Events
New event category:

- [ ] Owner approved task, Owner paused task, Scope change, Permission grant, Policy violation, Readiness change, Override applied
- [ ] Policy violation events should appear red
- [ ] Footer note about audit trail

### 11.4 TODAY'S GOVERNANCE Section
- [ ] Token budget (used / limit with percentage)
- [ ] Tasks today (completed, active, failed counts)
- [ ] Policy issues count
- [ ] Delivery health (MCP status, webhook success rate)

**Verify:** Read `tab-activity.js`.

---

## PART 12: Services Tab (Design Spec Part 13)

### 12.1 Service List
- [ ] Each service shows: status dot (green active, gray inactive), service name, description, status label
- [ ] Footer note about services being declared during Step 11

### 12.2 Empty State
- [ ] "No services declared. The agent can declare services during Hello Integration Step 11."

**Verify:** Read `tab-services.js` (or `agents-services-subtab.js`).

---

## PART 13: Admin Dashboard -- Agent Integration Tab (Architecture Spec Part 6)

### 13.1 Tab Registration
- [ ] Tab appears in admin dashboard navigation
- [ ] Tab label is "Agent Integration" (or equivalent translated text)

### 13.2 Platform Registry Section
- [ ] Table with columns: Platform, Agents count, Adapter, Auto-detect pattern
- [ ] [Add platform] button

### 13.3 Onboarding Overview Section
- [ ] Aggregate status: Completed count, In progress count, Not started count
- [ ] Readiness distribution: Expert, Full, Standard, Basic with agent counts
- [ ] Stuck agents section (no progress >24h) with suggestions

### 13.4 Skill Bundle Management Section
- [ ] Per-platform status: Platform, Agents, Current version, Outdated count
- [ ] [Regenerate all bundles] button

**Verify:** Read `agent-integration-tab.js` (admin view).

---

## PART 14: Design Decisions (Appendix from Design Spec)

These specific decisions were made during brainstorming. Verify each one is reflected in the implementation:

| # | Decision | What to check |
|---|----------|---------------|
| 1 | Two-Zone Header (identity + status) | Zone 1 is stable anchor, Zone 2 changes by state |
| 2 | All 8 tabs always visible | No tab hiding/showing logic based on state |
| 3 | Smart default tab by state | New/Onboarding/Problem -> Integration, Production -> Tasks |
| 4 | Tag-based data sharing (not organisms) | Data Access tab uses simple string tags, not organism system |
| 5 | Data Access as its own tab | Tags + memory + knowledge in one tab, NOT in Directives |
| 6 | Agent Config as its own tab | Config files separated from behavioral directives |
| 7 | Commands in Messages tab | Command palette is IN the Messages tab, not a separate tab |
| 8 | Identity details moved to Integration tab | GAII, public key, created date are in Integration tab, NOT in card header |
| 9 | Shared Agent Board above cards | Board is above card list at page level, not inside cards |

---

## PART 15: CSS and Styling Conventions (Design Spec Part 17)

### 15.1 CSS Prefix
- [ ] All agent detail CSS classes use `pf-agd-` prefix (profile agent detail)
- [ ] Admin agent integration uses `adm-agi-` prefix

### 15.2 i18n Key Namespace
The design spec says: "New key namespace: `profile.agents.detail.*`"

- [ ] All `t()` calls in the profile agent frontend files use keys that START with `profile.agents.detail.*`
- [ ] Those exact keys exist in `locales/en.json` under `{ "profile": { "agents": { "detail": { ... } } } }`
- [ ] The same keys exist in `locales/fi.json`
- [ ] Sub-namespaces match the design: `profile.agents.detail.integration.*`, `profile.agents.detail.data_access.*`, `profile.agents.detail.agent_config.*`, `profile.agents.detail.messages.commands.*`, `profile.agents.detail.activity.governance.*`

**CRITICAL:** The `t()` function (in `public/js/i18n.js`) flattens the JSON and does direct key lookup. So if code calls `t('agents.detail.tabs.integration')` but the key is stored under `profile.agents.detail.tabs.integration`, IT WILL NOT RESOLVE. The full flattened path must match exactly.

### 15.3 SSE Live Updates
Design spec says these tabs MUST listen for `aimeat-live-update`:
- [ ] Integration
- [ ] Tasks
- [ ] Messages
- [ ] Data Access
- [ ] Agent Config
- [ ] Activity
- [ ] Services

Tabs NOT requiring live updates:
- [ ] Directives (owner-initiated only)

**Verify:** Grep for `aimeat-live-update` in each tab component.

---

## How To Report

For each check item, report:

**MATCH** -- implementation matches the design. Cite file and line.
**MISMATCH** -- implementation differs from design. Report:
  - What the design says
  - What the code actually does
  - File, line number(s)
  - Whether this is intentional evolution or a bug

**MISSING** -- feature from the design was not implemented at all. Report what's missing.

**EXTRA** -- feature exists in the code but was NOT in the design. Report what was added and whether it makes sense.

At the end, produce a summary:

1. **Design compliance score:** X/Y checks passing
2. **Critical mismatches** -- things that fundamentally differ from the design
3. **Minor deviations** -- things that differ slightly but work
4. **Missing features** -- designed but not built
5. **Additions** -- built but not designed (may be fine)

## Test Credentials (if you need to visually verify)

- Owner: `buildertest` / `Test1234` (has agent `test-agent`)
- Admin: `happyadmin` (operator role)
- Admin password (.env): `***REMOVED***`
- Dev server: `pnpm dev` on port 40050
