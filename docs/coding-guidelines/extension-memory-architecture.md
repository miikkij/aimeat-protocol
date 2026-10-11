# Extension & Cortex Memory Architecture

This document defines the memory namespace model, access patterns, and trust boundaries between extensions, cortex libraries, and apps. The short form of these rules is `.claude/rules/namespaces-memory.md`; where the two differ, the rule file wins.

---

## Three Memory Namespaces

| Namespace | Owner | Example key | Who can write | Who can read |
|-----------|-------|-------------|--------------|-------------|
| **Owner namespace** | Human user (GHII) | `service.i18n.fi`, `service.settings` | The user (via API with auth) | The user (auth required), extensions (via `ctx.memory.getPublic(gaii, key)`, public records only) |
| **Extension namespace** | `ext:{name}` | `ext:prh-yritystietopalvelu/watchlist.items` | Only the extension (via `ctx.memory.set()`) | Anyone, no auth, unless the write passed `{ visibility: 'private' }` |
| **Instance namespace** | `ext:{name}.{instanceId}` | `ext:alerts.user123/config` | Only the extension instance | Anyone, no auth, unless the write passed `{ visibility: 'private' }` |

There is a fourth place data can live and it is not memory at all: the owner's **secrets vault**,
which nothing reads back. See "Secrets: the fourth namespace" below before storing a credential
anywhere in the table above.

### Key principle: extensions own their namespace

An extension's `ctx.memory.set(key, value)` writes to `ext:{extensionName}`, with `visibility: 'public'` unless the call passes `{ visibility: 'private' }`. Nobody else can write to this namespace: not the cortex, not the app, not the user directly. Pass `private` on every write that holds somebody's personal data, because an `ext:` namespace is world-readable.

**Code reference:** `extMemoryOwner` in `src/routes/extensions/actions.ts` (`ext:${ext.name}`, or `ext:${ext.name}.${instanceId}` on the instance route) and in `src/mcp/extensions.ts` (`aimeat_extension_invoke`). The memory calls themselves are `buildExtensionCtx` in `src/services/extension-ctx.ts`.

---

## How Each Layer Accesses Data

### Extension (QuickJS WASM sandbox, server-side)

An action script has one `export default async function (ctx, input) { ... }`. Helper functions and constants may sit above it: `transformScript` in `src/services/extension-runtime.ts` rewrites the export in place and keeps them. There is no module loader, so a script cannot `import`.

```
ctx.memory.get(key)             → reads from ext:{name} namespace (own data)
ctx.memory.getVersioned(key)    → { value, version }, the version to swap against, or null
ctx.memory.set(key, value)      → writes to ext:{name} namespace (own data, visibility: public)
ctx.memory.set(key, v, { visibility: 'private' })
                                → same, but getPublic and the public read route return nothing
ctx.memory.set(key, v, { ifVersion })  → compare-and-swap; returns { ok, version }
ctx.memory.search(prefix)       → searches ext:{name} namespace
ctx.memory.delete(key)          → deletes from ext:{name} namespace
ctx.memory.getPublic(ns, key)   → reads from ANY namespace (cross-read, public records only)
ctx.fetch(url, opts)            → HTTP to external APIs
ctx.workspace.{index,get,write,writeDoc,publish}
                                → the CALLER's organism workspace, as the caller, through the same
                                  operations aimeat_workspace_read/_write/_publish run; present only
                                  when the manifest declares `workspace: { read, write }` and a real
                                  caller invoked the action (never on a scheduled run)
ctx.workspace.{publishRecords,deleteRecords}
                                → a BATCH (up to 1000 / 2000 records) in one host call, through the
                                  operations the batch publish and delete routes run
```

The full contract is `ExtensionCtx` in `src/services/extension-ctx-contract.ts`.

