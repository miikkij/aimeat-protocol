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
 *   POSTGRESQL. The same number, held under what the server's connection limit carries: PER_LANE
 *   connections a lane, and RESERVE beside them.
 *
 *   MEASURED on 2026-11-24: one full sweep on 12 lanes against a server that allows 500, the
 *   server's client connections read each second (1 578 samples in 27 minutes). The sweep held 232
 *   at its peak and 199 or fewer in 99 % of the seconds, and no connection was refused. A lane's
 *   node holds 21 (its pool of 20 and its event-bus listener). A suite that starts nodes of its own
 *   adds a database of up to 22 for each, 42 for the two-process suite; at most 7 such databases
 *   were open at once, with 130 connections between them, and one lane with its suite's own nodes
 *   held 65. The k busiest lanes of the same second held 65, 133, 213 and 232 for k = 1, 4, 8 and
 *   12, which is 21 a lane and about 50 on top until the last lanes, where it flattens. So
 *   PER_LANE is 22 (the 21 and the runner's own connection), and RESERVE is 120: the 50, the 65 of
 *   a suite another session runs on the same server while it develops, and the server's own 3.
 *
 *   A server with the default limit of 100 does not carry the 4 lanes the package script names
 *   (their busiest second held 133); the sweep still runs those 4, as it did before, and that is
 *   where suites ran out of connections on 2026-11-23, three times in one sweep. A server set to
 *   384 carries 12, and postgresLaneNote() says so in the run's output.
 * @structure sweepLanes() · postgresLanes() · postgresLaneNote() · postgresMaxConnections()
 * @usage
 *   const lanes = sweepLanes();                      // SQLite
 *   const pg = postgresLanes(lanes, maxConnections); // PostgreSQL, maxConnections from SHOW max_connections
 * @version-history
 *   v1.1.0 — 2026-11-24 — PER_LANE 22 and RESERVE 120, from a 12-lane sweep measured on a server
 *     that allows 500. They were 30 and 40, from 8 lanes on a server that stopped them at 100, and
 *     counted 400 connections for the 12 lanes that hold 232.
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';

/** The connections of one lane: its node's pool of 20, the node's event-bus listener, the runner's own. */
const PER_LANE = 22;
/**
 * Connections beside the lanes: the suites' own nodes at their busiest (50), one suite another
 * session runs on the same server (65), and the server's own reserved ones (3).
 */
const RESERVE = 120;
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
    return `PostgreSQL runs on ${pgLanes} lanes, not the ${lanes} this machine carries: ${limit}, a lane holds ${PER_LANE}, and ${RESERVE} are kept for the suites' own nodes and another session's suite. max_connections = ${needed} on the test server carries ${lanes}.`;
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
