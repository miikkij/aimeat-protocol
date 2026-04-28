# Replace isolated-vm with quickjs-emscripten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `isolated-vm` native C++ dependency with `quickjs-emscripten` (pure WASM) so that `npm install -g aimeat` works on any machine without C++ build tools, while preserving identical sandbox behavior for all existing extension scripts.

**Architecture:** The entire `isolated-vm` usage is encapsulated in one file: `aimeat/src/services/extension-runtime.ts`. It exports `executeExtensionAction()` which is consumed by 3 files (`routes/extensions.ts`, `services/scheduler.ts`, `mcp/extensions.ts`). None of those files import `isolated-vm` directly. The replacement swaps the sandbox engine inside `extension-runtime.ts` while keeping the exact same exports and function signatures. We use quickjs-emscripten's promise-based approach (sync WASM build) with `vm.newPromise()` for async host callbacks -- this matches the existing JSON-envelope pattern and avoids the larger asyncify build.

**Tech Stack:** `quickjs-emscripten` (MIT, pure WASM, ~1.3MB minimal variant)

**Impact:** Zero. The public API (`executeExtensionAction`, `ExtensionCtx`, `ExtensionLimits`, `MemoryAccessLog`, `trackMemoryAccess`) does not change. Consumer files do not change. User-written extension scripts do not change. The 10 unit tests and 5 E2E tests validate that nothing is broken.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `aimeat/src/services/extension-runtime.ts` | **Rewrite** | Swap ivm internals with quickjs-emscripten. Same exports. |
| `aimeat/package.json` | **Modify** | Remove `isolated-vm`, add `quickjs-emscripten`, update `pnpm.onlyBuiltDependencies` |
| `aimeat/src/services/generator-prompts/validate.ts` | **Modify** | Update error messages from "V8 sandbox" to "sandbox" (optional cosmetic) |
| `aimeat/test/unit/extension-runtime.test.ts` | **No change** | Existing tests validate the replacement |
| `aimeat/test/e2e-extensions.ts` | **No change** | Existing E2E tests validate the replacement |

Files that import `executeExtensionAction` -- **NO CHANGES NEEDED:**
- `aimeat/src/routes/extensions.ts`
- `aimeat/src/services/scheduler.ts`
- `aimeat/src/mcp/extensions.ts`

---

### Task 1: Update Dependencies

**Files:**
- Modify: `aimeat/package.json`

- [ ] **Step 1: Remove isolated-vm and add quickjs-emscripten**

In `aimeat/package.json`, replace the `isolated-vm` dependency:

```json
// REMOVE from dependencies:
"isolated-vm": "^6.0.2",

// ADD to dependencies:
"quickjs-emscripten": "^0.32.0",
```

Also remove `isolated-vm` from `pnpm.onlyBuiltDependencies`:

```json
// BEFORE:
"onlyBuiltDependencies": [
    "better-sqlite3",
    "isolated-vm"
]

// AFTER:
"onlyBuiltDependencies": [
    "better-sqlite3"
]
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd aimeat && pnpm install
```