`ctx.workspace` is the one road from the sandbox into a namespace that is not `ext:`, and it does not
open the fence above: nothing is read or written under the extension's own authority. The caller's
membership, the creator's contributor grant, the caller's scopes (`memory:write` to write or publish,
`memory:purge` to remove records with `deleteRecords`, `organism:read` to read; an owner session
needs none of them), the space's locked schema and the publish gate all apply exactly as they do on
the MCP tools and the REST routes, and every refusal reaches the script as a thrown `CODE: message`.
The service is `src/services/workspace-tool-ops.ts`, the batch included; the sandbox binding is `src/services/extension-workspace.ts`. A batch of records goes through
`publishRecords` in one call: 500 records as `write` + `publish` would be 1000 calls, past the
default ceiling of 500.

### Anything you COUNT needs `ifVersion`

A plain `set` is read-increment-write, which is last-write-wins: two calls of the same action can
both read a stock of 1 and both write 0, and nothing anywhere says so. Stock, reservations, a
balance, a claim on a limited thing: all of them need the guard.

```javascript
export default async function (ctx, input) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await ctx.memory.getVersioned('stock');
    if (!read) return { ok: false, reason: 'no stock record' };
    const units = read.value.units;
    if (units < 1) return { ok: false, reason: 'sold out' };
    const wrote = await ctx.memory.set('stock', { units: units - 1 }, { ifVersion: read.version });
    if (wrote.ok) return { ok: true, left: units - 1 };
    // Somebody else got there first. Read again and retry.
  }
  return { ok: false, reason: 'too much contention' };
}
```

`ifVersion: 0` means "only if this key does not exist yet", which is how you create a counter without
two callers each creating their own. A refused write changes nothing and reports the version really
there. Omit `ifVersion` and the write is last-write-wins.

An extension that needs the caller's own data (translations, settings) reads it where it is, in the
caller's namespace:
```javascript
const fi = await ctx.memory.getPublic(ctx.caller.gaii, 'service.i18n.fi');
```

`ctx.caller.gaii` is the caller's resolved identity (`resolveIdentity` in `src/utils/gaii.ts`): a
person's GHII (`alice@node-id`) or an agent's GAII, never the bare account name. `getPublic` returns
only a record whose visibility is `public`.

### Cortex (client-side JS, browser)

