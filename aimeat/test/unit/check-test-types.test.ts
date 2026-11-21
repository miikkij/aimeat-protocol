/**
 * @file test/unit/check-test-types.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The test tree's typecheck refuses a file that gained a type error over its baseline
 *   and reports one that fell (scripts/check-test-types.ts, docs/pitfalls.md §26 until 2026-11-21).
 *   The tsc run itself takes a minute and 12 GB, so this holds the parse and the comparison.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { compare, countErrors } from '../../scripts/check-test-types.js';

const OUTPUT = [
    "test/unit/a.test.ts(12,5): error TS2554: Expected 2 arguments, but got 1.",
    "test/unit/a.test.ts(30,9): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
    "test\\e2e-b.ts(4,1): error TS2304: Cannot find name 'x'.",
    '  Type \'string\' is not assignable to type \'number\'.',
    '',
].join('\n');

describe('check:test-types holds each file to its count', () => {
    it('counts errors per file, with Windows separators turned', () => {
        const { counts } = countErrors(OUTPUT);
        expect(Object.fromEntries(counts)).toEqual({ 'test/unit/a.test.ts': 2, 'test/e2e-b.ts': 1 });
    });
    it('refuses a file above its count, and a file the baseline does not name', () => {
        const { counts } = countErrors(OUTPUT);
        const { rose } = compare(counts, { 'test/unit/a.test.ts': 1 });
        expect(rose).toEqual([['test/e2e-b.ts', 0, 1], ['test/unit/a.test.ts', 1, 2]]);
    });
    it('passes a file at or below its count, and reports the fall', () => {
        const { counts } = countErrors(OUTPUT);
        const { rose, fell } = compare(counts, { 'test/unit/a.test.ts': 2, 'test/e2e-b.ts': 3, 'test/gone.ts': 1 });
        expect(rose).toEqual([]);
        expect(fell).toEqual([['test/e2e-b.ts', 3, 1], ['test/gone.ts', 1, 0]]);
    });
});
