/**
 * @file src/services/board-subscribers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Telling a board's subscribers that a post landed.
 *
 *   It moved out of routes/boards.ts because the MCP door could not reach it there: the function was
 *   a closure inside workBoardRouter, so `aimeat_board_post` wrote the post and nobody heard about
 *   it. A subscriber is an agent that asked to be told — the whole point is that it does not poll —
 *   so a post made through a tool call was invisible to every one of them until they looked.
 *
 *   Fire-and-forget by design: a subscriber whose callback is down must not fail the post. The
 *   outbound call goes through safeFetch, which validates the URL and re-validates redirects, because
 *   the callback URL is supplied by the subscriber and a redirect bounce is otherwise an SSRF.
 *
 *   THE READ RULE IS ASKED AT DELIVERY, NOT ONLY AT SUBSCRIBE. A subscription row is a standing
 *   request, never standing authorization: between the subscribe and the post, the keeper can take
 *   the subscriber off the roster, an organism can drop its owner, or the board's level can narrow.
 *   Until 2026-10-20 none of those stopped the delivery, so a principal whose GET of the posts
 *   answered 403 still received every new post's board id, post id, author, title and category.
 * @structure
 *   - notifyBoardSubscribers() — one call per post, returns immediately
 *   - boardSubscriberAdmitted() — the read rule for one stored subscription
 * @usage notifyBoardSubscribers(storage, boardId, { id, authorGaii, title, category, tags });
 * @version-history
 *   2026-10-20 — Every delivery asks boardVisibleToCaller for the subscriber, and a subscription
 *     that no longer passes is deleted instead of delivered (secaudit 2026-10,
 *     board-subscribers:notify-without-read-recheck).
 *   v1.0.0 — 2026-08-11 — Extracted from routes/boards.ts so both doors notify (August 2026 audit,
 *     the side-effect sweep).
 */
import type { BoardRecord, Storage } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { localAccountOf } from '../utils/gaii.js';
import { boardVisibleToCaller } from './board-write.js';

/** How long a subscriber's callback has to answer before the delivery is abandoned. */
const CALLBACK_TIMEOUT_MS = 10_000;

/**
 * May this stored subscriber still read the board? The same rule subscribing asked
 * (boardVisibleToCaller), with the session facts rebuilt from the subscriber's own identity: an
 * organism board is decided on the stored membership, and an identity of another node belongs to no
 * organism here, so localAccountOf answers null for it and audience.ts refuses.
 */
export function boardSubscriberAdmitted(
    storage: Storage,
    board: Pick<BoardRecord, 'visibility' | 'ownerGaii' | 'allowedGaiis'>,
    gaii: string,
): Promise<boolean> {
    const owner = localAccountOf(gaii);
    return boardVisibleToCaller(storage, board, {
        gaii,
        auth: { sub: gaii, ...(owner ? { owner } : {}) },
    });
}

export function notifyBoardSubscribers(
    storage: Storage,
    boardId: string,
    post: { id: string; authorGaii: string; title: string; category?: string; tags: string[] },
): void {
    Promise.all([storage.getBoard(boardId), storage.listBoardSubscriptions(boardId)]).then(async ([board, subs]) => {
        if (!board) return;
        for (const sub of subs) {
            // Don't notify the author of their own post
            if (sub.gaii === post.authorGaii) continue;
            // Who may read the board is decided again here, because a subscription outlives the
            // access it was made under and no path that ends that access removes the row.
            if (!(await boardSubscriberAdmitted(storage, board, sub.gaii))) {
                await storage.deleteBoardSubscription(boardId, sub.gaii).catch(err =>
                    logger.warn('Board subscription of a reader without access could not be deleted', { boardId, gaii: sub.gaii, error: String(err) }));
                logger.info('Board subscription dropped: the subscriber may no longer read the board', { boardId, gaii: sub.gaii });
                continue;
            }
            // Apply category/tag filters if subscriber set them
            if (sub.filters?.categories?.length && post.category && !sub.filters.categories.includes(post.category)) continue;
            if (sub.filters?.tags?.length && !sub.filters.tags.some(t => post.tags.includes(t))) continue;
            if (!sub.callbackUrl) continue;
            safeFetch(sub.callbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'board.new_post',
                    board_id: boardId,
                    post_id: post.id,
                    author_gaii: post.authorGaii,
                    title: post.title,
                    category: post.category,
                    timestamp: new Date().toISOString(),
                }),
                signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
            }).catch(err => {
                logger.warn('Board subscription notification failed', { boardId, gaii: sub.gaii, error: String(err) });
            });
        }
    }).catch(err => { logger.warn('notifyBoardSubscribers: ignore', { error: String(err) }); });
}
