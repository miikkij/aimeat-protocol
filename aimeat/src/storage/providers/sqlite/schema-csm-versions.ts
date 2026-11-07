/**
 * @file src/storage/providers/sqlite/schema-csm-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0127_csm_versions.sql: csms.visibility and
 *   csms.version, and the csm_versions table that keeps every version a PUT /v1/csm/{name} replaced.
 *   A row stored before has visibility 'public' and version 1, which is what it answered before.
 *   Called at the end of applySchemaTables4; idempotent on every boot.
 * @structure applyCsmVersionSchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility and versions; Jouni, 2026-11-07).
 */
import type Database from 'better-sqlite3';

export function applyCsmVersionSchema(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(csms)').all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'visibility')) {
    db.exec(`ALTER TABLE csms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`);
  }
  if (!columns.some(c => c.name === 'version')) {
    db.exec('ALTER TABLE csms ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS csm_versions (
      name          TEXT    NOT NULL,
      version       INTEGER NOT NULL,
      definition    TEXT    NOT NULL DEFAULT '{}',
      jsonSchema    TEXT    NOT NULL DEFAULT '{}',
      registeredBy  TEXT    NOT NULL,
      createdAt     TEXT    NOT NULL,
      PRIMARY KEY (name, version)
    );
  `);
}
