/**
 * @file src/storage/providers/postgres-kysely/methods/account-records-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres SQL for the 28 identity columns an account erasure decides by one list
 *   (../../../erased-account-records.ts): each row is deleted with the account or keeps standing under
 *   the erasure's pseudonym. deleteOwnerCascade (owner-cascade.ts) calls it inside its transaction,
 *   with the pseudonym the work and the receipts took. The SQLite twin is
 *   sqlite/repos/account-records-erasure.ts.
 * @structure eraseAccountRecordsDb(db, name, ghiis, actors, pseudonym)
 * @usage await eraseAccountRecordsDb(db, name, ghiis, actors, pseudonym);
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (QA audit 2026-10-14, K3).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { ERASED_ACCOUNT_RECORDS, erasedIdentities } from '../../../erased-account-records.js';

/** Delete or pseudonymise every row of the 28 columns that names the person. Returns the rows touched. */
export async function eraseAccountRecordsDb(
  db: Kysely<DB>, name: string, ghiis: string[], actors: string[], pseudonym: string,
): Promise<number> {
  const ids = erasedIdentities(name, ghiis, actors, pseudonym);
  let touched = 0;
  for (const rule of ERASED_ACCOUNT_RECORDS) {
    // The table and column come from the fixed list above, never from a caller.
    const table = sql.table(rule.pg);
    const column = sql.ref(rule.column);
    for (const { identity, replacement } of ids) {
      const r = rule.action === 'delete'
        ? await sql`DELETE FROM ${table} WHERE ${column} = ${identity}`.execute(db)
        : await sql`UPDATE ${table} SET ${column} = ${replacement} WHERE ${column} = ${identity}`.execute(db);
      touched += Number(r.numAffectedRows ?? 0);
    }
  }
  return touched;
}
