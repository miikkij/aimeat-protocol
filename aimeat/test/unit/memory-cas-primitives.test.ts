/**
 * @file test/unit/memory-cas-primitives.test.ts
 * @description The two storage primitives PATCH /v1/memory/:key stands on, tested by explicitly
 *   interleaving the steps a race would interleave.
 *
 *   WHY NOT A CONCURRENCY TEST. Firing N overlapping HTTP requests does not prove this: Node's event
 *   loop plus a synchronous SQLite driver serialise them often enough that a last-write-wins
 *   implementation passes such a test unchanged (verified 2026-08-09 by replacing the compare-and-swap
 *   with a plain upsert and watching a six-writer test stay green). A test that cannot fail for the
 *   reason it exists is worse than no test, because it reads like coverage. So the interleave is
 *   written out by hand: read, read, write, write, and assert the second write is refused.
 * @usage pnpm test -- memory-cas-primitives
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial, with PATCH /v1/memory/:key.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord } from '../../src/storage/interface.js';

const GAII = 'writer#alice@test-node';

function rec(key: string, value: unknown, version: number): MemoryRecord {
    const now = new Date().toISOString();
    return {
        key, ownerGaii: GAII, value: value as MemoryRecord['value'],
        visibility: 'owner', tags: [], ttlHours: null,
        version, createdAt: now, updatedAt: now,
    } as MemoryRecord;
}

let storage: SqliteStorage;

beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.init?.();
});

describe('createMemoryIfAbsent — the FIRST writer wins, the rest are told', () => {
    it('creates when the key is absent', async () => {
        const out = await storage.createMemoryIfAbsent!(rec('k', { a: 1 }, 1));
        expect(out).not.toBeNull();
        expect((await storage.getMemory(GAII, 'k'))!.value).toEqual({ a: 1 });
    });

    it('returns null instead of clobbering an existing record', async () => {
        await storage.createMemoryIfAbsent!(rec('k', { a: 1 }, 1));
        const second = await storage.createMemoryIfAbsent!(rec('k', { b: 2 }, 1));
        expect(second).toBeNull();
        // The loser must not have overwritten the winner: this is the whole difference from setMemory.
        expect((await storage.getMemory(GAII, 'k'))!.value).toEqual({ a: 1 });
    });

    it('is scoped per owner, so two principals may hold the same key name', async () => {
        await storage.createMemoryIfAbsent!(rec('k', { a: 1 }, 1));
        const other = { ...rec('k', { b: 2 }, 1), ownerGaii: 'other#bob@test-node' };
        expect(await storage.createMemoryIfAbsent!(other)).not.toBeNull();
    });
});

describe('setMemoryIfVersion — a stale writer is refused, not applied', () => {
    it('updates when the version still matches', async () => {
        await storage.createMemoryIfAbsent!(rec('k', { a: 1 }, 1));
        const out = await storage.setMemoryIfVersion!(rec('k', { a: 2 }, 2), 1);
        expect(out).not.toBeNull();
        expect((await storage.getMemory(GAII, 'k'))!.value).toEqual({ a: 2 });
    });

    it('refuses a writer whose read is stale — the interleave a race produces', async () => {
        await storage.createMemoryIfAbsent!(rec('k', { base: true }, 1));

        // Both writers read version 1 before either writes. This is the exact ordering that loses
        // data under a plain upsert.
        const readA = await storage.getMemory(GAII, 'k');
        const readB = await storage.getMemory(GAII, 'k');
        expect(readA!.version).toBe(readB!.version);

        const wroteA = await storage.setMemoryIfVersion!(
            rec('k', { ...(readA!.value as object), a: 'A' }, readA!.version + 1), readA!.version);
        expect(wroteA).not.toBeNull();

        const wroteB = await storage.setMemoryIfVersion!(
            rec('k', { ...(readB!.value as object), b: 'B' }, readB!.version + 1), readB!.version);
        expect(wroteB).toBeNull();

        // B's write did NOT land, so B must retry. Critically, A's did not vanish.
        const now = await storage.getMemory(GAII, 'k');
        expect(now!.value).toEqual({ base: true, a: 'A' });
    });

    it('lets the refused writer succeed after re-reading, which is what the route loop does', async () => {
        await storage.createMemoryIfAbsent!(rec('k', { base: true }, 1));
        const stale = await storage.getMemory(GAII, 'k');
        await storage.setMemoryIfVersion!(rec('k', { base: true, a: 'A' }, 2), 1);

        expect(await storage.setMemoryIfVersion!(rec('k', { z: 1 }, stale!.version + 1), stale!.version)).toBeNull();

        const fresh = await storage.getMemory(GAII, 'k');
        const merged = { ...(fresh!.value as object), b: 'B' };
        expect(await storage.setMemoryIfVersion!(rec('k', merged, fresh!.version + 1), fresh!.version)).not.toBeNull();

        // Both subtrees present: the outcome the whole route exists to guarantee.
        expect((await storage.getMemory(GAII, 'k'))!.value).toEqual({ base: true, a: 'A', b: 'B' });
    });

    it('refuses an update to a key that does not exist at all', async () => {
        expect(await storage.setMemoryIfVersion!(rec('missing', { a: 1 }, 2), 1)).toBeNull();
    });
});
