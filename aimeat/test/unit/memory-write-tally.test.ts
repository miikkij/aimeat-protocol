/**
 * @file test/unit/memory-write-tally.test.ts
 * @description The memory write tally: does it actually count hands, and does the count survive?
 *
 *   THE PROPERTY THIS EXISTS FOR, in the developer's words on 2026-08-24: "jos jälkeenpäin joku
 *   kirjoittaa uudestaan avaimeen niin se arvo voi muuttua, on hyvä nähdä kuinka monta ja erilaisella
 *   on sitä avainta käpälöinyt". A column on the memory row could not hold that — the next write
 *   overwrites it, so it would only ever name the last writer. So the two things asserted hardest
 *   here are that repeated writes by the same hand stay ONE row with a rising count, and that the row
 *   outlives both the value and the key.
 *
 *   The row count is the affordability argument, and it is measured rather than asserted in prose:
 *   the production owner's 18,446 keys carry 990,452 lifetime writes, so an append log would have
 *   been 54x this. `oneHandWritingAllDay` reproduces that shape in miniature.
 * @usage pnpm test -- memory-write-tally
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 8.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';

const OWNER = 'alice@aimeat-local-001-dev';
const AGENT = 'claude#alice@aimeat-local-001-dev';
const OTHER = 'joker#alice@aimeat-local-001-dev';
const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-02T10:00:00.000Z';
const T0 = '2026-07-01T10:00:00.000Z';

let s: Storage;
beforeAll(async () => { s = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }); });

const touch = (key: string, writer: string, at: string, writeCount = 1, deleteCount = 0) =>
    s.upsertMemoryWriteTally([{ ownerGaii: OWNER, key, writerPrincipal: writer, writeCount, deleteCount, at }]);

describe('it counts hands, not events', () => {
    it('one hand writing the same key all day is ONE row with a rising count', async () => {
        for (let i = 0; i < 100; i++) await touch('news.today.raw', AGENT, T1);
        const rows = await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'news.today.raw' });
        expect(rows).toHaveLength(1);
        expect(rows[0].writeCount).toBe(100);
    });

    it('a second hand on the same key is a second row, so the key shows TWO', async () => {
        await touch('news.today.raw', OTHER, T2);
        const rows = await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'news.today.raw' });
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map(r => r.writerPrincipal))).toEqual(new Set([AGENT, OTHER]));
    });

    it('keeps the EARLIEST first sighting even when touches arrive out of order', async () => {
        // The buffer flushes on a timer, so a late flush can carry an older timestamp than one
        // already stored. Taking the newer would quietly move the date somebody's history starts.
        await touch('news.today.raw', AGENT, T0);
        const mine = (await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'news.today.raw' }))
            .find(r => r.writerPrincipal === AGENT)!;
        expect(mine.firstAt).toBe(T0);
        expect(mine.lastAt).toBe(T1);
    });
});

describe('the row outlives what it is about', () => {
    it('a delete is a hand on the key too, and it does not remove the row', async () => {
        await touch('gone.for.good', AGENT, T1);
        await touch('gone.for.good', AGENT, T2, 0, 1);
        const rows = await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'gone.for.good' });
        expect(rows).toHaveLength(1);
        expect(rows[0].writeCount).toBe(1);
        expect(rows[0].deleteCount).toBe(1);
    });

    it('deleting the memory record leaves the tally standing', async () => {
        await s.setMemory({
            key: 'gone.for.good', ownerGaii: OWNER, value: { a: 1 }, visibility: 'private',
            tags: [], ttlHours: null, version: 1, createdAt: T1, updatedAt: T1,
        });
        await s.deleteMemory(OWNER, 'gone.for.good');
        expect(await s.getMemory(OWNER, 'gone.for.good')).toBeNull();
        // The point of the whole table: the record is gone and who touched it is not.
        const rows = await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'gone.for.good' });
        expect(rows).toHaveLength(1);
        expect(rows[0].writerPrincipal).toBe(AGENT);
    });
});

describe('the family grain', () => {
    it('folds many keys into one row per hand, and keeps the basis it was identified on', async () => {
        for (const day of ['01', '02', '03']) {
            await s.upsertMemoryFamilyTally([{
                ownerGaii: OWNER, keyFamily: 'news.<date>.*', writerPrincipal: AGENT,
                tier: 'owner-named', writeCount: 1, deleteCount: 0, at: `2026-08-${day}T10:00:00.000Z`,
            }]);
        }
        const rows = await s.listMemoryFamilyTally({ ownerGaii: OWNER, family: 'news.<date>.*' });
        expect(rows).toHaveLength(1);
        expect(rows[0].writeCount).toBe(3);
        expect(rows[0].tier).toBe('owner-named');
    });

    it('counts DISTINCT keys, which an upsert cannot hold as a column', async () => {
        for (const k of ['fam.a', 'fam.b', 'fam.b', 'fam.c']) await touch(k, AGENT, T1);
        expect(await s.countTalliedKeys(OWNER, 'fam.')).toBe(3);
    });

    it('a prefix count does not spill into a neighbouring family', async () => {
        await touch('famous.thing', AGENT, T1);
        expect(await s.countTalliedKeys(OWNER, 'fam.')).toBe(3);
    });
});

describe('erasure', () => {
    it('pseudonymises this owner\'s writes into SOMEBODY ELSE\'S namespace instead of deleting them', async () => {
        const bob = 'bob@aimeat-local-001-dev';
        await s.upsertMemoryWriteTally([{
            ownerGaii: bob, key: 'bobs.thing', writerPrincipal: AGENT,
            writeCount: 5, deleteCount: 0, at: T1,
        }]);
        const changed = await s.pseudonymiseTallyWriter('alice', 'aimeat-local-001-dev');
        expect(changed).toBeGreaterThan(0);

        const bobs = await s.listMemoryWriteTally({ ownerGaii: bob, key: 'bobs.thing' });
        // Bob's record of who touched his data survives, with the count intact — deleting it would
        // have turned his "one hand" into none.
        expect(bobs).toHaveLength(1);
        expect(bobs[0].writeCount).toBe(5);
        expect(bobs[0].writerPrincipal).toMatch(/^erased:[0-9a-f]{12}$/);
    });

    it('does not touch rows in the erased owner\'s OWN namespace — the cascade removes those', async () => {
        const mine = await s.listMemoryWriteTally({ ownerGaii: OWNER, key: 'news.today.raw' });
        expect(mine.some(r => r.writerPrincipal === AGENT)).toBe(true);
    });
});
