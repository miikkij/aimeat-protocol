/**
 * @file sse.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-Sent Events transport for live UI updates, and the single-use connection
 *   tickets for every connection that cannot send an Authorization header. Exposes
 *   POST /v1/events/ticket (exchange JWT for a single-use connection ticket),
 *   POST /v1/ws/ticket (the same for one WebSocket endpoint, spent at the upgrade in
 *   auth/ws-upgrade.ts) and GET /v1/events?ticket=... (the event stream). Forwards event-bus
 *   changes to connected clients as a `data:` SSE message, COALESCED to at most
 *   one signal per second per client (the browser ignores the payload and just
 *   debounces a re-fetch, so a per-write firehose was wasted bandwidth).
 * @structure sseRouter(config, storage) -> Router
 * @usage app.use(sseRouter(config, storage)); client: EventSource('/v1/events?ticket=...')
 * @version-history
 *   v1.6.0 -- 2026-10-09 -- POST /v1/ws/ticket: a 60-second single-use ticket for one WebSocket
 *     endpoint (realtime, personal-tunnel, connect-tunnel), so a client stops putting its session
 *     token in the upgrade URL (secrets audit 2026-10-09, d3). The SSE ticket map moved to
 *     services/single-use-tickets.ts, which both tickets now use; the SSE behaviour is unchanged.
 *   v1.5.2 -- 2026-09-26 -- The change listener runs as this node (runAsNode, utils/gaii.ts). A
 *     listener runs as whoever emitted the event, and in a process that serves more than one node
 *     that can be another node; now the stream matches the owner for the node that opened it. One
 *     node per process in production, so nothing there changes.
 *   v1.5.1 -- 2026-09-26 -- The owner segment an event is matched on comes from localAccountName
 *     (utils/gaii.ts), which keeps an identity of another node whole, so a visitor's stream never
 *     hears the local namesake's events (secaudit 2026-09, F-1).
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyJWT } from '../auth/jwt.js';
import { isSocketKind, mintSocketTicket, SOCKET_KINDS, SOCKET_TICKET_TTL_SECONDS } from '../auth/ws-upgrade.js';
import { createSingleUseTicketStore } from '../services/single-use-tickets.js';
import { success, error } from '../middleware/envelope.js';
import { onChangeEvent, offChangeEvent } from '../services/event-bus.js';
import type { ChangeEvent } from '../services/event-bus.js';
import { resolveIdentity, localAccountName, runAsNode } from '../utils/gaii.js';
import { presence } from '../services/presence.js';
import { allowedDomains, filterDomains, isOwnerPrincipal } from '../auth/sse-domain-scopes.js';

interface Ticket {
  sub: string;
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

const tickets = createSingleUseTicketStore<Ticket>();

export function sseRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // Ticket endpoint — exchange JWT for a single-use SSE connection ticket
  router.post('/v1/events/ticket', requireAuth(), (req, res) => {
    const owner = isOwnerPrincipal(req.auth!);
    const ticket = tickets.mint({
      sub: req.auth!.sub,
      presenceGhii: resolveIdentity(req.auth!, config.nodeId),
      allow: owner ? null : allowedDomains(req.auth!.scopes),
      presenceEligible: owner,
    }, 30_000);
    res.json(success(config.nodeId, { ticket, expires: 30 }));
  });

  // The same exchange for a WebSocket: a browser WebSocket cannot send an Authorization header, and
  // the session token in the upgrade URL ended up in reverse-proxy access logs (secrets audit
  // 2026-10-09, d3). The ticket names one socket kind; the upgrade (auth/ws-upgrade.ts) re-verifies
  // the token it was minted with and applies that endpoint's own rules, so it opens exactly what the
  // token would have opened. Minted from a session JWT only: the upgrade has never taken an access
  // token (aimeat_pat_…), and a ticket must not widen what opens a socket.
  router.post('/v1/ws/ticket', requireAuth(), async (req, res) => {
    const socket = (req.body as { socket?: unknown } | undefined)?.socket;
    if (!isSocketKind(socket)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `socket must be one of: ${SOCKET_KINDS.join(', ')}`));
      return;
    }
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const verified = token ? await verifyJWT(token) : null;
    if (!verified || verified.sub !== req.auth!.sub) {
      res.status(401).json(error(config.nodeId, 'JWT_REQUIRED', 'Ask for this ticket while signed in, with your sign-in token in the Authorization header. An access token cannot open a live connection.'));
      return;
    }
    const ticket = mintSocketTicket(socket, token, verified.sub);
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { ticket, socket, expires: SOCKET_TICKET_TTL_SECONDS }));
  });

  // SSE stream — validates ticket, streams change events
  router.get('/v1/events', (req, res) => {
    const ticketId = req.query.ticket as string;
    if (!ticketId) {
      res.status(400).json(error(config.nodeId, 'MISSING_TICKET', 'ticket query parameter required'));
      return;
    }

    // Consumed on this read (single-use), whether or not it is still valid.
    const t = tickets.take(ticketId);
    if (!t) {
      res.status(401).json(error(config.nodeId, 'INVALID_TICKET', 'Ticket is invalid or expired'));
      return;
    }

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
    const ownerKey = localAccountName(t.presenceGhii);
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
    // The bus calls this as whoever emitted the event, which in a process that serves more than one
    // node can be another node. So it runs as THIS node, and matches the owner for the node that
    // opened the stream. A production process serves one node, so nothing there changes.
    const handler = (evt: ChangeEvent): void => runAsNode(config.nodeId, () => {
      // Owner-private events for a different owner are not this client's business.
      if (evt.ownerGaii && localAccountName(evt.ownerGaii) !== ownerKey) return;
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
    });
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
