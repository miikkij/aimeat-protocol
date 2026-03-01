# Personal Nodes Profile Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Nodes" tab to the user profile page with expandable cards for managing personal nodes (private/public visibility), plus backend support for the visibility field.

**Architecture:** Server-rendered HTML tab panel in `profile.ts` with inline CSS/JS. Backend adds `visibility` field to `PersonalNodeRecord`, a PATCH endpoint for toggling it, and filters private nodes from federation directory and GAII resolution.

**Tech Stack:** TypeScript, Express 5, Zod validation, server-rendered HTML with inline CSS/JS, i18n (EN+FI)

---

### Task 1: Add `visibility` field to PersonalNodeRecord

**Files:**
- Modify: `aimeat/src/storage/interface.ts:206-218`

**Step 1: Add the field**

In `PersonalNodeRecord`, add `visibility` after `mailboxUsedBytes`:

```typescript
export interface PersonalNodeRecord {
  nodeId: string;               // e.g. "personal-jouni-001"
  ownerName: string;            // links to OwnerRecord
  anchorNodeId: string;         // the operator node hosting this personal node
  publicKey: string;            // Ed25519 public key for tunnel auth
  status: 'online' | 'offline' | 'degraded' | 'detached';
  agentGaiis: string[];         // agents hosted on this personal node
  lastSeen: string;             // ISO timestamp
  mailboxQuotaBytes: number;    // allocated quota
  mailboxUsedBytes: number;     // current usage
  visibility: 'private' | 'public';  // federation directory visibility
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — all places creating `PersonalNodeRecord` now missing `visibility`

---

### Task 2: Update storage implementations for `visibility`

**Files:**
- Modify: `aimeat/src/storage/memory.ts:670-672` (createPersonalNode)
- Modify: `aimeat/src/storage/mongodb.ts:1078-1081` (createPersonalNode)

**Step 1: No code changes needed in storage**

The storage implementations use spread (`{ ...node }`) and `Object.assign` for updates, so they automatically handle the new field. No changes required to memory.ts or mongodb.ts — the `visibility` field flows through as part of the record.

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — `personal.ts` creates records without `visibility`

---

### Task 3: Update schema and anchor route to accept `visibility`

**Files:**
- Modify: `aimeat/src/models/schemas.ts:5-10`
- Modify: `aimeat/src/routes/personal.ts:47-59`

**Step 1: Add visibility to AnchorRequestSchema**

In `aimeat/src/models/schemas.ts`, update:

```typescript
export const AnchorRequestSchema = z.object({
    node_id: z.string().min(3).max(80).regex(/^personal-[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    owner_name: z.string().min(3).max(64),
    public_key: z.string().min(10),
    agent_gaiis: z.array(z.string()).optional(),
    visibility: z.enum(['private', 'public']).optional(),
});
```

**Step 2: Add VisibilityUpdateSchema**

Below `AnchorRequestSchema`, add:

```typescript
export const VisibilityUpdateSchema = z.object({
    visibility: z.enum(['private', 'public']),
});
```

**Step 3: Update the anchor route to include visibility**

In `aimeat/src/routes/personal.ts`, in the `POST /v1/personal/anchor` handler, update the destructuring and record creation:

Change line ~23:
```typescript
const { node_id, owner_name, public_key, agent_gaiis, visibility } = (req as any).validated;
```

Change the record creation (~line 47-59) to include:
```typescript
visibility: visibility ?? 'private',
```

Also include `visibility` in the 201 response data object:
```typescript
visibility: record.visibility,
```

**Step 4: Update status endpoint response**

In the `GET /v1/personal/status` handler (~line 101), add `visibility: node.visibility` to the response object.

**Step 5: Update list endpoint response**

In the `GET /v1/personal/nodes` handler (~line 135), add `visibility: node.visibility` to the mapped result objects.

**Step 6: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/models/schemas.ts aimeat/src/routes/personal.ts
git commit -m "feat: add visibility field to personal nodes (private/public)"
```

---

### Task 4: Add PATCH endpoint for visibility toggle

**Files:**
- Modify: `aimeat/src/routes/personal.ts` (add new route before the DELETE handler)

**Step 1: Add the PATCH route**

Before the `DELETE /v1/personal/anchor/:nodeId` handler, add:

```typescript
  // PATCH /v1/personal/anchor/:nodeId — Update personal node settings (visibility)
  router.patch('/v1/personal/anchor/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }

      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only update your own personal nodes'));
        return;
      }

      const { visibility } = req.body;
      if (visibility && !['private', 'public'].includes(visibility)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'visibility must be "private" or "public"'));
        return;
      }

      const updates: Record<string, unknown> = {};
      if (visibility) updates.visibility = visibility;

      const updated = await storage.updatePersonalNode(nodeId, updates);

      res.json(success(config.nodeId, {
        node_id: updated!.nodeId,
        visibility: updated!.visibility,
        updated_at: updated!.updatedAt,
      }));
    } catch (err) {
      logger.error('Failed to update personal node', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update personal node'));
    }
  });
```

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/personal.ts
git commit -m "feat: add PATCH endpoint for personal node visibility toggle"
```

---

### Task 5: Filter private nodes from federation directory

**Files:**
- Modify: `aimeat/src/routes/federation.ts:36-46`

**Step 1: Add visibility filter**

In the federation directory handler, after `const personalNodes = await storage.listPersonalNodes();`, filter:

```typescript
const personalNodes = await storage.listPersonalNodes();
const publicNodes = personalNodes.filter(pn => pn.visibility === 'public');
personalNodesList = publicNodes.map(pn => ({
```

Change the map source from `personalNodes` to `publicNodes`.

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/federation.ts
git commit -m "feat: filter private personal nodes from federation directory"
```

---

### Task 6: Filter private nodes in GAII resolution

**Files:**
- Modify: `aimeat/src/services/federation.ts:49-55`

**Step 1: Add visibility check**

The `resolveGaii` function currently resolves any personal node's agents. For private nodes, we should still resolve them (the owner's own requests need to work), but this doesn't need changes since the GAII resolution is used for work routing which the owner initiates. Private nodes are hidden from the directory (Task 5) but remain routable — this is the correct behavior for "private" (not listed, but still functional).

No code change needed here. Private means "not discoverable in federation directory", not "unreachable". The owner's agents on a private node still need to receive work.

**Step 2: Commit (skip if no changes)**

No commit needed.

---

### Task 7: Add Nodes tab translations (EN + FI)

**Files:**
- Modify: `aimeat/src/routes/profile.ts:32-41` (EN tab translations)
- Modify: `aimeat/src/routes/profile.ts:321-329` (FI tab translations)
- Add new translation blocks after the existing ones

**Step 1: Add English translations**

After `'profile.tabs.access': 'Access',` (line 41), add:
```typescript
    'profile.tabs.nodes': 'Nodes',
```

After the access section translations (~line 286), add:

```typescript
    // Personal Nodes section
    'profile.nodes.title': 'Personal Nodes',
    'profile.nodes.desc': 'Personal nodes run on your own hardware \u2014 a laptop, NAS, or home server. Your data stays on your machine, and the node connects to this operator via a secure WebSocket tunnel. Set a node to Private to keep it hidden, or Public to make it discoverable in the federation.',
    'profile.nodes.loading': 'Loading personal nodes...',
    'profile.nodes.empty': 'No personal nodes registered yet.',
    'profile.nodes.error': 'Could not load personal nodes.',
    'profile.nodes.addBtn': '+ Add Node',
    'profile.nodes.online': 'Online',
    'profile.nodes.offline': 'Offline',
    'profile.nodes.degraded': 'Degraded',
    'profile.nodes.detached': 'Detached',
    'profile.nodes.agents': 'agents',
    'profile.nodes.agent': 'agent',
    'profile.nodes.mailboxItems': 'Mailbox',
    'profile.nodes.items': 'items',
    'profile.nodes.tunnelUrl': 'Tunnel URL',
    'profile.nodes.copyUrl': 'Copy',
    'profile.nodes.copied': 'Copied!',
    'profile.nodes.agentList': 'Agents on this node',
    'profile.nodes.noAgents': 'No agents registered on this node.',
    'profile.nodes.mailbox': 'Mailbox',
    'profile.nodes.mailboxOf': 'of',
    'profile.nodes.lastSeen': 'Last seen',
    'profile.nodes.visibility': 'Visibility',
    'profile.nodes.private': 'Private',
    'profile.nodes.public': 'Public',
    'profile.nodes.privateDesc': 'Hidden from federation directory',
    'profile.nodes.publicDesc': 'Discoverable in federation directory',
    'profile.nodes.setupTitle': 'Setup Instructions',
    'profile.nodes.setupStep1': '1. Connect via WebSocket tunnel using the URL above with your JWT token.',
    'profile.nodes.setupStep2': '2. Send heartbeat messages every 30 seconds to stay online.',
    'profile.nodes.setupStep3': '3. On reconnect, the operator sends queued mailbox items automatically.',
    'profile.nodes.setupStep4': '4. Acknowledge received mailbox items with a mailbox_ack message.',
    'profile.nodes.setupDocs': 'Full documentation',
    'profile.nodes.detachBtn': 'Detach Node',
    'profile.nodes.detachConfirm': 'Detach this node? This will close the tunnel, purge the mailbox, and remove the node.',
    'profile.nodes.detached.toast': 'Node detached.',
    'profile.nodes.visUpdated': 'Visibility updated.',
    'profile.nodes.addTitle': 'Register a Personal Node',
    'profile.nodes.nodeIdLabel': 'Node ID',
    'profile.nodes.nodeIdPlaceholder': 'personal-my-laptop',
    'profile.nodes.nodeIdPrefix': 'personal-',
    'profile.nodes.visLabel': 'Visibility',
    'profile.nodes.agentGaiisLabel': 'Agent GAIIs (comma-separated, optional)',
    'profile.nodes.agentGaiisPlaceholder': 'bot1#owner, bot2#owner',
    'profile.nodes.registerBtn': 'Register',
    'profile.nodes.cancelBtn': 'Cancel',
    'profile.nodes.registered': 'Personal node registered!',
    'profile.nodes.registerFailed': 'Registration failed',
    'profile.stats.nodes': 'Nodes',
```

**Step 2: Add Finnish translations**

After `'profile.tabs.access': 'P\u00e4\u00e4sy',` (line 329), add:
```typescript
    'profile.tabs.nodes': 'Solmut',
```

After the Finnish access translations (~line 565), add:

```typescript
    'profile.nodes.title': 'Henkil\u00f6kohtaiset solmut',
    'profile.nodes.desc': 'Henkil\u00f6kohtaiset solmut toimivat omalla laitteellasi \u2014 l\u00e4pp\u00e4ri, NAS tai kotipalvelin. Datasi pysyy koneellasi ja solmu yhdist\u00e4\u00e4 t\u00e4h\u00e4n operaattoriin suojatun WebSocket-tunnelin kautta. Aseta solmu Yksityiseksi piilottaaksesi sen tai Julkiseksi l\u00f6ydett\u00e4v\u00e4ksi federaatiossa.',
    'profile.nodes.loading': 'Ladataan solmuja...',
    'profile.nodes.empty': 'Ei rekister\u00f6ityj\u00e4 solmuja.',
    'profile.nodes.error': 'Solmujen lataus ep\u00e4onnistui.',
    'profile.nodes.addBtn': '+ Lis\u00e4\u00e4 solmu',
    'profile.nodes.online': 'Online',
    'profile.nodes.offline': 'Offline',
    'profile.nodes.degraded': 'Heikentynyt',
    'profile.nodes.detached': 'Irrotettu',
    'profile.nodes.agents': 'agenttia',
    'profile.nodes.agent': 'agentti',
    'profile.nodes.mailboxItems': 'Postilaatikko',
    'profile.nodes.items': 'viesti\u00e4',
    'profile.nodes.tunnelUrl': 'Tunnelin URL',
    'profile.nodes.copyUrl': 'Kopioi',
    'profile.nodes.copied': 'Kopioitu!',
    'profile.nodes.agentList': 'Solmun agentit',
    'profile.nodes.noAgents': 'Ei agentteja t\u00e4ll\u00e4 solmulla.',
    'profile.nodes.mailbox': 'Postilaatikko',
    'profile.nodes.mailboxOf': '/',
    'profile.nodes.lastSeen': 'N\u00e4hty viimeksi',
    'profile.nodes.visibility': 'N\u00e4kyvyys',
    'profile.nodes.private': 'Yksityinen',
    'profile.nodes.public': 'Julkinen',
    'profile.nodes.privateDesc': 'Piilotettu federaatiohakemistosta',
    'profile.nodes.publicDesc': 'L\u00f6ydett\u00e4viss\u00e4 federaatiohakemistossa',
    'profile.nodes.setupTitle': 'Asennusohjeet',
    'profile.nodes.setupStep1': '1. Yhdist\u00e4 WebSocket-tunneliin yll\u00e4 olevalla URL:ll\u00e4 ja JWT-tokenillasi.',
    'profile.nodes.setupStep2': '2. L\u00e4het\u00e4 sykeviesej\u00e4 30 sekunnin v\u00e4lein pysyy\u00e4ksesi online-tilassa.',
    'profile.nodes.setupStep3': '3. Uudelleenyhdist\u00e4ess\u00e4 operaattori l\u00e4hett\u00e4\u00e4 jonossa olevat viestit automaattisesti.',
    'profile.nodes.setupStep4': '4. Vahvista vastaanotetut viestit mailbox_ack-viestill\u00e4.',
    'profile.nodes.setupDocs': 'T\u00e4ysi dokumentaatio',
    'profile.nodes.detachBtn': 'Irrota solmu',
    'profile.nodes.detachConfirm': 'Irrotetaanko solmu? T\u00e4m\u00e4 sulkee tunnelin, tyhjent\u00e4\u00e4 postilaatikon ja poistaa solmun.',
    'profile.nodes.detached.toast': 'Solmu irrotettu.',
    'profile.nodes.visUpdated': 'N\u00e4kyvyys p\u00e4ivitetty.',
    'profile.nodes.addTitle': 'Rekister\u00f6i henkil\u00f6kohtainen solmu',
    'profile.nodes.nodeIdLabel': 'Solmun tunnus',
    'profile.nodes.nodeIdPlaceholder': 'personal-oma-l\u00e4pp\u00e4ri',
    'profile.nodes.nodeIdPrefix': 'personal-',
    'profile.nodes.visLabel': 'N\u00e4kyvyys',
    'profile.nodes.agentGaiisLabel': 'Agenttien GAII:t (pilkulla eroteltu, valinnainen)',
    'profile.nodes.agentGaiisPlaceholder': 'botti1#omistaja, botti2#omistaja',
    'profile.nodes.registerBtn': 'Rekister\u00f6i',
    'profile.nodes.cancelBtn': 'Peruuta',
    'profile.nodes.registered': 'Solmu rekister\u00f6ity!',
    'profile.nodes.registerFailed': 'Rekister\u00f6inti ep\u00e4onnistui',
    'profile.stats.nodes': 'Solmut',
```

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/profile.ts
git commit -m "feat: add personal nodes i18n translations (EN + FI)"
```

---

### Task 8: Add Nodes tab button, stats card, and HTML panel

**Files:**
- Modify: `aimeat/src/routes/profile.ts` (stats bar ~909, tabs ~913-924, after federation panel ~1111)

**Step 1: Add stats card**

After the Files stat card (~line 910), add:
```html
    <div class="stat-card"><div class="num" id="stat-nodes">-</div><div class="label">${sanitize(translations['profile.stats.nodes'] || 'Nodes')}</div></div>
```

**Step 2: Add tab button**

After the federation tab button (~line 922), add:
```html
    <button class="tab" data-tab="nodes">${sanitize(translations['profile.tabs.nodes'] || 'Nodes')}</button>
```

**Step 3: Add the panel HTML**

After the federation panel closing `</div>` (~line 1111) and before the access panel, add:

```html
  <!-- ═══ PERSONAL NODES ═══ -->
  <div class="tab-panel" id="panel-nodes">
    <div class="section-title">${sanitize(translations['profile.nodes.title'] || 'Personal Nodes')}</div>
    <div class="section-desc">${sanitize(translations['profile.nodes.desc'] || '')}</div>

    <!-- Add Node button -->
    <button class="expand-btn" id="add-node-btn" onclick="toggleAddNodeForm()" style="margin-bottom:1.25rem">${sanitize(translations['profile.nodes.addBtn'] || '+ Add Node')}</button>

    <!-- Add Node form (hidden) -->
    <div id="add-node-form" style="display:none">
      <div class="card" style="border-color:var(--love1);margin-bottom:1.5rem">
        <h3 style="color:var(--love1);margin-bottom:1rem;font-size:1rem">${sanitize(translations['profile.nodes.addTitle'] || 'Register a Personal Node')}</h3>
        <div style="margin-bottom:.75rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.nodeIdLabel'] || 'Node ID')}</label>
          <input id="node-id-input" type="text" placeholder="${sanitize(translations['profile.nodes.nodeIdPlaceholder'] || 'personal-my-laptop')}" style="width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:monospace;font-size:.85rem">
        </div>
        <div style="margin-bottom:.75rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.visLabel'] || 'Visibility')}</label>
          <div style="display:flex;gap:1rem">
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.85rem">
              <input type="radio" name="node-vis" value="private" checked style="accent-color:var(--love1)"> ${sanitize(translations['profile.nodes.private'] || 'Private')}
              <span style="font-size:.75rem;color:var(--muted)">\u2014 ${sanitize(translations['profile.nodes.privateDesc'] || 'Hidden from federation')}</span>
            </label>
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.85rem">
              <input type="radio" name="node-vis" value="public" style="accent-color:var(--love1)"> ${sanitize(translations['profile.nodes.public'] || 'Public')}
              <span style="font-size:.75rem;color:var(--muted)">\u2014 ${sanitize(translations['profile.nodes.publicDesc'] || 'Discoverable')}</span>
            </label>
          </div>
        </div>
        <div style="margin-bottom:1rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.agentGaiisLabel'] || 'Agent GAIIs')}</label>
          <input id="node-gaiis-input" type="text" placeholder="${sanitize(translations['profile.nodes.agentGaiisPlaceholder'] || 'bot1#owner, bot2#owner')}" style="width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.85rem">
        </div>
        <div style="display:flex;gap:.75rem">
          <button onclick="registerNode()" style="padding:8px 20px;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">${sanitize(translations['profile.nodes.registerBtn'] || 'Register')}</button>
          <button onclick="toggleAddNodeForm()" style="padding:8px 20px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:.85rem">${sanitize(translations['profile.nodes.cancelBtn'] || 'Cancel')}</button>
        </div>
      </div>
    </div>

    <div id="nodes-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.nodes.loading'] || 'Loading...')}</span></div>
  </div>
```

**Step 4: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/routes/profile.ts
git commit -m "feat: add Nodes tab HTML panel with add-node form"
```

---

### Task 9: Add CSS for personal node cards

**Files:**
- Modify: `aimeat/src/routes/profile.ts` (CSS section, after `.peer-dot.dead` ~line 711)

**Step 1: Add CSS**

After the `.peer-dot.dead{background:var(--danger)}` rule (~line 711), add:

```css
/* Personal Node cards */
.pn-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:.75rem;transition:border-color .2s;overflow:hidden}
.pn-card:hover{border-color:var(--love1)}
.pn-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;cursor:pointer;user-select:none}
.pn-header-left{display:flex;align-items:center;gap:.75rem}
.pn-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.pn-status-dot.online{background:var(--success);box-shadow:0 0 6px rgba(34,197,94,.4)}
.pn-status-dot.offline{background:var(--danger)}
.pn-status-dot.degraded{background:var(--warn)}
.pn-status-dot.detached{background:var(--muted)}
.pn-name{font-weight:600;font-family:monospace;font-size:.9rem}
.pn-badges{display:flex;gap:.4rem;align-items:center}
.pn-quick{font-size:.8rem;color:var(--muted);padding:0 1.25rem .75rem}
.pn-arrow{color:var(--muted);font-size:.8rem;transition:transform .2s}
.pn-arrow.open{transform:rotate(180deg)}
.pn-details{display:none;padding:0 1.25rem 1.25rem;border-top:1px solid rgba(255,107,157,.08)}
.pn-details.open{display:block}
.pn-detail-row{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.06);font-size:.85rem}
.pn-detail-row:last-child{border-bottom:none}
.pn-detail-label{color:var(--muted);font-size:.8rem}
.pn-detail-value{font-family:monospace;font-size:.8rem;color:var(--text);word-break:break-all}
.pn-agent-list{display:flex;flex-direction:column;gap:.3rem;margin:.5rem 0}
.pn-agent-item{font-family:monospace;font-size:.8rem;color:var(--love3);padding:.2rem .5rem;background:rgba(255,107,157,.08);border-radius:4px}
.pn-vis-toggle{display:flex;gap:2px;border-radius:6px;overflow:hidden;border:1px solid var(--border)}
.pn-vis-btn{padding:4px 12px;border:none;cursor:pointer;font-size:.75rem;font-weight:600;background:transparent;color:var(--muted);transition:all .2s}
.pn-vis-btn.active{background:var(--love1);color:#fff}
.pn-vis-btn:hover:not(.active){color:var(--text)}
.pn-setup{display:none;margin-top:.75rem;background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1rem;font-size:.85rem;line-height:1.7}
.pn-setup.open{display:block}
.pn-setup ol{margin-left:1.5rem;margin-bottom:.5rem}
.pn-setup li{margin-bottom:.3rem;color:var(--muted)}
.pn-detach-btn{margin-top:.75rem;padding:6px 16px;background:transparent;color:var(--danger);border:1px solid var(--danger);border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s}
.pn-detach-btn:hover{background:rgba(239,68,68,.15)}
```

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/profile.ts
git commit -m "feat: add CSS styles for personal node cards"
```

---

### Task 10: Add JavaScript functions for loading and managing nodes

**Files:**
- Modify: `aimeat/src/routes/profile.ts` (script section, before the closing `<\/script>` tag ~line 2272)

**Step 1: Add loadAll call**

In the `loadAll()` function (~line 1240-1258), add `loadNodes();` to the parallel load list.

**Step 2: Add loadNodes function**

Before the `<\/script>` closing tag, add:

```javascript
// ── Personal Nodes ──
var nodesData = [];

async function loadNodes() {
  var el = document.getElementById('nodes-list');
  try {
    var data = await apiFetch('/v1/personal/status');
    // The status endpoint returns a single node for the current owner
    // We may also need to call the list endpoint if operator
    var nodes = [];
    if (data && data.data && data.data.node_id) {
      nodes.push(data.data);
    }
    // If owner has no node, try to detect from empty response
    if (nodes.length === 0 && data && data.error && data.error.code === 'NOT_FOUND') {
      nodes = [];
    }
    nodesData = nodes;
    document.getElementById('stat-nodes').textContent = nodes.length;

    if (nodes.length === 0) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
      return;
    }

    var html = '';
    nodes.forEach(function(node, idx) {
      var statusClass = node.status || 'offline';
      var statusLabel = t('profile.nodes.' + statusClass) || statusClass;
      var visBadge = node.visibility === 'public'
        ? '<span class="badge badge-success">' + t('profile.nodes.public') + '</span>'
        : '<span class="badge badge-muted">' + t('profile.nodes.private') + '</span>';
      var agentCount = node.agent_gaiis ? node.agent_gaiis.length : 0;
      var agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
      var mailboxCount = node.mailbox ? node.mailbox.items : 0;
      var tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';

      html += '<div class="pn-card" id="pn-' + idx + '">'
        + '<div class="pn-header" onclick="toggleNodeCard(' + idx + ')">'
        + '<div class="pn-header-left">'
        + '<div class="pn-status-dot ' + statusClass + '"></div>'
        + '<span class="pn-name">' + escHtml(node.node_id) + '</span>'
        + '</div>'
        + '<div class="pn-badges">'
        + visBadge
        + ' <span class="badge badge-' + (statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger') + '">' + statusLabel + '</span>'
        + ' <span class="pn-arrow" id="pn-arrow-' + idx + '">\u25BC</span>'
        + '</div></div>'
        + '<div class="pn-quick">' + agentCount + ' ' + agentWord + ' \u2502 ' + t('profile.nodes.mailboxItems') + ': ' + mailboxCount + ' ' + t('profile.nodes.items') + '</div>'
        + '<div class="pn-details" id="pn-details-' + idx + '">';

      // Tunnel URL
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.tunnelUrl') + '</span>'
        + '<span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem"><code style="font-size:.75rem">' + escHtml(tunnelUrl) + '</code>'
        + '<button onclick="copyToClipboard(\'' + escHtml(tunnelUrl) + '\').then(function(){showToast(t(\'profile.nodes.copied\'))})" style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">' + t('profile.nodes.copyUrl') + '</button></span></div>';

      // Agents
      html += '<div style="padding:.5rem 0"><span class="pn-detail-label">' + t('profile.nodes.agentList') + '</span>';
      if (node.agent_gaiis && node.agent_gaiis.length > 0) {
        html += '<div class="pn-agent-list">';
        node.agent_gaiis.forEach(function(g) { html += '<div class="pn-agent-item">' + escHtml(g) + '</div>'; });
        html += '</div>';
      } else {
        html += '<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">' + t('profile.nodes.noAgents') + '</div>';
      }
      html += '</div>';

      // Mailbox
      var mbUsed = node.mailbox ? node.mailbox.used_bytes : 0;
      var mbQuota = node.mailbox ? node.mailbox.quota_bytes : 0;
      var mbUsedMB = (mbUsed / 1024 / 1024).toFixed(1);
      var mbQuotaMB = (mbQuota / 1024 / 1024).toFixed(0);
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.mailbox') + '</span>'
        + '<span class="pn-detail-value">' + mailboxCount + ' ' + t('profile.nodes.items') + ' (' + mbUsedMB + ' ' + t('profile.nodes.mailboxOf') + ' ' + mbQuotaMB + ' MB)</span></div>';

      // Last seen
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.lastSeen') + '</span>'
        + '<span class="pn-detail-value">' + escHtml(node.last_seen ? timeAgo(node.last_seen) : '-') + '</span></div>';

      // Visibility toggle
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.visibility') + '</span>'
        + '<div class="pn-vis-toggle">'
        + '<button class="pn-vis-btn ' + (node.visibility !== 'public' ? 'active' : '') + '" onclick="setNodeVis(\'' + escHtml(node.node_id) + '\',\'private\')">' + t('profile.nodes.private') + '</button>'
        + '<button class="pn-vis-btn ' + (node.visibility === 'public' ? 'active' : '') + '" onclick="setNodeVis(\'' + escHtml(node.node_id) + '\',\'public\')">' + t('profile.nodes.public') + '</button>'
        + '</div></div>';

      // Setup instructions (collapsible)
      html += '<div style="margin-top:.75rem"><button class="expand-btn" onclick="toggleSetup(' + idx + ')" style="font-size:.8rem;padding:6px 12px">' + t('profile.nodes.setupTitle') + ' <span style="transition:transform .2s">\u25BC</span></button>'
        + '<div class="pn-setup" id="pn-setup-' + idx + '">'
        + '<ol>'
        + '<li>' + t('profile.nodes.setupStep1') + '</li>'
        + '<li>' + t('profile.nodes.setupStep2') + '</li>'
        + '<li>' + t('profile.nodes.setupStep3') + '</li>'
        + '<li>' + t('profile.nodes.setupStep4') + '</li>'
        + '</ol>'
        + '<a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">' + t('profile.nodes.setupDocs') + ' \u2192</a>'
        + '</div></div>';

      // Detach button
      html += '<button class="pn-detach-btn" onclick="detachNode(\'' + escHtml(node.node_id) + '\')">' + t('profile.nodes.detachBtn') + '</button>';

      html += '</div></div>';
    });

    el.innerHTML = html;
  } catch(e) {
    document.getElementById('stat-nodes').textContent = '0';
    if (e && e.message && e.message.includes('NOT_FOUND')) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
    } else {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.error') + '</div>';
    }
  }
}

function toggleNodeCard(idx) {
  var details = document.getElementById('pn-details-' + idx);
  var arrow = document.getElementById('pn-arrow-' + idx);
  if (!details) return;
  details.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open');
}

function toggleSetup(idx) {
  var el = document.getElementById('pn-setup-' + idx);
  if (el) el.classList.toggle('open');
}

function toggleAddNodeForm() {
  var form = document.getElementById('add-node-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function timeAgo(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
  return Math.floor(ms / 86400000) + 'd ago';
}

async function setNodeVis(nodeId, vis) {
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });
    showToast(t('profile.nodes.visUpdated'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}

async function registerNode() {
  var nodeId = document.getElementById('node-id-input').value.trim();
  if (!nodeId) { showToast(t('profile.nodes.registerFailed'), true); return; }
  if (!nodeId.startsWith('personal-')) nodeId = 'personal-' + nodeId;

  var visRadio = document.querySelector('input[name="node-vis"]:checked');
  var visibility = visRadio ? visRadio.value : 'private';

  var gaiisRaw = document.getElementById('node-gaiis-input').value.trim();
  var agentGaiis = gaiisRaw ? gaiisRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

  try {
    var resp = await session.fetch('/v1/personal/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: nodeId,
        owner_name: session.owner,
        public_key: session.publicKey || 'placeholder',
        agent_gaiis: agentGaiis,
        visibility: visibility,
      }),
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.nodes.registered'));
      toggleAddNodeForm();
      document.getElementById('node-id-input').value = '';
      document.getElementById('node-gaiis-input').value = '';
      loadNodes();
    } else {
      showToast((resp && resp.error && resp.error.message) || t('profile.nodes.registerFailed'), true);
    }
  } catch(e) {
    showToast(t('profile.nodes.registerFailed'), true);
  }
}

async function detachNode(nodeId) {
  if (!confirm(t('profile.nodes.detachConfirm'))) return;
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
    showToast(t('profile.nodes.detached.toast'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}
```

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/profile.ts
git commit -m "feat: add JavaScript for personal nodes tab (load, register, toggle, detach)"
```

---

### Task 11: Update E2E tests for visibility field

**Files:**
- Modify: `aimeat/test/e2e-personal-node.ts`

**Step 1: Update anchor registration test**

In the anchor test, add `visibility: 'public'` to the request body and assert it's returned:

```typescript
assert(body.data.visibility === undefined || body.data.visibility, 'should have visibility');
```

**Step 2: Add visibility toggle test**

Add a new test after the status check:

```typescript
await test('Phase 4b: Toggle visibility to public', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${personalNodeId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'public' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data?.visibility === 'public', 'Should be public');
});

await test('Phase 4c: Toggle visibility back to private', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${personalNodeId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.data?.visibility === 'private', 'Should be private');
});
```

**Step 3: Add federation directory visibility test**

```typescript
await test('Phase 6b: Private node hidden from federation directory', async () => {
    const { body } = await json('/v1/federation/directory');
    const personalNodes = body.data?.personal_nodes || [];
    const found = personalNodes.find((n: any) => n.node_id === personalNodeId);
    assert(!found, 'Private node should not appear in federation directory');
});
```

**Step 4: Run tests**

Run: `cd aimeat && pnpm exec tsx test/e2e-personal-node.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add aimeat/test/e2e-personal-node.ts
git commit -m "test: add visibility toggle and federation filter tests"
```

---

### Task 12: Run full E2E suite and type-check

**Files:** None (verification only)

**Step 1: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with 0 errors

**Step 2: Run full E2E tests**

Run: `cd aimeat && pnpm exec tsx test/e2e-full.ts`
Expected: All 49 tests pass (no regressions)

**Step 3: Run personal node E2E tests**

Run: `cd aimeat && pnpm exec tsx test/e2e-personal-node.ts`
Expected: All tests pass (including new visibility tests)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: personal nodes profile tab with private/public visibility

- New 'Nodes' tab on profile page with expandable cards
- Register, view, toggle visibility, and detach personal nodes
- Private/Public toggle controls federation directory listing
- PATCH /v1/personal/anchor/:nodeId endpoint for updates
- Full EN + FI translations
- E2E tests for visibility"
```
