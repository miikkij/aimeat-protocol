/**
 * @file src/storage/providers/postgres-kysely/server-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PostgreSQL versions this node supports, and the check the provider runs once at
 *   start. CI and docker-compose run PostgreSQL 16, development machines run 17, and no document
 *   named either until 2026-10-16, so nobody could say which versions a node is tested on. Below the
 *   lower bound the node logs a warning and starts: a refusal would stop a node whose server works
 *   today over a version nobody has shown to fail.
 * @structure MIN_POSTGRES_MAJOR · TESTED_POSTGRES_MAJORS · postgresMajorOf(num) · checkServerVersion(pool)
 * @usage await checkServerVersion(pool) before the migrations (index.ts)
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-12).
 */
import type pg from 'pg';
import { logger } from '../../../utils/logger.js';

/** The oldest PostgreSQL major version the node supports: the one CI runs. */
export const MIN_POSTGRES_MAJOR = 16;
/** The major versions the node is tested on: CI and docker-compose (16), development machines (17). */
export const TESTED_POSTGRES_MAJORS: readonly number[] = [16, 17];

/** The major version from `server_version_num` (160004 → 16, 90624 → 9). */
export function postgresMajorOf(num: number): number {
  return Math.floor(num / 10000);
}

/** Reads the server's version once; warns below MIN_POSTGRES_MAJOR. Returns the major version, or null when unread. */
export async function checkServerVersion(pool: pg.Pool): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ server_version_num: string }>('SHOW server_version_num');
    const major = postgresMajorOf(Number(rows[0]?.server_version_num));
    if (!Number.isFinite(major)) return null;
    if (major < MIN_POSTGRES_MAJOR) {
      logger.warn(`PostgreSQL ${major} is older than the oldest version this node supports (${MIN_POSTGRES_MAJOR}). It is tested on ${TESTED_POSTGRES_MAJORS.join(' and ')}. Upgrade the server; the node starts anyway.`, { major });
    }
    return major;
  } catch (err) {
    logger.warn('postgres: could not read the server version; the start goes on', { error: String(err) });
    return null;
  }
}
