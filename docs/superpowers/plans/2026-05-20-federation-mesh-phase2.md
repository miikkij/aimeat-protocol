# Federation Mesh Phase 2: Network Directory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub nodes aggregate a network-wide service directory from peer summaries, making services discoverable across the mesh. Non-hub nodes query their hub for the directory.

**Architecture:** Each node computes a service summary hash from all its federated items. The heartbeat payload includes this hash. When the hash changes between cycles, the hub fetches the updated summary via a new `GET /v1/federation/service-summary` endpoint. Summaries are stored in-memory (Map keyed by nodeId, no DB table). The existing `GET /v1/federation/cross-catalogue` endpoint is extended with `source_type: 'network'` entries.

**Tech Stack:** TypeScript, Express, SHA-256, Preact + HTM (frontend)

**Spec:** `docs/superpowers/specs/2026-05-20-federation-mesh-network-design.md` -- Section 3.1 (Layer 1: Network Directory), Phase 2 tests.

**Depends on:** Phase 1 completed (federate flags on all record types, per-peer policies).

---

## File Map

| File | Change |
|------|--------|
| `aimeat/src/utils/service-summary.ts` | **New:** Compute service summary from all federated items |
| `aimeat/src/routes/federation-peer.ts` | New `GET /v1/federation/service-summary` endpoint |
| `aimeat/src/services/federation.ts` | Heartbeat sends summary hash; hub fetches summaries on change |
| `aimeat/src/routes/federation-genesis.ts` | Extend cross-catalogue with network directory entries |
| `aimeat/src/server-bootstrap/service-init.ts` | Create network directory Map, pass to routes |
| `aimeat/public/views/admin/federation-tab.js` | Network directory browser section |
| `aimeat/public/js/services/admin.js` | `getNetworkDirectory()` API function |
| `aimeat/locales/en.json` | i18n keys for network directory |
| `aimeat/locales/fi.json` | Same in Finnish |
| `aimeat/test/federation-mesh.ts` | Add network directory tests |

---

## Task 1: Service Summary Utility

**Files:**
- Create: `aimeat/src/utils/service-summary.ts`

- [ ] **Step 1: Create service summary computation module**

This module computes a compact summary of all federated items on this node plus a hash for change detection. It needs access to storage to query actions, agents, boards, CSMs, storage files, and memory entries with federation consent.

```typescript
/**
 * @file service-summary.ts
 * @description Computes a compact summary of all federated items on this node
 *   for the network directory. Used by the heartbeat to detect changes and by
 *   the service-summary endpoint to return the full summary to hub nodes.
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';

export interface ServiceSummary {
  node_id: string;
  summary_hash: string;
  actions: Array<{ id: string; category?: string; display_name: string; price: number; provider_gaii: string }>;
  agents: Array<{ gaii: string; display_name?: string; trust_score: number }>;
  boards: Array<{ id: string; name: string; post_count?: number }>;
  csms: Array<{ name: string; service_type: string }>;
  knowledge: Array<{ key: string; title: string }>;
  files: Array<{ key: string; size_bytes: number }>;
}

export async function computeServiceSummary(config: AimeatConfig, storage: Storage): Promise<ServiceSummary> {
  // Fetch all federated items
  const [actions, agents, boards, csms, files] = await Promise.all([
    storage.listActions().then(a => a.filter(x => x.federate)),
    storage.listAgents().then(a => a.filter(x => x.federate)),
    storage.listBoards().then(b => b.filter(x => x.federate && x.visibility === 'public')),
    storage.listCsms().then(c => c.filter(x => x.federate)),
    storage.listStorageFiles ? storage.listStorageFiles().then(f => f.filter(x => x.federate)) : Promise.resolve([]),
  ]);

  const summary: ServiceSummary = {
    node_id: config.nodeId,
    summary_hash: '',
    actions: actions.map(a => ({
      id: a.id,
      category: a.category,
      display_name: a.displayName,
      price: a.pricing.baseMorsels,
      provider_gaii: a.providerGaii,
    })),
    agents: agents.map(a => ({
      gaii: a.gaii,
      display_name: a.displayName,
      trust_score: a.trustScore,
    })),
    boards: boards.map(b => ({
      id: b.id,
      name: b.name,
    })),
    csms: csms.map(c => ({
      name: c.name,
      service_type: c.serviceType,
    })),
    knowledge: [], // Knowledge uses consent system, populated separately if needed
    files: files.map(f => ({
      key: f.key,
      size_bytes: f.size,
    })),
  };

  // Compute hash from summary content for change detection
  summary.summary_hash = computeSummaryHash(summary);
  return summary;
}

export function computeSummaryHash(summary: Omit<ServiceSummary, 'summary_hash'>): string {
  const entries = [
    ...summary.actions.map(a => `action:${a.id}`),
    ...summary.agents.map(a => `agent:${a.gaii}`),
    ...summary.boards.map(b => `board:${b.id}`),
    ...summary.csms.map(c => `csm:${c.name}`),
    ...summary.files.map(f => `file:${f.key}`),
  ].sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `pnpm typecheck`

Check: `listStorageFiles` may not exist on the Storage interface. If not, check what the correct method name is for listing storage files (it might be a different method or might not exist as a list-all). Grep for `listStorage` or `listFiles` in the storage interface. If no list-all method exists, use an empty array for files (files are per-owner and may not have a global listing).

- [ ] **Step 3: Commit**

```
git add aimeat/src/utils/service-summary.ts
git commit -m "feat(federation): add service summary computation for network directory"
```

---

## Task 2: Service Summary Endpoint

**Files:**
- Modify: `aimeat/src/routes/federation-peer.ts`

- [ ] **Step 1: Add GET /v1/federation/service-summary endpoint**

Add the endpoint after the existing `GET /v1/federation/directory` handler. It should:
- Verify the caller is a known active peer (check `x-source-node` header against peers map, or simply require the request comes from a peer IP -- simplest: check for a `x-source-node` header that matches a known peer nodeId)
- Call `computeServiceSummary(config, storage)` 
- Return the summary in the standard envelope

```typescript
import { computeServiceSummary } from '../utils/service-summary.js';

