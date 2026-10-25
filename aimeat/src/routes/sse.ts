/**
 * @file sse.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-Sent Events transport for live UI updates, and the single-use connection
 *   tickets for every connection that cannot send an Authorization header. Exposes
 *   POST /v1/events/ticket (exchange JWT for a single-use connection ticket, optionally for one app),
 *   POST /v1/events/visitor-ticket (the same without an account: the build and one public app),
 *   POST /v1/ws/ticket (the same for one WebSocket endpoint, spent at the upgrade in
 *   auth/ws-upgrade.ts) and GET /v1/events?ticket=... (the event stream). Forwards event-bus
 *   changes to connected clients as a `data:` SSE message, COALESCED to at most
 *   one signal per second per client (the browser ignores the payload and just
 *   debounces a re-fetch, so a per-write firehose was wasted bandwidth).
 * @structure sseRouter(config, storage) -> Router
 * @usage app.use(sseRouter(config, storage)); client: EventSource('/v1/events?ticket=...')
 * @version-history
 *   2026-10-25 -- secaudit2026oct22: the ticket keeps the bearer it was minted with
 *     (auth/stream-credential.ts), and the stream asks again whether the node honours it: before a
 *     change frame when the last answer is over 5 s old, and every 60 s while idle. A revoked
 *     credential gets `event: revoked` and the stream ends, presence included.
 *   2026-10-25 -- The 15 s keepalive is `event: alive` instead of a comment line, so the page sees it:
 *     a tab that holds a browser's shared stream relays it, and a tab that stops hearing it takes the
 *     stream over (public/lib/live-updates.js). Nothing else in the stream changes.
 *   2026-10-21 -- The ticket's audience asks isAnonymousPrincipal, so the minted anonymous token gets no
 *     member-audience events (secaudit 2026-10, anonymous-claim-not-signed).
 *   v1.8.0 -- 2026-10-18 -- A workspace's own domain, `workspace:<organismId>/<ws>`
 *     (services/event-bus.ts emitWorkspaceChange), goes only to the streams of that organism's
 *     members, so an open workspace page re-reads when its workspace changed and not on every memory
 *     write on the node (wish-reaaliaikainen-tapahtuma-kertoo-mink-ty-tilan-tieto-muuttui).
 *   v1.7.0 -- 2026-10-18 -- Every stream opens with `event: hello` carrying the build, so an open SPA
 *     page reloads after a restart on new code without asking /v1/build on a timer. A ticket may
 *     follow one app (`{ app: "owner/filename" }`): the stream then carries that app's `event: app`
 *     (a new version to everyone who may open it, the draft to its builders) and no domain frame.
 *     POST /v1/events/visitor-ticket gives the same to a visitor without an account, within a cap
 *     per node and per address. Jouni's ruling of 2026-10-18: live data is an event, never a poll.
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
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { onChangeEvent, offChangeEvent, onAppChangeEvent, offAppChangeEvent } from '../services/event-bus.js';
import type { ChangeEvent, AppChangeEvent } from '../services/event-bus.js';
import { appStreamTopic, type AppStreamTopic } from '../services/app-news.js';
import { equalAppId } from '../services/app-record-keys.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { BUILD_ID } from './portal-spa.js';
import { resolveIdentity, localAccountName, runAsNode } from '../utils/gaii.js';
import { presence } from '../services/presence.js';
import { allowedDomains, filterDomains, isOwnerPrincipal } from '../auth/sse-domain-scopes.js';
import { isOrganismMember, type AudienceAuth } from '../services/audience.js';
import { streamCredentialOf, streamCredentialRevoked, type StreamCredential } from '../auth/stream-credential.js';
import { logger } from '../utils/logger.js';

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
  /**
   * The one app this stream follows (services/app-news.ts appStreamTopic), decided at mint time
   * like `allow`. A stream opened for an app carries that app's events and the build, nothing else.
   */
  app?: AppStreamTopic;
  /** Opened without an account: counted against the visitor caps, carries no domain at all. */
  visitorIp?: string;
  /**
   * Who opened the stream, as services/audience.ts asks it: a workspace's domain goes only to the
   * streams of that organism's members. Frozen at mint time with the rest, from `req.auth`.
   */
  audience?: AudienceAuth;
  /**
   * The bearer the ticket was minted with, asked again while the stream runs (auth/stream-credential.ts):
   * the stream ends when the node stops honouring it. Absent for a visitor's ticket.
   */
  credential?: StreamCredential;
}

/** A change frame waits for a fresh answer to "is the credential still honoured" when the last is this old. */
const RECHECK_BEFORE_FRAME_MS = 5_000;
/** An idle stream asks the same question this often, so a revoked stream also ends with no change to send. */
const RECHECK_IDLE_MS = 60_000;

const tickets = createSingleUseTicketStore<Ticket>();

/**
 * Streams opened without an account, across the node and from one address. A visitor's stream is
 * cheap (keepalives, the build, one app's versions), and these are the ceiling on how many of them
 * one machine, or everyone together, may hold open at once.
 */
