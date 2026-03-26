# Extension & Cortex Memory Architecture

This document defines the memory namespace model, access patterns, and trust boundaries between extensions, cortex libraries, and apps. Every rule here is verified against the actual code.

---

## Three Memory Namespaces

| Namespace | Owner | Example key | Who can write | Who can read |
|-----------|-------|-------------|--------------|-------------|
| **Owner namespace** | Human user (GHII) | `i18n.fi`, `settings.config` | The user (via API with auth) | The user (auth required), extensions (via `ctx.memory.getPublic(gaii, key)`) |
| **Extension namespace** | `ext:{name}` | `ext:prh-yritystietopalvelu/watchlist.items` | Only the extension (via `ctx.memory.set()`) | Anyone (public, unauthenticated) |
| **Instance namespace** | `ext:{name}.{instanceId}` | `ext:alerts.user123/config` | Only the extension instance | Anyone (public) |

### Key principle: extensions own their namespace

An extension's `ctx.memory.set(key, value)` writes to `ext:{extensionName}` with `visibility: 'public'`. No one else can write to this namespace — not the cortex, not the app, not even the user directly.

**Code reference:** `src/routes/extensions.ts` line 1047: `const extMemoryOwner = 'ext:${ext.name}'`

---

## How Each Layer Accesses Data

### Extension (V8 sandbox, server-side)

```
ctx.memory.get(key)           → reads from ext:{name} namespace (own data)
ctx.memory.set(key, value)    → writes to ext:{name} namespace (own data, visibility: public)
ctx.memory.search(prefix)     → searches ext:{name} namespace
ctx.memory.delete(key)        → deletes from ext:{name} namespace
ctx.memory.getPublic(ns, key) → reads from ANY namespace (cross-read, public only)
ctx.fetch(url, opts)          → HTTP to external APIs
```

Extensions read owner seed data (translations, settings) via:
```javascript
const fi = await ctx.memory.getPublic(ctx.caller.gaii, 'i18n.fi');
```

**CRITICAL:** `ctx.caller.gaii` is the caller's GHII (e.g. `testuser@node-id`), NOT bare username. This was a bug (fixed in `extensions.ts` — `resolveIdentity()` is now used).

### Cortex (client-side JS, browser)

Cortex has FOUR internal helpers (never exported):

```javascript
readExtMemory(extName, key)    → AIMEAT.data.getPublic('ext:' + extName, key)
                                 // Unauthenticated GET /v1/memory/ext%3Aname/key
                                 // Returns the value or null

readOwnerMemory(key)           → AIMEAT.data.get(key)
                                 // Authenticated GET /v1/memory/key
                                 // Reads from current user's own namespace

writeOwnerMemory(key, value)   → AIMEAT.data.set(key, value)
                                 // Authenticated PUT /v1/memory/key
                                 // Writes to current user's own namespace

callExt(extName, actionId, body) → session.fetch('/v1/ext/' + extName + '/' + actionId, ...)
                                   // Authenticated POST, returns parsed JSON
                                   // session.fetch returns ALREADY-PARSED JSON — do NOT call .json()
```

### App (client-side JS, browser)

Apps call cortex public methods ONLY. They NEVER call:
- `callExt()` (private cortex helper)
- `readExtMemory()` (private cortex helper)
- `writeOwnerMemory()` (private cortex helper)
- `/v1/ext/...` directly (raw extension calls)
- `/v1/memory/ext:name/...` directly (raw memory reads)

```javascript
// App uses cortex public API:
const result = await AIMEAT.myLib.searchCompanies('Overscale');
const company = await AIMEAT.myLib.getCompany('3323553-5');
const tr = await AIMEAT.myLib.getTranslations('fi');
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│  APP (browser)                                          │
│  Uses: AIMEAT.myLib.method()                            │
│  NEVER: callExt, readExtMemory, /v1/ext/, /v1/memory/  │
└──────────────────────┬──────────────────────────────────┘
                       │ calls public methods
┌──────────────────────▼──────────────────────────────────┐
│  CORTEX (browser IIFE)                                  │
│  Reads ext data:  readExtMemory() → getPublic()         │
│  Reads user data: readOwnerMemory() → AIMEAT.data.get() │
│  Writes user data: writeOwnerMemory() → AIMEAT.data.set()│
│  Calls extension: callExt() → POST /v1/ext/name/action  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP calls
┌──────────────────────▼──────────────────────────────────┐
│  EXTENSION (V8 sandbox, server-side)                    │
│  Owns: ext:{name} namespace (read/write)                │
│  Reads: owner namespace via getPublic(gaii, key)        │
│  Fetches: external APIs via ctx.fetch()                 │
│  DECIDES: what to store, how to structure, what to      │
│           return — cortex trusts the contract            │
└─────────────────────────────────────────────────────────┘
```

