# E2E Test Plan: Security Tab

**Tab key:** `security`
**Component:** `SecurityTab`
**Props:** `{ session, showToast }`

## Overview

CORS origin management for GHII and individual agents, plus session revocation. Edit CORS origins via textarea, save/reset, and revoke all active JWT sessions.

## Preconditions

- User is authenticated
- Tab is switched to "Security"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Security tab

**Expected:**
- Data loads (agent list + security config)
- Content renders

---

### TC-02: GHII CORS section renders

**Steps:**
1. Wait for data to load

**Expected:**
- GHII CORS section with title
- Current effective origins displayed (or "All" if wildcard, or "-" if empty)
- Badge: "Inherited" or "Custom"
- "Edit" button visible

---

### TC-03: Edit GHII CORS

**Steps:**
1. Click "Edit" button on GHII CORS section
2. Enter origins in textarea (one per line):
   ```
   https://example.com
   https://app.example.com
   ```
3. Click "Save"

**Expected:**
- Textarea appears pre-filled with current origins (or empty)
- Save, Reset, Close (×) buttons visible
- On save:
  - Toast: "Saved"
  - Origins display updates
  - Badge changes to "Custom"

---

### TC-04: Reset GHII CORS

**Steps:**
1. Open GHII CORS edit
2. Click "Reset"

**Expected:**
- API call with empty origins
- Origins cleared (falls back to inherited/node default)
- Badge changes to "Inherited"

---

### TC-05: Close CORS edit without saving

**Steps:**
1. Open GHII CORS edit
2. Click Close (×)

**Expected:**
- Edit form closes
- No API call
- Origins unchanged

---

### TC-06: Agents CORS table

**Steps:**
1. View agents table

**Expected:**
- Table (`.consent-table`) with columns: Agent, Origins, Status, Actions
- Each agent row shows: name (monospace), origins, status badge

---

### TC-07: No agents state

**Steps:**
1. Account has no agents

**Expected:**
- Empty message in agents section

---

### TC-08: Edit agent CORS

**Steps:**
1. Click "Edit" on an agent row
2. Enter origin: "https://agent-app.example.com"
3. Click "Save"

**Expected:**
- Textarea appears in the row
- On save:
  - Toast: "Saved"
  - Status badge changes to "Custom" (`.badge-success`)

---

### TC-09: Reset agent CORS

**Steps:**
1. Open agent CORS edit
2. Click "Reset"

**Expected:**
- Agent CORS cleared
- Status reverts to "Inherited" with source indicator

---

### TC-10: Inheritance explanation

**Steps:**
1. View inheritance section

**Expected:**
- Card explaining CORS inheritance chain:
  - Memory key → Agent → GHII → Node default

---

### TC-11: Revoke all sessions

**Steps:**
1. Click "Revoke All Sessions" button (`.sec-revoke-btn`)
2. Accept confirmation dialog

**Expected:**
- Confirm dialog with warning message
- Button disabled, shows "Revoking..."
- On success:
  - Toast: "All sessions revoked (N)" with count
  - `aimeat_session` cleared from localStorage
  - Page reloads after ~1.5 seconds (redirects to login)

---

### TC-12: Revoke sessions — cancel

**Steps:**
1. Click "Revoke All Sessions"
2. Cancel the confirmation dialog

**Expected:**
- No API call
- Session intact
- No page reload

---

### TC-13: Revoke sessions — error

**Steps:**
1. Trigger revoke when API fails

**Expected:**
- Error toast with message
- Button re-enables
- Session NOT cleared (user stays logged in)
