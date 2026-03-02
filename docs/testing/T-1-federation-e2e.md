# T-1: Federation E2E Tests

**Gap:** No E2E tests exercise actual cross-node communication. Federation tests only check peering request lifecycle (local state), not actual inter-node routing.

**Priority:** Medium

**File:** `test/e2e-federation.ts`

## Scope

Test the full federation lifecycle including peering approval, activation, data replication, catalogue sync, de-peering, and trust advisory — all against a single node simulating peer interactions.

## Prerequisites

- Server running on `:40251`
- Operator admin password set (for peering approval, de-peering)

## Test Phases

### Phase 1 — Peering Lifecycle

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 1 | Submit peering request | POST | `/v1/federation/peer/request` | 201, returns `request_id` |
| 2 | Check request status (pending) | GET | `/v1/federation/peer/request/:id/status` | `status: 'pending'` |
| 3 | Admin lists pending requests | GET | `/v1/admin/peering/requests` | Array contains the pending request |
| 4 | Admin approves request | PUT | `/v1/admin/peering/requests/:id` | `{ action: 'approve' }` → 200 |
| 5 | Check request status (approved) | GET | `/v1/federation/peer/request/:id/status` | `status: 'approved'` |
| 6 | Activate peering | POST | `/v1/federation/peer/activate` | 200, peering now active |
| 7 | Admin rejects a second request | PUT | `/v1/admin/peering/requests/:id` | `{ action: 'reject' }` → 200 |

### Phase 2 — Peer Management

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 8 | Register peer manually | POST | `/v1/federation/peers` | 201 with peer record |
| 9 | List peers | GET | `/v1/federation/peers` | Contains registered peer |
| 10 | Update peer info | PUT | `/v1/federation/peers/:nodeId` | 200, fields updated |
| 11 | Heartbeat | POST | `/v1/federation/heartbeat` | 200, `last_seen` updated |

### Phase 3 — Data Replication & Catalogue Sync

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 12 | Replicate memory entry | POST | `/v1/federation/replicate` | 200, stored with `replica:` prefix |
| 13 | Catalogue sync (full) | POST | `/v1/federation/catalogue-sync` | 200, returns actions/agents/boards |
| 14 | Catalogue sync (incremental) | POST | `/v1/federation/catalogue-sync` | `since_timestamp` → only new items |

### Phase 4 — De-peering

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 15 | Normal de-peering (grace period) | DELETE | `/v1/federation/peers/:nodeId` | 200, `grace_period_hours` in response |
| 16 | Emergency de-peering | DELETE | `/v1/federation/peers/:nodeId?emergency=true` | 200, immediate removal, in-flight escrow returned |

### Phase 5 — Federation Ping & Trust Advisory

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 17 | Ping endpoint | POST | `/v1/federation/ping` | 200 with node identity |
| 18 | Trust advisory (suspend agent) | POST | `/v1/federation/trust-advisory` | 200, peer notified (or logged) |

### Phase 6 — Error Paths

| # | Test | Assert |
|---|------|--------|
| 19 | Activate non-existent peering | 404 |
| 20 | De-peer unknown node | 404 |
| 21 | Replicate without peer auth | 401/403 |
| 22 | Catalogue sync without peer auth | 401/403 |

## Cross-Node Simulation Note

True multi-node federation (routing work across nodes, forwarding requests) requires two server instances. This can be deferred to a docker-compose-based integration test:

```yaml
# docker-compose.test.yml
services:
  node-a:
    build: .
    environment:
      AIMEAT_NODE_ID: aimeat-test-node-a
      AIMEAT_PORT: 40251
  node-b:
    build: .
    environment:
      AIMEAT_NODE_ID: aimeat-test-node-b
      AIMEAT_PORT: 3118
```

The single-node E2E tests above cover the API contract; multi-node routing is a separate integration concern.

## Cleanup

Cascade-delete all test owners at the end.
