/**
 * @file appdev-research.ts
 * @description MCP research surface for building apps ON AIMEAT: aimeat_appdev_overview —
 *   the one call an agent makes BEFORE framing a build. Returns compact indexes (owner's
 *   apps, library packs with per-model proofs, T1/T2/T3 templates, skills, curated +
 *   learned pitfalls, template proposals) with drill-down pointers; calls the service
 *   directly (no HTTP hop).
 * @structure registerAppdevResearchTools() — aimeat_appdev_overview
 * @usage registerAppdevResearchTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { buildAppdevOverview, OVERVIEW_SECTIONS } from '../services/appdev-overview.js';

export function registerAppdevResearchTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool(
        'aimeat_appdev_overview',
        descriptionFor('aimeat_appdev_overview'),
        {
            model: z.string().max(64).optional().describe('Your primary model (e.g. claude-haiku-4.5) — marks packs proven for it and filters learned pitfalls. Indicative'),
            sections: z.array(z.enum(OVERVIEW_SECTIONS)).optional().describe('Subset of sections to fetch (default all): apps, library_packs, app_templates, skills, pitfalls_curated, pitfalls_learned, template_proposals'),
        },
        annotationsFor('aimeat_appdev_overview'),
        async ({ model, sections }) => {
            const overview = await buildAppdevOverview(storage, config, agentGaii, { model, sections });
            return { content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }] };
        },
    );
}
