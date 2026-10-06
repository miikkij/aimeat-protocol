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
 * @usage registerAppdevPitfallTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, scopes, caller);
 * @version-history
 *   2026-10-06 — The list is services/appdev-kb.ts pitfallIndex(), which GET /v1/appdev/pitfalls/index
 *     answers with too, and takes the catalog's schema (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
    PITFALL_PACKAGE_ID,
    pitfallEntryKey, deletePitfallEntry, pitfallIndex, reportLearnedPitfall,
} from '../services/appdev-kb.js';
import { getSoftwareVersion } from '../utils/version.js';
import { readerForAgent } from '../services/classification/reader.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { agentSessionCaller, type CallerContext } from '../services/caller-context.js';

export { PITFALL_PACKAGE_ID };

export function registerAppdevPitfallTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    /** The session's own scopes, for the shared memory write in the report tool. */
    sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts). register-all.ts passes it; a caller that
     *  does not (test/unit/classification-knowledge.test.ts) gets the same agent built from the
     *  arguments above. */
    caller: () => CallerContext = () => agentSessionCaller(getAgentGaii(), '', sessionScopes, config.nodeId, storage),
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
                caller().principalView,
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
        zodShapeFor('aimeat_appdev_pitfall_list'),
        annotationsFor('aimeat_appdev_pitfall_list'),
        async (query) => {
            // The merge, filter and page is services/appdev-kb.ts pitfallIndex(), which
            // GET /v1/appdev/pitfalls/index answers with too. Learned entries are user-written memory
            // records, so what this agent is shown is the classification reader's decision.
            const index = await pitfallIndex(storage, config, readerForAgent({ storage, config }, agentGaii, sessionScopes), query);
            return { content: [{ type: 'text' as const, text: JSON.stringify(index, null, 2) }] };
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
