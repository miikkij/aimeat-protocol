/**
 * @file test/unit/override-ranges.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule `pnpm check:overrides` holds every dependency override to
 *   (scripts/lib/override-ranges.mjs): each alternative of a value stays inside one major and has an
 *   upper bound, because pnpm resolves an override to the highest version its value allows.
 * @usage pnpm exec vitest run test/unit/override-ranges.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial; replaces docs/pitfalls.md §59.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenOverrides, overrideRangeProblems } from '../../scripts/lib/override-ranges.mjs';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('overrideRangeProblems', () => {
    it('passes a caret, a tilde, an exact version, one alternative per major, and a removal', () => {
        expect(overrideRangeProblems({
            'brace-expansion@>=2.0.0 <2.1.7': '^2.1.7',
            'esbuild@>=0.17.0 <0.28.1': '^0.28.1',
            'minimatch@>=5.0.0 <5.1.8': '5.1.8',
            'a@1': '~1.2.3',
            'vite@>=7.0.0 <7.3.5': '^7.3.5 || ^8.0.0',
            'b@>=2 <3': '>=2.1.0 <3.0.0',
            'cbor-x>cbor-extract': '-',
        })).toEqual([]);
    });

    it('refuses an open >= value, the shape that handed brace-expansion 5.x to ^2.0.2 dependents', () => {
        const problems = overrideRangeProblems({ 'brace-expansion@>=2.0.0 <2.1.4': '>=2.1.4' });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ key: 'brace-expansion@>=2.0.0 <2.1.4', value: '>=2.1.4' });
        expect(problems[0]!.reason).toMatch(/no upper bound/);
    });

    it('refuses a bounded value whose one alternative spans majors, and a wildcard', () => {
        const problems = overrideRangeProblems({ 'qs@>=6 <6.15.2': '>=6.15.2 <8.0.0', x: '*', y: '>4.0.0' });
        expect(problems.map(p => p.key)).toEqual(['qs@>=6 <6.15.2', 'x', 'y']);
        expect(problems[0]!.reason).toMatch(/spans majors 6 to 7/);
    });

    it('reads the nested npm form and reports what it cannot read rather than passing it', () => {
        expect(flattenOverrides({ 'readdir-glob@3': { minimatch: '^11.0.1', '.': '3.0.1' } })).toEqual([
            { key: 'readdir-glob@3>minimatch', value: '^11.0.1' },
            { key: 'readdir-glob@3', value: '3.0.1' },
        ]);
        expect(overrideRangeProblems({ 'readdir-glob@3': { minimatch: '>=11.0.1' } })[0]).toMatchObject({ key: 'readdir-glob@3>minimatch' });
        expect(overrideRangeProblems({ z: 'latest', w: 'npm:other@1' }).map(p => p.key)).toEqual(['z', 'w']);
    });

    it('aimeat/package.json holds the rule in both override blocks', () => {
        const pkg = JSON.parse(readFileSync(join(AIMEAT, 'package.json'), 'utf8')) as { overrides: Record<string, unknown>; pnpm: { overrides: Record<string, unknown> } };
        expect(Object.keys(pkg.pnpm.overrides).length).toBeGreaterThan(10);
        expect(overrideRangeProblems(pkg.overrides)).toEqual([]);
        expect(overrideRangeProblems(pkg.pnpm.overrides)).toEqual([]);
    });
});
