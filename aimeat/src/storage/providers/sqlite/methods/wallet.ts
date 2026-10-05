/**
 * @file src/storage/providers/sqlite/methods/wallet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/wallet.ts (walletMethods), so a fix
 *   in one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure walletMethods
 * @usage Object.assign(SqliteStorage.prototype, walletMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — debitBalance, creditBalance, creditBalanceCapped moved here from agents.ts;
 *     addTransaction, getTransactions, findTransactionByTrackingCode, listAllTransactions,
 *     deserializeTransaction moved here from work.ts so the file mirrors postgres-kysely/methods/wallet.ts
 *     (secaudit 2026-10, M8).
 */
import type { WalletTransaction } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const walletMethods = {

  async debitBalance(this: SqliteStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts. A negative amount would INVERT the
    // subtraction (balance - (-n) = balance + n) and mint morsels. 0 is allowed (no-op;
    // free/0-cost work escrow relies on it).
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) - ? WHERE ghii = ? AND COALESCE(morselBalance, 0) >= ?`
    ).run(amount, ghii, amount);
    return result.changes > 0;
  },

  async creditBalance(this: SqliteStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative credit would silently debit); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return false;
    const result = this.db.prepare(
      `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
    ).run(amount, ghii);
    return result.changes > 0;
  },

  async creditBalanceCapped(this: SqliteStorage, gaii: string, amount: number, cap: number): Promise<number> {
    // SECURITY: reject negative/non-finite amounts (NaN would slip past the actualCredit<=0 guard below).
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const ghii = this.resolveGhii(gaii);
    if (!ghii) return 0;
    const txn = this.db.transaction(() => {
      const row = this.db.prepare('SELECT morselBalance FROM ghiis WHERE ghii = ?').get(ghii) as { morselBalance: number | null } | undefined;
      if (!row) return 0;
      const oldBalance = row.morselBalance ?? 0;
      if (oldBalance >= cap) return 0;
      const actualCredit = Math.min(amount, cap - oldBalance);
      if (actualCredit <= 0) return 0;
      this.db.prepare('UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?').run(actualCredit, ghii);
      return actualCredit;
    });
    return txn();
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
};
