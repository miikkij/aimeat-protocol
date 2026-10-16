/**
 * @file src/storage/providers/postgres-kysely/pool-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The time limits on the PostgreSQL pool, and the log line written when a request
 *   waited the whole limit for a pooled connection (QA audit E6-07). Before these the pool had a
 *   connection string and a size and nothing else, so a database that stopped answering made every
 *   request wait without end and wrote nothing to the log.
 * @structure
 *   - PoolLimits: the four limits
 *   - POOL_LIMITS: the values the node runs with
 *   - logPoolWaitTimeouts(pool, waitMs): one warn line (at most one per 30 s) with the pool counts
 *     when a caller's wait for a connection timed out
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E6-07).
 */
import type pg from 'pg';
import { logger } from '../../../utils/logger.js';

export interface PoolLimits {
  /** Pool size. 20 in the node; a test sets 1 to show what a caller does when every connection is busy. */
  maxConnections: number;
  /** How long a caller waits for a pooled connection before its query rejects. */
  connectionWaitMs: number;
  /** Server-side statement_timeout for every connection of the pool. */
  statementMs: number;
  /** Server-side lock_timeout: how long one statement waits for a row or table lock. */
  lockMs: number;
  /** Server-side idle_in_transaction_session_timeout: a transaction left open while idle ends. */
  idleInTransactionMs: number;
}

/**
 * Generous on purpose. They end a stall, not a heavy export: the slowest statement the node runs on
 * purpose (a whole-namespace listing on a large account) takes seconds, and the migration runner
 * lifts the statement and lock limits for its own transaction (migrate.ts).
 */
export const POOL_LIMITS: PoolLimits = {
  maxConnections: 20,
  connectionWaitMs: 15_000,
  statementMs: 120_000,
  lockMs: 60_000,
  idleInTransactionMs: 300_000,
};

const WAIT_TIMEOUT_TEXT = 'timeout exceeded when trying to connect';
const LOG_EVERY_MS = 30_000;

/**
 * Wrap `pool.connect()` so a wait that hit the limit is written to the log with the pool's counts.
 * The caller still gets the rejection and answers for it; this line is what tells the operator the
 * pool, not one request, was the problem. The callback form (used by pool.query internally) is
 * left as it is: Kysely's dialect calls the promise form for every query.
 */
export function logPoolWaitTimeouts(pool: pg.Pool, waitMs: number): void {
  const original = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  let lastLogged = 0;
  (pool as unknown as { connect: (...args: unknown[]) => unknown }).connect = (...args: unknown[]) => {
    if (args.length > 0) return original(...args);
    return (original() as Promise<pg.PoolClient>).catch((err: unknown) => {
      if (err instanceof Error && err.message.includes(WAIT_TIMEOUT_TEXT)) {
        const now = Date.now();
        if (now - lastLogged >= LOG_EVERY_MS) {
          lastLogged = now;
          logger.warn('postgres: a request waited the whole limit for a pooled connection; the database is stalled or every connection is busy', {
            wait_ms: waitMs, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
          });
        }
      }
      throw err;
    });
  };
}
