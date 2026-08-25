/**
 * @file src/mcp/surface-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP half of arranging this node's pages. "Take the shop off our home page"
 *   is the sentence these two tools exist for, and it is the road this platform prefers: the admin
 *   tab shows what happened, the chat is where it is asked for.
 *
 *   THEY CALL THE SERVICE, NOT THE STORE. Every refusal, the block validation, the passage rules and
 *   the change log live in SurfaceLayoutService, which the HTTP routes call too. A tool reaching
 *   storage directly would be a second implementation, and the same defect has already been fixed
 *   three separate times inside one MCP tool because two surfaces each had their own copy.
 *
 *   THE READ CARRIES THE VOCABULARY. get returns the catalogue of blocks this node can serve
 *   alongside the layout, because without it an AI's first write is always a refusal: it has to
 *   guess block names, and a name this node does not have is refused by design.
 *
 *   NO PROPOSE-THEN-CONFIRM, AND THAT IS A DECISION. The AI-config tools use one because those
 *   settings have no history. These do: every write archives what it replaced, and set answers with
 *   the version number that went into it, so putting a page back is one call rather than a token
 *   dance. The gate is also stricter — an exact word no wildcard carries.
 * @structure registerSurfaceLayoutTools(mcp, storage, config, getAgentGaii)
 * @usage registerSurfaceLayoutTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { SiteError } from '../services/site.js';
import { SurfaceLayoutService, type LayoutSubmission } from '../services/surface-layout/service.js';
import { blocksForSurface, operatorLabelKey } from '../services/surface-layout/registry.js';
import type { SurfaceId } from '../services/surface-layout/types.js';
import { parseGAII } from '../utils/gaii.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

interface TextResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    [key: string]: unknown;
}

const out = (payload: unknown, isError = false): TextResult => ({
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
});

/** Every refusal from the service is already worded for a person; pass it through unchanged. */
function refusal(err: unknown): TextResult {
    if (err instanceof SiteError) return out({ error: err.code, message: err.message }, true);
    throw err;
}

export function registerSurfaceLayoutTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const svc = new SurfaceLayoutService(config, storage);

    /**
     * The operator test, at call time rather than at registration, the same way the other admin
     * tools do it: roles are not known when the session is made.
     *
     * The DECISION is in the service, not here. The tool surface already filters by scope, but the
     * scope word says "this agent may arrange pages" and this says "the account it acts for runs
     * this node" — two different questions, and the second is what stops the word from working when
     * an ordinary owner is granted it. Both doors ask the same function for that answer.
     */
    async function isOperator(): Promise<boolean> {
        return svc.callerIsOperator(parseGAII(getAgentGaii())?.owner);
    }

    const notOperator = (): TextResult => out({
        error: 'ACCESS_DENIED',
        message: 'Only the person who runs this installation can arrange its pages.',
    }, true);

    mcp.tool(
        'aimeat_surface_layout_get',
        descriptionFor('aimeat_surface_layout_get'),
        {
            surface: z.string().describe("Which page: 'portal', 'home' or 'home-onboarding'."),
        },
        annotationsFor('aimeat_surface_layout_get'),
        async ({ surface }): Promise<TextResult> => {
            if (!await isOperator()) return notOperator();
            if (!SurfaceLayoutService.isSurface(surface)) {
                return out({ error: 'SURFACE_NOT_FOUND', message: `This node has no page called "${surface}".` }, true);
            }
            const resolved = await svc.resolve(surface);
            const passages = await svc.readFreeform(resolved.layout);
            return out({
                surface,
                source: resolved.source,
                degraded: resolved.degraded,
                problems: resolved.problems,
                layout: resolved.layout,
                freeform: passages,
                available_blocks: blocksForSurface(surface, config).map(def => ({
                    id: def.id,
                    what_it_is: def.summary,
                    label_key: operatorLabelKey(def.id),
                    max_per_page: def.maxPerSurface,
                    holds_other_blocks: def.container === true,
                    settings: def.props,
                })),
                note: resolved.source === 'default'
                    ? 'Nobody has arranged this page yet; this is what it ships as. Change it and it becomes theirs.'
                    : 'Send the WHOLE layout back when you change it. It replaces rather than merges.',
            });
        },
    );

    mcp.tool(
        'aimeat_surface_layout_set',
        descriptionFor('aimeat_surface_layout_set'),
        {
            surface: z.string().describe("Which page: 'portal', 'home' or 'home-onboarding'."),
            blocks: z.array(z.record(z.string(), z.unknown()))
                .describe('The blocks in the order they should appear. Each is { id, key } with optional props, titles, hidden, children and — on a free-form block — body.'),
            note: z.string().optional().describe('One line on what this change was for. It shows in the node change log.'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_surface_layout_set'),
        async ({ surface, blocks, note, ai_provenance, ai_provenance_id }): Promise<TextResult> => {
            if (!await isOperator()) return notOperator();
            if (!SurfaceLayoutService.isSurface(surface)) {
                return out({ error: 'SURFACE_NOT_FOUND', message: `This node has no page called "${surface}".` }, true);
            }
            const target = surface as SurfaceId;
            // Read the history BEFORE writing, so the answer can name the version this replaced.
            // Afterwards the newest entry is the one just archived, and telling the person which
            // number to go back to is the whole of the undo story.
            const before = await svc.versions(target, 1);
            try {
                const submission: LayoutSubmission = { v: 1, blocks, ...(note ? { meta: { note } } : {}) };
                // A passage is prose on a page every member lands on, and an AI is exactly who an
                // operator asks to write one. Declaring is optional; silence stays UNSTATED rather
                // than becoming a claim that a person wrote it.
                const result = await svc.write(target, submission, 'mcp', 'mcp', {
                    principal: getAgentGaii(),
                    declaredId: ai_provenance_id,
                    declared: toDeclaredProvenance(ai_provenance),
                });
                const after = await svc.versions(target, 1);
                const replaced = after[0]?.version ?? before[0]?.version ?? null;
                return out({
                    surface,
                    blocks_stored: result.layout.blocks.length,
                    replaced_version: replaced,
                    undo: replaced === null
                        ? 'There was nothing here before, so removing the layout is what puts it back.'
                        : `Call aimeat_surface_layout_set again, or restore version ${replaced}, to put back what was here.`,
                    note: 'Tell them what the page shows now, in their words. They have not seen it yet.',
                });
            } catch (err) { return refusal(err); }
        },
    );
}
