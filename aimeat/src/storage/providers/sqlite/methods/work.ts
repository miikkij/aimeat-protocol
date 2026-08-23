/**
 * @file src/storage/providers/sqlite/methods/work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Action, Work, Wallet, Board, OTK, Node-key, Dispute, Micro-memory methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
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
import type {
  ActionRecord, WorkRecord, WalletTransaction, BoardRecord, BoardPostRecord, OtkRecord,
  DisputeRecord, DisputeAuditEntry, BoardSubscriptionRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { countActionsForProviders as countActionsForProvidersRepo } from '../repos/action.js';

export const workMethods = {
  // ── Actions ──
  // ══════════════════════════════════════════════════════════

  async createAction(this: SqliteStorage, action: ActionRecord): Promise<ActionRecord> {
    try {
      this.db.prepare(
        `INSERT INTO actions (providerGaii, id, displayName, description, category, inputSchema, outputSchema, pricing, estimatedTimeSeconds, maxInputSizeBytes, tags, webhookUrl, createdAt, updatedAt, semantic, federate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        action.providerGaii, action.id, action.displayName, action.description,
        action.category ?? null,
        JSON.stringify(action.inputSchema), JSON.stringify(action.outputSchema),
        JSON.stringify(action.pricing),
        action.estimatedTimeSeconds ?? null, action.maxInputSizeBytes ?? null,
        JSON.stringify(action.tags), action.webhookUrl ?? null,
        action.createdAt, action.updatedAt,
        action.semantic ? JSON.stringify(action.semantic) : null,
        action.federate ? 1 : 0,
      );
      return action;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('ACTION_EXISTS', { cause: err });
      throw err;
    }
  },

  async getAction(this: SqliteStorage, id: string, providerGaii: string): Promise<ActionRecord | null> {
    const row = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ? AND id = ?').get(providerGaii, id) as Record<string, unknown> | undefined;
    return row ? this.deserializeAction(row) : null;
  },

  async listActions(this: SqliteStorage, opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions').all() as Record<string, unknown>[];
    let results = rows.map(r => this.deserializeAction(r));
    if (opts?.category) {
      results = results.filter(a => a.category === opts.category);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return results;
  },

  async deleteAction(this: SqliteStorage, id: string, providerGaii: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM actions WHERE providerGaii = ? AND id = ?').run(providerGaii, id);
    return result.changes > 0;
  },

  async deleteActionsByProvider(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM actions WHERE providerGaii = ?').run(gaii);
    return result.changes;
  },

  async listActionsByProvider(this: SqliteStorage, gaii: string): Promise<ActionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM actions WHERE providerGaii = ?').all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeAction(r));
  },

  async countActionsForProviders(this: SqliteStorage, providerGaiis: string[]): Promise<number> {
    return countActionsForProvidersRepo(this.db, providerGaiis);
  },

  async updateAction(this: SqliteStorage, id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
    const existing = await this.getAction(id, providerGaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE actions SET displayName = ?, description = ?, category = ?, inputSchema = ?,
       outputSchema = ?, pricing = ?, estimatedTimeSeconds = ?, maxInputSizeBytes = ?,
       tags = ?, webhookUrl = ?, createdAt = ?, updatedAt = ?, semantic = ?, federate = ?
       WHERE providerGaii = ? AND id = ?`
    ).run(
      updated.displayName, updated.description, updated.category ?? null,
      JSON.stringify(updated.inputSchema), JSON.stringify(updated.outputSchema),
      JSON.stringify(updated.pricing),
      updated.estimatedTimeSeconds ?? null, updated.maxInputSizeBytes ?? null,
      JSON.stringify(updated.tags), updated.webhookUrl ?? null,
      updated.createdAt, updated.updatedAt,
      updated.semantic ? JSON.stringify(updated.semantic) : null,
      updated.federate ? 1 : 0,
      providerGaii, id,
    );
    return updated;
  },

  deserializeAction(this: SqliteStorage, row: Record<string, unknown>): ActionRecord {
    const record: ActionRecord = {
      id: row.id as string,
      providerGaii: row.providerGaii as string,
      displayName: row.displayName as string,
      description: row.description as string,
      inputSchema: JSON.parse(row.inputSchema as string),
      outputSchema: JSON.parse(row.outputSchema as string),
      pricing: JSON.parse(row.pricing as string),
      tags: JSON.parse(row.tags as string) as string[],
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.category) record.category = row.category as string;
    if (row.estimatedTimeSeconds !== null) record.estimatedTimeSeconds = row.estimatedTimeSeconds as number;
    if (row.maxInputSizeBytes !== null) record.maxInputSizeBytes = row.maxInputSizeBytes as number;
    if (row.webhookUrl) record.webhookUrl = row.webhookUrl as string;
    if (row.semantic) record.semantic = JSON.parse(row.semantic as string);
    record.federate = row.federate === 1;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Work ──
  // ══════════════════════════════════════════════════════════

  async createWork(this: SqliteStorage, work: WorkRecord): Promise<WorkRecord> {
    this.db.prepare(
      `INSERT INTO work (trackingCode, status, actionId, providerGaii, requesterGaii, input, output, cost, ttlExpiresAt, callbackUrl, rating, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      work.trackingCode, work.status, work.actionId,
      work.providerGaii, work.requesterGaii,
      JSON.stringify(work.input), work.output ? JSON.stringify(work.output) : null,
      JSON.stringify(work.cost), work.ttlExpiresAt,
      work.callbackUrl ?? null,
      work.rating ? JSON.stringify(work.rating) : null,
      work.createdAt, work.updatedAt,
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
       createdAt = ?, updatedAt = ? WHERE trackingCode = ?`
    ).run(
      updated.status, updated.actionId, updated.providerGaii, updated.requesterGaii,
      JSON.stringify(updated.input), updated.output ? JSON.stringify(updated.output) : null,
      JSON.stringify(updated.cost), updated.ttlExpiresAt,
      updated.callbackUrl ?? null,
      updated.rating ? JSON.stringify(updated.rating) : null,
      updated.createdAt, updated.updatedAt,
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
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Wallet Transactions ──
  // ══════════════════════════════════════════════════════════

  // ── The ledger is filed under the HUMAN, on both sides of the read/write pair ──
  // There is one balance per person (GHIIRecord.morselBalance) and debitBalance/creditBalance
  // resolve any principal to it. The ledger did not: a row written with an agent's GAII stayed
  // filed under that GAII, while every wallet surface reads the owner's GHII with an exact match.
  // So an agent earning on a work item moved the owner's balance and left no row explaining it.
  // Resolving on WRITE alone would be worse than the bug — the settlement replay guard looks a
  // tracking code up by the same identity it was written with — so both sides resolve here.
  // `initiatorGaii` keeps who acted, which is the whole reason that column exists.
  async addTransaction(this: SqliteStorage, tx: WalletTransaction): Promise<WalletTransaction> {
    const filedUnder = this.resolveGhii(tx.gaii) ?? tx.gaii;
    const initiator = tx.initiatorGaii ?? (filedUnder !== tx.gaii ? tx.gaii : null);
    this.db.prepare(
      `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, initiatorGaii, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tx.id, filedUnder, tx.type, tx.amount,
      tx.counterpartyGaii ?? null, tx.trackingCode ?? null, initiator, tx.timestamp,
    );
    return { ...tx, gaii: filedUnder, ...(initiator ? { initiatorGaii: initiator } : {}) };
  },

  async getTransactions(this: SqliteStorage, gaii: string, limit = 50): Promise<WalletTransaction[]> {
    const identity = this.resolveGhii(gaii) ?? gaii;
    const rows = this.db.prepare(
      'SELECT * FROM wallet_transactions WHERE gaii = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(identity, limit) as Record<string, unknown>[];
    return rows.reverse().map(r => this.deserializeTransaction(r));
  },

  async findTransactionByTrackingCode(this: SqliteStorage, gaii: string, trackingCode: string, type: string): Promise<WalletTransaction | null> {
    const identity = this.resolveGhii(gaii) ?? gaii;
    const row = this.db.prepare(
      'SELECT * FROM wallet_transactions WHERE gaii = ? AND trackingCode = ? AND type = ? LIMIT 1'
    ).get(identity, trackingCode, type) as Record<string, unknown> | undefined;
    return row ? this.deserializeTransaction(row) : null;
  },

  async listAllTransactions(this: SqliteStorage, limit = 10000): Promise<WalletTransaction[]> {
    const rows = this.db.prepare('SELECT * FROM wallet_transactions ORDER BY timestamp DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeTransaction(r));
  },

  async deleteTransactions(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM wallet_transactions WHERE gaii = ?').run(gaii);
    return result.changes;
  },

  deserializeTransaction(this: SqliteStorage, row: Record<string, unknown>): WalletTransaction {
    const record: WalletTransaction = {
      id: row.id as string,
      gaii: row.gaii as string,
      type: row.type as string,
      amount: row.amount as number,
      timestamp: row.timestamp as string,
    };
    if (row.counterpartyGaii) record.counterpartyGaii = row.counterpartyGaii as string;
    if (row.trackingCode) record.trackingCode = row.trackingCode as string;
  if (row.initiatorGaii) record.initiatorGaii = row.initiatorGaii as string;
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Boards ──
  // ══════════════════════════════════════════════════════════

  async createBoard(this: SqliteStorage, board: BoardRecord): Promise<BoardRecord> {
    this.db.prepare(
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

  async deleteBoard(this: SqliteStorage, id: string): Promise<boolean> {
    // Delete all posts in the board
    this.db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(id);
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

  async getPost(this: SqliteStorage, boardId: string, postId: string): Promise<BoardPostRecord | null> {
    const row = this.db.prepare('SELECT * FROM board_posts WHERE boardId = ? AND id = ?').get(boardId, postId) as Record<string, unknown> | undefined;
    return row ? this.deserializePost(row) : null;
  },

  async listPosts(this: SqliteStorage, boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
    const limit = opts?.limit ?? 20;
    const now = Date.now();

    let sql = 'SELECT * FROM board_posts WHERE boardId = ? AND replyTo IS NULL';
    const params: unknown[] = [boardId];
    if (opts?.category) { sql += ' AND category = ?'; params.push(opts.category); }
    sql += ' ORDER BY createdAt DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let results: BoardPostRecord[] = [];
    for (const row of rows) {
      const post = this.deserializePost(row);
      if (post.ttlExpiresAt && new Date(post.ttlExpiresAt).getTime() < now) {
        this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(post.boardId, post.id);
        continue;
      }
      results.push(post);
    }

    if (opts?.cursor) {
      const idx = results.findIndex(p => p.id === opts.cursor);
      if (idx >= 0) results = results.slice(idx + 1);
    }
    return results.slice(0, limit);
  },

  async deletePost(this: SqliteStorage, boardId: string, postId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM board_posts WHERE boardId = ? AND id = ?').run(boardId, postId);
    return result.changes > 0;
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

  // ══════════════════════════════════════════════════════════
  // ── OTK (One-Time Keys) ──
  // ══════════════════════════════════════════════════════════

  async createOtk(this: SqliteStorage, otk: OtkRecord): Promise<OtkRecord> {
    this.db.prepare(
      `INSERT INTO otks (key, ownerGaii, action, params, expiresAt, initial, used, usedAt, sessionId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      otk.key, otk.ownerGaii, otk.action,
      JSON.stringify(otk.params), otk.expiresAt,
      otk.initial ? 1 : 0, otk.used ? 1 : 0,
      otk.usedAt, otk.sessionId, otk.createdAt,
    );
    return otk;
  },

  async getOtk(this: SqliteStorage, key: string): Promise<OtkRecord | null> {
    const row = this.db.prepare('SELECT * FROM otks WHERE key = ?').get(key) as Record<string, unknown> | undefined;
    return row ? this.deserializeOtk(row) : null;
  },

  async consumeOtk(this: SqliteStorage, key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
    const otk = await this.getOtk(key);
    if (!otk) return null;

    // Initial OTK: timer hasn't started yet -- activate on first use
    if (otk.initial && !otk.used) {
      otk.used = true;
      otk.usedAt = new Date().toISOString();
      otk.expiresAt = new Date(Date.now() + graceMs).toISOString();
      this.db.prepare('UPDATE otks SET used = 1, usedAt = ?, expiresAt = ? WHERE key = ?').run(otk.usedAt, otk.expiresAt, key);
      return otk;
    }

    if (new Date(otk.expiresAt) < new Date()) {
      this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
      return null;
    }

    // Configurable post-use window: allow re-use within graceMs of first use
    if (otk.used && otk.usedAt) {
      const usedAt = new Date(otk.usedAt).getTime();
      if (Date.now() - usedAt > graceMs) {
        this.db.prepare('DELETE FROM otks WHERE key = ?').run(key);
        return null;
      }
      return otk; // still within grace window
    }

    otk.used = true;
    otk.usedAt = new Date().toISOString();
    this.db.prepare('UPDATE otks SET used = 1, usedAt = ? WHERE key = ?').run(otk.usedAt, key);
    return otk;
  },

  deserializeOtk(this: SqliteStorage, row: Record<string, unknown>): OtkRecord {
    return {
      key: row.key as string,
      ownerGaii: row.ownerGaii as string,
      action: row.action as string,
      params: JSON.parse(row.params as string),
      expiresAt: row.expiresAt as string,
      initial: (row.initial as number) === 1,
      used: (row.used as number) === 1,
      usedAt: (row.usedAt as string) ?? null,
      sessionId: (row.sessionId as string) ?? null,
      createdAt: row.createdAt as string,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Node Key ──
  // ══════════════════════════════════════════════════════════

  async setNodeKey(this: SqliteStorage, publicKey: string, privateKey: string): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO node_key (id, publicKey, privateKey) VALUES (1, ?, ?)`
    ).run(publicKey, privateKey);
  },

  async getNodeKey(this: SqliteStorage): Promise<{ publicKey: string; privateKey: string } | null> {
    const row = this.db.prepare('SELECT * FROM node_key WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return { publicKey: row.publicKey as string, privateKey: row.privateKey as string };
  },

  // ══════════════════════════════════════════════════════════
  // ── Disputes ──
  // ══════════════════════════════════════════════════════════

  async createDispute(this: SqliteStorage, dispute: DisputeRecord): Promise<DisputeRecord> {
    this.db.prepare(
      `INSERT INTO disputes (id, trackingCode, status, openedBy, reason, ruling, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      dispute.id, dispute.trackingCode, dispute.status,
      dispute.openedBy, dispute.reason,
      dispute.ruling ? JSON.stringify(dispute.ruling) : null,
      dispute.createdAt, dispute.updatedAt,
    );
    return dispute;
  },

  async getDispute(this: SqliteStorage, id: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  },

  async getDisputeByTrackingCode(this: SqliteStorage, tc: string): Promise<DisputeRecord | null> {
    const row = this.db.prepare('SELECT * FROM disputes WHERE trackingCode = ?').get(tc) as Record<string, unknown> | undefined;
    return row ? this.deserializeDispute(row) : null;
  },

  async updateDispute(this: SqliteStorage, id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
    const existing = await this.getDispute(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE disputes SET trackingCode = ?, status = ?, openedBy = ?, reason = ?, ruling = ?,
       createdAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.trackingCode, updated.status, updated.openedBy, updated.reason,
      updated.ruling ? JSON.stringify(updated.ruling) : null,
      updated.createdAt, updated.updatedAt, id,
    );
    return updated;
  },

  async addDisputeAuditEntry(this: SqliteStorage, disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
    this.db.prepare(
      `INSERT INTO dispute_audit (disputeId, sequence, event, actor, timestamp, data, hash, previousHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      disputeId, entry.sequence, entry.event, entry.actor,
      entry.timestamp, JSON.stringify(entry.data),
      entry.hash, entry.previousHash,
    );
    return entry;
  },

  async getDisputeAuditLog(this: SqliteStorage, disputeId: string): Promise<DisputeAuditEntry[]> {
    const rows = this.db.prepare('SELECT * FROM dispute_audit WHERE disputeId = ? ORDER BY sequence ASC').all(disputeId) as Record<string, unknown>[];
    return rows.map(r => ({
      sequence: r.sequence as number,
      event: r.event as string,
      actor: r.actor as string,
      timestamp: r.timestamp as string,
      data: JSON.parse(r.data as string),
      hash: r.hash as string,
      previousHash: r.previousHash as string,
    }));
  },

  async listDisputesByProvider(this: SqliteStorage, gaii: string): Promise<DisputeRecord[]> {
    // Need to join with work to find by provider
    const rows = this.db.prepare(
      `SELECT d.* FROM disputes d
       INNER JOIN work w ON d.trackingCode = w.trackingCode
       WHERE w.providerGaii = ?`
    ).all(gaii) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  },

  async listAllDisputes(this: SqliteStorage, limit = 10000): Promise<DisputeRecord[]> {
    const rows = this.db.prepare('SELECT * FROM disputes ORDER BY createdAt DESC LIMIT ?').all(Math.min(limit, 10000)) as Record<string, unknown>[];
    return rows.map(r => this.deserializeDispute(r));
  },

  deserializeDispute(this: SqliteStorage, row: Record<string, unknown>): DisputeRecord {
    const record: DisputeRecord = {
      id: row.id as string,
      trackingCode: row.trackingCode as string,
      status: row.status as DisputeRecord['status'],
      openedBy: row.openedBy as string,
      reason: row.reason as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.ruling) record.ruling = JSON.parse(row.ruling as string);
    return record;
  },

  // ══════════════════════════════════════════════════════════
};
