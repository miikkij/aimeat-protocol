# Extension System Audit — Full Factual Picture

Date: 2026-03-25
Files analyzed:
- `aimeat/src/routes/extensions.ts` (1235 lines)
- `aimeat/src/services/extension-runtime.ts` (409 lines)
- `aimeat/public/js/services/generator-prompts-build.js`
- `aimeat/public/js/services/generator-prompts-base.js`
- `aimeat/public/js/services/generator-prompts-test.js`

---

## 1. Extension Lifecycle (extensions.ts)

### Registration: POST /v1/extensions

**Auth:** requireAuth(). Operator always allowed. Owner allowed only if `config.extInstallRole === 'owner'`.

**Input:** `{ manifest: string (YAML), scripts: Record<string, string> }`

**Validation chain:**
1. manifest must be a YAML string, scripts must be an object
2. `metadata.name`, `metadata.version`, `metadata.description`, `metadata.author` required
3. `actions` array required and non-empty
4. Each action must have `id`, `method`, `path`, `script`
5. Each action's `script` must reference a key in `scripts` object
6. Optional `instances` section validated (supported: boolean, config_per_instance: object)
7. Max installed limit: `config.extensionMaxInstalled`
8. Per-owner limit: `config.maxExtensionsPerOwner` (non-operator only)
9. Name uniqueness enforced
10. Per-script size limit: `config.extensionMaxCodeSizeKb`

**Storage:** Creates `ExtensionRecord` with status `'inactive'`. Schedules stored in `config.__schedules`. Limits are capped at server config maximums.

### Activation: POST /v1/extensions/:name/activate

**Auth:** requireAuth(), requireRole('owner')

**Actions:**
1. Sets status to `'active'`, records `activatedAt`
2. If scheduler available and `ext.config.__schedules` exists, registers `ScheduledJobRecord` for each schedule entry (id format: `ext:{name}:{scheduleId}`)
3. Runs `scheduler.runActivateJobs(name)` for `@activate` jobs immediately (fire-and-forget)

### Deactivation: POST /v1/extensions/:name/deactivate

Removes all scheduled jobs from both scheduler and storage. Sets status to `'inactive'`.

### Uninstall: DELETE /v1/extensions/:name

Same as deactivate (cleans jobs) then deletes the extension record. Auth: operator always, owner only if they installed it.

### Script Update: PATCH /v1/extensions/:name/actions/:actionId

Auth: operator always, owner if they installed it. Updates a single action's `scriptContent`. Size limit enforced.

---

## 2. Action Execution — Two Routes

### Route 1: POST /v1/ext/:extName/:actionId (non-instance)

**Memory namespace:** `ext:{extName}` (line 1047)

This is the primary execution path. Extension must be active. Action must exist. Method validation: action.method must match or action.method must be 'POST'.

### Route 2: POST /v1/ext/:extName/:instanceId/:actionId (instance-scoped)

**Memory namespace:** `ext:{extName}.{instanceId}` (line 826)

Same validation plus: instance must exist and be active. `ctx.instance` is populated with `{ id: instanceId, config: instance.config }`.

### ctx Object Construction (ACTUAL behavior from code)

Both routes build the `ExtensionCtx` identically except for namespace and instance field. Here is the EXACT API available:

#### ctx.memory.get(key: string): Promise<unknown | null>
- Calls `storage.getMemory(extMemoryOwner, key)`
- Returns `record.value` if found, `null` otherwise
- The value is ALREADY a parsed JS value (not a JSON string)
- **Namespace:** `ext:{name}` or `ext:{name}.{instanceId}`

#### ctx.memory.set(key: string, value: unknown): Promise<void>
- Calls `storage.setMemory(...)` with:
  - `ownerGaii: extMemoryOwner`
  - `visibility: 'public'` (ALWAYS public)
  - `tags: []`
  - `ttlHours: null`
  - Auto-increments version
- Extension memory is always public so other components can read via getPublic

#### ctx.memory.search(prefix: string): Promise<Array<{ key: string; value: unknown }>>
- Calls `storage.listMemory(extMemoryOwner, { prefix })`
- Returns `[{ key, value }]` objects, NOT strings
- NO pagination — returns ALL matches
- **Note:** The interface declares `opts?: Record<string, unknown>` but the route implementation only passes `prefix` — the `opts` parameter from the isolate script IS forwarded as JSON but the actual storage call only uses `{ prefix }`

#### ctx.memory.delete(key: string): Promise<boolean>
- Calls `storage.deleteMemory(extMemoryOwner, key)`

