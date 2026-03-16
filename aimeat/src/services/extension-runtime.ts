/**
 * @file extension-runtime.ts
 * @description V8 Isolate Sandbox Runtime for AIMEAT Extension Actions.
 *   Executes user-provided extension scripts in a sandboxed V8 isolate
 *   using `isolated-vm`. The sandbox has NO access to Node.js globals
 *   (process, require, Buffer, etc.) — only a controlled `ctx` API proxy.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial V8 sandbox implementation
 *   v1.1.0 — 2026-03-15 — Add memory access tracking (MemoryAccessLog + trackMemoryAccess)
 */
import ivm from 'isolated-vm';

// ── Public interfaces ────────────────────────────────────────

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
}

export interface ExtensionLimits {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Wraps a host async function as an `ivm.Reference` that returns a
 * JSON-encoded envelope: `{ __val: ... }` on success, `{ __err: "..." }` on error.
 *
 * The API-call counter is incremented on every invocation, and an error
 * envelope is returned once the limit is exceeded.
 */
function makeRef(
    fn: (...args: unknown[]) => Promise<unknown>,
    counter: { count: number },
    maxApiCalls: number,
): ivm.Reference<(...args: unknown[]) => Promise<string>> {
    return new ivm.Reference(async (...args: unknown[]) => {
        counter.count++;
        if (counter.count > maxApiCalls) {
            return JSON.stringify({ __err: 'API call limit exceeded' });
        }
        try {
            const result = await fn(...args);
            return JSON.stringify({ __val: result });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ __err: message });
        }
    });
}

/**
 * Wraps a host synchronous log function as an `ivm.Reference`.
 * Log calls do NOT count toward the API call limit.
 */
function makeLogRef(
    fn: (msg: string, data?: Record<string, unknown>) => void,
): ivm.Reference<(msg: string, dataJson?: string) => void> {
    return new ivm.Reference((msg: string, dataJson?: string) => {
        const data = dataJson ? JSON.parse(dataJson) as Record<string, unknown> : undefined;
        fn(msg, data);
    });
}

/**
 * Transforms a user extension script that uses `export default async function(ctx, input) { ... }`
 * into a form that can be executed inside the isolate.
 */
function transformScript(scriptContent: string): string {
    // Strip "export default" — supports `export default async function`, `export default function`
    const body = scriptContent.replace(/export\s+default\s+/, '').trim();
    return `const __userFn = ${body};`;
}

/**
 * Builds the full isolate script that:
 * 1. Constructs a `ctx` object with proxied API calls back to the host
 * 2. Parses serialized `input`, `caller`, and `config`
 * 3. Invokes the user function
 * 4. Returns JSON-serialized result
 */
function buildIsolateScript(userFnDecl: string): string {
    return `
${userFnDecl}

(async () => {
    // Helper: call a host reference and unwrap the JSON envelope
    async function __call(ref, args) {
        const raw = await ref.apply(undefined, args, { result: { promise: true } });
        const parsed = JSON.parse(raw);
        if (parsed.__err) throw new Error(parsed.__err);
        return parsed.__val;
    }

    // Helper: call a host log reference (fire-and-forget, no return)
    function __logCall(ref, msg, data) {
        const dataJson = data !== undefined ? JSON.stringify(data) : undefined;
        ref.applyIgnored(undefined, dataJson !== undefined ? [msg, dataJson] : [msg]);
    }

    // Build ctx proxy
    const ctx = {
        memory: {
            get:    async (key)        => __call(__memory_get, [key]),
            set:    async (key, value) => __call(__memory_set, [key, JSON.stringify(value)]),
            search: async (prefix, opts) => __call(__memory_search, [prefix, opts ? JSON.stringify(opts) : '{}']),
            delete: async (key)        => __call(__memory_delete, [key]),
            getPublic: async (namespace, key) => __call(__memory_getPublic, [namespace, key]),
        },
        fetch: async (url, opts) => __call(__fetch, [url, opts ? JSON.stringify(opts) : '{}']),
        wallet: {
            consume:    __wallet_consume   ? (async (amount, reason) => __call(__wallet_consume, [amount, reason]))               : undefined,
            getBalance: __wallet_balance   ? (async () => __call(__wallet_balance, []))                                            : undefined,
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
            info:  (msg, data) => __logCall(__log_info, msg, data),
            warn:  (msg, data) => __logCall(__log_warn, msg, data),
            error: (msg, data) => __logCall(__log_error, msg, data),
        },
    };

    const input = JSON.parse(__inputJson);
    const result = await __userFn(ctx, input);
    return JSON.stringify(result ?? {});
})()
`;
}

// ── Memory access tracking ───────────────────────────────────

/** Tracks memory keys read/written during an extension execution */
export interface MemoryAccessLog {
    reads: string[];
    writes: string[];
}

/**
 * Wraps an ExtensionCtx's memory methods to track read/write keys.
 * Returns the wrapped ctx + the access log for post-execution recording.
 */
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

