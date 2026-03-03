# Node Portal — Architecture

> **Parent:** [00-overview.md](00-overview.md)

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       AIMEAT Node                            │
│                                                              │
│  GET / ──────────────► ┌──────────────────┐                  │
│  (browser request)     │  Site Router     │                  │
│                        │  src/routes/     │                  │
│  /v1/site/* ──────────►│  site.ts         │                  │
│  (API)                 └────────┬─────────┘                  │
│                                 │                            │
│                          ┌──────┴──────┐                     │
│                          │ SiteService │                     │
│                          │  - resolve  │                     │
│                          │    template │                     │
│                          │  - manage   │                     │
│                          │    template │                     │
│                          └──────┬──────┘                     │
│                                 │                            │
│          ┌──────────────────────┼────────────────┐           │
│          ▼                      ▼                ▼           │
│   ┌────────────┐        ┌────────────┐    ┌────────────┐    │
│   │  Memory    │        │  Storage   │    │  Config    │    │
│   │ {{memory:}}│        │ {{storage:}│    │ {{config:}}│    │
│   │ live data  │        │  template  │    │ {{kv:}}    │    │
│   │ from node  │        │  + media   │    │ safe vals  │    │
│   └────────────┘        └────────────┘    └────────────┘    │
│                                                              │
│   Default template: portal-human.ts output (used when       │
│   no custom template uploaded)                              │
│                                                              │
│   Existing & untouched:                                     │
│   /v1/portal/* (AI platform onboarding)                     │
│   /v1/boards/*, /v1/memory/*, /v1/actions/*, etc.          │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Template Storage

The portal template is stored as a **storage file** using the existing storage system.

### Where the Template Lives

```
Storage key: __site_template__
Content-Type: text/html
Owner: operator's GAII
```

- When `GET /` is requested, SiteService checks for the `__site_template__` storage key
- If found → resolve template tags → serve
- If not found → serve default template (existing `portal-human.ts` output)

No new storage mechanism. The template is just another file in the storage system with a reserved key.

### Template Size Limit

Configurable, default 512KB — more than enough for a rich single-page portal.

```
AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB=512
```

---

## 3. Template Resolver

The core of the system. A lightweight function that replaces `{{type:key}}` tags with resolved values.

```typescript
// src/services/site.ts

const TAG_REGEX = /\{\{(config|memory|storage|kv):([^}]+)\}\}/g;

// Whitelist of safe config keys
const SAFE_CONFIG_KEYS = new Set([
  'nodeId', 'nodeType', 'baseUrl', 'nodeName', 'nodeDescription',
  'federationName', 'locale', 'version',
]);

export class SiteService {
  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {}

  async resolveTemplate(template: string, operatorGaii: string): Promise<string> {
    // Collect all unique tags first to batch memory/storage lookups
    const tags = [...template.matchAll(TAG_REGEX)];
    
    // Group by type for efficient batch resolution
    const memoryKeys = new Set<string>();
    const storageIds = new Set<string>();
    for (const [, type, key] of tags) {
      if (type === 'memory') memoryKeys.add(key);
      if (type === 'storage') storageIds.add(key);
    }

    // Batch-fetch memory values
    const memoryValues = new Map<string, string>();
    for (const key of memoryKeys) {
      const mem = await this.storage.getMemory(operatorGaii, key);
      if (mem?.value != null) {
        memoryValues.set(key, typeof mem.value === 'string' 
          ? mem.value 
          : JSON.stringify(mem.value));
      }
    }

    // Resolve all tags
    return template.replace(TAG_REGEX, (_match, type: string, key: string) => {
      switch (type) {
        case 'config':
          if (!SAFE_CONFIG_KEYS.has(key)) return ''; // block unsafe keys
          return escapeHtml(String((this.config as Record<string, unknown>)[key] ?? ''));
        
        case 'memory':
          return memoryValues.get(key) ?? '';
        
        case 'storage':
          return `/v1/storage/${encodeURIComponent(key)}`;
        
        case 'kv':
          return escapeHtml(this.config.siteKv?.[key] ?? '');
        
        default:
          return '';
      }
    });
  }

  /** Get the portal HTML — custom template or default */
  async getPortalHtml(locale: string): Promise<string> {
    const templateFile = await this.storage.getFile('__site_template__');
    
    if (templateFile) {
      // Custom template — resolve tags
      const html = templateFile.content.toString('utf-8');
      const operatorGaii = templateFile.ownerGaii;
      return this.resolveTemplate(html, operatorGaii);
    }
    
    // No custom template — serve default portal
    return null; // caller falls back to humanPortalHtml()
  }
}
```

### Security: HTML Escaping

- `{{config:*}}` and `{{kv:*}}` values are **HTML-escaped** (prevent XSS)
- `{{memory:*}}` values are **NOT escaped** — they can contain valid HTML (operator intentionally writes HTML/Markdown content into memory)
- `{{storage:*}}` produces a URL path (safe by construction)

This is safe because:
- Only the **operator** can write memory keys and upload templates
- The operator is trusted — it's their own node
- Memory content is operator-authored, not user-input

### Performance: Caching

Template resolution happens on every `GET /` request. To avoid hitting memory/storage on each request:

```typescript
// Cache resolved HTML for 60 seconds
private cache: { html: string; expires: number } | null = null;
private CACHE_TTL_MS = 60_000;

