/**
 * @file src/services/board-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every board write except the post, once, for every surface that performs it.
 *
 *   WHY THIS FILE EXISTS. src/mcp/boards.ts carried its own copy of five writes that
 *   src/routes/boards.ts also performs: creating a board, subscribing to one, reacting to a post,
 *   changing the member roster and deleting the board. Each copy built the record, minted the id and
 *   emitted the change event on its own, and the copies had drifted:
 *
 *     - THE SHAPE. The HTTP door runs BoardCreateSchema (name 1-128, description up to 10 000) and
 *       BoardReactionSchema (reaction 1-32) before the handler sees the body. The tool declared
 *       z.string() for all three, so a board with an empty name, and a reaction of ten thousand
 *       characters, both stored.
 *     - THE OPERATOR RULE. HTTP reserves `public` AND `system` boards to operators. The tool checked
 *       `public` alone. Its own parameter list has no `system`, so nothing leaked through the gap,
 *       but the rule was written twice and only one copy said all of it.
 *     - FEDERATE. HTTP stores the flag on create. The tool never set it, so a board made over MCP
 *       had the column missing rather than false, and `federate ?? false` was carrying it.
 *     - THE ROSTER CALL WITH NOTHING IN IT. HTTP answers 400 when neither `add` nor `remove` is
 *       given. The tool wrote the unchanged roster back and reported success.
 *     - THE EVENT. Both copies remembered emitChange('boards'), which is what keeps an open board
 *       page current without a reload. Holding it in one place is what stops the NEXT board write
 *       from being the one that forgets.
 *
 *   WHAT DID NOT MOVE IS AUTHORIZATION FOR THE MEMBER ROSTER, and that is deliberate. The HTTP route
 *   demands an owner session and rejects every agent session, even an operator's; the MCP tool
 *   accepts an agent session holding `social:members` and requires only that the agent's owner owns
 *   the board. Agents are first-class users here, so the two doors are answering a question about
 *   session type that only each door can answer. setBoardMembers() therefore takes a board that its
 *   caller has already authorized, and each door keeps its own check where a reader can see it.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - BOARD_LIMITS — the bounds the HTTP schemas apply, named here so both doors share them
 *   - boardVisibleTo() — may this identity see the board at all
 *   - createBoard() — shape, the operator rule, the record, the event
 *   - subscribeToBoard() — visibility, the duplicate check, the subscription, the event
 *   - reactToBoardPost() — the reaction bound, the write, the event
 *   - setBoardMembers() — the roster arithmetic and the write, on an already-authorized board
 *   - deleteBoardById() — owner or operator, the delete, the event
 *   - normalizeBoardRules() / boardRulesBlock() / setBoardRules() — the board's own rules (RFC §27)
 * @usage
 *   const out = await createBoard({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.1.0 — 2026-08-30 — Boards are Core again (RFC §27). A board carries its own rules (who
 *     posts, categories, default lifetime, price), checked here for both doors. Any account may open
 *     a public board, up to config.boardPublicPerOwnerMax; a system board stays the operator's.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8, the boards unit): the five board writes
 *     the MCP tools were performing against storage directly.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardRecord, BoardRules, BoardSubscriptionRecord } from '../storage/interface.js';
import { isSameOwner } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';

/** The bounds BoardRulesSchema applies on the HTTP door. */
export const BOARD_RULE_LIMITS = {
    categoriesMax: 20,
    categoryMax: 64,
    ttlHoursMax: 8760,
    postCostMax: 100_000,
} as const;

const POSTING_RULES = ['owner', 'members', 'anyone'] as const;

/**
 * A board's rules as the keeper sent them (snake_case on the wire), checked and in record shape.
 * An empty object, or nothing, means the node's defaults; null on an update means the same.
 */
