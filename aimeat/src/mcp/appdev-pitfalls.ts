/**
 * @file appdev-pitfalls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.4.0 -- 2026-09-29 -- TARGET-082 V4: the list reads own and shared learned entries through
 *     services/appdev-kb.ts ownPitfallRecords() and sharedPitfallRecords() with the session's
 *     classification reader, so an entry this agent may not see is left out and a warning-labelled
 *     one carries `classificationWarning`. The tool's own copy of the shared-entry query is gone.
 *   v1.3.1 -- 2026-09-13 -- A shared entry in the list carries its `owner`, and the hint names the
 *     doors that can open one entry instead of aimeat_knowledge_get, which could not. Every report
 *     stamps `verified_at` / `verified_version`, and every row of the list shows them (curated too).
 *   v1.3.0 -- 2026-09-03 -- The list's filter, sort, facet and page step is services/appdev-kb.ts
 *     filterPitfalls(), shared with the REST route the AppDev page reads; the tool keeps merging
 *     the curated registry in before it. Same output shape.
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
import { descriptionFor } from '../tool-catalog/shape.js';
import { getAppdevPitfalls } from '../data/appdev-pitfalls.js';
import {
    PITFALL_PACKAGE_ID,
    ownPitfallRecords, sharedPitfallRecords,
    pitfallEntryKey, deletePitfallEntry, filterPitfalls, reportLearnedPitfall,
    type LearnedPitfallValue, type PitfallLike,
} from '../services/appdev-kb.js';
import { getSoftwareVersion } from '../utils/version.js';
import { readerForAgent } from '../services/classification/reader.js';
import { classificationWarningOf } from '../services/classification/present-memory.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export { PITFALL_PACKAGE_ID };

type PitfallEntryValue = LearnedPitfallValue;

function asIndexEntry(source: 'learned' | 'learned-shared', rec: MemoryRecord): Record<string, unknown> {
    const v = rec.value as Partial<PitfallEntryValue> | null;
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

    // ── aimeat_appdev_pitfall_report — upsert one learned pitfall ──
    mcp.tool(
        'aimeat_appdev_pitfall_report',
        descriptionFor('aimeat_appdev_pitfall_report'),
        zodShapeFor('aimeat_appdev_pitfall_report'),
        annotationsFor('aimeat_appdev_pitfall_report'),
        async ({ model, category, title, symptom, resolution, slug, applies_to, severity, status, app_ref, share }) => {
            // The whole report is services/appdev-kb.ts reportLearnedPitfall(), the same function
            // POST /v1/appdev/pitfalls/learned calls and both connector doors reach through it. The
            // entry is a memory record and answers to memory's rules (archive guard, key and size
            // ceilings, byte quota) inside that function, and it stamps the verification.
            const r = await reportLearnedPitfall(storage, config,
                { principal: agentGaii, scopes: sessionScopes, roles: ['agent'] },
                { model, category, title, symptom, resolution, slug, applies_to, severity, status, app_ref, share },
                getSoftwareVersion());
            if (!r.ok) {
                return { content: [{ type: 'text' as const, text: `${r.code}: ${r.message}` }], isError: true };
            }
            emitResourceUpdated(agentGaii, `aimeat://knowledge/${PITFALL_PACKAGE_ID}`);
            const { key, category: cat, slug: slg, visibility } = r;

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key, category: cat, slug: slg,
                        updated: r.updated, version: r.version,
                        visibility, shared: visibility === 'public',
                        verified_at: r.verified_at, verified_version: r.verified_version,
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
            // Learned entries are user-written memory records, so what this agent is shown is the
            // classification reader's decision (services/classification/reader.ts, TARGET-082).
            const reader = readerForAgent({ storage, config }, agentGaii, sessionScopes);

            if (effScope === 'own' || effScope === 'all') {
                for (const rec of await ownPitfallRecords(storage, config, reader)) {
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
                        verified_at: p.verifiedAt ?? null, verified_version: p.verifiedVersion ?? null,
                        detail_url: `/v1/appdev/pitfalls/${p.id}`,
                    });
                }
                // Other owners' public-shared learned entries (own entries come from the own branch).
                for (const rec of await sharedPitfallRecords(storage, config, reader)) {
                    entries.push(asIndexEntry('learned-shared', rec));
                }
            }

            // The filter, sort, facet and page step is filterPitfalls(), the same one the profile
            // page's REST route calls. Facets here count what the filter left, as they always did.
            const page = filterPitfalls(entries as PitfallLike[], {
                status: wantStatus, category, model: normModel, applies_to, sort: 'severity', limit, offset,
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        pitfalls: page.pitfalls,
                        total: page.total,
                        offset: page.offset,
                        limit: page.limit,
                        facets: page.filtered_facets,
                        // aimeat_knowledge_get was named here and answers "Package not found" for any
                        // agent that did not write the package manifest itself: it reads one namespace.
                        hint: 'One full learned entry: aimeat_memory_read {key, owner_scope: true} for your own, aimeat_memory_read_public {gaii: owner, key} for a shared one. Curated detail: GET /v1/appdev/pitfalls/{id}.',
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_appdev_pitfall_delete — remove one learned entry (+manifest ref) ──
    mcp.tool(
        'aimeat_appdev_pitfall_delete',
        descriptionFor('aimeat_appdev_pitfall_delete'),
        zodShapeFor('aimeat_appdev_pitfall_delete'),
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
