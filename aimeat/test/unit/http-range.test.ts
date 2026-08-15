/**
 * @file test/unit/http-range.test.ts
 * @description The byte-range parser, pinned to the cases that made it necessary.
 *
 *   The one that matters most is `bytes=-8`. The regex this replaces was `/bytes=(\d+)-(\d*)/`,
 *   which requires a digit before the dash, so a SUFFIX range never matched and fell through to a
 *   200 carrying the whole representation. A Parquet reader opens every file with a suffix range
 *   (the footer is at the end), so the node answered the single most common streaming request by
 *   sending everything and reporting success. Every assertion below that starts with `bytes=-`
 *   fails against the old implementation.
 *
 *   The second class is the 416. An unsatisfiable byte range MUST NOT be answered with the full
 *   representation and a 200: that is a lie about what happened, and it is indistinguishable from
 *   a server that simply does not do ranges.
 * @usage cd aimeat && pnpm exec vitest run test/unit/http-range.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 A1).
 */
import { describe, it, expect } from 'vitest';
import { parseRangeHeader } from '../../src/utils/http-range.js';

const SIZE = 100;

describe('parseRangeHeader — no range', () => {
    it('sends the whole thing when the header is absent', () => {
        expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: 'full' });
        expect(parseRangeHeader('', SIZE)).toEqual({ kind: 'full' });
        expect(parseRangeHeader('   ', SIZE)).toEqual({ kind: 'full' });
    });

    it('IGNORES a unit it does not speak (RFC 9110 §14.2 says MUST)', () => {
        // Not a covering fallback: `Accept-Ranges: bytes` rides on the same response, so the client
        // has been told which unit works. The pre-existing e2e assertion for `characters=0-5` is
        // this rule, and it stays green.
        expect(parseRangeHeader('characters=0-5', SIZE)).toEqual({ kind: 'full' });
        expect(parseRangeHeader('items=0-5', SIZE)).toEqual({ kind: 'full' });
    });
});

describe('parseRangeHeader — suffix ranges (the case the old regex dropped)', () => {
    it('bytes=-8 asks for the LAST eight bytes', () => {
        expect(parseRangeHeader('bytes=-8', SIZE)).toEqual({ kind: 'partial', start: 92, end: 99 });
    });

    it('bytes=-1 asks for the final byte', () => {
        expect(parseRangeHeader('bytes=-1', SIZE)).toEqual({ kind: 'partial', start: 99, end: 99 });
    });

    it('a suffix longer than the file means the whole file, not an error (RFC 9110 §14.1.2)', () => {
        expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 });
    });

    it('bytes=-0 is unsatisfiable — a zero-length suffix names no bytes', () => {
        expect(parseRangeHeader('bytes=-0', SIZE).kind).toBe('unsatisfiable');
    });
});

describe('parseRangeHeader — explicit ranges', () => {
    it('bytes=0-9 is the first ten bytes', () => {
        expect(parseRangeHeader('bytes=0-9', SIZE)).toEqual({ kind: 'partial', start: 0, end: 9 });
    });

    it('bytes=5- runs to the end', () => {
        expect(parseRangeHeader('bytes=5-', SIZE)).toEqual({ kind: 'partial', start: 5, end: 99 });
    });

    it('an end past the last byte clamps instead of failing', () => {
        expect(parseRangeHeader('bytes=90-9999', SIZE)).toEqual({ kind: 'partial', start: 90, end: 99 });
    });

    it('tolerates the whitespace a real client sends', () => {
        expect(parseRangeHeader('bytes = 0-9', SIZE)).toEqual({ kind: 'partial', start: 0, end: 9 });
        expect(parseRangeHeader('BYTES=0-9', SIZE)).toEqual({ kind: 'partial', start: 0, end: 9 });
    });
});

describe('parseRangeHeader — 416, never a quiet 200', () => {
    it('a start past the end is unsatisfiable', () => {
        expect(parseRangeHeader('bytes=100-200', SIZE).kind).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=100-', SIZE).kind).toBe('unsatisfiable');
    });

    it('a reversed range is unsatisfiable', () => {
        expect(parseRangeHeader('bytes=50-10', SIZE).kind).toBe('unsatisfiable');
    });

    it('garbage inside a bytes= header is unsatisfiable, not ignored', () => {
        // The difference from an unknown UNIT: the client said `bytes`, so it is speaking the unit
        // this server serves and got the syntax wrong. Answering 200 would hide that.
        expect(parseRangeHeader('bytes=abc', SIZE).kind).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=', SIZE).kind).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=1.5-2', SIZE).kind).toBe('unsatisfiable');
    });

    it('every byte range against a zero-length representation is unsatisfiable', () => {
        expect(parseRangeHeader('bytes=0-0', 0).kind).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=-1', 0).kind).toBe('unsatisfiable');
    });

    it('a multi-range request is REFUSED rather than partly served', () => {
        // Serving only the first range under a 206 would claim the request was honoured when half
        // of it was dropped — the same shape of defect this parser exists to remove.
        const v = parseRangeHeader('bytes=0-9, 20-29', SIZE);
        expect(v.kind).toBe('unsatisfiable');
        expect(v.kind === 'unsatisfiable' && v.reason).toMatch(/one byte range/i);
    });
});
