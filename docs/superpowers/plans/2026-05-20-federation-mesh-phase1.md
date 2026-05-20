# Federation Mesh Phase 1: Per-Peer Policy + Federate Flags

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-peer policy flags (shareCatalogue, replicateMemory, allowRouting, peerMode) to federation peer connections, and add `federate` boolean to all catalogue record types so users control what's visible across the federation.

**Architecture:** Extend `FederationPeerRecord` with 4 policy fields. Add `federate?: boolean` to `ActionRecord`, `AgentRecord`, `BoardRecord`, `StorageFileRecord`. Enforce policies at existing sync/route/replication code paths. Add UI toggles in admin federation tab (peer policies) and profile tabs (federate per item).

**Tech Stack:** TypeScript, Express, SQLite (better-sqlite3), MongoDB (Prisma), Preact + HTM (frontend)

**Spec:** `docs/superpowers/specs/2026-05-20-federation-mesh-network-design.md` -- Sections 3.2 (Layer 2), 4, 7, and Phase 1 tests.

**Phases:** This is Phase 1 of 4. Phases 2 (network directory), 3 (federated login), 4 (cross-node data access) have separate plans.

---

## File Map

### Storage Layer
| File | Change |
|------|--------|
| `aimeat/src/storage/interface.ts` | Add 4 policy fields to `FederationPeerRecord`; add `federate?: boolean` to `ActionRecord`, `AgentRecord`, `BoardRecord`, `StorageFileRecord` |
| `aimeat/src/storage/providers/sqlite/schema.ts` | Add columns to `federation_peers`, `actions`, `agents`, `boards`, `storage_files` tables |
| `aimeat/src/storage/providers/sqlite/index.ts` | Handle new fields in CRUD methods |
| `aimeat/src/storage/providers/mongodb/index.ts` | Handle new fields in CRUD methods |
| `aimeat/prisma/schema.prisma` | Add fields to `FederationPeer`, `Action`, `Agent`, `Board`, `StorageFile` models |

### Enforcement
| File | Change |
|------|--------|
| `aimeat/src/routes/federation-sync.ts` | Check peer policy before catalogue-sync, replicate, and route |
| `aimeat/src/services/memory-replication.ts` | Check `replicateMemory` policy before replicating to a peer |

### API Routes
| File | Change |
|------|--------|
| `aimeat/src/routes/federation-peer.ts` | Accept policy fields in PUT peer update; return policy in GET peers |
| `aimeat/src/routes/actions.ts` | Accept `federate` on create/update; return in responses |
| `aimeat/src/routes/agents.ts` | Accept `federate` on create/update; return in responses |
| `aimeat/src/routes/boards.ts` | Accept `federate` on create/update; return in responses |

### Frontend
| File | Change |
|------|--------|
| `aimeat/public/views/admin/federation-tab.js` | Peer policy toggles in Live Peers table |
| `aimeat/public/views/profile/agents-tab.js` | Federate toggle per agent card |
| `aimeat/public/views/profile/boards-tab.js` | Federate toggle per board card |
| `aimeat/public/views/profile/knowledge-tab.js` | Federate toggle per package |
| `aimeat/public/js/services/admin.js` | `updatePeerPolicy()` API function |
| `aimeat/locales/en.json` | New i18n keys for federate toggles and peer policies |
| `aimeat/locales/fi.json` | Same keys in Finnish |

### Tests
| File | Change |
|------|--------|
| `aimeat/test/federation-mesh.ts` | New E2E test suite for peer policies and federate flags |
| `aimeat/test/playwright/federation.spec.ts` | New Playwright tests for federation UI |

---

## Task 1: Add Policy Fields to FederationPeerRecord

**Files:**
- Modify: `aimeat/src/storage/interface.ts:723-730`

- [ ] **Step 1: Update FederationPeerRecord interface**

In `aimeat/src/storage/interface.ts`, replace the `FederationPeerRecord` interface:

