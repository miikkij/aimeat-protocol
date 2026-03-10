# E2E Test Cases: Nodes Tab

**Tab file:** `public/views/profile/nodes-tab.js`
**Service file:** `public/js/services/nodes.js`
**APIs tested:**
- `GET /v1/personal/status` — list anchored nodes
- `POST /v1/personal/anchor` — register (anchor) a personal node
- `DELETE /v1/personal/anchor/:nodeId` — detach (delete) a node
- `PATCH /v1/personal/anchor/:nodeId` — update node visibility

---

## Success Cases

### TC-1301: List nodes when none are anchored
- **Precondition:** Authenticated owner with no anchored personal nodes
- **Steps:**
  1. Call `GET /v1/personal/status`
- **Expected:** Returns 404 or empty data; UI renders the empty state message
- **Type:** success

### TC-1302: List nodes with an anchored node
- **Precondition:** Authenticated owner with one anchored personal node
- **Steps:**
  1. Register a node via `POST /v1/personal/anchor`
  2. Call `GET /v1/personal/status`
- **Expected:** Returns node data including `node_id`, `visibility`, `agent_gaiis`, `mailbox`, `status`, `last_seen`; UI renders the node card
- **Type:** success

### TC-1303: Register a new personal node
- **Precondition:** Authenticated owner with no anchored node
- **Steps:**
  1. Call `POST /v1/personal/anchor` with `{ node_id: "personal-mynode", owner_name, public_key, agent_gaiis: [], visibility: "private" }`
- **Expected:** Returns 200/201 with `ok: true`; node appears in subsequent `GET /v1/personal/status`
- **Type:** success

### TC-1304: Set node visibility to public
- **Precondition:** Authenticated owner with an anchored private node
- **Steps:**
  1. Call `PATCH /v1/personal/anchor/:nodeId` with `{ visibility: "public" }`
  2. Call `GET /v1/personal/status`
- **Expected:** Returns `ok: true`; node visibility field is now `"public"`
- **Type:** success

### TC-1305: Set node visibility to private
- **Precondition:** Authenticated owner with an anchored public node
- **Steps:**
  1. Call `PATCH /v1/personal/anchor/:nodeId` with `{ visibility: "private" }`
  2. Call `GET /v1/personal/status`
- **Expected:** Returns `ok: true`; node visibility field is now `"private"`
- **Type:** success

### TC-1306: Detach (delete) a node
- **Precondition:** Authenticated owner with an anchored node
- **Steps:**
  1. Call `DELETE /v1/personal/anchor/:nodeId`
  2. Call `GET /v1/personal/status`
- **Expected:** Delete returns `ok: true`; subsequent status returns 404 or empty data
- **Type:** success

### TC-1307: Copy tunnel URL to clipboard
- **Precondition:** Authenticated owner with an anchored node; node detail expanded
- **Steps:**
  1. Expand node detail card
  2. Click the "Copy URL" button next to the tunnel URL
- **Expected:** Tunnel URL (ws://...:/v1/personal/tunnel) is copied to clipboard; toast confirms copy
- **Type:** success

---

## Failure Cases

### TC-1308: Register with empty nodeId
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/personal/anchor` with `{ node_id: "" }`
- **Expected:** Client-side validation blocks submission; toast shows registration failed; no API call made for empty string (trimmed to empty)
- **Type:** failure

### TC-1309: Register duplicate nodeId
- **Precondition:** Authenticated owner with an already-anchored node
- **Steps:**
  1. Call `POST /v1/personal/anchor` with the same `node_id` already registered
- **Expected:** Returns error (conflict or bad request); toast shows registration failed
- **Type:** failure

### TC-1310: Detach non-existent node
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `DELETE /v1/personal/anchor/nonexistent-node-id`
- **Expected:** Returns 404 or error response with `ok: false`
- **Type:** failure

### TC-1311: Unauthenticated access
- **Precondition:** No authentication token
- **Steps:**
  1. Call `GET /v1/personal/status` without Authorization header
  2. Call `POST /v1/personal/anchor` without Authorization header
  3. Call `DELETE /v1/personal/anchor/:nodeId` without Authorization header
  4. Call `PATCH /v1/personal/anchor/:nodeId` without Authorization header
- **Expected:** All return 401 Unauthorized
- **Type:** failure

---

## Edge Cases

### TC-1312: No anchored nodes returns 404 gracefully
- **Precondition:** Authenticated owner, no nodes anchored
- **Steps:**
  1. Call `GET /v1/personal/status`
- **Expected:** 404 is accepted as a valid "no nodes" response; service wraps it as empty array `[]`
- **Type:** edge

### TC-1313: Node with many agent GAIIs
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/personal/anchor` with `agent_gaiis` containing 20+ GAII strings
  2. Expand node detail
- **Expected:** All agent GAIIs are stored and displayed in the agent list; UI does not truncate or break
- **Type:** edge

### TC-1314: Special characters in node ID
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call `POST /v1/personal/anchor` with `node_id` containing special characters like spaces, unicode, or symbols (e.g., `"personal-test node/v2"`)
- **Expected:** Either the server rejects invalid characters with a clear error, or the node ID is URL-encoded correctly for subsequent PATCH/DELETE calls
- **Type:** edge

### TC-1315: Node ID auto-prefix behavior
- **Precondition:** Authenticated owner
- **Steps:**
  1. Call register with `node_id: "mynode"` (no `personal-` prefix)
- **Expected:** The service auto-prepends `personal-` so the stored node_id is `"personal-mynode"`
- **Type:** edge
