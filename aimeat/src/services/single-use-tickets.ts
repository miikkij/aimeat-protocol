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
 *   In memory and per process: a ticket is minted and spent within seconds by the same client against
 *   the same node, so it never needs to survive a restart or reach another process.
 * @structure SingleUseTicketStore<T> · createSingleUseTicketStore<T>() · one shared sweep timer
 * @usage
 *   const tickets = createSingleUseTicketStore<{ sub: string }>();
 *   const id = tickets.mint({ sub }, 30_000);   // hand `id` to the client
 *   const data = tickets.take(id);              // null when unknown, expired or already taken
 * @version-history
 *   v1.0.0 — 2026-10-09 — Extracted from routes/sse.ts and made generic, for the WebSocket ticket
 *     (secrets audit 2026-10-09, d3).
 */
import { randomBytes } from 'node:crypto';

export interface SingleUseTicketStore<T> {
  /** Mint a ticket carrying `data` for `ttlMs` milliseconds. Returns the opaque ticket (64 hex). */
  mint(data: T, ttlMs: number): string;
  /**
   * Spend a ticket: returns its data and deletes it, or null when it is unknown or expired. A ticket
   * is deleted on the first presentation whatever the outcome, so it can never be used twice.
   */
  take(ticket: string | null | undefined): T | null;
  /** Live tickets held, expired ones not yet swept included. */
  size(): number;
}

interface Entry { data: unknown; expires: number }

/** Every store, so one timer sweeps them all. */
const stores = new Set<Map<string, Entry>>();
let sweeper: ReturnType<typeof setInterval> | null = null;

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const map of stores) {
      for (const [id, e] of map) if (e.expires < now) map.delete(id);
    }
  }, 60_000);
  // The timer only frees memory; it must not keep a test process or a CLI alive.
  sweeper.unref?.();
}

export function createSingleUseTicketStore<T>(): SingleUseTicketStore<T> {
  const map = new Map<string, Entry>();
  stores.add(map);
  ensureSweeper();
  return {
    mint(data: T, ttlMs: number): string {
      const id = randomBytes(32).toString('hex');
      map.set(id, { data, expires: Date.now() + ttlMs });
      return id;
    },
    take(ticket: string | null | undefined): T | null {
      if (typeof ticket !== 'string' || ticket.length === 0) return null;
      const e = map.get(ticket);
      if (!e) return null;
      map.delete(ticket);
      return e.expires < Date.now() ? null : (e.data as T);
    },
    size(): number { return map.size; },
  };
}
