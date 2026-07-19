/**
 * @file appdev-pitfalls.ts
 * @description MCP tools for the LEARNED appdev-pitfall knowledge base — what AI builders
 *   learn while building apps ON AIMEAT, model-attributed and owner-scoped with per-entry
 *   opt-in platform sharing. Entries live in the reserved knowledge package
 *   `appdev-pitfalls` (keys packages/appdev-pitfalls/{category}/{slug}) so the generic
 *   aimeat_knowledge_* tools can read them too. The LIST tool merges three sources by scope:
 *   own learned entries, the curated registry (data/appdev-pitfalls.ts), and other owners'
 *   public-shared entries. Model attribution is MANDATORY per entry and INDICATIVE only.
 * @structure registerAppdevPitfallTools() — aimeat_appdev_pitfall_report / _list / _delete
 * @usage registerAppdevPitfallTools(mcp, storage, config, () => agentGaii, emitResourceUpdated);
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 4): report=upsert (+status outdated,
 *     +share→public), paginated merged list with facets, delete with manifest cleanup.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { getAppdevPitfalls } from '../data/appdev-pitfalls.js';

export const PITFALL_PACKAGE_ID = 'appdev-pitfalls';
const PREFIX = `packages/${PITFALL_PACKAGE_ID}/`;
const MANIFEST_KEY = `packages/${PITFALL_PACKAGE_ID}/manifest`;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEVERITIES = ['info', 'warn', 'critical'] as const;
const SEV_RANK: Record<string, number> = { critical: 0, warn: 1, info: 2 };

interface PitfallEntryValue {
    title: string;
    symptom: string;
    resolution: string;
    /** Self-reported primary model that hit/solved this. Indicative, never audited. */
    model: string;
    category: string;
    slug: string;
    applies_to: string[];
    severity: (typeof SEVERITIES)[number];
    status: 'active' | 'outdated';
    app_ref?: string;
    reported_by: string;
    created: string;
    updated: string;
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'entry';
}

function asIndexEntry(source: 'learned' | 'learned-shared', rec: MemoryRecord): Record<string, unknown> {
    const v = rec.value as Partial<PitfallEntryValue> | null;
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
        shared: rec.visibility === 'public',
    };
}

