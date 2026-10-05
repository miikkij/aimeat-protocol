/**
 * @file boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP board tools and resource registrations. Provides 8 tools for board
 *   management (list, create, set rules, subscribe, react, reply, manage members, delete) and 1
 *   resource template for reading board posts via the MCP resource protocol.
 * @structure
 *   - registerBoardsTools() — registers all board tools and resources on an McpServer instance
 * @usage
 *   import { registerBoardsTools } from './boards.js';
 *   registerBoardsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.8.0 -- 2026-10-05 -- Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2). aimeat_board_rules_set on another person's board asks operatorOverride, as PATCH /v1/boards/:id/rules does.
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
 *   v1.6.0 -- 2026-09-13 -- A board's rules over MCP. aimeat_board_create takes `rules` and answers
 *     with the rules that apply, defaults included, and a sentence naming the post lifetime;
 *     aimeat_board_rules_set changes them under the keeper rule PATCH /v1/boards/:id/rules applies.
 *     Rules existed only over HTTP, so a board built by an agent ran on the node defaults and a
 *     catalogue board emptied itself seven days after launch with nothing at creation saying so.
 *   v1.5.0 -- 2026-08-30 -- The board-posts resource leaves out a post flags have hidden
 *     (services/board-moderation.ts), as the HTTP listing and aimeat_board_read do.
 *   v1.7.0 -- 2026-09-24 -- SECURITY (audit A8-1): the operator's reach on a board (deleting and
 *     setting the rules of another owner's board, the public-board ceiling) is asked of the agent
 *     through services/operator-principal.ts, so it takes operator:admin. It was read off the owner
 *     record, so every agent of an operator holding social:write carried it.
 *   v1.7.1 -- 2026-09-26 -- The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardRecord } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { resolveOperatorAgentName } from '../services/operator-principal.js';
import { operatorOverride } from '../services/operator-override.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { createBoardReply, boardPostPrice } from '../services/board-post.js';
import { withoutHiddenPosts } from '../services/board-moderation.js';
import {
    boardVisibleTo, createBoard, subscribeToBoard, reactToBoardPost, unreactToBoardPost, setBoardMembers, setBoardRules,
    deleteBoardById, boardRulesBlock, type BoardWriteCaller,
} from '../services/board-write.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

/**
 * How long a post lives when neither the post nor the board names a lifetime.
 *
 * A COPY of DEFAULT_TTL_HOURS in services/board-post.ts, which that file does not export. It is
 * here so the create answer can say the number out loud: a board used as a catalogue emptied itself
 * a week after launch, and nothing an agent read at creation mentioned the week. Replace this with
 * the import once board-post.ts exports its constant.
 */
const DEFAULT_POST_TTL_HOURS = 168;

/**
 * The rules a board actually runs on, defaults filled in: what an author meets when posting.
 *
 * `rules` on a board is what its keeper SET, and it is absent when they set nothing, which is the
 * case that bit. The price is boardPostPrice's own answer for an empty post, so the board's price
 * and the node's base price are read from one place.
 */
function effectiveBoardRules(board: BoardRecord, config: AimeatConfig): Record<string, unknown> {
    const r = board.rules ?? {};
    const defaultPosting = board.visibility === 'public' ? 'anyone'
        : board.visibility === 'shared' ? 'members'
        : board.visibility === 'system' ? 'operators' : 'owner';
    const basePrice = boardPostPrice(board, config, 0);
    return {
        posting: r.posting ?? defaultPosting,
        // Empty means any category, or none, is accepted.
        categories: r.categories ?? [],
        default_ttl_hours: r.defaultTtlHours ?? DEFAULT_POST_TTL_HOURS,
        post_cost: basePrice,
        post_cost_per_kb: basePrice > 0 ? config.boardPostCostPerKb : 0,
    };
}

