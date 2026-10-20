/**
 * @file test/unit/check-unbounded-lists.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proof that `pnpm check:unbounded-lists` tells a bounded list method from an unbounded
 *   one, counts whole-table calls and nothing else, and fails on a new unbounded method, a risen
 *   count, a fallen count that was not lowered and a stale entry. The audit's own two examples are
 *   the fixtures: `listOwners()` read on every registration, and `listAgents()` read whole to pick one
 *   owner's agents (QA audit 2026-10-16, P7-10).
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-unbounded-lists.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial, with the gate.
 */
import { describe, it, expect } from 'vitest';
import { unboundedMethods, wholeTableCalls, compare, type Baseline } from '../../scripts/check-unbounded-lists.js';
import { storageRepositories } from '../../scripts/inventory/storage-methods.js';

const repos = [{
    name: 'OwnerRepository', file: 'x.ts', methods: [
        { name: 'getOwner', params: ['name'] },
        { name: 'listOwners', params: [] },
        { name: 'listOwnersPage', params: ['opts'] },
        { name: 'listPats', params: ['owner'] },
        { name: 'listUsageCalls', params: ['query'] },
        { name: 'listRecent', params: ['owner', 'limit'] },
    ],
}];

describe('check:unbounded-lists', () => {
    it('a list with no bound is unbounded; an owner scopes it and does not bound it; a limit, an options object or a query does', () => {
        expect(unboundedMethods(repos).map(m => [m.name, m.wholeTable])).toEqual([['listOwners', true], ['listPats', false]]);
    });

    it('counts the calls with no arguments that read a whole table, the audit\'s two included', () => {
        const source = [
            'const allOwners = await storage.listOwners();',
            'const mine = (await storage.listAgents()).filter(a => a.owner === ownerName);',
            'const one = await storage.listAgentsByOwner(ownerName);',
            "const fixture = 'storage.listOwners()';",
            '// storage.listAgents() in a comment',
            'await storage.listAgents(filter);',
        ].join('\n');
        expect(wholeTableCalls('src/routes/x.ts', source, new Set(['listOwners', 'listAgents']))).toEqual({ listOwners: 1, listAgents: 1 });
    });

    it('fails on a new method, a risen count, a fallen count and a stale entry; passes when the code matches', () => {
        const methods = unboundedMethods(repos);
        const base: Baseline = { note: '', methods: { listOwners: 'DEBT', listPats: 'DEBT' }, wholeTableCalls: { 'src/a.ts': { listOwners: 2 } } };
        expect(compare(methods, { 'src/a.ts': { listOwners: 2 } }, base)).toMatchObject({ newMethods: [], staleMethods: [], risen: [], fallen: [] });

        const risen = compare(methods, { 'src/a.ts': { listOwners: 2 }, 'src/b.ts': { listOwners: 1 } }, base);
        expect(risen.risen).toEqual([{ file: 'src/b.ts', method: 'listOwners', was: 0, now: 1 }]);
        expect(compare(methods, { 'src/a.ts': { listOwners: 1 } }, base).fallen).toEqual([{ file: 'src/a.ts', method: 'listOwners', was: 2, now: 1 }]);
        expect(compare(methods, {}, { ...base, methods: { listOwners: 'DEBT' } }).newMethods.map(m => m.name)).toEqual(['listPats']);
        expect(compare(methods.filter(m => m.name !== 'listPats'), { 'src/a.ts': { listOwners: 2 } }, base).staleMethods).toEqual(['listPats']);
    });

    it('reads the real Storage composite: every repository, and the two lists the audit named among the whole-table ones', () => {
        const real = storageRepositories(process.cwd());
        expect(real.length).toBeGreaterThan(70);
        const whole = unboundedMethods(real).filter(m => m.wholeTable).map(m => m.name);
        expect(whole).toEqual(expect.arrayContaining(['listOwners', 'listAgents']));
    });
});
