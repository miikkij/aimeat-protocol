# Node Portal — Load-Balancer Sync Mode

> **Parent:** [00-overview.md](00-overview.md)  
> **Depends on:** Phase 1 (Template engine)

---

## 1. Concept

A node can optionally operate as a **portal load-balancer** — it mirrors the portal template and portal-related memory keys from an origin node. This provides geographic redundancy and load distribution for popular nodes.

```
┌──────────────┐     pull sync every N min    ┌──────────────┐
│  Origin Node │ ◄─────────────────────────── │  LB Node     │
│  (Jouni)     │                               │  (CDN/edge)  │
│              │  GET /v1/site/sync?since=...  │              │
│  • Template  │ ────────────────────────────► │  • Template  │
│  • Memory    │                               │  • Memory    │
│  • KV pairs  │                               │  • KV pairs  │
└──────────────┘                               └──────────────┘
```

### Key Properties

- **Portal-only sync** — only template HTML, `portal/*` memory keys, and KV config are synced
- **Full node otherwise** — agents, memory (non-portal), work, wallet function independently
- **Pull-based** — LB node pulls from origin (origin doesn't need to know about LB nodes)
- **Origin always wins** — no conflict resolution needed
- **Independent identity** — LB node has its own `nodeId`, agents, economy

### What Is NOT Synced

- ❌ Non-portal memory keys
- ❌ Agents, actions, work — local to each node
- ❌ Wallet/economy — independent per node
- ❌ Federation peering — independent per node
- ❌ Admin config (except portal KV display config)
- ❌ User boards — only `system` visibility boards are synced

---

## 2. Configuration

### New Config Fields

```typescript
siteLbEnabled: boolean;           // Default: false
siteLbOriginUrl: string;          // Required when LB enabled — e.g. "https://aimeat.io"
siteLbSyncIntervalMin: number;    // Default: 30
siteLbSyncOnStartup: boolean;     // Default: true
```

### Environment Variables

```bash
AIMEAT_SITE_LB_ENABLED=true
AIMEAT_SITE_LB_ORIGIN_URL=https://aimeat.io
AIMEAT_SITE_LB_SYNC_INTERVAL_MIN=30
AIMEAT_SITE_LB_SYNC_ON_STARTUP=true
```

### Mutual Exclusion

When LB mode is active, portal content modification is blocked:

```typescript
const requireNotLb: RequestHandler = (_req, res, next) => {
  if (config.siteLbEnabled) {
    res.status(409).json(error(config.nodeId, 'LB_MODE',
      'Cannot modify portal content in load-balancer mode. Content synced from origin.'));
    return;
  }
  next();
};
// Applied to POST/DELETE /v1/site/template and POST /v1/site/import
```

---

## 3. Sync Protocol

### 3.1 Origin Endpoint

```
GET /v1/site/sync?since={ISO8601}
```

No authentication required — portal content is public.

**Response 200:**
```json
{
  "ok": true,
  "data": {
    "sync_timestamp": "2026-03-03T12:00:00.000Z",
    "template": {
      "html": "<!DOCTYPE html>...",
      "updated_at": "2026-03-01T10:00:00.000Z"
    },
    "memory_keys": [
      {
        "key": "portal/welcome",
        "value": "Tervetuloa AIMEAT-nodeen!",
        "updated_at": "2026-03-01T10:00:00.000Z"
      },
      {
        "key": "portal/services",
        "value": "<ul><li>Puheentunnistus</li></ul>",
        "updated_at": "2026-03-02T08:00:00.000Z"
      }
    ],
    "deleted_memory_keys": ["portal/old-page"],
    "kv": {
      "region": "Helsinki",
      "contact": "jouni@example.fi"
    },
    "system_board_posts": [
      {
        "id": "post-uuid-1",
        "title": "Maintenance planned",
        "body": "...",
        "created_at": "2026-03-02T09:00:00.000Z"
      }
    ],
    "deleted_post_ids": []
  }
}
```

- `since` filters by `updated_at` for template/memory, `created_at` for posts
- `deleted_memory_keys` and `deleted_post_ids` handle removes between syncs
- `template` is `null` if no custom template exists (LB uses default portal too)

### 3.2 Sync Job

```typescript
// src/services/site-sync.ts
export function startSiteSyncJob(config: AimeatConfig, storage: Storage, siteService: SiteService): void {
  const intervalMs = config.siteLbSyncIntervalMin * 60 * 1000;
  let lastSync: string | null = null;

  const doSync = async () => {
    try {
      const since = lastSync ?? '1970-01-01T00:00:00.000Z';
      const url = `${config.siteLbOriginUrl}/v1/site/sync?since=${encodeURIComponent(since)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Origin returned ${res.status}`);
      const { data } = await res.json();

      // Sync template
      if (data.template?.html) {
        await storage.putFile('__site_template__', Buffer.from(data.template.html, 'utf-8'));
      }

      // Sync portal memory keys
      for (const mem of data.memory_keys) {
        await storage.setMemory(mem.key, mem.value);
      }
      for (const key of data.deleted_memory_keys) {
        await storage.deleteMemory(key);
      }

      // Sync KV values
      if (data.kv) {
        config.siteKv = { ...config.siteKv, ...data.kv };
      }

      // Invalidate cache
      siteService.invalidateCache();

      lastSync = data.sync_timestamp;
      logger.info(`Portal sync completed from ${config.siteLbOriginUrl}`);
    } catch (err) {
      logger.error('Portal sync failed', err);
    }
  };

  if (config.siteLbSyncOnStartup) doSync();
  setInterval(doSync, intervalMs);
}
```

---

## 4. Admin Dashboard Integration

When LB mode is active, the Portal tab shows:

- **Origin URL** — displayed as link
- **Last Sync** — timestamp + relative time ("5 minutes ago")
- **Status** — idle / syncing / error (color badge)
- **Sync Now** button → `POST /v1/admin/site/sync`
- **Note:** "Portal content is read-only. Synced from {origin}."
- Template preview (read-only)
- Synced memory keys list (read-only)

### Manual Sync Trigger

```
POST /v1/admin/site/sync
```

**Auth:** `requireAuth()` + `requireRole('operator')`

Triggers an immediate sync outside the regular interval.

**Response 200:**
```json
{ "ok": true, "data": { "synced": true, "template_updated": true, "memory_keys_synced": 4 } }
```

---

## 5. Health Check

The sync status is exposed in the existing health endpoint:

```
GET /v1/health
```

Added fields when LB mode is active:

```json
{
  "site_lb": {
    "enabled": true,
    "origin_url": "https://aimeat.io",
    "last_sync": "2026-03-03T12:00:00.000Z",
    "sync_healthy": true
  }
}
```

`sync_healthy` is `false` if the last sync attempt failed or if the last successful sync was more than `2 × siteLbSyncIntervalMin` ago.
