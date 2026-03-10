# E2E Test Plan: Nodes Tab

**Tab key:** `nodes`
**Component:** `NodesTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Register, manage, and detach personal AIMEAT nodes. Expandable cards with tunnel URLs, agent lists, visibility toggles, and setup instructions.

## Preconditions

- User is authenticated
- Tab is switched to "Nodes"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Nodes tab

**Expected:**
- Spinner while `listNodes()` loads
- Disappears when data arrives

---

### TC-02: Empty state

**Steps:**
1. User has no registered nodes

**Expected:**
- Empty state message visible
- "Add Node" button still visible

---

### TC-03: Add node form

**Steps:**
1. Click "Add Node" button (`.btn-primary`)

**Expected:**
- Form (`.create-form`) appears with:
  - Node ID input (text)
  - Visibility radio: private / public
  - Agent GAIIs input (comma-separated)
  - "Register" button
  - "Cancel" button

---

### TC-04: Register node — success

**Steps:**
1. Open add form
2. Enter node ID: "my-node-001"
3. Select visibility: public
4. Enter GAIIs: "agent1#owner@node, agent2#owner@node"
5. Click "Register"

**Expected:**
- Toast: "Node registered"
- Form closes
- New node card appears in list
- `onStats` callback fires

---

### TC-05: Cancel add form

**Steps:**
1. Open add form
2. Click "Cancel"

**Expected:**
- Form closes, no API call

---

### TC-06: Node card renders

**Steps:**
1. Have at least one registered node

**Expected:**
- Node card (`.pn-card`) shows:
  - Status dot (`.pn-status-dot`) — colored by status
  - Node name (`.pn-name`)
  - Visibility badge
  - Status badge
  - Chevron arrow (`.pn-arrow`)
  - Quick stats: agent count, mailbox items

---

### TC-07: Expand node card

**Steps:**
1. Click node card header (`.pn-header`)

**Expected:**
- Arrow rotates (`.open` class)
- Detail section (`.pn-details`) expands showing:
  - Tunnel URL with copy button
  - Agent list
  - Mailbox stats
  - Last seen timestamp
  - Visibility toggle buttons
  - Setup instructions button
  - Detach button

---

### TC-08: Copy tunnel URL

**Steps:**
1. Expand a node card
2. Click copy button next to tunnel URL

**Expected:**
- Clipboard contains the tunnel URL
- Toast: "Copied"

---

### TC-09: Toggle visibility

**Steps:**
1. Expand a node
2. Click the inactive visibility button (e.g., switch from private to public)

**Expected:**
- Active button changes (`.pn-vis-btn.active`)
- API call updates visibility
- Toast: "Visibility updated"

---

### TC-10: Expand setup instructions

**Steps:**
1. Expand a node
2. Click setup instructions button (`.expand-btn`)

**Expected:**
- Setup section (`.pn-setup`) expands with instructions
- Link to docs visible

---

### TC-11: Detach node

**Steps:**
1. Expand a node
2. Click "Detach" button (`.pn-detach-btn`)
3. Accept confirmation dialog

**Expected:**
- Confirm dialog appears
- Toast: "Node detached"
- Node card disappears from list

---

### TC-12: Detach — cancel

**Steps:**
1. Click "Detach"
2. Cancel confirmation

**Expected:**
- No API call
- Node remains
