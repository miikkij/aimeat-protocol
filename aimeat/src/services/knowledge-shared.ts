/**
 * @file src/services/knowledge-shared.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The knowledge packages another account shared with this caller: audience members or
 *   organism:<id> (services/knowledge-audience.ts), for the library's reach "Shared with you" (WP11;
 *   design canvas "Jaettu data", board Kirjasto-kirjautunut). The read that opens one is GET
 *   /v1/knowledge/:id, whose findSharedManifest (routes/knowledge/helpers.ts) admits the same caller by
 *   the same audience check, and the list passes the caller's classification reader as that read does,
 *   so the library never names a package the read would refuse.
 *
 *   ONE CACHED SCAN. The node's knowledge manifests that are not public are found by one value-free key
 *   scan over `packages/`, then read in bulk, and kept when their audience is members or an organism.
 *   Cached for the catalogue TTL and dropped on any memory or catalogue change, as the public scan of
 *   GET /v1/catalogue/knowledge is.
 * @structure SharedKnowledgeManifest · sharedKnowledgeManifests · sharedKnowledgeFor
 * @usage const rows = await sharedKnowledgeFor({ storage, config }, req.auth, ownerName);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { cached, TTL } from './cache.js';
import { localAccountName } from '../utils/gaii.js';
import { packageAudienceOf, knowledgeAudienceAllows } from './knowledge-audience.js';
import { readerFor } from './classification/reader.js';
import { presentMemories } from './classification/present-memory.js';
import type { AudienceAuth } from './audience.js';

/** A knowledge package manifest shared with members or an organism, as stored. */
export type SharedKnowledgeManifest = MemoryRecord & { audience: string };

const SCAN_PAGE = 1000;
const READ_CHUNK = 500;

/** Every knowledge manifest of the node whose audience is members or organism:<id>. Cached. */
export async function sharedKnowledgeManifests(storage: Storage): Promise<SharedKnowledgeManifest[]> {
    return cached('cat:knowledge:shared-manifests', TTL.catalogue, async () => {
        const keys = new Set<string>();
        for (let offset = 0; ; offset += SCAN_PAGE) {
            const page = await storage.listAllMemoryMeta({ prefix: 'packages/', limit: SCAN_PAGE, offset, excludeVersionRows: true });
            for (const r of page.items) {
                if (r.key.endsWith('/manifest') && r.visibility !== 'public' && r.tags?.includes('knowledge-package') && !r.tags.includes('data-package')) keys.add(r.key);
            }
            if (page.items.length < SCAN_PAGE) break;
        }
        const list = [...keys];
        const out: SharedKnowledgeManifest[] = [];
        if (!storage.getMemoryByKeysAnyOwner) return out;
        for (let i = 0; i < list.length; i += READ_CHUNK) {
            for (const rec of await storage.getMemoryByKeysAnyOwner(list.slice(i, i + READ_CHUNK))) {
                if (rec.visibility === 'public' || (rec.value as { type?: unknown } | null)?.type !== 'knowledge-package') continue;
                const audience = packageAudienceOf(rec.value);
                if (audience === 'members' || audience.startsWith('organism:')) out.push({ ...rec, audience });
            }
        }
        return out;
    }, ['domain:memory', 'domain:catalogue']);
}

/**
 * The shared knowledge packages `auth` may read, of accounts other than `ownerName`, through the
 * caller's classification reader. Empty for a caller that is no account of this node.
 */
export async function sharedKnowledgeFor(
    deps: { storage: Storage; config: AimeatConfig }, auth: (AudienceAuth & { roles?: readonly string[] }) | null | undefined, ownerName: string,
): Promise<SharedKnowledgeManifest[]> {
    if (!auth || !ownerName) return [];
    const kept: SharedKnowledgeManifest[] = [];
    for (const m of await sharedKnowledgeManifests(deps.storage)) {
        const author = localAccountName(m.ownerGaii);
        if (author === ownerName) continue;
        if (await knowledgeAudienceAllows(deps.storage, m.audience, auth, author)) kept.push(m);
    }
    return presentMemories(readerFor(deps, auth as Parameters<typeof readerFor>[1]), kept);
}
