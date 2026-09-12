/**
 * @file admin-memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin sub-router for memory: the operator's read across every owner's records, and
 *   the two writes that go with it.
 *
 *   WHY THIS IS A SEARCH AND NOT A LIST. Every other admin surface enumerates a set a person can read
 *   through — 57 boards, 143 agents, 61 owners. Memory has 140 records in a fresh install and a
 *   ceiling of 100 000 per account on aimeat.io, in no meaningful order. Fifty rows of keys answers
 *   no question anybody arrives with, so the primary door here is `GET .../memory/search`, which runs
 *   the node-wide FTS primitive the librarian already uses and nothing on the admin side did.
 *
 *   WHAT A LISTING OWES. These are other people's records. `visibility` alone does not say who can
 *   read one: `group` and `workspace` name an audience the row carries and the word does not, and a
 *   per-key origin list narrows any of the six further. So the reads here project the audience and
 *   the provenance, never the value — the value is fetched for the one record somebody opens.
 * @structure adminMemoryRouter · search · list · one record · delete · restore
 * @usage mounted by server-bootstrap/routes-loader.ts
 * @version-history
 *   v2.0.0 — 2026-09-12 — The page rebuilt around the question. GET /search (node-wide FTS with an
 *     excerpt cut from the hit's own value); the listing reads the value-free META projection and
 *     carries every field including the audience, archived rows and one owner's bin; GET one record
 *     with its value and kept versions; DELETE routes through the bin SERVICE with ownerOverride, so
 *     the operator is recorded as the deleter and the answer says how long it can be taken back;
 *     POST /restore takes it back. The listing no longer sends values: it was sending every value on
 *     the page to show a size the row already stores.
 *   v1.0.0 — 2026-03-16 — Initial implementation: list + delete endpoints
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ArchiveFilter } from '../storage/interface.js';
import type { MemoryMetaRow } from '../storage/repositories/memory.repository.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../services/memory-bin.js';

/** How much of a value is scanned for the search excerpt. A megabyte value is legal; reading all of
 *  it to highlight one word is not worth the wall clock, and the hit is ranked by the index anyway. */
const EXCERPT_SCAN_LIMIT = 64 * 1024;
/** Characters either side of the matched term. */
const EXCERPT_SPAN = 90;

/** Every setting a record's audience can be, widest reach last. The page offered four of these six,
 *  so a record readable by every member of the node could not be singled out at all. */
const VISIBILITIES = ['private', 'owner', 'group', 'workspace', 'members', 'public'] as const;

/** The archive filter a caller asked for, or the default. Anything else is treated as the default
 *  rather than refused: it is a view switch, and a typo should show the live set, not an error. */
function archiveFilter(raw: unknown): ArchiveFilter {
  return raw === 'include' || raw === 'only' ? raw : 'exclude';
}

/**
 * The stretch of the value where the query matched, so a hit says WHY it is a hit.
 *
 * The FTS primitive ranks and returns records, not snippets, and the record it returns already
 * carries its value — so this is cut here rather than asked of the database a second time. Null when
 * the term is not found as a literal substring, which is ordinary: the index stems and tokenises, so
 * a hit on "operators" can rank for "operator" with no exact run of characters to point at.
 */
function excerpt(value: unknown, query: string): { before: string; hit: string; after: string } | null {
    const term = (query.match(/[\p{L}\p{N}_]+/u) ?? [])[0];
    if (!term) return null;
    const text = (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, EXCERPT_SCAN_LIMIT);
    const at = text.toLowerCase().indexOf(term.toLowerCase());
    if (at < 0) return null;
    const from = Math.max(0, at - EXCERPT_SPAN);
    const to = Math.min(text.length, at + term.length + EXCERPT_SPAN);
    return {
        before: (from > 0 ? '…' : '') + text.slice(from, at),
        hit: text.slice(at, at + term.length),
        after: text.slice(at + term.length, to) + (to < text.length ? '…' : ''),
    };
}

/** One row as the page reads it. Never the value: that is the single-record door's job. */
function metaOut(m: MemoryMetaRow) {
    return {
        key: m.key,
        owner_gaii: m.ownerGaii,
        visibility: m.visibility,
        // Who that visibility actually means, when the record names someone.
        group_id: m.groupId ?? null,
        workspace_ref: m.workspaceRef ?? null,
        allowed_origins: m.allowedOrigins ?? null,
        // Absent means UNSTATED. The page says so rather than implying a person wrote it.
        ai_provenance_id: m.aiProvenanceId ?? null,
        tags: m.tags,
        version: m.version,
        byte_size: m.byteSize,
        ttl_hours: m.ttlHours ?? null,
        flag_count: m.flagCount,
        archived: !!m.archived,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
    };
}

