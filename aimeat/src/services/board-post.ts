/**
 * @file src/services/board-post.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Posting to a board, once, for every surface that can post.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/boards/:boardId/posts` loads the board and rules on the post
 *   before writing it. `aimeat_board_post` never loaded the board at all, so it had none of it:
 *
 *     - ACCESS. A private board takes posts from its owner only; a shared board from its owner, the
 *       same owner's other principals, and whoever is on `allowedGaiis`; a system board from an
 *       operator. Over MCP any agent holding `social:write` posted into any of them, including
 *       another owner's private board.
 *     - THE COST. A public board charges morsels per post, scaled by length, and refuses with 402
 *       when the balance does not cover it. Over MCP it was free, so the anti-flood price on the one
 *       surface everybody reads applied only to the door nobody uses.
 *     - THE EXTENSION HOOK. `pre_board_post` lets an installed extension refuse a post. It never ran
 *       over MCP, so a moderation extension was advisory on the agent surface.
 *     - THE SHAPE. Title 1-256, body 1-200 000, category up to 64, at most 20 tags of 64. The tool
 *       took `z.string()` for both, so an empty post and an arbitrarily large one both stored.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - BOARD_POST_LIMITS — the shape bounds, shared with the REST validator
 *   - createBoardPost() — access, hook, price, provenance, record; a refusal or the post
 *   - createBoardReply() — the same access rule, which neither door applied to a reply
 *   - boardPostPrice() — the board's own price or the node's, plus the per-kB flood price
 *   - updateBoardPost() — a notice taken down as handled, or given more time
 * @usage
 *   const out = await createBoardPost({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.2.0 — 2026-08-30 — The board's own rules (RFC §27) decide who posts, which categories a
 *     notice may carry, how long it lives by default and what it costs; updateBoardPost() takes a
 *     notice down as handled or moves its expiry.
 *   v1.1.0 — 2026-08-30 — A reply inherits its parent's expiry; it used to carry none and outlived
 *     the notice it answered.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 3, option B: shared service, gate inside).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardPostRecord, BoardRecord } from '../storage/interface.js';
import { executeHooks } from './hooks.js';
import { provenanceForWrite } from './ai-provenance.js';
import { isSameOwner } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { notifyBoardSubscribers } from './board-subscribers.js';

/** The bounds BoardPostSchema applies on the HTTP door, named here so both doors share them. */
export const BOARD_POST_LIMITS = {
    titleMax: 256,
    bodyMax: 200_000,
    categoryMax: 64,
    tagsMax: 20,
    tagMax: 64,
} as const;

export interface BoardPostCaller {
    /** The resolved identity that authors the post. */
    gaii: string;
    roles: string[];
}

export interface BoardPostInput {
    boardId: string;
    title: string;
    body: string;
    category?: string;
    tags?: string[];
    ttlHours?: number;
    declaredProvenanceId?: string;
    declaredProvenance?: Parameters<typeof provenanceForWrite>[1]['declared'];
    /** Which road this came down, for the provenance record. */
    pipeline: string;
}

export type BoardPostResult =
    | { ok: true; post: BoardPostRecord; charged: number }
    | { ok: false; status: number; code: string; message: string };

/** Default lifetime of a post when the caller names none: seven days, as the route has always used. */
const DEFAULT_TTL_HOURS = 168;


/**
 * May this caller put text on this board? A post and a reply ask the same question.
 *
 * A private board is its owner's alone. On a shared or public board the board's own posting rule
 * decides, and its default is what the visibility always meant: a shared board takes posts from its
 * keeper, the keeper's other principals and the roster; a public one from anyone signed in. A
 * keeper may narrow either to 'owner' (an announcements board) or a public one to 'members'.
 */
function boardPostAccessRefusal(
    board: Pick<BoardRecord, 'visibility' | 'ownerGaii' | 'allowedGaiis' | 'rules'>,
    caller: BoardPostCaller,
): { ok: false; status: number; code: string; message: string } | null {
    if (board.visibility === 'system' && !caller.roles.includes('operator')) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only operators can post to system boards' };
    }
    if (board.visibility === 'private' && board.ownerGaii !== caller.gaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Cannot post to this private board' };
    }
    if (board.visibility === 'shared' || board.visibility === 'public') {
        const posting = board.rules?.posting ?? (board.visibility === 'public' ? 'anyone' : 'members');
        const own = board.ownerGaii === caller.gaii || isSameOwner(board.ownerGaii, caller.gaii);
        if (posting === 'owner' && !own) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the keeper of this board publishes on it. You can read it, reply is closed too; ask the keeper if you have something for the board.' };
        }
        if (posting === 'members' && !own && !board.allowedGaiis.includes(caller.gaii)) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You are not invited to this board' };
        }
    }
    return null;
}

