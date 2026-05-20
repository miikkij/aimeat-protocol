# Federation Mesh Network Design

**Date:** 2026-05-20
**Status:** Draft
**Scope:** Network directory, per-peer policies, federated login, cross-node data access, UI updates

---

## 1. Problem Statement

The current federation is peer-to-peer only: nodes see direct peers but not peers-of-peers. A user on node A cannot discover services on node C if C is connected through B. There is no federated login (users are trapped on their home node), no per-peer sync policy (everything shares equally), and no network-wide service directory.

This spec designs a federation mesh that supports:
- **Full mesh connectivity** via a hub-managed network directory with on-demand routing
- **Private P2P mode** for nodes that want isolated bilateral connections
- **Federated login** so users can authenticate on any federation node with home credentials
- **Cross-node data access** with user-controlled scope via the existing consent system
- **Per-peer policies** controlling what flows through each connection

## 2. Design Principles

1. **Build on existing systems.** The routing layer, consent system, catalogue sync, memory replication, and heartbeat are already built. This spec extends them, not replaces them.
2. **User controls visibility.** Every catalogue item has a `federate` flag. Memory uses the existing consent system with `node:*` patterns. No data leaves a node without explicit user action.
3. **Hub aggregates, doesn't store.** The network directory is an in-memory aggregation of service summaries. No data duplication to the hub's database.
4. **On-demand over pre-replication.** Data is fetched live via routing when needed, not pre-copied everywhere. Memory replication remains opt-in via consent.

## 3. Architecture Overview

Three layers, each building on existing infrastructure:

### Layer 1: Network Directory (Discovery)

The operator/hub node maintains a network-wide service directory. Each node pushes a compact summary of its federated content to its direct peer (the hub) during heartbeat sync. The hub aggregates all summaries into a queryable directory.

**How it works:**

1. Each node computes a **service summary**: a compact list of all items with `federate: true` (actions, agents, boards, CSMs, knowledge, public files) plus public memory entries with federation consent. Summary contains metadata only (id, name, type, category, price, node_id) -- not full content or schemas.

2. The heartbeat payload already carries `stats.catalogue_hash`. When the hash changes between cycles, the hub calls a new `GET /v1/federation/service-summary` endpoint on the peer to fetch the updated summary.

3. The hub stores aggregated summaries in an in-memory Map keyed by node_id. Entries expire when a peer goes offline (3 missed heartbeat cycles). No new database table.

4. The existing `GET /v1/federation/cross-catalogue` endpoint is extended to include network directory entries with `source_type: 'network'`. Non-hub nodes query their hub for the directory.

5. Full details (schemas, descriptions, file content) are fetched on-demand via the existing `POST /v1/federation/route` multi-hop relay.

**New endpoint:**

```
GET /v1/federation/service-summary
```

Returns a compact catalogue of all federated items on this node. Requires peer authentication (verified via peers map). Response shape:

```json
{
  "node_id": "node-C",
  "summary_hash": "sha256...",
  "actions": [{ "id": "translate-fi", "category": "translation", "display_name": "Finnish Translation", "price": 5, "provider_gaii": "agent#owner@node-C" }],
  "agents": [{ "gaii": "agent#owner@node-C", "display_name": "TranslateBot", "trust_score": 85 }],
  "boards": [{ "id": "board-1", "name": "Finnish Dev Community", "post_count": 42 }],
  "csms": [{ "name": "hobby-directory", "service_type": "directory" }],
  "knowledge": [{ "key": "packages/finnish-grammar/manifest", "title": "Finnish Grammar Guide" }],
  "memory_keys": [{ "gaii": "owner@node-C", "key": "profile.interests", "updated_at": "..." }],
  "files": [{ "key": "datasets/municipalities.csv", "size_bytes": 45000 }]
}
```

**Changes to existing code:**

| File | Change |
|------|--------|
| `federation.ts` (heartbeat) | Compare service summary hash; request updated summary on change |
| `federation-peer.ts` | New `GET /v1/federation/service-summary` endpoint |
| `federation-genesis.ts` | Extend `cross-catalogue` to include network directory entries |
| Heartbeat payload | Add `service_summary_hash` field |

### Layer 2: Per-Peer Policy

Each peer connection gets configurable policy flags controlling what flows through that link.

**New fields on `FederationPeerRecord`:**