```typescript
// Federation Peers -- persisted active peer connections
export interface FederationPeerRecord {
  nodeId: string;
  url: string;
  publicKey: string;
  status: string;
  addedAt: string;
  lastSeen: string;
  shareCatalogue: boolean;
  replicateMemory: boolean;
  allowRouting: boolean;
  peerMode: 'federation' | 'private';
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL -- SQLite and MongoDB providers don't handle new fields yet. This is expected; we'll fix them in Task 2.

---

## Task 2: Add Federate Flag to Catalogue Record Types

**Files:**
- Modify: `aimeat/src/storage/interface.ts:48-64` (ActionRecord)
- Modify: `aimeat/src/storage/interface.ts:16-32` (AgentRecord)
- Modify: `aimeat/src/storage/interface.ts:92-101` (BoardRecord)
- Modify: `aimeat/src/storage/interface.ts:209-219` (StorageFileRecord)

- [ ] **Step 1: Add `federate` to ActionRecord**

After the `semantic` field (line 63), add:

```typescript
  federate?: boolean;
```

- [ ] **Step 2: Add `federate` to AgentRecord**

After the `dailySpendLimit` field (line 31), add:

```typescript
  federate?: boolean;
```

- [ ] **Step 3: Add `federate` to BoardRecord**

After the `semantic` field (line 100), add:

```typescript
  federate?: boolean;
```

- [ ] **Step 4: Add `federate` to StorageFileRecord**

After the `createdAt` field (line 218), add:

```typescript
  federate?: boolean;
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL -- storage providers don't handle new fields. Fixing in Task 3.

---

