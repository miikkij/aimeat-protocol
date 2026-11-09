/**
 * @file src/storage/providers/sqlite/repos/schema-lock-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the schema locks an erased account, its agents or its ecosystem apps
 *   hold. deleteOwner (methods/identity.ts) calls it inside its own transaction, after the cortex pass
 *   (repos/cortex-erasure.ts) took the locks of the account's own cortexes.
 *
 *   WHY. A lock is found by its key pattern and governs every account's writes to a matching key, so
 *   it outlives its holder: it stays in force and names the erasure's pseudonym, which no account
 *   matches. Before, it kept `alice`, `alice@node` or `bot#alice@node`, and the account that registered
 *   the released name next (and that account's agent of the same name) held it (secaudit2026nov08
 *   round 14, agent-gaii-lock-survives-account-erasure and older item O1). The operator still changes
 *   and removes it through the operator override. The Postgres twin is
 *   postgres-kysely/methods/schema-lock-erasure.ts.
 * @structure pseudonymiseSchemaLocks(db, name, ghiis, pseudonym)
 * @usage pseudonymiseSchemaLocks(this.db, name, ghiiRows.map(r => r.ghii), pseudonym);
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import type Database from 'better-sqlite3';
import { partyIdentities } from '../../../erased-party.js';
import { invalidateSchemaLockCache } from '../../../schema-lock-cache.js';

/**
 * Every lock held by the bare name, a GHII, or `<anything>#<ghii>` (an agent or an ecosystem app of
 * the account, a deleted agent included) names `pseudonym` from now on. Returns the rows changed.
 */
export function pseudonymiseSchemaLocks(db: Database.Database, name: string, ghiis: string[], pseudonym: string): number {
  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  const where = [`lockedBy IN (${exact.map(() => '?').join(', ')})`, ...suffixPatterns.map(() => `lockedBy LIKE ? ESCAPE '\\'`)].join(' OR ');
  const changed = db.prepare(`UPDATE schemas SET lockedBy = ? WHERE ${where}`).run(pseudonym, ...exact, ...suffixPatterns).changes;
  // Every memory write reads the schema locks from a process cache, which a change refreshes.
  if (changed > 0) invalidateSchemaLockCache();
  return changed;
}
