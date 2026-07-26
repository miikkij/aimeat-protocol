/**
 * @file extension-runtime.ts
 * @description QuickJS WASM Sandbox Runtime for AIMEAT Extension Actions.
 *   Executes user-provided extension scripts in a sandboxed QuickJS engine
 *   compiled to WASM via `quickjs-emscripten`. The sandbox has NO access to
 *   Node.js globals (process, require, Buffer, etc.) -- only a controlled
 *   `ctx` API proxy.
 * @version-history
 *   v1.0.0 -- 2026-03-01 -- Initial V8 sandbox implementation (isolated-vm)
 *   v1.1.0 -- 2026-03-15 -- Add memory access tracking (MemoryAccessLog + trackMemoryAccess)
 *   v2.0.0 -- 2026-04-29 -- Replace isolated-vm with quickjs-emscripten (pure WASM, no C++ build tools)
 *   v2.1.0 -- 2026-07-07 -- Await/abort in-flight host calls before disposing the runtime; fixes JS_FreeRuntime gc assertion abort when a script rejects with sibling async calls still pending (e.g. multi-feed fetch, one feed fails)
 *   v2.2.0 -- 2026-07-08 -- Self-heal a poisoned WASM engine: detect an emscripten abort and rebuild the module singleton so one abort no longer fails every later run until a process restart
 *   v2.4.0 -- 2026-07-26 -- Give the sandbox the two primitives every author was otherwise forced to
 *     hand-roll: `ctx.hash(s)` (FNV-1a 64-bit, published as EXT_HASH_REFERENCE_JS so a browser app
 *     can compute the SAME value -- there is no crypto.subtle in QuickJS, and an app/extension pair
 *     that hashes differently silently recomputes and re-charges everything) and `ctx.now()` (the
 *     run's start timestamp, fixed for the whole action so multi-record writes stay consistent).
 *     Both are pure guest-side helpers: no host call, no API-budget cost.
 *   v2.3.0 -- 2026-07-18 -- transformScript preserves top-level helpers/consts declared ABOVE `export default` (rewrites the export in place instead of wrapping the whole script) -- fixes QuickJS "unexpected token 'const'" for actions that define a helper above the export, which the extension prompt explicitly permits
 */
import { getQuickJS, newQuickJSWASMModule, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten';
import { safeFetch } from '../utils/url-validator.js';

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
    /** Stored FILES, by reference. Optional the way notify/email are: a context that cannot offer
     *  it (a scheduled run with no caller) simply does not, and the guest sees undefined. */
    files?: {
        read(ref: string): Promise<{ base64: string; mime: string; size: number; key: string } | null>;
        write(key: string, base64: string, opts?: { mime?: string; visibility?: string }):
            Promise<{ key: string; gaii: string; url: string; size: number }>;
    };
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
    // NOTE: the guest ctx also exposes two PURE helpers that need no host call and are therefore
    // implemented inside buildSandboxScript rather than here:
    //   ctx.hash(s) -> 16 hex chars, FNV-1a 64-bit (see EXT_HASH_REFERENCE_JS)
    //   ctx.now()   -> the ISO timestamp captured when this action started (fixed for the run)
}

/**
 * The EXACT source of `ctx.hash`, exported so an app that must agree with an extension on a
 * derived value can run the identical function in the browser.
 *
 * Why this exists: the sandbox has no `crypto.subtle`, so an extension author reaches for a
 * hand-rolled hash while the browser side reaches for SHA-256, and the two silently disagree. That
 * is not hypothetical — it shipped: an app and its extension hashed the same spreadsheet inputs
 * differently, so every value the app computed looked stale to the server and would have been
 * recomputed and re-charged forever. One published function, usable verbatim on both sides.
 *
 * FNV-1a style, 64 bits as two 32-bit lanes. Not cryptographic: use it for cache keys, change
 * detection and content identity, never for signatures or secrets.
 */
export const EXT_HASH_REFERENCE_JS = `function aimeatHash(s) {
  s = String(s);
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i);
    h1 = (h1 ^ ch) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ (ch + i)) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
}`;

export interface ExtensionLimits {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
}

// ── Internal helpers ─────────────────────────────────────────

function setStringGlobal(vm: QuickJSContext, name: string, value: string | null): void {
    if (value === null) {
        vm.setProp(vm.global, name, vm.null);
        return;
    }
    const handle = vm.newString(value);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
}

/** Flush the guest microtask queue only while the runtime is still alive. */
function drainJobs(vm: QuickJSContext): void {
    if (vm.runtime.alive) vm.runtime.executePendingJobs();
}