// GET /v1/federation/service-summary -- return compact catalogue for network directory
router.get('/v1/federation/service-summary', async (req, res) => {
    const sourceNode = req.headers['x-source-node'] as string | undefined;
    if (!sourceNode) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'x-source-node header required'));
        return;
    }
    const peer = [...peers.values()].find(p => p.nodeId === sourceNode && p.status === 'active');
    if (!peer) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
        return;
    }
    if (!peer.shareCatalogue) {
        res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'Catalogue sharing disabled for this peer'));
        return;
    }
    const summary = await computeServiceSummary(config, storage);
    res.json(success(config.nodeId, summary));
});
```

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 3: Network Directory Map + Heartbeat Integration

**Files:**
- Modify: `aimeat/src/services/federation.ts`
- Modify: `aimeat/src/server-bootstrap/service-init.ts`

This is the core of Phase 2: the hub fetches summaries from peers when their service summary hash changes.

- [ ] **Step 1: Add network directory Map to service-init.ts**

In `service-init.ts`, create a Map to store aggregated service summaries:

```typescript
import type { ServiceSummary } from '../utils/service-summary.js';

// Network directory: aggregated service summaries from all peers (hub only)
const networkDirectory = new Map<string, ServiceSummary>();
```

Pass `networkDirectory` to `startHeartbeatJob` and to the federation routes (so the cross-catalogue endpoint can read it).

Update `ServiceInitResult` interface to include `networkDirectory`.

- [ ] **Step 2: Extend heartbeat to include service summary hash and fetch summaries**

In `federation.ts`, modify `startHeartbeatJob` to accept and use the `networkDirectory` Map.

After a successful heartbeat response from a peer:
1. Compute this node's own service summary hash (or use a cached version)
2. Include `service_summary_hash` in the heartbeat stats payload
3. Parse the peer's response to check if it includes a `service_summary_hash`
4. If the peer's hash differs from what we have cached, fetch the full summary:

```typescript
// After successful heartbeat response:
const peerResponse = await resp.json() as { data?: { service_summary_hash?: string } };
const peerSummaryHash = peerResponse?.data?.service_summary_hash;

