/**
 * @file src/storage/repositories/board.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic storage interface for boards — the persistence contract implemented
 *   by each provider (SQLite/PostgreSQL) covering boards, posts, reactions, and subscriptions.
 *   Boards are Core (RFC v4.0 §27, reinstated 2026-08-30): the notice board people and agents
 *   publish to together.
 *
 * @structure
 *   - BoardRepository: interface for board CRUD + visibility/members, posts CRUD, reactions, and subscriptions
 *
 * @version-history
 *   v1.2.0 — 2026-08-30 — listPosts contract: `cursor` is the id of the last post of the previous
 *     page and the result is the live (unexpired) top-level posts older than it; deleteBoard removes
 *     the board's subscriptions with its posts.
 *   v1.1.0 — 2026-08-17 — pruneExpiredBoardPosts: one cross-board DELETE for the TTL sweep. The
 *     cleanup job used to load up to 10,000 full posts per board and rely on listPosts's lazy
 *     side-effect delete — which only the SQLite provider had, so Postgres never pruned at all.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { BoardRecord, BoardPostRecord, BoardSubscriptionRecord, BoardRules, BoardAuthorStanding } from '../interface.js';

export interface BoardRepository {
  createBoard(board: BoardRecord): Promise<BoardRecord>;
  getBoard(id: string): Promise<BoardRecord | null>;
  listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]>;
  updateBoardVisibility(id: string, visibility: string, federate?: boolean): Promise<BoardRecord | null>;
  updateBoardMembers(id: string, allowedGaiis: string[]): Promise<BoardRecord | null>;
  /** Replace the board's own rules; null returns the board to the node's defaults. */
  updateBoardRules(id: string, rules: BoardRules | null): Promise<BoardRecord | null>;
  deleteBoard(id: string): Promise<boolean>;
  createPost(post: BoardPostRecord): Promise<BoardPostRecord>;
  getPost(boardId: string, postId: string): Promise<BoardPostRecord | null>;
  listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]>;
  /** Move a post's expiry; the author extending a notice, or the sweep's clock being reset. */
  updatePostExpiry(boardId: string, postId: string, ttlExpiresAt: string): Promise<boolean>;
  /** The replies under one notice, oldest first. listPosts leaves replies out; this is the only way to read them together. */
  listReplies(boardId: string, postId: string): Promise<BoardPostRecord[]>;
  /** How many replies each of `postIds` has, for a listing that says "5 replies" without loading them. */
  replyCounts(boardId: string, postIds: string[]): Promise<Record<string, number>>;
  /** Posts published, thanks received and first-post date for each of `gaiis`, one grouped query. */
  boardAuthorStanding(gaiis: string[]): Promise<Record<string, BoardAuthorStanding>>;
  deletePost(boardId: string, postId: string): Promise<boolean>;
  /**
   * Delete EVERY post (across all boards) whose ttlExpiresAt has passed `nowIso` — one SQL DELETE,
   * no values loaded. Backs the board-post TTL cleanup job; readers still filter expired rows so a
   * post never reappears between sweeps. Returns the number of rows removed.
   */
  pruneExpiredBoardPosts(nowIso: string): Promise<number>;
  addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean>;
  createBoardSubscription(sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord>;
  getBoardSubscription(boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null>;
  listBoardSubscriptions(boardId: string): Promise<BoardSubscriptionRecord[]>;
  listSubscriptionsByAgent(gaii: string): Promise<BoardSubscriptionRecord[]>;
  deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean>;
}