function registerAsyncHostFn(
    vm: QuickJSContext,
    name: string,
    fn: ((...args: string[]) => Promise<unknown>) | null,
    counter: { count: number },
    maxApiCalls: number,
    inflight: Set<Promise<unknown>>,
): void {
    if (fn === null) {
        vm.setProp(vm.global, name, vm.null);
        return;
    }

    const fnHandle = vm.newFunction(name, (...argHandles: QuickJSHandle[]) => {
        const args = argHandles.map(h => vm.getString(h));
        const promise = vm.newPromise();

        counter.count++;
        if (counter.count > maxApiCalls) {
            promise.reject(vm.newString('API call limit exceeded'));
            promise.settled.then(() => drainJobs(vm));
            return promise.handle;
        }

        const hostCall: Promise<void> = fn(...args)
            .then(result => {
                if (vm.alive) {
                    const jsonStr = JSON.stringify(result ?? null);
                    promise.resolve(vm.newString(jsonStr));
                }
            })
            .catch((err: unknown) => {
                if (vm.alive) {
                    const msg = err instanceof Error ? err.message : String(err);
                    promise.reject(vm.newString(msg));
                }
            })
            .finally(() => {
                inflight.delete(hostCall);
                if (vm.alive) promise.settled.then(() => drainJobs(vm));
            });

        // Track the in-flight call so teardown can wait for it to settle its
        // guest promise (and dispose those handles) BEFORE the runtime is freed.
        inflight.add(hostCall);
        return promise.handle;
    });
    vm.setProp(vm.global, name, fnHandle);
    fnHandle.dispose();
}

function registerLogFn(
    vm: QuickJSContext,
    name: string,
    fn: (msg: string, data?: Record<string, unknown>) => void,
): void {
    const fnHandle = vm.newFunction(name, (...argHandles: QuickJSHandle[]) => {
        const msg = vm.getString(argHandles[0]);
        let data: Record<string, unknown> | undefined;
        if (argHandles.length > 1) {
            const raw = vm.dump(argHandles[1]);
            if (raw !== undefined && raw !== null) {
                const dataJson = typeof raw === 'string' ? raw : JSON.stringify(raw);
                data = JSON.parse(dataJson) as Record<string, unknown>;
            }
        }
        fn(msg, data);
    });
    vm.setProp(vm.global, name, fnHandle);
    fnHandle.dispose();
}

function transformScript(scriptContent: string): string {
    // Turn the action's `export default <fn>` into `const __userFn = <fn>` IN PLACE, so any
    // top-level helper declarations (const/function) that precede the export are preserved.
    // The extension prompt explicitly tells authors to "define a HELPER FUNCTION above the
    // action exports"; the old version wrapped the WHOLE script as `const __userFn = <script>`,
    // which produced `const __userFn = const BASE_URL = …` → QuickJS "unexpected token 'const'".
    // For a script that starts directly with `export default` the output is byte-identical to before.
    const transformed = scriptContent.replace(/export\s+default\s+/, 'const __userFn = ').trim();
    return transformed.endsWith(';') ? transformed : `${transformed};`;
}

