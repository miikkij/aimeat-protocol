/**
 * @file src/storage/providers/sqlite/schema-rebuilds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two SQLite migrations that ALTER TABLE cannot express, so they rebuild the table:
 *   re-keying push_subscriptions per device, and relaxing invitations.organismId. Pure extraction
 *   from schema.ts, which crossed the 800-line ceiling; both functions are unchanged from the day
 *   they moved, and each is gated on PRAGMA table_info so a fresh database pays nothing.
 * @structure
 *   - splitPushSubscriptionsPerDevice(db)
 *   - relaxInvitationsOrganismId(db)
 * @usage
 *   import { splitPushSubscriptionsPerDevice, relaxInvitationsOrganismId } from './schema-rebuilds.js';
 * @version-history
 *   v1.0.0 -- 2026-09-06 -- Extracted from schema.ts (max-file-lines).
 */
import type Database from 'better-sqlite3';

/**
 * Re-key push_subscriptions from (ownerName) to (ownerName, endpoint) for databases created before
 * 2026-08-11.
 *
 * WHY. With ownerName as the primary key, registering a subscription replaced the one already there:
 * the owner's laptop went silent when their phone subscribed, and any principal holding a token for
 * the account could redirect the person's whole notification stream to a destination of its choosing
 * by subscribing once (audit H-8). SQLite cannot change a primary key with ALTER, so this is the
 * standard rebuild, gated on PRAGMA table_info so a fresh database (which already has the composite
 * key from schema-tables-1) pays nothing. Every existing row is carried over as it is, and there can
 * be no duplicate to collapse because ownerName was unique.
 */
export function splitPushSubscriptionsPerDevice(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('push_subscriptions')").all() as Array<{ name: string; pk: number }>;
  if (!cols.length) return;                                   // table not created yet
  const endpoint = cols.find(c => c.name === 'endpoint');
  if (!endpoint || endpoint.pk > 0) return;                   // endpoint is already part of the key

  db.exec('PRAGMA foreign_keys=OFF');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE push_subscriptions_new (
        ownerName      TEXT NOT NULL,
        endpoint       TEXT NOT NULL,
        keys           TEXT NOT NULL DEFAULT '{}',
        createdAt      TEXT NOT NULL,
        lastUsedAt     TEXT NOT NULL,
        PRIMARY KEY (ownerName, endpoint)
      );
      INSERT INTO push_subscriptions_new (ownerName, endpoint, keys, createdAt, lastUsedAt)
        SELECT ownerName, endpoint, keys, createdAt, lastUsedAt FROM push_subscriptions;
      DROP TABLE push_subscriptions;
      ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
    `);
  });
  tx();
  db.exec('PRAGMA foreign_keys=ON');
}

/**
 * Drop the NOT NULL on invitations.organismId for databases created before the node-level
 * registration invite joined this table (remake 4b).
 *
 * SQLite cannot relax a constraint with ALTER, so this is the standard table rebuild — and it is
 * gated on PRAGMA table_info so a fresh database, where the column is already nullable, pays
 * nothing. Rebuilding unconditionally on every boot would rewrite the table for no reason and
 * would be the kind of migration that silently loses a row the day one column is forgotten.
 */
export function relaxInvitationsOrganismId(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(invitations)').all() as Array<{ name: string; notnull: number }>;
  if (!cols.length) return;                                   // table not created yet
  const org = cols.find(c => c.name === 'organismId');
  if (!org || org.notnull === 0) return;                      // already nullable — nothing to do

  const names = cols.map(c => c.name);
  const carried = names.join(', ');
  db.exec('PRAGMA foreign_keys=OFF');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE invitations_new (
        id               TEXT PRIMARY KEY,
        tokenHash        TEXT NOT NULL,
        organismId       TEXT,
        orgRole          TEXT NOT NULL DEFAULT 'member',
        type             TEXT NOT NULL DEFAULT 'link',
        workspaces       TEXT NOT NULL DEFAULT '[]',
        email            TEXT NOT NULL,
        emailHash        TEXT NOT NULL,
        invitedBy        TEXT NOT NULL,
        provisionedOwner TEXT,
        message          TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        createdAt        TEXT NOT NULL,
        expiresAt        TEXT NOT NULL,
        acceptedAt       TEXT,
        acceptedBy       TEXT,
        returnUrl        TEXT,
        meta             TEXT
      );
      INSERT INTO invitations_new (${carried}) SELECT ${carried} FROM invitations;
      DROP TABLE invitations;
      ALTER TABLE invitations_new RENAME TO invitations;
      CREATE INDEX IF NOT EXISTS idx_invitations_tokenHash ON invitations(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_invitations_organismId ON invitations(organismId);
      CREATE INDEX IF NOT EXISTS idx_invitations_emailHash ON invitations(emailHash);
      CREATE INDEX IF NOT EXISTS idx_invitations_expiresAt ON invitations(expiresAt);
    `);
  });
  tx();
  db.exec('PRAGMA foreign_keys=ON');
}
