/**
 * @file app-template-proposals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for agent-proposed app templates (AppDev KB Phase 6):
 *   aimeat_app_template_propose (upsert; call after a successful publish, model mandatory),
 *   aimeat_app_template_list, aimeat_app_template_get (adds the source app's LIVE commerce
 *   fields + a fork-vs-scaffold instruction so a buyer/next-builder knows how to start),
 *   aimeat_app_template_delete. Thin wrappers over services/app-template-proposals.ts.
 * @structure registerAppTemplateProposalTools()
 * @usage registerAppTemplateProposalTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-11 — _get's source_app carries `toll_morsels` (the app's pacing amount; a morsel is pacing,
 *     not a price), `price_morsels` as its deprecated mirror until 4.0.0, and how_to_start names the take.
 *   2026-10-06 — A memory ceiling refusal reads `QUOTA_EXCEEDED: ...` (secaudit 2026-10 last items, F3).
 *   2026-10-06 — aimeat_app_template_propose takes the catalog's schema, which now carries the bounds
 *     this file held; POST /v1/appdev/templates validates with the same one (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-09-20 — _get and _list also answer for a genre that grew out of an app.
 *   v1.2.0 — 2026-09-19 — _get takes `part`, for a shipped template too large for one answer.
 *   v1.1.0 — 2026-09-18 — _get and _list also answer for the templates the node ships (shells,
 *     components, use cases). They read agent proposals only, so the shell every build text names
 *     as the starting point could not be read over MCP at all.
 *   Limits raised -- 2026-07-30 -- description/rationale/notes to 10 000, reuse_notes to 40 000.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6).
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { logger } from '../utils/logger.js';
import {
    proposeTemplate, listTemplateProposals, getTemplateProposal, deleteTemplateProposal,
} from '../services/app-template-proposals.js';
import { templateAnswer, templateIndex, unknownTemplateMessage } from '../services/node-templates.js';
import { toolError } from './tool-error.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { appToll } from '../services/app-pacing.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_DEPRECATION } from '../config-pacing.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const errText = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true as const });

export function registerAppTemplateProposalTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();

    mcp.registerTool(
        'aimeat_app_template_propose',
        {
            description: descriptionFor('aimeat_app_template_propose'),
            inputSchema: zodShapeFor('aimeat_app_template_propose'),
            annotations: annotationsFor('aimeat_app_template_propose'),
        },
        async (input) => {
            const result = await proposeTemplate(storage, config, agentGaii, input);
            // A memory ceiling refusal carries its code (F3): `QUOTA_EXCEEDED: ...`, as REST answers.
            if ('error' in result) return errText(result.code ? `${result.code}: ${result.error}` : result.error);
            return text({ id: result.manifest.id, updated: result.updated, key: `template.catalog.${result.manifest.id}.manifest` });
        },
    );

    mcp.registerTool(
        'aimeat_app_template_list',
        {
            description: descriptionFor('aimeat_app_template_list'),
            inputSchema: zodShapeFor('aimeat_app_template_list'),
            annotations: annotationsFor('aimeat_app_template_list'),
        },
        async () => {
            const proposals = await listTemplateProposals(storage, config, agentGaii);
            return text({
                // What the node ships, without content: aimeat_app_template_get { id } returns one
                // with its file. The same index GET /v1/app-templates serves.
                node_templates: await templateIndex(storage, config),
                templates: proposals.map(p => ({
                    id: p.id, title: p.title, tier: p.tier, tags: p.tags,
                    model: p.model, start_mode: p.startMode,
                    derived_from: p.derivedFrom, updated: p.updatedAt,
                    proofs: (p.proofs ?? []).length,
                })),
                total: proposals.length,
            });
        },
    );

    mcp.registerTool(
        'aimeat_app_template_get',
        {
            description: descriptionFor('aimeat_app_template_get'),
            inputSchema: zodShapeFor('aimeat_app_template_get'),
            annotations: annotationsFor('aimeat_app_template_get'),
        },
        async ({ id, part }) => {
            const found = await getTemplateProposal(storage, config, agentGaii, id);
            if (!found) {
                // The templates the node ships: the shells, the components, the use cases. Every
                // build text says "start from the shell at GET /v1/app-templates", and a chat
                // connected over MCP cannot make that call: a cold-agent build run asked this
                // tool for `shell-pure-client` and was told it did not exist (2026-09-18). Same
                // registry and same fields as GET /v1/app-templates/:id (services/node-templates.ts).
                // And a genre that grew out of an app, while that app stands (design-book/grown-genre.ts).
                const shipped = await templateAnswer(storage, config, id, part);
                if (!shipped) return toolError('NOT_FOUND', unknownTemplateMessage(id));
                return typeof shipped.part_error === 'string' ? toolError('INVALID_INPUT', shipped.part_error) : text(shipped);
            }
            const m = found.manifest;

            // Live commerce/fork state of the source app so the next builder knows how to start.
            const sourceOwnerGhii = `${m.derivedFrom.owner}@${config.nodeId}`;
            const app = await storage.getApp(sourceOwnerGhii, m.derivedFrom.filename).catch(err => { logger.warn('proofs: continuing after a suppressed failure', { error: String(err) }); return null; });
            // The source's pacing amount: morsels taking the app once moves, never a price.
            const tollMorsels = appToll(app?.manifest);
            const source_app = app ? {
                exists: true,
                forkable: app.forkable ?? false,
                toll_morsels: tollMorsels,
                ...(legacyMorselFieldsLive()
                    ? { price_morsels: tollMorsels, deprecated: { price_morsels: MORSEL_PRICE_DEPRECATION } }
                    : {}),
                license_type: (app.manifest as { licenseType?: string } | undefined)?.licenseType ?? null,
                version: app.versionNumber,
                download_url: `/v1/apps/${encodeURIComponent(m.derivedFrom.owner)}/${encodeURIComponent(m.derivedFrom.filename)}`,
            } : { exists: false };

            // v1 proposals are owner-scoped, so the reader IS the source owner (same-owner fork
            // always passes the gate). The note covers future/other-party readers: an app with a
            // pacing amount is taken once (POST /v1/app-store/purchase) before the fork gate opens.
            const how_to_start = !app
                ? 'Source app is gone — scaffold from reuse_notes.'
                : m.startMode === 'scaffold'
                    ? 'Scaffold a fresh app from reuse_notes (do not fork).'
                    : tollMorsels > 0
                        ? `Fork the source app (aimeat_app_fork) and adapt per reuse_notes. Another owner takes the app first (POST /v1/app-store/purchase, ${tollMorsels} morsels of pacing) — the fork gate enforces it.`
                        : 'Fork the source app (aimeat_app_fork) and adapt per reuse_notes.';

            return text({ ...m, source_app, how_to_start });
        },
    );

    mcp.registerTool(
        'aimeat_app_template_delete',
        {
            description: descriptionFor('aimeat_app_template_delete'),
            inputSchema: zodShapeFor('aimeat_app_template_delete'),
            annotations: annotationsFor('aimeat_app_template_delete'),
        },
        async ({ id }) => {
            const ok = await deleteTemplateProposal(storage, config, agentGaii, id);
            if (!ok) return errText(`Template proposal not found: ${id}`);
            return text({ deleted: true, id });
        },
    );
}