## Task 3: Update SQLite Schema + Provider

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts`

- [ ] **Step 1: Add columns to SQLite schema**

In `schema.ts`, add migration-safe `ALTER TABLE ADD COLUMN` calls at the end of `initializeSchema()`, using the existing `safeAddColumn` helper pattern:

```typescript
    // Federation mesh Phase 1 -- peer policies and federate flags
    safeAddColumn(db, 'federation_peers', 'shareCatalogue', 'INTEGER NOT NULL DEFAULT 1');
    safeAddColumn(db, 'federation_peers', 'replicateMemory', 'INTEGER NOT NULL DEFAULT 1');
    safeAddColumn(db, 'federation_peers', 'allowRouting', 'INTEGER NOT NULL DEFAULT 1');
    safeAddColumn(db, 'federation_peers', 'peerMode', "TEXT NOT NULL DEFAULT 'federation'");
    safeAddColumn(db, 'actions', 'federate', 'INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'agents', 'federate', 'INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'boards', 'federate', 'INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'storage_files', 'federate', 'INTEGER NOT NULL DEFAULT 0');
```

- [ ] **Step 2: Update SQLite `saveFederationPeer` to handle new fields**

In `sqlite/index.ts`, find the `saveFederationPeer` method and update the INSERT OR REPLACE to include the 4 new fields:

```typescript
  async saveFederationPeer(peer: FederationPeerRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO federation_peers (nodeId, url, publicKey, status, addedAt, lastSeen, shareCatalogue, replicateMemory, allowRouting, peerMode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(peer.nodeId, peer.url, peer.publicKey, peer.status, peer.addedAt, peer.lastSeen,
      peer.shareCatalogue ? 1 : 0, peer.replicateMemory ? 1 : 0, peer.allowRouting ? 1 : 0, peer.peerMode);
  }
```

- [ ] **Step 3: Update SQLite `listFederationPeers` to map boolean fields**

```typescript
  async listFederationPeers(): Promise<FederationPeerRecord[]> {
    const rows = this.db.prepare('SELECT * FROM federation_peers').all() as any[];
    return rows.map(r => ({
      ...r,
      shareCatalogue: r.shareCatalogue === 1,
      replicateMemory: r.replicateMemory === 1,
      allowRouting: r.allowRouting === 1,
      peerMode: r.peerMode || 'federation',
    }));
  }
```

- [ ] **Step 4: Update SQLite action create/update to handle `federate`**

Find `createAction` in `sqlite/index.ts`. Add `federate` to the INSERT columns and values. The column is already added via `safeAddColumn` with default 0, so existing queries that don't include it will get the default.

In the INSERT statement, add `federate` column and `action.federate ? 1 : 0` value.

In `listActions` result mapping, add: `federate: (row as any).federate === 1`.

In `updateAction`, if `updates.federate !== undefined`, include it in the UPDATE SET clause.

- [ ] **Step 5: Repeat for agents, boards, storage_files**

Same pattern for each: add `federate` to create, map in list/get, handle in update.

For agents: `createAgent` INSERT, `listAgents`/`getAgent` mapping, `updateAgent`.
For boards: `createBoard` INSERT, `listBoards`/`getBoard` mapping.
For storage files: `createFile` INSERT, `getFile`/`listFiles` mapping.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: May still fail if MongoDB provider is not updated. Continue to Task 4.

---

## Task 4: Update MongoDB (Prisma) Schema + Provider

**Files:**
- Modify: `aimeat/prisma/schema.prisma`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`

- [ ] **Step 1: Add fields to Prisma schema**

In `schema.prisma`, update the `FederationPeer` model:

```prisma
model FederationPeer {
  nodeId         String   @id @map("_id")
  url            String
  publicKey      String   @default("")
  status         String   @default("pending")
  addedAt        DateTime @default(now())
  lastSeen       DateTime @default(now())
  shareCatalogue Boolean  @default(true)
  replicateMemory Boolean @default(true)
  allowRouting   Boolean  @default(true)
  peerMode       String   @default("federation")

  @@index([status])
}
```

Add `federate` to the `Action` model:

```prisma
  federate      Boolean  @default(false)
```

Same for `Agent`, `Board`, and `StorageFile` models (find each, add `federate Boolean @default(false)`).

- [ ] **Step 2: Update MongoDB `saveFederationPeer`**

In `mongodb/index.ts`, update the `saveFederationPeer` method's `create` and `update` data to include the 4 new fields:

```typescript
    async saveFederationPeer(peer: FederationPeerRecord): Promise<void> {
        this.ensureReady();
        await this.prisma.federationPeer.upsert({
            where: { nodeId: peer.nodeId },
            create: {
                nodeId: peer.nodeId, url: peer.url, publicKey: peer.publicKey,
                status: peer.status, addedAt: new Date(peer.addedAt), lastSeen: new Date(peer.lastSeen),
                shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory,
                allowRouting: peer.allowRouting, peerMode: peer.peerMode,
            },
            update: {
                url: peer.url, publicKey: peer.publicKey, status: peer.status,
                lastSeen: new Date(peer.lastSeen),
                shareCatalogue: peer.shareCatalogue, replicateMemory: peer.replicateMemory,
                allowRouting: peer.allowRouting, peerMode: peer.peerMode,
            },
        });
    }
```

- [ ] **Step 3: Update MongoDB `listFederationPeers` mapping**

Add the new fields to the mapper:

```typescript
    async listFederationPeers(): Promise<FederationPeerRecord[]> {
        this.ensureReady();
        const rows = await this.prisma.federationPeer.findMany();
        return rows.map((r: any) => ({
            nodeId: r.nodeId,
            url: r.url,
            publicKey: r.publicKey,
            status: r.status,
            addedAt: r.addedAt instanceof Date ? r.addedAt.toISOString() : r.addedAt,
            lastSeen: r.lastSeen instanceof Date ? r.lastSeen.toISOString() : r.lastSeen,
            shareCatalogue: r.shareCatalogue ?? true,
            replicateMemory: r.replicateMemory ?? true,
            allowRouting: r.allowRouting ?? true,
            peerMode: r.peerMode || 'federation',
        }));
    }
```

- [ ] **Step 4: Update MongoDB action/agent/board/file create + mapping**

For each record type, add `federate` to the Prisma create data and to the record mapper. Use `?? false` for backward compatibility with existing records.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (all interface fields now handled in both providers)

- [ ] **Step 6: Commit storage layer changes**

```bash
git add aimeat/src/storage/ aimeat/prisma/schema.prisma
git commit -m "feat(federation): add per-peer policy fields and federate flags to storage layer"
```

---

## Task 5: Update Peer Creation Points for Default Policy Values

**Files:**
- Modify: `aimeat/src/routes/federation-peer.ts`
- Modify: `aimeat/src/server-bootstrap/service-init.ts`

Every place that creates a `PeerInfo` or `FederationPeerRecord` must include the 4 new fields. The `PeerInfo` interface in `services/federation.ts` also needs updating.

- [ ] **Step 1: Update PeerInfo interface**

In `aimeat/src/services/federation.ts`, update `PeerInfo` to match `FederationPeerRecord`:

```typescript
export interface PeerInfo {
    nodeId: string;
    url: string;
    publicKey: string;
    status: string;
    addedAt: string;
    lastSeen: string;
    shareCatalogue: boolean;
    replicateMemory: boolean;
    allowRouting: boolean;
    peerMode: 'federation' | 'private';
}
```

- [ ] **Step 2: Add defaults to all peer creation sites in federation-peer.ts**

Search for all `peers.set(` calls in `federation-peer.ts`. For each, add the 4 policy fields with defaults:

```typescript
shareCatalogue: true,
replicateMemory: true,
allowRouting: true,
peerMode: 'federation' as const,
```

There are ~4 creation sites: peering approval (line ~319), direct add (line ~444), key exchange auto-add (line ~672).

- [ ] **Step 3: Update service-init.ts peer loading**

In `service-init.ts`, where persisted peers are loaded into the Map, the fields are already loaded from storage (since `listFederationPeers` now returns them). Verify the mapping includes the new fields.

- [ ] **Step 4: Update PUT /v1/federation/peers/:nodeId to accept policy fields**

In `federation-peer.ts`, find the PUT handler. Add:

```typescript
        const { url, public_key, status, share_catalogue, replicate_memory, allow_routing, peer_mode } = req.body ?? {};
        if (url) peer.url = url;
        if (public_key) peer.publicKey = public_key;
        if (status) peer.status = status;
        if (share_catalogue !== undefined) peer.shareCatalogue = share_catalogue;
        if (replicate_memory !== undefined) peer.replicateMemory = replicate_memory;
        if (allow_routing !== undefined) peer.allowRouting = allow_routing;
        if (peer_mode !== undefined) peer.peerMode = peer_mode;
        await storage.saveFederationPeer(peer);
```

- [ ] **Step 5: Update GET /v1/federation/peers to return policy fields**

Find the peers list endpoint. In the response mapping, add the 4 policy fields:

```typescript
{
    node_id: p.nodeId,
    url: p.url,
    // ...existing fields...
    share_catalogue: p.shareCatalogue,
    replicate_memory: p.replicateMemory,
    allow_routing: p.allowRouting,
    peer_mode: p.peerMode,
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add aimeat/src/routes/federation-peer.ts aimeat/src/services/federation.ts aimeat/src/server-bootstrap/service-init.ts
git commit -m "feat(federation): add policy defaults to all peer creation sites and API"
```

---

## Task 6: Enforce Per-Peer Policies in Sync and Route Handlers

**Files:**
- Modify: `aimeat/src/routes/federation-sync.ts:29-52` (replicate handler)
- Modify: `aimeat/src/routes/federation-sync.ts:132-162` (catalogue-sync handler)
- Modify: `aimeat/src/routes/federation-sync.ts:269-312` (route handler)
- Modify: `aimeat/src/services/memory-replication.ts:85-114` (replicateMemoryToPeer)

- [ ] **Step 1: Block replication when `replicateMemory` is false**

In `federation-sync.ts`, in the replicate handler (after peer lookup at line ~38-42), add:

```typescript
        if (!peer.replicateMemory) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'This peer has memory replication disabled'));
            return;
        }
```

- [ ] **Step 2: Block catalogue sync when `shareCatalogue` is false**

In `federation-sync.ts`, in the catalogue-sync handler (after peer lookup at line ~144-148), add:

```typescript
        if (!peer.shareCatalogue) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'This peer has catalogue sharing disabled'));
            return;
        }
```

- [ ] **Step 3: Block routing when `allowRouting` is false**

In `federation-sync.ts`, in the route handler, after finding the target peer or relay peer, check:

For the direct peer check (around line ~315 where it looks for `target_node` in peers):
```typescript
        if (targetPeer && !targetPeer.allowRouting) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'Routing is disabled for this peer'));
            return;
        }
```

For the multi-hop relay section (where it iterates active peers), filter out peers with `allowRouting === false`:
```typescript
        const relayPeers = [...peers.values()].filter(p =>
            p.status === 'active' && p.allowRouting && !pathNodes.includes(p.nodeId)
        );
```

- [ ] **Step 4: Block memory replication outbound when `replicateMemory` is false**

In `memory-replication.ts`, in `replicateMemoryToPeer` (line ~85), add a policy check after the existing eligibility check:

```typescript
  if (!peer.replicateMemory) {
    return { success: false, error: 'Peer has memory replication disabled' };
  }
```

Note: The `peer` parameter type is `PeerInfo` which now includes `replicateMemory`.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/routes/federation-sync.ts aimeat/src/services/memory-replication.ts
git commit -m "feat(federation): enforce per-peer policies in sync, route, and replication handlers"
```

---

## Task 7: Add Federate Flag to Action/Agent/Board API Routes

**Files:**
- Modify: `aimeat/src/routes/actions.ts`
- Modify: `aimeat/src/routes/agents.ts`
- Modify: `aimeat/src/routes/boards.ts`

- [ ] **Step 1: Actions -- accept `federate` on create and update**

In `actions.ts` POST handler (line ~19), destructure `federate` from `req.body`. Add to `createAction` call (line ~52):

```typescript
        federate: federate === true,
```

In the PUT handler for action update, accept `federate` and pass to `updateAction`.

In GET responses, include `federate: action.federate ?? false` in the response object.

- [ ] **Step 2: Agents -- accept `federate` on update**

Agents are created via device auth or POST registration -- `federate` should default to `false`. Add `federate` to the `updateAgent` calls where agent profile is updated. Add to GET /v1/agents/:gaii response.

- [ ] **Step 3: Boards -- accept `federate` on create and visibility update**

In `boards.ts` POST handler (line ~58), destructure `federate` from `req.body`. Add to `createBoard` call. In the PATCH visibility handler, also accept and update `federate`.

In board listing/detail responses, include `federate: board.federate ?? false`.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/actions.ts aimeat/src/routes/agents.ts aimeat/src/routes/boards.ts
git commit -m "feat(federation): accept federate flag in action/agent/board API routes"
```

---

## Task 8: Admin UI -- Peer Policy Toggles

**Files:**
- Modify: `aimeat/public/views/admin/federation-tab.js`
- Modify: `aimeat/public/js/services/admin.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add `updatePeerPolicy` to admin service**

In `admin.js`, after the `removePeerEmergency` line, add:

```javascript
export const updatePeerPolicy = (nodeId, policy) => apiPut(`/v1/federation/peers/${encodeURIComponent(nodeId)}`, policy);
```

- [ ] **Step 2: Add i18n keys**

In both `en.json` and `fi.json`, in the `dashboard` section, add keys for:

```json
"fedShareCatalogue": "Share Catalogue",
"fedReplicateMemory": "Replicate Memory",
"fedAllowRouting": "Allow Routing",
"fedPeerMode": "Peer Mode",
"fedPeerModeFederation": "Federation",
"fedPeerModePrivate": "Private P2P",
"fedPolicyUpdated": "Peer policy updated",
"fedPolicySectionTitle": "Peer Policy"
```

Finnish translations:

```json
"fedShareCatalogue": "Jaa katalogi",
"fedReplicateMemory": "Replikoi muisti",
"fedAllowRouting": "Salli reititys",
"fedPeerMode": "Vertaistila",
"fedPeerModeFederation": "Federaatio",
"fedPeerModePrivate": "Yksityinen P2P",
"fedPolicyUpdated": "Vertaispolitiikka päivitetty",
"fedPolicySectionTitle": "Vertaispolitiikka"
```

- [ ] **Step 3: Add policy toggles to Live Peers table**

In `federation-tab.js`, import `updatePeerPolicy` from admin.js.

Add a `doUpdatePolicy` callback:

```javascript
  const doUpdatePolicy = useCallback(async (nodeId, field, value) => {
    try {
      await updatePeerPolicy(nodeId, { [field]: value });
      flash(t('dashboard.fedPolicyUpdated'));
      reload();
    } catch (e) { flashErr(e.message); }
  }, [reload]);
```

In the Live Peers table, add columns after the existing action buttons column. For each peer row, add toggle checkboxes:

```javascript
<td>
  <label style="display:flex;align-items:center;gap:4px;font-size:.75rem">
    <input type="checkbox" checked=${p.share_catalogue !== false}
      onChange=${(e) => doUpdatePolicy(p.node_id, 'share_catalogue', e.target.checked)} />
    ${t('dashboard.fedShareCatalogue')}
  </label>
  <label style="display:flex;align-items:center;gap:4px;font-size:.75rem">
    <input type="checkbox" checked=${p.replicate_memory !== false}
      onChange=${(e) => doUpdatePolicy(p.node_id, 'replicate_memory', e.target.checked)} />
    ${t('dashboard.fedReplicateMemory')}
  </label>
  <label style="display:flex;align-items:center;gap:4px;font-size:.75rem">
    <input type="checkbox" checked=${p.allow_routing !== false}
      onChange=${(e) => doUpdatePolicy(p.node_id, 'allow_routing', e.target.checked)} />
    ${t('dashboard.fedAllowRouting')}
  </label>
</td>
```

Note: Use CSS classes from the frontend guide rather than inline styles. The above is pseudocode -- actual implementation should use `adm-` prefixed classes.

- [ ] **Step 4: Add Peer Mode toggle**

Add a select/dropdown for peer mode in the same policy column:

```javascript
<select value=${p.peer_mode || 'federation'}
  onChange=${(e) => doUpdatePolicy(p.node_id, 'peer_mode', e.target.value)}>
  <option value="federation">${t('dashboard.fedPeerModeFederation')}</option>
  <option value="private">${t('dashboard.fedPeerModePrivate')}</option>
</select>
```

- [ ] **Step 5: Add "POLICY" column header**

Add a new `<th>` in the Live Peers table header:

```javascript
<th>${t('dashboard.fedPolicySectionTitle')}</th>
```

- [ ] **Step 6: Commit**

```bash
git add aimeat/public/views/admin/federation-tab.js aimeat/public/js/services/admin.js aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(federation): add peer policy toggles to admin federation tab"
```

---

## Task 9: Profile UI -- Federate Toggles

**Files:**
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/views/profile/boards-tab.js`
- Modify: `aimeat/public/views/profile/knowledge-tab.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add i18n keys for federate toggles**

In both locale files, in the `profile` section:

```json
"federate": "Federate",
"federateTooltip": "Make visible across the federation network",
"federated": "Federated",
"notFederated": "Local only"
```

Finnish:

```json
"federate": "Federoi",
"federateTooltip": "Tee näkyväksi federaatioverkossa",
"federated": "Federoitu",
"notFederated": "Vain paikallinen"
```

- [ ] **Step 2: Agents tab -- add federate toggle**

In `agents-tab.js`, in the agent card rendering (around line 417 where agent display name is shown), add a federate toggle button/badge after the agent name:

```javascript
<button class="${a.federate ? 'badge badge-success' : 'badge badge-dim'}"
  onClick=${(e) => { e.stopPropagation(); toggleFederate(a.gaii, !a.federate); }}
  title=${t('profile.federateTooltip')}>
  ${a.federate ? t('profile.federated') : t('profile.notFederated')}
</button>
```

Add a `toggleFederate` function that calls the agent update API:

```javascript
async function toggleFederate(gaii, value) {
  try {
    await apiPatch(`/v1/agents/${encodeURIComponent(gaii)}`, { federate: value });
    loadAgents();
    showToast(value ? t('profile.federated') : t('profile.notFederated'));
  } catch (e) { showToast(e.message); }
}
```

Note: Check if agents have a PATCH endpoint. If not, use the existing update mechanism. The agent update endpoint may need to be verified.

- [ ] **Step 3: Boards tab -- add federate toggle**

In `boards-tab.js`, in the "My Boards" rendering (line ~223), add a federate toggle next to the visibility pill. Only show for public boards (federation only makes sense for public boards):

```javascript
${vis === 'public' && html`
  <button class="${b.federate ? 'badge badge-success' : 'badge badge-dim'}"
    onClick=${(e) => { e.stopPropagation(); toggleBoardFederate(bid, !b.federate); }}>
    ${b.federate ? t('profile.federated') : t('profile.notFederated')}
  </button>
`}
```

- [ ] **Step 4: Knowledge tab -- add federate toggle**

In `knowledge-tab.js`, in the package card rendering (line ~577), add a federate badge in the header area next to existing badges. Knowledge packages are stored as memory entries, so the federate toggle should create/revoke a federation consent for the package namespace.

- [ ] **Step 5: Commit**

```bash
git add aimeat/public/views/profile/agents-tab.js aimeat/public/views/profile/boards-tab.js aimeat/public/views/profile/knowledge-tab.js aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(federation): add federate toggles to profile tabs"
```

---

## Task 10: E2E Tests -- Per-Peer Policy

**Files:**
- Create: `aimeat/test/federation-mesh.ts`

- [ ] **Step 1: Create test file with server setup**

Create `aimeat/test/federation-mesh.ts` following the existing test pattern from `test/api-full.ts`:

```typescript
// Federation mesh Phase 1 tests -- per-peer policy and federate flags
// Run: cd aimeat && pnpm exec tsx test/federation-mesh.ts

import { randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40253', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;

let server: Server | null = null;

if (!process.env.E2E_BASE) {
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    }
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(TEST_PORT, () => resolve(s));
    });
    console.log(`Federation mesh test server on port ${TEST_PORT}`);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let operatorJwt = '';
let agentJwt = '';
```

- [ ] **Step 2: Add setup phase -- register owner, get operator JWT**

```typescript
console.log('\n══ Phase 0: Setup ══');

await test('register test owner', async () => {
    const r = await fetch(`${BASE}/v1/owners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'meshtest', display_name: 'Mesh Tester' }),
    });
    assert(r.ok, `Register failed: ${r.status}`);
});

await test('login as operator', async () => {
    const r = await fetch(`${BASE}/v1/ghii/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'meshtest', password: 'testpass123' }),
    });
    assert(r.ok, `Login failed: ${r.status}`);
    const data = await r.json();
    operatorJwt = data.data?.jwt || data.data?.token;
    assert(!!operatorJwt, 'No JWT in response');
});
```

- [ ] **Step 3: Add peer policy tests**

```typescript
console.log('\n══ Phase 1: Peer Policy Fields ══');

