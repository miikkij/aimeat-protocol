/**
 * @file src/services/single-use-tickets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The single-use connection ticket, written once for every connection that cannot carry
 *   an Authorization header: the SSE stream (`GET /v1/events`, an EventSource has no header) and the
 *   WebSocket upgrades (`/v1/realtime/ws`, `/v1/personal/tunnel`, `/v1/connect/tunnel`, a browser
 *   WebSocket has no header either). The caller authenticates an ordinary POST with its bearer, gets
 *   an opaque random ticket, and puts the TICKET in the URL. A URL lands in reverse-proxy access logs,
 *   browser history and Referer headers; a ticket found there is already spent or expired, where a
 *   session token found there is a live credential for its whole lifetime.
 *
 *   Extracted from routes/sse.ts, where the SSE ticket map lived, so the WebSocket ticket is the same
 *   mechanism and not a second one (secrets audit 2026-10-09, d3).
 *
 *   IN THE NODE'S STORAGE since 2026-11-04 (services/ephemeral-claims.ts): a ticket minted through one
 *   process opens the connection on another, which a load balancer in front of two processes does
 *   about half the time. The row names neither the ticket nor the bearer it carries (the id is a hash,
 *   the payload sealed under a key only the ticket opens). `mint` keeps the ticket in this process
 *   only, for a caller that cannot wait (a unit test); every route issues with `issue`.
 * @structure SingleUseTicketStore<T> · createSingleUseTicketStore<T>(kind, codec?)
 * @usage
 *   const tickets = createSingleUseTicketStore<{ sub: string }>('sse-ticket');
 *   const id = await tickets.issue({ sub }, 30_000);   // hand `id` to the client
 *   const data = await tickets.take(id);               // null when unknown, expired or already taken
 * @version-history
 *   v1.1.0 — 2026-11-04 — Kept in the node's storage (oneTimeStore); `issue` for the routes, `take` is
 *     async, `mint` stays for this process only (codebase analysis 2026-11-03, HA stage 2).
 *   v1.0.0 — 2026-10-09 — Extracted from routes/sse.ts and made generic, for the WebSocket ticket
 *     (secrets audit 2026-10-09, d3).
 */
import { randomBytes } from 'node:crypto';
import { oneTimeStore, type ClaimCodec } from './ephemeral-claims.js';

export interface SingleUseTicketStore<T> {
  /** Mint a ticket carrying `data` for `ttlMs` milliseconds, in this process only. Returns the opaque ticket (64 hex). */
  mint(data: T, ttlMs: number): string;
  /** Mint a ticket carrying `data` for `ttlMs` milliseconds, valid on every process of the node. */
  issue(data: T, ttlMs: number): Promise<string>;
  /**
   * Spend a ticket: returns its data and deletes it, or null when it is unknown or expired. A ticket
   * is deleted on the first presentation whatever the outcome, so it can never be used twice.
   */
  take(ticket: string | null | undefined): Promise<T | null>;
}

/** The tickets of one kind. `kind` names them in the node's storage. */
export function createSingleUseTicketStore<T>(kind: string, codec?: ClaimCodec<T>): SingleUseTicketStore<T> {
  const store = oneTimeStore<T>(kind, codec);
  return {
    mint(data: T, ttlMs: number): string {
      const id = randomBytes(32).toString('hex');
      store.here.put(id, data, Date.now() + ttlMs);
      return id;
    },
    async issue(data: T, ttlMs: number): Promise<string> {
      const id = randomBytes(32).toString('hex');
      await store.put(id, data, Date.now() + ttlMs);
      return id;
    },
    async take(ticket: string | null | undefined): Promise<T | null> {
      if (typeof ticket !== 'string' || ticket.length === 0) return null;
      // A ticket minted in this process is found here; every other one in the node's storage.
      const e = store.here.take(ticket) ?? await store.take(ticket);
      if (!e) return null;
      return e.expiresAt < Date.now() ? null : e.data;
    },
  };
}