export function normalizeBoardRules(raw: unknown): { ok: true; rules?: BoardRules } | BoardWriteRefusal {
    if (raw === undefined || raw === null) return { ok: true };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'rules must be an object' };
    }
    const r = raw as Record<string, unknown>;
    const rules: BoardRules = {};
    if (r.posting !== undefined) {
        if (!(POSTING_RULES as readonly unknown[]).includes(r.posting)) {
            return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'rules.posting must be "owner", "members" or "anyone"' };
        }
        rules.posting = r.posting as BoardRules['posting'];
    }
    if (r.categories !== undefined) {
        const cats = Array.isArray(r.categories) ? r.categories.map(c => String(c).trim()).filter(Boolean) : null;
        if (!cats || cats.length > BOARD_RULE_LIMITS.categoriesMax || cats.some(c => c.length > BOARD_RULE_LIMITS.categoryMax)) {
            return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `rules.categories must be at most ${BOARD_RULE_LIMITS.categoriesMax} names of ${BOARD_RULE_LIMITS.categoryMax} characters` };
        }
        if (cats.length) rules.categories = [...new Set(cats)];
    }
    const ttl = r.default_ttl_hours ?? r.defaultTtlHours;
    if (ttl !== undefined) {
        const n = Number(ttl);
        if (!Number.isFinite(n) || n <= 0 || n > BOARD_RULE_LIMITS.ttlHoursMax) {
            return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `rules.default_ttl_hours must be between 0 and ${BOARD_RULE_LIMITS.ttlHoursMax}` };
        }
        rules.defaultTtlHours = n;
    }
    const cost = r.post_cost ?? r.postCost;
    if (cost !== undefined) {
        const n = Number(cost);
        if (!Number.isInteger(n) || n < 0 || n > BOARD_RULE_LIMITS.postCostMax) {
            return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `rules.post_cost must be a whole number of morsels from 0 to ${BOARD_RULE_LIMITS.postCostMax}` };
        }
        rules.postCost = n;
    }
    return Object.keys(rules).length ? { ok: true, rules } : { ok: true };
}

/** The rules on the wire: snake_case, and absent when the board runs on the node's defaults. */
export function boardRulesBlock(board: Pick<BoardRecord, 'rules'>): Record<string, unknown> | undefined {
    const r = board.rules;
    if (!r) return undefined;
    return {
        ...(r.posting ? { posting: r.posting } : {}),
        ...(r.categories ? { categories: r.categories } : {}),
        ...(r.defaultTtlHours !== undefined ? { default_ttl_hours: r.defaultTtlHours } : {}),
        ...(r.postCost !== undefined ? { post_cost: r.postCost } : {}),
    };
}

/** The bounds BoardCreateSchema and BoardReactionSchema apply on the HTTP door. */
export const BOARD_LIMITS = {
    nameMax: 128,
    descriptionMax: 10_000,
    reactionMax: 32,
} as const;

export interface BoardWriteDeps {
    storage: Storage;
    config: AimeatConfig;
}

export interface BoardWriteCaller {
    /** The resolved identity performing the write. */
    gaii: string;
    roles: string[];
}

export interface BoardWriteRefusal {
    ok: false;
    status: number;
    code: string;
    message: string;
}

const VISIBILITIES: readonly BoardRecord['visibility'][] = ['private', 'shared', 'public', 'system'];

/**
 * May this identity see the board at all? Public and system boards are open; a private board is its
 * owner's alone; a shared board also serves that owner's other principals and everyone on the
 * roster.
 *
 * This is the plain visibility rule, without the consent fallback boardReadRefusal() adds for
 * reading posts. Subscribing has always asked the plain question, on both doors.
 */
export function boardVisibleTo(
    board: Pick<BoardRecord, 'visibility' | 'ownerGaii' | 'allowedGaiis'>,
    gaii: string,
): boolean {
    if (board.visibility === 'public' || board.visibility === 'system') return true;
    if (board.ownerGaii === gaii) return true;
    if (board.visibility === 'shared' && isSameOwner(board.ownerGaii, gaii)) return true;
    return board.allowedGaiis.includes(gaii);
}

export type BoardCreateResult = { ok: true; board: BoardRecord } | BoardWriteRefusal;

export interface BoardCreateInput {
    name: string;
    visibility: BoardRecord['visibility'];
    description?: string;
    allowedGaiis?: string[];
    federate?: boolean;
    /** The board's own rules, as sent (see normalizeBoardRules). */
    rules?: unknown;
}

