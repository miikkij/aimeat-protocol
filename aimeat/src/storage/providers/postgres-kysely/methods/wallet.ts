/**
 * @file src/storage/providers/postgres-kysely/methods/wallet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Wallet transaction ledger for the Postgres+Kysely backend (Transaction table) plus the
 *   atomic morsel-BALANCE mutations (debit/credit/creditCapped/transfer) on GHIIRecord.morselBalance —
 *   all balance ops resolve any GAII/GEAI/bare-name to the owner GHII first (agents hold no balance).
 *   Translated 1:1 from the SQLite/Prisma implementations.
 * @version-history
 *   v1.2.0 — 2026-08-16 — The ledger resolves the principal on both sides, the way every balance op
 *     already did: a row written with an agent GAII is filed under the owner GHII (with initiatorGaii
 *     keeping who acted), and a lookup by an agent GAII resolves too, so the federation replay guard
 *     still finds what it wrote. Before this, an agent earning on a work item moved the owner balance
 *     and left a row no wallet surface could see. E2E test-quality audit, reported and then fixed.
 *   v1.1.0 — 2026-07-15 — Phase 5: atomic balance mutations (debit/credit/creditCapped/transfer).
 *   v1.0.0 — 2026-07-15 — Phase 5: wallet transaction ledger on Postgres+Kysely.
 */
import { Kysely, sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { WalletTransaction } from '../../../interface.js';
import type { DB, Transaction } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

function mapTx(r: Selectable<Transaction>): WalletTransaction {
  return {
    id: r.txId, gaii: r.gaii, type: r.type, amount: r.amount,
    counterpartyGaii: r.counterpartyGaii ?? undefined, trackingCode: r.trackingCode ?? undefined,
    initiatorGaii: r.initiatorGaii ?? undefined,
    timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).toISOString(),
  };
}

/**
 * Resolve any identity (GAII, GHII, bare owner) to the owner's GHII identifier. All balance operations go
 * through GHII — agents/ecosystem-apps don't hold their own balance. Mirrors the SQLite provider's resolver.
 */
async function resolveGhii(db: Kysely<DB>, identity: string): Promise<string | null> {
  // GHII format: owner@node (no #) — already a GHII.
  if (!identity.includes('#') && identity.includes('@')) return identity;
  // GAII format: agent#owner@node → extract owner → lookup GHII by username.
  let owner = identity;
  if (identity.includes('#')) {
    const hashIdx = identity.indexOf('#');
    const atIdx = identity.lastIndexOf('@');
    if (atIdx <= hashIdx) return null;
    owner = identity.slice(hashIdx + 1, atIdx);
  }
  const row = await db.selectFrom('Ghii').select('ghii').where('username', '=', owner).executeTakeFirst();
  return row?.ghii ?? null;
}

