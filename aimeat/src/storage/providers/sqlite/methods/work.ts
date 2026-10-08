/**
 * @file src/storage/providers/sqlite/methods/work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Work methods, the twin of postgres-kysely/methods/work.ts. Extracted from sqlite/index.ts
 *   to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge. The board
 *   history below now belongs to methods/boards.ts.
 * @version-history
 *   v1.8.0 — 2026-10-08 — Work round-trips aiProvenanceId, the record of the delivered output
 *     (migration 0098, aiprov D8).
 *   v1.7.0 — 2026-10-05 — createAction, getAction, listActions, deleteAction, listActionsByProvider,
 *     countActionsForProviders, updateAction, deserializeAction moved to actions.ts; addTransaction,
 *     getTransactions, findTransactionByTrackingCode, listAllTransactions, deserializeTransaction moved to
 *     wallet.ts; 27 methods (createBoard, getBoard, listBoards, …) moved to boards.ts; createOtk, getOtk,
 *     consumeOtk, deserializeOtk moved to otk.ts; setNodeKey, getNodeKey moved to system.ts; 9 methods
 *     (createDispute, getDispute, getDisputeByTrackingCode, …) moved to agent-msg-dispute-invite.ts so the
 *     file mirrors postgres-kysely/methods/work.ts (secaudit 2026-10, M8).
 *   v1.6.0 — 2026-09-09 — deleteActionsByProvider and deleteTransactions deleted: no caller.
 *   v1.5.1 — 2026-09-08 — The twin the v1.1.0 note warns about is gone: ../repos/board.ts and ten
 *     other repos files nothing imported were deleted after the E2E coverage sweep executed none of
 *     them on either backend. The methods here were the live ones all along.
 *   v1.5.0 — 2026-08-30 — boards.rules round-trips; updateBoardRules, updatePostExpiry and
 *     boardAuthorStanding (posts, thanks, first post per author in one grouped query); listReplies
 *     and replyCounts, since listPosts leaves replies out and nothing listed them.
 *   v1.4.0 — 2026-08-30 — listPosts pages in SQL (expiry, cursor with an id tie-break, LIMIT) instead
 *     of loading the whole board and deleting expired rows as a side effect of a read; deleteBoard
 *     removes the board's subscriptions with its posts.
 *   v1.3.0 — 2026-08-17 — pruneExpiredBoardPosts: one cross-board TTL DELETE for the cleanup job
 *     (which used to page 10,000 posts per board through listPosts just for its side-effect delete).
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 9 step 0: board posts round-trip `aiProvenanceId`.
 *     NOTE FOR WHOEVER TOUCHES BOARDS NEXT: ../repos/board.ts is a second, complete implementation
 *     of this same board domain and NOTHING IMPORTS IT. The methods here are the live ones (they are
 *     what index.ts merges onto the prototype). This was found the expensive way — by editing the
 *     repo file, watching the test still fail, and only then discovering the twin.
 *   v1.2.0 — 2026-08-16 — The wallet ledger resolves the principal on both sides, the way
 *     creditBalance/debitBalance already did: a row written with an agent GAII is filed under the
 *     owner GHII (initiatorGaii keeps who acted), and a lookup by an agent GAII resolves too, so the
 *     federation replay guard still finds what it wrote. Before this, an agent earning on a work item
 *     moved the owner balance and left a row no wallet surface could see.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type { WorkRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const workMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Work ──
  // ══════════════════════════════════════════════════════════

  async createWork(this: SqliteStorage, work: WorkRecord): Promise<WorkRecord> {
    this.db.prepare(
      `INSERT INTO work (trackingCode, status, actionId, providerGaii, requesterGaii, input, output, cost, ttlExpiresAt, callbackUrl, rating, createdAt, updatedAt, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      work.trackingCode, work.status, work.actionId,
      work.providerGaii, work.requesterGaii,
      JSON.stringify(work.input), work.output ? JSON.stringify(work.output) : null,
      JSON.stringify(work.cost), work.ttlExpiresAt,
      work.callbackUrl ?? null,
      work.rating ? JSON.stringify(work.rating) : null,
      work.createdAt, work.updatedAt,
      work.aiProvenanceId ?? null,
    );
    return work;
  },

  async getWork(this: SqliteStorage, trackingCode: string): Promise<WorkRecord | null> {
    const row = this.db.prepare('SELECT * FROM work WHERE trackingCode = ?').get(trackingCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeWork(row) : null;
  },

  async updateWork(this: SqliteStorage, trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
    const existing = await this.getWork(trackingCode);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE work SET status = ?, actionId = ?, providerGaii = ?, requesterGaii = ?,
       input = ?, output = ?, cost = ?, ttlExpiresAt = ?, callbackUrl = ?, rating = ?,
       createdAt = ?, updatedAt = ?, aiProvenanceId = ? WHERE trackingCode = ?`
    ).run(
      updated.status, updated.actionId, updated.providerGaii, updated.requesterGaii,
      JSON.stringify(updated.input), updated.output ? JSON.stringify(updated.output) : null,
      JSON.stringify(updated.cost), updated.ttlExpiresAt,
      updated.callbackUrl ?? null,
      updated.rating ? JSON.stringify(updated.rating) : null,
      updated.createdAt, updated.updatedAt,
      updated.aiProvenanceId ?? null,
      trackingCode,
    );
    return updated;
  },

  async listWorkByProvider(this: SqliteStorage, gaii: string): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  },

  async listWorkByRequester(this: SqliteStorage, gaii: string): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work WHERE requesterGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  },

  async countPendingWorkByProviders(this: SqliteStorage, providerGaiis: string[], statuses: string[]): Promise<number> {
    if (providerGaiis.length === 0 || statuses.length === 0) return 0;
    const pP = providerGaiis.map(() => '?').join(',');
    const pS = statuses.map(() => '?').join(',');
    const row = this.db.prepare(`SELECT count(*) AS n FROM work WHERE providerGaii IN (${pP}) AND status IN (${pS})`)
      .get(...providerGaiis, ...statuses) as { n: number };
    return row.n;
  },

  async listWorkByProviders(this: SqliteStorage, gaiis: string[]): Promise<WorkRecord[]> {
    if (gaiis.length === 0) return [];
    const p = gaiis.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM work WHERE providerGaii IN (${p})`).all(...gaiis) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  },

  async listWorkByRequesters(this: SqliteStorage, gaiis: string[]): Promise<WorkRecord[]> {
    if (gaiis.length === 0) return [];
    const p = gaiis.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM work WHERE requesterGaii IN (${p})`).all(...gaiis) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  },

  async listAllWork(this: SqliteStorage, limit = 10000): Promise<WorkRecord[]> {
    const rows = this.db.prepare('SELECT * FROM work ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeWork(r));
  },

  deserializeWork(this: SqliteStorage, row: Record<string, unknown>): WorkRecord {
    const record: WorkRecord = {
      trackingCode: row.trackingCode as string,
      status: row.status as string,
      actionId: row.actionId as string,
      providerGaii: row.providerGaii as string,
      requesterGaii: row.requesterGaii as string,
      input: JSON.parse(row.input as string),
      cost: JSON.parse(row.cost as string),
      ttlExpiresAt: row.ttlExpiresAt as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.output) record.output = JSON.parse(row.output as string);
    if (row.callbackUrl) record.callbackUrl = row.callbackUrl as string;
    if (row.rating) record.rating = JSON.parse(row.rating as string);
    if (row.aiProvenanceId) record.aiProvenanceId = row.aiProvenanceId as string;
    return record;
  },
};
