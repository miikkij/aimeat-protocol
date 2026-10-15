/**
 * @file test/unit/memory-search-one-rule.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One search rule on both backends (feature-list audit #52). PostgreSQL production
 *   indexes the key, the tags and the scalar values to six levels, without field names, and matches a
 *   query word at the start of a word. The SQLite FTS index held the raw JSON, so it matched field
 *   names at any depth, and storage.searchMemory (the MCP tool's read) matched a substring on both.
 *   These cases run on SQLite and pin the PostgreSQL rule; the PostgreSQL side is the same text
 *   (storage/search-text.ts) and is exercised by e2e-mcp-memory-extended on that backend.
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-search-one-rule.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #52).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord } from '../../src/storage/interface.js';
import { buildSearchBlob, searchValueText } from '../../src/storage/search-text.js';
import { backfillMemorySearchValues } from '../../src/storage/providers/sqlite/schema-memory-search.js';

const OWNER = 'alice@search-rule-node';

function rec(key: string, value: unknown, tags: string[] = []): MemoryRecord {
    const now = new Date().toISOString();
    return { key, ownerGaii: OWNER, value, visibility: 'private', tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

/** Nest `leaf` under `levels` objects: levels=7 puts the scalar at depth 7. */
function nested(levels: number, leaf: string): unknown {
    let v: unknown = leaf;
    for (let i = 0; i < levels; i++) v = { [`lvl${i}`]: v };
    return v;
}

describe('the search text (storage/search-text.ts)', () => {
    it('holds the values, not the field names, and stops below depth six', () => {
        expect(searchValueText({ zqstatus: 'open', n: 3, ok: true })).toBe('open 3 true');
        expect(searchValueText(nested(6, 'deepsix'))).toBe('deepsix');
        expect(searchValueText(nested(7, 'deepseven'))).toBe('');
    });

    it('buildSearchBlob is the key, its segments, the tags and the values', () => {
        expect(buildSearchBlob(rec('notes.today', { t: 'hello' }, ['tagone']))).toBe('notes.today notes today tagone hello');
    });
});

describe('SQLite search follows the PostgreSQL rule', () => {
    let storage: SqliteStorage;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.setMemory(rec('rule.fields', { zqfieldname: 'zqvalueword' }));
        await storage.setMemory(rec('rule.deep', nested(7, 'zqdeepseven')));
        await storage.setMemory(rec('rule.six', nested(6, 'zqdeepsix')));
    });

    const keysOf = async (q: string) => (await storage.searchText(q, { ownerGaiis: [OWNER] })).map(h => h.record.key).sort();
    const keysOfOwner = async (q: string) => (await storage.searchMemory(OWNER, q)).map(r => r.key).sort();

    it('a field name finds nothing; its value does', async () => {
        expect(await keysOf('zqfieldname')).toEqual([]);
        expect(await keysOf('zqvalueword')).toEqual(['rule.fields']);
    });

    it('a value six levels down is found, seven levels down is not', async () => {
        expect(await keysOf('zqdeepsix')).toEqual(['rule.six']);
        expect(await keysOf('zqdeepseven')).toEqual([]);
    });

    it('searchMemory (the single-owner read) matches at the start of a word, not inside one', async () => {
        expect(await keysOfOwner('zqvalue')).toEqual(['rule.fields']);
        expect(await keysOfOwner('valueword')).toEqual([]);
        expect(await keysOfOwner('zqfieldname')).toEqual([]);
    });

    it('a rewrite re-indexes the new values', async () => {
        await storage.setMemory(rec('rule.fields', { zqfieldname: 'zqreplaced' }));
        expect(await keysOf('zqvalueword')).toEqual([]);
        expect(await keysOf('zqreplaced')).toEqual(['rule.fields']);
    });
});

describe('a row written before searchValues existed', () => {
    it('is indexed by its raw JSON until the backfill, and by its values after it', async () => {
        const storage = new SqliteStorage(':memory:');
        await storage.setMemory(rec('legacy.row', { zqlegacyfield: 'zqlegacyvalue' }));
        const db = (storage as unknown as { db: Database.Database }).db;
        // Put the row back in the state an older node left it in.
        db.prepare('UPDATE memory SET searchValues = NULL WHERE key = ?').run('legacy.row');
        expect((await storage.searchText('zqlegacyfield', { ownerGaiis: [OWNER] })).length).toBe(1);

        expect(backfillMemorySearchValues(db)).toBe(1);
        expect((await storage.searchText('zqlegacyfield', { ownerGaiis: [OWNER] })).length).toBe(0);
        expect((await storage.searchText('zqlegacyvalue', { ownerGaiis: [OWNER] })).length).toBe(1);
        expect(backfillMemorySearchValues(db)).toBe(0);
    });
});
