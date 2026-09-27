/**
 * @file src/storage/providers/postgres-kysely/methods/work-ledger-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The work and the ledger lines a party leaves behind, for the Postgres backend: an
 *   erased account (deleteOwnerCascade in owner-cascade.ts), one agent its owner deletes (deleteAgent
 *   in identity.ts), and a held name the operator decides was a previous holder's (held-names.ts).
 *   Moved out of owner-cascade.ts, so the operator's decision reaches the one rule without importing
 *   the cascade and, through it, the provider class (an import cycle, check:deps). owner-cascade.ts
 *   exports them again for its callers.
 * @structure
 *   - pseudonymiseLedgerPartyDb(db, party, opts) — the other side's ledger lines, without the name
 *   - settleLeavingPartyWorkDb(db, party, opts) — open work cancelled, held morsels back, finished work kept
 *   - settleErasedPartyWorkDb(db, name, ghiis, pseudonym, agents) — that rule for an erased account
 *   - settleDeletedAgentWorkDb(db, gaii) — that rule for one agent its owner deletes
 * @usage import { settleLeavingPartyWorkDb } from './work-ledger-erasure.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of owner-cascade.ts v1.9.0, with `onlyToAccountsThen` on
 *     settleLeavingPartyWorkDb and `before` on pseudonymiseLedgerPartyDb for the operator's decision.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { resolveGhii } from '../ghii-resolve.js';
import { OPEN_WORK_STATUSES, erasedAccountParty, deletedAgentParty, type LeavingParty } from '../../../erased-party.js';

/** A Kysely handle: the root connection or an open transaction. */
type Db = Kysely<DB>;

/**
 * Write the erasure's pseudonym in place of an erased person on every ledger line that still names
 * them, and keep the lines.
 *
 * The rule and its reasons are written on the SQLite twin, pseudonymiseLedgerParty in
 * ../../sqlite/repos/ledger-erasure.ts. The person's own lines go with the per-identity passes; the
 * lines in other people's ledgers stay for their books, and each column that names the person
 * (`counterpartyGaii`, and `initiatorGaii` where they acted) takes the one pseudonym the erasure
 * writes on the work, the receipts and the provenance records. A ledger line carries no hash or
 * signature of its own; the dispute log does, and keeps them as stored. A party with no pseudonym is
 * kept as stored.
 *
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes. Written
 * out twice rather than looped over the two columns, so each statement names its own column.
 *
 * `before` limits it to the lines written before a time: a held name's lines older than the account
 * that holds the name now, when the operator decides they were a previous holder's.
 */
export async function pseudonymiseLedgerPartyDb(db: Db, party: LeavingParty, opts: { before?: Date } = {}): Promise<number> {
  const { exact, suffixPatterns, pseudonym } = party;
  if (!pseudonym) return 0;
  const before = opts.before;
  const counterparty = await db.updateTable('Transaction')
    .set({ counterpartyGaii: pseudonym })
    .where(eb => eb.or([eb('counterpartyGaii', 'in', exact), ...suffixPatterns.map(p => eb('counterpartyGaii', 'like', p))]))
    .$if(before !== undefined, qb => qb.where('timestamp', '<', before as Date))
    .executeTakeFirst();
  const initiator = await db.updateTable('Transaction')
    .set({ initiatorGaii: pseudonym })
    .where(eb => eb.or([eb('initiatorGaii', 'in', exact), ...suffixPatterns.map(p => eb('initiatorGaii', 'like', p))]))
    .$if(before !== undefined, qb => qb.where('timestamp', '<', before as Date))
    .executeTakeFirst();
  return Number(counterparty?.numUpdatedRows ?? 0) + Number(initiator?.numUpdatedRows ?? 0);
}

/**
 * Settle every work row a leaving party is on: an erased account, or one agent its owner deletes.
 *
 * The rule and its reasons are written on the SQLite twin, settleLeavingPartyWork in
 * ../../sqlite/repos/work-erasure.ts, and both keep to it: open work is cancelled, and what was held
 * for it goes back to whoever asked, with an `escrow_return` line in their ledger, except to a
 * requester whose account is being erased. Finished work stays with its status, its times and the
 * delivery, and so does a dispute on it; with a pseudonym the leaving side takes it, and its log
 * keeps its hashes. A row with the leaving party on both sides goes with its dispute.
 *
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes.
 *
 * `onlyToAccountsThen`: held morsels go back only to an account that existed when the row was
 * written, for the operator's decision that a held name's rows were a previous holder's. A name is
 * released for reuse, so an account registered later under the requester's name is somebody else.
 * The deletions leave it off: the resolver that debited the requester is the one that credits them.
 */