export const walletMethods = {
  // ── The ledger is filed under the HUMAN, on both sides of the read/write pair ──
  // There is one balance per person (GHIIRecord.morselBalance) and every balance op below already
  // resolves any principal to it. The ledger did not: a row written with an agent's GAII stayed
  // filed under that GAII, while every wallet surface reads the owner's GHII with an exact match.
  // So an agent earning on a work item moved the owner's balance and left no row explaining it.
  // Resolving on WRITE alone would be worse than the bug — the settlement replay guard looks a
  // tracking code up by the identity it was written with, and a guard that stops finding the
  // original row lets a signed settlement be credited twice — so both sides resolve here.
  // `initiatorGaii` keeps who acted, which is the whole reason that column exists.
  async addTransaction(this: PostgresKyselyStorage, tx: WalletTransaction): Promise<WalletTransaction> {
    const owner = await resolveGhii(this.db, tx.gaii);
    const filedUnder = owner ?? tx.gaii;
    const initiator = tx.initiatorGaii ?? (filedUnder !== tx.gaii ? tx.gaii : null);
    const [row] = await this.db.insertInto('Transaction').values({
      txId: tx.id, gaii: filedUnder, type: tx.type, amount: tx.amount,
      counterpartyGaii: tx.counterpartyGaii ?? null, trackingCode: tx.trackingCode ?? null,
      initiatorGaii: initiator, timestamp: new Date(tx.timestamp),
    }).returningAll().execute();
    return mapTx(row);
  },
  async getTransactions(this: PostgresKyselyStorage, gaii: string, limit = 50): Promise<WalletTransaction[]> {
    const identity = (await resolveGhii(this.db, gaii)) ?? gaii;
    const rows = await this.db.selectFrom('Transaction').selectAll().where('gaii', '=', identity).orderBy('timestamp', 'desc').limit(limit).execute();
    return rows.map(mapTx);
  },
  async findTransactionByTrackingCode(this: PostgresKyselyStorage, gaii: string, trackingCode: string, type: string): Promise<WalletTransaction | null> {
    const identity = (await resolveGhii(this.db, gaii)) ?? gaii;
    const r = await this.db.selectFrom('Transaction').selectAll()
      .where('gaii', '=', identity).where('trackingCode', '=', trackingCode).where('type', '=', type)
      .executeTakeFirst();
    return r ? mapTx(r) : null;
  },
  async listAllTransactions(this: PostgresKyselyStorage, limit = 10000): Promise<WalletTransaction[]> {
    const rows = await this.db.selectFrom('Transaction').selectAll().orderBy('timestamp', 'desc').limit(Math.min(limit, 10000)).execute();
    return rows.map(mapTx);
  },
  async deleteTransactions(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('Transaction').where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Atomic morsel-balance mutations (on GHIIRecord.morselBalance) ──
  async debitBalance(this: PostgresKyselyStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts — a negative amount would INVERT the subtraction and
    // mint morsels. 0 is allowed (no-op; free/0-cost escrow relies on it).
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = await resolveGhii(this.db, gaii);
    if (!ghii) return false;
    const r = await this.db.updateTable('Ghii')
      .set({ morselBalance: sql`COALESCE("morselBalance", 0) - ${amount}` })
      .where('ghii', '=', ghii).where(sql<boolean>`COALESCE("morselBalance", 0) >= ${amount}`)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async creditBalance(this: PostgresKyselyStorage, gaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative credit would silently debit); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const ghii = await resolveGhii(this.db, gaii);
    if (!ghii) return false;
    const r = await this.db.updateTable('Ghii')
      .set({ morselBalance: sql`COALESCE("morselBalance", 0) + ${amount}` })
      .where('ghii', '=', ghii).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async creditBalanceCapped(this: PostgresKyselyStorage, gaii: string, amount: number, cap: number): Promise<number> {
    // SECURITY: reject negative/non-finite amounts (NaN would slip past the actualCredit<=0 guard below).
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const ghii = await resolveGhii(this.db, gaii);
    if (!ghii) return 0;
    return this.transaction(async () => {
      const trx = this.db;
      const row = await trx.selectFrom('Ghii').select('morselBalance').where('ghii', '=', ghii).forUpdate().executeTakeFirst();
      if (!row) return 0;
      const oldBalance = row.morselBalance ?? 0;
      if (oldBalance >= cap) return 0;
      const actualCredit = Math.min(amount, cap - oldBalance);
      if (actualCredit <= 0) return 0;
      await trx.updateTable('Ghii').set({ morselBalance: sql`COALESCE("morselBalance", 0) + ${actualCredit}` }).where('ghii', '=', ghii).execute();
      return actualCredit;
    });
  },
  async transferBalance(this: PostgresKyselyStorage, fromGaii: string, toGaii: string, amount: number): Promise<boolean> {
    // SECURITY: reject negative/non-finite amounts (a negative transfer would drain the recipient); 0 is a no-op.
    if (!Number.isFinite(amount) || amount < 0) return false;
    const fromGhii = await resolveGhii(this.db, fromGaii);
    const toGhii = await resolveGhii(this.db, toGaii);
    if (!fromGhii || !toGhii) return false;
    if (fromGhii === toGhii) return true; // Same owner — no-op
    return this.transaction(async () => {
      const trx = this.db;
      const debit = await trx.updateTable('Ghii')
        .set({ morselBalance: sql`COALESCE("morselBalance", 0) - ${amount}` })
        .where('ghii', '=', fromGhii).where(sql<boolean>`COALESCE("morselBalance", 0) >= ${amount}`)
        .executeTakeFirst();
      if (Number(debit.numUpdatedRows ?? 0) === 0) return false;
      await trx.updateTable('Ghii').set({ morselBalance: sql`COALESCE("morselBalance", 0) + ${amount}` }).where('ghii', '=', toGhii).execute();
      return true;
    });
  },
};
