/**
 * @file src/services/genesis-memory-cache.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The local cache for cross-genesis memory reads: one prefix, written and read in one
 *   place.
 *
 *   WHY IT IS A MODULE AND NOT TWO BLOCKS IN A ROUTE. It was two blocks in a route, and they did not
 *   agree. The write built its key as `genesis-cache:<peer>:<key>` while the lookup listed the prefix
 *   `genesis:` — and a prefix search is `key LIKE 'genesis:%'`, which `genesis-cache:…` does not
 *   match. So the cache was written on every request, never read on any, and `genesisMemoryCache`
 *   being on cost a storage write per result while the fan-out to every active peer happened anyway.
 *   Nothing failed and nothing was logged; the feature was simply inert. Found on 2026-09-04 by the
 *   door inventory, which had gone looking at this handler for an unrelated reason.
 *
 *   `genesis:` IS THE RIGHT PREFIX, and not an arbitrary pick between the two. The answering side of
 *   the same file (`GET /v1/federation/genesis-memory-read`) skips keys beginning `replica:`,
 *   `genesis:` and `expiring:` when a peer asks for a prefix, so that cached and replicated copies are
 *   never re-exported as if this node were their source. A cache written under any other prefix opts
 *   itself out of that protection.
 *
 *   STALENESS IS THE STORE'S JOB. Entries carry `ttlHours`, and the list path prunes an expired row
 *   lazily on read (`isMemoryExpired` in the sqlite provider's bulk reads), so a hit is by definition
 *   still inside its lifetime and this module does not check times of its own.
 * @structure
 *   - GENESIS_CACHE_OWNER / GENESIS_CACHE_PREFIX / genesisCacheKey(): the one naming
 *   - findCachedGenesis(): the read
 *   - cacheGenesisResults(): the write
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from routes/federation-genesis.ts, which is where the two halves
 *     had disagreed since the cache was added.
 */
import type { MemoryRecord } from '../storage/types/commerce.js';

/**
 * Cached peer answers are filed under a reserved identity rather than under the person whose memory
 * they copy: they are this node's cache, not this node's data, and they must not appear in anybody's
 * own list.
 */
export const GENESIS_CACHE_OWNER = '__genesis__';

/** The prefix the answering side refuses to re-export. Both halves of the cache use this one. */
export const GENESIS_CACHE_PREFIX = 'genesis:';

/** One peer's answer for one key. The peer is in the key because two peers may answer for the same key. */
export function genesisCacheKey(sourceGenesis: string, key: string): string {
    return `${GENESIS_CACHE_PREFIX}${sourceGenesis}:${key}`;
}

/** What this module needs of the store, which is two calls. */
export interface GenesisCacheStore {
    listMemory(ownerGaii: string, opts?: { prefix?: string }): Promise<MemoryRecord[]>;
    setMemory(record: MemoryRecord): Promise<MemoryRecord>;
}

/** One cached peer answer, as the answering side shapes it. */
export interface GenesisResult extends Record<string, unknown> {
    key?: string;
    gaii?: string;
    value?: unknown;
    source_genesis?: string;
    source_node?: string;
}

/**
 * The cached answer for one key, or nothing.
 *
 * `targetGaii` narrows to one person's record when the caller named one; without it the first
 * cached answer for the key is taken, which is what a keyed read with no owner asked for.
 */
export async function findCachedGenesis(
    store: GenesisCacheStore,
    key: string,
    targetGaii?: string,
): Promise<GenesisResult | undefined> {
    const entries = await store.listMemory(GENESIS_CACHE_OWNER, { prefix: GENESIS_CACHE_PREFIX });
    const hit = entries.find(entry => {
        const value = entry.value as GenesisResult | null;
        if (!value || typeof value !== 'object') return false;
        return value.key === key && (!targetGaii || value.gaii === targetGaii);
    });
    return hit ? (hit.value as GenesisResult) : undefined;
}

/**
 * Store what the peers answered. A failure to cache is not a failure to answer, so each write is
 * reported rather than thrown: the caller has already got the data it was asked for.
 */
export async function cacheGenesisResults(
    store: GenesisCacheStore,
    results: GenesisResult[],
    ttlHours: number | null,
    onWriteFailure: (key: string, err: unknown) => void,
): Promise<void> {
    const now = new Date().toISOString();
    for (const result of results) {
        const cacheKey = genesisCacheKey(String(result.source_genesis ?? 'unknown'), String(result.key ?? 'unknown'));
        try {
            await store.setMemory({
                key: cacheKey,
                ownerGaii: GENESIS_CACHE_OWNER,
                value: result,
                visibility: 'public',
                tags: ['genesis-cache'],
                ttlHours,
                version: 1,
                createdAt: now,
                updatedAt: now,
            });
        } catch (err) {
            onWriteFailure(cacheKey, err);
        }
    }
}
