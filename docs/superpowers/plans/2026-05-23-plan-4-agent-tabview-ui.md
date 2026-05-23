# Plan 4: Agent Detail Tab-View Frontend -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the agent detail view from the current flat card layout to a structured Shared Agent Board + expandable card with Two-Zone Header + 8-tab interface. Implement state detection logic, smart default tab selection, and all tab content.

**Architecture:** The current `agents-tab.js` (690 lines) is refactored into multiple focused files: a main tab orchestrator, sub-tab components for each of the 8 tabs, an API service for the new backend endpoints, and a dedicated CSS file. The Shared Agent Board is a new component above agent cards. Each agent card gets a Two-Zone Header (identity + state-dependent status) and a tab bar with 8 tabs. State detection (new/onboarding/production/problem) drives the status zone appearance and default tab selection.

**Tech Stack:** Preact + HTM (no JSX, no build step), CSS variables from `theme.css`, `t()` i18n, existing `/js/api.js` service layer

**Master plan:** `docs/superpowers/plans/2026-05-23-agent-integration-master-plan.md`
**Spec:** `docs/superpowers/specs/2026-05-23-agent-detail-tabview-design.md`
**Depends on:** Plan 1 (webhook + telemetry APIs), Plan 3 (onboarding API)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `aimeat/public/views/profile/agents/shared-board.js` | Shared Agent Board component (fleet-wide overview grid above cards) |
| `aimeat/public/views/profile/agents/agent-card.js` | Agent card: collapsed/expanded states, Two-Zone Header, tab bar |
| `aimeat/public/views/profile/agents/state-detector.js` | Agent state detection logic (new/onboarding/production/problem) |
| `aimeat/public/views/profile/agents/tab-integration.js` | Integration tab (onboarding checklist, production status, identity) |
| `aimeat/public/views/profile/agents/tab-tasks.js` | Tasks tab (existing task list/detail, rehoused into new structure) |
| `aimeat/public/views/profile/agents/tab-messages.js` | Messages tab (command palette, "/" autocomplete, chat) |
| `aimeat/public/views/profile/agents/tab-data-access.js` | Data Access tab (tags, memory areas, knowledge packages) |
| `aimeat/public/views/profile/agents/tab-directives.js` | Directives tab (simplified: behavioral instructions only) |
| `aimeat/public/views/profile/agents/tab-agent-config.js` | Agent Config tab (config file list, preview, two-way sync) |
| `aimeat/public/views/profile/agents/tab-activity.js` | Activity tab (governance filter, event log) |
| `aimeat/public/views/profile/agents/tab-services.js` | Services tab (declared services list) |
| `aimeat/public/js/services/agent-integration.js` | API service for onboarding, webhook, telemetry, skill-bundle endpoints |
| `aimeat/public/css/views/agents-detail.css` | Agent detail view styles (`pf-agd-*` prefix) |
| `test/playwright/profile-agents-detail.spec.ts` | Playwright tests for the new tab-view layout |

### Modified Files

| File | What changes |
|------|-------------|
| `aimeat/public/views/profile/agents-tab.js` | Refactored to orchestrate sub-components instead of rendering everything inline |
| `aimeat/public/spa.html` | Add importmap entries for new modules |
| `aimeat/public/locales/en.json` | Tab labels, state messages, empty states, all new UI text |
| `aimeat/public/locales/fi.json` | Same in Finnish |

---

## Task 1: Agent State Detector

**Files:**
- Create: `aimeat/public/views/profile/agents/state-detector.js`

Pure logic module with no UI. Determines agent state from onboarding record, webhook status, and readiness data.

- [ ] **Step 1: Create the state detector**

Create `aimeat/public/views/profile/agents/state-detector.js`:

```javascript
/**
 * @file state-detector.js
 * @description Determines agent state from onboarding record and agent data.
 *   States: 'new' | 'onboarding' | 'production' | 'problem'
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Detail Tab-View
 */

export function detectAgentState(agent, onboarding) {
  if (!onboarding || onboarding.status === 'pending') return 'new';
  if (onboarding.status === 'in_progress') return 'onboarding';

  const webhookDown = (agent.webhookFailCount ?? 0) >= 5;
  const noTelemetry = !agent.lastSeen || isStale(agent.lastSeen, 24 * 60);
  if (webhookDown || noTelemetry) return 'problem';

  return 'production';
}

export function getDefaultTab(state) {
  switch (state) {
    case 'new': return 'integration';
    case 'onboarding': return 'integration';
    case 'problem': return 'integration';
    case 'production': return 'tasks';
    default: return 'tasks';
  }
}

export function getStateColor(state) {
  switch (state) {
    case 'new': return 'var(--warning)';
    case 'onboarding': return 'var(--info)';
    case 'problem': return 'var(--danger)';
    case 'production': return 'var(--success)';
    default: return 'var(--text-muted)';
  }
}

function isStale(isoDate, thresholdMinutes) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return diff > thresholdMinutes * 60 * 1000;
}
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/state-detector.js
git commit -m "feat(agents-ui): add agent state detection logic"
```

---

## Task 2: API Service Layer

**Files:**
- Create: `aimeat/public/js/services/agent-integration.js`
- Modify: `aimeat/public/spa.html`

API service wrapping the new backend endpoints from Plans 1 and 3.

- [ ] **Step 1: Create the API service**

Create `aimeat/public/js/services/agent-integration.js`:

```javascript
/**
 * @file agent-integration.js
 * @description API service for agent integration endpoints: onboarding, webhook,
 *   telemetry, skill bundle, and delivery log.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Detail Tab-View
 */

import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

export async function getOnboarding(agentName) {
  return apiGet(`/v1/agents/${agentName}/onboarding`);
}

export async function startOnboarding(agentName) {
  return apiPost(`/v1/agents/${agentName}/onboarding/start`);
}

export async function cancelOnboarding(agentName) {
  return apiDelete(`/v1/agents/${agentName}/onboarding`);
}

export async function getWebhookConfig(agentName) {
  return apiGet(`/v1/agents/${agentName}/webhook`);
}

export async function updateWebhook(agentName, config) {
  return apiPut(`/v1/agents/${agentName}/webhook`, config);
}

export async function deleteWebhook(agentName) {
  return apiDelete(`/v1/agents/${agentName}/webhook`);
}

export async function testWebhook(agentName) {
  return apiPost(`/v1/agents/${agentName}/webhook/test`);
}

export async function getTelemetry(agentName, opts = {}) {
  const params = new URLSearchParams();
  if (opts.since) params.set('since', opts.since);
  if (opts.type) params.set('type', opts.type);
  if (opts.limit) params.set('per_page', String(opts.limit));
  const qs = params.toString();
  return apiGet(`/v1/agents/${agentName}/telemetry${qs ? `?${qs}` : ''}`);
}

export async function getSkillBundleVersion(agentName, runtime) {
  const qs = runtime ? `?runtime=${runtime}` : '';
  return apiGet(`/v1/agents/${agentName}/skill-bundle/version${qs}`);
}

export function getSkillBundleUrl(agentName, runtime) {
  const qs = runtime ? `?runtime=${runtime}` : '';
  return `/v1/agents/${agentName}/skill-bundle${qs}`;
}

export async function getDeliveryLog(agentName, limit = 20) {
  return apiGet(`/v1/agents/${agentName}/webhook/deliveries?limit=${limit}`);
}

export async function getAgentCommands(agentName) {
  return apiGet(`/v1/memory/agents.${agentName}.commands`);
}
```

- [ ] **Step 2: Add importmap entry in spa.html**

In `aimeat/public/spa.html`, add to the importmap:

```json
"/js/services/agent-integration.js": "/js/services/agent-integration.js"
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/js/services/agent-integration.js aimeat/public/spa.html
git commit -m "feat(agents-ui): add API service for integration endpoints"
```

---

## Task 3: CSS File

**Files:**
- Create: `aimeat/public/css/views/agents-detail.css`

All new styles for the agent detail view. Uses `pf-agd-` prefix (profile agent detail) per the frontend guide.

- [ ] **Step 1: Create the CSS file**

Create `aimeat/public/css/views/agents-detail.css` with styles for:

- `.pf-agd-board` -- Shared Agent Board container
- `.pf-agd-board-grid` -- Agent mini-card grid (3 columns)
- `.pf-agd-board-card` -- Mini-card in the board
- `.pf-agd-board-tags` -- Shared tag summary
- `.pf-agd-card` -- Agent card container
- `.pf-agd-collapsed` -- Collapsed card row
- `.pf-agd-expanded` -- Expanded card container
- `.pf-agd-zone1` -- Identity zone header
- `.pf-agd-zone2` -- Status zone (state-dependent)
- `.pf-agd-zone2--new`, `.pf-agd-zone2--onboarding`, `.pf-agd-zone2--production`, `.pf-agd-zone2--problem` -- State-specific backgrounds and borders
- `.pf-agd-badge` -- Generic badge (platform, readiness, federation)
- `.pf-agd-badge--platform`, `.pf-agd-badge--readiness`, `.pf-agd-badge--federation` -- Badge variants
- `.pf-agd-tabs` -- Tab bar container
- `.pf-agd-tab` -- Individual tab button
- `.pf-agd-tab--active` -- Active tab highlight
- `.pf-agd-tab-content` -- Tab content area
- `.pf-agd-progress` -- Progress bar for onboarding
- `.pf-agd-checklist` -- Onboarding step list
- `.pf-agd-step` -- Individual step row
- `.pf-agd-step--passed`, `.pf-agd-step--pending`, `.pf-agd-step--failed` -- Step status colors
- `.pf-agd-connection` -- Connection status section
- `.pf-agd-delivery-log` -- Delivery log table
- `.pf-agd-commands` -- Command palette container
- `.pf-agd-command-row` -- Individual command entry
- `.pf-agd-empty` -- Empty state message

Use CSS variables from `theme.css` exclusively: `var(--card)`, `var(--border)`, `var(--text)`, `var(--text-muted)`, `var(--success)`, `var(--warning)`, `var(--danger)`, `var(--info)`, `var(--bg-dim)`, `var(--surface)`, etc.

- [ ] **Step 2: Link CSS in spa.html**

In `aimeat/public/spa.html`, add the CSS link in the head section (after `profile.css`):

```html
<link rel="stylesheet" href="/css/views/agents-detail.css">
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/public/css/views/agents-detail.css aimeat/public/spa.html
git commit -m "feat(agents-ui): add agent detail CSS with pf-agd prefix"
```

---

## Task 4: Shared Agent Board Component

**Files:**
- Create: `aimeat/public/views/profile/agents/shared-board.js`

Fleet-wide overview grid above agent cards. One mini-card per agent showing name, state, current activity, and tags.

- [ ] **Step 1: Create the shared board component**

Create `aimeat/public/views/profile/agents/shared-board.js`:

```javascript
/**
 * @file shared-board.js
 * @description Shared Agent Board component. Shows fleet-wide overview grid
 *   above agent cards with mini-cards per agent and shared tag summary.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { detectAgentState, getStateColor } from './state-detector.js';

const html = htm.bind(h);

export default function SharedBoard({ agents, onboardings, onAgentClick }) {
  if (!agents || agents.length === 0) return null;

  const agentStates = useMemo(() => {
    return agents.map(agent => ({
      agent,
      state: detectAgentState(agent, onboardings?.[agent.name]),
      onboarding: onboardings?.[agent.name],
    }));
  }, [agents, onboardings]);

  const allTags = useMemo(() => {
    const tagCounts = {};
    for (const { agent } of agentStates) {
      for (const tag of agent.tags ?? []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    return tagCounts;
  }, [agentStates]);

  return html`
    <div class="pf-agd-board">
      <div class="pf-agd-board-grid">
        ${agentStates.map(({ agent, state, onboarding }) => html`
          <div
            class="pf-agd-board-card"
            style="border-left-color: ${getStateColor(state)}"
            onClick=${() => onAgentClick?.(agent.name)}
          >
            <div class="pf-agd-board-card-name">${agent.name}</div>
            <div class="pf-agd-board-card-activity">
              ${renderActivitySummary(state, agent, onboarding)}
            </div>
            <div class="pf-agd-board-card-tags">
              ${(agent.tags ?? []).length > 0
                ? (agent.tags ?? []).join(', ')
                : '--'}
            </div>
          </div>
        `)}
      </div>
      ${Object.keys(allTags).length > 0 && html`
        <div class="pf-agd-board-tags">
          ${t('agents.detail.sharedTags')}: ${Object.entries(allTags).map(([tag, count]) =>
            html`<span class="pf-agd-tag-pill">[${tag}] (${count})</span> `
          )}
        </div>
      `}
    </div>
  `;
}

function renderActivitySummary(state, agent, onboarding) {
  switch (state) {
    case 'new':
      return t('agents.detail.state.newSummary');
    case 'onboarding': {
      const passed = onboarding?.steps?.filter(s => s.status === 'passed').length ?? 0;
      const total = onboarding?.steps?.length ?? 11;
      return `${t('agents.detail.state.onboarding')}: ${passed}/${total}`;
    }
    case 'problem':
      return t('agents.detail.state.problemSummary');
    case 'production':
    default:
      return agent.lastSeen
        ? `${t('agents.detail.lastSeen')}: ${formatTimeAgo(agent.lastSeen)}`
        : t('agents.detail.state.idle');
  }
}

function formatTimeAgo(isoDate) {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/shared-board.js
git commit -m "feat(agents-ui): add Shared Agent Board component"
```