Expected: Clean install, no C++ compilation for quickjs-emscripten (it's pure WASM).

- [ ] **Step 3: Commit**

```bash
git add aimeat/package.json aimeat/pnpm-lock.yaml
git commit -m "chore: replace isolated-vm with quickjs-emscripten dependency"
```

---

### Task 2: Rewrite extension-runtime.ts

**Files:**
- Rewrite: `aimeat/src/services/extension-runtime.ts`

This is the core task. The file currently uses `isolated-vm` APIs: `Isolate`, `Context`, `Reference`, `compileScriptSync`, `run()`, `dispose()`. We replace all of these with quickjs-emscripten equivalents while keeping every export identical.

**Key mapping:**

| isolated-vm | quickjs-emscripten |
|---|---|
| `new ivm.Isolate({ memoryLimit })` | `QuickJS.newRuntime()` + `runtime.setMemoryLimit(bytes)` |
| `isolate.createContextSync()` | `runtime.newContext()` |
| `jail.setSync('name', value)` | `vm.setProp(vm.global, 'name', handle)` + dispose handle |
| `new ivm.Reference(fn)` | `vm.newFunction('name', fn)` returning `vm.newPromise()` |
| `isolate.compileScriptSync(code)` + `compiled.run(ctx, { timeout, promise })` | `vm.evalCode(code)` with `runtime.setInterruptHandler()` |
| `isolate.dispose()` | `vm.dispose()` + `runtime.dispose()` |

- [ ] **Step 1: Write the new extension-runtime.ts**

Replace the entire file content with the quickjs-emscripten implementation. The new file must:

1. Import `getQuickJS` and `shouldInterruptAfterDeadline` from `quickjs-emscripten`
2. Keep all 4 exported interfaces identical: `ExtensionCtx`, `ExtensionLimits`, `MemoryAccessLog`, and the `trackMemoryAccess` function (these are unchanged -- copy them verbatim from the current file)
3. Rewrite `makeRef` -- instead of returning an `ivm.Reference`, return a host function factory that creates a `vm.newFunction()` which returns a `vm.newPromise()` handle
4. Rewrite `makeLogRef` -- return a host function factory for fire-and-forget log calls
5. Keep `transformScript()` unchanged -- it strips `export default` and wraps as variable declaration
6. Rewrite `buildIsolateScript()` -- the generated script no longer uses `ref.apply()` / `ref.applyIgnored()`. Instead, host functions are directly available as globals that return promises
7. Rewrite `executeExtensionAction()` -- create QuickJS runtime + context, set memory/timeout limits, inject globals via handles, eval the script, extract result, dispose everything

The new implementation:

```typescript
/**
 * @file extension-runtime.ts
 * @description QuickJS WASM Sandbox Runtime for AIMEAT Extension Actions.
 *   Executes user-provided extension scripts in a sandboxed QuickJS engine
 *   compiled to WASM via `quickjs-emscripten`. The sandbox has NO access to
 *   Node.js globals (process, require, Buffer, etc.) -- only a controlled `ctx`
 *   API proxy.
 * @version-history
 *   v1.0.0 -- 2026-03-01 -- Initial V8 sandbox implementation (isolated-vm)
 *   v1.1.0 -- 2026-03-15 -- Add memory access tracking (MemoryAccessLog + trackMemoryAccess)
 *   v2.0.0 -- 2026-04-29 -- Replace isolated-vm with quickjs-emscripten (pure WASM, no C++ build tools)
 */
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten';

// ── Public interfaces (UNCHANGED) ──────────────────────────

export interface ExtensionCtx {
    memory: {
        get(key: string): Promise<unknown | null>;
        set(key: string, value: unknown): Promise<void>;
        search(prefix: string, opts?: Record<string, unknown>): Promise<Array<{ key: string; value: unknown }>>;
        delete(key: string): Promise<boolean>;
        getPublic(namespace: string, key: string): Promise<unknown | null>;
    };
    wallet: {
        consume?(amount: number, reason: string): Promise<{ success: boolean; error?: string }>;
        getBalance?(): Promise<number>;
    };
    consent: {
        check?(gaii: string, scope: string): Promise<boolean>;
        require?(gaii: string, scope: string): Promise<void>;
    };
    trust: {
        getScore?(gaii: string): Promise<number>;
    };
    fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean; text: string; headers: Record<string, string> }>;
    caller: { gaii: string; owner: string; roles: string[] };
    config: Record<string, unknown>;
    instance?: {
        id: string;
        config: Record<string, unknown>;
    };
    log: {
        info(msg: string, data?: Record<string, unknown>): void;
        warn(msg: string, data?: Record<string, unknown>): void;
        error(msg: string, data?: Record<string, unknown>): void;
    };
    notify?(message: string, opts?: { title?: string; priority?: string; channel?: string }): Promise<boolean>;
    email?(to: string, subject: string, body: string): Promise<boolean>;
}

export interface ExtensionLimits {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Sets a string global in the QuickJS context, creating and disposing the handle.
 */
function setStringGlobal(vm: QuickJSContext, name: string, value: string | null): void {
    if (value === null) {
        const nullHandle = vm.null;
        vm.setProp(vm.global, name, nullHandle);
        return;
    }
    const handle = vm.newString(value);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
}

/**
 * Registers an async host function in the QuickJS context.
 * The function receives string arguments from the sandbox, calls the host-side
 * async function, and resolves/rejects a promise visible to the sandbox.
 *
 * The API-call counter is incremented on every invocation, and an error
 * is thrown once the limit is exceeded.
 */
function registerAsyncHostFn(
    vm: QuickJSContext,
    runtime: QuickJSRuntime,
    name: string,
    fn: ((...args: string[]) => Promise<unknown>) | null,
    counter: { count: number },
    maxApiCalls: number,
): void {
    if (fn === null) {
        const nullHandle = vm.null;
        vm.setProp(vm.global, name, nullHandle);
        return;
    }

    const fnHandle = vm.newFunction(name, (...argHandles: QuickJSHandle[]) => {
        const args = argHandles.map(h => vm.getString(h));
        const promise = vm.newPromise();

        counter.count++;
        if (counter.count > maxApiCalls) {
            promise.reject(vm.newString('API call limit exceeded'));
            promise.settled.then(vm.runtime.executePendingJobs);
            return promise.handle;
        }

        fn(...args)
            .then(result => {
                if (vm.alive) {
                    const jsonStr = JSON.stringify(result ?? null);
                    promise.resolve(vm.newString(jsonStr));
                }
            })
            .catch(err => {
                if (vm.alive) {
                    const msg = err instanceof Error ? err.message : String(err);
                    promise.reject(vm.newString(msg));
                }
            })
            .finally(() => {
                promise.settled.then(vm.runtime.executePendingJobs);
            });

        return promise.handle;
    });
    vm.setProp(vm.global, name, fnHandle);
    fnHandle.dispose();
}

/**
 * Registers a synchronous log host function in the QuickJS context.
 * Log calls do NOT count toward the API call limit.
 */
function registerLogFn(
    vm: QuickJSContext,
    name: string,
    fn: (msg: string, data?: Record<string, unknown>) => void,
): void {
    const fnHandle = vm.newFunction(name, (...argHandles: QuickJSHandle[]) => {
        const msg = vm.getString(argHandles[0]);
        let data: Record<string, unknown> | undefined;
        if (argHandles.length > 1) {
            const dataJson = vm.getString(argHandles[1]);
            data = JSON.parse(dataJson) as Record<string, unknown>;
        }
        fn(msg, data);
    });
    vm.setProp(vm.global, name, fnHandle);
    fnHandle.dispose();
}

/**
 * Transforms a user extension script that uses `export default async function(ctx, input) { ... }`
 * into a form that can be executed inside the sandbox.
 */
function transformScript(scriptContent: string): string {
    const body = scriptContent.replace(/export\s+default\s+/, '').trim();
    return `const __userFn = ${body};`;
}

/**
 * Builds the full sandbox script. Host functions are registered as globals
 * that return promises. The script constructs a `ctx` proxy, parses serialized
 * input/caller/config, invokes the user function, and returns a JSON string.
 */
function buildSandboxScript(userFnDecl: string): string {
    return `
${userFnDecl}

(async () => {
    // Helper: call an async host function, parse the JSON result
    async function __call(fn, args) {
        const raw = await fn(...args);
        return JSON.parse(raw);
    }

    // Build ctx proxy
    const ctx = {
        memory: {
            get:       async (key)            => __call(__memory_get, [key]),
            set:       async (key, value)     => __call(__memory_set, [key, JSON.stringify(value)]),
            search:    async (prefix, opts)   => __call(__memory_search, [prefix, opts ? JSON.stringify(opts) : '{}']),
            delete:    async (key)            => __call(__memory_delete, [key]),
            getPublic: async (namespace, key) => __call(__memory_getPublic, [namespace, key]),
        },
        fetch: async (url, opts) => __call(__fetch, [url, opts ? JSON.stringify(opts) : '{}']),
        wallet: {
            consume:    __wallet_consume    ? (async (amount, reason) => __call(__wallet_consume, [String(amount), reason]))  : undefined,
            getBalance: __wallet_balance    ? (async ()               => __call(__wallet_balance, []))                         : undefined,
        },
        consent: {
            check:   __consent_check   ? (async (gaii, scope) => __call(__consent_check, [gaii, scope]))   : undefined,
            require: __consent_require ? (async (gaii, scope) => __call(__consent_require, [gaii, scope])) : undefined,
        },
        trust: {
            getScore: __trust_getScore ? (async (gaii) => __call(__trust_getScore, [gaii])) : undefined,
        },
        caller: JSON.parse(__callerJson),
        config: JSON.parse(__configJson),
        instance: __instanceJson ? JSON.parse(__instanceJson) : undefined,
        log: {
            info:  (msg, data) => __log_info(msg, data !== undefined ? JSON.stringify(data) : undefined),
            warn:  (msg, data) => __log_warn(msg, data !== undefined ? JSON.stringify(data) : undefined),
            error: (msg, data) => __log_error(msg, data !== undefined ? JSON.stringify(data) : undefined),
        },
        notify: __notify ? (async (message, opts) => __call(__notify, [message, opts ? JSON.stringify(opts) : '{}'])) : undefined,
        email:  __email  ? (async (to, subject, body) => __call(__email, [to, subject, body]))                        : undefined,
    };

    const input = JSON.parse(__inputJson);
    const result = await __userFn(ctx, input);
    return JSON.stringify(result ?? {});
})()
`;
}

// ── Memory access tracking (UNCHANGED) ──────────────────────

export interface MemoryAccessLog {
    reads: string[];
    writes: string[];
}

export function trackMemoryAccess(ctx: ExtensionCtx): { ctx: ExtensionCtx; accessLog: MemoryAccessLog } {
    const accessLog: MemoryAccessLog = { reads: [], writes: [] };
    const origMemory = ctx.memory;

    const trackedMemory: ExtensionCtx['memory'] = {
        get: async (key) => {
            accessLog.reads.push(key);
            return origMemory.get(key);
        },
        set: async (key, value) => {
            accessLog.writes.push(key);
            return origMemory.set(key, value);
        },
        search: async (prefix, opts) => {
            accessLog.reads.push(`${prefix}*`);
            return origMemory.search(prefix, opts);
        },
        delete: async (key) => {
            accessLog.writes.push(`-${key}`);
            return origMemory.delete(key);
        },
        getPublic: async (namespace, key) => {
            accessLog.reads.push(`${namespace}:${key}`);
            return origMemory.getPublic(namespace, key);
        },
    };

    return {
        ctx: { ...ctx, memory: trackedMemory },
        accessLog,
    };
}

// ── Main entry point ─────────────────────────────────────────

// Load QuickJS WASM module once (singleton)
let quickJSPromise: ReturnType<typeof getQuickJS> | null = null;
function getQuickJSSingleton() {
    if (!quickJSPromise) quickJSPromise = getQuickJS();
    return quickJSPromise;
}

export async function executeExtensionAction(
    scriptContent: string,
    ctx: ExtensionCtx,
    input: Record<string, unknown>,
    limits: ExtensionLimits,
): Promise<Record<string, unknown>> {
    const QuickJS = await getQuickJSSingleton();

    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024); // 1MB stack
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs));

    const vm = runtime.newContext();

    try {
        const counter = { count: 0 };

        // ── Serialized data ──────────────────────────────────
        setStringGlobal(vm, '__inputJson', JSON.stringify(input));
        setStringGlobal(vm, '__callerJson', JSON.stringify(ctx.caller));
        setStringGlobal(vm, '__configJson', JSON.stringify(ctx.config));
        setStringGlobal(vm, '__instanceJson', ctx.instance ? JSON.stringify(ctx.instance) : null);

        // ── Memory API ────────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__memory_get',
            async (key) => ctx.memory.get(key),
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__memory_set',
            async (key, valueJson) => { const value = JSON.parse(valueJson); await ctx.memory.set(key, value); },
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__memory_search',
            async (prefix, optsJson) => {
                const opts = JSON.parse(optsJson || '{}') as Record<string, unknown>;
                return ctx.memory.search(prefix, opts);
            },
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__memory_delete',
            async (key) => ctx.memory.delete(key),
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__memory_getPublic',
            async (namespace, key) => ctx.memory.getPublic(namespace, key),
            counter, limits.maxApiCalls);

        // ── Fetch API ─────────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__fetch',
            async (url, optsJson) => {
                const opts = JSON.parse(optsJson || '{}') as {
                    method?: string; headers?: Record<string, string>; body?: string;
                };
                const resp = await fetch(url, {
                    method: opts.method || 'GET',
                    headers: opts.headers,
                    body: opts.body,
                    signal: AbortSignal.timeout(Math.min(limits.timeoutMs, 30_000)),
                });
                const buf = await resp.arrayBuffer();
                const ct = resp.headers.get('content-type') || '';
                const ctCharsetMatch = /charset=([^\s;]+)/i.exec(ct);
                let charset = ctCharsetMatch ? ctCharsetMatch[1].toLowerCase() : '';

                if (!charset) {
                    const peek = new TextDecoder('ascii').decode(buf.slice(0, 512));
                    const xmlMatch = /encoding=['"]([^'"]+)['"]/i.exec(peek);
                    const metaMatch = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek);
                    charset = (xmlMatch?.[1] || metaMatch?.[1] || 'utf-8').toLowerCase();
                }

                if (charset && charset !== 'utf-8' && charset !== 'utf8') {
                    const bytes = new Uint8Array(buf);
                    let hasMultibyte = false;
                    for (let i = 0; i < bytes.length - 1; i++) {
                        if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF && (bytes[i + 1] & 0xC0) === 0x80) {
                            hasMultibyte = true; break;
                        }
                        if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF && i + 2 < bytes.length &&
                            (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
                            hasMultibyte = true; break;
                        }
                    }
                    if (hasMultibyte) charset = 'utf-8';
                }

                const decoder = new TextDecoder(charset === 'utf8' ? 'utf-8' : charset);
                const text = decoder.decode(buf);
                const headers: Record<string, string> = {};
                resp.headers.forEach((v, k) => { headers[k] = v; });
                return { status: resp.status, ok: resp.ok, text, headers };
            },
            counter, limits.maxApiCalls);

        // ── Wallet API ────────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__wallet_consume',
            ctx.wallet.consume
                ? async (amountStr, reason) => ctx.wallet.consume!(Number(amountStr), reason)
                : null,
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__wallet_balance',
            ctx.wallet.getBalance
                ? async () => ctx.wallet.getBalance!()
                : null,
            counter, limits.maxApiCalls);

        // ── Consent API ───────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__consent_check',
            ctx.consent.check
                ? async (gaii, scope) => ctx.consent.check!(gaii, scope)
                : null,
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__consent_require',
            ctx.consent.require
                ? async (gaii, scope) => ctx.consent.require!(gaii, scope)
                : null,
            counter, limits.maxApiCalls);

        // ── Trust API ─────────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__trust_getScore',
            ctx.trust.getScore
                ? async (gaii) => ctx.trust.getScore!(gaii)
                : null,
            counter, limits.maxApiCalls);

        // ── Log functions (no API count) ──────────────────────
        registerLogFn(vm, '__log_info', ctx.log.info);
        registerLogFn(vm, '__log_warn', ctx.log.warn);
        registerLogFn(vm, '__log_error', ctx.log.error);

        // ── Notify & Email ────────────────────────────────────
        registerAsyncHostFn(vm, runtime, '__notify',
            ctx.notify
                ? async (message, optsJson) => ctx.notify!(message, optsJson ? JSON.parse(optsJson) : undefined)
                : null,
            counter, limits.maxApiCalls);

        registerAsyncHostFn(vm, runtime, '__email',
            ctx.email
                ? async (to, subject, body) => ctx.email!(to, subject, body)
                : null,
            counter, limits.maxApiCalls);

        // ── Build and evaluate ────────────────────────────────
        const userFnDecl = transformScript(scriptContent);
        const fullScript = buildSandboxScript(userFnDecl);

        const evalResult = vm.evalCode(fullScript);

        if ('error' in evalResult) {
            const errorObj = vm.dump(evalResult.error);
            evalResult.error.dispose();
            const message = typeof errorObj === 'object' && errorObj?.message
                ? String(errorObj.message)
                : String(errorObj);
            throw new Error(message);
        }

        // evalResult.value is a promise handle -- resolve it on the host side
        const promiseHandle = evalResult.value;
        const resolvedResult = await vm.resolvePromise(promiseHandle);
        promiseHandle.dispose();

        if ('error' in resolvedResult) {
            const errorObj = vm.dump(resolvedResult.error);
            resolvedResult.error.dispose();
            const message = typeof errorObj === 'object' && errorObj?.message
                ? String(errorObj.message)
                : String(errorObj);
            throw new Error(message);
        }

        const resultJson = vm.getString(resolvedResult.value);
        resolvedResult.value.dispose();

        return JSON.parse(resultJson) as Record<string, unknown>;
    } finally {
        if (vm.alive) vm.dispose();
        if (runtime.alive) runtime.dispose();
    }
}
```

**Critical details in this implementation:**

1. **Promise-based async pattern**: Host functions create a `vm.newPromise()`, do the async work on the host side, then resolve/reject. `promise.settled.then(vm.runtime.executePendingJobs)` ensures the QuickJS microtask queue runs after each promise settles.

2. **Timeout**: `runtime.setInterruptHandler(shouldInterruptAfterDeadline(...))` -- QuickJS polls this regularly during execution and throws if the deadline passes. The error message will contain "interrupted" rather than "timed out", so the unit test assertion `/timed out/i` may need adjustment -- see Task 3.

3. **Memory limit**: `runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024)` -- QuickJS uses bytes, isolated-vm used MB.

4. **No `ref.apply()` / `ref.applyIgnored()`**: The sandbox script no longer needs those ivm-specific calls. Host functions are plain globals that return promises. The `__call()` helper just awaits the function and parses the JSON result.

5. **Log functions are synchronous**: `registerLogFn` creates a sync `vm.newFunction` (no promise) -- matching the old `makeLogRef` / `applyIgnored` behavior.

6. **Singleton WASM module**: `getQuickJSSingleton()` loads the WASM once and reuses it. Each `executeExtensionAction` call creates a fresh runtime + context (equivalent to a fresh isolate).

7. **`vm.alive` check in promise callbacks**: The host-side `.then()` / `.catch()` on the async work check `vm.alive` before touching handles, because the context could have been disposed due to timeout while the host-side async operation was in flight.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: 0 errors. If there are type errors with quickjs-emscripten imports, check the package exports and adjust import paths.

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/extension-runtime.ts
git commit -m "feat: replace isolated-vm with quickjs-emscripten sandbox engine"
```

---

### Task 3: Fix Unit Tests If Needed

**Files:**
- Possibly modify: `aimeat/test/unit/extension-runtime.test.ts`

The existing 10 unit tests should pass without changes, with one possible exception: the timeout test asserts `/timed out/i` but QuickJS interrupt handler may produce a different error message (e.g., "interrupted" or "InternalError: interrupted").

- [ ] **Step 1: Run the unit tests**

Run:
```bash
cd aimeat && pnpm exec vitest run test/unit/extension-runtime.test.ts
```

Expected: All 10 tests pass. If the timeout test fails due to error message mismatch, proceed to Step 2. Otherwise skip to Step 4.

- [ ] **Step 2: Fix the timeout assertion if needed**

If the timeout test fails, update the regex in `test/unit/extension-runtime.test.ts`:

```typescript
// BEFORE (line 73):
).rejects.toThrow(/timed out/i);