export async function settleLeavingPartyWorkDb(
  db: Db, party: LeavingParty, opts: { onlyToAccountsThen?: boolean } = {},
): Promise<{ cancelled: number; returned: number; kept: number; deleted: number }> {
  const { exact, suffixPatterns, pseudonym } = party;
  const rows = await db.selectFrom('Work')
    .select(['trackingCode', 'status', 'providerGaii', 'requesterGaii', 'costTotal', 'createdAt'])
    .where(eb => eb.or([
      eb('providerGaii', 'in', exact), ...suffixPatterns.map(p => eb('providerGaii', 'like', p)),
      eb('requesterGaii', 'in', exact), ...suffixPatterns.map(p => eb('requesterGaii', 'like', p)),
    ]))
    .execute();

  const out = { cancelled: 0, returned: 0, kept: 0, deleted: 0 };
  const now = new Date();
  for (const w of rows) {
    const providerGone = party.is(w.providerGaii);
    const requesterGone = party.is(w.requesterGaii);
    // DisputeAudit keys on Dispute.disputeId, the business key, not on the surrogate id.
    const disputeIds = db.selectFrom('Dispute').select('disputeId').where('trackingCode', '=', w.trackingCode);
    if (providerGone && requesterGone) {
      await db.deleteFrom('DisputeAudit').where('disputeId', 'in', disputeIds).execute();
      await db.deleteFrom('Dispute').where('trackingCode', '=', w.trackingCode).execute();
      await db.deleteFrom('Work').where('trackingCode', '=', w.trackingCode).execute();
      out.deleted++;
      continue;
    }

    const open = OPEN_WORK_STATUSES.includes(w.status);
    const provider = providerGone && pseudonym ? pseudonym : w.providerGaii;
    const requester = requesterGone && pseudonym ? pseudonym : w.requesterGaii;
    if (open && (!requesterGone || party.refundsItself) && w.costTotal > 0) {
      let payer = await resolveGhii(db, w.requesterGaii);
      if (payer && opts.onlyToAccountsThen) {
        const then = await db.selectFrom('Ghii').innerJoin('Owner', 'Owner.name', 'Ghii.ownerName')
          .select('Ghii.ghii').where('Ghii.ghii', '=', payer).where('Owner.createdAt', '<=', w.createdAt)
          .executeTakeFirst();
        if (!then) payer = null;
      }
      const credited = payer
        ? await db.updateTable('Ghii').set({ morselBalance: sql`COALESCE("morselBalance", 0) + ${w.costTotal}` })
          .where('ghii', '=', payer).executeTakeFirst()
        : null;
      if (payer && Number(credited?.numUpdatedRows ?? 0) > 0) {
        await db.insertInto('Transaction').values({
          txId: `tx-${randomUUID()}`, gaii: payer, type: 'escrow_return', amount: w.costTotal,
          counterpartyGaii: provider, trackingCode: w.trackingCode,
          initiatorGaii: payer !== w.requesterGaii ? w.requesterGaii : null, timestamp: now,
        }).execute();
        out.returned++;
      }
    }

    await db.updateTable('Work').set({
      status: open ? 'cancelled' : w.status,
      providerGaii: provider,
      requesterGaii: requester,
      ...(requesterGone && pseudonym ? { callbackUrl: null } : {}),
      ...(open ? { updatedAt: now } : {}),
    }).where('trackingCode', '=', w.trackingCode).execute();
    if (pseudonym) {
      await db.updateTable('Dispute').set({ openedBy: pseudonym })
        .where('trackingCode', '=', w.trackingCode)
        .where(eb => eb.or([eb('openedBy', 'in', exact), ...suffixPatterns.map(p => eb('openedBy', 'like', p))]))
        .execute();
      await db.updateTable('DisputeAudit').set({ actor: pseudonym })
        .where('disputeId', 'in', disputeIds)
        .where(eb => eb.or([eb('actor', 'in', exact), ...suffixPatterns.map(p => eb('actor', 'like', p))]))
        .execute();
    }
    if (open) out.cancelled++; else out.kept++;
  }
  return out;
}

/**
 * The work of an erased account, found by every identity partyIdentities lists and by its agents'
 * GAIIs, and kept under the erasure's pseudonym.
 */
export async function settleErasedPartyWorkDb(
  db: Db, name: string, ghiis: string[], pseudonym: string, agents: string[] = [],
): Promise<{ cancelled: number; returned: number; kept: number; deleted: number }> {
  return settleLeavingPartyWorkDb(db, erasedAccountParty(name, ghiis, pseudonym, agents));
}

/** The work of one agent its owner deletes: settled by the same rule, the agent's identity kept. */
export async function settleDeletedAgentWorkDb(
  db: Db, gaii: string,
): Promise<{ cancelled: number; returned: number; kept: number; deleted: number }> {
  return settleLeavingPartyWorkDb(db, deletedAgentParty(gaii));
}