| Field | Type | Default | Effect |
|-------|------|---------|--------|
| `shareCatalogue` | `boolean` | `true` | Include this node's federated items in the network directory via this peer |
| `replicateMemory` | `boolean` | `true` | Allow consented memory to replicate to/through this peer |
| `allowRouting` | `boolean` | `true` | Allow this peer to relay requests to/from other nodes |
| `peerMode` | `'federation' \| 'private'` | `'federation'` | `private` = P2P only, invisible to network directory |

**Private P2P mode:** When `peerMode: 'private'`, the connection is bilateral only. The hub does not include either node's data in the aggregated directory on behalf of this link. The two nodes can still sync memory and route between each other. Use case: personal node connected to one trusted node.

**Enforcement points:**

| Existing code path | Check to add |
|--------------------|-------------|
| `federation-sync.ts` catalogue-sync handler | Skip if `peer.shareCatalogue === false` |
| `federation-sync.ts` replicate handler | Skip if `peer.replicateMemory === false` |
| `federation-sync.ts` route handler | Reject relay if `peer.allowRouting === false` |
| `memory-replication.ts` replicateMemoryToPeer | Skip if `peer.replicateMemory === false` |
| Heartbeat summary request | Skip if `peer.shareCatalogue === false` or `peer.peerMode === 'private'` |

**Storage changes:**

| File | Change |
|------|--------|
| `storage/interface.ts` | Add 4 fields to `FederationPeerRecord` |
| `sqlite/schema.ts` | Add columns to `federation_peers` table |
| `prisma/schema.prisma` | Add fields to `FederationPeer` model |
| SQLite + MongoDB providers | Handle new fields in save/list methods |

### Layer 3: Selective Replication (Existing + Consent UI)

Memory replication uses the existing system unchanged:
- `visibility: public` + federation consent = eligible for replication
- Consent `recipient` patterns (`node:node-id`, `domain:*`, `*`) control which nodes receive data
- The replication queue and sync modes (`bulk`/`instant`/`hybrid`) work as-is

**What's new:** Better UI in the profile Data Wallet tab to manage federation consents (see Section 7).

## 4. Federate Flags

Add `federate?: boolean` to catalogue record types that don't have it yet.

| Record | Current `federate` field | Change |
|--------|------------------------|--------|
| `CsmRecord` | Yes (`federate?: boolean`) | No change |
| `ActionRecord` | No | Add `federate?: boolean` (default `false`) |
| `AgentRecord` | No | Add `federate?: boolean` (default `false`) |
| `BoardRecord` | No | Add `federate?: boolean` (default `false`, only for public boards) |
| `StorageFileRecord` | No | Add `federate?: boolean` (default `false`) |
| `MemoryRecord` | No (uses consent) | No schema change. Controlled by existing `visibility: public` + federation consent. Included in service summary when eligible. |

**Storage changes for each record type:**
- Add column/field to SQLite schema, Prisma schema, and both storage providers
- Add to create/update methods
- Add to API request/response shapes
- Migration: existing records default to `federate: false` (opt-in)

## 5. Federated Login

### Authentication Flow

1. User enters `alice@node-A` + password on node B's login page
2. Node B's login handler (`libs.ts` / `ghii.ts`) detects `@node-A` suffix, `node-A !== config.nodeId`
3. Node B sends a verification request to node A via federation routing:

```
POST /v1/federation/auth/verify (on node A, reached via routing)
{
  "username": "alice",
  "password_hash": "<bcrypt hash of password>",
  "requesting_node": "node-B",
  "timestamp": "2026-05-20T..."
}
```

4. Node A processes the request:
   - Verifies `alice` exists and password hash matches
   - Checks if alice has an active consent with `recipient: node:node-B` and `scope: federation`
   - If no consent exists, returns `{ verified: false, reason: "no_federation_consent" }`
   - If consent exists, returns a signed attestation:

```json
{
  "verified": true,
  "ghii": "alice@node-A",
  "display_name": "Alice",
  "home_node": "node-A",
  "home_url": "https://node-a.example.com",
  "scopes": ["memory:read", "memory:write", "work:request"],
  "signature": "<ed25519 signature over this payload>",
  "expires_at": "2026-05-20T21:00:00Z"
}
```

5. Node B verifies the signature against node A's public key (from key exchange cache)
6. Node B issues a local JWT with additional claims:

```json
{
  "sub": "alice",
  "ghii": "alice@node-A",
  "roles": ["owner"],
  "federated": true,
  "homeNode": "node-A",
  "homeUrl": "https://node-a.example.com"
}
```

7. JWT TTL: 1 hour (short, vs normal 24h). Refresh re-verifies with home node.

### Auth Consent (Distinct from Data Consent)

Federated login requires a **separate auth consent**, not a generic data consent. Sharing memory with `node:B` should NOT automatically allow node B to authenticate you. Authentication is a higher-trust decision.

**New consent scope:** `auth` (alongside existing `private`, `dmz`, `federation`).

The federated login flow (step 4 above) checks specifically for:
```
scope: 'auth', recipient: 'node:node-B', pattern: '_identity', status: 'active'
```

**Where users manage this:** The profile **Access tab** (`access-tab.js`) gets a new "Federation Access" section:
- List of nodes the user has granted auth consent to (with node ID, URL, granted date)
- "Add node" form: enter a node ID to allow federated login from that node
- "Remove" button per entry: revokes the auth consent immediately
- "Allow all federation nodes" toggle: creates a wildcard auth consent (`recipient: *`)
- Visual warning when wildcard is enabled: "Any federation node can verify your identity"

Under the hood, each entry creates a `ConsentRecord` with `scope: 'auth'`, `recipient: 'node:<node-id>'`, `dataPattern: '_identity'`.

### Security Model

| Concern | Mitigation |
|---------|-----------|
| Password exposure | Hashed with bcrypt before sending. Only travels over TLS between nodes. |
| Unauthorized node login | Home node checks for auth-scope consent (`scope: auth`) for `node:requesting-node`. No consent = denied. Separate from data consent. |
| Stale sessions | Short JWT TTL (1 hour). Refresh triggers re-verification with home node. |
| Stolen federated JWT | Limited scopes (no admin, no operator actions). Home node can revoke auth consent to cut off access. |
| MITM between nodes | Payloads signed with Ed25519 node keys. Signature verified against cached public key from key exchange. |
| Consent confusion | Auth consent is a distinct scope (`auth`) from data consent (`federation`). Sharing data with a node does not grant login access. |

### Permissions for Federated Sessions

Federated sessions have restricted permissions compared to local sessions:

| Action | Allowed | How |
|--------|---------|-----|
| Read own memory (home node) | Yes | Routed to home node via federation |
| Write memory (home node) | Yes | Routed to home node |
| Write memory (current node) | Yes | Stored locally under federated GHII |
| Invoke services | Yes | Via routing, payment from home node balance |
| Browse catalogue | Yes | Local + network directory |
| Admin/operator actions | No | Federated sessions never get operator role |
| Create agents | No | Agents are created on home node only |
| Manage consents | No | Managed on home node only |

### New Endpoints

```
POST /v1/federation/auth/verify     -- Home node verifies credentials for a remote node
POST /v1/federation/auth/refresh    -- Home node re-verifies an existing federated session
```

### Code Changes

| File | Change |
|------|--------|
| `routes/libs.ts` | Replace `FEDERATION_LOGIN_UNSUPPORTED` error with federated login flow |
| `routes/ghii.ts` | Add federated login path in `POST /v1/ghii/login` |
| `auth/middleware.ts` | Recognize `federated: true` JWT claim, enforce restricted permissions |
| `auth/jwt.ts` | Support `federated`, `homeNode`, `homeUrl` claims |
| New: `routes/federation-auth.ts` | `POST /v1/federation/auth/verify` and `/refresh` endpoints |

## 6. Cross-Node Data Access

### Reading Home Data from Remote Node

When a federated user (`federated: true` in JWT) accesses memory or storage endpoints on the remote node:

1. The route handler detects `req.auth.federated === true`
2. If the requested data exists locally (user previously pulled a copy), serve it locally
3. If not, proxy the request to the home node via `POST /v1/federation/route`:
   - Target: `req.auth.homeNode`
   - Path: the original request path
   - Method: GET
   - The home node's auth middleware trusts the routing (signed route manifest)
4. Return the proxied response to the user

### Data Pull (Copy to Current Node)

Users can copy specific memory entries from their home node to the current node:

1. New action in memory UI: "Copy to this node"
2. Fetches the entry from home node via routing
3. Stores locally with `visibility: private`, tagged `pulled-from:home-node:original-key`
4. The copy is independent (no auto-sync back)
5. User can choose to make the local copy public/federated