---

## Trust Boundaries

1. **Extension is sovereign over its namespace.** It decides what to store, what format, what keys. No one else modifies ext:{name} data.

2. **Cortex trusts extension's API contract.** When cortex calls `callExt('prh', 'searchCompanies', {query})`, it trusts the extension returns `{companies, totalResults}` or an error. Cortex handles errors gracefully but does not second-guess the extension's data structure.

3. **App trusts cortex's public API.** The app never bypasses cortex to call extensions or read memory directly.

4. **Public reads are unauthenticated.** `GET /v1/memory/ext%3Aname/key` requires no JWT — anyone can read ext:{name} data. This is by design: extension data is public.

5. **User data requires authentication.** `GET /v1/memory/key` (owner namespace) requires a valid JWT.

---

## Init Copy Pattern (CRITICAL)

When a service is installed, seed data (translations, settings) is stored in the **owner's namespace** by the memory/translation generator components. But other users can't read owner namespace data.

The extension's `@activate` init action MUST copy this data to ext:{name}:

```javascript
// In extension init action:
export default async function(ctx, input) {
  // Read from owner namespace
  const fi = await ctx.memory.getPublic(ctx.caller.gaii, 'i18n.fi');
  const settings = await ctx.memory.getPublic(ctx.caller.gaii, 'settings.config');

  // Copy to extension namespace (public, readable by all)
  if (fi) await ctx.memory.set('i18n.fi', fi);
  if (settings) await ctx.memory.set('settings.config', settings);

  // Initialize data structures
  const existing = await ctx.memory.get('watchlist.items');
  if (!existing) await ctx.memory.set('watchlist.items', []);

  return { success: true };
}
```

**Why:** Cortex reads from ext:{name} namespace which is public. If data stays in owner namespace, cortex can't find it.

---

## Common Mistakes

### 1. Wrong API path for callExt
```javascript
// WRONG — this path doesn't exist:
session.fetch('/v1/extensions/' + name + '/actions/' + action, ...)

// CORRECT:
session.fetch('/v1/ext/' + name + '/' + action, ...)
```

### 2. Using raw fetch instead of AIMEAT.data
```javascript
// WRONG — manual URL construction, no error handling:
const resp = await fetch('/v1/memory/ext%3Aname/' + key);

// CORRECT — uses AIMEAT library:
const value = await AIMEAT.data.getPublic('ext:name', key);
```

### 3. Cortex registration API format
```javascript
// WRONG — single lib object:
{ manifest: yaml, lib: { filename: 'foo.js', code: jsCode } }

// CORRECT — libs dict:
{ manifest: yaml, libs: { 'foo.js': jsCode } }
```

### 4. session.fetch returns parsed JSON
```javascript
// WRONG — double-parsing:
const resp = await session.fetch(url, opts);
const json = await resp.json(); // CRASHES — resp is already parsed

// CORRECT:
const resp = await session.fetch(url, opts);
const data = resp.data; // Already parsed
```

### 5. Flat vs nested translation keys
Generator produces flat keys (`"tab.search": "Haku"`). The `t()` function must check flat key first, then try nested path:
```javascript
function t(key, translations) {
  if (!key || !translations) return key || '';
  if (translations[key] != null) return translations[key]; // flat
  // ... then try nested dot-path traversal
}
```

### 6. Cortex activate is idempotent
Re-activating an already-active cortex SKIPS `activateExtension()`. To update code, you must deactivate first, then activate:
```
POST /v1/cortex/{name}/deactivate
POST /v1/cortex/{name}/activate
```

---

## Code References

| File | What it does |
|------|-------------|
| `src/routes/extensions.ts:1047` | Sets `extMemoryOwner = 'ext:${ext.name}'` for extension memory |
| `src/routes/extensions.ts:1013` | `callerGaii = resolveIdentity(req.auth!, config.nodeId)` |
| `src/routes/extensions.ts:1075-1088` | `ctx.memory.getPublic()` implementation |
| `src/routes/memory.ts:832-910` | Public memory read route `GET /v1/memory/:gaii/:key` (no auth) |
| `src/routes/lib-data.ts:106-115` | `AIMEAT.data.getPublic()` browser implementation |
| `src/routes/cortex.ts:48-86` | Cortex registration (expects `libs` dict) |
| `src/routes/cortex.ts:230-271` | Cortex activate (idempotent — skips if already active) |
| `public/js/services/generator-prompts-base.js:1582-1619` | `NAMESPACE_RULES` constant |
| `public/js/services/generator-prompts-base.js:1703-1744` | `EXTENSION_CONSUMPTION_RULES` constant |
