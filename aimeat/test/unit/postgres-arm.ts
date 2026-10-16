/**
 * @file test/unit/postgres-arm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule every unit file with a PostgreSQL half follows: when the run asks for
 *   PostgreSQL (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true) and no DATABASE_URL is set, the file
 *   fails instead of quietly testing SQLite alone.
 *
 *   WHY. Sixteen unit files add the postgres-kysely provider only when DATABASE_URL is set, and
 *   thirteen of them drop it from a list without a skipped test, so a run without the URL looked
 *   complete. CI and `pnpm gate` now run all of them with the URL and this flag
 *   (scripts/test-unit-postgres.ts); a file that ignored the flag would turn a lost URL back into
 *   a green SQLite-only run (QA audit P4-02, F7c-02, F24-01).
 *
 *   scripts/lib/postgres-unit-files.ts lists the files and test/unit/postgres-unit-files.test.ts
 *   refuses one that reads DATABASE_URL and neither calls this nor reads the flag itself.
 * @usage
 *   import { requirePostgresWhenAsked } from './postgres-arm.js';
 *   requirePostgresWhenAsked('memory-read-contract');
 * @version-history
 *   2026-10-16 — Initial (QA audit P4-02, F7c-02, F24-01).
 */

/** Throw when the run asked for PostgreSQL and has no URL for it. `file` names the caller in the message. */
export function requirePostgresWhenAsked(file: string): void {
    if (process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true' && !process.env.DATABASE_URL) {
        throw new Error(`${file}: this run asks for PostgreSQL (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true) and DATABASE_URL is not set, so only SQLite would be tested. Set DATABASE_URL to the Postgres test database, or run without the flag for a SQLite-only look.`);
    }
}
