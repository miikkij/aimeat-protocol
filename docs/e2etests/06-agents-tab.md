# E2E Test Plan: Agents Tab

## Overview

The Agents Tab (`public/views/profile/agents-tab.js`) provides management of AI agents registered under the user's AIMEAT identity. It displays agent details, allows copying agent identifiers, provides scope management with template-based and advanced modes, and includes platform-specific installation instructions for setting up automation agents.

## APIs Under Test

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/agents` | List all agents (filtered client-side by owner) |
| PUT | `/v1/agents/:name/scopes` | Update agent scope permissions |

## Key Implementation Details

- Agent list is filtered client-side by `session.owner` after fetching all agents from `GET /v1/agents`.
- Scope templates: `readonly` = `[memory:read, catalogue:read, social:read]`, `standard` adds `memory:write, work:request, work:read`, `full` = `[*]`.
- Template detection: if scopes include `*`, template is `full`; if scopes match a named template exactly, that template is shown; otherwise `custom`.
- `catalogue:read` is always locked on (cannot be unchecked in advanced mode).
- When all individual scopes are checked, `buildScopesArray()` collapses them to `['*']`.
- When no scopes are checked, it falls back to `['catalogue:read']`.
- Scope management is only available to users with `owner` or `operator` roles; others see a lock icon.
- The agent prompt builder generates a multi-step prompt with the user's GHII, owner name, and node URL for onboarding new agents.
- Platform instructions are hardcoded HTML for Windows, Mac, Linux, WSL2, Android, and AWS.

## Table of Contents

- [TC-A001: List Agents Shows At Least 1](#tc-a001-list-agents-shows-at-least-1)
- [TC-A002: Expand Agent Shows All Detail Fields](#tc-a002-expand-agent-shows-all-detail-fields)
- [TC-A003: Copy GAII Copies Correct Value](#tc-a003-copy-gaii-copies-correct-value)
- [TC-A004: Copy Public Key](#tc-a004-copy-public-key)
- [TC-A005: Update Scopes with Readonly Template](#tc-a005-update-scopes-with-readonly-template)
- [TC-A006: Update Scopes with Standard Template](#tc-a006-update-scopes-with-standard-template)
- [TC-A007: Update Scopes with Full Template](#tc-a007-update-scopes-with-full-template)
- [TC-A008: Update Scopes for Non-Existent Agent](#tc-a008-update-scopes-for-non-existent-agent)
- [TC-A009: Unauthenticated Access](#tc-a009-unauthenticated-access)
- [TC-A010: Agent with No Description](#tc-a010-agent-with-no-description)
- [TC-A011: Agent with No Roles](#tc-a011-agent-with-no-roles)
- [TC-A012: Multiple Agents Displayed](#tc-a012-multiple-agents-displayed)

---

## Success Cases

### TC-A001: List Agents Shows At Least 1
- **Precondition:** User is authenticated and has registered at least one agent.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Wait for the loading spinner to finish.
  3. Observe the agent list.
- **Expected:** At least one agent card is displayed showing: display name (or name fallback), name badge, trust score, balance, and last seen time. The `onStats` callback is invoked with `{ agents: N }` where N is the agent count. No "empty" message is shown.
- **Type:** success

### TC-A002: Expand Agent Shows All Detail Fields
- **Precondition:** User has at least one agent with description, roles, trust_score, balance, last_seen, created_at, public_key, and capabilities populated.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Click on an agent card header to expand it.
  3. Observe all detail rows.
- **Expected:** Expanded view displays the following rows:
  - **GAII**: Full GAII in monospace font with "Copy GAII" button.
  - **Description**: Agent description text.
  - **Roles**: Role badges (e.g., `agent`).
  - **Trust**: Trust score numeric value.
  - **Balance**: Balance numeric value.
  - **Last Seen**: Relative time (e.g., "2 hours ago") plus formatted date.
  - **Created**: Formatted date string.
  - **Public Key**: Truncated key (first 10 + "..." + last 10 chars) with "Copy" button.
  - **Capabilities**: Capability tags displayed in a flex container.

  The expand icon rotates 90 degrees. Clicking again collapses the view.
- **Type:** success

### TC-A003: Copy GAII Copies Correct Value
- **Precondition:** User has an agent with a GAII value.
- **Steps:**
  1. Expand an agent card.
  2. Click "Copy GAII" button.
  3. Wait for the button text to change.
- **Expected:** `navigator.clipboard.writeText()` is called with the agent's full GAII string. The button text changes to a checkmark plus "Copied" for 2 seconds, then reverts. The click event does not propagate to toggle the expansion (via `e.stopPropagation()`).
- **Type:** success

### TC-A004: Copy Public Key
- **Precondition:** User has an agent with a `public_key` field.
- **Steps:**
  1. Expand an agent card that has a public key.
  2. Click the "Copy" button next to the truncated public key.
- **Expected:** The full (untruncated) public key is copied to clipboard. Button text changes to a checkmark plus "Copied" for 2 seconds. Event propagation is stopped.
- **Type:** success

### TC-A005: Update Scopes with Readonly Template
- **Precondition:** User has owner or operator role. An agent exists.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Click "Manage" on the scope summary row of an agent card.
  3. In the scopes modal, click the "Read Only" template button.
  4. Verify the template button highlights as active.
  5. Click "Save".
- **Expected:** PUT `/v1/agents/:name/scopes` is called with `{ scopes: ["memory:read", "catalogue:read", "social:read"] }`. Toast shows success message. Modal closes. Agent list reloads and the scope summary badge shows "Read Only" with scope count 3.
- **Type:** success

### TC-A006: Update Scopes with Standard Template
- **Precondition:** User has owner or operator role. An agent exists.
- **Steps:**
  1. Open the scopes modal for an agent.
  2. Click the "Standard" template button.
  3. Click "Save".
- **Expected:** PUT `/v1/agents/:name/scopes` is called with `{ scopes: ["memory:read", "memory:write", "catalogue:read", "social:read", "work:request", "work:read"] }`. Scope summary updates to "Standard" with count 6.
- **Type:** success

### TC-A007: Update Scopes with Full Template
- **Precondition:** User has owner or operator role. An agent exists.
- **Steps:**
  1. Open the scopes modal for an agent.
  2. Click the "Full Access" template button.
  3. Optionally expand "Advanced" to verify all checkboxes are checked.
  4. Click "Save".
- **Expected:** PUT `/v1/agents/:name/scopes` is called with `{ scopes: ["*"] }` (collapsed from all individual scopes). Scope summary shows "Full Access" with infinity symbol for count.
- **Type:** success

---

## Failure Cases

### TC-A008: Update Scopes for Non-Existent Agent
- **Precondition:** User has owner role.
- **Steps:**
  1. Programmatically call `updateAgentScopes('nonexistent-agent', ['memory:read'])`.
- **Expected:** PUT `/v1/agents/nonexistent-agent/scopes` returns 404. The `handleSaveScopes` function detects `resp.ok === false` or catches the error, and shows an error toast with the server's error message.
- **Type:** failure

### TC-A009: Unauthenticated Access
- **Precondition:** No valid session/token.
- **Steps:**
  1. Call `GET /v1/agents` without an Authorization header.
- **Expected:** Server returns 401 Unauthorized. The agents tab would not be reachable without a session, but the API endpoint itself rejects unauthenticated requests.
- **Type:** failure

---

## Edge Cases

### TC-A010: Agent with No Description
- **Precondition:** User has an agent where `description` is `null` or `undefined`.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Expand the agent card.
- **Expected:** The "Description" row is not rendered at all (conditional rendering: `a.description ? html\`...\` : ''`). All other detail rows display normally. No rendering error.
- **Type:** edge

### TC-A011: Agent with No Roles
- **Precondition:** User has an agent where `roles` is `null`, `undefined`, or an empty array.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Expand the agent card.
- **Expected:** The "Roles" row shows a default "agent" badge (fallback when `a.roles && a.roles.length > 0` is false). No crash.
- **Type:** edge

### TC-A012: Multiple Agents Displayed
- **Precondition:** User has 3 or more registered agents.
- **Steps:**
  1. Navigate to the Agents tab.
  2. Wait for loading.
  3. Expand one agent, then expand another.
- **Expected:** All agents are listed as separate cards. Only one agent can be expanded at a time (expanding a second one collapses the first, since `expandedAgent` is a single value). Each agent has its own scope summary and action buttons. The scope modal can be opened independently for each agent.
- **Type:** edge