const VISITOR_STREAMS_MAX = 5000;
const VISITOR_STREAMS_PER_IP = 24;
let visitorStreams = 0;
const visitorStreamsByIp = new Map<string, number>();

/** A draft written in many small saves is told at most once a second, like the domain frames. */
const DRAFT_COALESCE_MS = 1000;

/** How long one stream trusts its answer to "is this account a member of that organism". */
const MEMBERSHIP_TTL_MS = 30_000;

export function sseRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Ticket endpoint — exchange JWT for a single-use SSE connection ticket
  // With `{ app: "owner/filename" }` in the body the stream follows that one app instead (its new
  // versions, and its draft when the caller builds it): what an open app page listens to.
  router.post('/v1/events/ticket', requireAuth(), async (req, res) => {
    const owner = isOwnerPrincipal(req.auth!);
    const asked = (req.body as { app?: unknown } | undefined)?.app;
    let app: AppStreamTopic | undefined;
    if (asked !== undefined) {
      const topic = await appStreamTopic(storage, config, req.auth!, asked);
      if (!topic) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No app to follow at that address.'));
        return;
      }
      app = topic;
    }
    const header = req.headers.authorization;
    const credential = await streamCredentialOf(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null);
    const ticket = tickets.mint({
      ...(credential ? { credential } : {}),
      sub: req.auth!.sub,
      presenceGhii: resolveIdentity(req.auth!, config.nodeId),
      allow: owner ? null : allowedDomains(req.auth!.scopes),
      presenceEligible: owner && !app,
      audience: { sub: req.auth!.sub, owner: req.auth!.owner, anonymous: isAnonymousPrincipal(req.auth), federated: req.auth!.federated },
      ...(app ? { app } : {}),
    }, 30_000);
    res.json(success(config.nodeId, { ticket, expires: 30 }));
  });

  // The same ticket for a visitor without an account: a stream that carries the build (an open page
  // reloads after the node restarts on new code) and, with `{ app }`, one app's new versions, when
  // anyone may open that app. Never a domain frame and never a draft.
  router.post('/v1/events/visitor-ticket', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    const asked = (req.body as { app?: unknown } | undefined)?.app;
    let app: AppStreamTopic | undefined;
    if (asked !== undefined) {
      const topic = await appStreamTopic(storage, config, null, asked);
      if (!topic) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No app to follow at that address.'));
        return;
      }
      app = topic;
    }
    const ticket = tickets.mint({
      sub: '',
      presenceGhii: '',
      allow: new Set<string>(),
      presenceEligible: false,
      visitorIp: req.ip || 'unknown',
      ...(app ? { app } : {}),
    }, 30_000);
    res.set('Cache-Control', 'no-store');
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

    const visitorIp = t.visitorIp;
    if (visitorIp !== undefined) {
      const fromIp = visitorStreamsByIp.get(visitorIp) ?? 0;
      if (visitorStreams >= VISITOR_STREAMS_MAX || fromIp >= VISITOR_STREAMS_PER_IP) {
        res.status(503).json(error(config.nodeId, 'TOO_MANY_STREAMS', 'Too many open live streams; the page keeps working without one.'));
        return;
      }
      visitorStreams++;
      visitorStreamsByIp.set(visitorIp, fromIp + 1);
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
    // Which build answers. A node restarted on new code drops every stream; the reconnect reads a
    // different build here, and an open SPA page reloads on it instead of asking /v1/build on a timer.
    res.write(`event: hello\ndata: ${JSON.stringify({ build: BUILD_ID })}\n\n`);
    flush();

    // Keepalive. 15s keeps the connection under the read timeout of common proxies (which is where a
    // silent 30s gap gets a stream killed) at negligible cost. It is a named event, not a comment,
    // because the page has to SEE it: the tab holding a browser's shared stream relays it to the
    // other tabs, and a tab that stops hearing it takes the stream over (public/lib/live-updates.js).
    // An EventSource with no 'alive' listener ignores it.
    const keepalive = setInterval(() => {
      res.write('event: alive\ndata: {}\n\n');
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

    // 4. STILL HONOURED — the credential was verified once, at ticket mint. The stream asks again
    //    before a change frame when its last answer is older than RECHECK_BEFORE_FRAME_MS, and every
    //    RECHECK_IDLE_MS while idle; when the node no longer honours it (signed out, agent or app grant
    //    removed, account deactivated) the stream sends `event: revoked` and ends, and an owner's
    //    presence goes with it (secaudit2026oct22).
    const credential = t.credential;
    let lastChecked = Date.now();
    let ended = false;
    const revoked = async (): Promise<boolean> => {
      if (!credential) return false;
      lastChecked = Date.now();
      return streamCredentialRevoked(storage, credential).catch((err: unknown) => {
        logger.warn('sse: credential check failed, the stream stays open until the next check', { error: String(err) });
        return false;
      });
    };
    const endRevoked = (): void => {
      if (ended) return;
      res.write('event: revoked\ndata: {}\n\n');
      flush();
      cleanup();
      res.end();
    };
    const flushChange = (): void => {
      lastSent = Date.now();
      const domains = [...pending];
      pending.clear();
      if (!domains.length) return; // everything in this window was filtered out
      const send = (): void => {
        if (ended) return;
        res.write(`data: ${JSON.stringify({ domains })}\n\n`);
        flush();
      };
      if (credential && Date.now() - lastChecked >= RECHECK_BEFORE_FRAME_MS) {
        void revoked().then(gone => runAsNode(config.nodeId, () => { if (gone) endRevoked(); else send(); }));
        return;
      }
      send();
    };
    const idleCheck = credential
      ? setInterval(() => { void revoked().then(gone => { if (gone) runAsNode(config.nodeId, endRevoked); }); }, RECHECK_IDLE_MS)
      : null;
    // The bus calls this as whoever emitted the event, which in a process that serves more than one
    // node can be another node. So it runs as THIS node, and matches the owner for the node that
    // opened the stream. A production process serves one node, so nothing there changes.
    const queue = (domain: string): void => {
      pending.add(domain);
      if (trailingTimer) return; // a flush is already scheduled; it covers this event
      const since = Date.now() - lastSent;
      if (since >= COALESCE_MS) {
        flushChange(); // leading edge — first change in a quiet window goes now
      } else {
        trailingTimer = setTimeout(() => { trailingTimer = null; flushChange(); }, COALESCE_MS - since);
      }
    };
    // 3. MEMBERS ONLY — a workspace's domain names the workspace, so it goes to the streams of the
    //    organism's members alone. The answer is kept for a short while per organism: a busy
    //    workspace changes many times a second and the membership does not.
    const membership = new Map<string, { member: boolean; at: number }>();
    const isMember = async (organismId: string): Promise<boolean> => {
      const known = membership.get(organismId);
      if (known && Date.now() - known.at < MEMBERSHIP_TTL_MS) return known.member;
      // An unreadable membership tells this stream nothing about the workspace, and says so in the log.
      const member = await isOrganismMember(storage, organismId, t.audience).catch((err: unknown) => {
        logger.warn('sse: organism membership unread, the workspace event is not sent to this stream', { organismId, error: String(err) });
        return false;
      });
      membership.set(organismId, { member, at: Date.now() });
      return member;
    };
    const handler = (evt: ChangeEvent): void => runAsNode(config.nodeId, () => {
      // Owner-private events for a different owner are not this client's business.
      if (evt.ownerGaii && localAccountName(evt.ownerGaii) !== ownerKey) return;
      // Scope gate: a restricted principal (app grant, agent, eco app) is told only about the
      // domains its granted scopes cover. The payload is just a domain name, but the name plus
      // its timing is metadata the owner never consented to hand this app.
      if (!filterDomains([evt.domain], t.allow).length) return;
      if (evt.organismId) {
        const organismId = evt.organismId;
        void isMember(organismId).then(member => { if (member) runAsNode(config.nodeId, () => queue(evt.domain)); });
        return;
      }
      queue(evt.domain);
    });
    // A stream opened for one app, or by a visitor, carries no domain frame: the page that holds it
    // listens for its app and the build, and the domains are the business of the signed-in shell.
    const domainFrames = !t.app && visitorIp === undefined;
    if (domainFrames) onChangeEvent(handler);

    // The followed app's own events, as a named `app` event so a client listening for domain frames
    // never mistakes one for "everything changed". A new version goes at once; a draft is told only
    // to a builder's stream and at most once a second, since an agent writes a draft in many pieces.
    const topic = t.app;
    let draftTimer: ReturnType<typeof setTimeout> | null = null;
    const sendApp = (body: { kind: 'version' | 'draft'; version?: number }): void => {
      res.write(`event: app\ndata: ${JSON.stringify(body)}\n\n`);
      flush();
    };
    const appHandler = (evt: AppChangeEvent): void => {
      if (!topic || !equalAppId(evt.appId, topic.id)) return;
      if (evt.kind === 'version') { sendApp({ kind: 'version', version: evt.version ?? 0 }); return; }
      if (!topic.builder || draftTimer) return;
      draftTimer = setTimeout(() => { draftTimer = null; sendApp({ kind: 'draft' }); }, DRAFT_COALESCE_MS);
    };
    if (topic) onAppChangeEvent(appHandler);

    // Cleanup on disconnect, or when the stream ends itself on a revoked credential. Once only.
    const cleanup = (): void => {
      if (ended) return;
      ended = true;
      clearInterval(keepalive);
      if (idleCheck) clearInterval(idleCheck);
      if (trailingTimer) clearTimeout(trailingTimer);
      if (draftTimer) clearTimeout(draftTimer);
      if (domainFrames) offChangeEvent(handler);
      if (topic) offAppChangeEvent(appHandler);
      if (t.presenceEligible) presence.markOffline(t.presenceGhii);
      if (visitorIp !== undefined) {
        visitorStreams = Math.max(0, visitorStreams - 1);
        const left = (visitorStreamsByIp.get(visitorIp) ?? 1) - 1;
        if (left > 0) visitorStreamsByIp.set(visitorIp, left); else visitorStreamsByIp.delete(visitorIp);
      }
    };
    req.on('close', cleanup);
  });

  return router;
}
