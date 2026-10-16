/**
 * @file scripts/test-unit-postgres.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runs every unit file that has a PostgreSQL half (scripts/lib/postgres-unit-files.ts)
 *   against DATABASE_URL, with AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true so a missing URL fails the
 *   run instead of turning it into a SQLite-only pass. CI runs it in the job that has the Postgres
 *   service; `pnpm gate` runs it whenever its Postgres legs run (QA audit P4-02, F7c-02, F24-01).
 *
 *   One file at a time: the files share one database, and several of them create the same owner
 *   names with a run tag; serial is what keeps a cleanup in one from meeting a write in another.
 * @usage
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx scripts/test-unit-postgres.ts
 *   cd aimeat && DATABASE_URL=postgresql://… pnpm test:unit:postgres
 * @version-history
 *   2026-10-16 — Initial (QA audit P4-02, F7c-02, F24-01).
 */
import { spawnSync } from 'node:child_process';
import { postgresUnitFiles } from './lib/postgres-unit-files.js';

if (!process.env.DATABASE_URL) {
    console.error('✖ test-unit-postgres: DATABASE_URL is not set, so there is no PostgreSQL to test against. Run it with --env-file=.env.test.postgres-kysely, or set DATABASE_URL to the Postgres test database.');
    process.exit(1);
}

const files = postgresUnitFiles(process.cwd());
console.log(`test-unit-postgres: ${files.length} unit file(s) with a PostgreSQL half`);
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--no-file-parallelism', ...files], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, AIMEAT_CONFORMANCE_REQUIRE_POSTGRES: 'true' },
});
process.exit(r.status ?? 1);
