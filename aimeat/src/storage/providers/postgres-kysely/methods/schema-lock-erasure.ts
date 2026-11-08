/**
 * @file src/storage/providers/postgres-kysely/methods/schema-lock-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres SQL for the schema locks an erased account, its agents or its ecosystem apps
 *   hold. deleteOwnerCascade (owner-cascade.ts) calls it inside its transaction, after the cortex pass
 *   (identity-erasure.ts deleteInstalledCortexesDb) took the locks of the account's own cortexes.
 *
 *   WHY. A lock is found by its key pattern and governs every account's writes to a matching key, so
 *   it outlives its holder: it stays in force and names the erasure's pseudonym, which no account
 *   matches. Before, it kept `alice`, `alice@node` or `bot#alice@node`, and the account that registered
 *   the released name next (and that account's agent of the same name) held it (secaudit2026nov08
 *   round 14, agent-gaii-lock-survives-account-erasure and older item O1). The operator still changes
 *   and removes it through the operator override. The SQLite twin is
 *   sqlite/repos/schema-lock-erasure.ts.
 * @structure pseudonymiseSchemaLocksDb(db, name, ghiis, pseudonym)
 * @usage await pseudonymiseSchemaLocksDb(db, name, ghiis.map(g => g.ghii), pseudonym);
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import { partyIdentities } from '../../../erased-party.js';
import { invalidateSchemaLockCache } from '../../../schema-lock-cache.js';

/**
 * Every lock held by the bare name, a GHII, or `<anything>#<ghii>` (an agent or an ecosystem app of
 * the account, a deleted agent included) names `pseudonym` from now on. Returns the rows changed.
 * Postgres LIKE escapes with a backslash by default, which is how partyIdentities escapes.
 */
export async function pseudonymiseSchemaLocksDb(db: Kysely<DB>, name: string, ghiis: string[], pseudonym: string): Promise<number> {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const r = await db.updateTable('SchemaLock').set({ lockedBy: pseudonym })
    .where(eb => eb.or([eb('lockedBy', 'in', exact), ...suffixPatterns.map(p => eb('lockedBy', 'like', p))]))
    .executeTakeFirst();
  const changed = Number(r.numUpdatedRows ?? 0);
  // Every memory write reads the schema locks from a process cache, which a change refreshes. Its
  // short lifetime covers a write that reloads it before this transaction commits.
  if (changed > 0) invalidateSchemaLockCache();
  return changed;
}
