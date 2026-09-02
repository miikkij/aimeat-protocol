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
 * @structure listOwnerScopeMemory · findOwnEntry · listLearnedPitfalls · queryLearnedPitfalls ·
 *   filterPitfalls · pitfallFacets · setPitfallFlags · deletePitfallEntry · upsertPitfallManifest ·
 *   pitfallEntryKey · PITFALL_* constants
 * @usage import { listLearnedPitfalls, setPitfallFlags } from './appdev-kb.js';
 * @version-history
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
import { parseGAII } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';

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
}

export function slugifyKb(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'entry';
}

/** The address of one learned entry. Category is slugified, slug is taken as given (lowercased). */
export function pitfallEntryKey(category: string, slug: string): string {
    return `${PITFALL_PREFIX}${slugifyKb(category)}/${slug.toLowerCase()}`;
}

function ownerOf(callerGaii: string, _config: AimeatConfig): string | null {
    const parsed = parseGAII(callerGaii);
    if (parsed?.owner) return parsed.owner;
    if (callerGaii.includes('@') && !callerGaii.includes('#')) return callerGaii.split('@')[0];
    return null;
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
}

function toEntry(rec: MemoryRecord, source: 'own' | 'shared'): LearnedPitfallEntry {
    const v = rec.value as Partial<LearnedPitfallValue> | null;
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
    };
}

/** Other owners' public-shared entries, as full entries (source 'shared', owner set). */
async function listSharedByOthers(
    storage: Storage, config: AimeatConfig, callerGaii: string,
): Promise<LearnedPitfallEntry[]> {
    const ownIds = await ownIdentitySet(storage, config, callerGaii);
    const { items } = await storage.listAllMemory({ prefix: PITFALL_PREFIX, visibility: 'public', limit: 500 });
    return items
        .filter(rec => rec.key !== PITFALL_MANIFEST_KEY)
        .filter(rec => !ownIds.has(rec.ownerGaii))
        .filter(rec => (rec.tags ?? []).includes('pitfall'))
        .map(rec => toEntry(rec, 'shared'));
}

/**
 * Full-body learned-pitfall listing for the UI: the caller's own entries (any visibility)
 * and, with includeShared, other owners' public entries. Curated registry entries are NOT
 * merged here — the UI reads them from GET /v1/appdev/pitfalls directly.
 */
export async function listLearnedPitfalls(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    opts: { includeShared?: boolean } = {},
): Promise<LearnedPitfallEntry[]> {
    const own = (await listOwnerScopeMemory(storage, config, callerGaii, { prefix: PITFALL_PREFIX, tags: ['pitfall'] }))
        .filter(r => r.key !== PITFALL_MANIFEST_KEY)
        .map(r => toEntry(r, 'own'));
    if (!opts.includeShared) return own;
    return [...own, ...await listSharedByOthers(storage, config, callerGaii)];
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
    out = [...out].sort(query.sort === 'severity'
        ? (a, b) => ((SEVERITY_RANK[a.severity ?? 'warn'] ?? 1) - (SEVERITY_RANK[b.severity ?? 'warn'] ?? 1)) || byUpdated(a, b)
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
    storage: Storage, config: AimeatConfig, callerGaii: string,
    query: PitfallListQuery & { includeShared?: boolean },
) {
    const own = await listLearnedPitfalls(storage, config, callerGaii);
    const shared = await listSharedByOthers(storage, config, callerGaii);
    const scope = query.includeShared ? [...own, ...shared] : own;
    return { ...filterPitfalls(scope, query), community: shared.length };
}

/** Toggle the share (visibility) and/or status flags on one of the caller's own entries. */
export async function setPitfallFlags(
    storage: Storage, config: AimeatConfig, callerGaii: string,
    category: string, slug: string,
    flags: { share?: boolean; status?: 'active' | 'outdated' },
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
