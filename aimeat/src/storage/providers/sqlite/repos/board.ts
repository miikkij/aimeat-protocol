/**
 * @file src/storage/providers/sqlite/repos/board.ts
 * @description SQLite (better-sqlite3) repository functions for boards — CRUD and (de)serialization
 *   for board records, posts, and subscriptions, with JSON-encoded array/object columns.
 *
 * @structure
 *   - deserializeBoard / deserializePost / deserializeBoardSubscription: row → record mappers
 *   - createBoard and related board / post / subscription query and mutation helpers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';
import type { BoardRecord, BoardPostRecord, BoardSubscriptionRecord } from '../../../interface.js';

function deserializeBoard(row: Record<string, unknown>): BoardRecord {
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
  return record;
}

function deserializePost(row: Record<string, unknown>): BoardPostRecord {
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
}

function deserializeBoardSubscription(row: Record<string, unknown>): BoardSubscriptionRecord {
  const record: BoardSubscriptionRecord = {
    id: row.id as string,
    boardId: row.boardId as string,
    gaii: row.gaii as string,
    createdAt: row.createdAt as string,
  };
  if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
  if (row.filters) record.filters = JSON.parse(row.filters as string);
  return record;
}

// ── Boards ──

export function createBoard(db: Database.Database, board: BoardRecord): BoardRecord {
  db.prepare(
    `INSERT INTO boards (id, name, description, visibility, ownerGaii, allowedGaiis, createdAt, semantic, federate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    board.id, board.name, board.description ?? null,
    board.visibility, board.ownerGaii,
    JSON.stringify(board.allowedGaiis), board.createdAt,
    board.semantic ? JSON.stringify(board.semantic) : null,
    board.federate ? 1 : 0,
  );
  return board;
}

export function getBoard(db: Database.Database, id: string): BoardRecord | null {
  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? deserializeBoard(row) : null;
}

export function listBoards(db: Database.Database, opts?: { visibility?: string; ownerGaii?: string }): BoardRecord[] {
  let sql = 'SELECT * FROM boards WHERE 1=1';
  const params: unknown[] = [];
  if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
  if (opts?.ownerGaii) { sql += ' AND ownerGaii = ?'; params.push(opts.ownerGaii); }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(r => deserializeBoard(r));
}

export function deleteBoard(db: Database.Database, id: string): boolean {
  db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(id);
  const result = db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Posts ──

export function createPost(db: Database.Database, post: BoardPostRecord): BoardPostRecord {
  db.prepare(
    `INSERT INTO board_posts (boardId, id, authorGaii, title, body, category, tags, ttlExpiresAt, reactions, replyTo, createdAt, semantic, aiProvenanceId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    post.boardId, post.id, post.authorGaii,
    post.title, post.body, post.category ?? null,
    JSON.stringify(post.tags), post.ttlExpiresAt ?? null,
    JSON.stringify(post.reactions), post.replyTo ?? null,
    post.createdAt,
    post.semantic ? JSON.stringify(post.semantic) : null,
    post.aiProvenanceId ?? null,
  );
  return post;
}

export function getPost(db: Database.Database, boardId: string, postId: string): BoardPostRecord | null {
  const row = db.prepare('SELECT * FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
  return row ? deserializePost(row) : null;
}

export function listPosts(db: Database.Database, boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): BoardPostRecord[] {
  const limit = opts?.limit ?? 20;
  const now = Date.now();

  let sql = 'SELECT * FROM board_posts WHERE boardId = ? AND replyTo IS NULL';
  const params: unknown[] = [boardId];
  if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
  sql += ' ORDER BY createdAt DESC';

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  let results: BoardPostRecord[] = [];
  for (const row of rows) {
    const post = deserializePost(row);
    if (post.ttlExpiresAt && new Date(post.ttlExpiresAt).getTime() < now) {
      db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(post.boardId, post.id);
      continue;
    }
    results.push(post);
  }

  if (opts?.cursor) {
    const idx = results.findIndex(p => p.id === opts.cursor);
    if (idx >= 0) results = results.slice(idx + 1);
  }
  return results.slice(0, limit);
}

export function deletePost(db: Database.Database, boardId: string, postId: string): boolean {
  const result = db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(boardId, postId);
  return result.changes > 0;
}

export function addReaction(db: Database.Database, boardId: string, postId: string, emoji: string, gaii: string): boolean {
  const row = db.prepare('SELECT reactions FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
  if (!row) return false;
  const reactions = JSON.parse(row.reactions as string) as Record<string, string[]>;
  if (!reactions[emoji]) reactions[emoji] = [];
  if (!reactions[emoji].includes(gaii)) reactions[emoji].push(gaii);
  db.prepare('UPDATE board_posts SET reactions = ? WHERE boardId = ? AND id = ?').run(
    JSON.stringify(reactions), boardId, postId,
  );
  return true;
}

// ── Board Subscriptions ──

export function createBoardSubscription(db: Database.Database, sub: BoardSubscriptionRecord): BoardSubscriptionRecord {
  db.prepare(
    `INSERT OR REPLACE INTO board_subscriptions (id, boardId, gaii, callbackUrl, filters, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    sub.id, sub.boardId, sub.gaii,
    sub.callbackUrl ?? null,
    sub.filters ? JSON.stringify(sub.filters) : null,
    sub.createdAt,
  );
  return sub;
}

export function getBoardSubscription(db: Database.Database, boardId: string, gaii: string): BoardSubscriptionRecord | null {
  const row = db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ? AND gaii = ?').get(boardId, gaii) as Record<string, unknown> | undefined;
  return row ? deserializeBoardSubscription(row) : null;
}

export function listBoardSubscriptions(db: Database.Database, boardId: string): BoardSubscriptionRecord[] {
  const rows = db.prepare('SELECT * FROM board_subscriptions WHERE boardId = ?').all(boardId) as Record<string, unknown>[];
  return rows.map(r => deserializeBoardSubscription(r));
}

export function listSubscriptionsByAgent(db: Database.Database, gaii: string): BoardSubscriptionRecord[] {
  const rows = db.prepare('SELECT * FROM board_subscriptions WHERE gaii = ?').all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeBoardSubscription(r));
}

export function deleteBoardSubscription(db: Database.Database, boardId: string, gaii: string): boolean {
  const result = db.prepare('DELETE FROM board_subscriptions WHERE boardId = ? AND gaii = ?').run(boardId, gaii);
  return result.changes > 0;
}