#### ctx.memory.getPublic(namespace: string, key: string): Promise<unknown | null>
- First tries `storage.getMemory(namespace, key)` directly
- If not found AND namespace has no `@`, `#`, or `ext:` prefix (looks like a bare owner name), resolves via `storage.getAgentsByOwner(namespace)` and checks each agent's memory
- Returns `record.value` only if `record.visibility === 'public'`; otherwise `null`
- This is how extensions read owner-stored data (memory components, translations, settings)

#### ctx.fetch(url: string, opts?: { method?, headers?, body? }): Promise<{ status, ok, text, headers }>
- Uses Node.js native `fetch()`
- Timeout: `AbortSignal.timeout(30_000)` — always 30 seconds, NOT configurable per call
- Charset detection: Content-Type header -> XML prolog -> HTML meta charset -> fallback UTF-8
- Smart encoding override: if declared non-UTF-8 but bytes contain valid UTF-8 multibyte sequences, trusts bytes
- Returns `{ status: number, ok: boolean, text: string, headers: Record<string,string> }`
- Text is always decoded string, never raw bytes
- Counts toward API call limit

#### ctx.wallet.consume(amount: number, reason: string): Promise<{ success: boolean; error?: string }>
- Debits the CALLER's balance (not extension owner's)
- Creates a transaction record with `type: 'extension_consume'`
- Tracking code format: `ext:{name}:{reason}` (non-instance) or `ext:{name}:{instanceId}:{reason}` (instance)

#### ctx.wallet.getBalance(): Promise<number>
- Returns the caller's GHII morsel balance (resolves through parseGAII -> getGHIIByOwner)

#### ctx.consent.check(gaii: string, scope: string): Promise<boolean>
- Lists active consents for the given GAII, returns true if any match the scope/purpose

#### ctx.consent.require(gaii: string, scope: string): Promise<void>
- Same as check but throws `Error('CONSENT_REQUIRED: ${scope}')` if no matching consent

#### ctx.trust.getScore(gaii: string): Promise<number>
- Returns `agent.trustScore` for the given GAII, or 0 if not found

