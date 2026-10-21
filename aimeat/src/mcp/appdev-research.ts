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
 * @usage registerAppdevResearchTools(mcp, storage, config, () => agentGaii, caller);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-20 — SECURITY: takes the session's caller and hands the overview its view (principal and
 *     readsAsOwner), so an agent without memory:read-as-owner reads no private learned pitfall or
 *     template record of its owner or a sibling here (secaudit 2026-10, v56 shape).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.2 — 2026-09-29 — TARGET-082 V4: the overview is built with the session's classification
 *     reader (readerForAgent), so a record this agent may not see is left out.
 *   v1.0.1 — 2026-09-13 — The model parameter's description: it orders learned pitfalls, never filters.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { buildAppdevOverview } from '../services/appdev-overview.js';
import { readerForAgent } from '../services/classification/reader.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { readsAsOwner } from '../services/owner-scope-read.js';

export function registerAppdevResearchTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    /** The session's caller (register-all.ts), built per call: readsAsOwner reads the current scopes. */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    mcp.registerTool(
        'aimeat_appdev_overview',
        {
            description: descriptionFor('aimeat_appdev_overview'),
            inputSchema: zodShapeFor('aimeat_appdev_overview'),
            annotations: annotationsFor('aimeat_appdev_overview'),
        },
        async ({ model, sections }) => {
            // The owner-scope sections read as this agent may (memory:read-as-owner), as
            // GET /v1/appdev/overview reads them (secaudit 2026-10, v56 shape).
            const c = caller();
            const view = { principal: c.principal, readsAll: readsAsOwner(c) };
            const overview = await buildAppdevOverview(storage, config, readerForAgent({ storage, config }, agentGaii), { model, sections, view });
            return { content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }] };
        },
    );
}
