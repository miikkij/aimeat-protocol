/**
 * @file cortex-surface-parse-amount.test.ts
 * @description aimeat-surface sums and charts a '12,000.00' cell as twelve thousand. Its num() stripped
 *   everything but digits and marks and then replaced the FIRST comma, so '12,000.00' summed as 12 and
 *   '1,000,000' as 1 (appdev pitfall amount-parser-reads-thousands-separator-as-decimal). It now reads
 *   through parseAmount, the same parser AIMEAT.commerce exposes.
 *
 *   WHY THIS FILE ALSO COMPARES TWO COPIES. A cortex pack is a hand-written browser IIFE and a served
 *   SDK lib is an esbuild bundle; neither can import the other, so the surface pack carries a copy of
 *   src/static/sdk-libs/commerce/amount.js. The fix keeps ONE parser, so the copy is held to the
 *   original here: every input in the table below and every short string over the characters that
 *   matter must get the same answer from both, or this fails and says which input drifted.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 *   v1.1.0 — 2026-09-13 — The portal's copy (public/js/amount.js, behind the offer price form) joins
 *     the comparison: a third door had the same first-comma one-liner.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

let surface: any;
let commerce: any;
let portal: (input: unknown) => number | null;

beforeAll(async () => {
    const g = globalThis as any;
    g.window = g;   // one global, so the SDK lib's window.AIMEAT and the pack's global.AIMEAT are the same object
    g.document = g.document ?? { querySelector: () => null, getElementById: () => null, addEventListener() {} };
    g.location = g.location ?? { origin: 'https://app.test', href: 'https://app.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    const file = fileURLToPath(new URL('../../public/cortex-bundled/aimeat-surface.js', import.meta.url));
    runInThisContext(readFileSync(file, 'utf8'), { filename: file });
    await import('../../src/static/sdk-libs/commerce/index.js');
    surface = g.AIMEAT.surface;
    commerce = g.AIMEAT.commerce;
    portal = (await import('../../public/js/amount.js')).parseAmount;
});

describe('AIMEAT.surface.num reads grouped amounts', () => {
    it('reads the English thousands separator as a separator', () => {
        expect(surface.num('12,000.00')).toBe(12000);
        expect(surface.num('1,000,000')).toBe(1000000);
        expect(surface.num('-1,500.00')).toBe(-1500);
    });

    it('reads the Finnish and German notations', () => {
        expect(surface.num('1.234,56')).toBeCloseTo(1234.56, 9);
        expect(surface.num('1 234,56 €')).toBeCloseTo(1234.56, 9);
    });

    it('keeps what it always read', () => {
        expect(surface.num(42)).toBe(42);
        expect(surface.num('3,5')).toBe(3.5);
        expect(surface.num('$12')).toBe(12);
        expect(surface.num('')).toBe(0);
        expect(surface.num(null)).toBe(0);
        expect(surface.num('n/a')).toBe(0);
    });

    it('counts an ambiguous cell as nothing rather than as a guess', () => {
        expect(surface.num('1,000')).toBe(0);
    });

    it('sums a column written with thousands separators', () => {
        const rows = [{ amount: '12,000.00' }, { amount: '500' }, { amount: 250.5 }];
        expect(surface.agg(rows, 'amount', 'sum')).toBe(12750.5);
    });
});

describe('the surface and portal copies of parseAmount match aimeat-commerce', () => {
    const same = (c: unknown) => {
        const want = commerce.parseAmount(c);
        return Object.is(surface.parseAmount(c), want) && Object.is(portal(c), want);
    };

    it('all three expose it', () => {
        expect(typeof surface.parseAmount).toBe('function');
        expect(typeof commerce.parseAmount).toBe('function');
        expect(typeof portal).toBe('function');
    });

    it('gives the same answer on the named cases', () => {
        const cases: unknown[] = [
            '1.50', '1,50', '0,002', '12,000.00', '1.234,56', '1,000,000', '12,34,56,789', '1 500 000',
            "1'234.50", '1234,567', '€12', 'USD 1,234.56', '−5', '(1,234.00)', '.5', '5.', 'Rs.1,00,000',
            '1,000', '1.000', '', 'abc', '12-15', '1.2.3', '1,00,0', null, undefined, 12.5, NaN,
        ];
        const drift = cases.filter(c => !same(c));
        expect(drift, `the copies disagree on: ${drift.map(d => JSON.stringify(d)).join(', ')}`).toEqual([]);
    });

    it('gives the same answer on every short string over digits, marks, space and sign', () => {
        const alphabet = ['0', '1', '5', ',', '.', ' ', '-', "'"];
        const drift: string[] = [];
        const walk = (prefix: string, depth: number) => {
            if (prefix && !same(prefix)) drift.push(prefix);
            if (depth === 0 || drift.length > 20) return;
            for (const ch of alphabet) walk(prefix + ch, depth - 1);
        };
        walk('', 6);
        expect(drift, `the copies disagree on: ${drift.map(d => JSON.stringify(d)).join(', ')}`).toEqual([]);
    });

    // utils.js imports its neighbours by importmap path ('/js/format.js'), which nothing outside a
    // browser resolves, so its use of the copy is pinned by reading it rather than by calling it.
    it('the portal microsFromInput reads through the copy', () => {
        const src = readFileSync(fileURLToPath(new URL('../../public/js/utils.js', import.meta.url)), 'utf8');
        expect(src).toMatch(/import \{ parseAmount \} from '\/js\/amount\.js';/);
        expect(src).toMatch(/const n = parseAmount\(str\);/);
    });
});
