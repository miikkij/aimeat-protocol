/**
 * @file src/storage/providers/sqlite/repos/app-purchase-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the purchase receipts an erased person leaves behind. deleteOwner
 *   (methods/owner.ts) calls it inside its own transaction. A free function over the connection,
 *   like pseudonymiseWriter in repos/memory-tally.ts, so the owner methods can call it without an
 *   import cycle through the provider class.
 * @structure pseudonymisePurchaseParties(db, name, ghiis, pseudonym)
 * @usage pseudonymisePurchaseParties(this.db, name, ghiis, erasedPartyPseudonym());
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial: the kept receipts, rewritten to a pseudonym no account can hold
 *     (audit A8-4). The Postgres twin is pseudonymisePurchasePartiesDb in its owner-cascade.ts.
 */
import type Database from 'better-sqlite3';
import { partyIdentities } from '../../../erased-party.js';

/**
 * Rewrite an erased person out of every purchase receipt they are a party to, and keep the receipts.
 *
 * A receipt is also the OTHER side's record, so it outlives the account (the "AppPurchase" entry in
 * security/storage-parity-exemptions.json). But a deleted username is released for reuse, and every
 * purchase read, the licence check and the sales list key on `name@node`. So a receipt that kept the
 * name handed the next registrant of that name the receipts, the paid content in them and a valid
 * licence. Each side is rewritten when its own account goes. The amounts, the dates, the app and the
 * other party stay for the books.
 *
 * The node's signature goes too. It was made over the erased identity, and every other field it
 * covered is still in the row, so keeping it would let anyone who holds the row confirm a guessed
 * name. An empty signature is what an unsigned receipt already carries.
 *
 * SQLite LIKE has no escape character unless it is named, so each pattern names the backslash that
 * partyIdentities escapes with. Written out twice rather than looped over the two sides, so each
 * statement names its own columns.
 */
export function pseudonymisePurchaseParties(
  db: Database.Database, name: string, ghiis: string[], pseudonym: string,
): number {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const matches = (column: string): string => [
    `${column} IN (${exact.map(() => '?').join(', ')})`,
    ...suffixPatterns.map(() => `${column} LIKE ? ESCAPE '\\'`),
  ].join(' OR ');
  const buyer = db.prepare(
    `UPDATE app_purchases SET buyerGaii = ?, buyerOwner = ?, signature = '' WHERE ${matches('buyerGaii')}`,
  ).run(pseudonym, pseudonym, ...exact, ...suffixPatterns);
  const seller = db.prepare(
    `UPDATE app_purchases SET sellerGaii = ?, sellerOwner = ?, signature = '' WHERE ${matches('sellerGaii')}`,
  ).run(pseudonym, pseudonym, ...exact, ...suffixPatterns);
  return buyer.changes + seller.changes;
}
