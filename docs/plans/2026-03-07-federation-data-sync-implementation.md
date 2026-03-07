# Federation Data Sync — Implementation Plan

**Date:** 2026-03-07  
**Status:** Draft  
**Companion:** [2026-03-07-federation-data-sync-analysis.md](2026-03-07-federation-data-sync-analysis.md) (analysis & design decisions)  
**Spec:** [AIMEAT-RFC-v1.6-full.md](../../docs/AIMEAT-RFC-v1.6-full.md) (protocol specification)

---

## Overview

This plan implements RFC v1.6 (Federation Sync & Adaptive Network Operations) on top of the existing v1.5 codebase. Work is organized into 7 phases (A–G) with clear dependencies, file changes, and acceptance criteria.

**Current state:** Receive endpoints exist, heartbeat works, nothing pushes outbound.  
**Target state:** Full bidirectional data sync with adaptive load management.

---

## Phase Dependencies

```
Phase A (Foundation)
  ├──► Phase B (Catalogue Sync)
  │     ├──► Phase C (Memory Replication)
  │     └──► Phase G (Cache Cleanup)
  ├──► Phase D (Trust Advisory)
  ├──► Phase F (Route Manifest)
  └──► Phase E (Genesis Sync) ←── Phase B
```

---

## Phase A: Foundation — Heartbeat & Key Exchange

**Goal:** Signed heartbeats, catalogue hash detection, key exchange on activation, recovery triggers.  
**RFC sections:** §13.11.6 (sync triggering), §32.6.2 (jittered scheduling)  
**Priority:** P0 — Must Have

### A.1 — Extract Shared Catalogue Hash Utility

**Modify:** `src/services/genesis-sync.ts`  
**Create:** `src/utils/catalogue-hash.ts`

- Extract `computeCatalogueHash()` from genesis-sync.ts into standalone utility
- Hash algorithm per RFC v1.6 §13.11.3: `SHA-256( sort( entries.map(e => e.id + ':' + e.updatedAt) ).join('\n') )`
- Filter: only entries from CSMs with `federate: true`
- Export for use in heartbeat + catalogue-sync services

**Acceptance criteria:**
- [ ] `computeCatalogueHash(storage)` returns consistent SHA-256 hex string
- [ ] Hash changes when a federable CSM or action is updated
- [ ] Hash ignores non-federable entries
- [ ] genesis-sync.ts uses the shared utility (no duplication)

### A.2 — Signed Heartbeat Enhancement

**Modify:** `src/services/federation.ts` → `startHeartbeatJob()`

- Sign heartbeat payload with node Ed25519 private key
- Include `stats.catalogue_hash` from shared utility (A.1)
- Include `stats.agents_active`, `stats.actions_published`, `stats.uptime_hours`
- Apply jittered scheduling per §32.6.2: ±25% random offset per cycle
- Apply peer-specific stagger: `SHA-256(localNodeId + peerNodeId) mod interval`

**Acceptance criteria:**
- [ ] Heartbeat payload includes `signature` field (Ed25519)
- [ ] Heartbeat payload includes `stats.catalogue_hash`
- [ ] Heartbeat timing varies by ±25% between cycles (not fixed 5min)
- [ ] Different peers receive heartbeats at staggered times

### A.3 — Key Exchange on Peering Activation

**Modify:** `src/routes/federation.ts` → peer activation handler

- After peering status → `active`, call peer's `POST /v1/federation/key-exchange`
- Store returned agent public keys in memory with configurable TTL (default: 5 min)
- Return own node key + agent keys in activation response

**Acceptance criteria:**
- [ ] Activating a peer triggers outbound key exchange call
- [ ] Peer's agent public keys stored with TTL
- [ ] Keys are refreshable (re-call on heartbeat recovery)

### A.4 — Heartbeat Recovery Re-Sync Trigger

**Modify:** `src/services/federation.ts` → heartbeat status transition logic

- When peer status transitions `unreachable` → `active`:
  1. Trigger key exchange (A.3)
  2. Queue full catalogue sync (implemented in Phase B, stub the call for now)
- Log recovery event

**Acceptance criteria:**
- [ ] Status transition from unreachable to active triggers key exchange
- [ ] Recovery event logged at info level
- [ ] Full sync trigger point exists (callable when Phase B is ready)

### A.5 — New Config Variables

**Modify:** `src/config.ts`, `src/cli/init-wizard.ts`, `.env.example`