export function registerAppdevPitfallTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Owner-scope aggregation (GHII + every same-owner agent), same pattern as knowledge.ts. */
    async function listOwnerScopeMemory(opts: { prefix?: string; tags?: string[] }): Promise<MemoryRecord[]> {
        const parsed = parseGAII(agentGaii);
        const owner = parsed?.owner;
        if (!owner) return storage.listMemory(agentGaii, opts);
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

    function ownIdentitySet(): Promise<Set<string>> {
        const parsed = parseGAII(agentGaii);
        const owner = parsed?.owner;
        if (!owner) return Promise.resolve(new Set([agentGaii]));
        return storage.getAgentsByOwner(owner).then(agents =>
            new Set([`${owner}@${config.nodeId}`, ...agents.map(a => a.gaii)]));
    }

    async function findOwnEntry(key: string): Promise<MemoryRecord | null> {
        const rows = await listOwnerScopeMemory({ prefix: key });
        return rows.find(r => r.key === key) ?? null;
    }

    async function upsertManifest(entryKey: string, title: string, remove = false): Promise<void> {
        const now = new Date().toISOString();
        const existing = await findOwnEntry(MANIFEST_KEY);
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
            key: MANIFEST_KEY,
            ownerGaii: existing?.ownerGaii ?? agentGaii,
            value,
            visibility: existing?.visibility ?? 'owner',
            tags: existing?.tags ?? ['knowledge-package', 'pitfall'],
            ttlHours: null,
            version: (existing?.version ?? 0) + 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }

    // ── aimeat_appdev_pitfall_report — upsert one learned pitfall ──
    mcp.tool(
        'aimeat_appdev_pitfall_report',
        descriptionFor('aimeat_appdev_pitfall_report'),
        {
            model: z.string().min(1).max(64).describe('REQUIRED: the primary LLM model that hit/solved this (e.g. claude-haiku-4.5, kimi-k2.6). Self-reported, indicative attribution'),
            category: z.string().min(1).max(40).describe('Kebab-case category, e.g. auth, ext, cortex, realtime, mobile, publish, ai, data'),
            title: z.string().min(3).max(160).describe('Short imperative title of the pitfall'),
            symptom: z.string().min(5).max(2000).describe('What the builder observes when hitting it'),
            resolution: z.string().min(5).max(4000).describe('What to do instead — the better way'),
            slug: z.string().max(64).optional().describe('Stable kebab-case slug; same {category, slug} UPDATES the entry (better wording replaces old). Derived from the title when omitted'),
            applies_to: z.array(z.string().max(20)).max(8).optional().describe('Areas this applies to (app, auth, ext, cortex, iam, realtime, ai, mobile, publish)'),
            severity: z.enum(SEVERITIES).optional().describe('Default warn'),
            status: z.enum(['active', 'outdated']).optional().describe('Mark outdated when models no longer stumble on it (kept, hidden from default lists)'),
            app_ref: z.string().max(200).optional().describe('Related app, e.g. owner/filename.html'),
            share: z.boolean().optional().describe('true = publish this entry platform-wide (public visibility) so other owners\' agents learn from it; default = private to your owner scope'),
        },
        annotationsFor('aimeat_appdev_pitfall_report'),
        async ({ model, category, title, symptom, resolution, slug, applies_to, severity, status, app_ref, share }) => {
            const cat = slugify(category);
            const slg = slug ? slug.toLowerCase() : slugify(title);
            if (!SLUG_RE.test(cat) || !SLUG_RE.test(slg)) {
                return { content: [{ type: 'text' as const, text: 'Invalid category/slug — use kebab-case (a-z, 0-9, dashes)' }], isError: true };
            }
            const key = `${PREFIX}${cat}/${slg}`;
            const now = new Date().toISOString();
            const existing = await findOwnEntry(key);
            const normModel = model.trim().toLowerCase();

            const value: PitfallEntryValue = {
                title, symptom, resolution,
                model: normModel,
                category: cat, slug: slg,
                applies_to: (applies_to ?? []).map(a => a.toLowerCase()),
                severity: severity ?? 'warn',
                status: status ?? 'active',
                ...(app_ref ? { app_ref } : {}),
                reported_by: agentGaii,
                created: (existing?.value as PitfallEntryValue | null)?.created ?? now,
                updated: now,
            };
            const visibility = share === true ? 'public' : share === false ? 'owner' : (existing?.visibility ?? 'owner');
            const tags = ['knowledge-entry', 'pitfall', `model:${normModel}`, ...value.applies_to.map(a => `applies:${a}`)];

            await storage.setMemory({
                key,
                ownerGaii: existing?.ownerGaii ?? agentGaii,
                value,
                visibility,
                tags,
                ttlHours: null,
                version: (existing?.version ?? 0) + 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });
            await upsertManifest(key, title);
            emitResourceUpdated(agentGaii, `aimeat://knowledge/${PITFALL_PACKAGE_ID}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key, category: cat, slug: slg,
                        updated: !!existing, version: (existing?.version ?? 0) + 1,
                        visibility, shared: visibility === 'public',
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_appdev_pitfall_list — merged, paginated, faceted ──
    mcp.tool(
        'aimeat_appdev_pitfall_list',
        descriptionFor('aimeat_appdev_pitfall_list'),
        {
            scope: z.enum(['own', 'platform', 'all']).optional().describe('own = your owner bubble; platform = curated registry + other owners\' shared entries; all = both (default)'),
            category: z.string().max(40).optional(),
            model: z.string().max(64).optional().describe('Filter learned entries to one model (e.g. claude-haiku-4.5)'),
            applies_to: z.string().max(20).optional().describe('Filter by area (app, auth, ext, cortex, iam, realtime, ai, mobile, publish)'),
            status: z.enum(['active', 'outdated', 'all']).optional().describe('Default active (outdated hidden)'),
            limit: z.number().int().min(1).max(100).optional().describe('Page size, default 25'),
            offset: z.number().int().min(0).optional().describe('Page start, default 0'),
        },
        annotationsFor('aimeat_appdev_pitfall_list'),
        async ({ scope, category, model, applies_to, status, limit, offset }) => {
            const effScope = scope ?? 'all';
            const wantStatus = status ?? 'active';
            const normModel = model?.trim().toLowerCase();
            const entries: Array<Record<string, unknown>> = [];

            if (effScope === 'own' || effScope === 'all') {
                const own = await listOwnerScopeMemory({ prefix: PREFIX, tags: ['pitfall'] });
                for (const rec of own) {
                    if (rec.key === MANIFEST_KEY) continue;
                    entries.push(asIndexEntry('learned', rec));
                }
            }
            if (effScope === 'platform' || effScope === 'all') {
                // Curated node registry — platform-level knowledge, always available.
                for (const p of getAppdevPitfalls({ includeOutdated: wantStatus !== 'active' })) {
                    entries.push({
                        source: 'curated', id: p.id, title: p.title, category: null, slug: p.id,
                        model: null, applies_to: p.appliesTo, severity: p.severity,
                        status: p.status ?? 'active', updated: p.updatedAt, shared: true,
                        detail_url: `/v1/appdev/pitfalls/${p.id}`,
                    });
                }
                // Other owners' public-shared learned entries.
                const ownIds = await ownIdentitySet();
                const { items } = await storage.listAllMemory({ prefix: PREFIX, visibility: 'public', limit: 500 });
                for (const rec of items) {
                    if (rec.key === MANIFEST_KEY) continue;
                    if (ownIds.has(rec.ownerGaii)) continue; // own entries come from the own branch
                    if (!(rec.tags ?? []).includes('pitfall')) continue;
                    entries.push(asIndexEntry('learned-shared', rec));
                }
            }

            let filtered = entries;
            if (wantStatus !== 'all') filtered = filtered.filter(e => e.status === wantStatus);
            if (category) filtered = filtered.filter(e => e.category === slugify(category) || e.id === category);
            if (normModel) filtered = filtered.filter(e => e.model === null || e.model === normModel);
            if (applies_to) filtered = filtered.filter(e => (e.applies_to as string[]).includes(applies_to.toLowerCase()));

            filtered.sort((a, b) => {
                const s = (SEV_RANK[a.severity as string] ?? 1) - (SEV_RANK[b.severity as string] ?? 1);
                if (s !== 0) return s;
                return String(b.updated ?? '').localeCompare(String(a.updated ?? ''));
            });

            const facets: { category: Record<string, number>; model: Record<string, number>; source: Record<string, number> } = { category: {}, model: {}, source: {} };
            for (const e of filtered) {
                const c = (e.category as string | null) ?? '(curated)';
                facets.category[c] = (facets.category[c] ?? 0) + 1;
                if (e.model) facets.model[e.model as string] = (facets.model[e.model as string] ?? 0) + 1;
                facets.source[e.source as string] = (facets.source[e.source as string] ?? 0) + 1;
            }

            const lim = limit ?? 25;
            const off = offset ?? 0;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        pitfalls: filtered.slice(off, off + lim),
                        total: filtered.length,
                        offset: off,
                        limit: lim,
                        facets,
                        hint: 'Full learned entries: aimeat_knowledge_get package_id=appdev-pitfalls. Curated detail: GET /v1/appdev/pitfalls/{id}.',
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_appdev_pitfall_delete — remove one learned entry (+manifest ref) ──
    mcp.tool(
        'aimeat_appdev_pitfall_delete',
        descriptionFor('aimeat_appdev_pitfall_delete'),
        {
            category: z.string().min(1).max(40),
            slug: z.string().min(1).max(64),
        },
        annotationsFor('aimeat_appdev_pitfall_delete'),
        async ({ category, slug }) => {
            const key = `${PREFIX}${slugify(category)}/${slug.toLowerCase()}`;
            const existing = await findOwnEntry(key);
            if (!existing) {
                return { content: [{ type: 'text' as const, text: `Pitfall entry not found: ${key}` }], isError: true };
            }
            await storage.deleteMemory(existing.ownerGaii, key);
            await upsertManifest(key, '', true);
            emitResourceUpdated(agentGaii, `aimeat://knowledge/${PITFALL_PACKAGE_ID}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, key }, null, 2) }] };
        },
    );
}
