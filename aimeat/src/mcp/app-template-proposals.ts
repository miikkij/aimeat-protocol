/**
 * @file app-template-proposals.ts
 * @description MCP tools for agent-proposed app templates (AppDev KB Phase 6):
 *   aimeat_app_template_propose (upsert; call after a successful publish, model mandatory),
 *   aimeat_app_template_list, aimeat_app_template_get (adds the source app's LIVE commerce
 *   fields + a fork-vs-scaffold instruction so a buyer/next-builder knows how to start),
 *   aimeat_app_template_delete. Thin wrappers over services/app-template-proposals.ts.
 * @structure registerAppTemplateProposalTools()
 * @usage registerAppTemplateProposalTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   Limits raised -- 2026-07-30 -- description/rationale/notes to 10 000, reuse_notes to 40 000.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { logger } from '../utils/logger.js';
import {
    proposeTemplate, listTemplateProposals, getTemplateProposal, deleteTemplateProposal,
} from '../services/app-template-proposals.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const errText = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true as const });

export function registerAppTemplateProposalTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool(
        'aimeat_app_template_propose',
        descriptionFor('aimeat_app_template_propose'),
        {
            id: z.string().min(1).max(64).describe('Stable kebab-case template id; proposing the same id again UPDATES the proposal'),
            title: z.string().min(3).max(160),
            description: z.string().min(5).max(10_000),
            derived_from: z.object({
                owner: z.string().min(1).describe('Your own owner name'),
                filename: z.string().min(1).describe('The published app this template distills'),
            }),
            tier: z.enum(['T1', 'T2', 'T3']).describe('T1 pure client · T2 +cortex · T3 +extension'),
            reuse_notes: z.string().min(10).max(40_000).describe('What generalizes: the parts a next build should copy/keep'),
            model: z.string().min(1).max(64).describe('REQUIRED: YOUR OWN model id — the model that built the source app. Self-identify, never ask the user (indicative)'),
            tags: z.array(z.string().max(30)).max(12).optional(),
            start_mode: z.enum(['fork', 'scaffold', 'either']).optional().describe('How the next build should start (default either)'),
            start_mode_rationale: z.string().max(10_000).optional(),
            model_notes: z.array(z.object({
                model: z.string().max(64), notes: z.string().max(10_000), evidence: z.string().max(10_000).optional(),
            })).max(10).optional().describe('Per-model observations (which models handle this well/badly)'),
            packs: z.array(z.string().max(40)).max(20).optional().describe('Library-pack ids the template relies on'),
            composes: z.array(z.string().max(40)).max(20).optional().describe('Component template ids it composes'),
        },
        annotationsFor('aimeat_app_template_propose'),
        async (input) => {
            const result = await proposeTemplate(storage, config, agentGaii, input);
            if ('error' in result) return errText(result.error);
            return text({ id: result.manifest.id, updated: result.updated, key: `template.catalog.${result.manifest.id}.manifest` });
        },
    );

    mcp.tool(
        'aimeat_app_template_list',
        descriptionFor('aimeat_app_template_list'),
        {},
        annotationsFor('aimeat_app_template_list'),
        async () => {
            const proposals = await listTemplateProposals(storage, config, agentGaii);
            return text({
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

    mcp.tool(
        'aimeat_app_template_get',
        descriptionFor('aimeat_app_template_get'),
        { id: z.string().min(1).max(64) },
        annotationsFor('aimeat_app_template_get'),
        async ({ id }) => {
            const found = await getTemplateProposal(storage, config, agentGaii, id);
            if (!found) return errText(`Template proposal not found: ${id}`);
            const m = found.manifest;

            // Live commerce/fork state of the source app so the next builder knows how to start.
            const sourceOwnerGhii = `${m.derivedFrom.owner}@${config.nodeId}`;
            const app = await storage.getApp(sourceOwnerGhii, m.derivedFrom.filename).catch(err => { logger.warn('proofs: continuing after a suppressed failure', { error: String(err) }); return null; });
            const priceMorsels = (app?.manifest as { priceMorsels?: number } | undefined)?.priceMorsels ?? 0;
            const source_app = app ? {
                exists: true,
                forkable: app.forkable ?? false,
                price_morsels: priceMorsels,
                license_type: (app.manifest as { licenseType?: string } | undefined)?.licenseType ?? null,
                version: app.versionNumber,
                download_url: `/v1/apps/${encodeURIComponent(m.derivedFrom.owner)}/${encodeURIComponent(m.derivedFrom.filename)}`,
            } : { exists: false };

            // v1 proposals are owner-scoped, so the reader IS the source owner (same-owner fork
            // always passes the gate). The commerce note covers future/other-party readers:
            // a priced app is bought through the checkout rails, never with morsels directly.
            const how_to_start = !app
                ? 'Source app is gone — scaffold from reuse_notes.'
                : m.startMode === 'scaffold'
                    ? 'Scaffold a fresh app from reuse_notes (do not fork).'
                    : priceMorsels > 0
                        ? 'Fork the source app (aimeat_app_fork) and adapt per reuse_notes. Non-owner buyers: open a checkout (aimeat_checkout_open, pays via x402/UCP/card) for the license first — the fork gate enforces it.'
                        : 'Fork the source app (aimeat_app_fork) and adapt per reuse_notes.';

            return text({ ...m, source_app, how_to_start });
        },
    );

    mcp.tool(
        'aimeat_app_template_delete',
        descriptionFor('aimeat_app_template_delete'),
        { id: z.string().min(1).max(64) },
        annotationsFor('aimeat_app_template_delete'),
        async ({ id }) => {
            const ok = await deleteTemplateProposal(storage, config, agentGaii, id);
            if (!ok) return errText(`Template proposal not found: ${id}`);
            return text({ deleted: true, id });
        },
    );
}