Add to AimeatConfig:
```typescript
syncMode: 'bulk' | 'instant' | 'hybrid';  // AIMEAT_SYNC_MODE, default: 'hybrid'
syncIntervalHours: number;                  // AIMEAT_SYNC_INTERVAL_HOURS, default: 6
syncBatchDelayMs: number;                   // AIMEAT_SYNC_BATCH_DELAY_MS, default: 5000
replicationQueueMax: number;                // AIMEAT_REPLICATION_QUEUE_MAX, default: 10000
replicationQueueTtlHours: number;           // AIMEAT_REPLICATION_QUEUE_TTL_HOURS, default: 72
maxConcurrentSyncs: number;                 // AIMEAT_MAX_CONCURRENT_SYNCS, default: 5
genesisMemoryCache: boolean;                // AIMEAT_GENESIS_MEMORY_CACHE, default: false
genesisMemoryCacheTtlHours: number;         // AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS, default: 4
```

**Acceptance criteria:**
- [ ] All 8 new config variables defined with defaults
- [ ] `aimeat config` displays them
- [ ] `.env.example` updated
- [ ] `npx tsc --noEmit` passes

### Verification

```bash
cd aimeat
npx tsc --noEmit
# Start server, peer two local instances, verify:
# - Heartbeat includes signature + catalogue_hash
# - Key exchange fires on peer activation
# - Recovery from unreachable triggers key exchange
```

---

## Phase B: Catalogue Synchronization

**Goal:** Outbound diff-based catalogue push/pull with peering config enforcement.  
**RFC sections:** §13.11.3 (delta sync), §13.11.6 (triggering), §32.6.4 (peer priority)  
**Priority:** P0 — Must Have  
**Depends on:** Phase A

### B.1 — Replication Queue (Storage Layer)

**Modify:** `src/storage/interface.ts`  
**Modify:** `src/storage/memory.ts`

Add `ReplicationQueue` interface:
```typescript
interface ReplicationQueueEntry {
  id: string;
  type: 'catalogue_sync' | 'memory_replicate';
  targetPeers: string[];
  payload: unknown;
  createdAt: Date;
  attempts: number;
  lastAttemptAt: Date | null;
  status: 'pending' | 'sent' | 'failed';
}

interface ReplicationQueue {
  enqueue(entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string>;
  dequeue(peerId: string, limit: number): Promise<ReplicationQueueEntry[]>;
  markSent(ids: string[]): Promise<void>;
  markFailed(ids: string[]): Promise<void>;
  prune(maxAge: Date): Promise<number>;
  size(): Promise<number>;
}
```

**Acceptance criteria:**
- [ ] Queue entries persist across restarts (storage-backed)
- [ ] `dequeue()` returns FIFO order, limited to batch size
- [ ] `prune()` removes entries older than TTL
- [ ] Queue respects max size (drops oldest on overflow with log)

### B.2 — Catalogue Sync Service

**Create:** `src/services/catalogue-sync.ts`

Core function: `syncCatalogueToPeer(peer, config, storage)`
1. Read local CSMs where `federate: true`
2. Filter by peering config (share_agents, share_actions, share_catalogue)
3. If `lastSyncAt` exists for peer: only include entries with `updatedAt > lastSyncAt`
4. Compute catalogue hash for verification
5. Sign payload with node Ed25519 key
6. POST to peer's `/v1/federation/catalogue-sync`
7. Handle response: check `resync_required`, update peer metadata
8. Use `AbortSignal.timeout(config.federationTimeoutMs)` for request timeout

**Acceptance criteria:**
- [ ] First sync sends all entries (no `since` parameter)
- [ ] Subsequent syncs send only changed entries
- [ ] Hash mismatch triggers full re-sync
- [ ] Deleted entries included for 72 hours
- [ ] Peering config filters applied correctly

### B.3 — Sync Health & Peer Priority

**Create:** `src/services/sync-health.ts`

- Monitor: queue depth, avg sync duration, failure rate, CPU load
- Peer priority scoring per §32.6.4
- Throttling rules per §32.6.3
- Expose metrics via function (for admin endpoint)

**Acceptance criteria:**
- [ ] Peers sorted by priority score before sync
- [ ] Throttling activates when thresholds exceeded
- [ ] Throttling deactivates when conditions clear
- [ ] Metrics queryable

### B.4 — Sync Scheduler Integration

**Modify:** `src/services/federation.ts` or create `src/services/sync-scheduler.ts`

