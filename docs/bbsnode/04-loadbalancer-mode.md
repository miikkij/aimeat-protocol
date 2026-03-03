# BBS Node — Load-Balancer Node Mode

> **Parent:** [00-overview.md](00-overview.md)  
> **Depends on:** Phase 1-2 (Sysop Pages + System Board)

---

## 1. Concept

A **load-balancer node** is a full AIMEAT node that **mirrors BBS content** from a primary ("origin") node. The operator configures it to point at an origin, and it periodically syncs:

- Sysop pages (all locales)
- System board posts (announcements)
- A subset of configuration (MOTD, node description, categories)

This enables geographic redundancy and load distribution for popular nodes.

```
┌──────────────┐     sync every N min     ┌──────────────┐
│  Origin Node │ ◄──────────────────────── │  LB Node     │
│  (primary)   │                           │  (replica)   │
│              │     GET /v1/bbs/sync      │              │
│  • Pages     │ ─────────────────────────►│  • Pages     │
│  • Board     │                           │  • Board     │
│  • Config    │                           │  • Config    │
└──────────────┘                           └──────────────┘
```

### Key Properties

- **Read-only BBS content** — LB node does NOT allow local page creation (synced from origin)
- **Full node otherwise** — agents, memory, work, wallet all function normally  
- **Pull-based sync** — LB node pulls from origin (origin doesn't need to know about LB nodes)
- **Conflict resolution** — origin always wins (last-write-wins based on `updatedAt`)
- **Independent identity** — LB node has its own `nodeId`, own agents, own economy

---

## 2. Configuration

### 2.1 New Config Fields

```typescript
// In AimeatConfig
bbsLoadBalancerEnabled: boolean;       // Default: false — enables LB mode
bbsLoadBalancerOriginUrl: string;      // Required when LB enabled — origin node base URL
bbsLoadBalancerSyncIntervalMin: number; // Default: 30 — sync interval in minutes
bbsLoadBalancerSyncOnStartup: boolean;  // Default: true — sync immediately on boot
bbsLoadBalancerLastSync: string | null;  // ISO 8601 — last successful sync timestamp (runtime)
bbsLoadBalancerSyncStatus: 'idle' | 'syncing' | 'error'; // Runtime state
```

### 2.2 Environment Variables

```bash
AIMEAT_BBS_LB_ENABLED=true
AIMEAT_BBS_LB_ORIGIN_URL=https://primary.aimeat.io
AIMEAT_BBS_LB_SYNC_INTERVAL_MIN=30
AIMEAT_BBS_LB_SYNC_ON_STARTUP=true
```

### 2.3 Mutual Exclusion

BBS content creation is blocked when LB mode is active:

```typescript
// In bbs.ts routes
const requireNotLoadBalancer: RequestHandler = (_req, res, next) => {
  if (config.bbsLoadBalancerEnabled) {
    res.status(409).json(error(config.nodeId, 'LB_MODE', 
      'Cannot create/modify BBS content in load-balancer mode. Content is synced from origin.'));
    return;
  }
  next();
};

// Applied to POST, PUT, DELETE /v1/bbs/pages
```

---

## 3. Sync Protocol

### 3.1 Origin Endpoint

The origin node exposes a sync endpoint that LB nodes call:

```
GET /v1/bbs/sync?since={ISO8601}
```

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `since` | ISO 8601 | Return only content updated after this timestamp |

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "sync_timestamp": "2026-03-03T12:00:00.000Z",
    "pages": [
      {
        "id": "uuid-1",
        "slug": "welcome",
        "title": "Welcome",
        "body": "...",
        "category": "info",
        "locale": "en",
        "pinned": true,
        "sort_order": 0,
        "published_at": "2026-01-15T00:00:00.000Z",
        "updated_at": "2026-03-01T10:00:00.000Z",
        "created_at": "2026-01-15T00:00:00.000Z",
        "metadata": {},
        "_deleted": false
      }
    ],
    "deleted_page_ids": ["uuid-99"],
    "announcements": [
      {
        "id": "post-uuid-1",
        "title": "Maintenance March 5",
        "body": "...",
        "created_at": "2026-03-02T09:00:00.000Z",
        "_deleted": false
      }
    ],
    "deleted_announcement_ids": ["post-uuid-88"],
    "config": {
      "motd": "Welcome! New marketplace is live.",
      "node_description": "Community node for AI development",
      "categories": ["info", "guide", "news", "service"]
    }
  }
}
```

**Design notes:**
- `_deleted: true` marks soft-deleted items (LB node deletes local copies)
- `deleted_*_ids` array handles cases where items were deleted between syncs
- `config` subset only includes BBS display config, not security/economy settings
- `since` filter applies to `updatedAt` for pages, `createdAt` for announcements

### 3.2 Sync Endpoint Auth

The sync endpoint requires:
- **BBS must be enabled** on origin node
- **No authentication** — sync data is public BBS content by nature
- **Rate limited** — standard rate limiting applies (use dedicated tier if needed)
- **Optional API key** — origin operator can optionally require `X-Sync-Key` header for traceability

### 3.3 Sync Job

Background job running on the LB node:

```typescript
// In src/services/bbs-sync.ts
export function startBbsSyncJob(config: AimeatConfig, storage: Storage): void {
  const syncIntervalMs = config.bbsLoadBalancerSyncIntervalMin * 60 * 1000;
  
  const doSync = async () => {
    config.bbsLoadBalancerSyncStatus = 'syncing';
    try {
      const since = config.bbsLoadBalancerLastSync ?? '1970-01-01T00:00:00.000Z';
      const response = await fetch(
        `${config.bbsLoadBalancerOriginUrl}/v1/bbs/sync?since=${encodeURIComponent(since)}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      if (!response.ok) throw new Error(`Origin returned ${response.status}`);
      const { data } = await response.json();
      
      // Apply page updates
      for (const page of data.pages) {
        const existing = await storage.getSysopPageBySlug(page.slug, page.locale);
        if (existing) {
          await storage.updateSysopPage(existing.id, page);
        } else {
          await storage.createSysopPage(page);
        }
      }
      
      // Apply page deletions
      for (const id of data.deleted_page_ids) {
        await storage.deleteSysopPage(id);
      }
      
      // Apply config updates
      if (data.config) {
        config.bbsMotd = data.config.motd;
        config.bbsNodeDescription = data.config.node_description;
        config.bbsCategories = data.config.categories;
      }
      
      config.bbsLoadBalancerLastSync = data.sync_timestamp;
      config.bbsLoadBalancerSyncStatus = 'idle';
      logger.info(`BBS sync completed from ${config.bbsLoadBalancerOriginUrl}`);
    } catch (err) {
      config.bbsLoadBalancerSyncStatus = 'error';
      logger.error('BBS sync failed', err);
    }
  };

  // Sync on startup if configured
  if (config.bbsLoadBalancerSyncOnStartup) {
    doSync();
  }

  // Periodic sync
  setInterval(doSync, syncIntervalMs);
}
```

---

## 4. Admin Dashboard Integration

### 4.1 Sync Status Display

In the BBS tab of the admin dashboard, when LB mode is active:

- **Origin URL** — displayed as link
- **Last Sync** — timestamp + relative time ("5 minutes ago")
- **Status** — badge (idle=green, syncing=blue, error=red)
- **Sync Now** button — triggers immediate sync via admin API
- **Sync Log** — last 10 sync events with results

### 4.2 Manual Trigger Endpoint

```
POST /v1/admin/bbs/sync
```

**Auth:** Operator only

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "status": "syncing",
    "origin": "https://primary.aimeat.io",
    "last_sync": "2026-03-03T11:30:00.000Z"
  }
}
```

### 4.3 Sync Status Endpoint

```
GET /v1/admin/bbs/sync-status
```

**Auth:** Operator only

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "lb_enabled": true,
    "origin_url": "https://primary.aimeat.io",
    "sync_interval_min": 30,
    "last_sync": "2026-03-03T12:00:00.000Z",
    "status": "idle",
    "pages_synced": 12,
    "announcements_synced": 5
  }
}
```

---

## 5. Implementation Steps

### Step 9.1 — Sync Endpoint on Origin

**File:** `src/routes/bbs.ts`

Add `GET /v1/bbs/sync` endpoint:
- Query param `since` (ISO 8601)
- Returns pages + deleted IDs + announcements + config subset
- Guarded by `requireBbs`

### Step 9.2 — Configuration

**File:** `src/config.ts`

Add LB config fields + env var parsing.

### Step 9.3 — Sync Service

**File:** `src/services/bbs-sync.ts` (NEW)

1. `startBbsSyncJob(config, storage)` — periodic sync
2. `syncNow(config, storage)` — on-demand sync (for admin trigger)
3. Error handling with retry backoff

### Step 9.4 — Write Guard

**File:** `src/routes/bbs.ts`

Add `requireNotLoadBalancer` middleware to POST/PUT/DELETE routes.

### Step 9.5 — Admin Endpoints

**File:** `src/routes/admin.ts`

1. `POST /v1/admin/bbs/sync` — trigger sync
2. `GET /v1/admin/bbs/sync-status` — status info

### Step 9.6 — Dashboard UI

**File:** `src/routes/admin-dashboard.ts`

Add sync status panel to BBS tab.

### Step 9.7 — Server Registration

**File:** `src/server.ts`

Start sync job when `bbsEnabled && bbsLoadBalancerEnabled`.

### Step 9.8 — E2E Tests

**File:** `test/e2e-bbs.ts` (extend)

Additional test phase:
- LB config prevents local page creation
- Sync endpoint returns correct data from origin
- Manual sync trigger works

---

## 6. Security Considerations

| Concern | Mitigation |
|---|---|
| Origin spoofing | LB node only syncs from configured `AIMEAT_BBS_LB_ORIGIN_URL` |
| Sync data injection | Validate all synced data against Zod schemas before storage |
| SSRF via origin URL | Origin URL set via env var only (not runtime configurable) |
| Denial of service | Sync has 30s timeout, rate limited at origin |
| Data freshness | Sync timestamp tracked, status visible in dashboard |

---

## 7. Future Enhancements (Not In Scope)

- **Push-based sync** — Origin pushes updates to registered LB nodes (requires origin awareness)
- **Partial sync** — Sync only specific categories
- **Multi-origin** — LB node syncs from multiple origins (aggregation)
- **Sync authentication** — Mutual TLS or signed sync payloads
- **Read replica boards** — Sync non-system boards as well
