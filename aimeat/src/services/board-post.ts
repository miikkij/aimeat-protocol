/**
 * @file src/services/board-post.ts
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
 * @usage
 *   const out = await createBoardPost({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 3, option B: shared service, gate inside).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardPostRecord } from '../storage/interface.js';
import { executeHooks } from './hooks.js';
import { provenanceForWrite } from './ai-provenance.js';
import { isSameOwner } from '../utils/gaii.js';

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

    // An installed extension may refuse the post. Advisory on one surface is not a moderation rule.
    const hook = await executeHooks(config, storage, 'pre_board_post', { board_id: input.boardId, author_gaii: caller.gaii });
    if (!hook.allowed) {
        return { ok: false, status: 403, code: 'HOOK_REJECTED', message: hook.reason ?? 'Post denied by extension hook' };
    }

    // Who may post here.
    if (board.visibility === 'system' && !caller.roles.includes('operator')) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only operators can post to system boards' };
    }
    if (board.visibility === 'private' && board.ownerGaii !== caller.gaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Cannot post to this private board' };
    }
    if (board.visibility === 'shared'
        && board.ownerGaii !== caller.gaii
        && !isSameOwner(board.ownerGaii, caller.gaii)
        && !board.allowedGaiis.includes(caller.gaii)) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You are not invited to this board' };
    }

    // A public board costs, scaled by length. This is the anti-flood price on the one surface
    // everybody reads, and it applied only to the HTTP door.
    let charged = 0;
    if (board.visibility === 'public') {
        charged = config.boardPostBaseCost + Math.ceil((body.length / 1000) * config.boardPostCostPerKb);
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

    const hours = input.ttlHours ?? DEFAULT_TTL_HOURS;
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

    return { ok: true, post, charged };
}