- Implement sync mode logic (bulk/instant/hybrid)
- In `hybrid`/`instant`: on CSM change event, enqueue to replication queue
- In all modes: scheduled interval fires full sync (with jitter)
- Concurrent sync limit: process top N peers by priority in parallel
- On heartbeat hash mismatch: queue delta sync for that peer

**Acceptance criteria:**
- [ ] `bulk` mode: only scheduled syncs fire
- [ ] `instant` mode: CSM changes trigger immediate batch (5s window)
- [ ] `hybrid` mode: both work, scheduled catches missed
- [ ] Concurrent sync limit respected

### B.5 — Federated Catalogue in Query Endpoints

**Modify:** `src/routes/catalogue.ts`

- `GET /v1/catalogue` includes `federated:{nodeId}:*` entries
- Add `include_federated=true|false` query param (default: true)
- Return `source_node` field on federated entries

**Acceptance criteria:**
- [ ] Federated entries appear in catalogue queries
- [ ] `include_federated=false` hides them
- [ ] Source node provenance visible

### Verification

```bash
npx tsc --noEmit
# Two-node test:
# 1. Create CSM with federate:true on Node A
# 2. Verify it appears in Node B's catalogue after sync
# 3. Update CSM on Node A
# 4. Verify only the delta is sent on next sync
# 5. Delete CSM on Node A
# 6. Verify Node B removes it after 72h propagation
```

---

## Phase C: Memory Replication

**Goal:** Consent-based memory replication with LWW conflict resolution and persistent queue.  
**RFC sections:** §13.11.4 (replication protocol), §13.11.5 (queue)  
**Priority:** P1 — Should Have  
**Depends on:** Phase A, Phase B (queue infrastructure)

### C.1 — Memory Replication Service

**Create:** `src/services/memory-replication.ts`

1. Query eligible memories: `visibility: 'public'` + consent scope `federation`
2. Verify consent active for each entry
3. Include `consent_ref` per §13.11.4
4. Sign and POST to peer's `/v1/federation/replicate`
5. Track per-entry replication state (lastSyncAt per key per peer)

**Acceptance criteria:**
- [ ] Only public + federation-consented entries replicated
- [ ] Consent verification before each replication
- [ ] Consent revocation triggers purge request to peers

### C.2 — LWW Conflict Resolution

**Modify:** `src/routes/federation.ts` → replicate handler

1. On incoming: check if `replica:{sourceNode}:{key}` exists
2. Compare `updatedAt` timestamps: newer wins
3. Losing version → `{key}._conflict_{timestamp}` with 7-day TTL
4. Notify affected agent via mailbox

**Acceptance criteria:**
- [ ] Newer timestamp always wins
- [ ] Conflict version preserved for 7 days
- [ ] Agent receives mailbox notification of conflict

### C.3 — Event-Driven Queue Integration

**Modify:** `src/routes/memory.ts` (or wherever memory write occurs)

- On memory create/update: check if eligible for federation replication
- If yes: enqueue to ReplicationQueue (from B.1)
- Queue drainage uses same sync health / priority infrastructure (B.3)

**Acceptance criteria:**
- [ ] Memory writes auto-enqueue when eligible
- [ ] Non-eligible writes (private, no consent) do NOT enqueue
- [ ] Queue survives restart

### C.4 — De-Peering Grace Period

**Modify:** `src/routes/federation.ts` → de-peering handler

1. On de-peer: rename `replica:{nodeId}:*` → `expiring:{nodeId}:*`
2. Rename `federated:{nodeId}:*` → `expiring:{nodeId}:*`
3. Schedule purge after `AIMEAT_DEPEERING_GRACE_PERIOD_HOURS` (default: 72)
4. Remove peer keys from cache

**Acceptance criteria:**
- [ ] Entries not immediately deleted (grace period)
- [ ] After grace period: all `expiring:*` entries purged
- [ ] Peer keys removed from cache

### Verification

```bash
npx tsc --noEmit
# Test: create memory with public visibility + federation consent
# Verify it replicates to peer
# Create conflict (update same key from two sources)
# Verify LWW resolution + conflict preserved
# De-peer and verify grace period
```

---

## Phase D: Trust Advisory System

**Goal:** Outbound trust advisory broadcast with admin UI.  
**RFC sections:** v1.5 §13.5 (trust advisory format)  
**Priority:** P1 — Should Have  
**Depends on:** Phase A

### D.1 — Trust Advisory Broadcast Service

**Create:** `src/services/trust-broadcast.ts`

