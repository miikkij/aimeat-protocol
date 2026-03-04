/**
 * V8 Isolate Sandbox Runtime for AIMEAT Extension Actions
 *
 * Executes user-provided extension scripts in a sandboxed V8 isolate
 * using `isolated-vm`. The sandbox has NO access to Node.js globals
 * (process, require, Buffer, etc.) — only a controlled `ctx` API proxy.
 */
import ivm from 'isolated-vm';

// ── Public interfaces ────────────────────────────────────────

export interface ExtensionCtx {
    memory: {
        get(key: string): Promise<unknown | null>;
        set(key: string, value: unknown): Promise<void>;
        search(prefix: string, opts?: Record<string, unknown>): Promise<Array<{ key: string; value: unknown }>>;
        delete(key: string): Promise<boolean>;
    };
    wallet: {
        hold?(from: string, amount: number, reason: string): Promise<{ holdId: string }>;
        release?(holdId: string, to: string): Promise<void>;
        transfer?(from: string, to: string, amount: number, reason: string): Promise<void>;
        getBalance?(gaii: string): Promise<number>;
    };
    consent: {
        check?(gaii: string, scope: string): Promise<boolean>;
        require?(gaii: string, scope: string): Promise<void>;
    };
    trust: {
        adjust?(gaii: string, delta: number, reason: string): Promise<void>;
    };
    caller: { gaii: string; owner: string; roles: string[] };
    config: Record<string, unknown>;
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
        },
        wallet: {
            hold:       __wallet_hold     ? (async (from, amount, reason) => __call(__wallet_hold, [from, amount, reason]))     : undefined,
            release:    __wallet_release   ? (async (holdId, to) => __call(__wallet_release, [holdId, to]))                      : undefined,
            transfer:   __wallet_transfer  ? (async (from, to, amount, reason) => __call(__wallet_transfer, [from, to, amount, reason])) : undefined,
            getBalance: __wallet_balance   ? (async (gaii) => __call(__wallet_balance, [gaii]))                                   : undefined,
        },
        consent: {
            check:   __consent_check   ? (async (gaii, scope) => __call(__consent_check, [gaii, scope]))   : undefined,
            require: __consent_require ? (async (gaii, scope) => __call(__consent_require, [gaii, scope])) : undefined,
        },
        trust: {
            adjust: __trust_adjust ? (async (gaii, delta, reason) => __call(__trust_adjust, [gaii, delta, reason])) : undefined,
        },
        caller: JSON.parse(__callerJson),
        config: JSON.parse(__configJson),
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

        // ── Wallet API references ────────────────────────────
        jail.setSync('__wallet_hold', ctx.wallet.hold
            ? makeRef(
                async (from, amount, reason) =>
                    ctx.wallet.hold!(from as string, amount as number, reason as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        jail.setSync('__wallet_release', ctx.wallet.release
            ? makeRef(
                async (holdId, to) => ctx.wallet.release!(holdId as string, to as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        jail.setSync('__wallet_transfer', ctx.wallet.transfer
            ? makeRef(
                async (from, to, amount, reason) =>
                    ctx.wallet.transfer!(from as string, to as string, amount as number, reason as string),
                counter, limits.maxApiCalls,
            )
            : null,
        );

        jail.setSync('__wallet_balance', ctx.wallet.getBalance
            ? makeRef(
                async (gaii) => ctx.wallet.getBalance!(gaii as string),
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

        // ── Trust API reference ──────────────────────────────
        jail.setSync('__trust_adjust', ctx.trust.adjust
            ? makeRef(
                async (gaii, delta, reason) =>
                    ctx.trust.adjust!(gaii as string, delta as number, reason as string),
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
