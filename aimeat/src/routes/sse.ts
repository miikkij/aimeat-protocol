/**
 * @file sse.ts
 * @description Server-Sent Events transport for live UI updates. Exposes
 *   POST /v1/events/ticket (exchange JWT for a single-use connection ticket)
 *   and GET /v1/events?ticket=... (the event stream). Forwards event-bus
 *   changes to connected clients as a `data:` SSE message, COALESCED to at most
 *   one signal per second per client (the browser ignores the payload and just
 *   debounces a re-fetch, so a per-write firehose was wasted bandwidth).
 * @structure sseRouter(config, storage) -> Router
 * @usage app.use(sseRouter(config, storage)); client: EventSource('/v1/events?ticket=...')
 * @version-history
 *   v1.1.0 -- 2026-05-31 -- Flush after each write; SSE is now excluded from the
 *     global compression middleware (which buffered the stream and silently
 *     dropped all live updates).
 *   v1.2.0 -- 2026-06-11 -- Coalesce change events per client (leading-edge
 *     throttle, <=1/s): a busy node fired tens of changes/sec to every open
 *     browser; the client only debounces a re-fetch, so collapse the burst.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { onChangeEvent, offChangeEvent } from '../services/event-bus.js';
import type { ChangeEvent } from '../services/event-bus.js';

interface Ticket {
  sub: string;
  expires: number;
}

const tickets = new Map<string, Ticket>();

// Periodic cleanup of expired tickets (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tickets) {
    if (t.expires < now) tickets.delete(id);
  }
}, 60_000);

export function sseRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // Ticket endpoint — exchange JWT for a single-use SSE connection ticket
  router.post('/v1/events/ticket', requireAuth(), (req, res) => {
    const ticket = randomBytes(32).toString('hex');
    tickets.set(ticket, {
      sub: req.auth!.sub,
      expires: Date.now() + 30_000,
    });
    res.json(success(config.nodeId, { ticket, expires: 30 }));
  });

  // SSE stream — validates ticket, streams change events
  router.get('/v1/events', (req, res) => {
    const ticketId = req.query.ticket as string;
    if (!ticketId) {
      res.status(400).json(error(config.nodeId, 'MISSING_TICKET', 'ticket query parameter required'));
      return;
    }

    const t = tickets.get(ticketId);
    if (!t || t.expires < Date.now()) {
      tickets.delete(ticketId);
      res.status(401).json(error(config.nodeId, 'INVALID_TICKET', 'Ticket is invalid or expired'));
      return;
    }

    // Consume the ticket (single-use)
    tickets.delete(ticketId);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // res.flush() is added by the compression middleware; SSE is excluded from
    // compression (see server.ts), but we still flush defensively so no proxy
    // or residual buffer can hold an event back. Optional-chained for the case
    // where flush is not present.
    const flush = () => { (res as unknown as { flush?: () => void }).flush?.(); };

    // Keepalive comment every 30s
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
      flush();
    }, 30_000);

    // Forward change events to this client — COALESCED. The node fires a change
    // event on virtually every write (~400 emit sites); a busy node (e.g. a
    // many-agent fleet) is tens of changes/sec, and EVERY connected browser got
    // EVERY one. The client ignores the payload and just debounces a re-fetch
    // (public/lib/live-updates.js), so blasting one message per change was pure
    // waste. Throttle to at most one signal per COALESCE_MS per client: the
    // first change in a quiet window goes out immediately (low latency), the
    // rest of the burst collapse into one trailing flush. Same UX, a fraction of
    // the bytes. The payload is a fixed marker since no consumer reads it.
    const COALESCE_MS = 1000;
    let lastSent = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    const sendChange = (): void => {
      lastSent = Date.now();
      res.write('data: {"t":"change"}\n\n');
      flush();
    };
    const handler = (_evt: ChangeEvent): void => {
      if (trailingTimer) return; // a flush is already scheduled; it covers this event
      const since = Date.now() - lastSent;
      if (since >= COALESCE_MS) {
        sendChange(); // leading edge — first change in a quiet window goes now
      } else {
        trailingTimer = setTimeout(() => { trailingTimer = null; sendChange(); }, COALESCE_MS - since);
      }
    };
    onChangeEvent(handler);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      if (trailingTimer) clearTimeout(trailingTimer);
      offChangeEvent(handler);
    });
  });

  return router;
}