/** Create one board. The order is the HTTP route's order: shape, then who may open one, then write. */
export async function createBoard(
    deps: BoardWriteDeps,
    caller: BoardWriteCaller,
    input: BoardCreateInput,
): Promise<BoardCreateResult> {
    const { storage, config } = deps;

    const name = String(input.name ?? '').trim();
    if (!name || name.length > BOARD_LIMITS.nameMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `name must be 1-${BOARD_LIMITS.nameMax} characters` };
    }
    if (input.description && input.description.length > BOARD_LIMITS.descriptionMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `description must be at most ${BOARD_LIMITS.descriptionMax} characters` };
    }
    if (!VISIBILITIES.includes(input.visibility)) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'visibility must be "private", "shared", "public" or "system"' };
    }
    const rules = normalizeBoardRules(input.rules);
    if (!rules.ok) return rules;

    // A board the node itself speaks through is the operator's to create. A board everyone can read
    // was too, until 2026-08-30: a notice board a person keeps for their street or their club is the
    // shape RFC §27 exists for, so any account may open one, up to a count. The price on a public
    // post keeps the flood out of the board; this keeps the flood out of the catalogue.
    const operator = caller.roles.includes('operator');
    if (input.visibility === 'system' && !operator) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only operators can create system boards' };
    }
    if (input.visibility === 'public' && !operator) {
        const mine = (await storage.listBoards({ visibility: 'public' }))
            .filter(b => b.ownerGaii === caller.gaii || isSameOwner(b.ownerGaii, caller.gaii)).length;
        if (mine >= config.boardPublicPerOwnerMax) {
            return {
                ok: false, status: 403, code: 'BOARD_QUOTA',
                message: `You already keep ${mine} public boards, the most one account may here. Delete one to open another.`,
            };
        }
    }

    const board = await storage.createBoard({
        id: `board-${randomBytes(8).toString('hex')}`,
        name,
        description: input.description,
        visibility: input.visibility,
        ownerGaii: caller.gaii,
        allowedGaiis: input.allowedGaiis ?? [],
        federate: input.federate === true,
        createdAt: new Date().toISOString(),
        ...(rules.rules ? { rules: rules.rules } : {}),
    });

    // A board list open in a browser listens on the 'boards' domain. Without this the new board
    // waits for a reload.
    emitChange('boards');
    return { ok: true, board };
}

export type BoardSubscribeResult = { ok: true; subscription: BoardSubscriptionRecord } | BoardWriteRefusal;

