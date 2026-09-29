/**
 * @file src/storage/providers/sqlite/repos/credential-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the credentials issued in an account name: the app grants, the personal
 *   access tokens and the session rows. The account deletion (deleteOwner in methods/owner.ts), the
 *   start step for credentials and the operator's decision on a held name (repos/held-names.ts) call
 *   this one function. A free function over the connection, like the other erasure repos, so there is
 *   no import cycle through the provider class. The Postgres twin is deleteAccountCredentialsDb in its
 *   methods/identity-erasure.ts.
 * @structure deleteAccountCredentials(db, owner, opts)
 * @usage deleteAccountCredentials(this.db, name, { sessions: true });
 * @version-history
 *   v1.0.0 — 2026-09-26 — What deleteOwner did for the app grants and the personal access tokens
 *     inline, with the session rows, as the Postgres cascade deletes them.
 */
import type Database from 'better-sqlite3';

/**
 * The app grants the person gave, the personal access tokens they made and, with `sessions`, the
 * session rows, revoked ones included. Each is issued in a name that is released for reuse, so it goes
 * with the account, and the next holder of the name starts with none.
 *
 * `before` (an ISO time) limits it to the grants and tokens whose createdAt is before that time: the
 * ones older than the account that holds the name now, when the operator decides they were a previous
 * holder's. Returns what it deleted.
 */
export function deleteAccountCredentials(
  db: Database.Database, owner: string, opts: { before?: string; sessions?: boolean } = {},
): { appGrants: number; accessTokens: number; sessions: number } {
  const older = opts.before !== undefined ? ' AND createdAt < ?' : '';
  const params = opts.before !== undefined ? [owner, opts.before] : [owner];
  const appGrants = db.prepare(`DELETE FROM app_grants WHERE owner = ?${older}`).run(...params).changes;
  const accessTokens = db.prepare(`DELETE FROM personal_access_tokens WHERE owner = ?${older}`).run(...params).changes;
  const sessions = opts.sessions ? db.prepare('DELETE FROM sessions WHERE owner = ?').run(owner).changes : 0;
  return { appGrants, accessTokens, sessions };
}