A cortex keeps four internal helpers and does not export them:

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
                                   // Authenticated POST, resolves to the parsed envelope
                                   // Do NOT call .json(); check res.ok before res.data
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
│  EXTENSION (QuickJS-WASM sandbox, server-side)          │
│  Owns: ext:{name} namespace (read/write)                │
│  Reads: owner namespace via getPublic(gaii, key)        │
│  Fetches: external APIs via ctx.fetch()                 │
│  DECIDES: what to store, how to structure, what to      │
│           return; cortex trusts the contract            │
└─────────────────────────────────────────────────────────┘
```

---

## Trust Boundaries

1. **Extension is sovereign over its namespace.** It decides what to store, what format, what keys. No one else modifies ext:{name} data.

2. **Cortex trusts extension's API contract.** When cortex calls `callExt('prh', 'searchCompanies', {query})`, it trusts the extension returns `{companies, totalResults}` or an error. Cortex handles errors and does not second-guess the extension's data structure.

3. **App trusts cortex's public API.** The app never bypasses cortex to call extensions or read memory directly.

4. **Public reads are unauthenticated.** `GET /v1/memory/ext%3Aname/key` requires no JWT: anyone can read a public ext:{name} record. This is by design. A record written with `{ visibility: 'private' }` is not served on this route.

5. **User data requires authentication.** `GET /v1/memory/key` (owner namespace) requires a valid JWT.

6. **A credential is in neither namespace, and the script never holds it.** The owner's secrets
   vault (`/v1/secrets`, table `Secret`) is the fourth place data can live here, and the only one
   nothing reads back: not the owner, not an export, not a tool. An extension asks for a secret by
   writing `{{secret:NAME}}` in an outbound HEADER VALUE, and `ctx.fetch` substitutes it after the
   script has handed the request over. So the script can SEND a credential and cannot LEARN
   one, which is what makes it safe for an AI to write the script and a stranger to open the page it
   renders.

---

## Secrets: the fourth namespace

| Where | Who writes | Who reads |
|-------|-----------|-----------|
| **The owner's vault** (`/v1/secrets`) | the owner, or an agent or app holding `secrets:manage` | **nobody**; only `ctx.fetch`, into a header, on the way out |

```javascript
// In an extension action. The value is not here, and cannot be got here.
const res = await ctx.fetch('https://api.example.com/v1/prices', {
  headers: { Authorization: 'Bearer {{secret:PRICES_KEY}}' },
});
```

Three rules, and each one closes a way the value could leak back:

- **Header values only.** A placeholder in the URL, the body, or a header NAME is left exactly as it
  arrived. Substituting into any of those would put the value where the script or the far end can
  read it back as data.
- **The CALLER's vault, then the extension's own `secrets` config, then a refusal.** The vault is per
  owner GHII, so the owner at a screen, their agent and their granted app all reach one vault; a
  `secrets` field in the manifest is the operator's shared fallback for a key everyone on the node
  should be able to use, and the person's own entry always wins. A name in neither refuses with
  `SECRET_UNKNOWN`, names the secret and the header, and sends nothing.
- **Never resolve a secret inside a script.** A script that resolves its own secret HOLDS it, in a
  variable, for the length of the call, and every extension wanting the same thing would have to
  write the same code and get it right. What a script still decides is which headers may leave at
  all, which is the extension's own business.

`usedBy` on each secret records which extensions resolved it and when, because a secret is named
inside a document, a config or a workflow and the vault can see none of those. It is the only answer
this node has to "what breaks if I delete this".

Full reference: `src/services/owner-secrets.ts` (the one implementation), `src/routes/secrets.ts`
(the three routes), `src/services/extension-ctx.ts` (the resolution point).

---

## Translations and settings are user data

Translations and settings belong to the user and live in the user's own namespace. A cortex reads
them with `AIMEAT.data.get(key)`, never from an `ext:` namespace:

```javascript
// In a cortex lib:
const fi = await AIMEAT.data.get('service.i18n.fi');
const settings = await AIMEAT.data.get('service.settings');
```

Do not copy them into `ext:{name}` from an extension's init action. A copy makes the user's own data
world-readable, goes stale the moment the user edits the original, and puts a second source of truth
in a namespace the user cannot write.

Where the records come from:

- **A cortex `seed-data` component** writes its entries at activation as `public` records in the
  activating principal's namespace (`activateExtension` in `src/routes/cortex/activation.ts`).
  Deactivation keeps them; uninstall removes them.
- **The user, or their agent,** writes them like any other memory record.

`AIMEAT.data.get` (`src/static/sdk-libs/data/index.js`) reads the signed-in user's own namespace
first. When that value is empty and the call names no `agent` or `ownerScope`, it falls back to a
public read from the app creator's namespace (the `aimeat-creator` meta tag, or the owner in the
`/v1/apps/{owner}/` path). That fallback is how a visitor to someone else's app sees the creator's
default translations.

The bundled `aimeat-i18n` cortex (`public/cortex-bundled/aimeat-i18n.js`) follows this pattern:
with `keyBase: 'myapp.i18n'` it reads `myapp.i18n.en` and `myapp.i18n.fi` through `AIMEAT.data.get`.
Use it rather than writing your own loader.

An extension that needs the same values reads them from the caller's namespace with
`ctx.memory.getPublic(ctx.caller.gaii, key)` (see above), each time it needs them.

---

## Common Mistakes

The app-builder registry `src/data/appdev-pitfalls.ts` holds the same traps for agents that build
apps (`three-namespaces`, `callext-path`, `session-fetch-parsed`, `cortex-register-reactivate`,
`ext-manifest-strict`).

### 1. Wrong API path for callExt
```javascript
// WRONG: POST on this path answers 404. It exists only for GET and PATCH of the action's script.
session.fetch('/v1/extensions/' + name + '/actions/' + action, ...)

