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
 *   v1.5.0 -- 2026-07-25 -- Open the stream immediately (`retry:` + `:open` flushed on connect,
 *     keepalive 30s -> 15s): the first byte used to be the 30s keepalive, which is
 *     indistinguishable from a hung connection and gets streams dropped by proxies with a short
 *     read timeout. Plus two authorization fixes: change domains are now SCOPE-GATED for
 *     restricted principals (an app grant no longer learns that the owner's messages/wallet/
 *     tasks changed - auth/sse-domain-scopes.ts), and only a real owner session may flip the
 *     owner's PRESENCE (an app left open no longer pins them "available").
 *   v1.4.0 -- 2026-06-21 -- Typed + owner-scoped events: accumulate a Set of changed domains
 *     per window and send `data: {"domains":[...]}` (client re-fetches only affected views);
 *     filter owner-private events by the connected owner segment (owner-less = global).
 *   v1.3.0 -- 2026-06-19 -- Mark the owner online/offline in the PresenceTracker on stream
 *     open/close (presence feature); ticket carries the resolved presence GHII.
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
import { resolveIdentity, parseGaiiLoose } from '../utils/gaii.js';
import { presence } from '../services/presence.js';
import { allowedDomains, filterDomains, isOwnerPrincipal } from '../auth/sse-domain-scopes.js';

interface Ticket {
  sub: string;
  expires: number;
  /** Resolved presence identity (GHII for owner sessions) — marked online while the stream is open. */
  presenceGhii: string;
  /**
   * Domains this stream may report, or null for an owner session (no filtering). Computed at
   * MINT time from the authenticated principal's scopes: the stream itself carries only the
   * ticket, so the authorization decision has to be frozen here where `req.auth` still exists.
   */
  allow: Set<string> | null;
  /**
   * Whether an open stream may mark the owner "available". Only a real owner session may:
   * otherwise any app the owner opens would hold their presence online for as long as it runs.
   */
  presenceEligible: boolean;
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
    const owner = isOwnerPrincipal(req.auth!);
    tickets.set(ticket, {
      sub: req.auth!.sub,
      expires: Date.now() + 30_000,
      presenceGhii: resolveIdentity(req.auth!, config.nodeId),
      allow: owner ? null : allowedDomains(req.auth!.scopes),
      presenceEligible: owner,
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

    // Presence: an open PORTAL stream means this owner is reachable. An app-grant stream
    // resolves to the same GHII but must NOT speak for the human: otherwise any app they
    // leave open would pin them "available" (see presenceEligible at mint time).
    if (t.presenceEligible) presence.markOnline(t.presenceGhii);

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

    // OPEN IMMEDIATELY. Without this the first byte is the 30s keepalive, so for half a minute
    // the stream is indistinguishable from a hung connection: the client cannot tell it is
    // connected, an intermediary with a short read timeout can drop it before anything arrives,
    // and anyone debugging concludes SSE is broken. A comment line carries no data. `retry`
    // gives the browser an explicit reconnect backoff instead of its 3s default guess.
    res.write('retry: 3000\n\n');
    res.write(':open\n\n');
    flush();

    // Keepalive comment. 15s keeps the connection under the read timeout of common proxies
    // (which is where a silent 30s gap gets a stream killed) at negligible cost.
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
      flush();
    }, 15_000);

    // Forward change events to this client — COALESCED + SCOPED + TYPED. The node fires a
    // change event on virtually every write (~400 emit sites); a busy node (a many-agent
    // fleet) is tens/sec. Two reductions:
    //  1. OWNER SCOPE — an event carrying `ownerGaii` is forwarded ONLY to streams owned by
    //     that owner (compared on the owner SEGMENT, uniform across GHII `owner@node` and
    //     GAII `agent#owner@node`). Owner-less events stay global (shared data: organisms,
    //     boards, public activity, …). So owner B's agent churn no longer wakes owner A.
    //  2. TYPED COALESCE — accumulate the SET of changed domains during the window and flush
    //     `data: {"domains":[...]}`, so the client re-fetches only the affected views instead
    //     of everything. Leading-edge: the first change in a quiet window goes immediately.
    const ownerKey = parseGaiiLoose(t.presenceGhii).owner;
    const COALESCE_MS = 1000;
    let lastSent = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flushChange = (): void => {
      lastSent = Date.now();
      const domains = [...pending];
      pending.clear();
      if (!domains.length) return; // everything in this window was filtered out
      res.write(`data: ${JSON.stringify({ domains })}\n\n`);
      flush();
    };
    const handler = (evt: ChangeEvent): void => {
      // Owner-private events for a different owner are not this client's business.
      if (evt.ownerGaii && parseGaiiLoose(evt.ownerGaii).owner !== ownerKey) return;
      // Scope gate: a restricted principal (app grant, agent, eco app) is told only about the
      // domains its granted scopes cover. The payload is just a domain name, but the name plus
      // its timing is metadata the owner never consented to hand this app.
      if (!filterDomains([evt.domain], t.allow).length) return;
      pending.add(evt.domain);
      if (trailingTimer) return; // a flush is already scheduled; it covers this event
      const since = Date.now() - lastSent;
      if (since >= COALESCE_MS) {
        flushChange(); // leading edge — first change in a quiet window goes now
      } else {
        trailingTimer = setTimeout(() => { trailingTimer = null; flushChange(); }, COALESCE_MS - since);
      }
    };
    onChangeEvent(handler);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      if (trailingTimer) clearTimeout(trailingTimer);
      offChangeEvent(handler);
      if (t.presenceEligible) presence.markOffline(t.presenceGhii);
    });
  });

  return router;
}
