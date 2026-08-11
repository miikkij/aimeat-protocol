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
 *   v1.2.0 -- 2026-08-11 -- The delete calls services/appdev-kb.ts deletePitfallEntry(), the same
 *     function the REST door calls, instead of repeating the record delete and the manifest
 *     cleanup here. The live update moved into that function, so both doors now emit it.
 *   v1.1.0 -- 2026-08-11 -- The entry write goes through services/memory-write.ts: archive guard,
 *     value-size and key ceilings, byte quota and overage. Every {category, slug} is a new key on
 *     a tool built to be called repeatedly, and nothing bounded that.
 *   Limits raised -- 2026-07-30 -- symptom to 10 000, resolution to 40 000.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 4): report=upsert (+status outdated,
 *     +share→public), paginated merged list with facets, delete with manifest cleanup.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { getAppdevPitfalls } from '../data/appdev-pitfalls.js';
import { writeMemoryRecord } from '../services/memory-write.js';
import {
    PITFALL_PACKAGE_ID, PITFALL_PREFIX, PITFALL_MANIFEST_KEY, PITFALL_SLUG_RE, slugifyKb,
    listOwnerScopeMemory as kbListOwnerScope, ownIdentitySet as kbOwnIdentitySet,
    findOwnEntry as kbFindOwnEntry, upsertPitfallManifest,
    pitfallEntryKey, deletePitfallEntry,
    type LearnedPitfallValue,
} from '../services/appdev-kb.js';

export { PITFALL_PACKAGE_ID };

const SEVERITIES = ['info', 'warn', 'critical'] as const;
const SEV_RANK: Record<string, number> = { critical: 0, warn: 1, info: 2 };

type PitfallEntryValue = LearnedPitfallValue;

function slugify(s: string): string { return slugifyKb(s); }

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
    /** The session's own scopes, for the shared memory write in the report tool. */
    sessionScopes: string[] = [],
): void {
    const agentGaii = getAgentGaii();

    const listOwnerScopeMemory = (opts: { prefix?: string; tags?: string[] }) =>
        kbListOwnerScope(storage, config, agentGaii, opts);
    const ownIdentitySet = () => kbOwnIdentitySet(storage, config, agentGaii);
    const findOwnEntry = (key: string) => kbFindOwnEntry(storage, config, agentGaii, key);
    const upsertManifest = (entryKey: string, title: string, remove = false) =>
        upsertPitfallManifest(storage, config, agentGaii, entryKey, title, remove);

    // ── aimeat_appdev_pitfall_report — upsert one learned pitfall ──
    mcp.tool(
        'aimeat_appdev_pitfall_report',
        descriptionFor('aimeat_appdev_pitfall_report'),
        {
            model: z.string().min(1).max(64).describe('REQUIRED: YOUR OWN model id — the model that hit/solved this (e.g. claude-fable-5, kimi-k2.7-code). Self-identify from your own configuration, never ask the user. Indicative attribution'),
            category: z.string().min(1).max(40).describe('Kebab-case category, e.g. auth, ext, cortex, realtime, mobile, publish, ai, data'),
            title: z.string().min(3).max(160).describe('Short imperative title of the pitfall'),
            symptom: z.string().min(5).max(10_000).describe('What the builder observes when hitting it'),
            resolution: z.string().min(5).max(40_000).describe('What to do instead — the better way'),
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
            if (!PITFALL_SLUG_RE.test(cat) || !PITFALL_SLUG_RE.test(slg)) {
                return { content: [{ type: 'text' as const, text: 'Invalid category/slug — use kebab-case (a-z, 0-9, dashes)' }], isError: true };
            }
            const key = pitfallEntryKey(cat, slg);
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

            // The entry is a memory record, so it answers to memory's rules. Writing it straight to
            // storage meant no archive guard ("this is finished, stop changing it" held on the REST
            // door and not on the tool that writes these most), no key ceiling — every distinct
            // {category, slug} is a NEW key on a tool designed to be called repeatedly, which is
            // exactly the unbounded-key shape the memory audit exists to catch — no value-size
            // ceiling, and no byte quota or overage charge, so the space was consumed and nobody
            // paid for it.
            const written = await writeMemoryRecord({ storage, config }, {
                principal: agentGaii,
                targetGaii: existing?.ownerGaii ?? agentGaii,
                scopes: sessionScopes,
                roles: ['agent'],
            }, {
                key, value, visibility, tags,
                pipeline: 'mcp.appdev_pitfall_report',
                ownerScoped: true,
            });
            if (!written.ok) {
                return { content: [{ type: 'text' as const, text: `${written.code}: ${written.message}` }], isError: true };
            }
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
                const own = await listOwnerScopeMemory({ prefix: PITFALL_PREFIX, tags: ['pitfall'] });
                for (const rec of own) {
                    if (rec.key === PITFALL_MANIFEST_KEY) continue;
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
                const { items } = await storage.listAllMemory({ prefix: PITFALL_PREFIX, visibility: 'public', limit: 500 });
                for (const rec of items) {
                    if (rec.key === PITFALL_MANIFEST_KEY) continue;
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
            // The delete itself (record + manifest ref + live update) is deletePitfallEntry, the
            // same function DELETE /v1/appdev/pitfalls/learned/:category/:slug calls. This tool had
            // its own copy of all three steps, and the two had already drifted on the third.
            const key = pitfallEntryKey(category, slug);
            const deleted = await deletePitfallEntry(storage, config, agentGaii, category, slug);
            if (!deleted) {
                return { content: [{ type: 'text' as const, text: `Pitfall entry not found: ${key}` }], isError: true };
            }
            emitResourceUpdated(agentGaii, `aimeat://knowledge/${PITFALL_PACKAGE_ID}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, key }, null, 2) }] };
        },
    );
}