- `broadcastTrustAdvisory(advisory, config, storage)` function
- Sign advisory with node Ed25519 key
- POST to all active federation peers' `/v1/federation/trust-advisory`
- Log delivery status per peer (success/fail)

**Acceptance criteria:**
- [ ] Advisory signed with node key
- [ ] Sent to all active peers
- [ ] Delivery status logged

### D.2 — Admin Endpoint

**Modify:** `src/routes/admin.ts`

- `POST /v1/admin/federation/trust-advisory` — operator creates + broadcasts advisory
- `GET /v1/admin/federation/trust-advisories` — list received advisories

**Acceptance criteria:**
- [ ] Operator can issue advisory via admin API
- [ ] Received advisories queryable

### D.3 — Federation Tab UI

**Modify:** `public/views/admin/federation-tab.js`

- Show received trust advisories section
- Action buttons: acknowledge, de-peer, ignore
- Form to issue new advisory (select peer, severity, reason)
- i18n keys added to en.json and fi.json

**Acceptance criteria:**
- [ ] Advisories visible in dashboard
- [ ] Operator can act on received advisories
- [ ] Operator can issue new advisories

### Verification

```bash
npx tsc --noEmit
pnpm build
# Issue advisory from Node A admin dashboard
# Verify Node B receives and displays it
```

---

## Phase E: Genesis Cross-Federation Sync

**Goal:** Replace genesis-sync stub with real catalogue exchange + routed memory access.  
**RFC sections:** §13.13 (cross-genesis memory routing)  
**Priority:** P2 — Nice to Have  
**Depends on:** Phase A, Phase B

### E.1 — Genesis Catalogue Exchange

**Modify:** `src/services/genesis-sync.ts` → replace stub

1. For each active genesis peer:
   - GET peer's catalogue via `/v1/federation/cross-catalogue`
   - Store with `genesis:{genesisNodeId}:{entryId}` prefix
   - Remove stale entries no longer in peer's catalogue
2. Push local federable CSMs to peer
3. Update peer metadata (lastSyncAt, catalogueHash)

### E.2 — Cross-Genesis Memory Routing

**Modify:** `src/routes/federation.ts`

- Extend route handler: when `target_scope: 'genesis'`, forward to genesis peers
- Aggregate responses with `source_genesis` provenance
- Respect `max_relay_hops` from peering config
- Optional caching via `AIMEAT_GENESIS_MEMORY_CACHE`

### E.3 — Memory Prefix Subscriptions

**Modify:** `src/services/genesis-sync.ts`

- Read `subscribe_memory_prefixes` from genesis peer config
- For subscribed prefixes: include matching memory entries in sync pushes
- Receiving side stores with `genesis-sub:{genesisNodeId}:{key}` prefix

### E.4 — Cross-Catalogue Enhancement

**Modify:** `src/routes/federation.ts`

- `GET /v1/federation/cross-catalogue` aggregates local + `federated:*` + `genesis:*` entries
- Filtering by service type, location, keywords

### Verification

```bash
npx tsc --noEmit
# Multi-node test across genesis boundaries
# Verify catalogue exchange
# Verify routed memory query
# Verify prefix subscriptions
```

---

## Phase F: Route Manifest & Relay Fee Settlement

**Goal:** Enable relay nodes to prove forwarding and claim fee share.  
**RFC sections:** §13.12 (route manifest)  
**Priority:** P1 — Should Have  
**Depends on:** Phase A

### F.1 — Route Manifest Data Structure

**Create:** `src/types/route-manifest.ts`

```typescript
export interface RouteHop {
  node_id: string;
  received_at: string;
  forwarded_to: string | null;
  signature: string;
}

export interface RouteManifest {
  origin: string;
  hops: RouteHop[];
}
```

### F.2 — Relay Hop Signing

**Modify:** `src/routes/federation.ts` → route handler

- On relay: validate incoming, deduct 1 morsel, append signed hop, forward
- Signature: `sign(node_id + '|' + received_at + '|' + forwarded_to + '|' + prev_signature)`
- Reject if escrow insufficient (402 INSUFFICIENT_RELAY_ESCROW)

### F.3 — Settlement Verification

**Modify:** `src/routes/federation.ts` or `src/services/morsel.ts`

- On settlement: verify full route manifest signature chain
- Check chain contiguity (forwarded_to[N] == node_id[N+1])
- Distribute fees per §13.12.4

### F.4 — Relay Earnings Endpoint

**Modify:** `src/routes/admin.ts`

