/**
 * @file src/storage/bus-wire.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contract of the line that carries event-bus messages between the processes of one
 *   node on one database (Storage.busWire). PostgreSQL gives one over LISTEN/NOTIFY
 *   (providers/postgres-kysely/bus-wire.ts); a provider with one process per database (SQLite) gives
 *   none, and the bus stays in its process. The wire moves text and knows nothing of events: the relay
 *   (services/bus-relay.ts) writes and reads the messages.
 * @structure BUS_WIRE_PAYLOAD_BYTES · BusWireHandlers · BusWire
 * @usage const wire = storage.busWire?.(); if (wire) await wire.listen({ message, reconnected });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */

/**
 * The largest message the wire takes, in UTF-8 bytes. PostgreSQL refuses a NOTIFY payload of 8000
 * bytes or more; the rest is room. The relay cuts a longer message into parts of this size.
 */
export const BUS_WIRE_PAYLOAD_BYTES = 7_500;

export interface BusWireHandlers {
  /** One message, as another process (or this one) sent it. */
  message(payload: string): void;
  /**
   * The line was down and is up again. Messages sent while it was down are lost, so the listener
   * reads again whatever it keeps from storage. Not called for the first connection.
   */
  reconnected(): void;
}

export interface BusWire {
  /** Send these messages, in this order, in one statement. Rejects when the database refuses. */
  send(payloads: readonly string[]): Promise<void>;
  /** Start listening; resolves when the first connection listens. Reconnects by itself after a drop. */
  listen(handlers: BusWireHandlers): Promise<void>;
  /** Stop listening and reconnecting. */
  close(): Promise<void>;
}
