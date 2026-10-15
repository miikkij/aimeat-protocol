/**
 * @file test/unit/datapackage-odata-paging.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-driven paging of the OData feed (feature-list audit #151, #193).
 *
 *   The feed read a 5 000-row window and returned it as the whole table, so Excel or Power BI showed
 *   part of a larger table as if it were all of it. Every case here walks the pages the way a client
 *   follows @odata.nextLink, through parseQuery, and checks that every row arrives exactly once.
 *   The table is 12 345 rows, larger than two pages, at the real page size.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-odata-paging.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #151, #193).
 */
import { describe, it, expect } from 'vitest';
import {
    parseQuery, applyQueryPaged, nextLinkFor, ODATA_PAGE_SIZE, ROW_KEY,
} from '../../src/services/datapackage/odata.js';
import type { TableSchema } from '../../src/services/datapackage/contract.js';

const N = 12_345;
const SCHEMA: TableSchema = { fields: [{ name: 'n', type: 'integer' }, { name: 'even', type: 'boolean' }] };
const ROWS = Array.from({ length: N }, (_, i) => ({ n: i, even: i % 2 === 0 }));
const BASE = 'https://node.example/v1/odata/alice/big/rows';
const HASH = 'sha256:' + 'b'.repeat(64);

/** Follow nextLink until the answer ends, as a native connector does. */
function walk(query: string) {
    let params = new URLSearchParams(query);
    const pages: Array<{ rows: Array<Record<string, unknown>>; matched: number; link: string | null }> = [];
    for (let guard = 0; guard < 20; guard++) {
        const p = parseQuery(params, SCHEMA);
        if (!p.ok) throw new Error(p.message);
        const page = applyQueryPaged(ROWS, p.value, SCHEMA);
        const link = page.next ? nextLinkFor(BASE, params, page.next, HASH) : null;
        pages.push({ rows: page.rows, matched: page.matched, link });
        if (!link) return pages;
        expect(link.startsWith(`${BASE}?`)).toBe(true);
        params = new URLSearchParams(link.split('?')[1]);
        expect(params.get('version')).toBe(HASH);
    }
    throw new Error('nextLink never ended');
}

describe('OData server-driven paging', () => {
    it('a table larger than one page arrives whole, each row once, in pages of at most the page size', () => {
        const pages = walk('$count=true');
        expect(pages.length).toBe(Math.ceil(N / ODATA_PAGE_SIZE));
        expect(pages.every(p => p.rows.length <= ODATA_PAGE_SIZE)).toBe(true);
        const ids = pages.flatMap(p => p.rows.map(r => r[ROW_KEY] as number));
        expect(ids.length).toBe(N);
        expect(new Set(ids).size).toBe(N);
        // $count is the whole table on every page, never the size of one page.
        expect(pages.every(p => p.matched === N)).toBe(true);
    });

    it('the first page of a large table says more follows', () => {
        const p = parseQuery(new URLSearchParams(''), SCHEMA);
        if (!p.ok) throw new Error(p.message);
        const page = applyQueryPaged(ROWS, p.value, SCHEMA);
        expect(page.rows.length).toBe(ODATA_PAGE_SIZE);
        expect(page.next).toEqual({ skip: ODATA_PAGE_SIZE });
    });

    it('$top larger than a page is honoured across pages and not exceeded', () => {
        const pages = walk('$top=7000&$orderby=n desc');
        const ns = pages.flatMap(p => p.rows.map(r => r.n as number));
        expect(ns.length).toBe(7000);
        expect(ns[0]).toBe(N - 1);
        expect(ns[6999]).toBe(N - 7000);
        expect(pages[1]!.link).toBeNull();
    });

    it('$filter and $skip page over the filtered rows, and the count is what the filter matched', () => {
        const pages = walk('$filter=even eq true&$skip=10&$count=true');
        const evens = Math.ceil(N / 2);
        expect(pages.every(p => p.matched === evens)).toBe(true);
        const ns = pages.flatMap(p => p.rows.map(r => r.n as number));
        expect(ns.length).toBe(evens - 10);
        expect(ns.every(n => n % 2 === 0)).toBe(true);
        expect(ns[0]).toBe(20);
    });

    it('a small answer has no nextLink', () => {
        const pages = walk('$top=3');
        expect(pages.length).toBe(1);
        expect(pages[0]!.rows.length).toBe(3);
        expect(pages[0]!.link).toBeNull();
    });
});
