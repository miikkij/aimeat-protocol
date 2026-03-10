# E2E Test Plan: Federation Tab

## Overview

The Federation tab appears in two contexts with significantly different feature sets:

- **Profile view** (`public/views/profile/federation-tab.js`): Simple read-only peer list showing node IDs, URLs, and online/offline status.
- **Admin view** (`public/views/admin/federation-tab.js`): Full federation management including peering requests, peer lifecycle (approve/reject/activate/remove), genesis network joining, direct peer addition, federation readiness testing, and de-peering management.

## APIs Under Test

### Profile View APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/federation/directory` | Optional | List federated peers (public directory) |

### Admin View APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/federation/directory` | Operator | List federation directory |
| GET | `/v1/federation/peers` | Operator | List live peers with full metadata |
| POST | `/v1/federation/peers` | Operator | Add a peer directly |
| PUT | `/v1/federation/peers/:nodeId` | Operator | Activate a peer |
| DELETE | `/v1/federation/peers/:nodeId` | Operator | Remove a peer (graceful de-peering) |
| DELETE | `/v1/federation/peers/:nodeId` (emergency) | Operator | Emergency peer removal |
| GET | `/v1/admin/peering/requests` | Operator | List peering requests |
| PUT | `/v1/admin/peering/requests/:id` | Operator | Approve or reject a peering request |
| POST | `/v1/federation/peer/introduce` | Operator | Join a genesis network |
| POST | `/v1/federation/test` | Operator | Test federation readiness of a remote node |

## Peer Status Values

| Status | Description | Badge Color |
|--------|-------------|-------------|
| `active` | Peer is online and communicating | Green (healthy) |
| `approved` | Peering approved but not yet activated | Blue (info) |
| `pending` | Peering request awaiting review | Yellow (watch) |
| `degraded` | Peer is partially reachable | Yellow (watch) |
| `offline` | Peer is unreachable | Red (critical) |
| `depeering` | Peer is in graceful removal process | Red (critical) |

## Table of Contents

