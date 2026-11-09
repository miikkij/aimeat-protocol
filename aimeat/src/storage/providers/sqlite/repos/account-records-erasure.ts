/**
 * @file src/storage/providers/sqlite/repos/account-records-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the 28 identity columns an account erasure decides by one list
 *   (../../../erased-account-records.ts): each row is deleted with the account or keeps standing under
 *   the erasure's pseudonym. deleteOwner (methods/identity.ts) calls it inside its own transaction,
 *   with the pseudonym the work and the receipts took. The SQLite twin is
 *   postgres-kysely/methods/account-records-erasure.ts.
 * @structure eraseAccountRecords(db, name, ghiis, actors, pseudonym)
 * @usage eraseAccountRecords(this.db, name, ghiis, actors, pseudonym);
 * @version-history
 *   v1.1.0 — 2026-11-08 — The person's receiver principals are found in the columns a receiver writes
 *     and named by the pseudonym too (RECEIVER_PRINCIPAL_COLUMNS; secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-10-14 — Initial (QA audit 2026-10-14, K3).
 */
import type Database from 'better-sqlite3';
import { ERASED_ACCOUNT_RECORDS, RECEIVER_PRINCIPAL_COLUMNS, erasedIdentities, receiverPrincipalPatterns } from '../../../erased-account-records.js';

/** Every receiver principal of the person that a row or an audit row names. The list is fixed, never a caller's. */
function receiverPrincipals(db: Database.Database, name: string, ghiis: string[]): string[] {
  const found = new Set<string>();
  for (const pattern of receiverPrincipalPatterns(name, ghiis)) {
    for (const c of RECEIVER_PRINCIPAL_COLUMNS) {
      const rows = db.prepare(`SELECT DISTINCT ${c.column} AS v FROM ${c.sqlite} WHERE ${c.column} LIKE ? ESCAPE '\\'`).all(pattern) as Array<{ v: string | null }>;
      for (const r of rows) if (r.v) found.add(r.v);
    }
  }
  return [...found].sort();
}

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
  // The receivers' principals, numbered after the identities above so no two values meet.
  const receivers = receiverPrincipals(db, name, ghiis);
  const receiverIds = erasedIdentities(name, ghiis, [...actors, ...receivers], pseudonym).slice(ids.length);
  for (const c of RECEIVER_PRINCIPAL_COLUMNS) {
    for (const { identity, replacement } of receiverIds) {
      touched += db.prepare(`UPDATE ${c.sqlite} SET ${c.column} = ? WHERE ${c.column} = ?`).run(replacement, identity).changes;
    }
  }
  return touched;
}
