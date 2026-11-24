/**
 * @file workspace-read-page.test.ts
 * @description One page of a workspace index (src/services/workspace/read-page.ts): the two limits
 *   a page has, the cursor that continues it, and the filter that replaces paging when a reader
 *   looks for one record. The E2E suite e2e-workspace-read-bounded.ts reads the same code through
 *   the MCP tool at production size; this file holds the rules one at a time.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-read-page.test.ts
 * @version-history
 *   2026-11-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { pageIndex, pageLimitOf, encodeCursor, decodeCursor, type PageEntry } from '../../src/services/workspace/read-page.js';
import { ANSWER_PAGE_DEFAULT, ANSWER_PAGE_MAX } from '../../src/models/answer-budget.js';

/** `count` entries in index order: newest change first. */
function entries(prefix: string, count: number): PageEntry[] {
    const base = Date.parse('2026-11-24T12:00:00.000Z');
    return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${String(i).padStart(3, '0')}`, title: `${prefix} title ${i}`, updated: new Date(base - i * 1000).toISOString(),
    }));
}

const BIG = 1_000_000;

describe('the limit a caller names', () => {
    it('is the default when it is not a number, and stays inside 1 and the maximum', () => {
        expect(pageLimitOf(undefined)).toBe(ANSWER_PAGE_DEFAULT);
        expect(pageLimitOf('20')).toBe(ANSWER_PAGE_DEFAULT);
        expect(pageLimitOf(Number.NaN)).toBe(ANSWER_PAGE_DEFAULT);
        expect(pageLimitOf(0)).toBe(1);
        expect(pageLimitOf(-5)).toBe(1);
        expect(pageLimitOf(12.9)).toBe(12);
        expect(pageLimitOf(100_000)).toBe(ANSWER_PAGE_MAX);
    });
});

describe('a cursor', () => {
    it('names the entry it was made from, and nothing else decodes as one', () => {
        const at = { updated: '2026-11-24T12:00:00.000Z', id: 'wish-with.dots and spaces' };
        expect(decodeCursor(encodeCursor(at))).toEqual(at);
        expect(decodeCursor('not-a-cursor')).toBeNull();
        expect(decodeCursor('')).toBeNull();
        // Valid base64url whose text is not a change time and an id.
        expect(decodeCursor(Buffer.from('{"updated":"x"}').toString('base64url'))).toBeNull();
        expect(decodeCursor(Buffer.from('\u0000wish-1').toString('base64url'))).toBeNull();
        expect(decodeCursor(Buffer.from('2026-11-24T12:00:00.000Z\u0000').toString('base64url'))).toBeNull();
    });
});

describe('one page per space', () => {
    it('shows `limit` entries of each space and says what each has left', () => {
        const { index, page } = pageIndex(
            [{ name: 'wish', entries: entries('wish', 12) }, { name: 'brief', entries: entries('brief', 3) }],
            { limit: 5, budgetChars: BIG },
        );
        expect(index.wish.map(e => e.id)).toEqual(['wish-000', 'wish-001', 'wish-002', 'wish-003', 'wish-004']);
        expect(index.brief).toHaveLength(3);
        expect(page.shown).toEqual({ wish: 5, brief: 3 });
        expect(page.more.wish.remaining).toBe(7);
        // A space that fits its page has nothing left to name.
        expect(page.more.brief).toBeUndefined();
    });

    it('continues one space after its cursor, to the last entry, with every entry once', () => {
        const all = entries('wish', 23);
        const seen: string[] = [];
        let cursor = undefined as ReturnType<typeof decodeCursor> | undefined;
        for (let guard = 0; guard < 20; guard++) {
            const { index, page } = pageIndex([{ name: 'wish', entries: all }, { name: 'brief', entries: entries('brief', 4) }],
                { limit: 5, only: 'wish', budgetChars: BIG, ...(cursor ? { cursor } : {}) });
            expect(index.brief).toBeUndefined();
            seen.push(...index.wish.map(e => e.id));
            const next = page.more.wish?.next_cursor;
            if (!next) break;
            cursor = decodeCursor(next);
        }
        expect(seen).toEqual(all.map(e => e.id));
    });

    it('orders two entries changed in the same instant by id, so a cursor between them loses neither', () => {
        const same = '2026-11-24T12:00:00.000Z';
        const tied: PageEntry[] = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, updated: same }));
        const first = pageIndex([{ name: 's', entries: tied }], { limit: 2, only: 's', budgetChars: BIG });
        expect(first.index.s.map(e => e.id)).toEqual(['a', 'b']);
        const second = pageIndex([{ name: 's', entries: tied }],
            { limit: 2, only: 's', budgetChars: BIG, cursor: decodeCursor(first.page.more.s.next_cursor!)! });
        expect(second.index.s.map(e => e.id)).toEqual(['c', 'd']);
        expect(second.page.more.s).toBeUndefined();
    });
});

describe('the character budget of the whole answer', () => {
    it('stops adding entries when it is reached, and names the spaces it did not get to', () => {
        const one = JSON.stringify(entries('wish', 1)[0]).length + 1;
        const { index, page } = pageIndex(
            [{ name: 'wish', entries: entries('wish', 40) }, { name: 'brief', entries: entries('brief', 6) }],
            { limit: 50, budgetChars: one * 10 },
        );
        expect(index.wish).toHaveLength(10);
        expect(page.more.wish.remaining).toBe(30);
        expect(page.more.wish.next_cursor).toBeTypeOf('string');
        // The budget was spent on the first space: the second shows none, and is read from its top.
        expect(index.brief).toEqual([]);
        expect(page.more.brief).toEqual({ remaining: 6 });
    });

    it('always shows the first entry, so a page is never empty while something is left', () => {
        const { index, page } = pageIndex([{ name: 'wish', entries: entries('wish', 3) }], { limit: 50, budgetChars: 1 });
        expect(index.wish).toHaveLength(1);
        expect(page.more.wish.remaining).toBe(2);
    });
});

describe('`q`', () => {
    it('keeps the entries whose title or id holds the text, whatever the case, before the page is cut', () => {
        const list = entries('wish', 200);
        list[150] = { ...list[150], title: 'Heliotrope: the one a reader looks for' };
        const { index, page } = pageIndex([{ name: 'wish', entries: list }, { name: 'brief', entries: entries('brief', 5) }],
            { limit: 5, q: '  heLIOtrope ', budgetChars: BIG });
        expect(index.wish.map(e => e.id)).toEqual(['wish-150']);
        expect(page.matched).toEqual({ wish: 1, brief: 0 });
        expect(page.q).toBe('heLIOtrope');
        expect(page.more).toEqual({});
        // By id as well.
        const byId = pageIndex([{ name: 'wish', entries: list }], { limit: 5, q: 'WISH-199', budgetChars: BIG });
        expect(byId.index.wish.map(e => e.id)).toEqual(['wish-199']);
    });

    it('pages what it matched when that is more than one page', () => {
        const { index, page } = pageIndex([{ name: 'wish', entries: entries('wish', 30) }], { limit: 4, q: 'title 1', budgetChars: BIG });
        // "title 1" matches 1 and 10 to 19: eleven entries.
        expect(page.matched).toEqual({ wish: 11 });
        expect(index.wish).toHaveLength(4);
        expect(page.more.wish.remaining).toBe(7);
    });
});
