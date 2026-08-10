/**
 * @file src/storage/repositories/wallet.repository.ts
 * @description Storage-interface contract for the wallet/morsel transaction ledger: append a
 *   transaction, read a principal's (or all) transaction history, and purge a principal's records —
 *   implemented per backend (SQLite/Prisma).
 *
 * @structure
 *   - WalletRepository: interface implemented per backend
 *   - addTransaction / getTransactions(gaii) / listAllTransactions: append + per-gaii / global reads
 *   - deleteTransactions(gaii): purge a principal's ledger entries
 *
 * @version-history
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
  deleteTransactions(gaii: string): Promise<number>;
}