export function adminMemoryRouter(
    config: AimeatConfig,
    storage: Storage,
): Router {
    const router = Router();
    const operator = [requireAuth(), requireRole('operator')] as const;

    // GET /v1/admin/memory/search — what is WRITTEN in memory, across every owner.
    //
    // BEFORE `/v1/admin/memory/:owner/:key`, and that is deliberate even though the two cannot
    // collide today (one segment against two): the next person to add a route here should see the
    // ordering rule stated rather than rediscover it. `storage.searchText` takes an optional owner
    // list and the docs say to omit it to search everyone — this is the caller that does.
    router.get('/v1/admin/memory/search', ...operator, async (req, res) => {
        const q = (req.query.q as string | undefined)?.trim();
        if (!q) {
            res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'A search needs something to search for: pass ?q='));
            return;
        }
        const owner = req.query.owner as string | undefined;
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
        const maxFlagsRaw = req.query.max_flags as string | undefined;

        const hits = await storage.searchText(q, {
            ownerGaiis: owner ? [owner] : undefined,
            keyPrefix: (req.query.prefix as string) || undefined,
            visibility: (req.query.visibility as string) || undefined,
            maxFlags: maxFlagsRaw === undefined ? undefined : parseInt(maxFlagsRaw, 10),
            archived: archiveFilter(req.query.archived),
            limit,
        });

        res.json(success(config.nodeId, {
            query: q,
            items: hits.map(h => ({
                ...metaOut({
                    key: h.record.key,
                    ownerGaii: h.record.ownerGaii,
                    visibility: h.record.visibility,
                    tags: h.record.tags,
                    version: h.record.version,
                    flagCount: h.record.flagCount ?? 0,
                    byteSize: 0,
                    ttlHours: h.record.ttlHours,
                    createdAt: h.record.createdAt,
                    updatedAt: h.record.updatedAt,
                    groupId: h.record.groupId ?? null,
                    workspaceRef: h.record.workspaceRef ?? null,
                    allowedOrigins: h.record.allowedOrigins ?? null,
                    aiProvenanceId: h.record.aiProvenanceId ?? null,
                    archived: !!h.record.archived,
                }),
                // searchText returns whole records, so the size is measured here rather than read
                // from the row's own byteSize — the one place in this router that does.
                byte_size: Buffer.byteLength(typeof h.record.value === 'string' ? h.record.value : JSON.stringify(h.record.value) ?? '', 'utf8'),
                score: h.score,
                excerpt: excerpt(h.record.value, q),
            })),
            limit,
        }));
    });

    // GET /v1/admin/memory — the listing, for when the question is "what is under this owner / prefix
    // / audience" rather than "where does this word appear". Value-free: it used to send every value
    // on the page, and a value may be a megabyte.
    router.get('/v1/admin/memory', ...operator, async (req, res) => {
        const owner = req.query.owner as string | undefined;
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        // The bin is its own read in storage and stays its own view here: every other memory read
        // hides deleted rows on purpose, and it is per-owner because that is the primitive there is.
        if (req.query.bin === '1' || req.query.bin === 'true') {
            if (!owner) {
                res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'The bin is read one owner at a time: pass ?owner='));
                return;
            }
            const graceMs = config.memoryDeleteGraceDays * 86_400_000;
            const rows = await storage.listDeletedMemory(owner);
            res.json(success(config.nodeId, {
                items: rows.map(r => ({
                    key: r.key,
                    owner_gaii: r.ownerGaii,
                    visibility: r.visibility,
                    byte_size: Buffer.byteLength(typeof r.value === 'string' ? r.value : JSON.stringify(r.value) ?? '', 'utf8'),
                    deleted_at: r.deletedAt ?? null,
                    deleted_by: r.deletedBy ?? null,
                    // What a person needs after a delete is not the date it went but how long is left.
                    restorable_until: graceMs > 0 && r.deletedAt
                        ? new Date(new Date(r.deletedAt).getTime() + graceMs).toISOString()
                        : null,
                })),
                total: rows.length,
                grace_days: config.memoryDeleteGraceDays,
                bin: true,
            }));
            return;
        }

        const base = {
            prefix: (req.query.prefix as string) || undefined,
            ownerPrefix: owner || undefined,
            archived: archiveFilter(req.query.archived),
        };
        const result = await storage.listAllMemoryMeta({
            ...base,
            visibility: (req.query.visibility as string) || undefined,
            newestFirst: req.query.oldest !== '1',
            limit,
            offset,
        });

        // ?counts=1 — the audience breakdown for the SAME filter, counted here rather than tallied
        // from the page in front of you. Counting the rows on screen and printing them beside a
        // node-wide total is how a screen comes to say "35 private" about a store holding thousands.
        // Six windowed reads, each one COUNT the database already runs for `total`.
        let counts: Record<string, number> | undefined;
        if (req.query.counts === '1' || req.query.counts === 'true') {
            const pairs = await Promise.all(VISIBILITIES.map(async v =>
                [v, (await storage.listAllMemoryMeta({ ...base, visibility: v, limit: 1 })).total] as const));
            counts = Object.fromEntries(pairs);
            counts.archived = (await storage.listAllMemoryMeta({ ...base, archived: 'only', limit: 1 })).total;
            // How many records narrow their own reach further with a web-origin list of their own.
            // Node-wide by construction — the primitive written for the operator's CORS page takes
            // no filter — so it is reported beside the breakdown rather than inside it.
            counts.with_origins = await storage.countMemoryWithOrigins();
        }

        res.json(success(config.nodeId, {
            items: result.items.map(metaOut),
            total: result.total,
            limit,
            offset,
            ...(counts ? { counts } : {}),
            // The ceiling the owner filter is read against, so the page never hardcodes it.
            max_keys_per_principal: config.memoryMaxKeysPerAgent,
            grace_days: config.memoryDeleteGraceDays,
        }));
    });

    // GET /v1/admin/memory/:owner/:key — one record, whole: its value, and the earlier values when
    // the key is trackable. This is the only door here that loads a value, which is why it takes one
    // key rather than a page of them.
    router.get('/v1/admin/memory/:owner/:key', ...operator, async (req, res) => {
        const ownerGaii = req.params.owner as string;
        const key = req.params.key as string;

        const rec = await storage.getMemory(ownerGaii, key);
        if (!rec) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key not found: ${ownerGaii}/${key}`));
            return;
        }

        // Kept versions exist only for a trackable key; asking for the others answers an empty list
        // either way, so the flag decides rather than a second round trip.
        const history = rec.trackable
            ? (await storage.listMemoryHistory(ownerGaii, key, { limit: 50 })).map(v => ({
                version: v.version,
                recorded_at: v.recordedAt,
                actor: v.actor ?? null,
                event: v.event ?? null,
                byte_size: Buffer.byteLength(typeof v.value === 'string' ? v.value : JSON.stringify(v.value) ?? '', 'utf8'),
            }))
            : [];

        res.json(success(config.nodeId, {
            key: rec.key,
            owner_gaii: rec.ownerGaii,
            value: rec.value,
            visibility: rec.visibility,
            group_id: rec.groupId ?? null,
            workspace_ref: rec.workspaceRef ?? null,
            allowed_origins: rec.allowedOrigins ?? null,
            ai_provenance_id: rec.aiProvenanceId ?? null,
            tags: rec.tags,
            version: rec.version,
            trackable: !!rec.trackable,
            byte_size: Buffer.byteLength(typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value) ?? '', 'utf8'),
            ttl_hours: rec.ttlHours ?? null,
            flag_count: rec.flagCount ?? 0,
            archived: !!rec.archived,
            archived_at: rec.archivedAt ?? null,
            archived_by: rec.archivedBy ?? null,
            archived_root: rec.archivedRoot ?? null,
            created_at: rec.createdAt,
            updated_at: rec.updatedAt,
            history,
        }));
    });

    // DELETE /v1/admin/memory/:owner/:key — into the bin, under the operator's name.
    //
    // Through the SERVICE, not `storage.deleteMemory`. The service is the one implementation so this
    // route and the three tool surfaces cannot drift apart on who may remove what, and it takes
    // `ownerOverride` for exactly this case: an operator naming somebody else's namespace. Reaching
    // past it lost two things — nobody was recorded as the deleter, which is the field that answers
    // "who do I ask where this went", and the answer carried no date, so the screen could say it was
    // deleted but not that it could be taken back, or until when.
    router.delete('/v1/admin/memory/:owner/:key', ...operator, async (req, res) => {
        const ownerGaii = req.params.owner as string;
        const out = await deleteMemoryRecord({ storage, config }, {
            caller: resolveIdentity(req.auth!, config.nodeId),
            ownerName: req.auth!.owner,
            key: req.params.key as string,
            ownerOverride: ownerGaii,
        });
        if (!out.ok) {
            res.status(404).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, {
            deleted: true,
            owner_gaii: out.ownerGaii,
            key: out.key,
            restorable_until: out.restorableUntil,
            grace_days: out.graceDays,
        }, out.restorableUntil
            ? [{ description: 'Changed your mind — put it back', method: 'POST', url: `/v1/admin/memory/${encodeURIComponent(out.ownerGaii)}/${encodeURIComponent(out.key)}/restore` }]
            : []));
    });

    // POST /v1/admin/memory/:owner/:key/restore — out of the bin, whole, while the window lasts.
    router.post('/v1/admin/memory/:owner/:key/restore', ...operator, async (req, res) => {
        const ownerGaii = req.params.owner as string;
        const out = await restoreMemoryRecord({ storage, config }, {
            caller: resolveIdentity(req.auth!, config.nodeId),
            ownerName: req.auth!.owner,
            key: req.params.key as string,
            ownerOverride: ownerGaii,
        });
        if (!out.ok) {
            res.status(404).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, { restored: true, owner_gaii: out.ownerGaii, key: out.key }));
    });

    return router;
}