---

## Task 5: Agent Card Component (Collapsed + Expanded + Tab Bar)

**Files:**
- Create: `aimeat/public/views/profile/agents/agent-card.js`

The card component handles collapsed/expanded states, the Two-Zone Header, and the tab bar. Tab content is delegated to sub-tab components.

- [ ] **Step 1: Create the agent card component**

Create `aimeat/public/views/profile/agents/agent-card.js`:

This component should:
- Accept props: `{ agent, onboarding, expanded, onToggle, session, showToast }`
- **Collapsed state:** Render single-line summary with name, platform badge, readiness badge, federation badge, delivery + last seen stats. Use `pf-agd-collapsed` class.
- **Expanded state:** Render Two-Zone Header (Zone 1: identity, Zone 2: state-dependent) + tab bar + tab content area. Use `pf-agd-expanded` class.
- **Zone 2 rendering:** Use `detectAgentState()` to determine which zone 2 variant to show (new/onboarding/production/problem). Each variant has its own background color and content.
- **Tab bar:** 8 tabs always visible. Track `activeTab` state. Initialize to `getDefaultTab(state)` on first expand.
- **Tab content:** Render the active tab's component (lazy import or conditional rendering).

The tab IDs are: `integration`, `tasks`, `messages`, `data-access`, `directives`, `agent-config`, `activity`, `services`.

Tab labels use i18n keys: `t('agents.detail.tabs.integration')`, etc.

```javascript
const TABS = [
  { id: 'integration', key: 'agents.detail.tabs.integration' },
  { id: 'tasks', key: 'agents.detail.tabs.tasks' },
  { id: 'messages', key: 'agents.detail.tabs.messages' },
  { id: 'data-access', key: 'agents.detail.tabs.dataAccess' },
  { id: 'directives', key: 'agents.detail.tabs.directives' },
  { id: 'agent-config', key: 'agents.detail.tabs.agentConfig' },
  { id: 'activity', key: 'agents.detail.tabs.activity' },
  { id: 'services', key: 'agents.detail.tabs.services' },
];
```

Each tab component receives: `{ agent, onboarding, session, showToast }`.

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/agent-card.js
git commit -m "feat(agents-ui): add agent card with Two-Zone Header and 8-tab bar"
```

---

## Task 6: Integration Tab

**Files:**
- Create: `aimeat/public/views/profile/agents/tab-integration.js`

The most complex tab. Shows onboarding checklist (during onboarding) or production status (after completion).

- [ ] **Step 1: Create the integration tab**

Create `aimeat/public/views/profile/agents/tab-integration.js`:

This component should:
- Accept props: `{ agent, onboarding, session, showToast }`
- **Onboarding state** (`onboarding.status === 'in_progress'` or new):
  - Render the 11-step checklist with status icons, timestamps, validation details
  - Progress bar showing completion percentage
  - Skill bundle install section with copy/download buttons
  - [Re-run Hello Integration] / [Start Hello Integration] button
- **Production state** (onboarding completed):
  - CONNECTION section: delivery method, webhook URL/status, polling status, last seen
  - PLATFORM & SKILL: platform name/version, skill bundle version with update status
  - READINESS: step pills, strengths/gaps summary, [Re-run] button
  - IDENTITY: GAII, public key (truncated), created date
  - DELIVERY LOG: recent deliveries table

Use the API service from `agent-integration.js` for data fetching and actions.

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-integration.js
git commit -m "feat(agents-ui): add Integration tab (onboarding checklist + production status)"
```

