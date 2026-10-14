/**
 * @file src/storage/providers/sqlite/repos/account-records-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the 28 identity columns an account erasure decides by one list
 *   (../../../erased-account-records.ts): each row is deleted with the account or keeps standing under
 *   the erasure's pseudonym. deleteOwner (methods/identity.ts) calls it inside its own transaction,
 *   with the pseudonym the work and the receipts took. The Postgres twin is
 *   postgres-kysely/methods/account-records-erasure.ts.
 * @structure eraseAccountRecords(db, name, ghiis, actors, pseudonym)
 * @usage eraseAccountRecords(this.db, name, ghiis, actors, pseudonym);
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (QA audit 2026-10-14, K3).
 */
import type Database from 'better-sqlite3';
import { ERASED_ACCOUNT_RECORDS, erasedIdentities } from '../../../erased-account-records.js';

/** Delete or pseudonymise every row of the 28 columns that names the person. Returns the rows touched. */
export function eraseAccountRecords(
  db: Database.Database, name: string, ghiis: string[], actors: string[], pseudonym: string,
): number {
  const ids = erasedIdentities(name, ghiis, actors, pseudonym);
  let touched = 0;
  for (const rule of ERASED_ACCOUNT_RECORDS) {
    for (const { identity, replacement } of ids) {
      touched += rule.action === 'delete'
        ? db.prepare(`DELETE FROM ${rule.sqlite} WHERE ${rule.column} = ?`).run(identity).changes
        : db.prepare(`UPDATE ${rule.sqlite} SET ${rule.column} = ? WHERE ${rule.column} = ?`).run(replacement, identity).changes;
    }
  }
  return touched;
}