await test('add peer with default policies', async () => {
    const r = await fetch(`${BASE}/v1/federation/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${operatorJwt}` },
        body: JSON.stringify({ node_id: 'test-peer-1', url: 'http://localhost:9999' }),
    });
    assert(r.ok, `Add peer failed: ${r.status}`);
});

await test('peer has default policy values', async () => {
    const r = await fetch(`${BASE}/v1/federation/peers`, {
        headers: { 'Authorization': `Bearer ${operatorJwt}` },
    });
    assert(r.ok, `List peers failed: ${r.status}`);
    const data = await r.json();
    const peer = data.data.peers.find((p: any) => p.node_id === 'test-peer-1');
    assert(peer, 'Peer not found');
    assert(peer.share_catalogue === true, 'shareCatalogue should default true');
    assert(peer.replicate_memory === true, 'replicateMemory should default true');
    assert(peer.allow_routing === true, 'allowRouting should default true');
    assert(peer.peer_mode === 'federation', 'peerMode should default federation');
});

await test('update peer policy', async () => {
    const r = await fetch(`${BASE}/v1/federation/peers/test-peer-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${operatorJwt}` },
        body: JSON.stringify({ share_catalogue: false, peer_mode: 'private' }),
    });
    assert(r.ok, `Update peer failed: ${r.status}`);
});

