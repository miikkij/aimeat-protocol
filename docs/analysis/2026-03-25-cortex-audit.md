# Cortex Library System — Complete Factual Audit

**Date:** 2026-03-25
**Scope:** How cortex libraries are registered, served, and consumed; what the prompts tell AI; discrepancies.

---

## 1. Cortex Extension Registration & Serving (`src/routes/cortex.ts`)

### Lifecycle

1. **Install** (`POST /v1/cortex`) — accepts YAML manifest string + optional `libs` object (filename->content map). Validates manifest via `parseCortexManifest()`. Stores lib files via `storage.setCortexLibFile()`. Status starts as `inactive`.

2. **Activate** (`POST /v1/cortex/:name/activate`) — processes all components in the manifest:
   - `schema` -> `storage.setSchema()`
   - `ontology` -> stored as memory key `__cortex__/{ext.name}/ontology/{comp.name}`
   - `prompt` -> stored as memory key `__cortex__/{ext.name}/prompts/{comp.name}`
   - `action` -> `storage.createAction()`
   - `board-template` -> `storage.createBoard()` + seed posts
   - `seed-data` -> `storage.setMemory()` per entry
   - `lib` -> just recorded in artifacts (file already stored during install)

3. **Deactivate** (`POST /v1/cortex/:name/deactivate`) — removes schemas, prompts (memory), ontologies (memory), actions, boards. Does NOT remove seed-data or lib files.

4. **Uninstall** (`DELETE /v1/cortex/:name`) — deactivates first, then removes seed-data, lib files, and the extension record.

### URL for Serving Lib Files

**Route (line 451):**
```
GET /v1/cortex/:name/libs/:libFile
```

- No auth required (public endpoint)
- Only serves from **active** extensions
- Returns `Content-Type: application/javascript; charset=utf-8`
- Cache-Control: `public, max-age=86400` (24 hours)

**Actual URL pattern:** `/v1/cortex/{extensionName}/libs/{filename.js}`

### Other Cortex Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /v1/cortex` | requireAuth | List installed extensions |
| `POST /v1/cortex` | requireAuth + owner | Install from manifest |
| `GET /v1/cortex/:name` | requireAuth | Extension details |
| `DELETE /v1/cortex/:name` | requireAuth + owner | Uninstall |
| `POST /v1/cortex/:name/activate` | requireAuth + owner | Activate |
| `POST /v1/cortex/:name/deactivate` | requireAuth + owner | Deactivate |
| `POST /v1/cortex/:name/visibility` | requireAuth + owner | Toggle public/private |
| `GET /v1/cortex/:name/prompts` | requireAuth | List prompts |
| `GET /v1/cortex/:name/prompts/:promptName` | requireAuth | Get prompt with variable substitution |
| `GET /v1/cortex/:name/ontology` | requireAuth | Get ontology data |
| `GET /v1/cortex/:name/export` | requireAuth + owner | Export manifest + libs for editing |
| `GET /v1/cortex/:name/libs/:libFile` | **none** | Serve JS lib file (public) |

---

## 2. Browser Auth Library (`AIMEAT.auth`) — `src/routes/libs.ts`

### `getSession()` (line 594)

Returns `currentSession` (the session object) or `null` if not logged in.

### Session Object Properties (line 372-442)

```
session.ghii    — string or null
session.owner   — string (owner name)
session.gaii    — string or null
session.jwt     — string (JWT token)
session.roles   — string[] (from JWT payload)
session.publicKey — string
session.nodeUrl — string (NODE_URL)
session.valid   — boolean getter (checks JWT not expired)
```

### session.fetch() — THE CRITICAL FUNCTION (line 389-397)

**Actual implementation:**
```javascript
async fetch(path, opts = {}) {
  if (isExpired(session.jwt)) {
    await session.refresh();
  }
  const url = NODE_URL + path;
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.jwt, ...(opts.headers || {}) };
  const resp = await fetch(url, { ...opts, headers });
  return resp.json();
},
```

**RETURNS: Already-parsed JSON (the result of `resp.json()`). NOT a Response object.**

This means:
- `session.fetch('/v1/memory')` returns the AIMEAT envelope directly: `{ ok: true, data: {...}, ... }`
- You access `result.ok`, `result.data`, `result.error` directly
- Calling `.json()` on the result will CRASH ("not a function")

### requestParentAuth() Session (line 641-692)

The iframe-based session also has a `fetch()` that returns `resp.json()` (already-parsed JSON). Same behavior.

### Other AIMEAT.auth API

