/**
 * @file genesis-memory-cache.test.ts
 * @description What a genesis cache write puts in the store is what a genesis cache read finds.
 *
 *   That sounds like a tautology and it was not one. The write built `genesis-cache:<peer>:<key>` and
 *   the read listed the prefix `genesis:`; a prefix search is `key LIKE 'genesis:%'`, so the two
 *   halves never met. The cache was written on every request and read on none, and because a miss is
 *   indistinguishable from an empty cache, nothing anywhere reported it. The whole class of defect is
 *   invisible to a test that exercises one half.
 *
 *   So this runs both halves against a real store. The first test is the round trip that was broken;
 *   the second holds the prefix to the one the answering side of the route refuses to re-export,
 *   because that is WHY it is `genesis:` and not a free choice between two spellings.
 * @version-history
 *   v1.0.0 -- 2026-09-04 -- Initial, with the fix it proves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import {
    cacheGenesisResults,
    findCachedGenesis,
    genesisCacheKey,
    GENESIS_CACHE_OWNER,
    GENESIS_CACHE_PREFIX,
    type GenesisResult,
} from '../../src/services/genesis-memory-cache.js';

const PEER = 'genesis-peer-a';
const OWNER = 'alice@remote-node';
const KEY = 'user:alice/field-notes';

const answer = (over: Partial<GenesisResult> = {}): GenesisResult => ({
    key: KEY,
    gaii: OWNER,
    value: { note: 'the peer answered this' },
    source_genesis: PEER,
    source_node: 'remote-node',
    ...over,
});

describe('the cross-genesis memory cache', () => {
    let storage: SqliteStorage;
    const swallowed: string[] = [];

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
        swallowed.length = 0;
    });

    it('finds what it wrote', async () => {
        await cacheGenesisResults(storage, [answer()], 24, k => swallowed.push(k));
        expect(swallowed).toEqual([]);

        const hit = await findCachedGenesis(storage, KEY, OWNER);
        expect(hit).toBeDefined();
        expect(hit?.value).toEqual({ note: 'the peer answered this' });
        expect(hit?.source_genesis).toBe(PEER);
    });

    it('finds it with no owner named, because a keyed read need not name one', async () => {
        await cacheGenesisResults(storage, [answer()], 24, k => swallowed.push(k));
        expect(await findCachedGenesis(storage, KEY)).toBeDefined();
    });

    it('does not answer for a different person or a different key', async () => {
        await cacheGenesisResults(storage, [answer()], 24, k => swallowed.push(k));
        expect(await findCachedGenesis(storage, KEY, 'bob@remote-node')).toBeUndefined();
        expect(await findCachedGenesis(storage, 'user:alice/other', OWNER)).toBeUndefined();
    });

    it('keeps one entry per peer for the same key', async () => {
        await cacheGenesisResults(storage, [
            answer(),
            answer({ source_genesis: 'genesis-peer-b', value: { note: 'a second peer' } }),
        ], 24, k => swallowed.push(k));

        const stored = await storage.listMemory(GENESIS_CACHE_OWNER, { prefix: GENESIS_CACHE_PREFIX });
        expect(stored).toHaveLength(2);
    });

    it('files under the prefix the answering side refuses to re-export', async () => {
        // GET /v1/federation/genesis-memory-read skips replica:, genesis: and expiring: on a prefix
        // query, so that a cached copy is never served as if this node were its source. A cache under
        // any other prefix opts out of that, which is why this is asserted rather than assumed.
        expect(genesisCacheKey(PEER, KEY).startsWith('genesis:')).toBe(true);
        expect(GENESIS_CACHE_PREFIX).toBe('genesis:');
    });

    it('lets a lifetime run out rather than serving a stale answer', async () => {
        // ttlHours is honoured by the store's own lazy prune on read, so a hit is inside its lifetime
        // by construction. Written with a creation time a day in the past and a one-hour lifetime.
        const stale = answer();
        const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString();
        await storage.setMemory({
            key: genesisCacheKey(PEER, KEY),
            ownerGaii: GENESIS_CACHE_OWNER,
            value: stale,
            visibility: 'public',
            tags: ['genesis-cache'],
            ttlHours: 1,
            version: 1,
            createdAt: yesterday,
            updatedAt: yesterday,
        });

        expect(await findCachedGenesis(storage, KEY, OWNER)).toBeUndefined();
    });
});
