/**
 * @file src/services/boards/posts-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One page of a board's posts as a caller may see it: the board read, who may read it
 *   (boardReadRefusal), the page, the posts flags have hidden (withoutHiddenPosts) and the board's
 *   classification (classifiedBoardPosts). GET /v1/boards/:boardId/posts and aimeat_board_read both
 *   call it, so the two surfaces ask the same gate around the same read (structure programme
 *   2026-11, unit 2b).
 *
 *   WHO. `reader` is the identity the read gate asks about, undefined for an unauthenticated caller
 *   or the shared anonymous principal (both surfaces work that out themselves, from req.auth or the
 *   session). `viewer` is the identity the hidden-post rule asks about; REST passes the reader, the
 *   tool its session's GAII, as each did before. `auth` is the caller's session, which an organism
 *   board and the classification reader are decided on.
 *
 *   A board that does not exist answers `missing`: REST answers an empty page, the tool "Board not
 *   found". Each surface keeps its own limit and its own rendering.
 * @structure boardPostsPage(deps, who, boardId, query) → { missing } | { refusal } | { board, page, posts }
 * @usage
 *   const page = await boardPostsPage({ storage, config }, { reader, viewer, auth: req.auth }, boardId, { category, cursor, limit });
 *   if ('missing' in page) …; if ('refusal' in page) refuse(page.refusal);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/boards.ts and mcp/core-boards.ts, which each held a copy
 *     (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, BoardRecord, BoardPostRecord } from '../../storage/interface.js';
import type { AudienceAuth } from '../audience.js';
import type { ReaderAuth } from '../classification/reader.js';
import { readerFor } from '../classification/reader.js';
import { boardReadRefusal, classifiedBoardPosts, type BoardReadRefusal } from '../board-read-access.js';
import { withoutHiddenPosts } from '../board-moderation.js';

export interface BoardPostsCaller {
    /** The identity the read gate asks about; undefined for an unauthenticated or anonymous caller. */
    reader: string | undefined;
    /** The identity the hidden-post rule asks about (the author or the board's owner sees a hidden post). */
    viewer: string | undefined;
    /** The caller's session: req.auth, or an MCP session's caller().auth. */
    auth: (AudienceAuth & ReaderAuth) | null | undefined;
}

export type BoardPostsPage =
    | { missing: true }
    | { refusal: BoardReadRefusal }
    /** `page` is the stored page before the flags and the classification: the cursor is cut from it. */
    | { board: BoardRecord; page: BoardPostRecord[]; posts: BoardPostRecord[] };

/**
 * The page of posts the caller may see, or why not. A page is `limit` live posts and the cursor walks
 * the whole board: a post flags have hidden is dropped AFTER the page is cut.
 */
export async function boardPostsPage(
    deps: { storage: Storage; config: AimeatConfig },
    who: BoardPostsCaller,
    boardId: string,
    query: { category?: string; cursor?: string; limit: number },
): Promise<BoardPostsPage> {
    const { storage, config } = deps;
    const board = await storage.getBoard(boardId);
    if (!board) return { missing: true };
    const refusal = await boardReadRefusal(deps, who.reader, board, who.auth);
    if (refusal) return { refusal };
    const page = await storage.listPosts(boardId, query);
    // A post reads as its board's classification (plan doc-mvdipuyqraas, L1.3), after the flags.
    const posts = await classifiedBoardPosts(readerFor({ storage, config }, who.auth), board,
        await withoutHiddenPosts(deps, board, who.viewer, page));
    return { board, page, posts };
}
