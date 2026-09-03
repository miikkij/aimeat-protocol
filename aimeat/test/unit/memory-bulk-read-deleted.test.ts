/**
 * @file memory-bulk-read-deleted.test.ts
 * @description The bulk read has to answer what the single read answers.
 *
 *   `getMemory` names `deletedAt IS NULL`. `getMemoryByKeys` and `getMemoryByKeysAnyOwner` did not,
 *   on the SQLite provider, so the same record was 404 by key and present in a list. The Postgres
 *   provider runs both through one `isVisible` predicate and was right the whole time — two
 *   providers, one rule, and the one that spelled it out twice is the one that got it wrong.
 *
 *   Where it costs something: GET /v1/ghii asks every other owner's `directory_listed` record in one
 *   bulk call to decide who appears in the directory. A person who deletes theirs to leave the
 *   directory stayed in it, and the fallback path — one getMemory per owner — removed them. The same
 *   question, two implementations, opposite answers.
 * @version-history
 *   v1.0.0 -- 2026-09-03 -- Initial, with the fix (wish-invarianttiauditointi, first verified finding).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { MemoryRecord } from '../../src/storage/types/commerce.js';

const OWNER = 'alice@node';
const OTHER = 'bob@node';

function record(ownerGaii: string, key: string): MemoryRecord {
    const now = new Date().toISOString();
    return {
        key, ownerGaii, value: { listed: true }, visibility: 'private',
        tags: [], version: 1, createdAt: now, updatedAt: now,
    } as unknown as MemoryRecord;
}

describe('the bulk read and the single read agree about a deleted record', () => {
    let storage: SqliteStorage;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.setMemory(record(OWNER, 'directory_listed'));
        await storage.setMemory(record(OWNER, 'kept'));
        await storage.setMemory(record(OTHER, 'directory_listed'));
    });

    it('by key, a deleted record is gone', async () => {
        expect(await storage.deleteMemory(OWNER, 'directory_listed')).toBe(true);
        expect(await storage.getMemory(OWNER, 'directory_listed')).toBeNull();
    });

    it('in bulk under one owner, a deleted record is gone too', async () => {
        await storage.deleteMemory(OWNER, 'directory_listed');
        const rows = await storage.getMemoryByKeys(OWNER, ['directory_listed', 'kept']);
        expect(rows.map(r => r.key)).toEqual(['kept']);
    });

    it('in bulk across owners, only the owner who did NOT delete is returned', async () => {
        // The directory's own question: who opted in. Deleting the record is how a person opts out.
        await storage.deleteMemory(OWNER, 'directory_listed');
        const rows = await storage.getMemoryByKeysAnyOwner(['directory_listed']);
        expect(rows.map(r => r.ownerGaii)).toEqual([OTHER]);
    });

    it('a live record still comes back, so the filter did not take everything', async () => {
        const rows = await storage.getMemoryByKeys(OWNER, ['directory_listed', 'kept']);
        expect(rows.map(r => r.key).sort()).toEqual(['directory_listed', 'kept']);
    });
});
