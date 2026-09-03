/**
 * @file mcp/core-boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP's two board tools: read a board, post to one.
 *
 *   PURE EXTRACTION from core.ts, following the road core-storage.ts, core-datapackage.ts and
 *   core-admin.ts already took. core.ts sat at EXACTLY the 800-line cap, which means the next person
 *   to add anything pays for the split whoever they are; this is that payment, and boards are the
 *   cleanest unit to move — a self-contained pair at the end of the tool list, depending on nothing
 *   the rest of the file holds beyond storage, config and the caller's identity.
 * @structure registerCoreBoardTools(mcp, deps)
 * @usage registerCoreBoardTools(mcp, { storage, config, agentGaii });
 * @version-history
 *   v1.0.0 — 2026-09-03 — Extracted from core.ts (max-file-lines). No behaviour change.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema } from './catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import { createBoardPost } from '../services/board-post.js';
import { boardReadRefusal } from '../services/board-read-access.js';
import { withoutHiddenPosts } from '../services/board-moderation.js';

export function registerCoreBoardTools(
  mcp: McpServer,
  { storage, config, agentGaii }: { storage: Storage; config: AimeatConfig; agentGaii: string },
): void {
// ── Tool 11: aimeat_board_read ──
mcp.tool(
    'aimeat_board_read',
    descriptionFor('aimeat_board_read'),
    { board_id: z.string(), category: z.string().optional(), limit: z.number().optional(), response_format: responseFormatSchema },
    annotationsFor('aimeat_board_read'),
    async ({ board_id, category, limit, response_format }) => {
        // Load the board and rule on it. This tool used to list the posts and nothing else, so
        // it never had a visibility to rule on: any MCP session read another owner's PRIVATE
        // board, and no consent-denial row existed to show it happened. The MCP RESOURCE for the
        // same board filtered on visibility, so the two doors to one board disagreed.
        const board = await storage.getBoard(board_id);
        if (!board) return { content: [{ type: 'text' as const, text: `Board not found: ${board_id}` }], isError: true };
        const refusal = await boardReadRefusal({ storage, config }, agentGaii, board);
        if (refusal) return { content: [{ type: 'text' as const, text: `${refusal.code}: ${refusal.message}` }], isError: true };

        // The same hiding rule GET /v1/boards/:id/posts applies: a post flags have hidden is
        // left out for everyone but its author and the board's owner.
        const posts = await withoutHiddenPosts({ storage, config }, board, agentGaii,
            await storage.listPosts(board_id, { category, limit: limit ?? 20 }));
        // TARGET-058: an agent asked to summarise a board has to be able to say which posts a
        // model wrote. One query for the page — see readProvenanceMany's N+1 note.
        const provFor = await readProvenanceMany(storage, config, posts.map(p => p.aiProvenanceId));
        return jsonContent(shapeResponse('aimeat_board_read', response_format, posts.map(p => ({
            id: p.id,
            author_gaii: p.authorGaii,
            title: p.title,
            body: p.body,
            category: p.category,
            tags: p.tags,
            reactions: p.reactions,
            ttl_expires_at: p.ttlExpiresAt,
            created_at: p.createdAt,
            ...provFor(p.aiProvenanceId),
        }))));
    },
);

// ── Tool 12: aimeat_board_post ──
mcp.tool(
    'aimeat_board_post',
    descriptionFor('aimeat_board_post'),
    { board_id: z.string(), title: z.string(), body: z.string(), category: z.string().optional(), ...aiProvenanceInputs },
    annotationsFor('aimeat_board_post'),
    async ({ board_id, title, body, category, ai_provenance, ai_provenance_id }) => {
        // ONE implementation (services/board-post.ts). This tool never loaded the board, so it
        // had no access check, no price on a public board, no pre_board_post hook and no bound
        // on title or body. Any agent holding social:write posted into any board on the node,
        // including another owner's private one, for free.
        const posted = await createBoardPost({ storage, config }, {
            gaii: agentGaii,
            roles: ['agent'],
        }, {
            boardId: board_id, title, body, category,
            declaredProvenanceId: ai_provenance_id,
            declaredProvenance: toDeclaredProvenance(ai_provenance),
            pipeline: 'mcp.board_post',
        });
        if (!posted.ok) {
            return { content: [{ type: 'text' as const, text: `${posted.code}: ${posted.message}` }], isError: true };
        }
        const post = posted.post;
        const provenanceId = post.aiProvenanceId;
        return {
            content: [{ type: 'text' as const, text: JSON.stringify({
                id: post.id, board_id, title, posted: true,
                ...(await writeProvenanceEcho(storage, config, provenanceId)),
            }, null, 2) }],
        };
    },
);
}
