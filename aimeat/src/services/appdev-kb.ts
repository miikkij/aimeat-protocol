/**
 * @file appdev-kb.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared service layer of the learned AppDev knowledge base — the one place that
 *   knows the storage conventions of learned pitfalls (reserved knowledge package
 *   `packages/appdev-pitfalls/{category}/{slug}`, owner-scope aggregation, manifest upkeep)
 *   so the MCP tools (mcp/appdev-pitfalls.ts) and the profile-UI REST routes
 *   (routes/appdev-pitfalls.ts) can never drift. Owner scope = the owner GHII + every
 *   same-owner agent GAII, deduped by key GHII-first.
 * @structure listOwnerScopeMemory · listOwnerScopeShown · findOwnEntry · ownPitfallRecords ·
 *   sharedPitfallRecords · listLearnedPitfalls · queryLearnedPitfalls · pitfallIndex · filterPitfalls ·
 *   pitfallFacets · setPitfallFlags · deletePitfallEntry · upsertPitfallManifest · pitfallEntryKey ·
 *   PITFALL_* constants
 * @usage import { listLearnedPitfalls, setPitfallFlags } from './appdev-kb.js';
 * @version-history
 *   v1.5.0 -- 2026-10-06 -- pitfallIndex(): the merged index (own, curated, shared by scope) that
 *     aimeat_appdev_pitfall_list built inline, moved here so GET /v1/appdev/pitfalls/index answers
 *     the same thing and the connector's tool can call it (secaudit 2026-10 follow-up, Part B).
 *   v1.4.0 -- 2026-09-29 -- TARGET-082 V4: every listing that returns entries to a caller takes the
 *     caller's classification reader (services/classification/reader.ts) instead of an identity and
 *     passes the records through presentMemories: listOwnerScopeShown, ownPitfallRecords,
 *     sharedPitfallRecords, listLearnedPitfalls, queryLearnedPitfalls. The MCP list tool reads its
 *     own and shared entries through the last two instead of its own copy of the shared-entry query.
 *     An entry shown with a warning label keeps `classificationWarning`. listOwnerScopeMemory and
 *     findOwnEntry stay unchecked: they serve the read-to-update of the report, flag and delete paths.
 *   v1.3.1 -- 2026-09-26 -- ownerOf() names the caller's account with localAccountOf, so a visitor
 *     from another node reads and writes its own learned pitfalls, never the local namesake's
 *     (secaudit 2026-09, A3-1).
 *   v1.3.0 -- 2026-09-13 -- filterPitfalls() takes preferModel: ordering inside a severity class,
 *     never a filter. The research overview now builds its learned section from this step instead of
 *     keeping only the entries the caller's own model had written. A learned entry carries
 *     `verified_at` / `verified_version` (verificationStamp()); setPitfallFlags() records a re-check.
 *   v1.2.0 -- 2026-09-03 -- filterPitfalls() and pitfallFacets(): the filter, sort, facet and page
 *     step the MCP list tool had inline, now shared with the REST route through
 *     queryLearnedPitfalls() (AppDev page, poster face). The page used to fetch every entry with
 *     its full body and filter in the browser; +q text search, +severity and shared filters,
 *     +status default, +the count of what other owners have shared.
 *   v1.1.0 -- 2026-08-11 -- deletePitfallEntry() is now the only delete: the MCP tool had its own
 *     copy (storage.deleteMemory + manifest cleanup) and emitted the live update, while this one,
 *     which the REST door calls, did not. Deleting an entry in the browser left it on every other
 *     screen until a reload. pitfallEntryKey() replaces the same key expression written out in
 *     three places (August 2026 audit step 8).
 *   v1.0.0 — 2026-07-19 — extracted from mcp/appdev-pitfalls.ts + extended with the UI
 *     management operations (share/status flags, full-body listing) (AppDev KB UI phase).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { isGEAI, localAccountOf } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { writeMemoryRecord } from './memory-write.js';
import type { ContentReader } from './classification/reader.js';
import { presentMemories, classificationWarningOf } from './classification/present-memory.js';
import { getAppdevPitfalls } from '../data/appdev-pitfalls.js';

export const PITFALL_PACKAGE_ID = 'appdev-pitfalls';
export const PITFALL_PREFIX = `packages/${PITFALL_PACKAGE_ID}/`;
export const PITFALL_MANIFEST_KEY = `packages/${PITFALL_PACKAGE_ID}/manifest`;
export const PITFALL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface LearnedPitfallValue {
    title: string;
    symptom: string;
    resolution: string;
    model: string;
    category: string;
    slug: string;
    applies_to: string[];
    severity: 'info' | 'warn' | 'critical';
    status: 'active' | 'outdated';
    app_ref?: string;
    reported_by: string;
    created: string;
    updated: string;
    /** When this entry was last checked against the platform, and the node version it was checked on. */
    verified_at?: string;
    verified_version?: string;
}