### Writing Data

| Where user is | Where data goes | How |
|--------------|----------------|-----|
| Node B (federated session) | Write to node B | Stored locally under federated GHII `alice@node-A` |
| Node B (federated session) | Write to home node A | "Save to home" action routes write to node A |
| Node B (federated session) | Default | Local write to node B (fast, no routing latency) |

### Cross-Node Service Invocation

Already implemented via `POST /v1/federation/cross-node/work`. The routing fee (1 morsel per hop) is already built. No changes needed for the happy path.

Payment comes from the user's morsel balance on their home node. The settlement system (`POST /v1/federation/settle`) handles inter-node morsel transfers.

### Code Changes

| File | Change |
|------|--------|
| `routes/memory.ts` | Add federated session proxy logic for GET endpoints |
| `routes/storage-files.ts` | Same proxy logic for file access |
| New: `middleware/federation-proxy.ts` | Shared proxy middleware for routing requests to home node |

## 7. UI Updates

### Admin Dashboard -- Federation Tab

**Peer policy editor (per peer):**
- Four toggles in peer detail view: Share Catalogue, Replicate Memory, Allow Routing, Peer Mode (federation/private)
- Shown inline in the Live Peers table or in an expandable detail row

**Network directory browser (new section):**
- Table showing all services/data across the federation from the aggregated directory
- Columns: Name, Type (action/board/CSM/...), Node, Category, Price
- Search/filter by type, category, keyword
- Click to view details (fetched on-demand via routing)
- "Invoke" button for actions (opens work request flow)

### Profile Tabs

**Access tab (federation access section):**
- New section: "Federation Access" below existing session/keys/MCP sections
- List of nodes granted auth consent (node ID, URL, granted date)
- "Add node" form: enter node ID to allow federated login from that node
- "Remove" button per entry: revokes auth consent immediately
- "Allow all federation nodes" toggle: wildcard auth consent (`recipient: *`)
- Warning when wildcard enabled: "Any federation node can verify your identity"
- Visual distinction from session keys section (auth consent is about remote login, keys are about local crypto)

**Agents tab:**
- Add "Federate" toggle per agent card
- Badge showing "Federated" on agents with `federate: true`
- Tooltip: "This agent's profile is visible across the federation network"

**Memory tab:**
- Badge on entries that have active federation consent: "Synced to federation"
- Quick action: "Share to federation" creates a federation consent for that key pattern
- Quick action: "Stop sharing" revokes the federation consent

**Data Wallet tab (consents):**
- Highlight federation-scope consents with a distinct badge
- Highlight auth-scope consents with a separate "Login access" badge
- "Quick share" button that creates a consent with `scope: federation, recipient: *, pattern: <key>`
- Filter: show only federation consents or auth consents

**Boards tab:**
- Add "Federate" toggle for owned public boards
- Badge on federated boards

**Knowledge tab:**
- Add "Federate" toggle per knowledge package

**Actions tab (if present in profile, otherwise agent detail):**
- Add "Federate" toggle per published action

**Federation status indicator:**
- Small status line in profile sidebar or header: "Connected to X nodes | Y services available"
- Shows `0 nodes` for standalone, actual count for federated nodes

### Login Page

- When user enters `username@remote-node`, show a federation login indicator: "Signing in via node-A..."
- On success, show "Federated session" badge next to the logged-in status
- Show home node info in the session dropdown

## 8. Service Discovery Flow (End-to-End Example)

1. Service node C publishes action "translate-finnish" with `federate: true`
2. C's heartbeat to hub B includes updated `service_summary_hash`
3. B detects hash change, calls `GET /v1/federation/service-summary` on C
4. B stores C's summary in its network directory (in-memory)
5. User on node A browses catalogue. A queries B's `cross-catalogue` endpoint.
6. B returns local + network directory entries, including C's "translate-finnish"
7. User invokes "translate-finnish". Request routes A -> B -> C via existing routing.
8. C executes, returns result. A pays 5 morsels (service) + 2 morsels (2 hops routing fee).
9. User can view the work result on A (routed back in the response).

## 9. Memory Scope Flow (End-to-End Example)