#### ctx.caller: { gaii: string; owner: string; roles: string[] }
- `gaii`: `req.auth!.sub` (the caller's identity)
- `owner`: `req.auth!.owner`
- `roles`: `req.auth!.roles`

#### ctx.config: Record<string, unknown>
- The extension's stored config object (from manifest, including `__schedules`)

#### ctx.instance?: { id: string; config: Record<string, unknown> }
- Only present on instance-scoped route
- `id`: the instance ID
- `config`: instance-specific configuration

#### ctx.log.info/warn/error(msg: string, data?: Record<string, unknown>): void
- Proxied to server logger with prefix `[ext:{name}]` or `[ext:{name}:{instanceId}]`
- Log calls do NOT count toward API call limit (line 88, makeLogRef)

#### ctx.notify(message: string, opts?: { title?, priority?, channel? }): Promise<boolean>
- Stores notification in caller's memory under `notifications.{owner}` key
- Caps at 100 notifications (trims oldest)
- Always returns true

#### ctx.email(to: string, subject: string, body: string): Promise<boolean>
- Sends email via configured SMTP service
- Returns false if SMTP not configured
- Returns result of `emailService.sendNotification()`

---

## 3. V8 Sandbox (extension-runtime.ts)

### Isolate Setup

- Uses `isolated-vm` library
- Memory limit: `limits.memoryMb` (from ExtensionLimits)
- Each execution creates a NEW isolate (disposed in finally block)
- Script timeout: `limits.timeoutMs`

### Script Transformation

`transformScript()` strips `export default` from the script and wraps it as:
```javascript
const __userFn = async function(ctx, input) { ... };
```

### API Proxying

All ctx methods are proxied through `ivm.Reference` objects:
- `makeRef()`: wraps async host functions, returns JSON envelope `{ __val }` or `{ __err }`
- API call counter is shared across ALL references (memory, fetch, wallet, etc.)
- Once `counter.count > maxApiCalls`, returns error envelope
- Log calls use `makeLogRef()` which does NOT increment the counter

### Inside the Isolate

The built script (`buildIsolateScript`):
1. Constructs a `ctx` proxy object that calls host references
2. `ctx.memory.set(key, value)` serializes value with `JSON.stringify(value)` before sending to host
3. Host side `__memory_set` deserializes with `JSON.parse(valueJson)`
4. `ctx.memory.get(key)` returns the value directly from host (already parsed)
5. `ctx.fetch(url, opts)` serializes opts as JSON before sending
6. Parses `__inputJson`, `__callerJson`, `__configJson`, `__instanceJson`
7. Calls `__userFn(ctx, input)`
8. Returns `JSON.stringify(result ?? {})`

### Memory Access Tracking

`trackMemoryAccess()` wraps the ctx.memory object to record:
- `reads`: keys passed to get(), search prefix with `*`, getPublic as `namespace:key`
- `writes`: keys passed to set(), delete as `-key`

This is used for post-execution recording but is NOT applied in the route handlers (the route directly passes ctx to executeExtensionAction).

### Return Value

The action's return value is `JSON.parse(resultJson)`. If the function returns `undefined` or `null`, it becomes `{}` (line 169: `result ?? {}`).

---

## 4. What Prompts Tell the AI vs Actual Behavior

### ctx.memory API

**Prompt says (AIMEAT_CONTEXT, lines 30-37):**
```
ctx.memory.get(key) -> value or null
ctx.memory.set(key, value) -> void
ctx.memory.search(prefix) -> Array<{ key, value }>
ctx.memory.delete(key) -> boolean
ctx.memory.getPublic(namespace, key) -> value or null
```

**Actual:** Matches exactly. The prompt is accurate.

**Prompt emphasizes repeatedly (extension template lines 213-253, SANDBOX_CONSTRAINTS lines 1521-1527):**
- NEVER call JSON.parse() on ctx.memory.get() result
- ALWAYS null-check before using
- search() returns objects, not strings

**Actual:** Correct. In the isolate, `__call` parses the JSON envelope and returns `parsed.__val`, which is the already-parsed value from `JSON.stringify({ __val: result })`.

### ctx.fetch

**Prompt says (AIMEAT_CONTEXT, line 44):**
```
ctx.fetch(url, { method, headers, body }) -> { status, ok, text, headers }
```

**Actual:** Matches. The prompt correctly notes:
- text is always a string (not Response object)
- Encoding auto-detected
- Global fetch() is NOT available

**No discrepancy.**

### ctx.wallet

**Prompt says (SANDBOX_CONSTRAINTS, line 1497):**
```
ctx.wallet (consume/deposit/balance)
```

**Actual code (ExtensionCtx interface, lines 23-27):**
```typescript
wallet: {
    consume?(amount, reason): Promise<{ success, error? }>;
    getBalance?(): Promise<number>;
};
```

**DISCREPANCY:** The prompt mentions `deposit` but the actual interface only has `consume` and `getBalance`. There is no `deposit` method. The route code confirms: `wallet` only has `consume` and `getBalance`. The comment at line 1156 says "hold, release, transfer REMOVED".

### ctx.consent

**Prompt says (SANDBOX_CONSTRAINTS, line 1498):**
```
ctx.consent (check/request)
```

**Actual code (ExtensionCtx interface, lines 28-31):**
```typescript
consent: {
    check?(gaii, scope): Promise<boolean>;
    require?(gaii, scope): Promise<void>;
};
```

**DISCREPANCY:** Prompt says `request`, actual method is `require`. The method name is `require` in both the interface and the route implementation. The AIMEAT_CONTEXT (line 51) correctly says `ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)` — so the SANDBOX_CONSTRAINTS box is the one with the wrong name.

### Response Format

**Prompt says (extension template, line 319):**
```javascript
export default async function(ctx, input) { ... }
```

**Actual:** The `transformScript()` function strips `export default` and wraps the function. The action must return any JSON-serializable value. If it returns `undefined`/`null`, the result is `{}`.

**Prompt says nothing about what MUST be returned.** The action can return anything. In practice, prompts show patterns returning `{ items, count }` or `{ error: 'message' }` but there is no enforced schema.

### Action Isolation

**Prompt says (SANDBOX_CONSTRAINTS, lines 1509-1519):**
```
Each action is a SEPARATE function. Actions CANNOT call each other.
There is NO ctx.otherAction() or ctx.callAction() method.
```

**Actual:** Correct. Each action execution creates a fresh isolate with only the single script loaded. No mechanism exists to call other actions.

### Memory Namespace

**Prompt says (NAMESPACE_RULES, lines 1442-1476 and extension template line 476):**
```
ctx.memory.get() only reads from the extension's own ext:{name} namespace.
Seed data, settings, translations live in the OWNER's namespace.
Use ctx.memory.getPublic(ctx.caller.owner, key) to access owner data.
```

**Actual:** Correct. The route sets `extMemoryOwner = 'ext:' + ext.name` (line 1047) and all get/set/search/delete use this owner. `getPublic` can read from any namespace.

**Prompt also says (extension template, lines 430-458):**
Init action MUST copy shared data from owner namespace to extension namespace. Pattern:
```javascript
const ownerData = await ctx.memory.getPublic(ctx.caller.owner, key);
if (ownerData) await ctx.memory.set(key, ownerData);
```

**Actual:** This is a recommended pattern, not enforced by code. Extensions that don't copy will still work, but other users won't be able to read owner-namespace data.

### Limits

**Prompt says (extension template, lines 285-287):**
```yaml
limits:
  memory_mb: 128
  timeout_ms: 30000
  max_api_calls: 500
```

**Actual:** Limits are stored per extension but at execution time the route uses `Math.max(ext.limits.X, config.X)` (lines 1205-1208). This means the effective limit is always the HIGHER of stored vs server config. Admin can raise limits globally without reinstalling.

### Instance vs Non-Instance

**Prompt says (extension template, lines 354-362):**
```
Default: /v1/ext/{name}/action-id
Multi-instance: /v1/ext/{name}/:instanceId/action-id
```

**Actual:** Correct. Two separate route handlers exist:
- `POST /v1/ext/:extName/:actionId` (line 1009)
- `POST /v1/ext/:extName/:instanceId/:actionId` (line 771)

Express route ordering matters here: the 3-segment route is registered BEFORE the 2-segment route.

---

## 5. Test Prompts (generator-prompts-test.js)

### Server-side Extension Tests

Test code runs in `new Function()` sandbox (NOT isolated-vm). Available helpers:

```javascript
testFetch(url, { method, body, headers })  // raw HTTP, auth injected
callExt('ext-name', 'actionId', { input }) // calls POST /v1/ext/{name}/{actionId}, unwraps envelope
readExtMemory('ext-name', 'memory.key')    // reads from ext:{name} namespace via getPublic
```

Must return: `{ passed: boolean, errors: string[], details: string }`

**Key test rules from prompt:**
- Clean stale data using extension's OWN actions before first test
- [MEMORY] tests: assert specific return values
- [EXTERNAL API] tests: check response shape only (API may be down)
- JavaScript pitfall warnings: never compare arrays with ===, use Array.isArray()

### Browser-side Tests (Cortex and App)

Test code runs inside `page.evaluate()` in a real browser. Must set `window.__testResults = { passed, errors, details }`.

**Cortex tests:** Library already loaded on page, access via `window.AIMEAT.{camelCaseName}`. Auth available.

**App tests:** App already loaded, auth available, must wait for render (3s timeout), check DOM elements.

### SANDBOX_CONSTRAINTS in Test Prompt

Line 313: Extension test prompts include `SANDBOX_CONSTRAINTS` (V8 rules). This is relevant because it reminds the AI that extension actions can't import/require. However, the TEST itself runs in `new Function()`, not isolated-vm. The constraints are about what the extension code does, not what the test code does.

Line 313 also always includes `EXTENSION_CONSUMPTION_RULES` regardless of component type. This tells test authors how to use `callExt` and `readExtMemory`.

---

## 6. Discrepancy Summary

| # | Location | What Prompt Says | What Code Does | Severity |
|---|----------|-----------------|----------------|----------|
| 1 | SANDBOX_CONSTRAINTS line 1497 | `ctx.wallet (consume/deposit/balance)` | Only `consume` and `getBalance` exist. No `deposit`. | **Medium** — AI may try to call ctx.wallet.deposit() |
| 2 | SANDBOX_CONSTRAINTS line 1498 | `ctx.consent (check/request)` | Methods are `check` and `require`, not `request` | **Medium** — AI may call ctx.consent.request() instead of require() |
| 3 | SANDBOX_CONSTRAINTS line 1497 | `ctx.wallet (...balance)` | Method is `getBalance()`, not `balance()` | **Low** — AIMEAT_CONTEXT line 50 correctly says `getBalance()` |
| 4 | trackMemoryAccess | Exported and documented | Never actually used in route handlers | **Info** — dead code, no user impact |
| 5 | ctx.memory.search opts | Interface declares `opts?: Record<string, unknown>` | Isolate script forwards opts as JSON, host passes only `{ prefix }` | **Low** — extra opts are silently ignored |
| 6 | ctx.fetch timeout | Extension template says `timeout_ms: 30000` as default | ctx.fetch hardcodes `AbortSignal.timeout(30_000)` regardless of limits.timeoutMs | **Info** — fetch timeout is always 30s independent of action timeout |

### Items that ARE consistent (verified):
- ctx.memory.get returns parsed value, not string
- ctx.memory.set accepts any JSON-serializable value
- ctx.memory.search returns `[{key, value}]`
- ctx.memory.getPublic visibility check (public only)
- ctx.fetch returns `{ status, ok, text, headers }`
- Action isolation (no cross-action calls)
- Memory namespace `ext:{name}` for non-instance, `ext:{name}.{instanceId}` for instance
- Owner namespace accessed via getPublic(ctx.caller.owner, key)
- Log calls don't count toward API limit
- Script transformation strips `export default`
- Return value defaults to `{}` if undefined/null
- Limits use Math.max(stored, config) at execution time
