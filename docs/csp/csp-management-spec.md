# CSP Management Specification

> Configurable Content Security Policy for AIMEAT nodes — operator and user levels.

## Problem

CSP headers are currently hardcoded in `src/server-bootstrap/static-files.ts`. When a user installs a service that needs external connections (e.g., `wss://mqtt.hsl.fi` for real-time transit data, or `https://api.example.com` for a REST API), there is no way to allow it without changing server code and restarting.

The global CSP already permits `wss:` and `ws:` broadly in `connect-src`, but other directives (`script-src`, `img-src`, `frame-src`) are locked down. User-generated apps work around this with `<meta>` CSP tags, but that only applies to inline app downloads — not the main SPA, profile views, or shared pages.

## Goals

1. Operators can manage node-wide CSP rules from the admin dashboard
2. Users can add per-user CSP extensions from their profile
3. User rules can only **widen** the policy, never remove operator-set or default rules
4. Changes take effect without server restart
5. Backward-compatible — nodes without custom CSP behave exactly as today

## Non-Goals

- Per-app CSP management (apps already have `<meta>` tag override)
- CSP reporting endpoint (`report-uri` / `report-to`) — future work
- Restricting users to stricter-than-default policies

---

## Architecture

### Layers (merged top-down)

```
Layer 0: Hardcoded defaults (current static-files.ts policy)
Layer 1: Node-level overrides (operator, stored in node config)
Layer 2: User-level additions (per-user, stored in user memory)
─────────────────────────────────────────────────────────
Result:  Union of all layers per directive
```

Each layer is a map of CSP directive names to arrays of source values:

```typescript
interface CspRuleSet {
  'script-src'?: string[];
  'style-src'?: string[];
  'connect-src'?: string[];
  'img-src'?: string[];
  'font-src'?: string[];
  'frame-src'?: string[];
  'media-src'?: string[];
  'worker-src'?: string[];
}
```

### Merge Logic

```
final[directive] = dedupe([
  ...defaults[directive],
  ...nodeOverrides[directive],
  ...userAdditions[directive],
])
```

- Defaults are never removed — they are always included
- Node overrides ADD to defaults (operator can also remove default entries via a separate `remove` list if needed)
- User additions ADD to the merged result — users cannot remove anything

### Special Keywords

These CSP values are **never user-configurable** (operator-only or hardcoded):

- `'unsafe-inline'` — operator decision only
- `'unsafe-eval'` — operator decision only
- `'none'` — structural, not user-settable
- `'nonce-*'` — auto-generated per request, not configurable
- `data:` / `blob:` — operator decision only

Users can only add **origin-based** values: `https://example.com`, `https://*.example.com`, `wss://mqtt.example.com`, etc.

---

## Storage

### Node-Level CSP (operator)

Stored as a node configuration key, loaded at startup and cached in memory:

```
Storage key: system:csp-overrides
Value: {
  add: { "connect-src": ["https://api.example.com"], ... },
  remove: { "connect-src": ["ws:"], ... }  // optional: remove defaults
}
```

The `remove` field is operator-only and allows tightening defaults (e.g., removing `ws:` to enforce TLS-only WebSockets).

### User-Level CSP (per user)

Stored in the user's memory namespace:

```
Memory key: settings.csp
Value: {
  add: { "connect-src": ["wss://mqtt.hsl.fi:443"], "img-src": ["https://*.tile.openstreetmap.org"] }
}
```

No `remove` field — users can only add.

---

## API

### Admin: Node CSP

```
GET    /v1/admin/csp          — Read current node CSP overrides
PUT    /v1/admin/csp          — Update node CSP overrides
DELETE /v1/admin/csp          — Reset to defaults (remove all overrides)
GET    /v1/admin/csp/resolved — Read the fully merged CSP for a given user (debug)
```

**Auth:** `requireRole('operator')`

#### PUT /v1/admin/csp

```json
{
  "add": {
    "connect-src": ["https://api.example.com", "wss://mqtt.hsl.fi:443"],
    "script-src": ["https://unpkg.com"]
  },
  "remove": {
    "connect-src": ["ws:"]
  }
}
```

#### GET /v1/admin/csp/resolved?owner=johndoe

Returns the final merged CSP header string for debugging:

```json
{
  "header": "default-src 'self'; script-src 'self' 'nonce-{NONCE}' https://cdnjs.cloudflare.com ...; connect-src 'self' wss: https://api.example.com wss://mqtt.hsl.fi:443; ...",
  "layers": {
    "defaults": { "connect-src": ["'self'", "wss:", "ws:"], ... },
    "node": { "add": { "connect-src": ["https://api.example.com"] }, "remove": { "connect-src": ["ws:"] } },
    "user": { "add": { "connect-src": ["wss://mqtt.hsl.fi:443"] } }
  }
}
```

### User: Profile CSP

```
GET /v1/profile/csp  — Read own CSP additions
PUT /v1/profile/csp  — Update own CSP additions
DELETE /v1/profile/csp — Remove all personal CSP additions
```

**Auth:** `requireAuth()`

#### PUT /v1/profile/csp

```json
{
  "add": {
    "connect-src": ["wss://mqtt.hsl.fi:443"],
    "img-src": ["https://*.tile.openstreetmap.org"]
  }
}
```

