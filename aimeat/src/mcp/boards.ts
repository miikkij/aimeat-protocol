/**
 * @file boards.ts
 * @description MCP board tools and resource registrations. Provides 7 tools for board
 *   management (list, create, subscribe, react, reply, manage members, delete) and 1
 *   resource template for reading board posts via the MCP resource protocol.
 * @structure
 *   - registerBoardsTools() — registers all board tools and resources on an McpServer instance
 * @usage
 *   import { registerBoardsTools } from './boards.js';
 *   registerBoardsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 7 tools + 1 resource for board management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 8b. aimeat_board_reply accepts an `ai_provenance`
 *     declaration and stamps the reply through provenanceForWrite(). Phase 4 froze it in the
 *     reviewed-without list as borderline; it is not borderline — a reply is text on a public board
 *     that a person reads, and aimeat_board_post next to it was stamped from the start.
 *   v1.4.0 -- 2026-08-11 -- August 2026 audit step 8. Create, subscribe, react, members and delete
 *     went through services/board-write.ts, which routes/boards.ts also calls. Each of the five used
 *     to build its own record and emit its own event here, and the copies had drifted: no bound on a
 *     board name or a reaction, the operator rule named public but not system, federate never set,
 *     and a roster call with neither add nor remove reported success while changing nothing.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardRecord } from '../storage/interface.js';
import { parseGAII, parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { createBoardReply } from '../services/board-post.js';
import {
    boardVisibleTo, createBoard, subscribeToBoard, reactToBoardPost, setBoardMembers, deleteBoardById,
    type BoardWriteCaller,
} from '../services/board-write.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';

export function registerBoardsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Check if the current agent's owner is an operator. */
    async function isOperator(): Promise<boolean> {
        const parsed = parseGAII(agentGaii);
        if (!parsed) return false;
        const owner = await storage.getOwner(parsed.owner);
        return !!owner && owner.roles.includes('operator');
    }

    /** Check if the agent can see a board (visibility rules). */
    function canSeeBoard(board: Pick<BoardRecord, 'visibility' | 'ownerGaii' | 'allowedGaiis'>): boolean {
        return boardVisibleTo(board, agentGaii);
    }

    /**
     * The caller the board services rule on. The roles come from the OWNER record rather than the
     * session, because an MCP token carries roles ['agent'] and nothing else: an operator's agent
     * would otherwise look like any other agent to a rule written against roles, and creating a
     * public board over MCP has always been something an operator's agent can do.
     */
    async function boardCaller(): Promise<BoardWriteCaller> {
        return { gaii: agentGaii, roles: (await isOperator()) ? ['agent', 'operator'] : ['agent'] };
    }

    // ── Resource: board posts ──
    mcp.registerResource(
        'board-posts',
        new ResourceTemplate('aimeat://boards/{boardId}', {
            list: async () => {
                const boards = await storage.listBoards();
                const visible = boards.filter(b => canSeeBoard(b));
                return {
                    resources: visible.map(b => ({
                        uri: `aimeat://boards/${encodeURIComponent(b.id)}`,
                        name: b.name,
                        mimeType: 'application/json',
                        description: `Board: ${b.name} (${b.visibility})`,
                    })),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Board posts' },
        async (uri, variables) => {
            const boardId = decodeURIComponent(variables.boardId as string);
            const board = await storage.getBoard(boardId);
            if (!board) return { contents: [{ uri: uri.toString(), text: 'Board not found' }] };
            if (!canSeeBoard(board)) return { contents: [{ uri: uri.toString(), text: 'Access denied' }] };
            const posts = await storage.listPosts(boardId, { limit: 50 });
            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify(posts.map(p => ({
                        id: p.id,
                        author_gaii: p.authorGaii,
                        title: p.title,
                        body: p.body,
                        category: p.category,
                        reactions: p.reactions,
                        reply_to: p.replyTo,
                        created_at: p.createdAt,
                    })), null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_board_list ──
    mcp.tool(
        'aimeat_board_list',
        descriptionFor('aimeat_board_list'),
        {},
        annotationsFor('aimeat_board_list'),
        async () => {
            const boards = await storage.listBoards();
            const visible = boards.filter(b => canSeeBoard(b));
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(visible.map(b => ({
                        id: b.id,
                        name: b.name,
                        description: b.description,
                        visibility: b.visibility,
                        owner_gaii: b.ownerGaii,
                        allowed_gaiis: b.allowedGaiis,
                        created_at: b.createdAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_board_create ──
    mcp.tool(
        'aimeat_board_create',
        descriptionFor('aimeat_board_create'),
        {
            name: z.string(),
            visibility: z.enum(['private', 'shared', 'public']),
            description: z.string().optional(),
            allowed_gaiis: z.array(z.string()).optional(),
        },
        annotationsFor('aimeat_board_create'),
        async ({ name, visibility, description, allowed_gaiis }) => {
            // services/board-write.ts — the same create POST /v1/boards performs. The operator rule
            // lived here as "public requires operator" while the route reserves system boards too,
            // the name and description had no bound at all, and federate was never set.
            const out = await createBoard({ storage, config }, await boardCaller(), {
                name, visibility, description, allowedGaiis: allowed_gaiis,
            });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            const board = out.board;

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: board.id,
                        name: board.name,
                        visibility: board.visibility,
                        created_at: board.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_board_subscribe ──
    mcp.tool(
        'aimeat_board_subscribe',
        descriptionFor('aimeat_board_subscribe'),
        {
            board_id: z.string(),
            callback_url: z.string().optional(),
            filters: z.object({
                categories: z.array(z.string()).optional(),
                tags: z.array(z.string()).optional(),
            }).optional(),
        },
        annotationsFor('aimeat_board_subscribe'),
        async ({ board_id, callback_url, filters }) => {
            // services/board-write.ts — the same subscription POST /v1/boards/:id/subscribe writes,
            // with the same visibility rule, the same duplicate refusal and the same change event.
            const out = await subscribeToBoard({ storage, config }, await boardCaller(), {
                boardId: board_id, callbackUrl: callback_url, filters,
            });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            const sub = out.subscription;

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        subscription_id: sub.id,
                        board_id: sub.boardId,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_board_react ──
    mcp.tool(
        'aimeat_board_react',
        descriptionFor('aimeat_board_react'),
        {
            board_id: z.string(),
            post_id: z.string(),
            emoji: z.string(),
        },
        annotationsFor('aimeat_board_react'),
        async ({ board_id, post_id, emoji }) => {
            // services/board-write.ts — the same reaction POST /v1/boards/:b/posts/:p/react writes.
            // The route runs BoardReactionSchema over it first; this tool declared z.string(), so an
            // empty reaction and a ten-thousand-character one both stored.
            const out = await reactToBoardPost({ storage, config }, await boardCaller(), {
                boardId: board_id, postId: post_id, reaction: emoji,
            });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };

            emitResourceUpdated(agentGaii, `aimeat://boards/${encodeURIComponent(board_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ success: true }, null, 2),
                }],
            };
        },
    );

    // ── Tool 5: aimeat_board_reply ──
    mcp.tool(
        'aimeat_board_reply',
        descriptionFor('aimeat_board_reply'),
        {
            board_id: z.string(),
            post_id: z.string(),
            body: z.string(),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_board_reply'),
        async ({ board_id, post_id, body, ai_provenance, ai_provenance_id }) => {
            // The whole reply is services/board-post.ts: the board's ACCESS rule (which neither door
            // applied to a reply — both checked only that the parent post existed), the body bound,
            // the provenance stamp with the board's REAL visibility (this tool stamped every reply
            // 'public', so one on a private board carried a public-surface label), the record, the
            // change event and the subscriber fan-out.
            const out = await createBoardReply({ storage, config }, { gaii: agentGaii, roles: ['agent'] }, {
                boardId: board_id, postId: post_id, body,
                declaredProvenanceId: ai_provenance_id,
                declaredProvenance: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.board_reply',
            });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            const reply = out.reply;

            emitResourceUpdated(agentGaii, `aimeat://boards/${encodeURIComponent(board_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: reply.id,
                        board_id: reply.boardId,
                        reply_to: reply.replyTo,
                        title: reply.title,
                        created_at: reply.createdAt,
                        ...(await writeProvenanceEcho(storage, config, reply.aiProvenanceId ?? undefined)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 6: aimeat_board_members ──
    mcp.tool(
        'aimeat_board_members',
        descriptionFor('aimeat_board_members'),
        {
            board_id: z.string(),
            add: z.array(z.string()).optional(),
            remove: z.array(z.string()).optional(),
        },
        annotationsFor('aimeat_board_members'),
        async ({ board_id, add, remove }) => {
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: 'Board not found' }], isError: true };

            // Auth: agent's owner must be the board owner. This check stays on the door because the
            // two doors answer it differently on purpose — PATCH /v1/boards/:id/members demands an
            // owner session and rejects every agent session, while here an agent holding
            // `social:members` acts for its owner, which is what makes an agent a first-class user.
            const agentOwner = parseGaiiLoose(agentGaii).owner;
            const boardOwner = parseGaiiLoose(board.ownerGaii).owner;
            if (agentOwner !== boardOwner) {
                return { content: [{ type: 'text' as const, text: 'Only the board owner can manage members' }], isError: true };
            }

            // The roster arithmetic, the write and the change event are services/board-write.ts.
            const out = await setBoardMembers({ storage, config }, board, { add, remove });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            const updated = out.board;

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        board_id: updated.id,
                        allowed_gaiis: updated.allowedGaiis,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 7: aimeat_board_delete ──
    mcp.tool(
        'aimeat_board_delete',
        descriptionFor('aimeat_board_delete'),
        {
            board_id: z.string(),
        },
        annotationsFor('aimeat_board_delete'),
        async ({ board_id }) => {
            // services/board-write.ts — the same delete DELETE /v1/boards/:id performs, with the
            // same owner-or-operator rule and the same change event.
            const out = await deleteBoardById({ storage, config }, await boardCaller(), board_id);
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ deleted: true }, null, 2),
                }],
            };
        },
    );
}
