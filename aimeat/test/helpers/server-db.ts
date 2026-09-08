/**
 * @file server-db.ts
 * @description Where the node under test actually keeps its data, for the four suites that open it
 *   behind the server's back to prove something about the bytes at rest.
 *
 *   THE TRAP THIS CLOSES. A suite that reads `AIMEAT_DB_PATH` reads the value from the env file,
 *   which names ONE database for the whole run. The runner does not use one: with `--workers=N`
 *   every lane above zero gets a database of its own (`laneTarget` in run-e2e-server.ts appends
 *   `.w<lane>`), and the server is pinned to it through `AIMEAT_SQLITE_PATH`. So a suite reading
 *   `AIMEAT_DB_PATH` opens lane zero's file, finds none of the rows the server just wrote, and
 *   fails an assertion about encryption or about a role — a failure that says nothing about the
 *   feature and everything about which file was opened.
 *
 *   It reads as flakiness because it depends on where the suite lands: green alone and in lane 0,
 *   red in lanes 1 to 3. e2e-extension-secrets was red on the nightly sweep on three consecutive
 *   nights (2026-09-06, -07 and -08) and green in every local run, for exactly this reason.
 *
 *   The order is server-first: `AIMEAT_SQLITE_PATH` is what the RUNNER pinned on the server it
 *   booted, `AIMEAT_DB_PATH` is what a person typed in an env file, and the fallback is the shared
 *   default for a suite run by hand with neither.
 * @structure
 *   - serverSqlitePath() — absolute path to the SQLite file the server under test is writing
 *   - pinnedSqlitePath() — the same, but '' when nothing named a file, for a caller that would
 *     rather skip its check than open a database nobody pinned
 *   - serverDbUrl() — the Postgres URL that server is writing, or '' when it is not on Postgres
 * @usage
 *   import { serverSqlitePath } from './helpers/server-db.js';
 *   const db = new Database(serverSqlitePath(), { readonly: true });
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. The expression already lived correct in e2e-outbound.ts and
 *     wrong in three other suites; one answer, in one place, because the wrong one is invisible
 *     until a four-lane run makes it fail.
 */
import { resolve } from 'node:path';

/** The SQLite file the server under test is writing, absolute. */
export function serverSqlitePath(): string {
    const named = process.env.AIMEAT_SQLITE_PATH || process.env.AIMEAT_DB_PATH || 'test/.test-e2e.db';
    return resolve(process.cwd(), named);
}

/**
 * The same file, or '' when neither variable named one.
 *
 * For the callers whose check is optional: with nothing pinned, the server is on config.ts's own
 * default (the developer's `./data/aimeat.db`), and opening the shared test file instead would
 * assert against an empty database rather than skip.
 */
export function pinnedSqlitePath(): string {
    const named = process.env.AIMEAT_SQLITE_PATH || process.env.AIMEAT_DB_PATH || '';
    return named ? resolve(process.cwd(), named) : '';
}

/** The Postgres database the server under test is writing, or '' when it is on another backend. */
export function serverDbUrl(): string {
    return process.env.DATABASE_URL || process.env.AIMEAT_DB_URL || '';
}
