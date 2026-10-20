/**
 * @file test/unit/check-storage-conformance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proof that `pnpm check:storage-conformance` counts the storage methods a two-provider
 *   unit file calls and nothing else, calls a repository covered when one of its methods is called,
 *   and fails on a new uncovered repository, a listed one that is now covered, and a method count
 *   that falls below or rises above the floor (QA audit 2026-10-16, P4-09).
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-storage-conformance.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial, with the gate.
 */
import { describe, it, expect } from 'vitest';
import { calledMethods, coverage, compare, type Baseline } from '../../scripts/check-storage-conformance.js';

const repos = [
    { name: 'OwnerRepository', file: 'a.ts', methods: [{ name: 'getOwner', params: ['name'] }, { name: 'listOwners', params: [] }] },
    { name: 'DirectMessageRepository', file: 'b.ts', methods: [{ name: 'sendDm', params: ['dm'] }] },
];

describe('check:storage-conformance', () => {
    it('finds the storage methods a file calls on any receiver, and not those in strings or comments', () => {
        const source = [
            'await sqlite.getOwner("a");',
            'const rows = await pg.listOwners();',
            "const fixture = 'storage.sendDm(x)';",
            '// storage.sendDm(x)',
            'other.unrelated();',
        ].join('\n');
        expect([...calledMethods('t.ts', source, new Set(['getOwner', 'listOwners', 'sendDm']))].sort()).toEqual(['getOwner', 'listOwners']);
    });

    it('a repository is covered when one of its methods is called', () => {
        expect(coverage(repos, new Set(['getOwner']))).toEqual([
            { repository: 'OwnerRepository', methods: 2, called: 1 },
            { repository: 'DirectMessageRepository', methods: 1, called: 0 },
        ]);
    });

    it('passes when the code matches, and fails on each way it can drift', () => {
        const base: Baseline = { note: '', methodsCalledFloor: 1, uncovered: { DirectMessageRepository: 'DEBT' } };
        const cov = coverage(repos, new Set(['getOwner']));
        expect(compare(cov, 1, base)).toEqual({ newlyUncovered: [], nowCovered: [], gone: [], emptyReasons: [], belowFloor: false, aboveFloor: false });
        expect(compare(cov, 1, { ...base, uncovered: {} }).newlyUncovered).toEqual(['DirectMessageRepository']);
        expect(compare(coverage(repos, new Set(['getOwner', 'sendDm'])), 2, base)).toMatchObject({ nowCovered: ['DirectMessageRepository'], aboveFloor: true });
        expect(compare(coverage(repos, new Set()), 0, base)).toMatchObject({ newlyUncovered: ['OwnerRepository'], belowFloor: true });
        expect(compare(cov, 1, { ...base, uncovered: { ...base.uncovered, GoneRepository: 'DEBT' } }).gone).toEqual(['GoneRepository']);
    });
});
