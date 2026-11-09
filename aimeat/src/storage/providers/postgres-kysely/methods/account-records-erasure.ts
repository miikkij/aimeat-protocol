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
 *   v1.1.0 — 2026-11-08 — The person's receiver principals are found in the columns a receiver writes
 *     and named by the pseudonym too (RECEIVER_PRINCIPAL_COLUMNS; secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-10-14 — Initial (QA audit 2026-10-14, K3).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { ERASED_ACCOUNT_RECORDS, RECEIVER_PRINCIPAL_COLUMNS, erasedIdentities, receiverPrincipalPatterns } from '../../../erased-account-records.js';

/** Every receiver principal of the person that a row or an audit row names. The list is fixed, never a caller's. */
async function receiverPrincipalsDb(db: Kysely<DB>, name: string, ghiis: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of receiverPrincipalPatterns(name, ghiis)) {
    for (const c of RECEIVER_PRINCIPAL_COLUMNS) {
      const column = sql.ref(c.column);
      const r = await sql<{ v: string | null }>`SELECT DISTINCT ${column} AS v FROM ${sql.table(c.pg)} WHERE ${column} LIKE ${pattern} ESCAPE '\\'`.execute(db);
      for (const row of r.rows) if (row.v) found.add(row.v);
    }
  }
  return [...found].sort();
}

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
  // The receivers' principals, numbered after the identities above so no two values meet.
  const receivers = await receiverPrincipalsDb(db, name, ghiis);
  const receiverIds = erasedIdentities(name, ghiis, [...actors, ...receivers], pseudonym).slice(ids.length);
  for (const c of RECEIVER_PRINCIPAL_COLUMNS) {
    const table = sql.table(c.pg);
    const column = sql.ref(c.column);
    for (const { identity, replacement } of receiverIds) {
      const r = await sql`UPDATE ${table} SET ${column} = ${replacement} WHERE ${column} = ${identity}`.execute(db);
      touched += Number(r.numAffectedRows ?? 0);
    }
  }
  return touched;
}
