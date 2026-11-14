/**
 * @file src/storage/providers/sqlite/schema-secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0130_secret_shares.sql: secret shares and
 *   requests, their event log, the people named on them and the browsers' end-to-end device keys
 *   (types/secret-shares.ts). JSON fields are TEXT, times are ISO strings, codeLogin is INTEGER 0/1.
 *   Called at the end of applySchemaTables4; idempotent on every boot.
 * @structure applySecretShareSchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
import type Database from 'better-sqlite3';

export function applySecretShareSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secret_shares (
      id               TEXT PRIMARY KEY,
      ownerGhii        TEXT NOT NULL,
      createdBy        TEXT NOT NULL,
      organismId       TEXT,
      kind             TEXT NOT NULL,
      name             TEXT NOT NULL,
      note             TEXT NOT NULL DEFAULT '',
      format           TEXT NOT NULL,
      fileName         TEXT,
      contentType      TEXT,
      ciphertext       TEXT,
      sizeBytes        INTEGER NOT NULL DEFAULT 0,
      protection       TEXT NOT NULL,
      recipients       TEXT NOT NULL DEFAULT '{}',
      codeHash         TEXT,
      codeLogin        INTEGER NOT NULL DEFAULT 0,
      codeSalt         TEXT,
      retention        TEXT NOT NULL,
      maxPickups       INTEGER,
      expiresAt        TEXT,
      pickups          INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL,
      depositTokenHash TEXT,
      requestExpiresAt TEXT,
      depositedAt      TEXT,
      depositedBy      TEXT,
      "check"          TEXT,
      e2eKeys          TEXT,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      revokedAt        TEXT,
      revokedBy        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_secret_shares_owner ON secret_shares(ownerGhii);
    CREATE INDEX IF NOT EXISTS idx_secret_shares_organism ON secret_shares(organismId);
    CREATE INDEX IF NOT EXISTS idx_secret_shares_status_expires ON secret_shares(status, expiresAt);
    CREATE INDEX IF NOT EXISTS idx_secret_shares_status_request_expires ON secret_shares(status, requestExpiresAt);

    CREATE TABLE IF NOT EXISTS secret_share_events (
      id         TEXT PRIMARY KEY,
      shareId    TEXT NOT NULL,
      at         TEXT NOT NULL,
      kind       TEXT NOT NULL,
      actor      TEXT NOT NULL,
      onBehalfOf TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_secret_share_events_share_at ON secret_share_events(shareId, at);

    CREATE TABLE IF NOT EXISTS secret_share_members (
      shareId TEXT NOT NULL,
      ghii    TEXT NOT NULL,
      role    TEXT NOT NULL,
      PRIMARY KEY (shareId, ghii, role)
    );
    CREATE INDEX IF NOT EXISTS idx_secret_share_members_ghii_role ON secret_share_members(ghii, role);

    CREATE TABLE IF NOT EXISTS vault_device_keys (
      ownerGhii  TEXT NOT NULL,
      keyId      TEXT NOT NULL,
      publicKey  TEXT NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      createdAt  TEXT NOT NULL,
      lastUsedAt TEXT,
      PRIMARY KEY (ownerGhii, keyId)
    );
  `);
}