/** What one post on this board costs its author: the board's own price, or the node's, plus the per-kB flood price. A board priced at 0 is free. */
export function boardPostPrice(board: Pick<BoardRecord, 'visibility' | 'rules'>, config: Pick<AimeatConfig, 'boardPostBaseCost' | 'boardPostCostPerKb'>, bodyLength: number): number {
    if (board.visibility !== 'public') return 0;
    const base = board.rules?.postCost ?? config.boardPostBaseCost;
    if (base === 0) return 0;
    return base + Math.ceil((bodyLength / 1000) * config.boardPostCostPerKb);
}

/**
 * Write one board post. The order is the route's order, and every step in it is a step the MCP tool
 * did not have.
 */
export async function createBoardPost(
    deps: { storage: Storage; config: AimeatConfig },
    caller: BoardPostCaller,
    input: BoardPostInput,
): Promise<BoardPostResult> {
    const { storage, config } = deps;

    const board = await storage.getBoard(input.boardId);
    if (!board) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${input.boardId}` };
    }

    // Shape, before anything is charged or written.
    const title = String(input.title ?? '').trim();
    const body = String(input.body ?? '');
    if (!title || title.length > BOARD_POST_LIMITS.titleMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `title must be 1-${BOARD_POST_LIMITS.titleMax} characters` };
    }
    if (!body || body.length > BOARD_POST_LIMITS.bodyMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `body must be 1-${BOARD_POST_LIMITS.bodyMax} characters` };
    }
    if (input.category && input.category.length > BOARD_POST_LIMITS.categoryMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `category must be at most ${BOARD_POST_LIMITS.categoryMax} characters` };
    }
    const tags = Array.isArray(input.tags) ? input.tags : [];
    if (tags.length > BOARD_POST_LIMITS.tagsMax || tags.some(t => String(t).length > BOARD_POST_LIMITS.tagMax)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `at most ${BOARD_POST_LIMITS.tagsMax} tags of ${BOARD_POST_LIMITS.tagMax} characters` };
    }
    // A board that names its categories takes a notice under one of them or under none.
    const allowedCategories = board.rules?.categories;
    if (input.category && allowedCategories?.length && !allowedCategories.includes(input.category)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `This board files notices under ${allowedCategories.join(', ')}. Pick one of those as the category, or leave it out.` };
    }

    // An installed extension may refuse the post. Advisory on one surface is not a moderation rule.
    const hook = await executeHooks(config, storage, 'pre_board_post', { board_id: input.boardId, author_gaii: caller.gaii });
    if (!hook.allowed) {
        return { ok: false, status: 403, code: 'HOOK_REJECTED', message: hook.reason ?? 'Post denied by extension hook' };
    }

    // Who may post here — the same question a REPLY asks, which is why it is its own function.
    const denied = boardPostAccessRefusal(board, caller);
    if (denied) return denied;

    // A public board costs, scaled by length. This is the anti-flood price on the one surface
    // everybody reads, and it applied only to the HTTP door. The board's own price, when its keeper
    // set one, replaces the node's base price; a board priced at 0 is free.
    const charged = boardPostPrice(board, config, body.length);
    if (charged > 0) {
        const debited = await storage.debitBalance(caller.gaii, charged);
        if (!debited) {
            return { ok: false, status: 402, code: 'INSUFFICIENT_MORSELS', message: `Posting costs ${charged} morsels` };
        }
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: caller.gaii,
            type: 'spent',
            amount: -charged,
            timestamp: new Date().toISOString(),
        });
    }

    // The hash covers title + body together, which is the unit a reader sees.
    const aiProvenanceId = await provenanceForWrite(storage, {
        principal: caller.gaii,
        content: `${title}\n\n${body}`,
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance,
        pipeline: input.pipeline,
        surface: { visibility: board.visibility === 'public' ? 'public' : 'private', humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
    });

    const hours = input.ttlHours ?? board.rules?.defaultTtlHours ?? DEFAULT_TTL_HOURS;
    const post = await storage.createPost({
        id: `post-${randomBytes(8).toString('hex')}`,
        boardId: input.boardId,
        authorGaii: caller.gaii,
        title,
        body,
        category: input.category,
        tags,
        ttlExpiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
        reactions: {},
        createdAt: new Date().toISOString(),
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });

    // The two things that happen BESIDES the write, and both lived in the HTTP route so the tool
    // surface had neither. A board open in a browser listens on the 'boards' domain, so without the
    // event an agent's post did not appear until somebody reloaded; and a subscriber is an agent
    // that asked to be told precisely so it need not poll, so a post made through a tool call was
    // invisible to every one of them. Both belong to POSTING, not to the door it came through.
    emitChange('boards');
    notifyBoardSubscribers(storage, input.boardId, {
        id: post.id,
        authorGaii: caller.gaii,
        title: post.title,
        category: post.category,
        tags: post.tags ?? [],
    });

    return { ok: true, post, charged };
}

export type BoardPostUpdateResult =
    | { ok: true; resolved: true; postId: string }
    | { ok: true; resolved: false; post: BoardPostRecord }
    | { ok: false; status: number; code: string; message: string };

/**
 * What happens to a notice after it is up: its author, or the board's keeper, takes it down as
 * handled (the bike is sold, the cat is home) or gives it more time. Taking it down is a delete:
 * a handled notice has nothing left to say, and the board does not keep an archive of it.
 */
export async function updateBoardPost(
    deps: { storage: Storage; config: AimeatConfig },
    caller: BoardPostCaller,
    input: { boardId: string; postId: string; ttlHours?: number; resolved?: boolean },
): Promise<BoardPostUpdateResult> {
    const { storage } = deps;
    const post = await storage.getPost(input.boardId, input.postId);
    if (!post) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Post not found: ${input.postId}` };
    const board = await storage.getBoard(input.boardId);
    if (!board) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${input.boardId}` };

    const own = post.authorGaii === caller.gaii || board.ownerGaii === caller.gaii || caller.roles.includes('operator');
    if (!own) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the author or the board keeper can change this notice. To answer it, reply instead.' };
    }

    if (input.resolved === true) {
        await storage.deletePost(input.boardId, input.postId);
        emitChange('boards');
        return { ok: true, resolved: true, postId: input.postId };
    }
    const hours = Number(input.ttlHours);
    if (!Number.isFinite(hours) || hours <= 0) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Provide ttl_hours to extend the notice, or resolved: true to take it down' };
    }
    const ttlExpiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
    await storage.updatePostExpiry(input.boardId, input.postId, ttlExpiresAt);
    emitChange('boards');
    return { ok: true, resolved: false, post: { ...post, ttlExpiresAt } };
}

export type BoardReplyResult =
    | { ok: true; reply: BoardPostRecord }
    | { ok: false; status: number; code: string; message: string };

/**
 * Reply to a post on a board.
 *
 * Two things were wrong with this being written out twice. Neither copy applied the board's ACCESS
 * rule — both checked only that the parent post exists — so a reply could land on a board the
 * replier may not post to, which the post path has always refused. And the MCP copy stamped the
 * provenance with `visibility: 'public'` unconditionally, so a reply on a PRIVATE board carried a
 * public-surface label; the HTTP copy read the board and got it right.
 *
 * The hash covers the BODY alone. The "Re: …" title is generated here, and hashing our own prefix
 * would describe bytes the author never wrote.
 */
export async function createBoardReply(
    deps: { storage: Storage; config: AimeatConfig },
    caller: BoardPostCaller,
    input: {
        boardId: string;
        postId: string;
        body: string;
        declaredProvenanceId?: string;
        declaredProvenance?: Parameters<typeof provenanceForWrite>[1]['declared'];
        pipeline: string;
    },
): Promise<BoardReplyResult> {
    const { storage, config } = deps;

    const parent = await storage.getPost(input.boardId, input.postId);
    if (!parent) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Post not found' };

    const board = await storage.getBoard(input.boardId);
    if (!board) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${input.boardId}` };

    // A reply is a post. Who may post here is the same question, and neither door was asking it.
    const denied = boardPostAccessRefusal(board, caller);
    if (denied) return denied;

    const body = String(input.body ?? '');
    if (!body || body.length > BOARD_POST_LIMITS.bodyMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `body must be 1-${BOARD_POST_LIMITS.bodyMax} characters` };
    }

    const aiProvenanceId = await provenanceForWrite(storage, {
        principal: caller.gaii,
        content: body,
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance,
        pipeline: input.pipeline,
        surface: { visibility: board.visibility === 'public' ? 'public' : 'private', humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
    });

    // A reply lives as long as the notice it answers. Until 2026-08-30 it carried no expiry at all,
    // so replies outlived their parents and the TTL sweep never reached them.
    const reply = await storage.createPost({
        id: `reply-${randomBytes(8).toString('hex')}`,
        boardId: input.boardId,
        authorGaii: caller.gaii,
        title: `Re: ${parent.title}`,
        body,
        tags: [],
        reactions: {},
        replyTo: input.postId,
        ...(parent.ttlExpiresAt ? { ttlExpiresAt: parent.ttlExpiresAt } : {}),
        createdAt: new Date().toISOString(),
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });

    emitChange('boards');
    notifyBoardSubscribers(storage, input.boardId, {
        id: reply.id, authorGaii: caller.gaii, title: reply.title, tags: [],
    });
    return { ok: true, reply };
}
