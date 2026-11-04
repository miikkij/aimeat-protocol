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
 *   v1.1.0 — 2026-10-23 — takeFirstWithoutLimit, with the getApp read that stalled aimeat.io as a fixture.
 *   v1.2.0 — 2026-11-04 — contentListReads and compareContentLists, with listAppVersions as a fixture
 *     (codebase analysis 2026-11-03, item A1).
 *   v1.3.0 — 2026-11-04 — typedStorageRepositories: the parameter's type decides the bound (codebase
 *     analysis 2026-11-03, item C1).
 */
import { describe, it, expect } from 'vitest';
import { unboundedMethods, wholeTableCalls, takeFirstWithoutLimit, contentListReads, compare, compareContentLists, typedStorageRepositories, type Baseline } from '../../scripts/check-unbounded-lists.js';
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

    it('finds an ordered take-first read with no limit, the outage\'s own getApp shape included, and passes one with a limit', () => {
        const source = [
            "let q = db.selectFrom('App').selectAll().where('filename', '=', f);",
            "const a = await q.orderBy('versionNumber', 'desc').executeTakeFirst();",
            "const b = await q.orderBy('versionNumber', 'desc').limit(1).executeTakeFirst();",
            "const c = await db.selectFrom('X').selectAll()",
            "  .orderBy('createdAt', 'desc')",
            '  .executeTakeFirstOrThrow();',
            "const d = await db.selectFrom('X').selectAll().where('id', '=', id).executeTakeFirst();",
            "const e = await db.deleteFrom('X').where('id', '=', id).executeTakeFirst();",
            "// q.orderBy('v').executeTakeFirst() in a comment",
        ].join('\n');
        expect(takeFirstWithoutLimit('x.ts', source)).toEqual([2, 4]);
    });

    it('finds an app list that reads the content in both providers, the version list\'s own shape included, and passes named columns and by-key reads', () => {
        const pg = [
            'export const m = {',
            '  async listAppVersions(this: S, o: string, f: string) {',
            "    const rows = await this.db.selectFrom('App').selectAll().where('ownerGaii', '=', o).orderBy('versionNumber', 'desc').execute();",
            '  },',
            '  async listAppsWithContent(this: S) {',
            "    let q = this.db.selectFrom('App').selectAll().distinctOn(['ownerGaii', 'filename']);",
            "    q = q.where('ownerGaii', '=', 'x');",
            "    const rows = await q.orderBy('ownerGaii').execute();",
            '  },',
            '  async listAppVersionSummaries(this: S, o: string) {',
            "    const rows = await this.db.selectFrom('App').select(['versionNumber', 'size']).where('ownerGaii', '=', o).execute();",
            '  },',
            '  async getApp(this: S, o: string) {',
            "    return this.db.selectFrom('App').selectAll().where('ownerGaii', '=', o).limit(1).executeTakeFirst();",
            '  },',
            '  async listOther(this: S) {',
            "    return this.db.selectFrom('Memory').selectAll().execute();",
            '  },',
            '};',
        ].join('\n');
        expect(contentListReads('pg.ts', pg)).toEqual([
            { method: 'listAppVersions', line: 3 },
            { method: 'listAppsWithContent', line: 8 },
        ]);
        const sqlite = [
            'export const m = {',
            '  async listAppVersions(this: S, o: string, f: string) {',
            "    return this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? ORDER BY versionNumber DESC').all(o);",
            '  },',
            '  async getApp(this: S, o: string) {',
            "    return this.db.prepare('SELECT * FROM apps WHERE ownerGaii = ? LIMIT 1').get(o);",
            '  },',
            '  async listAppVersionSizes(this: S, o: string) {',
            "    return this.db.prepare('SELECT versionNumber, size FROM apps WHERE ownerGaii = ?').all(o);",
            '  },',
            '};',
        ].join('\n');
        expect(contentListReads('sqlite.ts', sqlite)).toEqual([{ method: 'listAppVersions', line: 3 }]);
        const reads = [{ at: 'pg.ts:3', method: 'listAppVersions' }, { at: 'pg.ts:8', method: 'listAppsWithContent' }];
        expect(compareContentLists(reads, { listAppsWithContent: 'the copy scan' }).refused).toEqual([reads[0]]);
        expect(compareContentLists(reads, { listAppsWithContent: 'x', listAppVersions: 'y', listGone: 'z' }).stale).toEqual(['listGone']);
        expect(compareContentLists(reads, { listAppsWithContent: ' ', listAppVersions: 'y' }).emptyReasons).toEqual(['listAppsWithContent']);
    });

    it('decides a bound from the parameter type: an options type with a limit bounds, an inline one without it does not, and a scalar named limit does', () => {
        const typed = typedStorageRepositories(process.cwd());
        const unbounded = new Set(unboundedMethods(typed).map(m => m.name));
        // MemoryListOpts carries limit and after (codebase analysis 2026-11-03, item C1).
        for (const name of ['listMemory', 'listMemoryMeta', 'listMemoryForOwners', 'listMemoryMetaForOwners']) expect(unbounded.has(name)).toBe(false);
        // listKeyActivity(prefix, sinceIso, limit): a scalar named limit.
        expect(unbounded.has('listKeyActivity')).toBe(false);
        // listConsents(ownerGaii, opts?: { ...no limit }): the name `opts` no longer passes for a bound.
        expect(unbounded.has('listConsents')).toBe(true);
        // The name-only reading is still what a repository without types gets.
        expect(unboundedMethods(repos).map(m => m.name)).toEqual(['listOwners', 'listPats']);
    });

    it('reads the real Storage composite: every repository, and the two lists the audit named among the whole-table ones', () => {
        const real = storageRepositories(process.cwd());
        expect(real.length).toBeGreaterThan(70);
        const whole = unboundedMethods(real).filter(m => m.wholeTable).map(m => m.name);
        expect(whole).toEqual(expect.arrayContaining(['listOwners', 'listAgents']));
    });
});