| Method | Returns | Notes |
|--------|---------|-------|
| `register(username, displayName, opts)` | Promise<session> | Creates GHII, gets JWT |
| `login(username?)` | Promise<session\|null> | Restores from localStorage |
| `loginWithPassword(username, password)` | Promise<session> | Password-based login |
| `getSession()` | session\|null | Current session |
| `logout()` | Promise<void> | Clears everything |
| `hasSession` | boolean getter | Check if stored |
| `storedGhii` | string\|null getter | Get stored GHII |
| `on(event, fn)` | void | Event listener |
| `off(event, fn)` | void | Remove listener |
| `inSandbox` | boolean getter | Check if in iframe |
| `requestParentAuth(timeout?)` | Promise<session\|null> | Iframe auth |
| `mountLoginButton(selector, opts)` | void | Render login UI |

---

## 3. Browser Data Library (`AIMEAT.data`) — `src/routes/lib-data.ts`

### How `authFetch` Works (line 31-34)

```javascript
async function authFetch(path, opts) {
  const session = getSession();   // calls AIMEAT.auth.getSession()
  return session.fetch(path, opts);  // returns already-parsed JSON
}
```

So ALL `AIMEAT.data` methods receive already-parsed JSON from `session.fetch()` and then access `.ok`, `.data`, `.error` on it.

### AIMEAT.data API (actual behavior)

| Method | Signature | Returns | URL Called |
|--------|-----------|---------|------------|
| `set(key, value, opts)` | `set(key, value, {visibility?, tags?})` | `res.data` (unwrapped) | `POST /v1/memory` |
| `get(key)` | `get(key)` | `res.data.value` or `null` | `GET /v1/memory/{key}` |
| `getEntry(key)` | `getEntry(key)` | Full `res.data` object or `null` | `GET /v1/memory/{key}` |
| `update(key, value, version, opts)` | `update(key, value, version)` | `res.data` | `PUT /v1/memory/{key}` |
| `delete(key)` | `delete(key)` | `res.data` | `DELETE /v1/memory/{key}` |
| `list(opts)` | `list({prefix?, visibility?, tags?})` | `res.data` | `GET /v1/memory?params` |
| `search(query, opts)` | `search(query, {visibility?})` | `res.data` | `GET /v1/memory/search?q=...` |
| `getPublic(gaii, key)` | `getPublic(gaii, key)` | `res.data.value` or `null` | `GET /v1/memory/{gaii}/{key}` |
| `micro(setName, accessCode)` | returns micro-memory sub-API | see below | `GET /v1/mm?params` |
| `microSets()` | `microSets()` | `res.data` | `GET /v1/mm?op=list` |

### CRITICAL: `getPublic()` Implementation (line 106-115)

```javascript
async getPublic(gaii, key) {
  const url = NODE_URL + '/v1/memory/' + encodeURIComponent(gaii) + '/' + encodeURIComponent(key);
  const r = await fetch(url);          // RAW fetch — NO auth
  const res = await r.json();
  if (!res.ok) {
    if (res.error?.code === 'NOT_FOUND') return null;
    throw new Error(res.error?.message || 'Failed to read public memory');
  }
  return res.data.value;
},
```

**Key facts about `getPublic()`:**
- Uses raw `fetch()`, NOT `session.fetch()` — no auth token
- This is correct because the backend route `GET /v1/memory/:gaii/:key` serves public-visibility data without auth
- URL pattern: `GET /v1/memory/{encodeURIComponent(gaii)}/{encodeURIComponent(key)}`
- Returns `res.data.value` directly (unwrapped), or `null` if NOT_FOUND

**To read extension data:** `AIMEAT.data.getPublic('ext:my-extension', 'some.key')`
- The `gaii` parameter is `'ext:my-extension'` (the extension namespace)
- The `key` parameter is the memory key
- Backend resolves `ext:my-extension` as the ownerGaii parameter

### Server-side Route for Public Memory Read (`src/routes/memory.ts:834`)

```
GET /v1/memory/:gaii/:key
```
- No auth required for public-visibility data
- Decodes both `:gaii` and `:key` via `decodeURIComponent()`
- Calls `storage.getMemory(gaii, key)` — uses gaii as the ownerGaii
- Returns the full record if visibility is 'public'

---

## 4. Extension Action Calls — URL Pattern

### Actual Route (`src/routes/extensions.ts`)

```
POST /v1/ext/:extName/:actionId          (line 1009)
POST /v1/ext/:extName/:instanceId/:actionId  (line 771, for instances)
```

**ALL extension actions use POST.** There is no GET route for extension actions.

### How Cortex Calls Extensions

From the cortex template code (generator-prompts-base.js line 1193-1206):

```javascript
async function callExt(extName, actionId, body, method = 'POST') {
  const session = AIMEAT.auth && AIMEAT.auth.getSession();
  if (!session) return null;
  const opts = { method };
  if (method === 'POST' || method === 'PUT') {
    opts.body = JSON.stringify(body || {});
  }
  const url = method === 'GET' && body && Object.keys(body).length > 0
    ? '/v1/ext/' + extName + '/' + actionId + '?' + new URLSearchParams(body).toString()
    : '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(url, opts);
  if (!resp || !resp.ok) return null;
  return resp.data;  // ALREADY parsed — never call resp.json()
}
```

