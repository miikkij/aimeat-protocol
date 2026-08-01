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
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII, isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';

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
    function canSeeBoard(board: { visibility: string; ownerGaii: string; allowedGaiis: string[] }): boolean {
        if (board.visibility === 'public' || board.visibility === 'system') return true;
        if (board.ownerGaii === agentGaii) return true;
        if (board.visibility === 'shared' && isSameOwner(board.ownerGaii, agentGaii)) return true;
        if (board.allowedGaiis.includes(agentGaii)) return true;
        return false;
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
            // public/system require operator
            if (visibility === 'public') {
                if (!(await isOperator())) {
                    return { content: [{ type: 'text' as const, text: 'Operator role required for public boards' }], isError: true };
                }
            }

            const id = `board-${randomBytes(8).toString('hex')}`;
            const board = await storage.createBoard({
                id,
                name,
                description,
                visibility,
                ownerGaii: agentGaii,
                allowedGaiis: allowed_gaiis ?? [],
                createdAt: new Date().toISOString(),
            });

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
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: 'Board not found' }], isError: true };
            if (!canSeeBoard(board)) return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };

            // Check if already subscribed
            const existing = await storage.getBoardSubscription(board_id, agentGaii);
            if (existing) return { content: [{ type: 'text' as const, text: 'Already subscribed to this board' }], isError: true };

            const sub = await storage.createBoardSubscription({
                id: `sub-${randomBytes(8).toString('hex')}`,
                boardId: board_id,
                gaii: agentGaii,
                callbackUrl: callback_url,
                filters,
                createdAt: new Date().toISOString(),
            });

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
            const ok = await storage.addReaction(board_id, post_id, emoji, agentGaii);
            if (!ok) return { content: [{ type: 'text' as const, text: 'Post not found' }], isError: true };

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
            const parent = await storage.getPost(board_id, post_id);
            if (!parent) return { content: [{ type: 'text' as const, text: 'Post not found' }], isError: true };

            const replyId = `reply-${randomBytes(8).toString('hex')}`;
            // TARGET-058. Same act as aimeat_board_post — text an agent puts where people read it —
            // so it is stamped the same way. The hash covers the BODY alone: the title is generated
            // by this tool ("Re: …"), and hashing our own prefix would describe bytes the agent never
            // wrote. Phase 9 gave the reply a column for the id, so the label can be rendered from
            // the reply rather than only found by that hash.
            const provenanceId = await provenanceForWrite(storage, {
                principal: agentGaii,
                content: body,
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.board_reply',
                surface: { visibility: 'public', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });
            const reply = await storage.createPost({
                id: replyId,
                boardId: board_id,
                authorGaii: agentGaii,
                title: `Re: ${parent.title}`,
                body,
                tags: [],
                reactions: {},
                replyTo: post_id,
                createdAt: new Date().toISOString(),
                aiProvenanceId: provenanceId,
            });

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
                        ...(await writeProvenanceEcho(storage, config, provenanceId)),
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

            // Auth: agent's owner must be the board owner
            const agentOwner = parseGaiiLoose(agentGaii).owner;
            const boardOwner = parseGaiiLoose(board.ownerGaii).owner;
            if (agentOwner !== boardOwner) {
                return { content: [{ type: 'text' as const, text: 'Only the board owner can manage members' }], isError: true };
            }

            // Compute new member set
            const members = new Set(board.allowedGaiis);
            if (Array.isArray(add)) for (const g of add) members.add(g);
            if (Array.isArray(remove)) for (const g of remove) members.delete(g);

            const updated = await storage.updateBoardMembers(board_id, [...members]);
            if (!updated) return { content: [{ type: 'text' as const, text: 'Failed to update board members' }], isError: true };

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
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: 'Board not found' }], isError: true };

            // Auth: owner or operator
            if (board.ownerGaii !== agentGaii && !(await isOperator())) {
                return { content: [{ type: 'text' as const, text: 'Only the board owner or operator can delete this board' }], isError: true };
            }

            await storage.deleteBoard(board_id);
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