---

## Task 7: Tasks Tab

**Files:**
- Create: `aimeat/public/views/profile/agents/tab-tasks.js`

Rehouses the existing task list/detail functionality from `agents-tab.js` into the new tab structure. No structural changes to task UI.

- [ ] **Step 1: Create the tasks tab**

Extract the task list/detail rendering from the current `agents-tab.js` (or create a thin wrapper that imports existing task components if they exist as separate modules). The tab receives `{ agent, session, showToast }` and renders the task list with status filters and task detail view.

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-tasks.js
git commit -m "feat(agents-ui): add Tasks tab (rehoused from agents-tab)"
```

---

## Task 8: Messages Tab with Command Palette

**Files:**
- Create: `aimeat/public/views/profile/agents/tab-messages.js`

Enhanced Messages tab with slash command discovery, command palette, and "/" autocomplete.

- [ ] **Step 1: Create the messages tab**

Create `aimeat/public/views/profile/agents/tab-messages.js`:

This component should:
- **Command palette** at the top:
  - Fetch commands from `agents.{name}.commands` memory key via `getAgentCommands()`
  - Render collapsible panel grouped by category
  - Each command row has name, description, and [Send] button
  - Send button dispatches the command as a regular inbound message
  - Fallback text when no commands registered
- **Chat area:**
  - Existing message list display
  - Messages with "/" prefix get a distinct styling
- **Chat input:**
  - Text input with "Type / for commands..." placeholder
  - "/" autocomplete dropdown (filters registered commands as user types)
  - Send button
  - Hint text below input

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-messages.js
git commit -m "feat(agents-ui): add Messages tab with command palette and autocomplete"
```

---

## Task 9: Data Access Tab

**Files:**
- Create: `aimeat/public/views/profile/agents/tab-data-access.js`

Three sections: Shared Tags, Memory Areas, Knowledge Packages. Consolidates data access controls previously in Directives.

- [ ] **Step 1: Create the data access tab**

Create `aimeat/public/views/profile/agents/tab-data-access.js`:

- **Section 1: Shared Tags** -- tag list with add/remove, agent counts per tag, shared memory prefix info
- **Section 2: Memory Areas** -- list of allowed memory area prefixes (moved from Directives)
- **Section 3: Knowledge Packages** -- linked knowledge packages (moved from Directives)
- **Empty state:** "No data access configured. Add memory areas or tags using the controls above."

- [ ] **Step 2: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-data-access.js
git commit -m "feat(agents-ui): add Data Access tab (tags, memory areas, knowledge)"
```

---

## Task 10: Remaining Tabs (Directives, Agent Config, Activity, Services)

**Files:**
- Create: `aimeat/public/views/profile/agents/tab-directives.js`
- Create: `aimeat/public/views/profile/agents/tab-agent-config.js`
- Create: `aimeat/public/views/profile/agents/tab-activity.js`
- Create: `aimeat/public/views/profile/agents/tab-services.js`

- [ ] **Step 1: Create simplified Directives tab**

`tab-directives.js`: Behavioral instructions only (rules editor). Memory areas and config files are no longer here (moved to Data Access and Agent Config tabs). Shows the owner's instructions to the agent with an edit button.

- [ ] **Step 2: Create Agent Config tab**

`tab-agent-config.js`: Config file list with preview and two-way sync. Shows platform-specific config files (soul.md, AGENTS.md, hooks.yaml) pushed by the agent. File list on the left, preview on the right. Empty state when no config files synced.

- [ ] **Step 3: Create enhanced Activity tab**

`tab-activity.js`: Event log with governance filter. Filter buttons: All, Tasks, Messages, Governance, System. Governance events (owner approvals, scope changes) shown with distinct styling. Timestamp, event type badge, and description per entry.

- [ ] **Step 4: Create Services tab**

`tab-services.js`: Declared services list (unchanged from current). Shows services the agent has declared with active/inactive status. Empty state when no services declared.

- [ ] **Step 5: Commit**

```bash
git add aimeat/public/views/profile/agents/tab-directives.js aimeat/public/views/profile/agents/tab-agent-config.js aimeat/public/views/profile/agents/tab-activity.js aimeat/public/views/profile/agents/tab-services.js
git commit -m "feat(agents-ui): add Directives, Agent Config, Activity, and Services tabs"
```

---

## Task 11: Refactor agents-tab.js Orchestrator

**Files:**
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/spa.html`

