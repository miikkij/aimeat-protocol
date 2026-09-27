/**
 * @file src/storage/providers/sqlite/repos/ledger-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the ledger lines an erased person leaves in other people's ledgers.
 *   deleteOwner (methods/owner.ts) calls it inside its own transaction, after the per-identity
 *   cascade has deleted the person's own lines. A free function over the connection, like
 *   repos/app-purchase-erasure.ts, so the owner methods can call it without an import cycle through
 *   the provider class.
 * @structure pseudonymiseLedgerParty(db, party)
 * @usage pseudonymiseLedgerParty(this.db, erasedAccountParty(name, ghiis, pseudonym, agents));
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the other side's ledger lines name an erased person by the
 *     erasure's pseudonym (secaudit 2026-09). The Postgres twin is pseudonymiseLedgerPartyDb in its
 *     owner-cascade.ts.
 */
import type Database from 'better-sqlite3';
import type { LeavingParty } from '../../../erased-party.js';

/**
 * Write the erasure's pseudonym in place of an erased person on every ledger line that still names
 * them, and keep the lines.
 *
 * A line is filed under one person (`gaii`) and names the other side of the movement in
 * `counterpartyGaii`: the provider an escrow was held for, the requester who paid, the seller or the
 * buyer of an app. Some lines also name the principal who acted in `initiatorGaii`, for instance
 * another person's agent paying for an extension. The person's own lines go with the account in the
 * per-identity cascade. The lines in other people's ledgers stay, because they are those people's
 * books. The name leaves them: it is released for reuse, so a line that kept it would name whoever
 * registers the name next as a party to somebody else's money. Each column that names the person
 * takes the one pseudonym the erasure writes on the work, the receipts and the provenance records.
 * The amount, the type, the tracking code and the date stay as they were.
 *
 * A ledger line carries no hash or signature of its own, so nothing on it is checked against the
 * old name. The dispute log does carry hashes, and it keeps them as stored (repos/work-erasure.ts).
 *
 * A party with no pseudonym (a deleted agent, whose owner is still here) is kept as stored, so this
 * changes nothing for one. SQLite LIKE has no escape character unless it is named, so each pattern
 * names the backslash that partyIdentities escapes with.
 */
export function pseudonymiseLedgerParty(db: Database.Database, party: LeavingParty): number {
  const { exact, suffixPatterns, pseudonym } = party;
  if (!pseudonym) return 0;
  const params = [...exact, ...suffixPatterns];
  const matches = (column: string): string => [
    `${column} IN (${exact.map(() => '?').join(', ')})`,
    ...suffixPatterns.map(() => `${column} LIKE ? ESCAPE '\\'`),
  ].join(' OR ');
  const counterparty = db.prepare(
    `UPDATE wallet_transactions SET counterpartyGaii = ? WHERE ${matches('counterpartyGaii')}`,
  ).run(pseudonym, ...params);
  const initiator = db.prepare(
    `UPDATE wallet_transactions SET initiatorGaii = ? WHERE ${matches('initiatorGaii')}`,
  ).run(pseudonym, ...params);
  return counterparty.changes + initiator.changes;
}
