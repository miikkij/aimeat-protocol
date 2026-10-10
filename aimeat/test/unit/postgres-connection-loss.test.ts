/**
 * @file test/unit/postgres-connection-loss.test.ts
 * @description A database connection that ends under a running query fails THAT QUERY. It does not
 *   end the node process.
 *
 *   WHAT WAS WRONG. The Postgres provider made its pool with no `error` listener on the pool or on
 *   its clients. node-postgres emits `error` on a client whose socket ends, and an EventEmitter
 *   `error` with no listener is thrown as an uncaught exception, which exits the process. So every
 *   way a connection can end while it is in use took the whole node down: the database restarting,
 *   a network reset, or the database dropping a connection over one statement it would not take.
 *   Measured 2026-10-10: an upload of a 700 MB file was that statement, and the node exited with
 *   "Unhandled 'error' event … read ECONNRESET" from pg/lib/client.js.
 *
 *   The test ends a connection the way a database does it on purpose: pg_terminate_backend() on the
 *   backend that is running a query. Before the fix the uncaught exception is caught by the listener
 *   below (and by the test runner, which fails the run); after it there is none, the query has
 *   rejected, and the next query runs on a new connection.
 *
 *   Postgres only: SQLite has no connection to lose. Without DATABASE_URL the case is skipped, the
 *   same way storage-conformance.test.ts skips its Postgres arm.
 * @usage cd aimeat && node --env-file=.env.test.postgres-kysely node_modules/vitest/vitest.mjs run test/unit/postgres-connection-loss.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (postgres-kysely provider v1.10.0).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';

const PG_URL = process.env.DATABASE_URL ?? '';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let storage: (Storage & { rootDb: Kysely<unknown>; close?: () => Promise<void> | void }) | null = null;
const uncaught: unknown[] = [];
const onUncaught = (err: unknown): void => { uncaught.push(err); };

beforeAll(async () => {
    if (!PG_URL) { console.warn('[connection-loss] DATABASE_URL not set — the Postgres case is skipped'); return; }
    storage = await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) as never;
    process.on('uncaughtException', onUncaught);
}, 60_000);

afterAll(async () => {
    process.off('uncaughtException', onUncaught);
    await storage?.close?.();
});

describe('a Postgres connection that ends under a running query', () => {
    it.skipIf(!PG_URL)('fails that query, leaves the process running, and the next query works', async () => {
        const db = storage!.rootDb;
        let outcome = 'never ran';
        try {
            // One pinned connection, so the pid that is read is the backend that then sleeps.
            await db.connection().execute(async (conn) => {
                const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(conn)).rows[0].pid;
                const sleeping = sql`select pg_sleep(20)`.execute(conn).then(() => 'finished', (err: unknown) => 'rejected: ' + String((err as Error)?.message ?? err));
                await wait(400);
                await sql`select pg_terminate_backend(${pid})`.execute(db);
                outcome = await sleeping;
            });
        } catch (err) {
            // Handing a dead connection back to the pool may itself complain; the query's own
            // outcome is what is asserted.
            if (outcome === 'never ran') outcome = 'rejected: ' + String((err as Error)?.message ?? err);
        }
        // Give a stray `error` event the time to arrive before it is counted.
        await wait(800);

        expect(outcome, 'the query on the ended connection must reject, not finish').toMatch(/^rejected: /);
        expect(uncaught.map(String), 'an `error` event nobody listened to reached the process').toEqual([]);
        const again = await sql<{ one: number }>`select 1 as one`.execute(db);
        expect(again.rows[0].one, 'the pool must hand out a working connection afterwards').toBe(1);
    }, 60_000);
});