async getPortalHtml(locale: string): Promise<string | null> {
  if (this.cache && Date.now() < this.cache.expires) {
    return this.cache.html;
  }
  // ... resolve template ...
  this.cache = { html: resolved, expires: Date.now() + this.CACHE_TTL_MS };
  return resolved;
}
```

Cache is invalidated when:
- Template is uploaded/updated (`POST /v1/site/template`)
- KV pairs change (`PUT /v1/admin/config` with `site.kv.*`)
- Manual cache bust (`POST /v1/site/cache-invalidate`)

Memory/storage changes take up to 60s to appear — acceptable for a portal.

---

## 4. Configuration

### New Config Fields

```typescript
// In AimeatConfig
siteKv: Record<string, string>;       // Default: {} — operator key-value pairs
siteMaxTemplateSizeKb: number;        // Default: 512
siteCacheTtlSeconds: number;          // Default: 60
```

### Environment Variables

```bash
# KV pairs — prefixed with AIMEAT_SITE_KV_
AIMEAT_SITE_KV_REGION=Oulu
AIMEAT_SITE_KV_CONTACT=timo@example.fi
AIMEAT_SITE_KV_TAGLINE=AI-agenttien koti pohjoisessa

# Template settings
AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB=512
AIMEAT_SITE_CACHE_TTL_SECONDS=60
```

---

## 5. Default Template

When no custom template is uploaded, `GET /` serves the existing portal from `portal-human.ts`. This is handled at the route level:

```typescript
// In src/routes/site.ts
router.get('/', async (req, res) => {
  const customHtml = await siteService.getPortalHtml(locale);
  
  if (customHtml) {
    res.type('text/html').send(customHtml);
  } else {
    // Fall back to existing portal
    res.type('text/html').send(humanPortalHtml(config, t, locale, stats));
  }
});
```

The existing portal already works great. No changes needed to `portal-human.ts`.

---

## 6. AI-Assisted Portal Creation

### The Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  1. Operator  │    │  2. AI       │    │  3. Node     │
│  copies the   │───►│  interviews  │───►│  imports the │
│  sysadmin     │    │  operator,   │    │  bundle:     │
│  prompt to    │    │  generates   │    │  - template  │
│  their AI     │    │  a bundle    │    │  - memory    │
│               │    │              │    │    writes     │
└──────────────┘    └──────────────┘    └──────────────┘
```

### What the AI Generates

The AI produces a **portal bundle** — a JSON file with:

```json
{
  "template": "<html>...{{memory:portal/welcome}}...</html>",
  "memory": {
    "portal/welcome": "Tervetuloa Oulun AIMEAT-nodeen!",
    "portal/services": "<ul><li>Puheentunnistus</li><li>Kuvien generointi</li></ul>",
    "portal/about": "Timo pyörittää tätä nodea Oulusta käsin..."
  },
  "kv": {
    "region": "Oulu",
    "contact": "timo@example.fi"
  }
}
```

### Import Endpoint

`POST /v1/site/import` accepts this bundle and:
1. Validates template size
2. Stores template in storage (`__site_template__`)
3. Writes memory keys
4. Updates KV config
5. Invalidates cache
6. Logs change

---

## 7. Change Log

Every portal modification is logged:

```typescript
export interface PortalChangeLogEntry {
  id: string;
  action: 'template_upload' | 'template_delete' | 'import' | 'kv_update';
  summary: string;
  changedBy: string;       // Operator GAII
  changedAt: string;       // ISO 8601
  previousTemplateId?: string;  // Storage ID of previous template (for rollback)
}
```

Stored as memory keys under `portal/__changelog/*` or in a dedicated array.

---

## 8. Board System: `system` Visibility

Same as previously designed — extending board visibility with `system`:

- **Write:** operator only
- **Read:** everyone (including anonymous)
- **Morsel cost:** none
- **Use in portal:** `{{memory:portal/announcements}}` can fetch system board posts

---

## 9. File Impact Summary

| File | Change | Description |
|---|---|---|
| `src/services/site.ts` | **New** | SiteService: template resolver, cache, management |
| `src/routes/site.ts` | **New** | `GET /`, `/v1/site/*` routes |
| `src/config.ts` | **Extend** | `siteKv`, `siteMaxTemplateSizeKb`, `siteCacheTtlSeconds` |
| `src/server.ts` | **Extend** | Register site router |
| `src/routes/boards.ts` | **Modify** | `system` visibility support |
| `src/routes/admin.ts` | **Extend** | `site.*` and `site.kv.*` config paths |
| `src/routes/admin-dashboard.ts` | **Extend** | Portal tab (template editor, KV editor) |
| `locales/en.json` | **Extend** | Portal translations |
| `locales/fi.json` | **Extend** | Portal translations |
| `test/e2e-site.ts` | **New** | Portal E2E tests |
