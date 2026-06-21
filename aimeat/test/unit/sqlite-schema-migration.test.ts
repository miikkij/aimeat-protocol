/**
 * @file sqlite-schema-migration.test.ts
 * @description Regression tests for SQLite in-place schema migrations (sqlite/schema.ts).
 *   Simulates upgrading a pre-existing database whose `ghiis` table predates a newer
 *   column, then runs initializeSchema() and asserts it neither throws nor leaves the
 *   schema half-migrated. Guards the class of bug where an index on an ALTER-added column
 *   was created in the main CREATE block (before the ALTER), crashing self-host upgrades
 *   with "no such column: googleSub" (1.25 → 1.27).
 * @version-history
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

  it('is idempotent — a fresh DB initialized twice still has googleSub + index', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    expect(() => initializeSchema(db)).not.toThrow();
    expect(columns(db, 'ghiis').has('googleSub')).toBe(true);
    expect(hasIndex(db, 'idx_ghii_googleSub')).toBe(true);
    db.close();
  });
});