function buildSandboxScript(userFnDecl: string): string {
    return `
${userFnDecl}

(async () => {
    async function __call(fn, args) {
        const raw = await fn(...args);
        return JSON.parse(raw);
    }

    // Pure helpers: no host round trip, so they cost no API-call budget and add no latency.
    // ctx.hash is the node's PUBLISHED hash (EXT_HASH_REFERENCE_JS) so a browser app can compute
    // the identical value; the sandbox has no crypto.subtle, and letting each author invent one is
    // how an app and its extension end up disagreeing about what is up to date.
    ${EXT_HASH_REFERENCE_JS.replace(/^function aimeatHash/, 'function __hash')}

    const ctx = {
        // One timestamp for the whole action run: two calls cannot disagree, so an action that
        // stamps several records stays internally consistent and replayable.
        now: () => __runStartedAt,
        hash: (s) => __hash(s),
        memory: {
            get:       async (key)            => __call(__memory_get, [key]),
            set:       async (key, value)     => __call(__memory_set, [key, JSON.stringify(value)]),
            search:    async (prefix, opts)   => __call(__memory_search, [prefix, opts ? JSON.stringify(opts) : '{}']),
            delete:    async (key)            => __call(__memory_delete, [key]),
            getPublic: async (namespace, key) => __call(__memory_getPublic, [namespace, key]),
        },
        fetch: async (url, opts) => __call(__fetch, [url, opts ? JSON.stringify(opts) : '{}']),
        files: __files_read ? {
            read:  async (ref)              => __call(__files_read, [ref]),
            write: async (key, b64, opts)   => __call(__files_write, [key, b64, opts ? JSON.stringify(opts) : '{}']),
        } : undefined,
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
        log: Object.assign(
            (msg, data) => __log_info(msg, data !== undefined ? JSON.stringify(data) : undefined),
            {
                info:  (msg, data) => __log_info(msg, data !== undefined ? JSON.stringify(data) : undefined),
                warn:  (msg, data) => __log_warn(msg, data !== undefined ? JSON.stringify(data) : undefined),
                error: (msg, data) => __log_error(msg, data !== undefined ? JSON.stringify(data) : undefined),
            },
        ),
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

let quickJSPromise: Promise<QuickJSWASMModule> | null = null;
function getQuickJSSingleton(): Promise<QuickJSWASMModule> {
    if (!quickJSPromise) quickJSPromise = getQuickJS();
    return quickJSPromise;
}

/**
 * True if `err` looks like an emscripten `abort()` — a hard WASM failure that
 * poisons the whole engine instance (every later runtime created from it fails
 * the same way). The canonical case is the JS_FreeRuntime gc assertion.
 */
export function isEngineAbort(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Aborted(') || msg.includes('JS_FreeRuntime') || msg.includes('gc_obj_list');
}

/**
 * Discard a poisoned engine so the NEXT execution instantiates a fresh WASM
 * module instead of reusing the dead one. `getQuickJS()` hands back a shared
 * singleton (still poisoned after an abort), so recovery must use a brand-new
 * module instance via `newQuickJSWASMModule()`.
 */
function resetQuickJSSingleton(): void {
    quickJSPromise = newQuickJSWASMModule();
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
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs));

    const vm = runtime.newContext();

    // Aborted on teardown to cancel any in-flight host I/O (e.g. slow fetches)
    // so cleanup doesn't block on the network.
    const teardown = new AbortController();
    // In-flight host calls whose guest promises have not settled yet. Disposing
    // the runtime while any are live trips the QuickJS JS_FreeRuntime gc
    // assertion (a hard WASM abort that poisons the shared engine singleton).
    const inflight = new Set<Promise<unknown>>();

    try {
        const counter = { count: 0 };

        // ── Serialized data ──────────────────────────────────
        setStringGlobal(vm, '__inputJson', JSON.stringify(input));
        // Captured ONCE here, so ctx.now() is stable across the whole action.
        setStringGlobal(vm, '__runStartedAt', new Date().toISOString());
        setStringGlobal(vm, '__callerJson', JSON.stringify(ctx.caller));
        setStringGlobal(vm, '__configJson', JSON.stringify(ctx.config));
        setStringGlobal(vm, '__instanceJson', ctx.instance ? JSON.stringify(ctx.instance) : null);

        // ── Memory API ────────────────────────────────────────
        registerAsyncHostFn(vm, '__memory_get',
            async (key) => ctx.memory.get(key),
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__memory_set',
            async (key, valueJson) => { const value = JSON.parse(valueJson); await ctx.memory.set(key, value); },
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__memory_search',
            async (prefix, optsJson) => {
                const opts = JSON.parse(optsJson || '{}') as Record<string, unknown>;
                return ctx.memory.search(prefix, opts);
            },
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__memory_delete',
            async (key) => ctx.memory.delete(key),
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__memory_getPublic',
            async (namespace, key) => ctx.memory.getPublic(namespace, key),
            counter, limits.maxApiCalls, inflight);

        // ── Fetch API ─────────────────────────────────────────
        registerAsyncHostFn(vm, '__fetch',
            async (url, optsJson) => {
                const opts = JSON.parse(optsJson || '{}') as {
                    method?: string; headers?: Record<string, string>; body?: string;
                };
                // safeFetch validates the URL AND re-validates every redirect hop (redirect:'manual'),
                // so an allowed host cannot 3xx-bounce the guest's request to an internal target.
                // Throws `Fetch blocked: <reason>` on a blocked URL/hop (surfaced to the guest as an error).
                const resp = await safeFetch(url, {
                    method: opts.method || 'GET',
                    headers: opts.headers,
                    body: opts.body,
                    signal: AbortSignal.any([teardown.signal, AbortSignal.timeout(Math.min(limits.timeoutMs, 30_000))]),
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
            counter, limits.maxApiCalls, inflight);

        // ── Files API ─────────────────────────────────────────
        // A capability that works on bytes takes a REFERENCE and answers with one. Both sides are
        // size-capped in the factory before any base64 crosses this bridge.
        registerAsyncHostFn(vm, '__files_read',
            ctx.files ? async (ref) => ctx.files!.read(ref) : null,
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__files_write',
            ctx.files
                ? async (key, b64, optsJson) => ctx.files!.write(key, b64, JSON.parse(optsJson || '{}') as { mime?: string; visibility?: string })
                : null,
            counter, limits.maxApiCalls, inflight);

        // ── Wallet API ────────────────────────────────────────
        registerAsyncHostFn(vm, '__wallet_consume',
            ctx.wallet.consume
                ? async (amountStr, reason) => ctx.wallet.consume!(Number(amountStr), reason)
                : null,
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__wallet_balance',
            ctx.wallet.getBalance
                ? async () => ctx.wallet.getBalance!()
                : null,
            counter, limits.maxApiCalls, inflight);

        // ── Consent API ───────────────────────────────────────
        registerAsyncHostFn(vm, '__consent_check',
            ctx.consent.check
                ? async (gaii, scope) => ctx.consent.check!(gaii, scope)
                : null,
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__consent_require',
            ctx.consent.require
                ? async (gaii, scope) => ctx.consent.require!(gaii, scope)
                : null,
            counter, limits.maxApiCalls, inflight);

        // ── Trust API ─────────────────────────────────────────
        registerAsyncHostFn(vm, '__trust_getScore',
            ctx.trust.getScore
                ? async (gaii) => ctx.trust.getScore!(gaii)
                : null,
            counter, limits.maxApiCalls, inflight);

        // ── Log functions (no API count) ──────────────────────
        registerLogFn(vm, '__log_info', ctx.log.info);
        registerLogFn(vm, '__log_warn', ctx.log.warn);
        registerLogFn(vm, '__log_error', ctx.log.error);

        // ── Notify & Email ────────────────────────────────────
        registerAsyncHostFn(vm, '__notify',
            ctx.notify
                ? async (message, optsJson) => ctx.notify!(message, optsJson ? JSON.parse(optsJson) as Record<string, string> : undefined)
                : null,
            counter, limits.maxApiCalls, inflight);

        registerAsyncHostFn(vm, '__email',
            ctx.email
                ? async (to, subject, body) => ctx.email!(to, subject, body)
                : null,
            counter, limits.maxApiCalls, inflight);

        // ── Build and evaluate ────────────────────────────────
        const userFnDecl = transformScript(scriptContent);
        const fullScript = buildSandboxScript(userFnDecl);

        const evalResult = vm.evalCode(fullScript);
        const promiseHandle = vm.unwrapResult(evalResult);

        // resolvePromise registers a .then() inside the guest VM.
        // executePendingJobs flushes the microtask queue so the callback fires.
        // Order matters: register first, flush second, then await.
        const resolveP = vm.resolvePromise(promiseHandle);
        runtime.executePendingJobs();

        const resolvedResult = await resolveP;
        promiseHandle.dispose();

        const resultHandle = vm.unwrapResult(resolvedResult);
        const resultJson = vm.getString(resultHandle);
        resultHandle.dispose();

        return JSON.parse(resultJson) as Record<string, unknown>;
    } finally {
        // Cancel in-flight host I/O, then let every outstanding host call settle
        // its guest promise WHILE the VM is still alive so its handles are
        // disposed. Freeing the runtime with live promise objects aborts the
        // WASM engine (JS_FreeRuntime gc assertion). A settling call can enqueue
        // a guest microtask that starts another host call, so loop until drained
        // -- bounded by maxApiCalls, and by teardown making new fetches fail fast.
        teardown.abort();
        try {
            while (inflight.size > 0) {
                await Promise.allSettled([...inflight]);
                // Let the .settled -> executePendingJobs microtasks run before we
                // re-check, so guest reactions to the settlements are flushed.
                await Promise.resolve();
                if (runtime.alive) runtime.executePendingJobs();
            }
            if (vm.alive) vm.dispose();
            if (runtime.alive) runtime.dispose();
        } catch (teardownErr) {
            // A WASM abort here (should no longer happen for known triggers, but
            // guard against any residual path) poisons the shared engine for the
            // whole process. Rebuild it so the next execution gets a clean module
            // instead of failing forever until a manual restart. Swallow the
            // teardown error so it never masks the script's real result/error.
            if (isEngineAbort(teardownErr)) resetQuickJSSingleton();
        }
    }
}
