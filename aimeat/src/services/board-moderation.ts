/**
 * @file src/services/board-moderation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which board posts are hidden by flags, and who may still see them. RFC v4.0 §27 and
 *   §29 say a post past the auto-hide threshold is left out of listings; until 2026-08-30 the
 *   threshold was computed in two places (the flag write and the flag summary) and enforced in
 *   none, so a flagged post stayed visible to every reader, anonymous ones included. Both the HTTP
 *   listing and aimeat_board_read call this, so the rule has one home.
 *
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import type { BoardPostRecord, BoardRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config-types.js';

export type BoardModerationDeps = { storage: Storage; config: AimeatConfig };

/**
 * The ids among `postIds` whose active flag count has reached the node's auto-hide threshold.
 * One flag query per post; a page is at most 100 posts and flags on a board post are rare, so
 * the cost is the page size, not the board size.
 */
export async function hiddenBoardPostIds(deps: BoardModerationDeps, postIds: string[]): Promise<Set<string>> {
    const { storage, config } = deps;
    const hidden = new Set<string>();
    const threshold = config.autoHideThreshold;
    if (!Number.isFinite(threshold) || threshold <= 0) return hidden;
    await Promise.all(postIds.map(async id => {
        const flags = await storage.getFlagsByTarget('board_post', id);
        if (flags.filter(f => f.status === 'active').length >= threshold) hidden.add(id);
    }));
    return hidden;
}

/** The author of a hidden post and the board's owner still see it; everyone else does not. */
export function maySeeHiddenPost(post: Pick<BoardPostRecord, 'authorGaii'>, board: Pick<BoardRecord, 'ownerGaii'>, viewer: string | undefined): boolean {
    return !!viewer && (viewer === post.authorGaii || viewer === board.ownerGaii);
}

/** `posts` minus the ones flags have hidden from this viewer. */
export async function withoutHiddenPosts<T extends Pick<BoardPostRecord, 'id' | 'authorGaii'>>(
    deps: BoardModerationDeps,
    board: Pick<BoardRecord, 'ownerGaii'>,
    viewer: string | undefined,
    posts: T[],
): Promise<T[]> {
    if (posts.length === 0) return posts;
    const hidden = await hiddenBoardPostIds(deps, posts.map(p => p.id));
    if (hidden.size === 0) return posts;
    return posts.filter(p => !hidden.has(p.id) || maySeeHiddenPost(p, board, viewer));
}