1. User on node A creates memory `profile.interests` with `visibility: public`
2. User creates consent: `recipient: node:C, scope: federation, pattern: profile.*`
3. Replication system detects eligible entry, checks per-peer policy for C
4. If C's peer has `replicateMemory: true`, the entry is synced to C
5. Node B (hub) never receives it because there's no consent for `node:B`
6. User can also use `recipient: *` to share with all federation nodes

## 10. Federated Login Flow (End-to-End Example)

1. Alice (`alice@node-A`) visits node B's login page
2. Types `alice@node-A` and her password
3. Node B hashes password, routes verify request to node A through the federation
4. Node A checks: alice exists? password correct? consent for `node:node-B`? All yes.
5. Node A returns signed attestation with alice's GHII, display name, scopes
6. Node B issues federated JWT (1h TTL), alice is logged in
7. Alice browses node B's catalogue, sees network directory, invokes services
8. Alice checks her memory -- node B proxies the request to node A, returns results
9. Alice clicks "Copy to this node" on a memory entry -- local copy created on B
10. After 1 hour, JWT expires. Refresh re-verifies with node A.

## 11. Implementation Order

Suggested phasing to deliver incremental value:

### Phase 1: Per-Peer Policy + Federate Flags
- Add policy fields to FederationPeerRecord (storage + schema)
- Add `federate` boolean to ActionRecord, AgentRecord, BoardRecord, StorageFileRecord
- Enforce policies in sync/route handlers
- Admin UI: peer policy toggles
- Profile UI: federate toggles on all tabs

### Phase 2: Network Directory
- Service summary endpoint
- Hub aggregation in heartbeat cycle
- Extend cross-catalogue with network directory entries
- Admin UI: network directory browser

### Phase 3: Federated Login
- Auth verify/refresh endpoints
- Modified login flow (frontend + backend)
- JWT claims for federated sessions
- Middleware enforcement of federated permissions

### Phase 4: Cross-Node Data Access
- Federation proxy middleware
- Memory/storage route proxy for federated sessions
- Data pull ("Copy to this node") action
- "Save to home node" action

### Testing: Each Phase Includes Tests

Every phase must ship with comprehensive automated tests. Tests run on both SQLite and MongoDB backends (`pnpm test:e2e:sqlite` and `pnpm test:e2e:mongodb`). Frontend features include Playwright browser tests (`pnpm test:playwright:mongodb`).

**Phase 1 tests (per-peer policy + federate flags):**
- E2E: peer policy flags persist across restart (save, restart, verify loaded)
- E2E: `shareCatalogue: false` prevents catalogue sync to that peer
- E2E: `replicateMemory: false` prevents memory replication to that peer
- E2E: `allowRouting: false` rejects relay requests through that peer
- E2E: `peerMode: 'private'` excludes peer from network directory
- E2E: `federate` flag on actions/agents/boards/files -- only federated items appear in service summary
- E2E: items without `federate: true` are excluded from catalogue sync
- Playwright: federate toggle appears and works on agents, boards, knowledge, actions tabs
- Playwright: peer policy toggles appear in admin federation tab

**Phase 2 tests (network directory):**
- E2E: `GET /v1/federation/service-summary` returns only federated items
- E2E: hub aggregates summaries from multiple peers into cross-catalogue
- E2E: stale summaries expire when peer goes offline
- E2E: `source_type: 'network'` entries appear in cross-catalogue response
- E2E: service summary hash changes when federate flags change
- Playwright: network directory browser shows aggregated services, search/filter works

**Phase 3 tests (federated login):**
- E2E: `POST /v1/federation/auth/verify` succeeds with valid credentials + auth consent
- E2E: verify fails without auth consent (returns `no_federation_consent`)
- E2E: verify fails with wrong password
- E2E: auth consent (`scope: auth`) is distinct from data consent (`scope: federation`)
- E2E: federated JWT has correct claims (`federated`, `homeNode`, `homeUrl`)
- E2E: federated session cannot perform admin/operator actions
- E2E: federated session cannot create agents
- E2E: JWT refresh re-verifies with home node
- E2E: revoking auth consent on home node invalidates future refreshes
- Playwright: login with `user@remote-node` shows federation indicator
- Playwright: access-tab federation access section -- add/remove nodes, wildcard toggle