if (peerSummaryHash && peer.shareCatalogue && peer.peerMode !== 'private') {
    const cachedSummary = networkDirectory.get(peer.nodeId);
    if (!cachedSummary || cachedSummary.summary_hash !== peerSummaryHash) {
        // Fetch updated summary
        try {
            const summaryResp = await fetch(`${peer.url}/v1/federation/service-summary`, {
                headers: { 'x-source-node': config.nodeId },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (summaryResp.ok) {
                const summaryData = await summaryResp.json() as { data?: ServiceSummary };
                if (summaryData.data) {
                    networkDirectory.set(peer.nodeId, summaryData.data);
                    logger.info(`Updated network directory for peer ${peer.nodeId}`);
                }
            }
        } catch {
            logger.warn(`Failed to fetch service summary from peer ${peer.nodeId}`);
        }
    }
}
```

5. Update the ping response handler to include `service_summary_hash` in this node's ping response.

- [ ] **Step 3: Update the ping endpoint to return service_summary_hash**

In `federation-peer.ts`, the `POST /v1/federation/ping` handler returns `{ pong: true, node_id, timestamp }`. Add `service_summary_hash` to the response. This requires computing it (cache it to avoid recomputing every ping):

```typescript
import { computeServiceSummary } from '../utils/service-summary.js';

// Cache the summary hash (recomputed when catalogue changes)
let cachedSummaryHash = '';
let summaryHashExpiry = 0;

// In ping handler:
if (Date.now() > summaryHashExpiry) {
    const summary = await computeServiceSummary(config, storage);
    cachedSummaryHash = summary.summary_hash;
    summaryHashExpiry = Date.now() + 60_000; // cache for 1 minute
}

res.json(success(config.nodeId, {
    pong: true,
    node_id: config.nodeId,
    timestamp: new Date().toISOString(),
    service_summary_hash: cachedSummaryHash,
}));
```

- [ ] **Step 4: Clean up stale directory entries**

In the heartbeat cycle, when a peer goes offline or is de-peered, remove it from the networkDirectory:

```typescript
// In de-peering cleanup:
networkDirectory.delete(key);

// In failure escalation when peer becomes offline:
if (failures >= 10) {
    networkDirectory.delete(key);
}
```

- [ ] **Step 5: Run typecheck**
- [ ] **Step 6: Commit**

---

## Task 4: Extend Cross-Catalogue with Network Directory

**Files:**
- Modify: `aimeat/src/routes/federation-genesis.ts`

- [ ] **Step 1: Pass networkDirectory to the genesis router**

The `federationGenesisRouter` function signature needs to accept the `networkDirectory` Map. Update the barrel router in `federation.ts` to pass it through.

Check how the genesis router is created in `federation.ts` (the barrel) and in `server.ts`. The `networkDirectory` needs to be passed from `service-init.ts` through the router chain.

- [ ] **Step 2: Add network directory entries to cross-catalogue response**

In the `GET /v1/federation/cross-catalogue` handler, add a fourth source after the existing three (local CSMs, federated actions, genesis entries):

```typescript
// Source 4: Network directory entries (from hub's aggregated summaries)
if (!sourceFilter || sourceFilter === 'network') {
    for (const [nodeId, summary] of networkDirectory) {
        for (const action of summary.actions) {
            if (serviceType && action.category !== serviceType) continue;
            if (keyword && !action.display_name.toLowerCase().includes(keyword.toLowerCase())) continue;
            entries.push({
                type: 'action',
                id: action.id,
                name: action.display_name,
                category: action.category,
                source_node: nodeId,
                source_type: 'network',
                price: action.price,
                provider_gaii: action.provider_gaii,
            });
        }
        for (const agent of summary.agents) {
            if (keyword && !(agent.display_name || '').toLowerCase().includes(keyword.toLowerCase())) continue;
            entries.push({
                type: 'agent',
                id: agent.gaii,
                name: agent.display_name || agent.gaii,
                source_node: nodeId,
                source_type: 'network',
                trust_score: agent.trust_score,
            });
        }
        for (const board of summary.boards) {
            if (keyword && !board.name.toLowerCase().includes(keyword.toLowerCase())) continue;
            entries.push({
                type: 'board',
                id: board.id,
                name: board.name,
                source_node: nodeId,
                source_type: 'network',
            });
        }
        for (const csm of summary.csms) {
            if (serviceType && csm.service_type !== serviceType) continue;
            if (keyword && !csm.name.toLowerCase().includes(keyword.toLowerCase())) continue;
            entries.push({
                type: 'csm',
                id: csm.name,
                name: csm.name,
                service_type: csm.service_type,
                source_node: nodeId,
                source_type: 'network',
            });
        }
    }
}
```

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit**

---

## Task 5: Admin UI -- Network Directory Browser

**Files:**
- Modify: `aimeat/public/views/admin/federation-tab.js`
- Modify: `aimeat/public/js/services/admin.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add API function for cross-catalogue**

In `admin.js`, add:
```javascript
export const getNetworkDirectory = (keyword) => apiGet(`/v1/federation/cross-catalogue${keyword ? '?keyword=' + encodeURIComponent(keyword) + '&source=network' : '?source=network'}`);
```

- [ ] **Step 2: Add i18n keys**

Dashboard section in both locale files:
```json
"fedNetworkDirectoryTitle": "Network Directory",
"fedNetworkDirectoryDesc": "Services and data available across the federation network.",
"fedNetworkDirType": "Type",
"fedNetworkDirName": "Name",
"fedNetworkDirNode": "Node",
"fedNetworkDirCategory": "Category",
"fedNetworkDirPrice": "Price",
"fedNetworkDirEmpty": "No federated services discovered yet. Services appear when peers share their catalogue.",
"fedNetworkDirSearch": "Search services..."
```

Finnish translations:
```json
"fedNetworkDirectoryTitle": "Verkkohakemisto",
"fedNetworkDirectoryDesc": "Palvelut ja data saatavilla federaatioverkossa.",
"fedNetworkDirType": "Tyyppi",
"fedNetworkDirName": "Nimi",
"fedNetworkDirNode": "Solmu",
"fedNetworkDirCategory": "Kategoria",
"fedNetworkDirPrice": "Hinta",
"fedNetworkDirEmpty": "Federoituja palveluita ei vielä löydetty. Palvelut näkyvät kun vertaissolmut jakavat kataloginsa.",
"fedNetworkDirSearch": "Hae palveluita..."
```

- [ ] **Step 3: Add Network Directory section to federation tab**

In `federation-tab.js`, add a new section after the Stats Overview. It should:
- Fetch network directory entries from the cross-catalogue endpoint (source=network)
- Show a search input
- Render a table with columns: Type, Name, Node, Category, Price
- Show `Empty` component when no entries
- Use `Badge` component for type column (action/agent/board/csm)

The section loads data from `data.networkDirectory` or fetches it on mount. Since the admin dashboard loads data in phases, add `getNetworkDirectory()` to one of the loading phases.

Alternatively, the network directory can be a standalone section that fetches its own data via `useEffect` and `useState`, independent of the main data loading. This keeps it self-contained.

- [ ] **Step 4: Commit**

---

## Task 6: E2E Tests for Network Directory

**Files:**
- Modify: `aimeat/test/federation-mesh.ts`

- [ ] **Step 1: Add service summary tests**

Add tests after the existing federate flag tests:

```typescript
console.log('\nNetwork Directory');

await test('GET /v1/federation/service-summary -- requires x-source-node header', async () => {
    const { status } = await json('/v1/federation/service-summary');
    assert(status === 400, `expected 400, got ${status}`);
});

await test('GET /v1/federation/service-summary -- returns summary with federated items', async () => {
    // The peer we added earlier needs to be active for auth
    // Use operator JWT to set peer status to active
    await json(`/v1/federation/peers/${fakePeerNodeId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ status: 'active' }),
    });

    const { status, body } = await json('/v1/federation/service-summary', {
        headers: { 'x-source-node': fakePeerNodeId },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.node_id, 'has node_id');
    assert(typeof body.data.summary_hash === 'string', 'has summary_hash');
    assert(Array.isArray(body.data.actions), 'has actions array');
    assert(Array.isArray(body.data.agents), 'has agents array');
    assert(Array.isArray(body.data.boards), 'has boards array');
});

