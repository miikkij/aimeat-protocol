/**
 * @file src/storage/providers/sqlite/schema-app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0132_app_parties.sql: an app's own users and
 *   what they keep in it (types/app-parties.ts). JSON fields are TEXT, times are ISO strings. Called at
 *   the end of applySchemaTables4; idempotent on every boot.
 * @structure applyAppPartySchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial
 */
import type Database from 'better-sqlite3';

export function applyAppPartySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_parties (
      uid           TEXT PRIMARY KEY,
      ownerGhii     TEXT NOT NULL,
      appId         TEXT NOT NULL,
      name          TEXT NOT NULL,
      emailHash     TEXT NOT NULL,
      status        TEXT NOT NULL,
      linkHash      TEXT,
      linkExpiresAt TEXT,
      verifiedAt    TEXT,
      pendingSince  TEXT NOT NULL,
      epoch         INTEGER NOT NULL DEFAULT 0,
      record        TEXT NOT NULL,
      createdAt     TEXT NOT NULL,
      updatedAt     TEXT NOT NULL,
      version       INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_parties_app_email ON app_parties(appId, emailHash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_parties_owner_name ON app_parties(ownerGhii, name);
    CREATE INDEX IF NOT EXISTS idx_app_parties_app_status ON app_parties(appId, status);
    CREATE INDEX IF NOT EXISTS idx_app_parties_app_link ON app_parties(appId, linkHash);
    CREATE INDEX IF NOT EXISTS idx_app_parties_owner ON app_parties(ownerGhii);

    CREATE TABLE IF NOT EXISTS app_party_data (
      appId     TEXT NOT NULL,
      partyUid  TEXT NOT NULL,
      key       TEXT NOT NULL,
      ownerGhii TEXT NOT NULL,
      value     TEXT NOT NULL,
      bytes     INTEGER NOT NULL DEFAULT 0,
      version   INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (appId, partyUid, key)
    );
    CREATE INDEX IF NOT EXISTS idx_app_party_data_owner ON app_party_data(ownerGhii);
  `);
}
