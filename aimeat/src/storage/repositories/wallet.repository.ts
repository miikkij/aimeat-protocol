/**
 * @file src/storage/repositories/wallet.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface contract for the wallet/morsel transaction ledger: append a
 *   transaction and read a principal's (or all) transaction history — implemented per backend.
 *
 * @structure
 *   - WalletRepository: interface implemented per backend
 *   - addTransaction / getTransactions(gaii) / listAllTransactions: append + per-gaii / global reads
 *
 * @version-history
 *   2026-10-15 — sumTransactionsSince: the positive amounts of some transaction types since a moment,
 *     summed by the database; the daily mint ceiling read only the newest 10 000 rows (feature-list audit 176).
 *   v1.2.0 — 2026-09-09 — deleteTransactions deleted: no caller.
 *   v1.1.0 — 2026-08-10 — findTransactionByTrackingCode for the settlement replay guard (audit June H-4).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { WalletTransaction } from '../interface.js';

export interface WalletRepository {
  addTransaction(tx: WalletTransaction): Promise<WalletTransaction>;
  getTransactions(gaii: string, limit?: number): Promise<WalletTransaction[]>;
  /** One transaction by its exact tracking code and type, or null. Replay guards use this instead
   *  of scanning a bounded recent list: a settlement that scrolled out of the window used to look
   *  like a new one (audit: the June H-4 finding). */
  findTransactionByTrackingCode(gaii: string, trackingCode: string, type: string): Promise<WalletTransaction | null>;
  listAllTransactions(limit?: number): Promise<WalletTransaction[]>;
  /** The sum of the positive amounts of these transaction types since `since` (ISO), by the database. */
  sumTransactionsSince(types: readonly string[], since: string): Promise<number>;
}