- `GET /v1/admin/federation/relay-earnings?since=&until=`
- Query settled work records with route manifests
- Aggregate earnings by peer

### Verification

```bash
npx tsc --noEmit
# Three-node test: A → B (relay) → C (provider)
# Verify route manifest signed correctly
# Verify settlement distributes to B
# Verify relay earnings endpoint
```

---

## Phase G: Cache TTL & Cleanup

**Goal:** Prevent unbounded storage growth from federated data.  
**Priority:** P1 — Should Have  
**Depends on:** Phase B (federated data to clean up)

### G.1 — Cleanup Service

**Create:** `src/services/cache-cleanup.ts`

Scheduled job (hourly):
- Scan `federated:*` entries → remove older than `AIMEAT_FEDERATION_CACHE_TTL_HOURS`
- Scan `replica:*` entries → remove older than cache TTL
- Scan `genesis:*` entries → remove older than cache TTL
- Scan `*._conflict_*` entries → remove older than 7 days
- Scan `expiring:*` entries → remove if grace period elapsed
- Log cleanup counts

### G.2 — Peer Removal Cleanup

**Modify:** `src/routes/federation.ts` → de-peer handler (extends C.4)

- After grace period: final purge of all `expiring:{nodeId}:*`
- Remove peer from key cache
- Log audit event

### Verification

```bash
npx tsc --noEmit
# Insert federated entries with old timestamps
# Run cleanup
# Verify entries removed
# Verify recent entries preserved
```

---

## Cross-Cutting Concerns

### i18n

New keys needed for Phases D and admin sync health display:

| Key Prefix | Phase | Approximate Count |
|------------|-------|-------------------|
| `fedTrust*` | D | ~15 keys |
| `fedSync*` | B (admin dashboard) | ~10 keys |
| `fedRelay*` | F (admin dashboard) | ~8 keys |

Add to both `locales/en.json` and `locales/fi.json`.

### Storage Backends

All storage changes (ReplicationQueue, route manifest storage) must be implemented in:
- `src/storage/memory.ts` (in-memory, for dev/test)
- `src/storage/prisma.ts` (SQLite/PostgreSQL, for production)

### Testing

Each phase should be verified with:
1. `npx tsc --noEmit` — type checking
2. Manual two-node or three-node local testing
3. Add relevant test cases to `test/e2e-full.ts` for regression

### OpenAPI

Update `openapi.yaml` for:
- New admin endpoints (relay-earnings, sync-health, trust-advisories)
- Updated `catalogue-sync` request schema (add `since`, `operation` fields)
- New `replicate` GET endpoint for pull-recovery

---

## Implementation Order (Recommended)

```
Week 1:  A.5 (config) → A.1 (hash utility) → A.2 (signed heartbeat)
Week 2:  A.3 (key exchange) → A.4 (recovery trigger)
Week 3:  B.1 (replication queue) → B.3 (sync health)
Week 4:  B.2 (catalogue sync service) → B.4 (scheduler)
Week 5:  B.5 (catalogue query) → G.1 (cleanup)
Week 6:  D.1 (trust broadcast) → D.2 (admin endpoint) → D.3 (UI)
Week 7:  F.1 (data types) → F.2 (relay signing) → F.3 (settlement)
Week 8:  C.1 (memory replication) → C.2 (LWW)
Week 9:  C.3 (event queue) → C.4 (grace period)
Week 10: E.1 (genesis catalogue) → E.2 (routed memory)
Week 11: E.3 (subscriptions) → E.4 (cross-catalogue) → F.4 (earnings)
Week 12: Integration testing, edge cases, documentation
```

---

## Definition of Done

The federation data sync implementation is complete when:

- [ ] Two nodes can exchange catalogues bidirectionally via delta sync
- [ ] Heartbeats are signed and include catalogue hash
- [ ] Key exchange fires on peering activation and recovery
- [ ] Sync modes (bulk/instant/hybrid) work as specified
- [ ] Replication queue survives restarts
- [ ] Memory replication respects consent and handles conflicts (LWW)
- [ ] Trust advisories can be issued and received via dashboard
- [ ] Route manifests track relay hops with verifiable signatures
- [ ] Settlement distributes fees to relay nodes correctly
- [ ] Cache cleanup prevents unbounded storage growth
- [ ] Adaptive load management prevents thundering herd
- [ ] All new config variables documented in `.env.example`
- [ ] `npx tsc --noEmit` passes cleanly
- [ ] E2E tests cover the critical paths
