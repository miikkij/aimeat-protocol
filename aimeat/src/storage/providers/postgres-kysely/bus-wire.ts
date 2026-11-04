/**
 * @file src/storage/providers/postgres-kysely/bus-wire.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event-bus line between the processes of one node on PostgreSQL: NOTIFY on the
 *   channel `aimeat_bus` to send, and one connection of its own that LISTENs to receive (the
 *   contract is storage/bus-wire.ts). NOTIFY belongs to one database, so nodes on other databases of
 *   the same server never hear each other.
 *
 *   ONE CONNECTION OUTSIDE THE POOL. LISTEN holds a session, so the listening connection is a client
 *   of its own and never a pooled one: a pooled connection goes back to the pool and its next user
 *   would carry the LISTEN. A connection pooler in transaction mode (PgBouncer) cannot carry LISTEN at
 *   all; the listening connection goes to the database directly, as this one does.
 *
 *   A DROPPED CONNECTION. The client ends with the database restarting or the network resetting. The
 *   wire connects again after 1 s, doubling to 30 s, and tells the relay (`reconnected`), because a
 *   message sent while it was down is lost and the relay reads its registries from storage again.
 *   The socket does not hold the process open: a node stops as before, and a test that boots a node
 *   in its own process ends when its work does.
 * @structure BUS_CHANNEL · createPgBusWire(pool, connectionString)
 * @usage const wire = createPgBusWire(pool, url); await wire.listen({ message, reconnected });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import pg from 'pg';
import type { BusWire, BusWireHandlers } from '../../bus-wire.js';
import { UTC_SESSION_OPTIONS } from './utc-timestamps.js';
import { logger } from '../../../utils/logger.js';

/** The NOTIFY channel. An identifier, so it is written into the statements as it is. */
export const BUS_CHANNEL = 'aimeat_bus';

const RECONNECT_FIRST_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Let the process end while this client is open: the listening socket is no work of its own. */
function unrefClient(client: pg.Client): void {
  const stream = (client as unknown as { connection?: { stream?: { unref?: () => void } } }).connection?.stream;
  stream?.unref?.();
}

/** End a listening client that is no longer wanted; a failure to end it is logged and goes no further. */
async function endQuietly(client: pg.Client): Promise<void> {
  await client.end().catch((err: unknown) => { logger.warn('bus: a listening connection did not end cleanly', { error: String(err) }); });
}

export function createPgBusWire(pool: pg.Pool, connectionString: string): BusWire {
  let handlers: BusWireHandlers | null = null;
  let client: pg.Client | null = null;
  let closed = false;
  let retryMs = RECONNECT_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = (): void => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect(true).catch((err: unknown) => {
        logger.warn('bus: the listening connection did not come back; trying again', { error: String(err), retryMs });
        retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
        scheduleReconnect();
      });
    }, retryMs);
    retryTimer.unref?.();
  };

  const connect = async (again: boolean): Promise<void> => {
    const next = new pg.Client({ connectionString, options: UTC_SESSION_OPTIONS });
    // An ended connection must not end the process (index.ts keeps the pool's the same way).
    next.on('error', (err) => {
      logger.warn('bus: the listening connection ended', { error: String(err) });
    });
    next.on('end', () => {
      if (client === next) client = null;
      scheduleReconnect();
    });
    next.on('notification', (msg) => {
      if (msg.channel === BUS_CHANNEL && typeof msg.payload === 'string') handlers?.message(msg.payload);
    });
    await next.connect();
    try {
      await next.query(`LISTEN ${BUS_CHANNEL}`);
    } catch (err) {
      await endQuietly(next);
      throw err;
    }
    if (closed) { await endQuietly(next); return; }
    unrefClient(next);
    client = next;
    retryMs = RECONNECT_FIRST_MS;
    if (again) handlers?.reconnected();
  };

  return {
    async send(payloads) {
      if (payloads.length === 0) return;
      // One statement, so the messages leave together and in this order (a function scan of the array).
      await pool.query(`SELECT pg_notify('${BUS_CHANNEL}', p) FROM unnest($1::text[]) AS p`, [payloads]);
    },
    async listen(h) {
      handlers = h;
      try {
        await connect(false);
      } catch (err) {
        // The first connection failed: keep trying, and the relay hears `reconnected` when one listens.
        scheduleReconnect();
        throw err;
      }
    },
    async close() {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      const c = client;
      client = null;
      if (c) await endQuietly(c);
    },
  };
}
