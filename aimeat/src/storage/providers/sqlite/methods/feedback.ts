/**
 * @file src/storage/providers/sqlite/methods/feedback.ts
 * @description Node Feedback Channel domain for the SQLite backend: platform-feedback threads
 *   from authenticated principals to the node operator. Thread CRUD, sender listing, and the
 *   operator inbox with status/category filters. `context` and `messages` are JSON TEXT columns.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import type { FeedbackRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

function deserializeFeedback(row: Record<string, unknown>): FeedbackRecord {
  const record: FeedbackRecord = {
    id: row.id as string,
    sender: row.sender as string,
    category: row.category as FeedbackRecord['category'],
    title: row.title as string,
    body: row.body as string,
    status: row.status as FeedbackRecord['status'],
    messages: JSON.parse((row.messages as string) || '[]') as FeedbackRecord['messages'],
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
  if (row.context) record.context = JSON.parse(row.context as string) as Record<string, string>;
  return record;
}

export const feedbackMethods = {
  async createFeedback(this: SqliteStorage, record: FeedbackRecord): Promise<FeedbackRecord> {
    this.db.prepare(
      `INSERT INTO feedback (id, sender, category, title, body, context, status, messages, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.sender, record.category, record.title, record.body,
      record.context ? JSON.stringify(record.context) : null, record.status,
      JSON.stringify(record.messages), record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getFeedback(this: SqliteStorage, id: string): Promise<FeedbackRecord | null> {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserializeFeedback(row) : null;
  },

  async listFeedbackBySender(this: SqliteStorage, sender: string): Promise<FeedbackRecord[]> {
    const rows = this.db.prepare('SELECT * FROM feedback WHERE sender = ? ORDER BY createdAt DESC').all(sender) as Record<string, unknown>[];
    return rows.map(deserializeFeedback);
  },

  async listFeedback(this: SqliteStorage, opts?: { status?: string; category?: string; page?: number; perPage?: number }): Promise<FeedbackRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.status) { where.push('status = ?'); params.push(opts.status); }
    if (opts?.category) { where.push('category = ?'); params.push(opts.category); }
    const sql = `SELECT * FROM feedback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, perPage, (page - 1) * perPage) as Record<string, unknown>[];
    return rows.map(deserializeFeedback);
  },

  async updateFeedback(this: SqliteStorage, id: string, updates: Partial<Pick<FeedbackRecord, 'status' | 'messages' | 'updatedAt'>>): Promise<FeedbackRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (updates.status) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.messages) { sets.push('messages = ?'); params.push(JSON.stringify(updates.messages)); }
    sets.push('updatedAt = ?');
    params.push(updates.updatedAt ?? new Date().toISOString());
    this.db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return this.getFeedback(id);
  },
};