// AFTER (matches both old and new error messages):
).rejects.toThrow(/timed out|interrupted/i);
```

- [ ] **Step 3: Re-run unit tests to verify fix**

Run:
```bash
cd aimeat && pnpm exec vitest run test/unit/extension-runtime.test.ts
```

Expected: All 10 tests pass.

- [ ] **Step 4: Commit (only if changes were needed)**

```bash
git add aimeat/test/unit/extension-runtime.test.ts
git commit -m "test: update timeout assertion for quickjs-emscripten error message"
```

---

### Task 4: Run Lint and Typecheck

**Files:** None (validation only)

- [ ] **Step 1: Run lint**

Run:
```bash
cd aimeat && pnpm lint
```

Expected: 0 errors. Fix any lint issues in `extension-runtime.ts` if they appear.

- [ ] **Step 2: Run typecheck**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit any lint fixes if needed**

```bash
git add -A && git commit -m "fix: lint issues in extension-runtime.ts"
```

---

### Task 5: Run E2E Extension Tests

**Files:** None (validation only)

- [ ] **Step 1: Run the extension-specific E2E tests on memory backend**

Run:
```bash
cd aimeat && pnpm test:e2e
```

Expected: All tests pass, including the e2e-extensions suite (Phase 0-5: setup, installation, activation, action execution with echo + memory, deactivation, uninstallation).

- [ ] **Step 2: Run on SQLite backend**

Run:
```bash
cd aimeat && pnpm test:e2e:sqlite
```

Expected: All tests pass.

- [ ] **Step 3: Run on MongoDB backend**

Run:
```bash
cd aimeat && pnpm test:e2e:mongodb
```

Expected: All tests pass.

---

### Task 6: Update Validation Messages (Cosmetic)

**Files:**
- Modify: `aimeat/src/services/generator-prompts/validate.ts`

The validator references "V8 sandbox" in error messages. Since we're no longer using V8, update these to say "sandbox" (generic).

- [ ] **Step 1: Update error messages**

In `aimeat/src/services/generator-prompts/validate.ts`, replace all occurrences of "V8 sandbox" with "sandbox":

```
"V8 sandbox" -> "sandbox"
```

Lines affected (approximate): 179, 184, 188, 192, 196, 200, 202, 206, 209, 212, 215.

- [ ] **Step 2: Update the file header**

Update the `@description` in the file header if it mentions "V8 isolate" or "V8 sandbox".

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/generator-prompts/validate.ts
git commit -m "docs: update sandbox references from V8 to generic"
```