await test('service summary includes only federated actions', async () => {
    const { body } = await json('/v1/federation/service-summary', {
        headers: { 'x-source-node': fakePeerNodeId },
    });
    // federatedActionId was created with federate=true, unfederatedActionId without
    const fedAction = body.data.actions.find((a: any) => a.id === federatedActionId);
    const nonFedAction = body.data.actions.find((a: any) => a.id === unfederatedActionId);
    assert(fedAction, 'federated action present in summary');
    assert(!nonFedAction, 'non-federated action excluded from summary');
});

await test('GET /v1/federation/cross-catalogue -- includes network source type', async () => {
    const { status, body } = await json('/v1/federation/cross-catalogue?source=network', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.entries), 'has entries array');
    // Network entries come from aggregated peer summaries (may be empty if no hub aggregation happened)
});
```

- [ ] **Step 2: Add ping response summary hash test**

```typescript
await test('POST /v1/federation/ping -- response includes service_summary_hash', async () => {
    const { status, body } = await json('/v1/federation/ping', {
        method: 'POST',
        body: JSON.stringify({ from_node: fakePeerNodeId }),
    });
    assert(status === 200, `status ${status}`);
    assert(typeof body.data.service_summary_hash === 'string', 'ping response has service_summary_hash');
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:e2e:federation-mesh`
Expected: All tests pass

- [ ] **Step 4: Commit**

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck and lint**

Run: `pnpm typecheck`

- [ ] **Step 2: Run full E2E suite**

Run: `pnpm test:e2e`
Expected: No regressions

- [ ] **Step 3: Run federation mesh tests**

Run: `pnpm test:e2e:federation-mesh`
Expected: All pass (old Phase 1 tests + new Phase 2 tests)

- [ ] **Step 4: Commit any remaining changes**
