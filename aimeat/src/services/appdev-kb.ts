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
 * @structure listOwnerScopeMemory · findOwnEntry · listLearnedPitfalls · setPitfallFlags ·
 *   deletePitfallEntry · upsertPitfallManifest · pitfallEntryKey · PITFALL_* constants
 * @usage import { listLearnedPitfalls, setPitfallFlags } from './appdev-kb.js';
 * @version-history
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
    const ownIds = await ownIdentitySet(storage, config, callerGaii);
    const { items } = await storage.listAllMemory({ prefix: PITFALL_PREFIX, visibility: 'public', limit: 500 });
    const shared = items
        .filter(rec => rec.key !== PITFALL_MANIFEST_KEY)
        .filter(rec => !ownIds.has(rec.ownerGaii))
        .filter(rec => (rec.tags ?? []).includes('pitfall'))
        .map(rec => toEntry(rec, 'shared'));
    return [...own, ...shared];
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
