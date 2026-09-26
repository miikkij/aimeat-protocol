/**
 * @file src/storage/providers/sqlite/repos/ai-provenance-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the AI provenance records an erased person leaves behind. deleteOwner
 *   (methods/owner.ts) calls it inside its own transaction, beside the purchase receipts
 *   (repos/app-purchase-erasure.ts) and with the same pseudonym. A free function over the connection
 *   for the same reason that file gives: no import cycle through the provider class.
 * @structure pseudonymiseProvenanceOwner(db, name, ghiis, pseudonym)
 * @usage pseudonymiseProvenanceOwner(this.db, name, ghiis, pseudonym);
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the kept records, with the owner and principal columns rewritten to
 *     a pseudonym no account can hold (secaudit 2026-09: A8-4). The Postgres twin is
 *     pseudonymiseProvenanceOwnerDb in its owner-cascade.ts.
 */
import type Database from 'better-sqlite3';
import { partyIdentities } from '../../../erased-party.js';

/**
 * Take an erased person out of the two columns that say whose AI provenance record it is, and keep
 * the record.
 *
 * A record outlives the account, because it answers "which model made these bytes" for content that
 * can outlive it (the "AiProvenance" entry in security/storage-parity-exemptions.json). But the
 * owner's list, the owner view, the owner's hash lookup and attaching a record to new content all
 * key on `ownerGhii`, and a deleted username is released for reuse. So a record that kept
 * `name@node` there belonged to whoever registered the name next. `ownerGhii` and `principal` become
 * the erasure's pseudonym. The statement itself (`record`) stays as it was: it is what the readers of
 * the content are owed, and no read decides access on it.
 *
 * `principal` can be the person's GHII, an agent or app acting for them (`…#name@node`), or the bare
 * name an owner session once stored, so it is matched the way the purchase receipts match a party.
 * SQLite LIKE has no escape character unless it is named, so each pattern names the backslash.
 */
export function pseudonymiseProvenanceOwner(
  db: Database.Database, name: string, ghiis: string[], pseudonym: string,
): number {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const inExact = exact.map(() => '?').join(', ');
  const where = [
    `ownerGhii IN (${inExact})`,
    `principal IN (${inExact})`,
    ...suffixPatterns.map(() => `principal LIKE ? ESCAPE '\\'`),
  ].join(' OR ');
  return db.prepare(`UPDATE ai_provenance SET ownerGhii = ?, principal = ? WHERE ${where}`)
    .run(pseudonym, pseudonym, ...exact, ...exact, ...suffixPatterns).changes;
}
