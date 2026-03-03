# Node Portal — Implementation Roadmap

> **Parent:** [00-overview.md](00-overview.md)

---

## Phase 1: Template Engine & GET /

> **Goal:** Every node serves a portal at `/`. Custom template or default. Template tags resolve from memory/storage/config.  
> **Files changed:** 7 new/modified  
> **Dependencies:** None

### Step 1.1 — Configuration

**File:** `src/config.ts`

Add site config fields to `AimeatConfig`:

```typescript
siteEnabled: boolean;                // Default: true
siteMaxTemplateSizeKb: number;       // Default: 512
siteCacheTtlSeconds: number;         // Default: 60
siteKv: Record<string, string>;      // Parsed from AIMEAT_SITE_KV_* env vars
```

Add env var parsing in `loadConfig()`:

```typescript
siteEnabled: env.AIMEAT_SITE_ENABLED !== 'false',
siteMaxTemplateSizeKb: Number(env.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB) || 512,
siteCacheTtlSeconds: Number(env.AIMEAT_SITE_CACHE_TTL_SECONDS) || 60,
siteKv: Object.fromEntries(
  Object.entries(env)
    .filter(([k]) => k.startsWith('AIMEAT_SITE_KV_'))
    .map(([k, v]) => [k.replace('AIMEAT_SITE_KV_', '').toLowerCase(), v])
),
```

### Step 1.2 — Storage Interface

**File:** `src/storage/interface.ts`

Add `PortalChangeLogEntry` interface and 2 storage methods:

```typescript
interface PortalChangeLogEntry {
  id: string;
  action: 'template_upload' | 'template_delete' | 'import' | 'cache_invalidate';
  summary: string;
  changedBy: string;
  changedAt: Date;
}

// In Storage interface:
addPortalChangeLog(entry: PortalChangeLogEntry): Promise<void>;
listPortalChangeLog(limit: number, cursor?: string): Promise<PortalChangeLogEntry[]>;
```

Template HTML itself is stored via the existing storage system using the reserved key `__site_template__`.

### Step 1.3 — In-Memory Storage

**File:** `src/storage/memory.ts`

1. Add `portalChangeLog: PortalChangeLogEntry[]`
2. Implement `addPortalChangeLog` and `listPortalChangeLog`

### Step 1.4 — SiteService (Template Resolver)

**File:** `src/services/site.ts` (NEW)

```typescript
export class SiteService {
  private cache: { html: string; expiresAt: number } | null = null;

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {}

  async getPortalHtml(locale: string): Promise<string> {
    // Check cache
    if (this.cache && Date.now() < this.cache.expiresAt) return this.cache.html;

    // Try custom template
    const templateRecord = await this.storage.getFile('__site_template__');
    if (!templateRecord) {
      // No custom template — fall back to default portal
      return humanPortalHtml(this.config, t, locale, stats);
    }

    const html = await this.resolveTemplate(templateRecord.data.toString('utf-8'));

    // Cache
    this.cache = { html, expiresAt: Date.now() + this.config.siteCacheTtlSeconds * 1000 };
    return html;
  }

  async resolveTemplate(template: string): Promise<string> {
    const TAG_REGEX = /\{\{(config|memory|storage|kv):([^}]+)\}\}/g;
    const matches = [...template.matchAll(TAG_REGEX)];

    // Batch memory lookups
    const memoryKeys = matches.filter(m => m[1] === 'memory').map(m => m[2]);
    const memoryValues = await this.batchGetMemory(memoryKeys);

    // Batch storage lookups
    const storageKeys = matches.filter(m => m[1] === 'storage').map(m => m[2]);
    const storageUrls = await this.batchGetStorageUrls(storageKeys);

    return template.replace(TAG_REGEX, (_full, type, key) => {
      switch (type) {
        case 'config': return escapeHtml(this.getConfigValue(key));
        case 'memory': return memoryValues.get(key) ?? '';
        case 'storage': return escapeHtml(storageUrls.get(key) ?? '');
        case 'kv':     return escapeHtml(this.config.siteKv[key] ?? '');
        default:       return '';
      }
    });
  }

  invalidateCache(): void { this.cache = null; }
}
```

### Step 1.5 — Site Route Handler

**File:** `src/routes/site.ts` (NEW)

1. `siteRouter(config, storage): Router` factory
2. `GET /` — calls `SiteService.getPortalHtml()`, returns raw HTML
3. `GET /v1/site` — JSON portal metadata
4. `GET /v1/site/template` — download current template (operator)
5. `POST /v1/site/template` — upload template (operator, validates)
6. `DELETE /v1/site/template` — delete custom template (operator)
7. `POST /v1/site/import` — import bundle (operator)
8. `GET /v1/site/changelog` — change log (operator)
9. `POST /v1/site/cache-invalidate` — bust cache (operator)
10. `GET /v1/site/prompt` — AI navigation prompt

### Step 1.6 — Server Registration

**File:** `src/server.ts`

1. Import `siteRouter`
2. Register: `app.use(siteRouter(config, storage))`
3. `GET /` must be registered after static file middleware but before 404 handler

### Step 1.7 — Verification

```bash
npx tsc --noEmit
pnpm dev
# Open http://localhost:40050/ → see default portal (same as /v1/portal)
curl http://localhost:40050/v1/site
# Upload a custom template:
curl -X POST http://localhost:40050/v1/site/template \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"template": "<html><body><h1>{{config:nodeName}}</h1><p>{{memory:portal/welcome}}</p></body></html>"}'
# Write portal memory:
curl -X POST http://localhost:40050/v1/memory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"portal/welcome","value":"Hello from my node!"}'
# Bust cache + refresh browser:
curl -X POST http://localhost:40050/v1/site/cache-invalidate -H "Authorization: Bearer $TOKEN"
# Open http://localhost:40050/ → see custom portal with resolved tags
```