**Key facts:**
- Uses `session.fetch()` which returns already-parsed JSON
- Accesses `resp.data` directly (the AIMEAT envelope's data field)
- The template code supports GET method but the actual backend only has POST routes
- Headers: `Content-Type: application/json`, `Authorization: Bearer {jwt}` (set by session.fetch)

### Discrepancy: GET vs POST for Extension Actions

The prompt text at line 1083-1103 says:
> "method MUST match the extension action's declared method (GET or POST)"

And at line 1101-1103:
> "CRITICAL: Check the extension manifest above -- each action declares its HTTP method. Use `callExt(EXT.name, 'actionId', {input}, 'GET')` for GET actions"

But the `EXTENSION_CONSUMPTION_RULES` at line 1549 says:
> "ALL actions use POST (even if manifest says GET -- the route is POST-only)"

**This is a direct contradiction in the prompts.** The cortex template tells AI to use the manifest's declared method, but EXTENSION_CONSUMPTION_RULES says ALL actions are POST-only. The actual backend only has POST routes, so EXTENSION_CONSUMPTION_RULES is correct.

---

## 5. Prompt Content — What the AI is Told

### session.fetch() Return Type

The prompts correctly warn about this in MULTIPLE places:

**Cortex template (line 1188-1191):**
```
// CRITICAL: session.fetch() returns ALREADY-PARSED JSON (not Response).
// Do NOT call resp.json() — it will crash. Use resp.data directly.
```

**App template (line 634-638):**
```
CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.
Do NOT call resp.json() — it will crash with "not a function".
Access resp.ok, resp.data, resp.error directly.
```

### Extension Namespace Reading

The prompts correctly explain:

**EXTENSION_CONSUMPTION_RULES (line 1554-1559):**
```
Extension data lives in ext:{name} namespace.
Read it: getPublic('ext:{name}', key) or readExtMemory(name, key)

NEVER read extension data via /v1/memory/{key} — that reads the OWNER's
namespace, not the extension's. You'll get null.
```

**Cortex template (line 1177-1186) provides correct `readExtMemory` implementation:**
```javascript
async function readExtMemory(extName, key) {
  if (AIMEAT.data && AIMEAT.data.getPublic) {
    return AIMEAT.data.getPublic('ext:' + extName, key);
  }
  const url = nodeUrl() + '/v1/memory/' + encodeURIComponent('ext:' + extName) + '/' + encodeURIComponent(key);
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const json = await resp.json();
  return json.ok ? json.data.value : null;
}
```

Note: The fallback path (line 1182-1185) uses raw `fetch()` and calls `resp.json()` — this is correct because it's using the browser's native `fetch()`, not `session.fetch()`. The result IS a Response object here.

### NAMESPACE_RULES (line 1442-1476)

Correctly explains:
- Owner namespace: where memory components store data
- Extension namespace (`ext:{name}`): where extension runtime data lives
- `ctx.memory.get()` reads from extension's own namespace
- `ctx.memory.getPublic(ctx.caller.owner, key)` reads owner data from extension code
- Client-side: `readExtMemory(name, key)` or `getPublic('ext:{name}', key)` for extension data
- Client-side: `/v1/memory/{key}` or `AIMEAT.data.get(key)` for owner data
- Client CANNOT write to `ext:{name}` namespace — must use `callExt()`

### Init Contract (line 1583-1600)

- Extension `@activate` init: runs on activation AND every restart, must be idempotent
- Cortex `init()`: UI readiness check ONLY, returns `{ ready: true/false, hasData: true/false }`
- NEVER call `callExt()` from cortex `init()`
- NEVER set up timers or intervals in cortex `init()`

---

## 6. Complete Discrepancy List

### CONFIRMED DISCREPANCY: GET vs POST for Extension Actions

**Cortex template (line 1083-1103)** tells AI:
> "method MUST match the extension action's declared method (GET or POST)"
> "Use `callExt(EXT.name, 'actionId', {input}, 'GET')` for GET actions"

**EXTENSION_CONSUMPTION_RULES (line 1549)** tells AI:
> "ALL actions use POST (even if manifest says GET -- the route is POST-only)"

**Actual backend:** Only POST routes exist for extension actions.

**Impact:** If the cortex template wins (AI uses GET), the request will fail because there is no GET route. The EXTENSION_CONSUMPTION_RULES is correct but only appears in test prompts, not in the cortex generation prompt.

The cortex template at line 1083-1103 also has the `callExt` implementation that supports GET:
```javascript
const url = method === 'GET' && body && Object.keys(body).length > 0
    ? '/v1/ext/' + extName + '/' + actionId + '?' + new URLSearchParams(body).toString()
    : '/v1/ext/' + extName + '/' + actionId;
```

This GET path in callExt will hit a 404. The code at line 1193-1206 (the cortex example code) has the same pattern.

### CONFIRMED DISCREPANCY: callExt in cortex template vs EXTENSION_CONSUMPTION_RULES

The cortex template's callExt (line 1085-1098) throws on error:
```javascript
if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
return resp.data;
```

The cortex example code's callExt (line 1193-1206) returns null on error:
```javascript
if (!resp || !resp.ok) return null;
return resp.data;
```

The AI sees both versions and may use either. The example code version (return null) is safer and matches the design principle "Handle errors gracefully -- return null or empty arrays, don't throw for missing data."

### POTENTIAL ISSUE: readExtMemory Fallback Path

The cortex template's `readExtMemory` fallback (line 1182-1185) uses raw `fetch()`:
```javascript
const resp = await fetch(url);
if (!resp.ok) return null;
const json = await resp.json();
```

This is a raw browser `fetch()` call — it returns a Response object, so calling `resp.json()` is correct. BUT it has no auth token. This is fine because `GET /v1/memory/:gaii/:key` serves public data without auth. However, if the extension data is not public-visibility, this will fail.

Extension data stored via `ctx.memory.set()` gets visibility 'public' (based on extension storage code). So this works in practice.

### NO DISCREPANCY: session.fetch() Return Type

The prompts correctly and consistently document that `session.fetch()` returns already-parsed JSON, not a Response object. This is stated:
1. In the cortex template example code (line 1188-1191)
2. In the app template (line 634-638)
3. In the comment on the callExt function (line 1205)

The actual implementation (libs.ts line 389-397) confirms: `return resp.json()` — which returns the parsed JSON object from the AIMEAT envelope.

---

## 7. Summary of Key Facts

### session.fetch()
- **Returns:** Already-parsed JSON (AIMEAT envelope: `{ ok, data, error, ... }`)
- **NOT a Response object.** Never call `.json()` on it.
- **Access:** `result.ok`, `result.data`, `result.error`

### Extension Action URL
- **Pattern:** `POST /v1/ext/{extensionName}/{actionId}`
- **Auth:** Required (Bearer JWT, injected by session.fetch)
- **Body:** JSON
- **Response:** AIMEAT envelope `{ ok: true, data: {action return value} }`

### Memory Read for Extension Data
- **From browser/cortex:** `AIMEAT.data.getPublic('ext:{extensionName}', 'memory.key')`
- **Under the hood:** `GET /v1/memory/{encodeURIComponent('ext:' + extName)}/{encodeURIComponent(key)}`
- **No auth needed** (public-visibility data)
- **Returns:** The `value` field directly, or `null`

### Memory Read for Owner Data
- **From browser:** `AIMEAT.data.get('memory.key')` (uses session.fetch, authenticated)
- **Under the hood:** `GET /v1/memory/{key}` with Bearer token
- **From extension code:** `ctx.memory.getPublic(ctx.caller.owner, 'key')`

### Cortex Lib Serving
- **URL:** `GET /v1/cortex/{extensionName}/libs/{filename.js}`
- **No auth required**
- **Only active extensions**
- **Cached 24h**

### How Cortex Libraries Register in the Browser
```javascript
(function (AIMEAT) {
  const LIB_NAME = 'myDomainLib';  // camelCase
  // ... library code ...
  const exports = { init, getData, getStats };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
```

Access: `window.AIMEAT.myDomainLib.init()`

---

## 8. Files Referenced

| File | Purpose |
|------|---------|
| `aimeat/src/routes/cortex.ts` | Cortex extension CRUD, activation, lib serving |
| `aimeat/src/routes/libs.ts` | Browser auth library (AIMEAT.auth), served at `/v1/libs/aimeat-auth.js` |
| `aimeat/src/routes/lib-data.ts` | Browser data library (AIMEAT.data), served at `/v1/libs/aimeat-data.js` |
| `aimeat/src/routes/memory.ts` | Memory routes including public read at `/v1/memory/:gaii/:key` |
| `aimeat/src/routes/extensions.ts` | Extension action routes at `POST /v1/ext/:extName/:actionId` |
| `aimeat/public/js/services/generator-prompts-base.js` | COMPONENT_TEMPLATES (cortex, app), EXTENSION_CONSUMPTION_RULES, NAMESPACE_RULES, SANDBOX_CONSTRAINTS |
| `aimeat/public/js/services/generator-prompts-build.js` | Blueprint prompt, interview prompt, component prompt dispatcher |
| `aimeat/public/js/services/generator-prompts-test.js` | Test prompt generation for all component types |
