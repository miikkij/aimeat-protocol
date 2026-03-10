# E2E Test Cases: Access Tab

**Tab file:** `public/views/profile/access-tab.js`
**Service file:** `public/js/services/auth.js`
**APIs tested:** None directly (read-only tab using session data from local state)

This tab is read-only. It displays session information, public key, owner key (from localStorage), and the MCP endpoint URL. No CRUD API calls are made.

---

## Success Cases

### TC-1701: Load access info with all fields populated
- **Precondition:** Authenticated owner with valid session containing `owner`, `ghii`, `gaii`, `publicKey`, `valid: true`; owner key stored in localStorage
- **Steps:**
  1. Navigate to the Access tab
- **Expected:** Tab displays: owner name, GHII, agent GAII, node URL, JWT validity badge (green "Yes"), public key in monospace, owner key (blurred), and MCP endpoint URL
- **Type:** success

### TC-1702: Blur and reveal owner key toggle
- **Precondition:** Authenticated owner with owner key stored in `localStorage` under `aimeat_owner_key`
- **Steps:**
  1. Navigate to Access tab
  2. Observe the owner key is blurred (CSS `blur(4px)`)
  3. Hover mouse over the key
  4. Move mouse away
- **Expected:** Key is initially blurred; hovering removes blur (reveals key); moving away re-applies blur; clicking the card copies key to clipboard with toast confirmation
- **Type:** success

### TC-1703: Copy MCP endpoint URL
- **Precondition:** Authenticated owner
- **Steps:**
  1. Navigate to Access tab
  2. Locate the MCP endpoint section showing `<node_url>/v1/mcp`
- **Expected:** MCP endpoint URL is displayed correctly with the node's base URL; the URL format is `<origin>/v1/mcp`
- **Type:** success

---

## Failure Cases

### TC-1704: Unauthenticated access redirects to login
- **Precondition:** No active session (not logged in)
- **Steps:**
  1. Attempt to navigate to the Access tab
- **Expected:** Profile page redirects to login; Access tab is not rendered without a session
- **Type:** failure

---

## Edge Cases

### TC-1705: Session about to expire
- **Precondition:** Authenticated owner whose JWT is close to expiration
- **Steps:**
  1. Navigate to Access tab
  2. Observe the JWT validity field
- **Expected:** If `session.valid` is still `true`, the green badge shows; once expired and `valid` becomes `false`, the badge switches to red "Expired"
- **Type:** edge

### TC-1706: Missing optional fields
- **Precondition:** Authenticated owner with session that has no `ghii` or no `gaii` set
- **Steps:**
  1. Navigate to Access tab
- **Expected:** Missing fields display `"-"` as placeholder; no errors or blank rendering
- **Type:** edge

### TC-1707: No owner key in localStorage
- **Precondition:** Authenticated owner; `aimeat_owner_key` is not set in localStorage (e.g., logged in on a different device)
- **Steps:**
  1. Navigate to Access tab
- **Expected:** The "Owner Key" section is not rendered at all (conditional on `ownerKey` being truthy); other sections display normally
- **Type:** edge

### TC-1708: XSS prevention in displayed fields
- **Precondition:** Authenticated owner whose `owner` or `ghii` contains HTML-like characters
- **Steps:**
  1. Navigate to Access tab
- **Expected:** All user-derived values are passed through `escHtml()`; no HTML injection occurs
- **Type:** edge
