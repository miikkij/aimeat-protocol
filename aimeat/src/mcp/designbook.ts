/**
 * @file src/mcp/designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-MCP door for the Design Book (TARGET-074 phase 5): search, read, propose,
 *   adopt. Calls the same DesignBookService the REST routes do — one capability, one
 *   implementation — and the bench refusals reach the agent in the validator's own words.
 * @structure registerDesignbookTools(mcp, storage, config, getAgentGaii)
 * @usage
 *   import { registerDesignbookTools } from './designbook.js';
 *   registerDesignbookTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.1.0 — 2026-08-28 — The kind wording grows with the Book: look, motion and illustration
 *     join layout and fill in the search filter and the propose contract.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { descriptionFor } from './catalog/shape.js';
import { DesignBookService } from '../services/design-book/service.js';
import { DesignBookError } from '../services/design-book/validate.js';

/** One text block per answer; refusals carry the service's words verbatim. */
function text(payload: unknown, isError = false) {
    return { content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

export function registerDesignbookTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const book = new DesignBookService(storage, config);

    const answer = async (work: () => Promise<unknown>) => {
        try {
            return text(await work());
        } catch (err) {
            if (err instanceof DesignBookError) return text(`${err.code}: ${err.message}`, true);
            throw err;
        }
    };

    mcp.tool(
        'aimeat_designbook_search',
        descriptionFor('aimeat_designbook_search'),
        {
            kind: z.string().optional().describe('Only this part kind: "layout", "fill", "look", "motion" or "illustration".'),
            status: z.string().optional().describe('Only this lifecycle state: proposed, published, aging or retired.'),
            q: z.string().optional().describe('A word matched against id, title, summary and tags.'),
            limit: z.number().optional().describe('Rows to return, 1-200. Default 50.'),
        },
        annotationsFor('aimeat_designbook_search'),
        async ({ kind, status, q, limit }) => answer(async () => {
            const parts = await book.list({ kind, status, q, limit });
            return {
                parts, count: parts.length,
                note: parts.length
                    ? 'Read one whole with aimeat_designbook_get; its body is exactly what an adopt writes.'
                    : 'The Book holds nothing matching that. Propose the first part with aimeat_designbook_propose.',
            };
        }),
    );

    mcp.tool(
        'aimeat_designbook_get',
        descriptionFor('aimeat_designbook_get'),
        {
            id: z.string().describe('The part id, from the search.'),
        },
        annotationsFor('aimeat_designbook_get'),
        async ({ id }) => answer(() => book.get(id)),
    );

    mcp.tool(
        'aimeat_designbook_propose',
        descriptionFor('aimeat_designbook_propose'),
        {
            part: z.record(z.string(), z.unknown()).describe('The part: { id, kind: "layout"|"fill"|"look"|"motion"|"illustration", title, summary, body, tags? }. The kind decides the body: a whole mosaic layout (layout/fill), { tokens, look? } (look), { tokens } of motion tokens only (motion), or { style, palette_words? } (illustration).'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_designbook_propose'),
        async ({ part, ai_provenance, ai_provenance_id }) => answer(async () => {
            const out = await book.propose(getAgentGaii(), part, {
                principal: getAgentGaii(),
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
            });
            return {
                ...out,
                note: out.status === 'proposed'
                    ? 'Proposed. The bench passed; publishing into the shared catalogue is the node operator\'s call. You can adopt your own proposal into your apps meanwhile.'
                    : `Updated in place as a minor — the part stays ${out.status}, and later adopts get this version.`,
            };
        }),
    );

    mcp.tool(
        'aimeat_designbook_adopt',
        descriptionFor('aimeat_designbook_adopt'),
        {
            id: z.string().describe('The part to adopt.'),
            filename: z.string().describe('Your published app file the layout lands in.'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_designbook_adopt'),
        async ({ id, filename, ai_provenance, ai_provenance_id }) => answer(async () => {
            const out = await book.adopt(getAgentGaii(), id, filename, {
                principal: getAgentGaii(),
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
            });
            return {
                ...out,
                note: out.kind === 'fill'
                    ? 'Adopted. This part is a starting shape: its <placeholder> texts are yours to replace with aimeat_app_ui_set.'
                    : 'Adopted. The app renders it on its next open; the replaced layout is archived and one restore brings it back.',
            };
        }),
    );
}
