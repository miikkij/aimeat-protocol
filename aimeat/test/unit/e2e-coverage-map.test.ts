/**
 * @file test/unit/e2e-coverage-map.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-suite coverage map the gate chooses E2E suites from (scripts/lib/
 *   e2e-coverage-map.ts): a source map decodes to the right TypeScript lines, a module's top level
 *   is not counted as a function, a changed line selects the suites of the innermost function that
 *   holds it, a line outside every function selects the file's suites, and a line edited since the
 *   map was built is translated into the map commit's numbering.
 * @usage pnpm exec vitest run test/unit/e2e-coverage-map.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 4.2.6).
 */
import { describe, expect, it } from 'vitest';
import { decodeMappings, functionsOf, mergeMaps, offsetToOriginalLine, selectSuites, translateLines, type CoverageMap } from '../../scripts/lib/e2e-coverage-map.js';

describe('source map decoding', () => {
    // "AAAA;AACA;AAEA" maps generated lines 0, 1, 2 to original lines 0, 1, 3.
    const decoded = decodeMappings('AAAA;AACA;AAEA');

    it('reads each segment as generated column and original line', () => {
        expect(decoded).toEqual([[[0, 0]], [[0, 1]], [[0, 3]]]);
    });

    it('turns a character offset into the original line, 1-based', () => {
        const lineLengths = [10, 10, 10];
        expect(offsetToOriginalLine(0, lineLengths, decoded)).toBe(1);
        expect(offsetToOriginalLine(15, lineLengths, decoded)).toBe(2);
        expect(offsetToOriginalLine(25, lineLengths, decoded)).toBe(4);
    });

    it('decodes negative and multi-digit values', () => {
        // "AAgBC" = [0, 0, 16, 1]; ";AAfA" moves the original line by -15.
        expect(decodeMappings('AAgBC;AAfA')).toEqual([[[0, 16]], [[0, 1]]]);
    });
});

describe('executed functions', () => {
    it('leaves out the top level and the functions that never ran', () => {
        const script = {
            url: 'file:///x/aimeat/src/a.ts',
            functions: [
                { functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 30, count: 1 }] },
                { functionName: 'ran', isBlockCoverage: true, ranges: [{ startOffset: 11, endOffset: 20, count: 2 }] },
                { functionName: 'idle', isBlockCoverage: true, ranges: [{ startOffset: 21, endOffset: 29, count: 0 }] },
            ],
        };
        const map = { lineLengths: [10, 10, 10], data: { mappings: 'AAAA;AACA;AAEA' } };
        expect(functionsOf(script, map)).toEqual([[2, 2]]);
    });
});

describe('suite selection', () => {
    const map: CoverageMap = {
        commit: 'abc', built: '2026-11-15', suites: ['e2e-a', 'e2e-b', 'e2e-c'],
        files: { 'aimeat/src/r.ts': [[10, 40, [0, 1]], [20, 25, [1]], [50, 60, [2]]] },
    };

    it('takes the innermost function that holds a changed line', () => {
        expect([...selectSuites(map, new Map([['aimeat/src/r.ts', [22]]])).suites]).toEqual(['e2e-b']);
        expect([...selectSuites(map, new Map([['aimeat/src/r.ts', [12]]])).suites].sort()).toEqual(['e2e-a', 'e2e-b']);
    });

    it('takes every suite of the file for a line outside every function', () => {
        expect([...selectSuites(map, new Map([['aimeat/src/r.ts', [3]]])).suites].sort()).toEqual(['e2e-a', 'e2e-b', 'e2e-c']);
    });

    it('names a file the map does not know', () => {
        expect(selectSuites(map, new Map([['aimeat/src/new.ts', [1]]])).unknown).toEqual(['aimeat/src/new.ts']);
    });

    it('merges parts with their own suite numbering', () => {
        const other: CoverageMap = { commit: 'abc', built: '', suites: ['e2e-d'], files: { 'aimeat/src/r.ts': [[50, 60, [0]]] } };
        const merged = mergeMaps([map, other]);
        expect([...selectSuites(merged, new Map([['aimeat/src/r.ts', [55]]])).suites].sort()).toEqual(['e2e-c', 'e2e-d']);
    });
});

describe('line translation into the map commit', () => {
    // Since the map commit: 3 lines inserted after old line 5, and old lines 20-21 replaced by one.
    const diff = '@@ -5,0 +6,3 @@\n+a\n+b\n+c\n@@ -20,2 +23 @@\n-x\n-y\n+z\n';

    it('shifts a line below an insertion back by its size', () => {
        expect(translateLines([12], diff)).toEqual([9]);
    });

    it('maps an inserted line to the line it follows', () => {
        expect(translateLines([7], diff)).toEqual([5]);
    });

    it('maps a replaced line to the whole old range', () => {
        expect(translateLines([23], diff)).toEqual([20, 21]);
    });

    it('leaves a line above every hunk alone', () => {
        expect(translateLines([2], diff)).toEqual([2]);
    });

    it('shifts a line below a shrinking hunk by the lines it lost', () => {
        expect(translateLines([30], diff)).toEqual([28]);
    });
});