await test('updated policy persists', async () => {
    const r = await fetch(`${BASE}/v1/federation/peers`, {
        headers: { 'Authorization': `Bearer ${operatorJwt}` },
    });
    const data = await r.json();
    const peer = data.data.peers.find((p: any) => p.node_id === 'test-peer-1');
    assert(peer.share_catalogue === false, 'shareCatalogue should be false');
    assert(peer.peer_mode === 'private', 'peerMode should be private');
    assert(peer.replicate_memory === true, 'replicateMemory should remain true');
});
```

- [ ] **Step 4: Add federate flag tests**

```typescript
console.log('\n══ Phase 2: Federate Flags ══');

await test('create action with federate=true', async () => {
    // First need an agent JWT -- register an agent
    // ... (register agent, get agent JWT)
    const r = await fetch(`${BASE}/v1/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentJwt}` },
        body: JSON.stringify({
            id: 'test-action-fed',
            display_name: 'Federated Action',
            description: 'A test federated action',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 1 },
            federate: true,
        }),
    });
    assert(r.ok, `Create action failed: ${r.status}`);
});

await test('action federate flag persists in listing', async () => {
    const r = await fetch(`${BASE}/v1/actions`);
    const data = await r.json();
    const action = data.data?.actions?.find((a: any) => a.id === 'test-action-fed');
    assert(action, 'Action not found');
    assert(action.federate === true, 'federate should be true');
});

