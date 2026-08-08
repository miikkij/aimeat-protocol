# E2E Test Plan: Agents Tab

**Tab key:** `agents`
**Component:** `AgentsTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Lists registered AI agents with expandable cards showing details, GAII/key copy, and scope management. Also provides agent creation prompts with platform-specific setup instructions.

## Preconditions

- User is authenticated with at least one registered agent
- Tab is switched to "Agents"

## Test Cases

### TC-01: Loading state shows spinner

**Steps:**
1. Switch to Agents tab (intercept API to delay response)

**Expected:**
- `Spinner` component visible while `listAgents()` is in flight
- Spinner disappears when data loads

---

### TC-02: Agent list renders

**Steps:**
1. Switch to Agents tab
2. Wait for spinner to disappear

**Expected:**
- One or more agent cards visible (`.agent-card` or `.card`)
- Each card shows: agent name, truncated GAII, scope summary badge
- Cards are collapsed by default (no `.agent-card-expanded` class)

---

### TC-03: Empty state when no agents

**Steps:**
1. Use account with no registered agents
2. Switch to Agents tab

**Expected:**
- `.empty` div visible with "No agents registered" message
- Agent creation prompt section still visible

---

### TC-04: Copy agent creation prompt

**Steps:**
1. Find the "Copy prompt" button (the shared `<CopyButton>`; find it by its accessible name, not by a class)
2. Click it

**Expected:**
- Clipboard contains the agent registration prompt text
- Button text changes to "Copied" (with checkmark) for ~2 seconds
- Then reverts to original text

**Verification:**
- Read clipboard content and verify it contains agent creation instructions

---

### TC-05: Expand platform instructions

**Steps:**
1. Click platform instructions expand button (`.expand-btn`)

**Expected:**
- Platform tabs appear: windows, mac, linux, wsl2, android, aws
- Windows tab active by default (`.platform-tab.active`)
- Chevron icon rotates 180deg
- Setup instructions content visible

---

### TC-06: Switch platform tabs

**Steps:**
1. Expand platform instructions
2. Click "mac" tab
3. Click "linux" tab

**Expected:**
- Active tab changes (`.active` class moves)
- Content updates to show platform-specific instructions
- Only one tab active at a time

---

### TC-07: Expand agent card

**Steps:**
1. Click on an agent card header (`.agent-card-header-clickable`)

**Expected:**
- Card gets `.agent-card-expanded` class
- Expand icon rotates from ▶ to ▼
- Detail section visible showing:
  - GAII (monospace, with copy button)
  - Description (if exists)
  - Roles (badges)
  - Trust score
  - Balance
  - Last seen (relative time)
  - Created date
  - Public key (truncated to first 10 + last 10 chars)
  - Capabilities (tags)

---

### TC-08: Collapse agent card

**Steps:**
1. Expand an agent card
2. Click the same card header again

**Expected:**
- `.agent-card-expanded` class removed
- Detail section hidden
- Expand icon reverts to ▶

---

### TC-09: Copy agent GAII

**Steps:**
1. Expand an agent card
2. Click the GAII copy button (the shared `<CopyButton>` next to the GAII value; find it by its accessible name)

**Expected:**
- Clipboard contains the full agent GAII string
- Button text shows "Copied" briefly
- Card does NOT collapse (stopPropagation works)

---

### TC-10: Copy agent public key

**Steps:**
1. Expand an agent card
2. Click the public key copy button

**Expected:**
- Clipboard contains the full public key (not truncated)
- Button shows "Copied" briefly

---

### TC-11: Open scopes modal

**Steps:**
1. Expand an agent card
2. Click "Manage Scopes" button (`.scope-manage-btn`)

**Expected:**
- Modal overlay appears (`.modal-overlay`)
- Modal shows agent GAII in monospace
- Template buttons visible: readonly, standard, full
- Current template highlighted (`.active`)
- Card does NOT collapse

---

### TC-12: Apply scope template

**Steps:**
1. Open scopes modal
2. Click "standard" template button

**Expected:**
- Standard template button gets `.active` class
- If advanced view open, checkboxes update to match standard template scopes
- Previous template button loses `.active`

---

### TC-13: Advanced scope editing

**Steps:**
1. Open scopes modal
2. Click "Advanced" toggle (`.scope-advanced-toggle`)
3. Check/uncheck a scope checkbox

**Expected:**
- Advanced section expands showing domain groups (`.scope-domains`)
- Each domain shows its permission checkboxes
- `catalogue:read` checkbox is disabled (locked, shows 🔒)
- Checking/unchecking a box updates the template indicator to "custom"

---

### TC-14: Save scopes

**Steps:**
1. Open scopes modal
2. Change to "readonly" template
3. Click "Save"

**Expected:**
- Button shows "Saving..." while API call in flight
- Modal closes on success
- Agent card scope summary updates to reflect "readonly"
- No error toast

---

### TC-15: Close scopes modal without saving

**Steps:**
1. Open scopes modal
2. Click outside the modal (on `.modal-overlay`)

**Expected:**
- Modal closes
- No API call made
- Agent scopes unchanged

---

### TC-16: Read-only scopes view (non-owner)

**Steps:**
1. Log in as an agent (not owner/operator)
2. Expand agent card
3. Check scope button area

**Expected:**
- Lock icon (🔒) shown instead of "Manage Scopes" button
- If modal opens, it shows read-only list of scope tags
- No Save button, only Cancel