// CORRECT:
session.fetch('/v1/ext/' + name + '/' + action, ...)
// An instance:
session.fetch('/v1/ext/' + name + '/' + instanceId + '/' + action, ...)
```

### 2. Using raw fetch instead of AIMEAT.data
```javascript
// WRONG: manual URL construction, no error handling:
const resp = await fetch('/v1/memory/ext%3Aname/' + key);

// CORRECT: uses AIMEAT library:
const value = await AIMEAT.data.getPublic('ext:name', key);
```

### 3. Cortex registration API format
```javascript
// WRONG: single lib object:
{ manifest: yaml, lib: { filename: 'foo.js', code: jsCode } }

// CORRECT: libs dict:
{ manifest: yaml, libs: { 'foo.js': jsCode } }
```

The install is refused, naming the file, when a lib component has no bytes under `libs`
(`libsWithoutContent` in `src/services/cortex-lifecycle.ts`).

### 4. session.fetch returns the parsed envelope
```javascript
// WRONG: double-parsing:
const resp = await session.fetch(url, opts);
const json = await resp.json(); // CRASHES: resp is already parsed

// CORRECT: a refusal is a value, not a thrown error:
const resp = await session.fetch(url, opts);
if (!resp.ok) { showError(resp.error.message); return; }
const data = resp.data;
```

### 5. Flat vs nested translation keys
A translation record may hold flat keys (`"tab.search": "Haku"`) or nested ones
(`{ tab: { search: "Haku" } }`). A `t()` lookup must check the flat key first, then try the nested
path. `AIMEAT.i18n.t` in the bundled `aimeat-i18n` cortex already does this:
```javascript
function t(key, translations) {
  if (!key || !translations) return key || '';
  if (translations[key] != null) return translations[key]; // flat
  // ... then try nested dot-path traversal
}
```

### 6. Activating an active cortex does nothing
Activating a cortex that is already active returns `alreadyActive: true` and does not run
activation again (`activateCortex` in `src/services/cortex-lifecycle.ts`). To ship new code, send
the new manifest and libs to:
```
PUT /v1/cortex/{name}
```
It replaces the cortex in place, without a gap where the lib is missing, and re-runs activation for
an active cortex (`upsertCortex` in `src/routes/cortex/upsert.ts`). Over MCP, the same redeploy is
`aimeat_cortex_install` with `update: true`. Deactivate then activate is not needed.

---

## Code References

| File and symbol | What it does |
|------|-------------|
| `src/routes/extensions/actions.ts` (`extMemoryOwner`) | Sets the extension's namespace, `ext:${ext.name}` or `ext:${ext.name}.${instanceId}`, on `POST /v1/ext/...` |
| `src/mcp/extensions.ts` (`extMemoryOwner`) | The same for `aimeat_extension_invoke` |
| `src/routes/extensions/actions.ts` (`callerGaii`) | `resolveIdentity(req.auth!, config.nodeId)`, the value the script sees as `ctx.caller.gaii` |
| `src/services/extension-ctx.ts` (`buildExtensionCtx`) | `ctx.memory.get/set/search/delete/getPublic` and `ctx.fetch` |
| `src/services/extension-ctx-contract.ts` (`ExtensionCtx`) | The context contract a script is written against |
| `src/services/extension-runtime.ts` (`transformScript`) | How an action script's `export default` is loaded |
| `src/routes/memory/public-read.ts` (`registerPublicReadRoute`) | Public memory read route `GET /v1/memory/:gaii/:key` (no auth) |
| `src/static/sdk-libs/data/index.js` (`get`, `getPublic`) | `AIMEAT.data.get()` with its creator fallback, and `AIMEAT.data.getPublic()` |
| `src/services/cortex-lifecycle.ts` (`installCortex`, `activateCortex`) | Cortex install (expects the `libs` dict) and activate (no-op when already active) |
| `src/routes/cortex/upsert.ts` (`upsertCortex`) | `PUT /v1/cortex/:name`: redeploy in place, re-run activation |
| `src/routes/cortex/activation.ts` (`activateExtension`) | What an activation writes, `seed-data` included |
