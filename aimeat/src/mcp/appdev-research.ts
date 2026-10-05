/**
 * @file appdev-research.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP research surface for building apps ON AIMEAT: aimeat_appdev_overview —
 *   the one call an agent makes BEFORE framing a build. Returns compact indexes (owner's
 *   apps, library packs with per-model proofs, T1/T2/T3 templates, skills, curated +
 *   learned pitfalls, template proposals) with drill-down pointers; calls the service
 *   directly (no HTTP hop).
 * @structure registerAppdevResearchTools() — aimeat_appdev_overview
 * @usage registerAppdevResearchTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.2 — 2026-09-29 — TARGET-082 V4: the overview is built with the session's classification
 *     reader (readerForAgent), so a record this agent may not see is left out.
 *   v1.0.1 — 2026-09-13 — The model parameter's description: it orders learned pitfalls, never filters.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { buildAppdevOverview } from '../services/appdev-overview.js';
import { readerForAgent } from '../services/classification/reader.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
        zodShapeFor('aimeat_appdev_overview'),
        annotationsFor('aimeat_appdev_overview'),
        async ({ model, sections }) => {
            const overview = await buildAppdevOverview(storage, config, readerForAgent({ storage, config }, agentGaii), { model, sections });
            return { content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }] };
        },
    );
}
