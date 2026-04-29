import { describe, it, expect, vi } from 'vitest';
import { executeExtensionAction } from '../../src/services/extension-runtime.js';
import type { ExtensionCtx, ExtensionLimits } from '../../src/services/extension-runtime.js';

// ── Helpers ──────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExtensionCtx> = {}): ExtensionCtx {
    const memoryStore = new Map<string, unknown>();

    return {
        memory: {
            async get(key: string) {
                return memoryStore.get(key) ?? null;
            },
            async set(key: string, value: unknown) {
                memoryStore.set(key, value);
            },
            async search(_prefix: string, _opts?: Record<string, unknown>) {
                return [];
            },
            async delete(key: string) {
                return memoryStore.delete(key);
            },
        },
        wallet: {},
        consent: {},
        trust: {},
        caller: { gaii: 'test-agent#owner@test-node', owner: 'owner', roles: ['agent'] },
        config: {},
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        ...overrides,
    };
}

function defaultLimits(overrides: Partial<ExtensionLimits> = {}): ExtensionLimits {
    return {
        memoryMb: 8,
        timeoutMs: 5000,
        maxApiCalls: 100,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────

describe('executeExtensionAction', () => {
    it('executes a simple action and returns result', async () => {
        const script = `export default async function(ctx, input) {
            return { greeting: 'Hello ' + input.name };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx(),
            { name: 'World' },
            defaultLimits(),
        );

        expect(result).toEqual({ greeting: 'Hello World' });
    });

    it('enforces timeout on infinite loops', async () => {
        const script = `export default async function(ctx, input) {
            while (true) {}
            return {};
        }`;

        await expect(
            executeExtensionAction(script, makeCtx(), {}, defaultLimits({ timeoutMs: 200 })),
        ).rejects.toThrow(/timed out|interrupted/i);
    });

    it('does not expose Node.js globals (process, require)', async () => {
        const script = `export default async function(ctx, input) {
            return {
                hasProcess: typeof process !== 'undefined',
                hasRequire: typeof require !== 'undefined',
                hasBuffer: typeof Buffer !== 'undefined',
            };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx(),
            {},
            defaultLimits(),
        );

        expect(result.hasProcess).toBe(false);
        expect(result.hasRequire).toBe(false);
        expect(result.hasBuffer).toBe(false);
    });

    it('supports ctx.memory API calls with data roundtrip', async () => {
        const script = `export default async function(ctx, input) {
            await ctx.memory.set('mykey', { value: 42 });
            const stored = await ctx.memory.get('mykey');
            return { stored };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx(),
            {},
            defaultLimits(),
        );

        expect(result.stored).toEqual({ value: 42 });
    });

    it('enforces API call limit', async () => {
        const script = `export default async function(ctx, input) {
            const results = [];
            for (let i = 0; i < 20; i++) {
                results.push(await ctx.memory.get('key-' + i));
            }
            return { count: results.length };
        }`;

        await expect(
            executeExtensionAction(
                script,
                makeCtx(),
                {},
                defaultLimits({ maxApiCalls: 5 }),
            ),
        ).rejects.toThrow(/API call limit/i);
    });

    it('provides caller info to the script', async () => {
        const script = `export default async function(ctx, input) {
            return {
                gaii: ctx.caller.gaii,
                owner: ctx.caller.owner,
                roles: ctx.caller.roles,
            };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx({
                caller: { gaii: 'bot#alice@node', owner: 'alice', roles: ['agent', 'operator'] },
            }),
            {},
            defaultLimits(),
        );

        expect(result.gaii).toBe('bot#alice@node');
        expect(result.owner).toBe('alice');
        expect(result.roles).toEqual(['agent', 'operator']);
    });

    it('provides config to the script', async () => {
        const script = `export default async function(ctx, input) {
            return { retryCount: ctx.config.retryCount };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx({ config: { retryCount: 3 } }),
            {},
            defaultLimits(),
        );

        expect(result.retryCount).toBe(3);
    });

    it('handles script that returns undefined gracefully', async () => {
        const script = `export default async function(ctx, input) {
            // no return
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx(),
            {},
            defaultLimits(),
        );

        expect(result).toEqual({});
    });

    it('propagates user script errors', async () => {
        const script = `export default async function(ctx, input) {
            throw new Error('Something broke');
        }`;

        await expect(
            executeExtensionAction(script, makeCtx(), {}, defaultLimits()),
        ).rejects.toThrow('Something broke');
    });

    it('supports ctx.memory.delete', async () => {
        const script = `export default async function(ctx, input) {
            await ctx.memory.set('tmp', 'value');
            const before = await ctx.memory.get('tmp');
            await ctx.memory.delete('tmp');
            const after = await ctx.memory.get('tmp');
            return { before, after };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx(),
            {},
            defaultLimits(),
        );

        expect(result.before).toBe('value');
        expect(result.after).toBeNull();
    });

    it('calls ctx.log methods', async () => {
        const logInfo = vi.fn();
        const logWarn = vi.fn();
        const logError = vi.fn();

        const script = `export default async function(ctx, input) {
            ctx.log.info('hello info', { key: 'val' });
            ctx.log.warn('hello warn');
            ctx.log.error('hello error');
            return { logged: true };
        }`;

        const result = await executeExtensionAction(
            script,
            makeCtx({
                log: { info: logInfo, warn: logWarn, error: logError },
            }),
            {},
            defaultLimits(),
        );

        expect(result.logged).toBe(true);
        expect(logInfo).toHaveBeenCalledWith('hello info', { key: 'val' });
        expect(logWarn).toHaveBeenCalledWith('hello warn', undefined);
        expect(logError).toHaveBeenCalledWith('hello error', undefined);
    });
});
