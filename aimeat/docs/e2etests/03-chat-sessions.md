# E2E Test Plan: Chat Sessions Tab

**Tab key:** `chat-sessions`
**Component:** `ChatSessionsTab`
**Props:** `{ session, showToast, onStats }`

## Overview

Lists chat session agents (filtered by `session-` prefix), provides prompt copy buttons to create new sessions, and allows expanding/deleting sessions.

## Preconditions

- User is authenticated
- Tab is switched to "Chat Sessions"

## Test Cases

### TC-01: Loading state

**Steps:**
1. Switch to Chat Sessions tab

**Expected:**
- Spinner visible while loading
- Spinner disappears when data arrives

---

### TC-02: Create session section renders

**Steps:**
1. Wait for tab to load

**Expected:**
- "Create a Chat Session" card visible
- "Copy Quick Prompt" button (`.btn-sm.btn-copy`) visible
- "Copy Detailed Prompt" button (`.btn-sm.btn-copy`) visible
- Description text explaining what chat sessions are

---

### TC-03: Copy quick prompt

**Steps:**
1. Click "Copy Quick Prompt" button

**Expected:**
- Button shows "..." briefly while fetching template from `/v1/templates/chat-session-quick`
- Toast appears: "Prompt copied to clipboard"
- Clipboard contains the quick session creation prompt

**Failure indicators:**
- Button stays as "..." indefinitely (API timeout)
- Error toast instead of success
- Empty clipboard

---

### TC-04: Copy detailed prompt

**Steps:**
1. Click "Copy Detailed Prompt" button

**Expected:**
- Button shows "..." while fetching from `/v1/templates/chat-session-human`
- Toast: "Prompt copied to clipboard"
- Clipboard contains the detailed prompt (longer than quick)

---

### TC-05: Empty state — no sessions

**Steps:**
1. Use account with no `session-*` agents
2. Switch to Chat Sessions tab

**Expected:**
- `.empty` div visible with "No chat sessions" text
- Create section still visible above empty state

---

### TC-06: Session cards render

**Steps:**
1. Use account with at least one `session-*` agent
2. Switch to Chat Sessions tab

**Expected:**
- One or more session cards visible
- Each card shows:
  - Expand icon (▶)
  - Session name
  - Badge with info (e.g., role)
- Cards are collapsed by default

---

### TC-07: Expand session card

**Steps:**
1. Click a session card header (`.card-clickable`)

**Expected:**
- Card gets `.card-expanded` class
- Expand icon changes from ▶ to ▼
- Detail section (`.card-detail`) appears with:
  - GAII (monospace)
  - Description (if exists)
  - Trust score
  - Balance (morsels)
  - Roles
  - Created date
- Action buttons appear: "Copy GAII", "Remove"

---

### TC-08: Copy session GAII

**Steps:**
1. Expand a session card
2. Click "Copy GAII" button (`.btn-sm.btn-copy`)

**Expected:**
- Toast: "GAII copied"
- Clipboard contains the session's full GAII
- Card does NOT collapse (stopPropagation)

---

### TC-09: Remove session — confirm

**Steps:**
1. Expand a session card
2. Click "Remove" button (`.btn-sm.btn-danger`)
3. Accept the confirmation dialog

**Expected:**
- Browser confirm dialog appears with delete confirmation text
- Button shows "..." while deleting
- On success:
  - Card disappears from list
  - Toast confirms deletion
  - Session list reloads (count decreases)

---

### TC-10: Remove session — cancel

**Steps:**
1. Expand a session card
2. Click "Remove" button
3. Dismiss/cancel the confirmation dialog

**Expected:**
- No API call made
- Card remains in list unchanged
- No toast