await test('action without federate defaults to false', async () => {
    const r = await fetch(`${BASE}/v1/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentJwt}` },
        body: JSON.stringify({
            id: 'test-action-local',
            display_name: 'Local Action',
            description: 'Not federated',
            input_schema: {},
            output_schema: {},
            pricing: { base_morsels: 1 },
        }),
    });
    assert(r.ok, `Create action failed: ${r.status}`);
    const listing = await fetch(`${BASE}/v1/actions`);
    const data = await listing.json();
    const action = data.data?.actions?.find((a: any) => a.id === 'test-action-local');
    assert(action.federate === false, 'federate should default to false');
});
```

- [ ] **Step 5: Add cleanup and summary**

```typescript
// Cleanup
await test('delete test owner (cascade)', async () => {
    const r = await fetch(`${BASE}/v1/admin/owners/meshtest`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${operatorJwt}` },
    });
    // May or may not exist depending on test order
});

console.log(`\n══ Results: ${passed} passed, ${failed} failed ══`);
if (server) server.close();
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 6: Add test script to package.json**

In `aimeat/package.json`, add to the scripts section:

```json
"test:federation-mesh": "tsx test/federation-mesh.ts"
```

- [ ] **Step 7: Run the test**

Run: `pnpm test:federation-mesh`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add aimeat/test/federation-mesh.ts aimeat/package.json
git commit -m "test(federation): add E2E tests for per-peer policy and federate flags"
```

---

## Task 11: Playwright Tests -- Federation UI

**Files:**
- Create: `aimeat/test/playwright/federation.spec.ts`

- [ ] **Step 1: Create Playwright test file**

Create `aimeat/test/playwright/federation.spec.ts` following the existing Playwright test patterns in the project. Check `aimeat/test/playwright/` for existing test structure, imports, and helpers.

Tests to include:
- Navigate to admin federation tab
- Verify peer policy toggles render for live peers
- Toggle a policy checkbox and verify it persists after page reload
- Navigate to profile agents tab
- Verify federate badge appears on agent cards
- Navigate to profile boards tab
- Verify federate toggle appears on public boards

- [ ] **Step 2: Run Playwright tests**

Run: `pnpm test:playwright`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/playwright/federation.spec.ts
git commit -m "test(federation): add Playwright tests for federation UI toggles"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No new errors (warnings for pre-existing issues are OK)

- [ ] **Step 3: Run E2E tests on both backends**

Run: `pnpm test:e2e:sqlite`
Run: `pnpm test:e2e:mongodb`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 4: Run federation mesh tests**

Run: `pnpm test:federation-mesh`
Expected: All new tests PASS

- [ ] **Step 5: Run Playwright tests**

Run: `pnpm test:playwright`
Expected: PASS

- [ ] **Step 6: Update openapi.yaml**

Add `federate` to action/agent/board request/response schemas. Add `share_catalogue`, `replicate_memory`, `allow_routing`, `peer_mode` to the peer update endpoint schema.

- [ ] **Step 7: Final commit**

```bash
git add openapi.yaml
git commit -m "docs: update openapi spec for federation mesh Phase 1"
```
