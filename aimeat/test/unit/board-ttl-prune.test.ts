/**
 * @file board-ttl-prune.test.ts
 * @description The TTL sweep DELETES expired board posts rather than filtering them.
 *
 *   That distinction had a test already, and it proved it over HTTP by reading an expired post by
 *   id: the single-post read never filtered TTL, so a 200 before the sweep and a 404 after it meant
 *   the row had really gone. On 2026-09-04 that read learned to refuse an expired post — a post
 *   given a lifetime should not be readable at its own address after it ends — and the probe went
 *   with it.
 *
 *   So the claim moves here, where it is made directly instead of inferred: pruneExpiredBoardPosts
 *   reports how many rows it removed, and the number is what the job's whole existence rests on.
 *   Until 2026-08-17 the Postgres backend read every post and deleted nothing, which is the failure
 *   this asserts against.
 * @version-history
 *   v1.0.0 -- 2026-09-04 -- Initial, when the single-post read stopped serving expired rows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

const BOARD = 'board-ttl-prune';
const OWNER = 'alice@node';

describe('the board TTL sweep removes rows', () => {
    let storage: SqliteStorage;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await storage.createBoard({
            id: BOARD, name: 'TTL', description: '', visibility: 'private',
            ownerGaii: OWNER, allowedGaiis: [], federate: false,
            createdAt: new Date().toISOString(),
        } as never);
    });

    async function post(id: string, ttlExpiresAt?: string): Promise<void> {
        await storage.createPost({
            boardId: BOARD, id, authorGaii: OWNER, title: id, body: 'x',
            category: 'general', tags: [], reactions: {}, replyTo: null,
            createdAt: new Date().toISOString(), ttlExpiresAt,
        } as never);
    }

    it('reports the number it removed, which is what proves it deletes rather than filters', async () => {
        await post('gone', new Date(Date.now() - 60_000).toISOString());
        await post('kept', new Date(Date.now() + 3_600_000).toISOString());
        await post('forever');

        const removed = await storage.pruneExpiredBoardPosts(new Date().toISOString());
        expect(removed).toBe(1);
    });

    it('leaves a live post and one with no lifetime alone', async () => {
        await post('gone', new Date(Date.now() - 60_000).toISOString());
        await post('kept', new Date(Date.now() + 3_600_000).toISOString());
        await post('forever');
        await storage.pruneExpiredBoardPosts(new Date().toISOString());

        const left = (await storage.listPosts(BOARD)).map(p => p.id).sort();
        expect(left).toEqual(['forever', 'kept']);
    });

    it('a second sweep removes nothing, so the first one really deleted', async () => {
        await post('gone', new Date(Date.now() - 60_000).toISOString());
        expect(await storage.pruneExpiredBoardPosts(new Date().toISOString())).toBe(1);
        expect(await storage.pruneExpiredBoardPosts(new Date().toISOString())).toBe(0);
    });
});