**Phase 4 tests (cross-node data access):**
- E2E: federated session reads memory from home node via proxy
- E2E: federated session writes memory locally on remote node
- E2E: "Save to home node" routes write to home node
- E2E: data pull copies entry to local node with correct tags
- E2E: pulled data is independent (no auto-sync back)
- E2E: cross-node service invocation charges routing fee + service fee
- Playwright: memory tab shows remote data for federated sessions
- Playwright: "Copy to this node" and "Save to home" actions work

**Multi-node integration tests (new test suite):**
- Spin up 3 test nodes (A=hub, B=contributor, C=contributor)
- Verify: B and C discover each other's federated services through A
- Verify: user on B can invoke service on C, routed through A
- Verify: federated login from B to C works (with auth consent on B's home node)
- Verify: memory with `node:C` consent replicates to C but not A
- Verify: private P2P peer is invisible in network directory
- Verify: full round-trip with routing fees and settlement

## 12. Files Changed (Estimated)

### New Files
| File | Purpose |
|------|---------|
| `src/routes/federation-auth.ts` | Federated login endpoints (verify, refresh) |
| `src/middleware/federation-proxy.ts` | Proxy middleware for routing to home node |
| `public/views/admin/network-directory.js` | Network directory browser component |
| `test/federation-mesh.ts` | E2E: per-peer policy, federate flags, service summary, directory |
| `test/federation-login.ts` | E2E: federated auth verify/refresh, auth consent, JWT claims |
| `test/federation-proxy.ts` | E2E: cross-node data proxy, data pull, save-to-home |
| `test/federation-multinode.ts` | E2E: 3-node integration (hub + 2 contributors, full round-trip) |
| `test/playwright/federation.spec.ts` | Playwright: federation UI (toggles, directory, access tab, login) |

### Modified Files -- Backend
| File | Change |
|------|--------|
| `src/storage/interface.ts` | Add `federate` to ActionRecord, AgentRecord, BoardRecord, StorageFileRecord; add policy fields to FederationPeerRecord |
| `src/storage/providers/sqlite/schema.ts` | New columns on actions, agents, boards, storage_files, federation_peers |
| `src/storage/providers/sqlite/index.ts` | Handle new fields |
| `src/storage/providers/mongodb/index.ts` | Handle new fields |
| `prisma/schema.prisma` | New fields on all affected models |
| `src/routes/federation-peer.ts` | Service summary endpoint; policy checks |
| `src/routes/federation-sync.ts` | Policy enforcement in sync/route handlers |
| `src/routes/federation-genesis.ts` | Extend cross-catalogue with network directory |
| `src/services/federation.ts` | Heartbeat service summary hash comparison |
| `src/routes/ghii.ts` | Federated login path |
| `src/routes/libs.ts` | Frontend federated login flow |
| `src/auth/middleware.ts` | Federated session recognition + restricted permissions |
| `src/auth/jwt.ts` | New JWT claims |
| `src/routes/memory.ts` | Federation proxy for federated sessions |
| `src/routes/actions.ts` | Accept `federate` field on create/update |
| `src/routes/agents.ts` | Accept `federate` field |
| `src/routes/boards.ts` | Accept `federate` field |
| `src/routes/consent.ts` | Support `scope: 'auth'` consent type |
| `src/services/consent.ts` | Add `auth` to valid scope values |
| `src/services/memory-replication.ts` | Per-peer policy check before replicating |

### Modified Files -- Frontend
| File | Change |
|------|---------|
| `public/views/admin/federation-tab.js` | Peer policy toggles, network directory section |
| `public/views/profile/access-tab.js` | New "Federation Access" section with auth consent management |
| `public/views/profile/agents-tab.js` | Federate toggle per agent |
| `public/views/profile/memory-tab.js` | Federation consent badges and quick actions |
| `public/views/profile/data-wallet-tab.js` | Federation + auth consent highlights and quick-share |
| `public/views/profile/boards-tab.js` | Federate toggle |
| `public/views/profile/knowledge-tab.js` | Federate toggle |
| `public/js/services/admin.js` | New API functions for peer policies, directory |
| `public/js/services/auth.js` | Federated session handling |
| `public/views/profile.js` | Federation status indicator |
| `locales/en.json` | New i18n keys |
| `locales/fi.json` | New i18n keys |

### Spec Documents
| File | Change |
|------|--------|
| `openapi.yaml` | New endpoints, updated request/response shapes |
| `CHANGELOG.md` | Version bump with federation mesh features |