Refactor the main agents-tab to use the new sub-components. Keep the section header, connect agent flow, and device auth approval flow. Replace inline agent card rendering with the new `AgentCard` component and add the `SharedBoard` component.

- [ ] **Step 1: Update imports and mount sub-components**

Refactor `agents-tab.js` to:
- Import `SharedBoard` from `./agents/shared-board.js`
- Import `AgentCard` from `./agents/agent-card.js`
- Fetch onboarding data for all agents (batch `getOnboarding()` calls)
- Render: Section header -> SharedBoard -> AgentCard list
- Keep existing: connect agent prompt, device auth polling, scope management
- Remove: inline agent detail rendering (replaced by AgentCard)

- [ ] **Step 2: Update importmap in spa.html**

Add entries for new sub-modules if they use absolute imports. For relative imports from `agents-tab.js`, no importmap changes needed.

- [ ] **Step 3: Run typecheck (if applicable)**

Run: `pnpm typecheck`
Expected: PASS (frontend files are not type-checked, but server must still compile)

- [ ] **Step 4: Commit**

```bash
git add aimeat/public/views/profile/agents-tab.js aimeat/public/spa.html
git commit -m "refactor(agents-ui): orchestrate sub-components from agents-tab.js"
```

---

## Task 12: i18n Keys

**Files:**
- Modify: `aimeat/public/locales/en.json` (or `aimeat/locales/en.json` if frontend uses backend locales)
- Modify: `aimeat/public/locales/fi.json` (or `aimeat/locales/fi.json`)

- [ ] **Step 1: Add English translations**

Add keys under `agents.detail`:

```json
"agents": {
  "detail": {
    "tabs": {
      "integration": "Integration",
      "tasks": "Tasks",
      "messages": "Messages",
      "dataAccess": "Data Access",
      "directives": "Directives",
      "agentConfig": "Agent Config",
      "activity": "Activity",
      "services": "Services"
    },
    "state": {
      "new": "New",
      "onboarding": "Onboarding",
      "production": "Production",
      "problem": "Problem",
      "newSummary": "Awaiting skill bundle install",
      "problemSummary": "Delivery issue detected",
      "idle": "Idle"
    },
    "sharedTags": "Shared tags",
    "lastSeen": "Last seen",
    "deliveryMcp": "MCP notifications",
    "deliveryWebhook": "Webhook",
    "deliveryPolling": "Polling",
    "connection": "Connection",
    "platform": "Platform",
    "skillBundle": "Skill Bundle",
    "readiness": "Readiness",
    "identity": "Identity",
    "deliveryLog": "Delivery Log",
    "showAll": "Show all",
    "commands": {
      "title": "Agent Commands",
      "available": "available",
      "noCommands": "No commands registered",
      "send": "Send"
    },
    "empty": {
      "tasks": "No tasks yet. Create a task to give this agent work.",
      "messages": "No messages yet. Send a message or use a command.",
      "dataAccess": "No data access configured. Add memory areas or tags using the controls above.",
      "agentConfig": "No configuration files. The agent will push its config files after the skill bundle is installed.",
      "activity": "No activity recorded yet. Events will appear here once the agent starts working.",
      "services": "No services declared. The agent can declare services during Hello Integration Step 11."
    }
  }
}
```

- [ ] **Step 2: Add Finnish translations**

Add matching keys under `agents.detail`:

```json
"agents": {
  "detail": {
    "tabs": {
      "integration": "Integraatio",
      "tasks": "Tehtävät",
      "messages": "Viestit",
      "dataAccess": "Datayhteydet",
      "directives": "Ohjeistukset",
      "agentConfig": "Agenttiasetukset",
      "activity": "Toiminta",
      "services": "Palvelut"
    },
    "state": {
      "new": "Uusi",
      "onboarding": "Perehdytys",
      "production": "Tuotanto",
      "problem": "Ongelma",
      "newSummary": "Odottaa taitopaketin asennusta",
      "problemSummary": "Toimitushäiriö havaittu",
      "idle": "Toimeton"
    },
    "sharedTags": "Jaetut tunnisteet",
    "lastSeen": "Viimeksi nähty",
    "deliveryMcp": "MCP-ilmoitukset",
    "deliveryWebhook": "Webhook",
    "deliveryPolling": "Pollaus",
    "connection": "Yhteys",
    "platform": "Alusta",
    "skillBundle": "Taitopaketti",
    "readiness": "Valmius",
    "identity": "Identiteetti",
    "deliveryLog": "Toimitushistoria",
    "showAll": "Näytä kaikki",
    "commands": {
      "title": "Agentin komennot",
      "available": "saatavilla",
      "noCommands": "Ei rekisteröityjä komentoja",
      "send": "Lähetä"
    },
    "empty": {
      "tasks": "Ei tehtäviä. Luo tehtävä antaaksesi agentille työtä.",
      "messages": "Ei viestejä. Lähetä viesti tai käytä komentoa.",
      "dataAccess": "Ei datayhteyksien asetuksia. Lisää muistialueita tai tunnisteita yllä olevista painikkeista.",
      "agentConfig": "Ei asetustiedostoja. Agentti lähettää asetustiedostot taitopaketin asennuksen jälkeen.",
      "activity": "Ei tallennettua toimintaa. Tapahtumat ilmestyvät tähän kun agentti aloittaa työskentelyn.",
      "services": "Ei ilmoitettuja palveluja. Agentti voi ilmoittaa palvelut Hello-integraation vaiheessa 11."
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(agents-ui): add i18n keys for agent detail tab-view (en + fi)"
```

---

## Task 13: Playwright Tests

**Files:**
- Create: `test/playwright/profile-agents-detail.spec.ts`

Test the new tab-view layout, state detection, tab switching, and key interactions.

- [ ] **Step 1: Create the Playwright test file**

Create `test/playwright/profile-agents-detail.spec.ts`:

Test cases to implement:

1. **Shared Board renders** -- agent mini-cards appear in the board grid
2. **Collapsed card shows badges** -- platform and readiness badges visible
3. **Card expansion shows tabs** -- clicking card reveals 8-tab bar
4. **Tab switching works** -- clicking each tab changes the content area
5. **Smart default tab** -- new agent opens to Integration tab, production agent to Tasks tab
6. **Integration tab shows onboarding checklist** -- 11 steps rendered with correct statuses
7. **Integration tab shows production status** -- connection, platform, readiness sections
8. **Messages tab shows command palette** -- if commands are registered
9. **Empty states render correctly** -- tabs with no data show the correct empty message
10. **State detection** -- problem state shows red border, onboarding shows progress bar

Follow the existing Playwright test pattern from `profile-agents.spec.ts`: `loadHarness()`, `registerUser()`, `createAgent()`, then assert DOM state.

- [ ] **Step 2: Run Playwright tests**

Run: `pnpm test:playwright:mongodb -- profile-agents-detail`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/playwright/profile-agents-detail.spec.ts
git commit -m "test(agents-ui): add Playwright tests for agent detail tab-view"
```

---

## Task 14: Run Full Test Suite

**Files:** None (validation only)

- [ ] **Step 1: Run Playwright tests (full suite)**

Run: `pnpm test:playwright:mongodb`
Expected: PASS (0 failures, including existing agent tests)

- [ ] **Step 2: Run E2E API tests**

Run: `pnpm test:e2e:mongodb`
Expected: PASS (frontend changes should not break API tests)

- [ ] **Step 3: Fix any failures**

If tests fail, fix them before marking Plan 4 complete.

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(agents-ui): address test failures from tab-view refactor"
```
