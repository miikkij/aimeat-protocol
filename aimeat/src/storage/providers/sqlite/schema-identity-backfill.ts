/**
 * @file src/storage/providers/sqlite/schema-identity-backfill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite half of Postgres migration 0085: actions a person published, the work on
 *   them and the requests a person made move from the bare account name to the person's GHII.
 *
 *   ONCE FOR EACH DATABASE. schema.ts calls it on every open, and it runs the move only when
 *   system_settings has no IDENTITY_BACKFILL_RECORD row. It writes that row in the same transaction
 *   as the move, so a database is moved once, as the Postgres runner applies a file once and records
 *   it in `_kysely_migrations`. A later open reads the row and changes nothing.
 *
 *   A PSEUDONYM IS NEVER A NAME. A value that starts with ERASED_PARTY_PREFIX is what an erasure
 *   wrote in place of a person (storage/erased-party.ts). It has no `@` and no `#`, like an account
 *   name, so the test for a bare name leaves it out by name. The move never reads one, and every
 *   pseudonym an erasure wrote stays as it was.
 *
 *   WHY. An action a person publishes is stored under their full identity, like an agent's under its
 *   GAII, and every work door compares the full identity (routes/actions.ts, routes/work.ts). Rows
 *   written before carry the bare name, and no door would find them under it.
 *
 *   WHICH ACCOUNT. A row moves only to an account that existed when the row was written. A deleted
 *   username is released for reuse, so a row older than the account holding its name now belonged to
 *   a person whose account is gone. That person's actions go, and their work is settled the way
 *   deleting their account settles it (repos/work-erasure.ts): open work is cancelled and the
 *   requester's held morsels go back, finished work stays for the other side under a pseudonym.
 *   Held morsels go back only to an account that existed when the row was written: a later holder of
 *   the requester's name is somebody else, and gets nothing (payerWhenWritten).
 *   A copy of another node's action (id `<node>:<id>`, tag `federated:<node>`) names a person of that
 *   node and is left as it is.
 * @structure
 *   - IDENTITY_BACKFILL_RECORD: the system_settings row that says a database has been moved
 *   - moveActionsAndWorkToFullIdentity(db): the move, once for each database
 * @usage moveActionsAndWorkToFullIdentity(db);   // from initializeSchema in schema.ts
 * @version-history
 *   v1.2.0 — 2026-09-26 — Held morsels go back only to an account that existed when the row was
 *     written (payerWhenWritten; secaudit 2026-09: R3 7b). Mirrors Postgres 0085.
 *   v1.1.0 — 2026-09-26 — Runs once for each database and records that it ran
 *     (IDENTITY_BACKFILL_RECORD), and a value that starts with ERASED_PARTY_PREFIX is never read as an
 *     account name (secaudit 2026-09: R3 7a). Mirrors Postgres 0085.
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09: N6, F-1). Mirrors Postgres 0085.
 */
import type Database from 'better-sqlite3';
import { erasedPartyPseudonym, ERASED_PARTY_PREFIX } from '../../erased-party.js';
import { settleErasedPartyWork } from './repos/work-erasure.js';
import { resolveGhiiIn } from './repos/ghii-resolve.js';

/**
 * The system_settings row that says this database has been moved, named after the Postgres file
 * this mirrors. Outside the `config:` keys, so no config read sees it.
 */
export const IDENTITY_BACKFILL_RECORD = 'migration:0085_actions_work_full_identity.sql';

/** A bare account name: no node, no agent, and not a pseudonym an erasure wrote. */
const bare = (column: string): string =>
  `instr(${column}, '@') = 0 AND instr(${column}, '#') = 0`
  + ` AND substr(${column}, 1, ${ERASED_PARTY_PREFIX.length}) <> '${ERASED_PARTY_PREFIX}'`;

/**
 * The GHII of the account named in `column`, when that account existed at `createdAt`; NULL when no
 * account holds the name, or the one that does came later.
 */
const heldGhii = (column: string, createdAt: string): string =>
  `(SELECT g.ghii FROM owners o JOIN ghiis g ON g.ownerName = o.name
     WHERE o.name = ${column} AND o.createdAt <= ${createdAt} ORDER BY g.createdAt LIMIT 1)`;

/** An action of this node rather than a copy of another node's. */
const LOCAL_ACTION = `instr(actions.id, ':') = 0 AND actions.tags NOT LIKE '%"federated:%'`;

/**
 * The balance a held request goes back to: the requester's GHII, found the way every balance op finds
 * it, when that account already existed when the row was written. A name is released for reuse, so
 * an account registered later under the requester's name is somebody else, and nothing goes back,
 * as for a requester whose account is gone.
 */
function payerWhenWritten(db: Database.Database, identity: string, writtenAt: string): string | null {
  const ghii = resolveGhiiIn(db, identity);
  if (!ghii) return null;
  const existed = db.prepare(
    'SELECT 1 FROM ghiis g JOIN owners o ON o.name = g.ownerName WHERE g.ghii = ? AND o.createdAt <= ?',
  ).get(ghii, writtenAt);
  return existed ? ghii : null;
}

/**
 * Move bare-name actions and work to the GHII, and settle what a deleted account left, once for each
 * database. The row that says so is written in the same transaction as the move.
 */
export function moveActionsAndWorkToFullIdentity(db: Database.Database): void {
  const run = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM system_settings WHERE key = ?').get(IDENTITY_BACKFILL_RECORD)) return;

    const actionGhii = heldGhii('actions.providerGaii', 'actions.createdAt');
    db.exec(`
      UPDATE actions SET providerGaii = ${actionGhii}
      WHERE ${bare('providerGaii')} AND ${LOCAL_ACTION} AND ${actionGhii} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM actions x WHERE x.id = actions.id AND x.providerGaii = ${actionGhii});
      DELETE FROM actions
      WHERE ${bare('providerGaii')} AND ${LOCAL_ACTION}
        AND NOT EXISTS (SELECT 1 FROM owners o WHERE o.name = actions.providerGaii AND o.createdAt <= actions.createdAt);
    `);
    for (const column of ['providerGaii', 'requesterGaii']) {
      const workGhii = heldGhii(`work.${column}`, 'work.createdAt');
      db.exec(`UPDATE work SET ${column} = ${workGhii} WHERE ${bare(column)} AND ${workGhii} IS NOT NULL`);
    }

    // What is left under a bare name belonged to a deleted account: every row when nobody holds the
    // name now, the rows older than the account when somebody does.
    const left = db.prepare(
      `SELECT providerGaii AS name FROM work WHERE ${bare('providerGaii')}
       UNION SELECT requesterGaii FROM work WHERE ${bare('requesterGaii')}`,
    ).all() as { name: string }[];
    for (const { name } of left) {
      const holder = db.prepare('SELECT createdAt FROM owners WHERE name = ?').get(name) as { createdAt: string } | undefined;
      settleErasedPartyWork(db, name, [], erasedPartyPseudonym(), (id, writtenAt) => payerWhenWritten(db, id, writtenAt), { createdBefore: holder?.createdAt });
    }

    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run(IDENTITY_BACKFILL_RECORD, new Date().toISOString());
  });
  // IMMEDIATE takes the write lock before the row is read, so two processes opening one file at the
  // same time do not both move it: the second waits (busy_timeout), then reads the row.
  run.immediate();
}
