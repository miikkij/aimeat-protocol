/**
 * @file sdk-commerce-parse-amount.test.ts
 * @description AIMEAT.commerce.parseAmount reads a typed or exported amount the way its writer meant
 *   it, and refuses the one shape nobody can read. microsFromInput was
 *   `parseFloat(String(str).replace(',', '.'))`, a STRING replace of the first comma, so '1,500.00'
 *   became 1.5 and '12,000.00' became 12 with no warning (appdev pitfall
 *   amount-parser-reads-thousands-separator-as-decimal, 2026-08-19). The ruling for the fix: decide
 *   the decimal mark first; an input a thousand-fold apart under the two readings ('1,000',
 *   '1.000') is null, because on money a wrong guess costs a factor of a thousand.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';

let commerce: any;

beforeAll(async () => {
    const g = globalThis as any;
    g.document = g.document ?? { querySelector: () => null, getElementById: () => null, addEventListener() {} };
    g.location = g.location ?? { origin: 'https://app.test', href: 'https://app.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    g.window = g.window ?? { addEventListener() {}, dispatchEvent() {}, location: g.location };
    await import('../../src/static/sdk-libs/commerce/index.js');
    commerce = g.window.AIMEAT.commerce;
});

/** [input, expected]. Exported for the surface parity test by copy, not by import: see there. */
const READABLE: Array<[unknown, number]> = [
    // One mark, one or two digits after it: a decimal mark in every convention.
    ['1.50', 1.5], ['1,50', 1.5], ['1,5', 1.5], ['12.5', 12.5],
    // A leading zero cannot be a thousands group.
    ['0,002', 0.002], ['0.002', 0.002], ['0.500', 0.5],
    // Both marks: the last one is the decimal mark, the other groups.
    ['12,000.00', 12000], ['1,500.00', 1500], ['-1,500.00', -1500], ['1.234,56', 1234.56],
    ['1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89],
    // One mark repeated: it can only be grouping.
    ['1,000,000', 1000000], ['1.000.000', 1000000], ['12,34,56,789', 123456789],
    // Space and apostrophe grouping, with or without a decimal mark after.
    ['1 500 000', 1500000], ['1 234,56', 1234.56], ['1 234.5', 1234.5], ["1'234.50", 1234.5],
    // Four or more digits on either side of a single mark cannot be a thousands group.
    ['1234,567', 1234.567], ['1,2345', 1.2345],
    // No mark, currency around it, a sign.
    ['42', 42], ['€12', 12], ['12 €', 12], ['USD 1,234.56', 1234.56], ['1 234,56 EUR', 1234.56],
    ['−5', -5], ['-0,5', -0.5], ['(1,234.00)', -1234], ['.5', 0.5], ['5.', 5],
    // A number is already a number.
    [12.34, 12.34], [0, 0],
];

const REFUSED: unknown[] = [
    // The ambiguous shape: one mark, exactly three digits after, one to three non-zero-led before.
    '1,000', '1.000', '10,000', '100.000', '-1,000',
    // Not an amount at all.
    '', '   ', 'abc', null, undefined, NaN, Infinity, '12-15', '1.2.3', '1,234.5.6', '1,00,0', '1234 567',
    '1 5', '1,234,56.78', '1.234,567.8',
];

describe('AIMEAT.commerce.parseAmount', () => {
    it('is exported', () => {
        expect(typeof commerce.parseAmount).toBe('function');
    });

    for (const [input, expected] of READABLE) {
        it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
            expect(commerce.parseAmount(input)).toBeCloseTo(expected, 9);
        });
    }

    for (const input of REFUSED) {
        it(`refuses ${JSON.stringify(input) ?? String(input)}`, () => {
            expect(commerce.parseAmount(input)).toBeNull();
        });
    }
});

describe('AIMEAT.commerce.microsFromInput', () => {
    it('reads the thousands separator as a thousands separator', () => {
        expect(commerce.microsFromInput('1,500.00')).toBe(1_500_000_000);
        expect(commerce.microsFromInput('12,000.00')).toBe(12_000_000_000);
        expect(commerce.microsFromInput('1.234,56')).toBe(1_234_560_000);
    });

    it('keeps the inputs it always read', () => {
        expect(commerce.microsFromInput('1.50')).toBe(1_500_000);
        expect(commerce.microsFromInput('0,002')).toBe(2_000);
        expect(commerce.microsFromInput(3)).toBe(3_000_000);
    });

    it('returns null for an ambiguous amount so the app asks again', () => {
        expect(commerce.microsFromInput('1,000')).toBeNull();
        expect(commerce.microsFromInput('1.000')).toBeNull();
    });

    it('still returns null for zero, negative and unreadable input', () => {
        expect(commerce.microsFromInput('0')).toBeNull();
        expect(commerce.microsFromInput('-1.50')).toBeNull();
        expect(commerce.microsFromInput('abc')).toBeNull();
    });
});
