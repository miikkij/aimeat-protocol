/**
 * @file src/storage/providers/sqlite/schema-ephemeral-claim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite twin of PostgreSQL migration 0126_ephemeral_claim.sql: short-lived values
 *   (one-time codes and tickets, spent signatures and nonces, window counters) in one table, so the
 *   same service (src/services/ephemeral-claims.ts) runs on either backend. Called at the end of
 *   applySchemaTables4; idempotent on every boot.
 * @structure applyEphemeralClaimSchema(db)
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability stage 2).
 */
import type Database from 'better-sqlite3';

export function applyEphemeralClaimSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ephemeral_claim (
      kind      TEXT NOT NULL,
      id        TEXT NOT NULL,
      payload   TEXT NOT NULL DEFAULT '',
      count     INTEGER NOT NULL DEFAULT 0,
      -- Epoch milliseconds, from the writing process's clock.
      expiresAt INTEGER NOT NULL,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS idx_ephemeral_claim_expires ON ephemeral_claim(expiresAt);
  `);
}
