# Federation Data Sync — Analysis, Target State & Implementation Plan

**Date:** 2026-03-07  
**Status:** Draft  
**Scope:** Intra-federation sync (peer nodes) + Cross-federation sync (genesis peering)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target State (RFC v1.5 Requirements)](#3-target-state)
4. [Gap Analysis](#4-gap-analysis)
5. [Implementation Plan](#5-implementation-plan)
6. [Risk Assessment](#6-risk-assessment)
7. [Design Decisions (Resolved)](#7-design-decisions-resolved)
8. [RFC v1.5 Coverage Analysis](#8-rfc-v15-coverage-analysis)

---

## 1. Executive Summary

The AIMEAT federation system has a well-defined protocol specification (RFC v1.5 §13) and a solid foundation of **receive-side endpoints** and **on-demand cross-node operations**. However, the **proactive outbound sync** layer — the code that actually pushes data between nodes on a schedule — is largely missing or stubbed.

**What works today:**
- Heartbeat pings (5-min interval)
- On-demand cross-node routing, work forwarding, and GAII resolution
- Apps pull with `include_peers=true` fan-out
- Receive endpoints for replication and catalogue sync (accept + store incoming data)
- Genesis peer CRUD and approval lifecycle

**What is stubbed or missing:**
- No outbound memory replication (nobody calls `POST /v1/federation/replicate` on peers)
- No outbound catalogue sync push (nobody calls `POST /v1/federation/catalogue-sync` on peers)
- Genesis sync only updates local metadata (SHA-256 hash), no actual data exchange
- No conflict resolution (LWW) for replicated memory
- No peering config enforcement (`share_agents`, `share_catalogue`, etc.)
- No catalogue hash-based incremental sync
- No key exchange on peering activation
- No trust advisory broadcast

The gap is not architectural — the protocol design is sound. The gap is **plumbing**: the scheduled jobs and outbound HTTP calls that make data flow between nodes.

---

## 2. Current State Analysis

### 2.1 Heartbeat (WORKING)

**File:** `src/services/federation.ts` → `startHeartbeatJob()`

| Aspect | Status | Details |
|--------|--------|---------|
| Outbound ping | ✅ Working | POST to peer `/v1/federation/ping` every 5 minutes |
| Status tracking | ✅ Working | healthy → degraded (3 misses) → unreachable (6 misses) |
| Peer iteration | ✅ Working | Iterates all active federation peers |
| Catalogue hash in payload | ❌ Missing | Spec requires `stats.catalogue_hash` in heartbeat payload |
| Signature | ❌ Missing | Spec requires Ed25519 node signature on heartbeat |

### 2.2 Genesis Sync (STUB)

**File:** `src/services/genesis-sync.ts` → `startGenesisSyncJob()`

| Aspect | Status | Details |
|--------|--------|---------|
| Scheduled job | ✅ Working | Runs every `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` (default 6h) |
| Catalogue hash computation | ✅ Working | SHA-256 of sorted CSM names |
| Metadata update | ✅ Working | Updates `lastSyncAt` + `catalogueHash` on peer record |
| Outbound HTTP to peers | ❌ Missing | No actual fetch/push of CSM records to/from peers |
| CSM filtering by `federate` flag | ❌ Missing | No filtering — hash includes all CSMs regardless |
| Peer catalogue download | ❌ Missing | No code to GET peer's catalogue and store locally |
| Stale entry purging | ❌ Missing | No cleanup of entries from suspended/removed peers |

### 2.3 Receive-Side Endpoints (IMPLEMENTED, UNTRIGGERED)

These endpoints accept incoming data from peers but nobody calls them outbound:

| Endpoint | File | Status | Details |
|----------|------|--------|---------|
| `POST /v1/federation/replicate` | `federation.ts` | ✅ Implemented | Stores with `replica:{nodeId}:{key}` prefix. Requires Ed25519 signature verification. |
| `POST /v1/federation/catalogue-sync` | `federation.ts` | ✅ Implemented | Upserts catalogue entries with `federated:{nodeId}` tag. Requires signature. |
| `POST /v1/federation/key-exchange` | `federation.ts` | ✅ Implemented | Updates peer public key, returns local node capabilities. |
| `POST /v1/federation/trust-advisory` | `federation.ts` | ✅ Implemented | Receives advisory, can auto-depeer on `ban` severity. |
| `POST /v1/federation/heartbeat` | `federation.ts` | ✅ Implemented | Ack heartbeat, return next expected time. |

### 2.4 On-Demand Cross-Node Operations (WORKING)

These work correctly when a specific request triggers them:

| Operation | Endpoint | Status | Details |
|-----------|----------|--------|---------|
| Route/relay | `POST /v1/federation/route` | ✅ Working | Multi-hop forwarding with SSRF protection, 1 morsel/hop |
| Cross-node work | `POST /v1/work` with target node | ✅ Working | Signed work requests forwarded to peer |
| GAII resolution | `GET /v1/federation/resolve/:gaii` | ✅ Working | Broadcasts to peers with 5s timeout |
| Apps pull | `GET /v1/apps?include_peers=true` | ✅ Working | Parallel fan-out to all active peers |
| Settlement | `POST /v1/federation/settle` | ✅ Working | Ed25519 signed, replay protection via tracking codes |

### 2.5 Storage Layer

**File:** `src/storage/interface.ts` → `FederationRepository`

The storage layer has **18 methods** covering:
- Peering request CRUD (create, get, list, update status)
- Personal node registration and listing
- Mailbox operations (store, retrieve, delete cross-node messages)
- Genesis peer CRUD (create, get, list, update, delete)
- Peer metadata updates (lastSyncAt, catalogueHash, status)

All storage methods are implemented in both memory and database backends.

### 2.6 Configuration

| Variable | Default | Implemented | Used |
|----------|---------|-------------|------|
| `AIMEAT_CROSS_FEDERATION_ENABLED` | `false` | ✅ | ⚠️ Only guards genesis sync job start |
| `AIMEAT_MAX_GENESIS_PEERS` | `10` | ✅ | ✅ |
| `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` | `6` | ✅ | ✅ |
| `AIMEAT_FEDERATION_CACHE_TTL_HOURS` | `24` | ✅ | ❌ Not enforced |
| `AIMEAT_FEDERATION_TIMEOUT_MS` | `10000` | ✅ | ❌ Not used in outbound calls |

---

## 3. Target State

Based on RFC v1.5 §13, §16, and the cross-federation design document, the target state requires:

### 3.1 Memory Replication

**RFC §13.6 requirements:**

1. **Outbound push:** Node identifies memory entries eligible for replication (public visibility + consent grants matching peer) and POSTs them to peer's `/v1/federation/replicate` endpoint
2. **Prefix-based storage:** Replicated entries stored as `replica:{sourceNode}:{key}`
3. **Consent-based filtering:** Only entries where `visibility: 'public'` AND consent scope includes `federation` are replicated
4. **Conflict resolution (LWW):** When same key arrives from multiple sources, last-write-wins by timestamp. Losing version saved as `{key}._conflict_{timestamp}` with 7-day TTL
5. **Agent notification:** Agent notified of conflicts for manual resolution
6. **Purge on de-peering:** All `replica:{nodeId}:*` entries purged after grace period

### 3.2 Catalogue Synchronization

**RFC §13.5–§13.6 requirements:**

1. **On activation:** When peering activates (Phase 5), both nodes exchange complete catalogues filtered by `peering_config`
2. **Scheduled incremental sync:** Heartbeat includes `catalogue_hash` → if hash differs from cached, trigger full catalogue pull
3. **CSM `federate` flag:** Only CSM records with `federate: true` are shared
4. **Selective sharing:** Peering config controls what's shared: `share_agents`, `share_actions`, `share_catalogue`, `share_board_posts`
5. **Prefixed storage:** Federated catalogue entries stored as `federated:{sourceNode}:{entryId}`
6. **Grace period on de-peering:** Entries marked `expiring:{nodeId}` for 72 hours, then purged
7. **Cross-catalogue query:** `GET /v1/federation/cross-catalogue` aggregates local + peer catalogues

### 3.3 Heartbeat Enhancements

1. **Signed heartbeats:** Ed25519 node signature on every heartbeat payload
2. **Catalogue hash in stats:** `stats.catalogue_hash` field for change detection
3. **Active agent/action counts:** `stats.agents_active`, `stats.actions_published`
4. **Uptime reporting:** `stats.uptime_hours`
5. **Trigger re-sync on recovery:** When peer returns from `unreachable` to `active`, catalogue re-sync is triggered

### 3.4 Key Exchange

1. **On peering activation:** Both nodes exchange node-level public keys and all agent public keys
2. **Cache TTL:** Agent keys cached with 5-minute TTL (configurable)
3. **Auto-refresh on heartbeat recovery:** Keys refreshed when peer comes back online

### 3.5 Trust Advisory Broadcast

1. **Outbound broadcast:** When operator issues a trust advisory, it's signed with node key and POSTed to all active peers
2. **Severity levels:** `warning`, `critical`, `revoked`
3. **Evidence payload:** Failed heartbeats, dispute rate, last successful interaction
4. **Non-binding:** Receiving operators decide independently whether to act

### 3.6 Genesis Cross-Federation Sync

1. **CSM-only replication:** Only catalogue entries (NOT memory) flow between genesis peers
2. **Organism reputations:** Reputation scores synced in schema.org `Rating` format
3. **Interest profile matching:** Anonymized profile statistics shared for cross-federation matching
4. **Trust advisories propagated:** Informational only across genesis boundaries
5. **Composite IDs:** `{sourceGenesisNode}:{entryId}` for cross-federation provenance

### 3.7 Settlement & Fee Distribution

1. **Network fee split:** Provider 40%, requester node 20%, relay 20%, registry 20%
2. **Burn rate:** Configurable (default 10%) of network fee removed from circulation
3. **Multi-hop cost:** 1 morsel per relay hop

---

## 4. Gap Analysis

### 4.1 Critical Gaps (Federation Fundamentally Incomplete Without These)

| ID | Gap | Current | Required | Effort |
|----|-----|---------|----------|--------|
| G-01 | **No outbound catalogue sync** | Genesis sync computes hash only | Push/pull catalogue entries to/from peers | Large |
| G-02 | **No outbound memory replication** | Receive endpoint exists, nothing calls it | Scheduled + event-driven push of eligible memories | Large |
| G-03 | **No heartbeat signature** | Unsigned ping | Ed25519 signed heartbeat payload | Small |
| G-04 | **No catalogue hash in heartbeat** | Not included | `stats.catalogue_hash` for change detection | Small |
| G-05 | **No key exchange on activation** | Endpoint exists, never called | Call `/v1/federation/key-exchange` when peering activates | Medium |

### 4.2 Important Gaps (Federation Works Without, But Degrades)

| ID | Gap | Current | Required | Effort |
|----|-----|---------|----------|--------|
| G-06 | **No peering config enforcement** | Config stored but ignored | Filter shared data by `share_agents`, `share_catalogue`, etc. | Medium |
| G-07 | **No conflict resolution (LWW)** | Not implemented | Timestamp-based LWW with conflict preservation | Medium |
| G-08 | **No cache TTL enforcement** | TTL config exists, not checked | Purge stale federated entries after TTL expires | Small |
| G-09 | **No re-sync on heartbeat recovery** | Peer status tracked | Trigger catalogue sync when peer recovers from unreachable | Small |
| G-10 | **No trust advisory broadcast** | Receive works, no outbound | POST advisory to all active peers on operator action | Small |
| G-11 | **No grace period enforcement** | De-peering is immediate | 72-hour `expiring:` prefix, then purge | Medium |
| G-12 | **No catalogue for `/v1/catalogue`** | Only `/v1/apps?include_peers` has peer support | `GET /v1/catalogue` should include federated entries | Small |

### 4.3 Enhancement Gaps (Nice-to-Have)

| ID | Gap | Current | Required | Effort |
|----|-----|---------|----------|--------|
| G-13 | Relay node type | Not implemented | Stateless relay with cached-key validation | Large |
| G-14 | Mirror node type | Not implemented | Read-only replica nodes | Large |
| G-15 | Cross-federation matching | Not implemented | Anonymized profile exchange between genesis peers | Large |
| G-16 | Organism reputation sync | Not implemented | Reputation scores synced between genesis peers | Medium |
| G-17 | Performance tuning | No benchmarks | Test with >10 peers, tune timeouts/batch sizes | Medium |

---

## 5. Implementation Plan

### Phase A: Foundation (Heartbeat & Key Exchange Enhancements)

**Goal:** Make the existing heartbeat loop federation-aware and establish trust infrastructure.

**Duration estimate:** —

#### A.1 — Signed Heartbeats (G-03)

**File:** `src/services/federation.ts`

- Sign heartbeat payload with node's Ed25519 private key (from `process.env.AIMEAT_PRIVATE_KEY`)
- Include signature in heartbeat POST body
- Verify incoming heartbeat signatures against cached peer public keys

```typescript
// Outbound heartbeat enhancement
const payload = {
  node_id: config.nodeId,
  timestamp: new Date().toISOString(),
  version: 'v1',
  stats: {
    agents_active: await storage.agent.count(),
    actions_published: await storage.action.count(),
    uptime_hours: process.uptime() / 3600,
    catalogue_hash: await computeCatalogueHash(storage),
  },
};
const signature = await sign(JSON.stringify(payload), privateKey);
await fetch(peer.url + '/v1/federation/heartbeat', {
  method: 'POST',
  body: JSON.stringify({ ...payload, signature }),
});
```

#### A.2 — Catalogue Hash in Heartbeat (G-04)

**File:** `src/services/federation.ts`, `src/services/genesis-sync.ts`

- Extract `computeCatalogueHash()` from genesis-sync.ts into a shared utility
- Include hash in heartbeat stats payload
- Receiving side compares hash against last known → flag for re-sync if different

#### A.3 — Key Exchange on Peering Activation (G-05)

**File:** `src/routes/federation.ts` (peering activation handler)

- After peering moves to `active` status, call peer's `POST /v1/federation/key-exchange`
- Store returned agent public keys in local cache with TTL
- Return own node key + agent keys in response
- Add auto-refresh on heartbeat recovery (G-09)

#### A.4 — Heartbeat Recovery Re-Sync Trigger (G-09)

**File:** `src/services/federation.ts`

- When peer status transitions from `unreachable` → `active`, trigger:
  1. Key exchange refresh
  2. Full catalogue sync

---

### Phase B: Catalogue Synchronization (The Core Data Flow)

**Goal:** Implement the actual push/pull of catalogue entries between federation peers.

**Dependencies:** Phase A (signed heartbeats, key exchange)

#### B.1 — Outbound Catalogue Sync Service

**New file:** `src/services/catalogue-sync.ts`

Create a service that:
1. Iterates all active federation peers
2. For each peer, reads local CSM records where `federate: true`
3. Filters by peering config (`share_agents`, `share_actions`, `share_catalogue`)
4. Signs the payload with node Ed25519 key
5. POSTs to peer's `POST /v1/federation/catalogue-sync`
6. Stores returned success/failure per peer

```typescript
export async function syncCatalogueToPeer(
  peer: FederationPeerRecord,
  config: AimeatConfig,
  storage: Storage
): Promise<SyncResult> {
  const csms = await storage.csm.list({ federate: true });
  const actions = await storage.action.listByCsms(csms.map(c => c.id));
  
  // Filter by peering config
  const filtered = applyPeeringConfigFilter(actions, peer.peeringConfig);
  
  // Sign payload
  const payload = { source_node: config.nodeId, entries: filtered, timestamp: new Date().toISOString() };
  const signature = await sign(JSON.stringify(payload), config.privateKey);
  
  // Push to peer
  const res = await fetch(peer.url + '/v1/federation/catalogue-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(config.federationTimeoutMs),
  });
  
  return { peerId: peer.id, success: res.ok, syncedAt: new Date() };
}
```

#### B.2 — Diff-Based Incremental Sync (Decision 7.1)

**File:** `src/services/catalogue-sync.ts`

- Track `lastSyncAt` per peer — only send entries with `updatedAt > lastSyncAt`
- Include `catalogue_hash` for verification: receiver applies delta then verifies hash matches
- If hash mismatch after delta: receiver requests full sync (fallback)
- Include deleted entries (with `deleted: true`) for 72 hours so peers can purge
- Update peer's `catalogueHash` + `lastSyncAt` metadata after successful sync

#### B.3 — Peering Config Enforcement (G-06)

**File:** `src/services/catalogue-sync.ts`

- Read `peer.peeringConfig` for each sync target
- Filter outbound data by: `share_agents`, `share_actions`, `share_catalogue`, `share_board_posts`
- Reject incoming data that violates local peering config

#### B.4 — Federated Catalogue in Query Endpoints (G-12)

**File:** `src/routes/catalogue.ts`

- `GET /v1/catalogue` should include entries with `federated:{nodeId}` tag
- Add `include_federated=true|false` query parameter (default: true)
- Return `source_node` field in federated entries

#### B.5 — Sync Mode Integration (Decision 7.5)

**File:** `src/services/federation.ts` or `src/services/catalogue-sync.ts`

Three configurable modes (`AIMEAT_SYNC_MODE`):
- **`bulk`:** Scheduled only — every `AIMEAT_SYNC_INTERVAL_HOURS` (default 6h). Best for unreliable connections.
- **`instant`:** Event-driven — push on every change (batched by 5s window). Best for good connectivity.
- **`hybrid`** (default): Event-driven with scheduled fallback. Changes pushed instantly; scheduled bulk sync catches anything missed.

All modes also trigger sync on: peering activation (Phase 5), heartbeat hash mismatch detection, and peer recovery from unreachable.

---

### Phase C: Memory Replication

**Goal:** Implement consent-based memory replication between federation peers.

**Dependencies:** Phase B (catalogue sync as template), Phase A (key exchange for verification)

#### C.1 — Memory Replication Service

**New file:** `src/services/memory-replication.ts`

1. Query memory records where:
   - `visibility: 'public'` AND
   - Consent grants match the target peer's node pattern AND
   - CSM allows `visibility_default: 'federation'`
2. Sign payload with node key
3. POST to peer's `/v1/federation/replicate`
4. Track replication state per entry (last synced timestamp)

#### C.2 — Conflict Resolution (G-07)

**File:** `src/routes/federation.ts` (replicate handler)

Implement LWW (Last Write Wins) in the receive handler:
1. On incoming replication, check if `replica:{sourceNode}:{key}` already exists
2. Compare timestamps: newer wins
3. Save losing version as `{key}._conflict_{timestamp}` with 7-day TTL
4. Notify affected agent via mailbox

#### C.3 — Event-Driven Replication with Persistent Queue (Decision 7.3)

Instead of purely scheduled sync:
- When a memory entry is created/updated with `visibility: 'public'` + federation consent, immediately queue it for replication
- **Storage-backed queue** (survives restarts) via new `ReplicationQueue` in storage interface
- Queue rules: max 10,000 entries (`AIMEAT_REPLICATION_QUEUE_MAX`), max 72h age (`AIMEAT_REPLICATION_QUEUE_TTL_HOURS`)
- FIFO batch drain: up to 100 entries per peer per cycle
- On overflow: oldest entries dropped with warning log
- Batch window: 5 seconds (`AIMEAT_SYNC_BATCH_DELAY_MS`) — aggregate changes before pushing

#### C.4 — Purge on De-Peering (G-11)

**File:** `src/routes/federation.ts` (de-peering handler)

1. On de-peer request, mark all `replica:{nodeId}:*` and `federated:{nodeId}:*` entries as `expiring:{nodeId}:*`
2. Start 72-hour grace period timer (configurable `AIMEAT_DEPEERING_GRACE_PERIOD_HOURS`)
3. After grace period, purge all `expiring:{nodeId}:*` entries
4. Remove peer's cached public keys

---

### Phase D: Trust & Advisory System

**Goal:** Enable trust information flow between peers.

**Dependencies:** Phase A (signed messages)

#### D.1 — Trust Advisory Broadcast (G-10)

**File:** `src/routes/admin.ts` or new `src/services/trust-broadcast.ts`

- When operator creates a trust advisory (via admin dashboard), sign it with node key
- POST to all active federation peers' `/v1/federation/trust-advisory`
- Log delivery status per peer

#### D.2 — Trust Advisory UI

**File:** `public/views/admin/federation-tab.js`

- Show received trust advisories in the federation dashboard
- Allow operator to act on advisory (de-peer, ignore, acknowledge)
- Show outbound advisory form for operator to issue warnings about a peer

---

### Phase E: Genesis Cross-Federation Sync

**Goal:** Enable data flow between separate AIMEAT networks via genesis peering.

**Dependencies:** Phase B (catalogue sync logic reusable), Phase A (trust infrastructure)

#### E.1 — Genesis Catalogue Exchange

**File:** `src/services/genesis-sync.ts` (replace current stub)

1. For each active genesis peer:
   - Fetch peer's federable CSM records via `GET /v1/federation/cross-catalogue`
   - Store with `genesis:{genesisNodeId}:{entryId}` prefix
   - Expose in local catalogue queries with `source_genesis` field
2. Push local federable CSMs to peer's sync endpoint
3. Update `lastSyncAt` + `catalogueHash` on genesis peer record

#### E.2 — Organism Reputation Sync (G-16)

- Fetch peer's published organism reputations
- Cache with TTL (`AIMEAT_FEDERATION_CACHE_TTL_HOURS`)
- Display in local organism directory with provenance tag

#### E.3 — Cross-Federation Catalogue Endpoint Enhancement

**File:** `src/routes/federation.ts`

- `GET /v1/federation/cross-catalogue` should aggregate:
  - Local federable catalogue entries
  - Cached entries from federation peers (prefixed `federated:`)
  - Cached entries from genesis peers (prefixed `genesis:`)
- Support filtering by service type, location, keywords

---

### Phase F: Route Manifest & Relay Fee Settlement

**Goal:** Enable relay nodes to prove and claim their share of network fees. (Decision 7.6)

**Dependencies:** Phase A (signed messages)

#### F.1 — Route Manifest Data Structure

**File:** `src/routes/federation.ts` (route handler)

- Add `route_manifest` field to cross-node work requests
- Each relay hop appends a signed `RouteHop` entry containing: node_id, received_at, forwarded_to, signature
- Signature chain: each hop signs over (its data + previous hop's signature) → tamper-proof chain of custody

#### F.2 — Settlement with Relay Distribution

**File:** `src/services/morsel.ts` or settlement handler

- Settlement endpoint verifies route manifest signature chain
- Distributes fees per manifest: 40% provider, 20% requester node, 20% split among relay nodes, 20% registry
- If no relays: relay's 20% split between provider (10%) and requester (10%)
- Route manifests stored with work record for audit trail

---

### Phase G: Cache TTL & Cleanup

**Goal:** Enforce staleness rules and prevent unbounded cache growth.

#### G.1 — TTL Enforcement (G-08)

**New file or addition to:** `src/services/cache-cleanup.ts`

- Scheduled job (runs hourly)
- Scans all `federated:*`, `replica:*`, `genesis:*` prefixed entries
- Removes entries older than `AIMEAT_FEDERATION_CACHE_TTL_HOURS`
- Removes `_conflict_*` entries older than 7 days

#### G.2 — Storage Cleanup on Peer Removal

- When a peer is fully removed (after grace period):
  - Purge all `federated:{nodeId}:*` catalogue entries
  - Purge all `replica:{nodeId}:*` memory entries
  - Remove peer's public keys from cache
  - Log cleanup action for audit

---

## 6. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Data consistency** — LWW may lose important updates | Medium | Medium | Conflict preservation with TTL + agent notifications |
| **Bandwidth explosion** — Full catalogue sync on every hash mismatch | High | Medium | Incremental sync (diff-based) in Phase B.2; batch compression |
| **Security** — Unsigned data accepted as federated | High | Low | All sync endpoints already require Ed25519 signatures (Phase A completes this) |
| **Storage growth** — Unbounded federated cache | Medium | High | Phase F cache cleanup + TTL enforcement |
| **Cascading failures** — Peer unreachable during sync blocks job | Medium | Medium | Timeout per peer (`AIMEAT_FEDERATION_TIMEOUT_MS`), skip and retry next cycle |
| **Clock skew** — LWW depends on timestamps | Medium | Low | Use ISO-8601 with timezone; document requirement for NTP sync |
| **Privacy leak** — Memories replicated without consent | Critical | Low | Consent check is mandatory filter before replication (Phase C.1 step 1) |

---

## 7. Design Decisions (Resolved)

### 7.1 Incremental Diff-Based Catalogue Sync

**Decision:** Only sync changed entries, not full catalogue replacement.

**Mechanism:** Each catalogue entry and CSM record has a `updatedAt` timestamp. Sync uses a `since` parameter:

```
POST /v1/federation/catalogue-sync
{
  "source_node": "aimeat-finland-001",
  "since": "2026-03-07T10:00:00Z",    // Only entries changed after this
  "entries": [ ... ],                   // Delta only
  "catalogue_hash": "abc123...",        // Full hash for verification
  "signature": "Ed25519_sig(...)"
}
```

- First sync (peering activation): `since` is omitted → full exchange
- Subsequent syncs: `since` = last successful sync timestamp
- Hash is sent for verification: if receiver computes different hash after applying delta, request full sync
- Delete operations: entries with `deleted: true` + `deletedAt` timestamp are included in delta for 72 hours, then excluded

### 7.2 Memory Replication: Push + Pull

**Decision:** Push is the default. Pull is supported for initial sync and recovery.

- **Push (primary):** Origin node POSTs eligible memories to peer's `/v1/federation/replicate` on change events
- **Pull (recovery):** When a peer comes back from `unreachable`, it can `GET /v1/federation/replicate?since=<lastSyncAt>` to catch up on missed updates
- This covers both real-time and recovery scenarios

### 7.3 Event Queue: Storage-Backed with Rules

**Decision:** Persistent event queue that survives restarts, with size and age limits.

**Rules:**
- Queue backed by storage layer (new `ReplicationQueue` in storage interface)
- Maximum queue size: configurable `AIMEAT_REPLICATION_QUEUE_MAX` (default: 10,000 entries)
- Maximum age: configurable `AIMEAT_REPLICATION_QUEUE_TTL_HOURS` (default: 72 hours)
- FIFO processing with batch drain (send up to 100 entries per peer per cycle)
- On queue overflow: oldest entries dropped with warning log
- On restart: queue is intact, processing resumes from last checkpoint

### 7.4 Cross-Genesis Memory: Routed Access, Not Copied

**Decision:** Genesis peers do NOT copy each other's memories. Instead, they **route queries** — similar to Usenet/newsgroup propagation.

**How it works:**
- Agent on Node A searches for memory → doesn't find it locally
- Query is forwarded to genesis peers via `POST /v1/federation/route` with `target_scope: 'genesis'`
- Genesis peer B searches its local federation → returns results (or forwards further)
- Results returned to Agent A with `source_node` metadata
- Data is NOT cached/copied — each access is a live routed query
- **Optional copy mode:** Operators can configure `AIMEAT_GENESIS_MEMORY_CACHE: true` to cache routed memory results locally with TTL. Requires consent verification. Suitable for high-latency or unreliable connections.
- Specific memory sections can be subscribed to (like newsgroup subscriptions) via peering config:
  ```json
  {
    "subscribe_memory_prefixes": ["public:announcements:", "shared:moderation:"],
    "memory_access_mode": "route" | "cache"
  }
  ```

### 7.5 Sync Frequency: Configurable with Event-Driven Option

**Decision:** Three sync modes, operator-configurable per peer:

| Mode | When | Best For |
|------|------|----------|
| **Scheduled bulk** | Every `AIMEAT_GENESIS_SYNC_INTERVAL_HOURS` (default 6h) | Unreliable/slow connections, cost-conscious operators |
| **Event-driven instant** | On every catalogue/memory change | Good connectivity, real-time requirements |
| **Hybrid** (default) | Event-driven with scheduled fallback | Balanced — instant when connected, bulk catch-up on recovery |

Configuration:
```ini
AIMEAT_SYNC_MODE=hybrid          # bulk | instant | hybrid
AIMEAT_SYNC_INTERVAL_HOURS=6    # Scheduled fallback interval
AIMEAT_SYNC_BATCH_DELAY_MS=5000 # Event batching window (instant/hybrid mode)
```

In hybrid mode: changes are batched for 5 seconds, then pushed. If push fails, entry stays in queue for next scheduled bulk sync.

### 7.6 Multi-Hop Relay Fee Tracking

**Decision:** Adopt a **route manifest** approach inspired by Lightning Network's HTLC forwarding, adapted for AIMEAT's morsel economy.

**Problem:** When a work request traverses Node A → Node B (relay) → Node C (provider), Node B relays the request and deserves 20% of the network fee. But how does Node B prove it relayed and claim its share?

**Solution: Signed Route Manifest**

Each relay hop appends a signed entry to a `route_manifest` array that travels with the work request:

```typescript
interface RouteManifest {
  hops: RouteHop[];
}

interface RouteHop {
  node_id: string;           // Node that handled this hop
  received_at: string;       // ISO timestamp
  forwarded_to: string;      // Next node in chain
  signature: string;         // Ed25519 sig of (node_id + received_at + forwarded_to + prev_hop_signature)
}
```

**Flow:**
1. **Origin (Node A):** Creates work request with `route_manifest: { hops: [] }` and escrows morsels
2. **Relay (Node B):** Validates request, appends signed hop entry, deducts 1 morsel relay fee from escrow, forwards to Node C
3. **Provider (Node C):** Completes work, includes `route_manifest` in settlement request
4. **Settlement:** Origin node (A) verifies all hop signatures in the manifest chain, distributes fees:
   - Each relay node listed in manifest gets 20% of network fee (split evenly if multiple relays)
   - Provider gets 40%, requester node 20%, registry 20%
   - If no relays: relay's 20% is split between provider and requester node

**Verification:** Each hop's signature includes the previous hop's signature, creating a **chain of custody** that cannot be forged or reordered. The origin node verifies the full chain at settlement time.

**Storage:** Route manifests are stored with the work record for audit. Relay fee claims are settled as part of the normal settlement flow via `POST /v1/federation/settle`.

### 7.7 Federation Self-Balancing (No Hard Peer Limit)

**Decision:** No `max_federation_peers` cap. Instead, the network self-balances using adaptive techniques.

**Problem:** Hard peer limits are arbitrary and don't account for node capacity differences. A powerful cloud node can handle 100 peers; a Raspberry Pi can handle 5.

**Solution: Adaptive Load Management**

Three mechanisms work together to prevent overload:

#### A. Jittered Sync Scheduling (Thundering Herd Prevention)

All scheduled sync operations use randomized jitter to prevent synchronized bursts:

```typescript
function scheduleNextSync(baseIntervalMs: number): number {
  // Add ±25% random jitter to prevent all peers syncing at the same time
  const jitter = baseIntervalMs * 0.25 * (Math.random() * 2 - 1);
  return baseIntervalMs + jitter;
}
```

Heartbeats are staggered: each peer gets a random offset within the 5-minute window so they don't all fire simultaneously.

#### B. Backpressure-Based Throttling

Node monitors its own resource usage and throttles sync operations:

```typescript
interface SyncHealth {
  pending_queue_size: number;      // Current replication queue depth
  avg_sync_duration_ms: number;    // Rolling average of sync time per peer
  failed_syncs_last_hour: number;  // Error rate
  cpu_load: number;                // OS-level (process.cpuUsage())
}
```

**Rules:**
- If `pending_queue_size > 5000`: double sync interval temporarily
- If `avg_sync_duration_ms > federationTimeoutMs * 0.8`: reduce concurrent syncs
- If `failed_syncs_last_hour > 50%` of total peers: pause non-critical syncs for 15 minutes (exponential backoff)
- If `cpu_load > 80%`: defer catalogue sync, prioritize heartbeats only

#### C. Peer Priority Scoring

Not all peers are equal. Sync priority is assigned dynamically:

```typescript
function peerSyncPriority(peer: FederationPeer): number {
  let score = 50; // Base score
  
  // Recently active peers get priority
  if (peer.lastHeartbeat > Date.now() - 10 * 60 * 1000) score += 20;
  
  // Peers with hash mismatch (stale data) get priority
  if (peer.catalogueHash !== localCatalogueHash) score += 30;
  
  // Peers recovering from unreachable get priority (re-sync needed)
  if (peer.previousStatus === 'unreachable' && peer.status === 'active') score += 40;
  
  // Peers with many failed syncs get deprioritized
  score -= peer.consecutiveFailures * 10;
  
  return Math.max(0, Math.min(100, score));
}
```

**Effect:** High-priority peers are synced first. Under load, low-priority peers are deferred to the next cycle. The system naturally sheds load by deferring healthy/up-to-date peers while prioritizing stale/recovering ones.

#### D. Concurrent Sync Limit

Instead of a hard peer limit, limit **concurrent outbound sync operations**:

```ini
AIMEAT_MAX_CONCURRENT_SYNCS=5    # Max parallel outbound sync operations
```

If a node has 50 peers but can only run 5 syncs at a time, it processes them in priority order across multiple cycles. This naturally scales: fast nodes drain the queue quickly, slow nodes take longer but never overload.

---

## 8. RFC v1.5 Coverage Analysis

### What RFC v1.5 Covers Well

| Topic | Status | Notes |
|-------|--------|-------|
| Peering lifecycle (5 phases) | ✅ Complete | Discovery → Readiness → Request → Approval → Activation |
| Heartbeat protocol | ✅ Complete | Payload, status transitions, timing |
| Memory replication format | ✅ Complete | Prefix, consent, LWW conflict resolution |
| Key exchange | ✅ Complete | Node + agent keys, TTL, refresh |
| Trust advisory | ✅ Complete | Format, severity levels, non-transitive |
| Genesis peering | ✅ Complete | Multi-network discovery, catalogue aggregation |
| Settlement fee split | ✅ Complete | 40/20/20/20% distribution |
| OpenAPI schemas | ✅ Complete | 18+ endpoints with full request/response schemas |

### What RFC v1.5 Leaves Underspecified

| Topic | Gap | Impact |
|-------|-----|--------|
| **Incremental sync semantics** | `since_timestamp` and `catalogue_hash` fields exist in schema but no protocol for delta-only exchange | Implementations will diverge |
| **Outbound sync triggering** | "Who calls whom when" is undefined — heartbeat detects staleness, but nothing specifies the push protocol | No interoperability without this |
| **Event queue / reliability** | No mention of message queues, retry logic, or delivery guarantees | Data loss on network partitions |
| **Adaptive load management** | No anti-thundering-herd measures, no backpressure, no priority | Large networks will collapse |
| **Multi-hop fee claiming** | Fee split defined, but no mechanism for relay nodes to prove and claim their share | Relay operators have no incentive |
| **Cross-genesis memory access** | Only catalogue crosses genesis boundary — no spec for routed memory queries | Feature ambiguity |
| **Sync mode configuration** | No option for bulk-vs-instant-vs-hybrid | Inflexible for different network conditions |

### Verdict: RFC v1.6 Needed?

**Yes, a targeted RFC v1.6 addendum is recommended** covering:

1. **§13.7 — Sync Protocol Specification** (NEW section)
   - Delta-based catalogue sync protocol (since + hash verification)
   - Event-driven vs. scheduled sync modes
   - Replication queue requirements and delivery guarantees
   - Adaptive load management (jitter, backpressure, peer priority)
   - Concurrent sync limits

2. **§13.8 — Route Manifest & Relay Fee Settlement** (NEW section)
   - Signed route manifest chain-of-custody
   - Per-hop fee deduction
   - Settlement verification flow

3. **§13.9 — Cross-Genesis Memory Routing** (EXPAND existing §13.10)
   - Routed access vs. cached access modes
   - Memory prefix subscription
   - Consent requirements for cross-genesis queries

4. **§16.3 — Adaptive Network Economics** (NEW section)
   - Self-balancing sync scheduling
   - Resource-based throttling rules
   - Peer priority scoring

These additions don't change the architecture — they fill in the operational details needed for interoperable implementations.

---

## Appendix A: Implementation Priority Matrix

| Phase | Priority | Reason |
|-------|----------|--------|
| **Phase A** (Heartbeat + Keys) | **P0 — Must Have** | Foundation for all other sync. Without signed heartbeats and key exchange, nothing else is trustworthy. |
| **Phase B** (Catalogue Sync) | **P0 — Must Have** | The core value proposition of federation. Nodes that can't share catalogues aren't really federated. |
| **Phase C** (Memory Replication) | **P1 — Should Have** | Important for data resiliency and cross-node agent collaboration, but federation works without it at basic level. |
| **Phase D** (Trust Advisory) | **P1 — Should Have** | Important for network health, but manual operator communication works short-term. |
| **Phase E** (Genesis Sync) | **P2 — Nice to Have** | Only matters when multiple separate AIMEAT networks exist. Can wait until there are actual genesis peers. |
| **Phase F** (Route Manifest & Relay Fees) | **P1 — Should Have** | Relay operators need incentive to participate. Without this, multi-hop routing has no economic model. |
| **Phase G** (Cache Cleanup) | **P1 — Should Have** | Without this, storage grows unbounded. Should ship with or shortly after Phase B. |

## Appendix B: Files to Create or Modify

| File | Action | Phase |
|------|--------|-------|
| `src/services/federation.ts` | Modify — enhance heartbeat with signature + catalogue hash + recovery trigger + jittered scheduling + backpressure throttling | A, B |
| `src/services/genesis-sync.ts` | Modify — extract hash utility; later replace stub with real sync | A, E |
| `src/services/catalogue-sync.ts` | **Create** — outbound diff-based catalogue sync service with priority scoring | B |
| `src/services/memory-replication.ts` | **Create** — consent-based memory replication service with persistent queue | C |
| `src/services/trust-broadcast.ts` | **Create** — trust advisory broadcast service | D |
| `src/services/cache-cleanup.ts` | **Create** — TTL enforcement + stale entry purge | G |
| `src/services/sync-health.ts` | **Create** — backpressure monitoring + peer priority scoring + adaptive throttling | B |
| `src/routes/federation.ts` | Modify — LWW conflict resolution in replicate handler + grace period on de-peer + route manifest handling | C, F |
| `src/routes/catalogue.ts` | Modify — include federated entries in catalogue queries | B |
| `src/storage/interface.ts` | Modify — add `ReplicationQueue` interface + route manifest storage | B, C, F |
| `src/storage/memory.ts` | Modify — implement new storage methods | B, C, F |
| `public/views/admin/federation-tab.js` | Modify — trust advisory UI + sync status indicators + sync health dashboard | D |

## Appendix C: Relevant Spec References

| Topic | Spec Location |
|-------|---------------|
| Federation peering lifecycle | RFC v1.5 §13.5 |
| Memory replication protocol | RFC v1.5 §13.6 |
| Catalogue sync & hash detection | RFC v1.5 §13.3, §13.6 |
| Heartbeat payload & status | RFC v1.5 §13.5 |
| Trust advisory format | RFC v1.5 §13.5 |
| Key exchange flow | RFC v1.5 §13.5 (Phase 5: Activation) |
| Settlement fee distribution | RFC v1.5 §16.2 |
| Cross-federation (genesis) | RFC v1.5 §3.4 |
| DMZ visibility zones | `docs/aimeat-dmz-architecture.md` |
| Cross-federation design | `docs/aimeat-cross-federation.md` |
| Advanced federation plan | `docs/plans/phase-3.4-advanced-federation.md` |
