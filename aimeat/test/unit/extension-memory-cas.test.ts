/**
 * @file extension-memory-cas.test.ts
 * @description Compare-and-swap in the extension sandbox. `ctx.memory.set` read the stored record,
 *   incremented its version and wrote, which is last-write-wins: two concurrent invocations of the
 *   same action could both read a stock of 1 and both write 0. Every extension that counts anything
 *   was racy, and the node already owned the atomic primitives the fix needs
 *   (`setMemoryIfVersion` for the update, `createMemoryIfAbsent` for the first write) — the sandbox
 *   simply could not reach them.
 *
 *   The pair under test is `getVersioned` (a script cannot start a CAS loop without the version it
 *   is swapping against) and `set(key, value, { ifVersion })`.
 * @structure
 *   - default set: unchanged last-write-wins, and now reports the version it wrote
 *   - ifVersion: 0 creates only when absent
 *   - ifVersion: n updates only at that version, and conflicts do not write
 *   - the race: concurrent decrements of a stock of 1 leave exactly one winner
 * @usage pnpm test -- extension-memory-cas
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import type { ExtensionCtx } from '../../src/services/extension-runtime.js';
import { loadConfig } from '../../src/config.js';

const EXT_OWNER = 'ext:shop';

function makeCtx(storage: SqliteStorage): ExtensionCtx {
    return buildExtensionCtx({
        config: loadConfig().config,
        storage: storage as never,
        extMemoryOwner: EXT_OWNER,
        caller: { gaii: 'alice@aimeat-local-001-dev', owner: 'alice', roles: ['owner'] } as never,
        extConfig: {},
        logPrefix: 'test',
    });
}

describe('ctx.memory compare-and-swap', () => {
    let storage: SqliteStorage;
    let ctx: ExtensionCtx;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
        ctx = makeCtx(storage);
    });

    it('a plain set still writes, and now says which version it wrote', async () => {
        const first = await ctx.memory.set('stock', { units: 3 });
        expect(first.ok).toBe(true);
        expect(first.version).toBe(1);

        const second = await ctx.memory.set('stock', { units: 2 });
        expect(second.ok).toBe(true);
        expect(second.version).toBe(2);
        expect(await ctx.memory.get('stock')).toEqual({ units: 2 });
    });

    it('getVersioned hands back the value and the version to swap against', async () => {
        expect(await ctx.memory.getVersioned('stock')).toBeNull();
        await ctx.memory.set('stock', { units: 3 });
        const read = await ctx.memory.getVersioned('stock');
        expect(read).toEqual({ value: { units: 3 }, version: 1 });
    });

    it('ifVersion 0 creates the key, and refuses once it exists', async () => {
        const created = await ctx.memory.set('stock', { units: 3 }, { ifVersion: 0 });
        expect(created.ok).toBe(true);

        const again = await ctx.memory.set('stock', { units: 99 }, { ifVersion: 0 });
        expect(again.ok).toBe(false);
        // The refusal wrote nothing.
        expect(await ctx.memory.get('stock')).toEqual({ units: 3 });
    });

    it('a conflicting ifVersion writes nothing and reports the version that is really there', async () => {
        await ctx.memory.set('stock', { units: 3 });          // version 1
        await ctx.memory.set('stock', { units: 2 });          // version 2

        const stale = await ctx.memory.set('stock', { units: 0 }, { ifVersion: 1 });
        expect(stale.ok).toBe(false);
        expect(stale.version).toBe(2);
        expect(await ctx.memory.get('stock')).toEqual({ units: 2 });
    });

    // The defect this whole pair exists for: the last unit sold twice.
    it('two concurrent claims on the last unit leave exactly one winner', async () => {
        await ctx.memory.set('stock', { units: 1 });

        async function claim() {
            const read = await ctx.memory.getVersioned('stock');
            const units = (read!.value as { units: number }).units;
            if (units < 1) return { won: false };
            const res = await ctx.memory.set('stock', { units: units - 1 }, { ifVersion: read!.version });
            return { won: res.ok };
        }

        const [a, b] = await Promise.all([claim(), claim()]);
        expect([a.won, b.won].filter(Boolean).length).toBe(1);
        expect(await ctx.memory.get('stock')).toEqual({ units: 0 });
    });

    it('an extension cannot use ifVersion to write outside its own namespace', async () => {
        // The key is always resolved under extMemoryOwner; there is no owner parameter to aim
        // elsewhere. Proven by writing and then reading the record back under a different owner.
        await ctx.memory.set('stock', { units: 3 }, { ifVersion: 0 });
        expect(await storage.getMemory('ext:other-shop', 'stock')).toBeNull();
        expect((await storage.getMemory(EXT_OWNER, 'stock'))?.value).toEqual({ units: 3 });
    });
});