**Validation:**
- Only origin-based values accepted (must start with `https://`, `http://`, `wss://`, `ws://`, or be a wildcard subdomain `*.example.com`)
- Rejects `'unsafe-inline'`, `'unsafe-eval'`, `data:`, `blob:`, `'none'`
- Max 20 entries per directive
- Max 200 total entries per user

---

## Middleware Integration

### CSP Builder (new module)

`src/middleware/csp.ts` — replaces the hardcoded CSP string in `static-files.ts`:

```typescript
export function buildCspHeader(
  nonce: string,
  nodeOverrides: CspRuleSet | null,
  userAdditions: CspRuleSet | null,
): string;
```

### Request Flow

1. `static-files.ts` generates nonce (unchanged)
2. New middleware reads node CSP overrides from cache (loaded at startup, refreshed on PUT)
3. For authenticated requests: reads user CSP additions from memory (with short TTL cache)
4. Calls `buildCspHeader(nonce, nodeOverrides, userAdditions)`
5. Sets `Content-Security-Policy` header

### Caching Strategy

- **Node overrides:** In-memory cache, invalidated on `PUT /v1/admin/csp`
- **User additions:** Per-user LRU cache (max 500 entries, 5-minute TTL)
- **Unauthenticated requests:** Use node overrides only (no user layer)

---

## Admin Dashboard UI

### Location

New section in existing **Node Settings** tab or a dedicated **Security** tab in admin dashboard.

### UI Elements

```
CSP Configuration
─────────────────────────────────────────────

Directive        │ Default Sources              │ Node Additions        │ Actions
─────────────────┼──────────────────────────────┼───────────────────────┼─────────
connect-src      │ 'self' wss: ws:              │ https://api.ex.com    │ [+ Add] [x]
script-src       │ 'self' 'nonce-*' cdnjs jsdr  │                       │ [+ Add]
img-src          │ 'self' data: blob:           │                       │ [+ Add]
style-src        │ 'self' 'unsafe-inline' fonts │                       │ [+ Add]
...              │                              │                       │

[Add directive source]  [Reset to defaults]

── Removed Defaults ──
connect-src: ws:  [Restore]
```

### Operator Workflow

1. Click `[+ Add]` next to a directive
2. Enter origin (e.g., `wss://mqtt.hsl.fi:443`)
3. Save — takes effect immediately for all users
4. Optional: click default source to remove it (moves to "Removed Defaults")

---

## Profile UI

### Location

New **Security** section in profile settings, or within the existing settings tab.

### UI Elements

```
Connection Permissions
─────────────────────────────────────────────

Your installed services may need to connect to external servers.
Add allowed origins here if a service requires it.

Directive        │ Your Additions                │ Actions
─────────────────┼───────────────────────────────┼──────────
connect-src      │ wss://mqtt.hsl.fi:443         │ [x Remove]
img-src          │ https://*.tile.osm.org        │ [x Remove]

[+ Add new permission]
```

### User Workflow

1. Service installation hints which CSP additions are needed (via cortex/app metadata)
2. User clicks `[+ Add]`, selects directive, enters origin
3. Save — takes effect on next page load

---

## Generator Integration

Apps and cortex libraries generated by the generator can declare required CSP additions in their metadata:

```yaml
# In cortex manifest or app metadata
spec:
  csp:
    connect-src:
      - "wss://mqtt.hsl.fi:443"
    img-src:
      - "https://*.tile.openstreetmap.org"
```

When a user installs a service, the generator UI can prompt:

```
This service needs additional network permissions:
  - WebSocket: wss://mqtt.hsl.fi:443 (real-time transit data)
  - Images: https://*.tile.openstreetmap.org (map tiles)

[Allow and install]  [Review details]  [Cancel]
```

On "Allow and install", the generator automatically calls `PUT /v1/profile/csp` to add the required origins.

---

## Implementation Order

### Phase 1: Core (minimal viable)

1. `src/middleware/csp.ts` — CSP builder with merge logic
2. `src/routes/admin-csp.ts` — Admin API endpoints
3. Storage: node CSP overrides in system config
4. Integrate into `static-files.ts` (replace hardcoded string)
5. Admin dashboard UI (basic table + add/remove)

### Phase 2: User Level

6. `src/routes/profile-csp.ts` — User API endpoints
7. Storage: user CSP additions in user memory
8. Profile UI (simple add/remove)
9. Per-request user CSP merging with cache

### Phase 3: Generator Integration

10. CSP declaration in cortex/app manifests (`spec.csp`)
11. Generator UI prompt on install
12. Auto-apply CSP additions on service activation

---

## Security Considerations

- **Input validation is critical.** Malformed CSP values can weaken security or cause header injection. All values must be validated against a strict origin pattern.
- **Operator can override users.** If an operator removes a default and a user adds it back, the operator's `remove` takes precedence.
- **Audit logging.** CSP changes (both node and user level) should be logged for security audit.
- **No `'unsafe-eval'` from users.** Even operators should get a confirmation warning before enabling `'unsafe-eval'`.
- **Rate limiting.** CSP endpoints should have standard rate limiting to prevent abuse.

## Validation Rules

Origins must match:

```
^(https?|wss?):\/\/(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(\:\d+)?(\/.*)?$
```

Reject:
- Bare `*` (too broad)
- `data:`, `blob:` (operator-only)
- Any CSP keyword (`'unsafe-inline'`, `'unsafe-eval'`, `'none'`, `'self'`, `'nonce-*'`)
- Empty strings, whitespace-only values
