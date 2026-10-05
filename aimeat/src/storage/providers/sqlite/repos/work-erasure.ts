/**
 * @file src/storage/providers/sqlite/repos/work-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the work a party leaves behind: an erased account (deleteOwner in
 *   methods/identity.ts, with the pseudonym the purchase receipts get) or one agent its owner deletes
 *   (deleteAgent in methods/identity.ts). Each caller runs it inside its own transaction, before the
 *   per-identity cascade. A free function over the connection for the reason
 *   repos/app-purchase-erasure.ts gives: no import cycle through the provider class.
 * @structure
 *   - PayerResolver — whose balance a held request goes back to, given the row's time
 *   - settleLeavingPartyWork(db, party, resolvePayer, opts) — the one rule
 *   - settleErasedPartyWork(db, name, ghiis, pseudonym, resolvePayer, opts, agents) — an erased account
 *   - settleDeletedAgentWork(db, gaii, resolvePayer) — one deleted agent
 * @usage settleErasedPartyWork(this.db, name, ghiis, pseudonym, id => this.resolveGhii(id));
 * @version-history
 *   v1.3.1 — 2026-10-05 — deleteOwner and deleteAgent are in methods/identity.ts now (secaudit 2026-10,
 *     M8).
 *   v1.3.0 — 2026-09-26 — The payer resolver gets the time the row was written (PayerResolver), so the
 *     boot migration gives held morsels back only to an account that existed then (secaudit 2026-09:
 *     R3 7b). The deletions keep the resolver that debited them.
 *   v1.2.0 — 2026-09-26 — One rule for any party that leaves the work (LeavingParty in
 *     storage/erased-party.ts): an erased account, and one agent its owner deletes, whose held
 *     morsels go back to the owner and whose identity stays on what is kept. The erasure also finds
 *     its agents' work by their GAII.
 *   v1.1.0 — 2026-09-26 — `createdBefore`, for the boot migration's rows of a deleted account whose
 *     name somebody holds again.
 *   v1.0.0 — 2026-09-26 — Initial: open work is cancelled and the requester's held morsels go back,
 *     finished work stays under the pseudonym (secaudit 2026-09: A8-4, N6). The Postgres twin is
 *     settleErasedPartyWorkDb in its owner-cascade.ts.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { OPEN_WORK_STATUSES, deletedAgentParty, erasedAccountParty, type LeavingParty } from '../../../erased-party.js';

/** What one pass did to the work it touched. */
export interface WorkErasureResult { cancelled: number; returned: number; kept: number; deleted: number }

interface WorkRow { trackingCode: string; status: string; providerGaii: string; requesterGaii: string; cost: string; createdAt: string }

/**
 * The balance a held request goes back to, from the requester as the row stores it and the time the
 * row was written. The deletions pass the resolver that debited it; the boot migration passes one
 * that also asks whether that account existed when the row was written.
 */
export type PayerResolver = (identity: string, writtenAt: string) => string | null;

/**
 * Settle every work row a leaving party is on, and keep of it on the rows that stay what `party`
 * says. Work has two sides, and each row is also the other side's record. So:
 *
 *   - OPEN WORK (OPEN_WORK_STATUSES) is cancelled, and what was held for it goes back to whoever
 *     asked, with an `escrow_return` line in their ledger, the line a rejection writes: the requester
 *     was charged when they asked (services/morsel.ts holdEscrow). The one exception is a requester
 *     whose account is being erased: those morsels were its own and go with the account, and the
 *     provider sees the request cancelled.
 *   - FINISHED WORK stays. Its status, its times and the delivery are kept: they are the other side's
 *     books, and its trust score reads them. With a pseudonym, the leaving side is rewritten to it
 *     and a leaving requester's callback address goes; without one, the side is kept as stored.
 *   - A DISPUTE on a kept row stays with it. With a pseudonym, who opened it and the log entries the
 *     leaving party wrote take it; the hashes stay as they were, so an entry an erasure rewrote no
 *     longer hashes to its stored value, which shows an operator which entries an erasure touched.
 *   - A row with the leaving party on both sides is deleted with its dispute: nobody else keeps it.
 *
 * `createdBefore` limits the pass to rows written before a time: the boot migration's rows of a
 * deleted account whose name somebody else holds now (schema-identity-backfill.ts).
 */
