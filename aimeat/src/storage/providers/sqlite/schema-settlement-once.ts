/**
 * @file src/storage/providers/sqlite/schema-settlement-once.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One federation settlement is recorded once: a unique index on the federation_settlement
 *   rows of wallet_transactions, keyed on the identity the row is filed under and the tracking code.
 *   Mirrors Postgres migration 0122_settlement_once.sql, where the reason is written in full
 *   (secaudit2026oct26 round 8c, federation-01).
 *
 *   Rows that already repeat a key are left as they are and kept out of the index by id, every one but
 *   the oldest of each key, so a new copy is still refused. It runs on every open and does nothing once
 *   the index exists. schema.ts calls it after the once-only identity move, which rewrites the names
 *   ledger rows are filed under.
 * @structure SETTLEMENT_ONCE_INDEX · settleOncePerTrackingCode(db)
 * @usage settleOncePerTrackingCode(db);   // schema.ts, after moveActionsAndWorkToFullIdentity
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, federation-01).
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

export const SETTLEMENT_ONCE_INDEX = 'ux_wallet_transactions_settlement_once';

/** A string literal for SQLite: single quotes doubled. */
const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Create the unique index unless it exists, keeping rows that already repeat a key out of it. */
export function settleOncePerTrackingCode(db: Database.Database): void {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(SETTLEMENT_ONCE_INDEX);
  if (exists) return;
  const repeated = (db.prepare(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY gaii, trackingCode ORDER BY timestamp, id) AS n
        FROM wallet_transactions
       WHERE type = 'federation_settlement' AND trackingCode IS NOT NULL
    ) WHERE n > 1`).all() as Array<{ id: string }>).map(r => r.id);
  if (repeated.length) {
    logger.warn('Federation settlement rows that repeat a tracking code are kept out of the new unique index', { ids: repeated });
  }
  const outside = repeated.length ? ` AND id NOT IN (${repeated.map(literal).join(', ')})` : '';
  db.exec(`CREATE UNIQUE INDEX ${SETTLEMENT_ONCE_INDEX} ON wallet_transactions(gaii, trackingCode) WHERE type = 'federation_settlement'${outside}`);
}
