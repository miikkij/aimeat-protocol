/**
 * @file src/storage/providers/sqlite/schema-value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0135_value_signals.sql: the state of each live
 *   AI-made record and the daily counts of what happened to them (types/value.ts). Called at the end of
 *   applySchemaTables4; idempotent on every boot.
 * @structure applyValueSchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type Database from 'better-sqlite3';

export function applyValueSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS value_keys (
      ownerGaii       TEXT NOT NULL,
      key             TEXT NOT NULL,
      producer        TEXT NOT NULL,
      producerLevel   TEXT,
      producedAt      TEXT NOT NULL,
      revisions       INTEGER NOT NULL DEFAULT 0,
      corrections     INTEGER NOT NULL DEFAULT 0,
      correctionBytes INTEGER NOT NULL DEFAULT 0,
      lastCorrectedAt TEXT,
      readsByOthers   INTEGER NOT NULL DEFAULT 0,
      lastReadAt      TEXT,
      lastBytes       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ownerGaii, key)
    );
    CREATE INDEX IF NOT EXISTS idx_value_keys_producer ON value_keys(producer);

    CREATE TABLE IF NOT EXISTS value_daily (
      day       TEXT NOT NULL,
      grain     TEXT NOT NULL DEFAULT 'day',
      ownerGhii TEXT NOT NULL,
      orgId     TEXT NOT NULL DEFAULT '',
      wsId      TEXT NOT NULL DEFAULT '',
      producer  TEXT NOT NULL,
      family    TEXT NOT NULL,
      signal    TEXT NOT NULL,
      count     INTEGER NOT NULL DEFAULT 0,
      bytes     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, grain, ownerGhii, orgId, wsId, producer, family, signal)
    );
    CREATE INDEX IF NOT EXISTS idx_value_daily_owner ON value_daily(ownerGhii, day);
    CREATE INDEX IF NOT EXISTS idx_value_daily_org ON value_daily(orgId, day);
    CREATE INDEX IF NOT EXISTS idx_value_daily_producer ON value_daily(producer);
    CREATE INDEX IF NOT EXISTS idx_value_daily_day ON value_daily(day);
  `);
}
