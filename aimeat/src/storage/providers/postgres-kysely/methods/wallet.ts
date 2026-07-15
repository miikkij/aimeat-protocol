/**
 * @file src/storage/providers/postgres-kysely/methods/wallet.ts
 * @description Wallet transaction ledger for the Postgres+Kysely backend (Transaction table). The morsel
 *   BALANCE lives on GHIIRecord.morselBalance and its atomic mutations (debit/credit/transfer) land with
 *   the agents+economy slice; this is the append + read side the register welcome-bonus and the wallet
 *   history use. Translated 1:1 from the Prisma implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: wallet transaction ledger on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { WalletTransaction } from '../../../interface.js';
import type { Transaction } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

function mapTx(r: Selectable<Transaction>): WalletTransaction {
  return {
    id: r.txId, gaii: r.gaii, type: r.type, amount: r.amount,
    counterpartyGaii: r.counterpartyGaii ?? undefined, trackingCode: r.trackingCode ?? undefined,
    timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).toISOString(),
  };
}

export const walletMethods = {
  async addTransaction(this: PostgresKyselyStorage, tx: WalletTransaction): Promise<WalletTransaction> {
    const [row] = await this.db.insertInto('Transaction').values({
      txId: tx.id, gaii: tx.gaii, type: tx.type, amount: tx.amount,
      counterpartyGaii: tx.counterpartyGaii ?? null, trackingCode: tx.trackingCode ?? null, timestamp: new Date(tx.timestamp),
    }).returningAll().execute();
    return mapTx(row);
  },
  async getTransactions(this: PostgresKyselyStorage, gaii: string, limit = 50): Promise<WalletTransaction[]> {
    const rows = await this.db.selectFrom('Transaction').selectAll().where('gaii', '=', gaii).orderBy('timestamp', 'desc').limit(limit).execute();
    return rows.map(mapTx);
  },
  async listAllTransactions(this: PostgresKyselyStorage, limit = 10000): Promise<WalletTransaction[]> {
    const rows = await this.db.selectFrom('Transaction').selectAll().orderBy('timestamp', 'desc').limit(Math.min(limit, 10000)).execute();
    return rows.map(mapTx);
  },
  async deleteTransactions(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('Transaction').where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