export function settleLeavingPartyWork(
  db: Database.Database, party: LeavingParty,
  resolvePayer: PayerResolver,
  opts: { createdBefore?: string } = {},
): WorkErasureResult {
  const { exact, suffixPatterns, pseudonym } = party;
  const params = [...exact, ...suffixPatterns];
  const matches = (column: string): string => [
    `${column} IN (${exact.map(() => '?').join(', ')})`,
    ...suffixPatterns.map(() => `${column} LIKE ? ESCAPE '\\'`),
  ].join(' OR ');
  const before = opts.createdBefore ? ' AND createdAt < ?' : '';
  const rows = db.prepare(
    `SELECT trackingCode, status, providerGaii, requesterGaii, cost, createdAt FROM work
     WHERE ((${matches('providerGaii')}) OR (${matches('requesterGaii')}))${before}`,
  ).all(...params, ...params, ...(opts.createdBefore ? [opts.createdBefore] : [])) as WorkRow[];

  const out: WorkErasureResult = { cancelled: 0, returned: 0, kept: 0, deleted: 0 };
  const now = new Date().toISOString();
  for (const w of rows) {
    const providerGone = party.is(w.providerGaii);
    const requesterGone = party.is(w.requesterGaii);
    if (providerGone && requesterGone) {
      db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
      db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
      db.prepare('DELETE FROM work WHERE trackingCode = ?').run(w.trackingCode);
      out.deleted++;
      continue;
    }

    const open = OPEN_WORK_STATUSES.includes(w.status);
    const provider = providerGone && pseudonym ? pseudonym : w.providerGaii;
    const requester = requesterGone && pseudonym ? pseudonym : w.requesterGaii;
    if (open && (!requesterGone || party.refundsItself)) {
      const held = Number((JSON.parse(w.cost || '{}') as { total?: number }).total ?? 0);
      const payer = held > 0 ? resolvePayer(w.requesterGaii, w.createdAt) : null;
      if (payer && db.prepare('UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?').run(held, payer).changes > 0) {
        db.prepare(
          `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, initiatorGaii, timestamp)
           VALUES (?, ?, 'escrow_return', ?, ?, ?, ?, ?)`,
        ).run(`tx-${randomUUID()}`, payer, held, provider, w.trackingCode, payer !== w.requesterGaii ? w.requesterGaii : null, now);
        out.returned++;
      }
    }

    const dropCallback = requesterGone && pseudonym !== null;
    db.prepare(
      `UPDATE work SET status = ?, providerGaii = ?, requesterGaii = ?,
         callbackUrl = CASE WHEN ? = 1 THEN NULL ELSE callbackUrl END, updatedAt = CASE WHEN ? = 1 THEN ? ELSE updatedAt END
       WHERE trackingCode = ?`,
    ).run(open ? 'cancelled' : w.status, provider, requester, dropCallback ? 1 : 0, open ? 1 : 0, now, w.trackingCode);
    if (pseudonym) {
      db.prepare(`UPDATE disputes SET openedBy = ? WHERE trackingCode = ? AND (${matches('openedBy')})`)
        .run(pseudonym, w.trackingCode, ...params);
      db.prepare(
        `UPDATE dispute_audit SET actor = ?
         WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?) AND (${matches('actor')})`,
      ).run(pseudonym, w.trackingCode, ...params);
    }
    if (open) out.cancelled++; else out.kept++;
  }
  return out;
}

/**
 * The work of an erased account: found by the forms partyIdentities lists (the GHII, the bare account
 * name an owner session stored before 2026-09-26, and `…#name@node` for an agent or an app acting for
 * them) and by its agents' GAIIs, and kept under the erasure's pseudonym.
 */
export function settleErasedPartyWork(
  db: Database.Database, name: string, ghiis: string[], pseudonym: string,
  resolvePayer: PayerResolver,
  opts: { createdBefore?: string } = {},
  agents: string[] = [],
): WorkErasureResult {
  return settleLeavingPartyWork(db, erasedAccountParty(name, ghiis, pseudonym, agents), resolvePayer, opts);
}

/** The work of one agent its owner deletes: settled by the same rule, the agent's identity kept. */
export function settleDeletedAgentWork(
  db: Database.Database, gaii: string, resolvePayer: PayerResolver,
): WorkErasureResult {
  return settleLeavingPartyWork(db, deletedAgentParty(gaii), resolvePayer);
}