- [Success Cases](#success-cases) (TC-F001 to TC-F012)
- [Failure Cases](#failure-cases) (TC-F013 to TC-F019)
- [Edge Cases](#edge-cases) (TC-F020 to TC-F027)

---

## Success Cases

### TC-F001: Load federation directory (profile view)
- **Precondition:** Server is running. Federation may or may not be configured.
- **Steps:**
  1. Navigate to the Federation tab in the profile view.
  2. Verify loading spinner appears briefly.
  3. If peers exist, verify a peer list is rendered.
  4. If no peers exist, verify the empty state message is shown.
- **Expected:** The federation directory loads without errors. The UI handles both populated and empty states.
- **Type:** success

### TC-F002: Peer status display (online vs offline)
- **Precondition:** Federation directory contains at least one active and one offline peer.
- **Steps:**
  1. GET `/v1/federation/directory`.
  2. Verify peers have `status` or `alive` fields.
  3. In the profile UI, verify active peers show a green dot and "online" text.
  4. Verify offline peers show a red dot and "offline" text.
- **Expected:** Peer status is visually distinguished with colored dots and text labels.
- **Type:** success

### TC-F003: Peer URL and node ID displayed
- **Precondition:** Federation directory contains at least one peer.
- **Steps:**
  1. GET `/v1/federation/directory`.
  2. Verify each peer in the response has `node_id` (or `nodeId`) and `url` fields.
  3. In the profile UI, verify the card title shows the node ID.
  4. Verify the card subtitle shows the peer URL.
- **Expected:** Both node ID and URL are displayed for each peer. The UI falls back to URL as title if node_id is missing.
- **Type:** success

### TC-F004: Admin federation stats overview
- **Precondition:** Authenticated as operator. Federation has peers in various states.
- **Steps:**
  1. Navigate to the admin Federation tab.
  2. Verify the StatsGrid displays counts for: active peers, degraded peers, offline peers, pending requests.
  3. Verify counts match the actual peer data.
- **Expected:** The stats overview accurately summarizes peer states.
- **Type:** success

### TC-F005: Approve a peering request (admin)
- **Precondition:** Authenticated as operator. A pending peering request exists.
- **Steps:**
  1. In the admin Federation tab, locate the "Pending Peering Requests" section.
  2. Click the approve button for a pending request.
  3. Confirm the browser dialog.
  4. Verify a success flash message appears.
  5. Verify the request moves from pending to the request history as "approved".
- **Expected:** PUT `/v1/admin/peering/requests/:id` is called with approve action. The request status changes.
- **Type:** success

### TC-F006: Reject a peering request (admin)
- **Precondition:** Authenticated as operator. A pending peering request exists.
- **Steps:**
  1. In the admin Federation tab, locate the "Pending Peering Requests" section.
  2. Click the reject button for a pending request.
  3. Confirm the browser dialog.
  4. Verify a success flash message appears.
  5. Verify the request appears in the history section with "rejected" status.
- **Expected:** The peering request is rejected. The peer is not added to the directory.
- **Type:** success

### TC-F007: Add peer directly (admin)
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. Scroll to the "Add Peer Directly" section in the admin Federation tab.
  2. Enter a node ID (e.g., `test-node-001`) in the Node ID field.
  3. Enter a URL (e.g., `https://peer.example.com`) in the URL field.
  4. Optionally enter a public key.
  5. Click the "Add Peer" button.
  6. Verify a success flash message appears.
  7. Verify the new peer appears in the live peers table.
- **Expected:** POST `/v1/federation/peers` is called. The peer is added to the federation directory.
- **Type:** success

### TC-F008: Activate an approved peer (admin)
- **Precondition:** Authenticated as operator. A peer with status "approved" exists.
- **Steps:**
  1. In the live peers table, find a peer with "approved" status.
  2. Click the "Activate" button.
  3. Confirm the browser dialog.
  4. Verify the peer status changes to "active".
- **Expected:** PUT `/v1/federation/peers/:nodeId` is called. The peer transitions from approved to active.
- **Type:** success

### TC-F009: Graceful de-peering (admin)
- **Precondition:** Authenticated as operator. An active or degraded peer exists.
- **Steps:**
  1. In the live peers table, find an active peer.
  2. Click the "De-peer" button.
  3. Confirm the browser dialog.
  4. Verify a success flash message appears.
  5. Verify the peer enters "depeering" status or is removed.
- **Expected:** DELETE `/v1/federation/peers/:nodeId` initiates graceful de-peering.
- **Type:** success

### TC-F010: Emergency de-peering (admin)
- **Precondition:** Authenticated as operator. An active peer exists.
- **Steps:**
  1. In the live peers table, find an active peer.
  2. Click the emergency de-peer button (warning icon).
  3. Confirm the browser dialog.
  4. Verify the peer is immediately removed.
- **Expected:** Emergency removal bypasses the grace period. The peer is removed immediately.
- **Type:** success

### TC-F011: Test federation readiness (admin)
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. Scroll to the "Test Federation Readiness" section.
  2. Enter a remote node URL (e.g., `https://other-node.example.com`).
  3. Click the "Test" button.
  4. Verify a loading state appears while testing.
  5. Verify the result shows target URL, readiness status, individual check results, and test timestamp.
- **Expected:** POST `/v1/federation/test` is called. Results are displayed with pass/fail indicators for each check.
- **Type:** success

### TC-F012: Join genesis network (admin)
- **Precondition:** Authenticated as operator. No live peers exist (join section is only shown when `livePeers.length === 0`).
- **Steps:**
  1. In the "Join Genesis Network" section, enter a genesis node URL.
  2. Select a role (contributor or operator).
  3. Click the "Join" button.
  4. Verify a loading state appears.
  5. Verify the result shows target node ID, status, and request ID.
- **Expected:** POST `/v1/federation/peer/introduce` is called. The join result is displayed with peering request details.
- **Type:** success

---

## Failure Cases

### TC-F013: Federation not configured (empty directory)
- **Precondition:** Server is running with no federation peers configured.
- **Steps:**
  1. GET `/v1/federation/directory`.
  2. Verify response status is 200.
  3. Verify `data.peers` is an empty array.
  4. In the profile UI, verify the empty state message is displayed.
  5. In the admin UI, verify the "No federation peers" empty component is shown.
- **Expected:** An empty peer list is returned. The UI shows appropriate empty state for both views.
- **Type:** failure

### TC-F014: Add peer with missing required fields (admin)
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. In the "Add Peer Directly" section, leave the Node ID field empty.
  2. Enter only a URL.
  3. Click "Add Peer".
  4. Verify an error flash message appears (client-side validation: "Missing required fields").
- **Expected:** The client-side validation prevents the API call when node ID or URL is missing.
- **Type:** failure

### TC-F015: Test federation readiness with invalid URL
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. Enter an invalid or unreachable URL in the test field.
  2. Click "Test".
  3. Verify the test result shows an error message.
- **Expected:** The test fails gracefully and displays the error in the result panel.
- **Type:** failure

### TC-F016: Join genesis with empty URL
- **Precondition:** Authenticated as operator. No live peers exist.
- **Steps:**
  1. Leave the genesis URL field empty.
  2. Click "Join".
  3. Verify an error flash message appears (client-side: "URL required").
- **Expected:** Client-side validation prevents the join attempt with an empty URL.
- **Type:** failure

### TC-F017: Non-operator attempts admin federation actions
- **Precondition:** Authenticated as a regular owner (not operator).
- **Steps:**
  1. Attempt to POST `/v1/federation/peers` to add a peer directly.
  2. Verify response status is 403.
  3. Attempt to PUT `/v1/admin/peering/requests/:id` to approve a request.
  4. Verify response status is 403.
- **Expected:** Federation management endpoints require operator role. Non-operators are denied.
- **Type:** failure

### TC-F018: Test federation with empty URL field
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. Leave the test URL field empty.
  2. Click "Test".
  3. Verify no API call is made (client-side check: `if (!testUrl) return`).
- **Expected:** The test button does nothing when the URL field is empty.
- **Type:** failure

### TC-F019: Cancel confirm dialog on peer actions
- **Precondition:** Authenticated as operator. Peers or peering requests exist.
- **Steps:**
  1. Click "Approve" on a peering request.
  2. Click "Cancel" on the browser confirm dialog.
  3. Verify no API call is made. The request remains pending.
  4. Repeat for reject, activate, remove, and emergency remove actions.
- **Expected:** All destructive peer actions require confirmation. Cancelling aborts the action.
- **Type:** failure

---

## Edge Cases

### TC-F020: Empty peer list in profile view
- **Precondition:** No federation peers configured.
- **Steps:**
  1. Navigate to the Federation tab in the profile view.
  2. Verify the loading spinner appears then resolves.
  3. Verify the empty state message is displayed (from `t('profile.federation.empty')`).
- **Expected:** The profile view handles zero peers gracefully with an informative empty state.
- **Type:** edge

### TC-F021: Mixed online/offline peers
- **Precondition:** Federation directory has peers with mixed statuses (some active, some offline, some degraded).
- **Steps:**
  1. Navigate to the Federation tab (profile or admin).
  2. Verify each peer shows its correct status indicator.
  3. In the profile view: green dot for active/alive, red dot for inactive/dead.
  4. In the admin view: appropriate badge colors (green for active, yellow for degraded, red for offline/depeering).
- **Expected:** Status indicators correctly reflect each peer's individual state.
- **Type:** edge

### TC-F022: Peer with missing URL or node ID
- **Precondition:** Federation directory contains a peer entry with partial data.
- **Steps:**
  1. GET `/v1/federation/directory`.
  2. Verify peer entries that lack `node_id` fall back to displaying the URL.
  3. Verify peer entries that lack `url` display an empty string or dash.
  4. In the profile UI, verify `p.node_id || p.nodeId || p.url` fallback chain works.
- **Expected:** The UI handles missing fields gracefully using fallback values instead of showing "undefined" or crashing.
- **Type:** edge

### TC-F023: De-peering peers with grace period display (admin)
- **Precondition:** Authenticated as operator. At least one peer is in "depeering" status with a `depeer_grace_end` timestamp.
- **Steps:**
  1. Navigate to the admin Federation tab.
  2. Verify the de-peering warning section appears (only shown when depeering peers exist).
  3. Verify each de-peering peer shows its node ID and grace period end time.
- **Expected:** The de-peering section is conditionally rendered and shows the grace period deadline.
- **Type:** edge

### TC-F024: Peering request history display (admin)
- **Precondition:** Authenticated as operator. At least one approved and one rejected peering request exist.
- **Steps:**
  1. Navigate to the admin Federation tab.
  2. Scroll to the "Peering Request History" section.
  3. Verify both approved and rejected requests are listed.
  4. Verify each row shows request ID, from_node_id, endpoint URL, status badge, and created_at.
- **Expected:** History section combines approved and rejected requests. Status badges use appropriate colors.
- **Type:** edge

### TC-F025: Join genesis section visibility (admin)
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. With no live peers: verify the "Join Genesis Network" section is visible.
  2. Add a peer (or have an existing peer). Reload the tab.
  3. Verify the "Join Genesis Network" section is hidden when `livePeers.length > 0`.
- **Expected:** The genesis join section is only shown when the node has no live peers, guiding first-time federation setup.
- **Type:** edge

### TC-F026: Federation test result with detailed checks
- **Precondition:** Authenticated as operator. A reachable remote node exists.
- **Steps:**
  1. Test federation readiness against the remote node.
  2. Verify the result panel shows individual `checks` with key-value pairs.
  3. Verify each check shows a pass (checkmark) or fail (cross) indicator with detail text.
  4. Verify `target_url`, `ready` boolean, and `tested_at` timestamp are displayed.
- **Expected:** The test result provides granular feedback about each federation requirement check.
- **Type:** edge

### TC-F027: Flash message auto-dismiss
- **Precondition:** Authenticated as operator.
- **Steps:**
  1. Perform a successful federation action (e.g., add a peer).
  2. Verify the green success flash message appears.
  3. Wait 4 seconds. Verify the success message disappears.
  4. Trigger an error (e.g., add peer with missing fields).
  5. Verify the red error flash message appears.
  6. Wait 6 seconds. Verify the error message disappears.
- **Expected:** Success messages auto-dismiss after 4 seconds. Error messages auto-dismiss after 6 seconds.
- **Type:** edge