export async function executeExtensionAction(
    scriptContent: string,
    ctx: ExtensionCtx,
    input: Record<string, unknown>,
    limits: ExtensionLimits,
): Promise<Record<string, unknown>> {
    const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });

    try {
        const context = isolate.createContextSync();
        const jail = context.global;

        // API call counter — shared across all references
        const counter = { count: 0 };

        // ── Serialized data ──────────────────────────────────
        jail.setSync('__inputJson', JSON.stringify(input));
        jail.setSync('__callerJson', JSON.stringify(ctx.caller));
        jail.setSync('__configJson', JSON.stringify(ctx.config));
        jail.setSync('__instanceJson', ctx.instance ? JSON.stringify(ctx.instance) : null);

        // ── Memory API references ────────────────────────────
        jail.setSync('__memory_get', makeRef(
            async (key) => ctx.memory.get(key as string),
            counter, limits.maxApiCalls,
        ));

        jail.setSync('__memory_set', makeRef(
            async (key, valueJson) => {
                const value = JSON.parse(valueJson as string);
                await ctx.memory.set(key as string, value);
            },
            counter, limits.maxApiCalls,
        ));

        jail.setSync('__memory_search', makeRef(
            async (prefix, optsJson) => {
                const opts = JSON.parse((optsJson as string) || '{}') as Record<string, unknown>;
                return ctx.memory.search(prefix as string, opts);
            },
            counter, limits.maxApiCalls,
        ));

        jail.setSync('__memory_delete', makeRef(
            async (key) => ctx.memory.delete(key as string),
            counter, limits.maxApiCalls,
        ));

        jail.setSync('__memory_getPublic', makeRef(
            async (namespace, key) => ctx.memory.getPublic(namespace as string, key as string),
            counter, limits.maxApiCalls,
        ));

        // ── Fetch API reference (proxied HTTP) ─────────────
        jail.setSync('__fetch', makeRef(
            async (url, optsJson) => {
                const opts = JSON.parse((optsJson as string) || '{}') as {
                    method?: string; headers?: Record<string, string>; body?: string;
                };
                const resp = await fetch(url as string, {
                    method: opts.method || 'GET',
                    headers: opts.headers,
                    body: opts.body,
                    signal: AbortSignal.timeout(Math.min(limits.timeoutMs, 30_000)),
                });
                // Always read raw bytes first so we can detect charset from multiple sources
                const buf = await resp.arrayBuffer();
                const ct = resp.headers.get('content-type') || '';
                const ctCharsetMatch = /charset=([^\s;]+)/i.exec(ct);
                let charset = ctCharsetMatch ? ctCharsetMatch[1].toLowerCase() : '';

                // If Content-Type didn't specify charset, peek at XML/HTML prolog
                if (!charset) {
                    const peek = new TextDecoder('ascii').decode(buf.slice(0, 512));
                    const xmlMatch = /encoding=['"]([^'"]+)['"]/i.exec(peek);
                    const metaMatch = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek);
                    charset = (xmlMatch?.[1] || metaMatch?.[1] || 'utf-8').toLowerCase();
                }

                // Guard against mislabeled encoding: if declared non-UTF-8 but bytes
                // are valid UTF-8 multibyte (e.g. Cloudflare transcoding), trust bytes
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
            counter, limits.maxApiCalls,
        ));

        // ── Wallet API references (caller-only operations) ──
        jail.setSync('__wallet_consume', ctx.wallet.consume
            ? makeRef(
                async (amount, reason) =>
                    ctx.wallet.consume!(amount as number, reason as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        jail.setSync('__wallet_balance', ctx.wallet.getBalance
            ? makeRef(
                async () => ctx.wallet.getBalance!(),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        // ── Consent API references ───────────────────────────
        jail.setSync('__consent_check', ctx.consent.check
            ? makeRef(
                async (gaii, scope) => ctx.consent.check!(gaii as string, scope as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        jail.setSync('__consent_require', ctx.consent.require
            ? makeRef(
                async (gaii, scope) => ctx.consent.require!(gaii as string, scope as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        // ── Trust API reference (read-only — trust scores are system-computed) ──
        jail.setSync('__trust_getScore', ctx.trust.getScore
            ? makeRef(
                async (gaii) =>
                    ctx.trust.getScore!(gaii as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        // ── Log references (no API count) ────────────────────
        jail.setSync('__log_info', makeLogRef(ctx.log.info));
        jail.setSync('__log_warn', makeLogRef(ctx.log.warn));
        jail.setSync('__log_error', makeLogRef(ctx.log.error));

        // ── Compile and run ──────────────────────────────────
        const userFnDecl = transformScript(scriptContent);
        const fullScript = buildIsolateScript(userFnDecl);
        const compiled = isolate.compileScriptSync(fullScript);

        const resultJson = await compiled.run(context, {
            timeout: limits.timeoutMs,
            promise: true,
        }) as string;

        return JSON.parse(resultJson) as Record<string, unknown>;
    } finally {
        if (!isolate.isDisposed) {
            isolate.dispose();
        }
    }
}
