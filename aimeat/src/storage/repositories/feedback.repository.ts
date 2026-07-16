/**
 * @file feedback.repository.ts
 * @description Repository interface for the Node Feedback Channel — platform-feedback threads
 *   from authenticated principals (GHII/GAII/GEAI) to the node operator, with a two-party
 *   sender↔operator reply chain and operator triage statuses.
 * @structure FeedbackRepository — thread CRUD + sender/operator listings, mirrored across
 *   PostgreSQL+Kysely and SQLite.
 * @usage import type { FeedbackRepository } from '../interface.js'; (composed into Storage)
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial creation (Node Feedback Channel v1).
 */

import type { FeedbackRecord } from '../interface.js';

export interface FeedbackRepository {
  createFeedback(record: FeedbackRecord): Promise<FeedbackRecord>;
  getFeedback(id: string): Promise<FeedbackRecord | null>;
  /** A sender's own threads, newest first. `sender` is the RESOLVED principal id. */
  listFeedbackBySender(sender: string): Promise<FeedbackRecord[]>;
  /** Operator inbox, newest first, with optional status/category filters + paging. */
  listFeedback(opts?: { status?: string; category?: string; page?: number; perPage?: number }): Promise<FeedbackRecord[]>;
  /** Patch a thread (status triage and/or replacing the messages array). Returns null when missing. */
  updateFeedback(id: string, updates: Partial<Pick<FeedbackRecord, 'status' | 'messages' | 'updatedAt'>>): Promise<FeedbackRecord | null>;
}
