/**
 * @file test/unit/extension-buy-fanout.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A seller action ctx.buy starts runs inside its buyer's run slot ('inherited'), so it
 *   takes no slot of its own. ctx.buy is an asynchronous host call, and a script may start many at
 *   once, so one admitted run could start up to its API-call limit of seller sandboxes together
 *   (secaudit2026oct26, extension-invoke:ctx-buy-inherited-admission-unbounded-fanout). One run's
 *   seller runs now wait in a queue past SELLER_RUNS_PER_RUN at once; none is refused.
 *
 *   The sandbox and the purchase are stood in for here: the buying run starts twenty purchases at
 *   once, and each seller run is counted while it runs. Usage kept: every purchase answers.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-buy-fanout.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi } from 'vitest';

let sellerNow = 0, sellerMost = 0;

vi.mock('../../src/services/extension-runtime.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    return {
        ...real,
        executeExtensionAction: async (_script: string, ctx: { extension?: { name: string }; buy?: (a: string, t: string, i?: unknown) => Promise<unknown> }) => {
            if (ctx.extension?.name === 'buyer') {
                // Twenty purchases, none awaited before the next starts. The starts are a few
                // milliseconds apart because ctx.buy loads the purchase module with a dynamic import,
                // and the test runner hands two imports that overlap the real module instead of the
                // stand-in; each seller run lasts far longer than the spread, so they still overlap.
                const pending: Array<Promise<unknown>> = [];
                for (let i = 0; i < 20; i++) {
                    pending.push(ctx.buy!('seller/app.html', 'tool', {}));
                    await new Promise(r => setTimeout(r, 5));
                }
                const all = await Promise.all(pending);
                return { bought: all.length, ok: all.every(r => (r as { ok?: boolean }).ok === true) };
            }
            sellerNow++; sellerMost = Math.max(sellerMost, sellerNow);
            try { await new Promise(r => setTimeout(r, 200)); return { sold: true }; } finally { sellerNow--; }
        },
    };
});

vi.mock('../../src/services/extension-purchase.js', () => ({
    buyForExtension: async (args: { runSellerAction: (run: unknown) => Promise<{ kind: string }> }) => {
        const out = await args.runSellerAction({
            extRef: 'seller', actionId: 'act', input: {},
            caller: { gaii: 'eco:buyer#bob@node-1', metered: 'eco:buyer#bob@node-1', owner: 'bob', kind: 'ecosystem', roles: ['ecosystem'], scopes: [], appGrantId: null },
            res: {}, internalPass: 'pass',
        });
        return { ok: out.kind === 'ok' };
    },
}));

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { invokeExtensionAction } = await import('../../src/services/extension-invoke.js');
const { loadConfig } = await import('../../src/config.js');

function ext(name: string, installedBy: string) {
    const now = new Date().toISOString();
    return {
        name, version: '1.0.0', description: 'fan-out test', author: 'test', status: 'active', requiredApis: [],
        actions: [{ id: 'act', method: 'POST', path: '/act', inputSchema: {}, outputSchema: {}, scriptContent: 'export default async () => 1;' }],
        config: { __capabilities: ['payments'] }, limits: { memoryMb: 16, timeoutMs: 5000, maxApiCalls: 100 }, federation: { advertise: false, capabilities: [] },
        installedBy, installedAt: now,
    };
}

describe('ctx.buy seller runs of one buying run', () => {
    it('run a bounded number at once, queued, and every purchase answers', async () => {
        const config = loadConfig().config;
        const storage = new SqliteStorage(':memory:');
        await storage.createExtension(ext('buyer', 'bob') as never);
        await storage.createExtension(ext('seller', 'sally') as never);
        const out = await invokeExtensionAction({
            config, storage: storage as never, enforcePaywall: (async () => ({ ok: true })) as never,
            extRef: 'buyer', actionId: 'act', method: 'POST', input: {},
            caller: { gaii: `bob@${config.nodeId}`, metered: `bob@${config.nodeId}`, owner: 'bob', kind: 'owner', roles: ['owner'], scopes: ['*'], appGrantId: null },
            paywall: { res: {} as never },
        });
        expect(out, JSON.stringify(out)).toMatchObject({ kind: 'ok', result: { bought: 20, ok: true } });
        expect(sellerMost).toBeGreaterThan(0);
        expect(sellerMost).toBeLessThanOrEqual(4);
    });
});
