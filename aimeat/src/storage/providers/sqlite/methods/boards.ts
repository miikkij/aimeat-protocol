/**
 * @file src/storage/providers/sqlite/methods/boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/boards.ts (boardMethods), so a fix in
 *   one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure boardMethods
 * @usage Object.assign(SqliteStorage.prototype, boardMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 27 methods (createBoard, getBoard, listBoards, …) moved here from work.ts so the
 *     file mirrors postgres-kysely/methods/boards.ts (secaudit 2026-10, M8).
 */
import type {
  BoardRecord, BoardPostRecord, BoardSubscriptionRecord, BoardRules, BoardAuthorStanding,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const boardMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Boards ──
  // ══════════════════════════════════════════════════════════

  async createBoard(this: SqliteStorage, board: BoardRecord): Promise<BoardRecord> {
    this.db.prepare(
      `INSERT INTO boards (id, name, description, visibility, ownerGaii, allowedGaiis, createdAt, semantic, federate, rules)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      board.id, board.name, board.description ?? null,
      board.visibility, board.ownerGaii,
      JSON.stringify(board.allowedGaiis), board.createdAt,
      board.semantic ? JSON.stringify(board.semantic) : null,
      board.federate ? 1 : 0,
      board.rules ? JSON.stringify(board.rules) : null,
    );
    return board;
  },

  async getBoard(this: SqliteStorage, id: string): Promise<BoardRecord | null> {
    const row = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeBoard(row) : null;
  },

  async listBoards(this: SqliteStorage, opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
    let sql = 'SELECT * FROM boards WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.ownerGaii) { sql += ' AND ownerGaii = ?'; params.push(opts.ownerGaii); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoard(r));
  },

  async updateBoardVisibility(this: SqliteStorage, id: string, visibility: string, federate?: boolean): Promise<BoardRecord | null> {
    if (federate !== undefined) {
      const result = this.db.prepare('UPDATE boards SET visibility = ?, federate = ? WHERE id = ?').run(visibility, federate ? 1 : 0, id);
      if (result.changes === 0) return null;
    } else {
      const result = this.db.prepare('UPDATE boards SET visibility = ? WHERE id = ?').run(visibility, id);
      if (result.changes === 0) return null;
    }
    return this.getBoard(id);
  },

  async updateBoardMembers(this: SqliteStorage, id: string, allowedGaiis: string[]): Promise<BoardRecord | null> {
    const result = this.db.prepare('UPDATE boards SET allowedGaiis = ? WHERE id = ?').run(JSON.stringify(allowedGaiis), id);
    if (result.changes === 0) return null;
    return this.getBoard(id);
  },

  async updateBoardRules(this: SqliteStorage, id: string, rules: BoardRules | null): Promise<BoardRecord | null> {
    const result = this.db.prepare('UPDATE boards SET rules = ? WHERE id = ?').run(rules ? JSON.stringify(rules) : null, id);
    if (result.changes === 0) return null;
    return this.getBoard(id);
  },

  async deleteBoard(this: SqliteStorage, id: string): Promise<boolean> {
    // Posts and subscriptions go with the board. A subscription to a board that no longer exists
    // was a phantom row on the subscriber's list until 2026-08-30.
    this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(id);
    this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(id);
    const result = this.db.prepare('DELETE FROM boards WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async createPost(this: SqliteStorage, post: BoardPostRecord): Promise<BoardPostRecord> {
    this.db.prepare(
      `INSERT INTO board_posts (boardId, id, authorGaii, title, body, category, tags, ttlExpiresAt, reactions, replyTo, createdAt, semantic, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      post.boardId, post.id, post.authorGaii,
      post.title, post.body, post.category ?? null,
      JSON.stringify(post.tags), post.ttlExpiresAt ?? null,
      JSON.stringify(post.reactions), post.replyTo ?? null,
      post.createdAt,
      post.semantic ? JSON.stringify(post.semantic) : null,
      // TARGET-058 (Phase 9 step 0). NULL = unstated, which is never "a human wrote it".
      post.aiProvenanceId ?? null,
    );
    return post;
  },

  /**
   * One post by id — and an expired one is gone here too, the way it is gone from listPosts below.
   *
   * Without the check a post whose lifetime had run out was gone from the board and still readable
   * at its own address, which is ending only in the list. The row is removed on the read that
   * notices, which is what listPosts does with the same condition.
   */
  async getPost(this: SqliteStorage, boardId: string, postId: string): Promise<BoardPostRecord | null> {
    const row = this.db.prepare('SELECT * FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const post = this.deserializePost(row);
    if (post.ttlExpiresAt && new Date(post.ttlExpiresAt).getTime() < Date.now()) {
      this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(boardId, postId);
      return null;
    }
    return post;
  },

  async listPosts(this: SqliteStorage, boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
    // One indexed query with the page in SQL. Until 2026-08-30 this loaded and deserialised every
    // post in the board to find the cursor in JS, and deleted expired rows as a side effect of a
    // read; the TTL sweep (pruneExpiredBoardPosts) owns deletion now. ISO-8601 strings order as
    // text, so expiry and the cursor are plain comparisons; ties on createdAt break on id so two
    // posts from the same millisecond cannot be skipped between pages.
    const limit = opts?.limit ?? 20;
    const nowIso = new Date().toISOString();

    let sql = 'SELECT * FROM board_posts WHERE boardId = ? AND replyTo IS NULL AND (ttlExpiresAt IS NULL OR ttlExpiresAt > ?)';
    const params: unknown[] = [boardId, nowIso];
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    if (opts?.cursor) {
      const at = this.db.prepare('SELECT createdAt FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, opts.cursor) as { createdAt: string } | undefined;
      if (at) {
        sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
        params.push(at.createdAt, at.createdAt, opts.cursor);
      }
    }
    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(row => this.deserializePost(row));
  },

  async deletePost(this: SqliteStorage, boardId: string, postId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(boardId, postId);
    return result.changes > 0;
  },

  async listReplies(this: SqliteStorage, boardId: string, postId: string): Promise<BoardPostRecord[]> {
    const rows = this.db.prepare('SELECT * FROM board_posts WHERE boardId = ? AND replyTo = ? ORDER BY createdAt ASC, id ASC').all(boardId, postId) as Record<string, unknown>[];
    return rows.map(row => this.deserializePost(row));
  },

  async replyCounts(this: SqliteStorage, boardId: string, postIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (postIds.length === 0) return out;
    const marks = postIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`SELECT replyTo, COUNT(*) AS n FROM board_posts WHERE boardId = ? AND replyTo IN (${marks}) GROUP BY replyTo`).all(boardId, ...postIds) as Array<{ replyTo: string; n: number }>;
    for (const r of rows) out[r.replyTo] = Number(r.n);
    return out;
  },

  async boardPostCounts(this: SqliteStorage, boardIds: string[]): Promise<Record<string, { posts: number; lastAt: string }>> {
    // The same "live top-level notice" the reader's listPosts sees: replies excluded, expired rows
    // excluded. ISO-8601 compares as text, so the expiry test is a plain comparison and MAX() gives
    // the newest write without loading a post.
    const out: Record<string, { posts: number; lastAt: string }> = {};
    if (boardIds.length === 0) return out;
    const marks = boardIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT boardId, COUNT(*) AS n, MAX(createdAt) AS lastAt
         FROM board_posts
        WHERE boardId IN (${marks}) AND replyTo IS NULL AND (ttlExpiresAt IS NULL OR ttlExpiresAt > ?)
        GROUP BY boardId`,
    ).all(...boardIds, new Date().toISOString()) as Array<{ boardId: string; n: number; lastAt: string | null }>;
    for (const r of rows) out[r.boardId] = { posts: Number(r.n), lastAt: r.lastAt ?? '' };
    return out;
  },

  async updatePostExpiry(this: SqliteStorage, boardId: string, postId: string, ttlExpiresAt: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE board_posts SET ttlExpiresAt = ? WHERE boardId = ? AND id = ?').run(ttlExpiresAt, boardId, postId);
    return result.changes > 0;
  },

  async boardAuthorStanding(this: SqliteStorage, gaiis: string[]): Promise<Record<string, BoardAuthorStanding>> {
    // One grouped query for the page's authors. json_array_length with a path answers NULL when the
    // post has no 'thanks' reactions, which COALESCE turns into the zero it means.
    const out: Record<string, BoardAuthorStanding> = {};
    if (gaiis.length === 0) return out;
    const marks = gaiis.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT authorGaii,
              SUM(CASE WHEN replyTo IS NULL THEN 1 ELSE 0 END) AS posts,
              SUM(COALESCE(json_array_length(reactions, '$.thanks'), 0)) AS thanks,
              MIN(createdAt) AS since
       FROM board_posts WHERE authorGaii IN (${marks}) GROUP BY authorGaii`,
    ).all(...gaiis) as Array<{ authorGaii: string; posts: number; thanks: number; since: string | null }>;
    for (const r of rows) {
      out[r.authorGaii] = { gaii: r.authorGaii, posts: Number(r.posts), thanks: Number(r.thanks), ...(r.since ? { since: r.since } : {}) };
    }
    return out;
  },

  async pruneExpiredBoardPosts(this: SqliteStorage, nowIso: string): Promise<number> {
    // ISO-8601 strings compare correctly as text, so this is one indexed-scan DELETE with no
    // values loaded — the TTL sweep no longer pages 10,000 posts per board through listPosts.
    const result = this.db.prepare('DELETE FROM board_posts WHERE ttlExpiresAt IS NOT NULL AND ttlExpiresAt < ?').run(nowIso);
    return result.changes;
  },

  async addReaction(this: SqliteStorage, boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const row = this.db.prepare('SELECT reactions FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    if (!row) return false;
    const reactions = JSON.parse(row.reactions as string) as Record<string, string[]>;
    if (!reactions[emoji]) reactions[emoji] = [];
    if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
    this.db.prepare('UPDATE board_posts SET reactions = ? WHERE boardId = ? AND id = ?').run(
      JSON.stringify(reactions), boardId, postId,
    );
    return true;
  },

  async removeReaction(this: SqliteStorage, boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const row = this.db.prepare('SELECT reactions FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    if (!row) return false;
    const reactions = JSON.parse(row.reactions as string) as Record<string, string[]>;
    const list = reactions[emoji];
    if (!list || !list.includes(gaii)) return false;
    const left = list.filter(g => g !== gaii);
    // Nobody left on it: the key goes, not an empty array that still counts as a reaction.
    if (left.length) reactions[emoji] = left; else delete reactions[emoji];
    this.db.prepare('UPDATE board_posts SET reactions = ? WHERE boardId = ? AND id = ?').run(
      JSON.stringify(reactions), boardId, postId,
    );
    return true;
  },

  deserializeBoard(this: SqliteStorage, row: Record<string, unknown>): BoardRecord {
    const record: BoardRecord = {
      id: row.id as string,
      name: row.name as string,
      visibility: row.visibility as BoardRecord['visibility'],
      ownerGaii: row.ownerGaii as string,
      allowedGaiis: JSON.parse(row.allowedGaiis as string) as string[],
      createdAt: row.createdAt as string,
    };
    if (row.description) record.description = row.description as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    record.federate = row.federate === 1;
    if (row.rules) record.rules = JSON.parse(row.rules as string) as BoardRules;
    return record;
  },

  deserializePost(this: SqliteStorage, row: Record<string, unknown>): BoardPostRecord {
    const record: BoardPostRecord = {
      id: row.id as string,
      boardId: row.boardId as string,
      authorGaii: row.authorGaii as string,
      title: row.title as string,
      body: row.body as string,
      tags: JSON.parse(row.tags as string) as string[],
      reactions: JSON.parse(row.reactions as string) as Record<string, string[]>,
      createdAt: row.createdAt as string,
    };
    if (row.category) record.category = row.category as string;
    if (row.ttlExpiresAt) record.ttlExpiresAt = row.ttlExpiresAt as string;
    if (row.replyTo) record.replyTo = row.replyTo as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Board Subscriptions ──
  // ══════════════════════════════════════════════════════════

  async createBoardSubscription(this: SqliteStorage, sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord> {
    this.db.prepare(
      `INSERT OR REPLACE INTO board_subscriptions (id, boardId, gaii, callbackUrl, filters, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      sub.id, sub.boardId, sub.gaii,
      sub.callbackUrl ?? null,
      sub.filters ? JSON.stringify(sub.filters) : null,
      sub.createdAt,
    );
    return sub;
  },

  async getBoardSubscription(this: SqliteStorage, boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ? AND gaii = ?').get(boardId, gaii) as Record<string, unknown> | undefined;
    return row ? this.deserializeBoardSubscription(row) : null;
  },

  async listBoardSubscriptions(this: SqliteStorage, boardId: string): Promise<BoardSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ?').all(boardId) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoardSubscription(r));
  },

  async listSubscriptionsByAgent(this: SqliteStorage, gaii: string): Promise<BoardSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM board_subscriptions WHERE gaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeBoardSubscription(r));
  },

  async deleteBoardSubscription(this: SqliteStorage, boardId: string, gaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM board_subscriptions WHERE boardId = ? AND gaii = ?').run(boardId, gaii);
    return result.changes > 0;
  },

  deserializeBoardSubscription(this: SqliteStorage, row: Record<string, unknown>): BoardSubscriptionRecord {
    const record: BoardSubscriptionRecord = {
      id: row.id as string,
      boardId: row.boardId as string,
      gaii: row.gaii as string,
      createdAt: row.createdAt as string,
    };
    if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
    if (row.filters) record.filters = JSON.parse(row.filters as string);
    return record;
  },
};