/** The stamp a report or an explicit re-check writes: now, on this node's software version. */
export function verificationStamp(version: string, at: Date = new Date()): { verified_at: string; verified_version: string } {
    return { verified_at: at.toISOString(), verified_version: version };
}

export function slugifyKb(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'entry';
}

/** The address of one learned entry. Category is slugified, slug is taken as given (lowercased). */
export function pitfallEntryKey(category: string, slug: string): string {
    return `${PITFALL_PREFIX}${slugifyKb(category)}/${slug.toLowerCase()}`;
}

/**
 * The account on this node behind the caller, or null. An ecosystem app names none, as it never has,
 * and an identity of another node names none either: a visitor then works in its own namespace,
 * never in the namesake's.
 */
function ownerOf(callerGaii: string, _config: AimeatConfig): string | null {
    return isGEAI(callerGaii) ? null : localAccountOf(callerGaii);
}

/**
 * Owner-scope memory aggregation (GHII + all same-owner agents), deduped by key GHII-first.
 *
 * A knowledge package may sit under the owner's GHII (imported through the web UI) or under any of
 * their agents, so "what does this account hold" is one query across the whole identity set rather
 * than a walk. mcp/knowledge.ts had its own copy of this, and of the priority ordering that decides
 * which duplicate key wins — the two agreeing is what made an agent and the browser list the same
 * packages, and there was nothing keeping them agreeing.
 */
export async function listOwnerScopeMemory(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    opts: { prefix?: string; tags?: string[]; visibility?: string },
): Promise<MemoryRecord[]> {
    const owner = ownerOf(callerGaii, config);
    if (!owner) return storage.listMemory(callerGaii, opts);
    const ownerGhii = `${owner}@${config.nodeId}`;
    const agents = await storage.getAgentsByOwner(owner);
    const owners = [ownerGhii, ...agents.map(a => a.gaii)];
    const priority = new Map(owners.map((g, i) => [g, i]));
    const rows = await storage.listMemoryForOwners(owners, opts);
    rows.sort((x, y) => (priority.get(x.ownerGaii) ?? 0) - (priority.get(y.ownerGaii) ?? 0));
    const seen = new Set<string>();
    const out: MemoryRecord[] = [];
    for (const rec of rows) {
        if (!seen.has(rec.key)) { seen.add(rec.key); out.push(rec); }
    }
    return out;
}

/**
 * The owner-scope records this reader may see: listOwnerScopeMemory for the reader's own identity,
 * then the classification check and the credential mask (presentMemories). Every owner-scope
 * listing that hands records to a caller goes through this; listOwnerScopeMemory itself is for
 * the read-to-update paths.
 */
export async function listOwnerScopeShown(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
    opts: { prefix?: string; tags?: string[]; visibility?: string },
): Promise<MemoryRecord[]> {
    return presentMemories(reader, await listOwnerScopeMemory(storage, config, reader.identity, opts));
}

/** The identity set (GHII + agent GAIIs) of the caller's owner — for own/other filtering. */
export async function ownIdentitySet(
    storage: Storage, config: AimeatConfig, callerGaii: string,
): Promise<Set<string>> {
    const owner = ownerOf(callerGaii, config);
    if (!owner) return new Set([callerGaii]);
    const agents = await storage.getAgentsByOwner(owner);
    return new Set([`${owner}@${config.nodeId}`, ...agents.map(a => a.gaii)]);
}