---

### Task 7: Update Documentation References

**Files:**
- Modify: `CLAUDE.md` (if it references "V8 isolate" or "isolated-vm")

- [ ] **Step 1: Search for V8/isolated-vm references in CLAUDE.md**

Search for mentions of "V8", "isolated-vm", "ivm" in CLAUDE.md. Update descriptions to reflect the new engine:

- "V8 Isolate Sandbox" -> "QuickJS WASM Sandbox"
- "V8-sandboxed extensions" -> "sandboxed extensions" (or "WASM-sandboxed")
- Any mention of `isolated-vm` -> `quickjs-emscripten`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect quickjs-emscripten sandbox"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full E2E suite on memory backend**

Run:
```bash
cd aimeat && pnpm test:e2e
```

Expected: 0 failures.

- [ ] **Step 2: Run full E2E suite on MongoDB backend**

Run:
```bash
cd aimeat && pnpm test:e2e:mongodb
```

Expected: 0 failures.

- [ ] **Step 3: Verify npm install simulation**

Run:
```bash
cd aimeat && npm pack --dry-run 2>&1 | head -30
```

Expected: The tarball contains `dist/` contents, `package.json`, and `prisma/` (if added). No `node_modules/`, no `src/`, no `test/`. Confirm `isolated-vm` is NOT in the dependencies.

- [ ] **Step 4: Test clean install (optional but recommended)**

```bash
# In a temp directory:
cd /tmp && mkdir aimeat-test && cd aimeat-test
npm init -y
npm install /path/to/aimeat-protocol/aimeat
```

Expected: Installs without needing C++ build tools. No `node-gyp` compilation for quickjs-emscripten.
