/**
 * @file src/storage/providers/sqlite/repos/work-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the work an erased person leaves behind. deleteOwner (methods/owner.ts)
 *   calls it inside its own transaction, before the per-identity cascade, with the pseudonym the
 *   purchase receipts get. A free function over the connection for the reason
 *   repos/app-purchase-erasure.ts gives: no import cycle through the provider class.
 * @structure settleErasedPartyWork(db, name, ghiis, pseudonym, resolvePayer)
 * @usage settleErasedPartyWork(this.db, name, ghiis, pseudonym, id => this.resolveGhii(id));
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: open work is cancelled and the requester's held morsels go back,
 *     finished work stays under the pseudonym (secaudit 2026-09: A8-4, N6). The Postgres twin is
 *     settleErasedPartyWorkDb in its owner-cascade.ts.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { OPEN_WORK_STATUSES, isPartyIdentity, partyIdentities } from '../../../erased-party.js';

/** What one erasure did to the work it touched. */
export interface WorkErasureResult { cancelled: number; returned: number; kept: number; deleted: number }

interface WorkRow { trackingCode: string; status: string; providerGaii: string; requesterGaii: string; cost: string }

/**
 * Settle every work row an erased person is a party to, and take their name out of what stays.
 *
 * Work has two sides, and each row is also the other side's record. So:
 *
 *   - OPEN WORK (OPEN_WORK_STATUSES) is cancelled. When the erased person was the provider, the
 *     requester was charged when they asked (services/morsel.ts holdEscrow), and that amount goes back
 *     to them with an `escrow_return` line in their ledger, the line a rejection writes. When the
 *     erased person was the requester, the morsels held were their own and go with the account; the
 *     provider sees the request cancelled.
 *   - FINISHED WORK stays, with the erased side's column rewritten to the pseudonym. Its status, its
 *     times and the delivery are kept: they are the other side's books, and its trust score reads
 *     them. A requester's callback address goes too, since nothing will call it again.
 *   - A DISPUTE on a kept row stays with it. Who opened it and the log entries the erased person wrote
 *     take the pseudonym. The hashes stay as they were, so an entry the erasure rewrote no longer
 *     hashes to its stored value, and that is how an operator can tell which entries an erasure
 *     touched.
 *   - A row where both sides are the erased person is deleted with its dispute: nobody else keeps it.
 *
 * The rows are found by the forms partyIdentities lists: the GHII, the bare account name an owner
 * session stored before 2026-09-26, and `…#name@node` for an agent or an app acting for them.
 */
export function settleErasedPartyWork(
  db: Database.Database, name: string, ghiis: string[], pseudonym: string,
  resolvePayer: (identity: string) => string | null,
): WorkErasureResult {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const params = [...exact, ...suffixPatterns];
  const matches = (column: string): string => [
    `${column} IN (${exact.map(() => '?').join(', ')})`,
    ...suffixPatterns.map(() => `${column} LIKE ? ESCAPE '\\'`),
  ].join(' OR ');
  const rows = db.prepare(
    `SELECT trackingCode, status, providerGaii, requesterGaii, cost FROM work
     WHERE (${matches('providerGaii')}) OR (${matches('requesterGaii')})`,
  ).all(...params, ...params) as WorkRow[];

  const out: WorkErasureResult = { cancelled: 0, returned: 0, kept: 0, deleted: 0 };
  const now = new Date().toISOString();
  for (const w of rows) {
    const providerGone = isPartyIdentity(w.providerGaii, name, ghiis);
    const requesterGone = isPartyIdentity(w.requesterGaii, name, ghiis);
    if (providerGone && requesterGone) {
      db.prepare('DELETE FROM dispute_audit WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?)').run(w.trackingCode);
      db.prepare('DELETE FROM disputes WHERE trackingCode = ?').run(w.trackingCode);
      db.prepare('DELETE FROM work WHERE trackingCode = ?').run(w.trackingCode);
      out.deleted++;
      continue;
    }

    const open = OPEN_WORK_STATUSES.includes(w.status);
    if (open && providerGone) {
      const held = Number((JSON.parse(w.cost || '{}') as { total?: number }).total ?? 0);
      const payer = held > 0 ? resolvePayer(w.requesterGaii) : null;
      if (payer && db.prepare('UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?').run(held, payer).changes > 0) {
        db.prepare(
          `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, initiatorGaii, timestamp)
           VALUES (?, ?, 'escrow_return', ?, ?, ?, ?, ?)`,
        ).run(`tx-${randomUUID()}`, payer, held, pseudonym, w.trackingCode, payer !== w.requesterGaii ? w.requesterGaii : null, now);
        out.returned++;
      }
    }

    db.prepare(
      `UPDATE work SET status = ?, providerGaii = ?, requesterGaii = ?,
         callbackUrl = CASE WHEN ? = 1 THEN NULL ELSE callbackUrl END, updatedAt = CASE WHEN ? = 1 THEN ? ELSE updatedAt END
       WHERE trackingCode = ?`,
    ).run(
      open ? 'cancelled' : w.status,
      providerGone ? pseudonym : w.providerGaii,
      requesterGone ? pseudonym : w.requesterGaii,
      requesterGone ? 1 : 0, open ? 1 : 0, now, w.trackingCode,
    );
    db.prepare(`UPDATE disputes SET openedBy = ? WHERE trackingCode = ? AND (${matches('openedBy')})`)
      .run(pseudonym, w.trackingCode, ...params);
    db.prepare(
      `UPDATE dispute_audit SET actor = ?
       WHERE disputeId IN (SELECT id FROM disputes WHERE trackingCode = ?) AND (${matches('actor')})`,
    ).run(pseudonym, w.trackingCode, ...params);
    if (open) out.cancelled++; else out.kept++;
  }
  return out;
}
