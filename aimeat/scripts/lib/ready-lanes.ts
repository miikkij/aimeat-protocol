/**
 * @file scripts/lib/ready-lanes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many nodes pnpm ready's E2E sweep runs at once (the runner's `--workers`), per
 *   backend, on the machine it runs on.
 *
 *   WHY. Until 2026-11-23 the sweep ran on the 4 lanes the package script names, on every machine,
 *   one backend after the other. On GitHub the same sweep runs on 16 lanes per backend (4 shards of
 *   4), both backends at once. On a workstation with 32 logical cores the 4 lanes left the machine
 *   at a fifth of its processor while the run took about two hours. pnpm ready holds the machine for
 *   one run at a time (the `ready` lock, scripts/ready.ts), so the sweep takes what one run can use.
 *
 *   SQLITE. One lane per 2.6 logical cores, from 4 to 12: 12 on 32 cores, 5 on 14, 4 on 8. A lane is
 *   a node (0.5 to 1 GB) and a suite process; the divisor leaves room for the suites that start
 *   nodes of their own.
 *
 *   POSTGRESQL. The same number, held under what the server's connection limit carries. Measured on
 *   2026-11-23 with 8 lanes on a server that allows 100: the server was at 100 of 100 within 15 s,
 *   while the lanes' nodes started, and one lane's database held 29 connections (the node's pool of
 *   20, its event-bus listener, and the runner's own). So a lane is counted as PER_LANE connections
 *   and RESERVE are kept for the suites that start nodes of their own. A server with the default limit
 *   of 100 carries fewer than the 4 lanes the package script names; the sweep still runs those 4, as
 *   it did before, and that is where a suite now and then runs out of connections. A server set to
 *   400 carries 12, and postgresLaneNote() says so in the run's output.
 * @structure sweepLanes() · postgresLanes() · postgresLaneNote() · postgresMaxConnections()
 * @usage
 *   const lanes = sweepLanes();                      // SQLite
 *   const pg = postgresLanes(lanes, maxConnections); // PostgreSQL, maxConnections from SHOW max_connections
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';

/** The connections one lane holds at its peak, measured (29): the node's pool, its bus listener, the runner. */
const PER_LANE = 30;
/** Connections kept for the suites that start nodes of their own. */
const RESERVE = 40;
/** The lanes the package scripts name, and the fewest a sweep runs on. */
const FLOOR = 4;
const CEILING = 12;

/**
 * The lanes of the SQLite sweep. `set` (pnpm ready's `--workers=N`, 1 to 16) names the number by
 * hand, for a machine that is doing something else as well.
 */
export function sweepLanes(cores: number = cpus().length, set?: string): number {
    const asked = Number(set);
    if (set && Number.isInteger(asked) && asked >= 1 && asked <= 16) return asked;
    return Math.max(FLOOR, Math.min(CEILING, Math.floor(cores / 2.6)));
}

/**
 * The lanes of the PostgreSQL sweep: `lanes`, or fewer when the server's connection limit does not
 * carry that many pools. Never under the package script's 4, and 4 when the limit is not known.
 */
export function postgresLanes(lanes: number, maxConnections: number | null): number {
    if (lanes <= FLOOR) return lanes;
    if (maxConnections === null || !Number.isFinite(maxConnections)) return FLOOR;
    return Math.max(FLOOR, Math.min(lanes, Math.floor((maxConnections - RESERVE) / PER_LANE)));
}

/**
 * The line a run prints when the server's connection limit, not the machine, decides the PostgreSQL
 * lanes: what the limit is and which value carries the machine's lanes. Null when nothing is held back.
 */
export function postgresLaneNote(lanes: number, pgLanes: number, maxConnections: number | null): string | null {
    if (pgLanes >= lanes) return null;
    const needed = lanes * PER_LANE + RESERVE;
    const limit = maxConnections === null ? 'its connection limit could not be read' : `the server allows ${maxConnections} connections`;
    return `PostgreSQL runs on ${pgLanes} lanes, not the ${lanes} this machine carries: ${limit}, and a lane holds up to ${PER_LANE}. max_connections = ${needed} on the test server carries ${lanes}.`;
}

/**
 * The connection limit of the PostgreSQL server the E2E env file names (`SHOW max_connections`), or
 * null when the file, the address or the server is not there: the sweep then runs its 4 lanes.
 */
export async function postgresMaxConnections(envFile = '.env.test.postgres-kysely'): Promise<number | null> {
    if (!existsSync(envFile)) return null;
    const url = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(envFile, 'utf-8'))?.[1];
    if (!url) return null;
    try {
        const { default: pg } = await import('pg');
        const address = new URL(url);
        address.search = ''; // `?schema=public` is the node's own parameter, not the driver's
        const client = new pg.Client({ connectionString: address.href, connectionTimeoutMillis: 5000 });
        await client.connect();
        try {
            const limit = Number((await client.query('SHOW max_connections')).rows[0]?.max_connections);
            return Number.isFinite(limit) ? limit : null;
        } finally {
            await client.end();
        }
    } catch {
        return null; // no server or no access: the caller runs the lanes the package script names
    }
}