---

## Phase 2: AI-Assisted Editor

> **Goal:** Operator generates portal content by chatting with AI  
> **Files changed:** 2 new  
> **Dependencies:** Phase 1

### Step 2.1 — Sysadmin Prompt Template

**File:** `docs/node-portal/sysadmin-prompt-template.md` (NEW)

A prompt the operator copies to Claude/ChatGPT/Copilot. AI interviews operator, then generates an importable JSON bundle.

Key content:
- Questions about purpose, region, language, services, aesthetics
- Template tag reference (`{{config:*}}`, `{{memory:*}}`, `{{storage:*}}`, `{{kv:*}}`)
- Output schema matching `POST /v1/site/import` body
- Examples of good portals (minimal, community hub, enterprise)
- CSS guidelines (responsive, accessible, dark mode optional)

### Step 2.2 — In-Portal Editor Prompt

**File:** `src/routes/site.ts` (extend `GET /v1/site/prompt`)

Return the sysadmin prompt with node-specific context injected:
- Current template (if any)
- Current KV values
- Available memory keys under `portal/*`
- Node capabilities summary

### Step 2.3 — Workflow Verification

```
1. Operator runs: curl http://localhost:40050/v1/site/prompt
2. Copies prompt to AI chat
3. AI asks questions → operator answers
4. AI generates JSON bundle
5. Operator runs: curl -X POST /v1/site/import -d @bundle.json
6. Portal is live
```

---

## Phase 3: System Board

> **Goal:** Operator-only announcements board, posts visible on portal  
> **Files changed:** 3 modified  
> **Dependencies:** Phase 1

### Step 3.1 — Board Visibility Extension

**File:** `src/routes/boards.ts`

1. Allow `system` visibility in board creation
2. Operator-only guards for creation and posting
3. Skip morsel cost for `system` board posts
4. Public-readable (same as `public`)

### Step 3.2 — Template Tag: {{board:slug}}

**File:** `src/services/site.ts`

Add `board` as a template tag type — resolves to the 5 most recent posts from a board:

```html
{{board:announcements}}
<!-- Resolves to -->
<div class="board-posts">
  <article>
    <h3>Maintenance planned</h3>
    <time>2026-03-02</time>
    <p>We'll be offline Saturday 14:00-16:00...</p>
  </article>
  ...
</div>
```

The HTML generated by `{{board:*}}` uses CSS classes so the template can style them.

### Step 3.3 — Schema Update

**File:** `src/models/schemas.ts`

Update board creation schema to accept `'system'` visibility.

---

## Phase 4: Admin Dashboard Editor

> **Goal:** Web-based portal editor in the admin dashboard  
> **Files changed:** 1-2 new frontend files  
> **Dependencies:** Phase 1, admin dashboard exists

### Step 4.1 — Portal Tab

**File:** Admin dashboard (existing)

New "Portal" tab showing:
- Current template preview (iframe)
- Template editor (code editor with syntax highlighting for `{{tags}}`)
- Memory keys list (key → value, editable)
- KV pairs list (editable)
- Upload/download buttons
- "Reset to default" button
- Change log

### Step 4.2 — AI Chat Panel

Inside the Portal tab, an optional chat panel where the operator describes changes in natural language, and the backend (or client-side AI) generates template/memory updates.

---

## Phase 5: Load-Balancer Sync

> **Goal:** LB nodes mirror portal content from origin node  
> **Files changed:** 3 new/modified  
> **Dependencies:** Phase 1

See [04-sync-mode.md](04-sync-mode.md) for full design.

### Step 5.1 — Config: LB mode settings
### Step 5.2 — Origin Endpoint: `GET /v1/site/sync`
### Step 5.3 — Sync Job: `src/services/site-sync.ts`
### Step 5.4 — Block writes when LB mode active

---

## E2E Test Plan

Add to `test/e2e-full.ts`:

| # | Test | Phase |
|---|---|---|
| 1 | `GET /` returns default portal HTML | 1 |
| 2 | `POST /v1/site/template` uploads template | 1 |
| 3 | `GET /` returns resolved custom template | 1 |
| 4 | Template `{{config:nodeId}}` resolves correctly | 1 |
| 5 | Template `{{memory:key}}` resolves from memory | 1 |
| 6 | Template `{{kv:key}}` resolves from config KV | 1 |
| 7 | `POST /v1/site/import` writes template + memory + KV | 1 |
| 8 | `DELETE /v1/site/template` reverts to default | 1 |
| 9 | Cache invalidation works | 1 |
| 10 | Template size limit enforced | 1 |
| 11 | Script injection in `{{memory:*}}` blocked | 1 |
| 12 | `system` board creation (operator only) | 3 |
| 13 | System board post appears in `{{board:*}}` | 3 |
| 14 | Non-operator cannot post to system board | 3 |

---

## File Impact Summary

| File | Action | Phase |
|---|---|---|
| `src/config.ts` | Modify (add site fields) | 1 |
| `src/storage/interface.ts` | Modify (add changelog methods) | 1 |
| `src/storage/memory.ts` | Modify (implement changelog) | 1 |
| `src/services/site.ts` | **New** (SiteService + template resolver) | 1 |
| `src/routes/site.ts` | **New** (10 endpoints) | 1 |
| `src/server.ts` | Modify (register siteRouter) | 1 |
| `.env.example` | Modify (add AIMEAT_SITE_* vars) | 1 |
| `src/routes/boards.ts` | Modify (system visibility) | 3 |
| `src/services/site-sync.ts` | **New** (sync job) | 5 |
| `docs/node-portal/sysadmin-prompt-template.md` | **New** (AI prompt) | 2 |
