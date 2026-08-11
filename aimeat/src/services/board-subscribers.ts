/**
 * @file src/services/board-subscribers.ts
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
 * @structure
 *   - notifyBoardSubscribers() — one call per post, returns immediately
 * @usage notifyBoardSubscribers(storage, boardId, { id, authorGaii, title, category, tags });
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from routes/boards.ts so both doors notify (August 2026 audit,
 *     the side-effect sweep).
 */
import type { Storage } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/** How long a subscriber's callback has to answer before the delivery is abandoned. */
const CALLBACK_TIMEOUT_MS = 10_000;

export function notifyBoardSubscribers(
    storage: Storage,
    boardId: string,
    post: { id: string; authorGaii: string; title: string; category?: string; tags: string[] },
): void {
    storage.listBoardSubscriptions(boardId).then(subs => {
        for (const sub of subs) {
            // Don't notify the author of their own post
            if (sub.gaii === post.authorGaii) continue;
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
