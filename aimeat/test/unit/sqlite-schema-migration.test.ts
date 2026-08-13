/**
 * @file sqlite-schema-migration.test.ts
 * @description Regression tests for SQLite in-place schema migrations (sqlite/schema.ts).
 *   Simulates upgrading a pre-existing database whose `ghiis` table predates a newer
 *   column, then runs initializeSchema() and asserts it neither throws nor leaves the
 *   schema half-migrated. Guards the class of bug where an index on an ALTER-added column
 *   was created in the main CREATE block (before the ALTER), crashing self-host upgrades
 *   with "no such column: googleSub" (1.25 → 1.27).
 * @version-history
 *   v1.1.0 — 2026-08-13 — Two more of the same class, both reachable from a real upgrade: a
 *     provider_clients table in the pre-principal shape (the 2.7.0 -> 3.0.0 boot crash reported from
 *     a self-hosted node) and a ghiis table with no emailHash at all, which the original seed here
 *     happened to include and so never exercised.
 *   v1.0.0 — 2026-06-21 — Initial suite (googleSub upgrade-path regression).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/storage/providers/sqlite/schema.js';

/** Columns currently present on a table (PRAGMA table_info). */
function columns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** True if a named index exists. */
function hasIndex(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name);
  return !!row;
}

describe('SQLite schema migrations — upgrade path', () => {
  it('adds googleSub (+ its index) to a pre-existing ghiis table without crashing', () => {
    const db = new Database(':memory:');

    // Simulate a pre-1.27 database: ghiis table exists WITHOUT googleSub, mirroring an
    // old self-host node. CREATE TABLE IF NOT EXISTS will be a no-op for this table, so
    // the column can only arrive via the ALTER migration.
    db.exec(`
      CREATE TABLE ghiis (
        ghii        TEXT PRIMARY KEY,
        username    TEXT NOT NULL,
        nodeId      TEXT NOT NULL,
        displayName TEXT NOT NULL,
        passwordHash TEXT,
        ownerName   TEXT NOT NULL,
        emailHash   TEXT,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );
      -- Indexes that pre-1.27 nodes already had on their older columns; only the
      -- googleSub index/column is genuinely new and must be added by migration.
      CREATE INDEX IF NOT EXISTS idx_ghii_ownerName ON ghiis(ownerName);
      CREATE INDEX IF NOT EXISTS idx_ghii_emailHash ON ghiis(emailHash);
    `);

    expect(columns(db, 'ghiis').has('googleSub')).toBe(false);

    // The crash: initializeSchema used to throw "no such column: googleSub" here.
    expect(() => initializeSchema(db)).not.toThrow();

    // Migration actually completed: column + lookup index both present.
    expect(columns(db, 'ghiis').has('googleSub')).toBe(true);
    expect(hasIndex(db, 'idx_ghii_googleSub')).toBe(true);

    db.close();
  });

  it('adds emailHash (+ its indexes) to a ghiis table that predates the column', () => {
    const db = new Database(':memory:');

    // Older than the seed above: no emailHash and no emailVerifiedAt either. Both the unique
    // one-email-per-node index and the plain lookup index name emailHash, so either one created
    // before the ALTER crashes the boot with "no such column: emailHash".
    db.exec(`
      CREATE TABLE ghiis (
        ghii        TEXT PRIMARY KEY,
        username    TEXT NOT NULL,
        nodeId      TEXT NOT NULL,
        displayName TEXT NOT NULL,
        ownerName   TEXT NOT NULL,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ghii_ownerName ON ghiis(ownerName);
    `);

    expect(columns(db, 'ghiis').has('emailHash')).toBe(false);
    expect(() => initializeSchema(db)).not.toThrow();

    expect(columns(db, 'ghiis').has('emailHash')).toBe(true);
    expect(hasIndex(db, 'idx_ghii_emailHash')).toBe(true);
    expect(hasIndex(db, 'ux_ghii_emailHash')).toBe(true);

    db.close();
  });

  it('rebuilds a pre-principal provider_clients table without crashing, keeping its rows', () => {
    const db = new Database(':memory:');

    // The shape a node upgrading 2.7.0 -> 3.0.0 arrived with: instance NOT NULL, no principal
    // column. CREATE TABLE IF NOT EXISTS is a no-op here, so principal can only arrive from the
    // guarded rebuild in schema.ts, and any index naming principal before that point throws.
    db.exec(`
      CREATE TABLE provider_clients (
        id           TEXT PRIMARY KEY,
        provider     TEXT NOT NULL,
        instance     TEXT NOT NULL,
        clientId     TEXT NOT NULL,
        clientSecret TEXT NOT NULL,
        registeredAt TEXT NOT NULL
      );
      INSERT INTO provider_clients (id, provider, instance, clientId, clientSecret, registeredAt)
        VALUES ('pc-1', 'mastodon', 'mastodon.social', 'cid-1', 'sec-1', '2026-01-01T00:00:00.000Z');
    `);

    expect(columns(db, 'provider_clients').has('principal')).toBe(false);

    // The crash: "no such column: principal", raised from applySchemaTables3 before the rebuild ran.
    expect(() => initializeSchema(db)).not.toThrow();

    expect(columns(db, 'provider_clients').has('principal')).toBe(true);
    expect(hasIndex(db, 'idx_provider_clients_key')).toBe(true);
    expect(hasIndex(db, 'idx_provider_clients_principal')).toBe(true);

    // instance may now be NULL (that is what the rebuild was for), and the existing registration
    // survived it: a node that loses these has to re-register at every provider instance.
    const instanceCol = (db.prepare("PRAGMA table_info('provider_clients')").all() as
      Array<{ name: string; notnull: number }>).find((c) => c.name === 'instance');
    expect(instanceCol?.notnull).toBe(0);
    const row = db.prepare('SELECT * FROM provider_clients WHERE id = ?').get('pc-1') as
      { clientId: string; instance: string; principal: string | null } | undefined;
    expect(row?.clientId).toBe('cid-1');
    expect(row?.instance).toBe('mastodon.social');
    expect(row?.principal).toBeNull();

    db.close();
  });

  it('is idempotent — a fresh DB initialized twice still has googleSub + index', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
    expect(columns(db, 'ghiis').has('googleSub')).toBe(true);
    expect(hasIndex(db, 'idx_ghii_googleSub')).toBe(true);
    db.close();
  });
});
