/**
 * @file src/storage/providers/postgres-kysely/methods/feedback.ts
 * @description Node Feedback Channel domain for the Postgres+Kysely backend: platform-feedback
 *   threads from authenticated principals to the node operator. Thread CRUD, sender listing, and
 *   the operator inbox with status/category filters. `context` and `messages` are jsonb columns.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import type { Selectable } from 'kysely';
import type { FeedbackRecord } from '../../../interface.js';
import type { Feedback } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toFeedback(r: Selectable<Feedback>): FeedbackRecord {
  return {
    id: r.id, sender: r.sender, category: r.category as FeedbackRecord['category'],
    title: r.title, body: r.body,
    context: (r.context ?? undefined) as FeedbackRecord['context'],
    status: r.status as FeedbackRecord['status'],
    messages: (r.messages ?? []) as unknown as FeedbackRecord['messages'],
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const feedbackMethods = {
  async createFeedback(this: PostgresKyselyStorage, r: FeedbackRecord): Promise<FeedbackRecord> {
    await this.db.insertInto('Feedback').values({
      id: r.id, sender: r.sender, category: r.category, title: r.title, body: r.body,
      context: r.context ? jsonb(r.context) : null, status: r.status, messages: jsonb(r.messages),
      createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getFeedback(this: PostgresKyselyStorage, id: string): Promise<FeedbackRecord | null> {
    const r = await this.db.selectFrom('Feedback').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toFeedback(r) : null;
  },
  async listFeedbackBySender(this: PostgresKyselyStorage, sender: string): Promise<FeedbackRecord[]> {
    const rows = await this.db.selectFrom('Feedback').selectAll().where('sender', '=', sender).orderBy('createdAt', 'desc').execute();
    return rows.map(toFeedback);
  },
  async listFeedback(this: PostgresKyselyStorage, opts?: { status?: string; category?: string; page?: number; perPage?: number }): Promise<FeedbackRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('Feedback').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.category) q = q.where('category', '=', opts.category);
    const rows = await q.orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    return rows.map(toFeedback);
  },
  async updateFeedback(this: PostgresKyselyStorage, id: string, updates: Partial<Pick<FeedbackRecord, 'status' | 'messages' | 'updatedAt'>>): Promise<FeedbackRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.messages) data.messages = jsonb(updates.messages);
    data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : new Date();
    const rows = await this.db.updateTable('Feedback').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toFeedback(rows[0]) : null;
  },
};
