# E2E Test Cases: Chat Sessions Tab

**Tab file:** `public/views/profile/chat-sessions-tab.js`
**Service file:** `public/js/services/agents.js`
**APIs tested:**
- `GET /v1/agents` — list agents (filtered client-side by `name.startsWith('session-')`)
- `DELETE /v1/agents/:name` — delete a session agent

---

## Success Cases

### TC-1601: List chat sessions filtered by session- prefix
- **Precondition:** Authenticated owner with agents named `session-abc`, `session-xyz`, and `profileagent`
- **Steps:**
  1. Call `GET /v1/agents` with owner filter
  2. Client filters to only agents where `name.startsWith('session-')`
- **Expected:** Returns only `session-abc` and `session-xyz`; `profileagent` is excluded; UI renders session cards for each
- **Type:** success

### TC-1602: Expand session shows details
- **Precondition:** Authenticated owner with at least one chat session agent
- **Steps:**
  1. Load Chat Sessions tab
  2. Click a session card header to expand
- **Expected:** Expanded card shows GAII, description (if present), trust score, morsel balance, roles (if present), and created date (if present)
- **Type:** success

### TC-1603: Delete session agent with confirmation
- **Precondition:** Authenticated owner with a chat session agent named `session-test`
- **Steps:**
  1. Expand the session card
  2. Click "Remove Session" button
  3. Confirm the deletion dialog
  4. Wait for `DELETE /v1/agents/session-test` to complete
- **Expected:** Returns success; session disappears from the list; toast confirms deletion
- **Type:** success

### TC-1604: Copy GAII to clipboard
- **Precondition:** Authenticated owner with a chat session agent; session card expanded
- **Steps:**
  1. Click the "Copy GAII" button
- **Expected:** Agent's GAII string is copied to clipboard; toast confirms "GAII copied"
- **Type:** success

---

## Failure Cases

### TC-1605: Delete non-existent session agent
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `DELETE /v1/agents/session-nonexistent`
- **Expected:** Returns 404; toast shows "Failed to remove session"
- **Type:** failure

### TC-1606: Unauthenticated access
- **Precondition:** No authentication token
- **Steps:**
  1. Call `GET /v1/agents` without Authorization header
  2. Call `DELETE /v1/agents/:name` without Authorization header
- **Expected:** Both return 401 Unauthorized
- **Type:** failure

---

## Edge Cases

### TC-1607: No chat sessions (empty state)
- **Precondition:** Authenticated owner with agents but none named `session-*`
- **Steps:**
  1. Load Chat Sessions tab
- **Expected:** UI renders the empty state message; stat counter shows 0
- **Type:** edge

### TC-1608: Session with missing optional fields
- **Precondition:** Authenticated owner with a session agent that has no `description`, no `roles`, and no `created_at`
- **Steps:**
  1. Expand the session card
- **Expected:** Missing fields are either hidden or show dash/placeholder; UI does not error
- **Type:** edge

### TC-1609: Many chat sessions
- **Precondition:** Authenticated owner with 50+ session agents
- **Steps:**
  1. Load Chat Sessions tab
- **Expected:** All session cards render without performance issues; scrolling works correctly; stat counter shows correct total
- **Type:** edge

### TC-1610: Session agent with special characters in display name
- **Precondition:** Authenticated owner with a session agent whose `display_name` contains HTML special characters (e.g., `<script>alert(1)</script>`)
- **Steps:**
  1. Load Chat Sessions tab
- **Expected:** Display name is escaped via `escHtml()`; no XSS; characters render as literal text
- **Type:** edge