/** One sentence an agent reads at creation, so the lifetime is never a discovery. */
function lifetimeNote(effective: Record<string, unknown>): string {
    const hours = effective.default_ttl_hours as number;
    const span = hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? '' : 's'}` : `${hours} hours`;
    return `A post on this board is removed ${span} after it is written unless the post names its own lifetime. `
        + 'Change it with aimeat_board_rules_set.';
}

export function registerBoardsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
    /** This session's granted scopes: the operator's reach is asked of them. */
    scopes: readonly string[] = [],
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    /** Whether THIS AGENT may use the operator's reach: an operator account's agent holding
     *  operator:admin (services/operator-principal.ts). The account alone is not enough. */
    async function isOperator(): Promise<boolean> {
        return (await resolveOperatorAgentName(storage, agentGaii, scopes)) !== null;
    }

    /** Check if the agent can see a board (visibility rules). */
    function canSeeBoard(board: Pick<BoardRecord, 'visibility' | 'ownerGaii' | 'allowedGaiis'>): boolean {
        return boardVisibleTo(board, agentGaii);
    }

    /**
     * The caller the board services rule on. An MCP token carries roles ['agent'] and nothing else,
     * so the operator role is added here for an agent the operator ticked operator:admin for, and
     * for no other: a rule written against roles would otherwise see every agent of an operator as
     * the operator.
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
            const posts = await withoutHiddenPosts({ storage, config }, board, agentGaii, await storage.listPosts(boardId, { limit: 50 }));
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
        zodShapeFor('aimeat_board_list'),
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
        zodShapeFor('aimeat_board_create'),
        annotationsFor('aimeat_board_create'),
        async ({ name, visibility, description, allowed_gaiis, rules }) => {
            // services/board-write.ts — the same create POST /v1/boards performs. The operator rule
            // lived here as "public requires operator" while the route reserves system boards too,
            // the name and description had no bound at all, and federate was never set.
            // `rules` goes to the same normalizer the HTTP body does. This tool did not take it, so a
            // board built over MCP ran on the defaults and its posts were gone after seven days.
            const out = await createBoard({ storage, config }, await boardCaller(), {
                name, visibility, description, allowedGaiis: allowed_gaiis, rules,
            });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            const board = out.board;

            emitResourceListChanged(agentGaii);

            const effective = effectiveBoardRules(board, config);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: board.id,
                        name: board.name,
                        visibility: board.visibility,
                        rules: boardRulesBlock(board) ?? null,
                        effective_rules: effective,
                        note: lifetimeNote(effective),
                        created_at: board.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: aimeat_board_rules_set ──
    mcp.tool(
        'aimeat_board_rules_set',
        descriptionFor('aimeat_board_rules_set'),
        zodShapeFor('aimeat_board_rules_set'),
        annotationsFor('aimeat_board_rules_set'),
        async ({ board_id, rules }) => {
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: `NOT_FOUND: Board not found: ${board_id}` }], isError: true };

            // The keeper rule PATCH /v1/boards/:id/rules applies, word for word: the exact identity
            // that created the board, or an operator. Another agent of the same owner is refused on
            // both doors. Whether a same-owner principal should pass is open; until it is decided the
            // two doors give the same answer. The operator's pass on another person's board is
            // operatorOverride, as on the route, so it writes the operator trail on both surfaces.
            if (board.ownerGaii !== agentGaii && !(await operatorOverride(storage, config,
                caller().auth,
                { ownerOf: board.ownerGaii, area: 'board', action: 'rules', subject: board.name }))) {
                return { content: [{ type: 'text' as const, text: 'ACCESS_DENIED: Only the keeper of this board sets its rules. Ask them, or open a board of your own.' }], isError: true };
            }

            // The shape check, the write and the change event are services/board-write.ts.
            const out = await setBoardRules({ storage, config }, board, rules);
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };

            const effective = effectiveBoardRules(out.board, config);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: out.board.id,
                        rules: boardRulesBlock(out.board) ?? null,
                        effective_rules: effective,
                        note: lifetimeNote(effective),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_board_subscribe ──
    mcp.tool(
        'aimeat_board_subscribe',
        descriptionFor('aimeat_board_subscribe'),
        zodShapeFor('aimeat_board_subscribe'),
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
        zodShapeFor('aimeat_board_react'),
        annotationsFor('aimeat_board_react'),
        async ({ board_id, post_id, emoji, remove }) => {
            // services/board-write.ts — the same reaction POST /v1/boards/:b/posts/:p/react writes,
            // and with remove the same withdrawal its DELETE makes. The route runs
            // BoardReactionSchema over it first; this tool declared z.string(), so an empty
            // reaction and a ten-thousand-character one both stored.
            const write = remove ? unreactToBoardPost : reactToBoardPost;
            const out = await write({ storage, config }, await boardCaller(), {
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
        zodShapeFor('aimeat_board_reply'),
        annotationsFor('aimeat_board_reply'),
        async ({ board_id, post_id, body, ai_provenance, ai_provenance_id }) => {
            // The whole reply is services/board-post.ts: the board's ACCESS rule (which neither door
            // applied to a reply — both checked only that the parent post existed), the body bound,
            // the provenance stamp with the board's REAL visibility (this tool stamped every reply
            // 'public', so one on a private board carried a public-surface label), the record, the
            // change event and the subscriber fan-out.
            const session = caller();
            const out = await createBoardReply({ storage, config }, { gaii: session.principal, roles: [...session.roles] }, {
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
        zodShapeFor('aimeat_board_members'),
        annotationsFor('aimeat_board_members'),
        async ({ board_id, add, remove }) => {
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: 'Board not found' }], isError: true };

            // Auth: agent's owner must be the board owner. This check stays on the door because the
            // two doors answer it differently on purpose — PATCH /v1/boards/:id/members demands an
            // owner session and rejects every agent session, while here an agent holding
            // `social:members` acts for its owner, which is what makes an agent a first-class user.
            const agentOwner = localAccountName(agentGaii);
            const boardOwner = localAccountName(board.ownerGaii);
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
        zodShapeFor('aimeat_board_delete'),
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