/** Subscribe an identity to a board's new posts. */
export async function subscribeToBoard(
    deps: BoardWriteDeps,
    caller: BoardWriteCaller,
    input: {
        boardId: string;
        callbackUrl?: string;
        filters?: { categories?: string[]; tags?: string[] };
    },
): Promise<BoardSubscribeResult> {
    const { storage } = deps;

    const board = await storage.getBoard(input.boardId);
    if (!board) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${input.boardId}` };
    }
    if (!boardVisibleTo(board, caller.gaii)) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You do not have access to this board' };
    }

    const existing = await storage.getBoardSubscription(input.boardId, caller.gaii);
    if (existing) {
        return { ok: false, status: 409, code: 'CONFLICT', message: 'Already subscribed to this board' };
    }

    const subscription = await storage.createBoardSubscription({
        id: `sub-${randomBytes(8).toString('hex')}`,
        boardId: input.boardId,
        gaii: caller.gaii,
        callbackUrl: input.callbackUrl,
        filters: input.filters,
        createdAt: new Date().toISOString(),
    });

    // A subscription changes what the board view says about itself, so the open page hears it.
    emitChange('boards');
    return { ok: true, subscription };
}

export type BoardReactionResult = { ok: true } | BoardWriteRefusal;

/**
 * React to a post.
 *
 * The board is loaded and the READ rule applied, which is a change from how both doors behaved until
 * 2026-08-15. Before that neither door loaded the board, so a reaction landed on any post whose ids
 * the caller knew — a principal holding social:write could write their own GAII onto a post on a
 * private board they cannot read, post to or reply on, and could use the 200-versus-404 answer to
 * probe which post ids exist there. That was recorded as a known state rather than decided, and it is
 * decided now (E2E test-quality audit finding A30).
 *
 * The READ rule and not the POST rule, and the difference is the whole blast radius: boardVisibleTo
 * leaves public and system boards open to everyone, so reacting on a public board — the normal case,
 * and the only one any caller in this repo performs — is untouched. What closes is the private and
 * shared case, where reacting was a write onto somebody else's surface.
 */
export async function reactToBoardPost(
    deps: BoardWriteDeps,
    caller: BoardWriteCaller,
    input: { boardId: string; postId: string; reaction: string },
): Promise<BoardReactionResult> {
    const { storage } = deps;

    const reaction = String(input.reaction ?? '');
    if (!reaction || reaction.length > BOARD_LIMITS.reactionMax) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `reaction must be 1-${BOARD_LIMITS.reactionMax} characters` };
    }

    // 404 rather than 403 for a board the caller cannot see: the same answer a post that does not
    // exist gets, so the refusal does not become the probe it was closing.
    //
    // The same-owner clause is not decoration, and the E2E suite is what found it: boardVisibleTo
    // grants same-owner access only for `shared` boards, so on a PRIVATE board it refuses the
    // owner's own second agent — which is one person's two agents on one person's board, and
    // exactly the arrangement this node is built around. isSameOwner is the test the rest of the
    // codebase makes for that, so it is the test here.
    const board = await storage.getBoard(input.boardId);
    const mayReact = !!board && (boardVisibleTo(board, caller.gaii) || isSameOwner(board.ownerGaii, caller.gaii));
    if (!mayReact) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Post not found' };
    }

    const stored = await storage.addReaction(input.boardId, input.postId, reaction, caller.gaii);
    if (!stored) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Post not found' };
    }

    emitChange('boards');
    return { ok: true };
}

export type BoardMembersResult = { ok: true; board: BoardRecord } | BoardWriteRefusal;

/**
 * Apply an add/remove pair to a board's member roster.
 *
 * Takes the board record rather than its id because the caller has already loaded it to authorize
 * the change, and the two doors authorize this one differently on purpose: HTTP demands an owner
 * session, the MCP tool accepts an agent of the board's owner holding `social:members`.
 */
export async function setBoardMembers(
    deps: BoardWriteDeps,
    board: BoardRecord,
    changes: { add?: unknown; remove?: unknown },
): Promise<BoardMembersResult> {
    const { storage } = deps;

    if (!changes.add && !changes.remove) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Provide "add" and/or "remove" arrays' };
    }

    const members = new Set(board.allowedGaiis);
    if (Array.isArray(changes.add)) for (const g of changes.add) members.add(String(g));
    if (Array.isArray(changes.remove)) for (const g of changes.remove) members.delete(String(g));

    const updated = await storage.updateBoardMembers(board.id, [...members]);
    if (!updated) {
        return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to update board members' };
    }

    // Who may read a shared board is what this changes, so the members list on screen must hear it.
    emitChange('boards');
    return { ok: true, board: updated };
}

export type BoardRulesResult = { ok: true; board: BoardRecord } | BoardWriteRefusal;

/**
 * Replace a board's own rules. The caller has already established that `caller` keeps the board;
 * this checks the shape and writes. `raw` null returns the board to the node's defaults.
 */
export async function setBoardRules(
    deps: BoardWriteDeps,
    board: BoardRecord,
    raw: unknown,
): Promise<BoardRulesResult> {
    const { storage } = deps;
    const rules = normalizeBoardRules(raw);
    if (!rules.ok) return rules;
    const updated = await storage.updateBoardRules(board.id, rules.rules ?? null);
    if (!updated) {
        return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to update board rules' };
    }
    emitChange('boards');
    return { ok: true, board: updated };
}

export type BoardDeleteResult = { ok: true; boardId: string } | BoardWriteRefusal;

/** Delete a board. Its owner may, and so may an operator. */
export async function deleteBoardById(
    deps: BoardWriteDeps,
    caller: BoardWriteCaller,
    boardId: string,
): Promise<BoardDeleteResult> {
    const { storage } = deps;

    const board = await storage.getBoard(boardId);
    if (!board) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${boardId}` };
    }
    if (board.ownerGaii !== caller.gaii && !caller.roles.includes('operator')) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the board owner or operator can delete this board' };
    }

    await storage.deleteBoard(boardId);
    emitChange('boards');
    return { ok: true, boardId };
}