/** Find one of the caller's own KB records by exact key (across the owner identity set). */
export async function findOwnEntry(
    storage: Storage, config: AimeatConfig, callerGaii: string, key: string,
): Promise<MemoryRecord | null> {
    const rows = await listOwnerScopeMemory(storage, config, callerGaii, { prefix: key });
    return rows.find(r => r.key === key) ?? null;
}

/** Keep the reserved package manifest's entries list in sync (add/replace/remove one ref). */
export async function upsertPitfallManifest(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    entryKey: string, title: string, remove = false,
): Promise<void> {
    const now = new Date().toISOString();
    const existing = await findOwnEntry(storage, config, callerGaii, PITFALL_MANIFEST_KEY);
    type ManifestValue = { name: string; content_type: string; tags: string[]; entries: Array<{ key: string; title?: string }>; updated?: string };
    const value: ManifestValue = (existing?.value as ManifestValue | null) ?? {
        name: 'AppDev pitfalls (learned)',
        content_type: 'appdev-pitfalls',
        tags: ['pitfall'],
        entries: [],
    };
    const entries = Array.isArray(value.entries) ? value.entries : [];
    const idx = entries.findIndex(e => e.key === entryKey);
    if (remove) {
        if (idx === -1) return;
        entries.splice(idx, 1);
    } else if (idx === -1) {
        entries.push({ key: entryKey, title });
    } else {
        entries[idx] = { key: entryKey, title };
    }
    value.entries = entries;
    value.updated = now;
    await storage.setMemory({
        key: PITFALL_MANIFEST_KEY,
        ownerGaii: existing?.ownerGaii ?? callerGaii,
        value,
        visibility: existing?.visibility ?? 'owner',
        tags: existing?.tags ?? ['knowledge-package', 'pitfall'],
        ttlHours: null,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}

export interface LearnedPitfallEntry extends Partial<LearnedPitfallValue> {
    key: string;
    shared: boolean;
    /** 'own' = the caller's owner scope; 'shared' = another owner's public entry. */
    source: 'own' | 'shared';
    owner?: string;
    /** Set when the entry was shown to an AI under a warning classification (reader.show). */
    classificationWarning?: { label: string; name: string; says: string };
}

function toEntry(rec: MemoryRecord, source: 'own' | 'shared'): LearnedPitfallEntry {
    const v = rec.value as Partial<LearnedPitfallValue> | null;
    const warning = classificationWarningOf(rec);
    return {
        key: rec.key,
        source,
        shared: rec.visibility === 'public',
        ...(source === 'shared' ? { owner: rec.ownerGaii } : {}),
        title: v?.title ?? rec.key,
        symptom: v?.symptom,
        resolution: v?.resolution,
        model: v?.model,
        category: v?.category,
        slug: v?.slug,
        applies_to: v?.applies_to ?? [],
        severity: v?.severity ?? 'warn',
        status: v?.status ?? 'active',
        app_ref: v?.app_ref,
        updated: v?.updated ?? rec.updatedAt,
        verified_at: v?.verified_at,
        verified_version: v?.verified_version,
        ...(warning ? { classificationWarning: warning } : {}),
    };
}

/** The reader's own learned entries (any visibility, manifest left out), as this reader may see them. */
export async function ownPitfallRecords(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
): Promise<MemoryRecord[]> {
    return (await listOwnerScopeShown(storage, config, reader, { prefix: PITFALL_PREFIX, tags: ['pitfall'] }))
        .filter(r => r.key !== PITFALL_MANIFEST_KEY);
}

/**
 * Other owners' public-shared learned entries, as this reader may see them. The one query for
 * them: the MCP list tool had its own copy of it.
 */
export async function sharedPitfallRecords(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
): Promise<MemoryRecord[]> {
    const ownIds = await ownIdentitySet(storage, config, reader.identity);
    const { items } = await storage.listAllMemory({ prefix: PITFALL_PREFIX, visibility: 'public', limit: 500 });
    return presentMemories(reader, items
        .filter(rec => rec.key !== PITFALL_MANIFEST_KEY)
        .filter(rec => !ownIds.has(rec.ownerGaii))
        .filter(rec => (rec.tags ?? []).includes('pitfall')));
}

/** Other owners' public-shared entries, as full entries (source 'shared', owner set). */
async function listSharedByOthers(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
): Promise<LearnedPitfallEntry[]> {
    return (await sharedPitfallRecords(storage, config, reader)).map(rec => toEntry(rec, 'shared'));
}

/**
 * Full-body learned-pitfall listing for the UI: the caller's own entries (any visibility)
 * and, with includeShared, other owners' public entries. Curated registry entries are NOT
 * merged here — the UI reads them from GET /v1/appdev/pitfalls directly.
 */
export async function listLearnedPitfalls(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
    opts: { includeShared?: boolean } = {},
): Promise<LearnedPitfallEntry[]> {
    const own = (await ownPitfallRecords(storage, config, reader)).map(r => toEntry(r, 'own'));
    if (!opts.includeShared) return own;
    return [...own, ...await listSharedByOthers(storage, config, reader)];
}

/* ── One filter, sort, facet and page step for both doors ─────────────────────────────────────
 * The MCP list tool had pagination and facets and the REST route the profile page reads did not,
 * so the page fetched every entry with its full body (112 rows, about 150 kB on the production
 * node, growing with every build) and filtered in the browser. The step below is what both call
 * now; the tool still merges the curated registry in before it, which is why it takes anything
 * that carries the index fields rather than a LearnedPitfallEntry. */

export const SEVERITY_RANK: Record<string, number> = { critical: 0, warn: 1, info: 2 };
const LIST_MAX_LIMIT = 100;

/** The fields the step reads. Curated entries carry category null and an id; learned ones a key. */
export interface PitfallLike {
    id?: string;
    key?: string;
    title?: string;
    symptom?: string;
    resolution?: string;
    fix?: string;
    category?: string | null;
    slug?: string | null;
    model?: string | null;
    applies_to?: string[];
    severity?: string;
    status?: string;
    updated?: string;
    shared?: boolean;
    source?: string;
    app_ref?: string;
    verified_at?: string | null;
    verified_version?: string | null;
}

export interface PitfallListQuery {
    /** Default 'active': outdated entries are kept but hidden. */
    status?: 'active' | 'outdated' | 'all';
    severity?: string;
    category?: string;
    /** A curated entry carries no model and passes any model filter. */
    model?: string;
    applies_to?: string;
    /** Own entries only: true = shared platform-wide, false = private. */
    shared?: boolean;
    /** Case-insensitive text over title, symptom, resolution, app and model. */
    q?: string;
    /** Default 'updated' (newest first); 'severity' ranks critical first, newest first within a class. */
    sort?: 'updated' | 'severity';
    /**
     * Ordering only, never a filter: with sort 'severity', entries written by this model come first
     * inside each severity class. The research overview passes the builder's own model here, because
     * an entry is about the platform far more often than about the model that happened to hit it.
     */
    preferModel?: string;
    limit?: number;
    offset?: number;
}

export interface PitfallFacets {
    severity: Record<string, number>;
    category: Record<string, number>;
    model: Record<string, number>;
    status: Record<string, number>;
    shared: Record<string, number>;
    source: Record<string, number>;
    /** Learned entries by the app they point at; '(none)' for the ones that name no app. */
    app: Record<string, number>;
}

export function pitfallFacets(entries: PitfallLike[]): PitfallFacets {
    const f: PitfallFacets = { severity: {}, category: {}, model: {}, status: {}, shared: {}, source: {}, app: {} };
    const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
    for (const e of entries) {
        bump(f.severity, e.severity ?? 'warn');
        bump(f.category, e.category ?? '(curated)');
        if (e.model) bump(f.model, e.model);
        bump(f.status, e.status ?? 'active');
        if (e.source !== 'curated') {
            bump(f.shared, e.shared ? 'shared' : 'private');
            bump(f.app, e.app_ref || '(none)');
        }
        bump(f.source, e.source ?? 'own');
    }
    return f;
}

export function filterPitfalls<T extends PitfallLike>(entries: T[], query: PitfallListQuery): {
    pitfalls: T[]; total: number; offset: number; limit: number; facets: PitfallFacets; filtered_facets: PitfallFacets;
} {
    const wantStatus = query.status ?? 'active';
    const model = query.model?.trim().toLowerCase();
    const category = query.category ? slugifyKb(query.category) : undefined;
    const area = query.applies_to?.trim().toLowerCase();
    const q = query.q?.trim().toLowerCase();
    let out = entries;
    if (wantStatus !== 'all') out = out.filter(e => (e.status ?? 'active') === wantStatus);
    if (query.severity) out = out.filter(e => (e.severity ?? 'warn') === query.severity);
    if (category) out = out.filter(e => e.category === category || e.id === query.category);
    if (model) out = out.filter(e => e.model == null || e.model === model);
    if (area) out = out.filter(e => (e.applies_to ?? []).includes(area));
    if (query.shared !== undefined) out = out.filter(e => e.source === 'curated' || !!e.shared === query.shared);
    if (q) {
        out = out.filter(e => [e.title, e.symptom, e.resolution, e.fix, e.app_ref, e.model, e.category, e.slug, e.id]
            .some(v => typeof v === 'string' && v.toLowerCase().includes(q)));
    }
    const byUpdated = (a: PitfallLike, b: PitfallLike) => String(b.updated ?? '').localeCompare(String(a.updated ?? ''));
    const preferred = query.preferModel?.trim().toLowerCase();
    const byPreferred = (a: PitfallLike, b: PitfallLike) => preferred
        ? Number(b.model === preferred) - Number(a.model === preferred)
        : 0;
    out = [...out].sort(query.sort === 'severity'
        ? (a, b) => ((SEVERITY_RANK[a.severity ?? 'warn'] ?? 1) - (SEVERITY_RANK[b.severity ?? 'warn'] ?? 1))
            || byPreferred(a, b) || byUpdated(a, b)
        : byUpdated);
    const limit = Number.isFinite(query.limit) ? Math.min(Math.max(query.limit as number, 1), LIST_MAX_LIMIT) : 25;
    const offset = Number.isFinite(query.offset) && (query.offset as number) > 0 ? (query.offset as number) : 0;
    return {
        pitfalls: out.slice(offset, offset + limit),
        total: out.length,
        offset,
        limit,
        facets: pitfallFacets(entries),
        filtered_facets: pitfallFacets(out),
    };
}

/**
 * The learned list the profile page reads: one page of full entries with the counts around it.
 * `facets` count the whole scope (own, plus other owners' shared with includeShared) so filter
 * chips keep their numbers while a filter is on; `filtered_facets` count what the filter left;
 * `community` is how many entries other owners have shared, whether or not they are included, so
 * the page can say the number is zero instead of offering a toggle that shows nothing.
 */
export async function queryLearnedPitfalls(
    storage: Storage, config: AimeatConfig, reader: ContentReader,
    query: PitfallListQuery & { includeShared?: boolean },
) {
    const own = await listLearnedPitfalls(storage, config, reader);
    const shared = await listSharedByOthers(storage, config, reader);
    const scope = query.includeShared ? [...own, ...shared] : own;
    return { ...filterPitfalls(scope, query), community: shared.length };
}

/** One row of the merged index: no bodies, enough to choose which entry to open. */
function asIndexEntry(source: 'learned' | 'learned-shared', rec: MemoryRecord): PitfallLike & Record<string, unknown> {
    const v = rec.value as Partial<LearnedPitfallValue> | null;
    const warning = classificationWarningOf(rec);
    return {
        source,
        key: rec.key,
        title: v?.title ?? rec.key,
        category: v?.category ?? null,
        slug: v?.slug ?? null,
        model: v?.model ?? null,
        applies_to: v?.applies_to ?? [],
        severity: v?.severity ?? 'warn',
        status: v?.status ?? 'active',
        updated: v?.updated ?? rec.updatedAt,
        verified_at: v?.verified_at ?? null,
        verified_version: v?.verified_version ?? null,
        shared: rec.visibility === 'public',
        // Another owner's entry is read by naming its holder (aimeat_memory_read_public {gaii, key}).
        ...(source === 'learned-shared' ? { owner: rec.ownerGaii } : {}),
        ...(warning ? { classificationWarning: warning } : {}),
    };
}

export interface PitfallIndexQuery {
    /** own = the caller's owner scope; platform = the curated registry and other owners' shared entries; all = both. */
    scope?: 'own' | 'platform' | 'all';
    status?: 'active' | 'outdated' | 'all';
    category?: string;
    model?: string;
    applies_to?: string;
    limit?: number;
    offset?: number;
}

/**
 * The merged index an agent reads before it builds: its own learned entries, the curated registry
 * (data/appdev-pitfalls.ts) and other owners' shared entries, chosen by scope, then filtered,
 * ranked by severity and paged by filterPitfalls(). aimeat_appdev_pitfall_list on the node's MCP
 * and GET /v1/appdev/pitfalls/index both answer with this; the connector's tool calls the route.
 */
export async function pitfallIndex(
    storage: Storage, config: AimeatConfig, reader: ContentReader, query: PitfallIndexQuery,
): Promise<Record<string, unknown>> {
    const scope = query.scope ?? 'all';
    const wantStatus = query.status ?? 'active';
    const entries: PitfallLike[] = [];
    if (scope === 'own' || scope === 'all') {
        for (const rec of await ownPitfallRecords(storage, config, reader)) entries.push(asIndexEntry('learned', rec));
    }
    if (scope === 'platform' || scope === 'all') {
        for (const p of getAppdevPitfalls({ includeOutdated: wantStatus !== 'active' })) {
            entries.push({
                source: 'curated', id: p.id, title: p.title, category: null, slug: p.id,
                model: null, applies_to: p.appliesTo as string[], severity: p.severity,
                status: p.status ?? 'active', updated: p.updatedAt, shared: true,
                verified_at: p.verifiedAt ?? null, verified_version: p.verifiedVersion ?? null,
                detail_url: `/v1/appdev/pitfalls/${p.id}`,
            } as PitfallLike);
        }
        for (const rec of await sharedPitfallRecords(storage, config, reader)) entries.push(asIndexEntry('learned-shared', rec));
    }
    // Facets count what the filter left, as the MCP tool always did.
    const page = filterPitfalls(entries, {
        status: wantStatus, category: query.category, model: query.model?.trim().toLowerCase(),
        applies_to: query.applies_to, sort: 'severity', limit: query.limit, offset: query.offset,
    });
    return {
        pitfalls: page.pitfalls,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        facets: page.filtered_facets,
        hint: 'One full learned entry: aimeat_memory_read {key, owner_scope: true} for your own, aimeat_memory_read_public {gaii: owner, key} for a shared one. Curated detail: GET /v1/appdev/pitfalls/{id}.',
    };
}

/**
 * Toggle the share (visibility) and/or status flags on one of the caller's own entries, and/or
 * record that it was checked again (`verified`: the node's own version and now). A re-check changes
 * no words, so it leaves `updated` alone.
 */
export async function setPitfallFlags(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    category: string, slug: string,
    flags: { share?: boolean; status?: 'active' | 'outdated'; verified?: { version: string } },
): Promise<LearnedPitfallEntry | null> {
    const key = pitfallEntryKey(category, slug);
    const existing = await findOwnEntry(storage, config, callerGaii, key);
    if (!existing) return null;
    const now = new Date().toISOString();
    const value = { ...(existing.value as LearnedPitfallValue) };
    if (flags.status) {
        value.status = flags.status;
        value.updated = now;
    }
    if (flags.verified) Object.assign(value, verificationStamp(flags.verified.version));
    const visibility = flags.share === undefined
        ? existing.visibility
        : flags.share ? 'public' : 'owner';
    const updated: MemoryRecord = {
        ...existing,
        value,
        visibility,
        version: (existing.version ?? 0) + 1,
        updatedAt: now,
    };
    await storage.setMemory(updated);
    return toEntry(updated, 'own');
}

export interface PitfallReportInput {
    model: string;
    category: string;
    title: string;
    symptom: string;
    resolution: string;
    slug?: string;
    applies_to?: string[];
    severity?: 'info' | 'warn' | 'critical';
    status?: 'active' | 'outdated';
    app_ref?: string;
    share?: boolean;
}

export type PitfallReportResult =
    | { ok: true; key: string; category: string; slug: string; updated: boolean; version: number; visibility: string; verified_at: string; verified_version: string }
    | { ok: false; status: number; code: string; message: string };

/**
 * Report (upsert) one learned pitfall: the ONE implementation behind the node's MCP tool, POST
 * /v1/appdev/pitfalls/learned and, through that route, both connector doors. The connector doors
 * used to write POST /v1/memory themselves, which skipped the manifest, lost `created` and
 * `reported_by`, and wrote under the connector agent's own namespace even when the entry already
 * lived under another of the owner's identities, where it then shadowed the original.
 *
 * Every report stamps `verified_at` / `verified_version`: a report is a claim about this node as it
 * is now, so re-reporting an entry is how it is re-verified.
 */
export async function reportLearnedPitfall(
    storage: Storage, config: AimeatConfig,
    who: { principal: string; scopes: string[]; roles: string[] },
    input: PitfallReportInput, softwareVersion: string,
): Promise<PitfallReportResult> {
    const cat = slugifyKb(input.category);
    const slg = input.slug ? input.slug.toLowerCase() : slugifyKb(input.title);
    if (!PITFALL_SLUG_RE.test(cat) || !PITFALL_SLUG_RE.test(slg)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Invalid category/slug — use kebab-case (a-z, 0-9, dashes)' };
    }
    const key = pitfallEntryKey(cat, slg);
    const now = new Date();
    const existing = await findOwnEntry(storage, config, who.principal, key);
    const normModel = input.model.trim().toLowerCase();
    const stamp = verificationStamp(softwareVersion, now);
    const value: LearnedPitfallValue = {
        title: input.title, symptom: input.symptom, resolution: input.resolution,
        model: normModel,
        category: cat, slug: slg,
        applies_to: (input.applies_to ?? []).map(a => a.toLowerCase()),
        severity: input.severity ?? 'warn',
        status: input.status ?? 'active',
        ...(input.app_ref ? { app_ref: input.app_ref } : {}),
        reported_by: who.principal,
        created: (existing?.value as LearnedPitfallValue | null)?.created ?? now.toISOString(),
        updated: now.toISOString(),
        ...stamp,
    };
    const visibility = input.share === true ? 'public' : input.share === false ? 'owner' : (existing?.visibility ?? 'owner');
    const tags = ['knowledge-entry', 'pitfall', `model:${normModel}`, ...value.applies_to.map(a => `applies:${a}`)];

    // The entry is a memory record, so it answers to memory's rules: the archive guard, the key and
    // value-size ceilings, the byte quota. Written into whichever of the owner's identities already
    // holds the key, so an update never forks a second copy.
    const written = await writeMemoryRecord({ storage, config }, {
        principal: who.principal,
        targetGaii: existing?.ownerGaii ?? who.principal,
        scopes: who.scopes,
        roles: who.roles,
    }, {
        key, value, visibility: visibility as MemoryRecord['visibility'], tags,
        pipeline: 'appdev.pitfall_report',
        ownerScoped: true,
    });
    if (!written.ok) return { ok: false, status: written.status, code: written.code, message: written.message };
    await upsertPitfallManifest(storage, config, who.principal, key, input.title);
    return {
        ok: true, key, category: cat, slug: slg,
        updated: !!existing, version: (existing?.version ?? 0) + 1, visibility,
        ...stamp,
    };
}

/** Delete one of the caller's own entries (record + manifest ref). */
export async function deletePitfallEntry(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    category: string, slug: string,
): Promise<boolean> {
    const key = pitfallEntryKey(category, slug);
    const existing = await findOwnEntry(storage, config, callerGaii, key);
    if (!existing) return false;
    await storage.deleteMemory(existing.ownerGaii, key);
    await upsertPitfallManifest(storage, config, callerGaii, key, '', true);
    // The record and the manifest both changed, so every screen holding the list is out of date.
    // The MCP tool used to emit this and the REST door did not, which is how a browser delete left
    // the entry visible until a reload.
    emitChange('memory');
    return true;
}
