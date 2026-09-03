/**
 * @file connect-tunnel.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ConnectTunnelManager — server side of the Connector Forward
 *   Tunnel. Holds one persistent WebSocket per connected PRINCIPAL — an agent
 *   (a GAII, `agent#owner@node`) OR an ecosystem app (a GEAI, `eco:app#owner@node`).
 *   GAII and GEAI are DISTINCT identity kinds; this manager is principal-agnostic
 *   and never conflates them — the map key + every log field is `principal`, which
 *   holds the full GAII or GEAI verbatim (whatever the upgrade JWT's `sub` is).
 *   Multiplexes id-correlated forward API calls (principal→server) plus realtime
 *   reverse delivery + capability `invoke` (server→principal). Forward `request`
 *   frames are dispatched through the REAL Express stack via a loopback self-`fetch`
 *   that reuses the principal's WS-upgrade JWT as the bearer, so `requireAuth`/
 *   `requireScope` and the AIMEAT envelope apply by construction (Phase 0: Option B).
 *   Keyed by principal, executes requests server-side, decoupled from the
 *   personal-node anchor/slot/mailbox model.
 * @structure
 *   - ConnectFrame (wire type) — welcome|heartbeat|heartbeat_ack|request|
 *     response|deliver|ack|backlog|disconnect|error
 *   - ConnectTunnelManager — handleConnection(), forward dispatch, heartbeat
 *     monitor, getStats(); Phase 2: deliverTo()/backlog/ack fan-out.
 * @usage
 *   const mgr = new ConnectTunnelManager(config, storage);
 *   mgr.startHeartbeatMonitor();
 *   mgr.handleConnection(ws, verifiedToken, rawToken);
 * @version-history
 *   v2.0.0 -- 2026-09-03 -- ONE SOCKET, MANY IDENTITIES. A connector held one socket per agent:
 *     38 TCP connections to one node from one machine, growing with the number of AGENTS rather
 *     than of nodes. `connections` is still keyed by principal, so every lookup here is unchanged;
 *     what is new is that several entries may share one `ws`. An `attach` frame proves one more
 *     identity's OWN credential on an open socket, verified exactly as the upgrade verifies its
 *     own, and a frame naming an identity the socket has not proved is refused. The fence: a
 *     revoked credential detaches THAT identity and the socket stays up for the others. Fairness
 *     is a per-identity in-flight cap and response-size cap, because a private socket per agent
 *     was isolation and a shared one is not. Same change removes the daemon restart a new agent
 *     used to need. -> connect-tunnel-multiplex.ts, and wish-tunnel-one-socket-many-agents.
 *   v1.14.0 -- 2026-09-02 -- closeForGaii(): the node stopped honouring ONE principal's
 *     credential, so its socket goes. Deleting an agent revoked its sessions and told the tunnel
 *     nothing, leaving a live socket that read `online` for a dead credential until some call
 *     forced a 401. onTokenRevoked matches the raw token an owner never sees, and closeForOwner
 *     would drop every other agent on the same daemon; this is the same mechanism with the
 *     predicate the case needs.
 *   v1.13.0 -- 2026-08-31 -- principalsForOwner(): which of an owner's principals hold a live socket
 *     right now. The Agent v2 basic-agents button needs it twice — as the precondition that refuses
 *     with "no daemon connected" before creating anything, and to pick the socket the enrolment
 *     offer goes out on.
 *   v1.12.0 -- 2026-08-28 -- `invoke` carries `timeout_ms` so the connector daemon can drop a call the
 *     server has stopped waiting for. invokeOnPrincipal now also serves GAII targets (the Crew tab
 *     asks a running crew to validate or try a definition); the method was principal-agnostic
 *     already, only its callers were ecosystem-only.
 *   v1.11.0 -- 2026-08-23 -- closeForOwner(): account deactivation (owner-lifecycle.ts, BR-04)
 *     closes every live socket acting for that owner, because upgrade-time verification is the
 *     only one a tunnel gets.
 *   v1.10.0 -- 2026-08-19 -- Pure extraction: the wire contract (ConnectFrame, WorkspaceSpaceRef,
 *     ConnectTunnelStats) and its three pure helpers moved to ./connect-tunnel-wire.ts when this
 *     file passed the 800-line cap, and are re-exported here. Bodies verbatim.
 *   v1.9.0 -- 2026-08-19 -- The in-session ack dedup set is capped at ACK_DEDUP_WINDOW recent ids
 *     per socket. It used to grow for the life of the socket and clear only on disconnect, which is
 *     bounded only while sessions are short -- 68 serve daemons stayed connected for 21 hours and
 *     these sets became the node's largest growing structure. getStats() now reports
 *     ackDedupEntries and subscriptionEntries so the number is readable from
 *     GET /v1/connect/tunnel/stats instead of from a heap snapshot.
 *   v1.0.0 — 2026-06-10 — Phase 1: forward tunnel (agent→server) + welcome +
 *     heartbeat + malformed-frame rejection + single-socket registry + stats.
 *   v1.1.0 — 2026-06-10 — Phase 2: realtime reverse delivery — `deliver` fan-out
 *     from the event-bus delivery channel, `backlog` snapshot on connect
 *     (queued+active tasks + pending messages), `ack` handling + dedup.
 *   v1.2.0 — 2026-06-10 — Hardening (post-review): SSRF guard (pin forward
 *     origin to loopback — protocol-relative paths bypassed startsWith('/')),
 *     HTTP-method allowlist, backlog now reflects storage truth (ack no longer
 *     suppresses backlog — closes a no-loss hole; ack is in-session dedup only,
 *     cleared on disconnect), and `token_expires_at` advertised in `welcome`.
 *   v1.3.0 — 2026-06-22 — P1 workspace record push: `subscribe`/`subscribed` frames + a per-socket
 *     (organism,ws,space) subscription registry. Subscribing to the central `memoryWritten` event,
 *     a write to a subscribed space fans out a lightweight `workspace.record` deliver wake (bare +
 *     `.latest` only; drafts/version history skipped). Read access is gated by the SHARED
 *     canReadWorkspace() — identical to the REST read — and RE-validated at push time so a
 *     mid-session consent revocation stops delivery. Lets contract agents drop idle space-polling.
 *   v1.4.0 — 2026-06-22 — Control pushes that let daemons drop more polling: P2 `auth_revoked`
 *     (revokeToken → stop+close the matching socket) and P3 `task.cancelled` (a cancel-marker write
 *     `agents.cancel.*` → resolve the task-id list to agents and push), so the per-dispatch
 *     owner-scoped `agents.cancel.*` memory scan goes away.
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { setTokenRevokedHook, type VerifiedToken } from '../auth/jwt.js';
import { SocketIndex, Fairness } from './connect-tunnel-multiplex.js';
import { forwardRequest } from './connect-tunnel-forward.js';
import { sendBacklog, pushTaskCancellations, onMemoryWrite } from './connect-tunnel-push.js';
import { logger } from '../utils/logger.js';
import {
  principalsForOwner as rosterPrincipalsForOwner,
  daemonsForOwner as rosterDaemonsForOwner,
} from './connect-tunnel-roster.js';
import {
  onDeliveryEvent, offDeliveryEvent, type DeliveryEvent,
  onMemoryWrittenEvent, offMemoryWrittenEvent, type MemoryWriteEvent,
} from './event-bus.js';
import { canReadWorkspace } from './workspace-access.js';
import { resolveIdentity } from '../utils/gaii.js';

export const CONNECT_TUNNEL_PROTOCOL_VERSION = '1.0';
export const CONNECT_TUNNEL_PATH = '/v1/connect/tunnel';

// The wire contract (frames, space refs, stats) and its pure helpers live in the sibling module
// and are re-exported here, so every existing importer of this file is untouched.
export type { ConnectFrame, WorkspaceSpaceRef, ConnectTunnelStats } from './connect-tunnel-wire.js';
import type { ConnectFrame, WorkspaceSpaceRef, ConnectTunnelStats } from './connect-tunnel-wire.js';
import { spaceKeyOf, coerceSpaceRef } from './connect-tunnel-wire.js';
import { revokeByToken, revokeByGaii, revokeByOwner } from './connect-tunnel-revocation.js';


interface ConnectConnection {
  principal: string;
  ws: WebSocket;
  /**
   * Which physical socket this identity rides.
   *
   * `connections` is still keyed by principal, so every lookup in this file is unchanged — what is
   * new is that several entries may now share one `ws`. This id is how the close path finds the
   * others, and how a frame is checked against the identities its socket actually proved.
   */
  socketId: string;
  identity: VerifiedToken;
  /**
   * Which INSTALLATION this socket belongs to, or null from a connector that does not say.
   *
   * One `connect serve` holds one socket per agent, so an owner's sockets used to be one
   * undifferentiated set and two machines were indistinguishable from one. The daemon presents a
   * stable id it minted once, and that is what turns "this owner's principals" into "this owner's
   * daemons". Null is a connector older than 2026-09-01, and every one of those is grouped as a
   * single legacy daemon — exactly the behaviour they had before, and no worse.
   */
  installId: string | null;
  /** The raw agent JWT verified at upgrade, reused verbatim as the forward bearer. */
  rawToken: string;
  lastHeartbeat: number;
}


/**
 * How many recent delivery ids ONE live socket remembers for in-session dedup.
 *
 * The set used to hold every id the agent had ever acked on that socket, cleared only when the
 * socket closed. That is bounded only while sessions are short, and they are not: 68 serve daemons
 * sat connected for 21 hours on production and these sets became the largest growing structure on
 * the node (memory trace 2026-08-19 — a Set's backing store is what the heap snapshot reports as
 * `<array>`, the top grower in two separate snapshots).
 *
 * A recent window is all the dedup needs. It suppresses a re-push of the SAME delivery event,
 * which arrives within seconds of the first; an id a thousand deliveries ago cannot be re-pushed
 * because the event that would push it is long gone. The backlog is computed from storage and
 * never from this set, so eviction cannot lose a task either.
 */
const ACK_DEDUP_WINDOW = 500;

export class ConnectTunnelManager {
  private connections = new Map<string, ConnectConnection>();
  /** Which identities ride which socket. See ./connect-tunnel-multiplex.ts. */
  private sockets = new SocketIndex();
  /** Per-identity in-flight cap and response-size cap — a shared wire needs what a private one did not. */
  private fairness: Fairness;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly loopbackBase: string;
  /** Per-agent set of RECENT deliver ids the agent has acked (in-session dedup only, capped at
   *  ACK_DEDUP_WINDOW — see that constant for why the cap exists). */
  private ackedDeliveries = new Map<string, Set<string>>();
  /** Server-initiated invokes awaiting an `invoke_result` reply, keyed by correlation id. */
  private pendingInvokes = new Map<string, { resolve: (f: ConnectFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  /** principal → set of subscribed spaceKeys (orgId|ws|space). Dies with the socket; re-sent on reconnect. */
  private subscriptions = new Map<string, Set<string>>();
  /** Reverse index spaceKey → subscribed principals, for O(1) record-write fan-out. */
  private spaceSubscribers = new Map<string, Set<string>>();
  private readonly deliveryHandler: (evt: DeliveryEvent) => void;
  private readonly memoryWriteHandler: (evt: MemoryWriteEvent) => void;
  private stats: ConnectTunnelStats = {
    activeConnections: 0,
    connectionsTotal: 0,
    forwardRequestsTotal: 0,
    forwardErrorsTotal: 0,
    deliveriesTotal: 0,
    acksTotal: 0,
    malformedFramesTotal: 0,
    // Both are recomputed from the live maps on every getStats() read; these are placeholders.
    ackDedupEntries: 0,
    subscriptionEntries: 0,
  };

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {
    // Forward dispatch targets the node's own loopback interface so requests run
    // through the real Express stack. NOT the public base URL — that would add a
    // public-internet hop, which is exactly what the tunnel eliminates.
    this.loopbackBase = `http://127.0.0.1:${config.port}`;
    this.fairness = new Fairness(
      config.connectTunnelMaxInflightPerIdentity,
      config.connectTunnelMaxResponseBytes,
    );

    // Realtime reverse delivery: fan a targeted delivery event out to the
    // matching agent's socket if connected. If offline, the durable store
    // (tasks stay `queued`, messages stay pending) covers it via backlog-on-connect.
    this.deliveryHandler = (evt: DeliveryEvent) => this.onDelivery(evt);
    onDeliveryEvent(this.deliveryHandler);

    // Workspace record push (P1): every memory write fires `memoryWritten` centrally (the generic
    // memory route AND the REST/MCP publish paths). We filter to keys whose (organism, ws, space)
    // has a live subscriber and push a lightweight `workspace.record` wake — so contract agents act
    // on a record event instead of idle-polling their served spaces. No per-route hook needed.
    this.memoryWriteHandler = (evt: MemoryWriteEvent) => { void this.onMemoryWrite(evt); };
    onMemoryWrittenEvent(this.memoryWriteHandler);

    // P2: revoking a token pushes `auth_revoked` to its live socket (if any) + closes it.
    setTokenRevokedHook((token) => this.onTokenRevoked(token));
  }

  /** Is `principal` (a GAII/GEAI) currently holding a live tunnel socket? Used by presence to show an
   *  agent as online while its serve daemon is connected. */
  isConnected(principal: string): boolean {
    const conn = this.connections.get(principal);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  private onDelivery(evt: DeliveryEvent): void {
    const conn = this.connections.get(evt.target);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;          // offline → backlog handles it
    if (this.ackedDeliveries.get(evt.target)?.has(evt.id)) return;       // already acked — skip
    this.stats.deliveriesTotal++;
    this.sendTo(conn, { type: 'deliver', id: evt.id, kind: evt.kind, payload: evt.payload });
  }

  /**
   * Register an authenticated principal socket — an agent (GAII) or an ecosystem
   * app (GEAI). `identity` is the JWT verified at upgrade (roles include `agent`
   * OR `ecosystem`); `rawToken` is that same JWT, reused as the forward bearer.
   * The principal is the JWT `sub` verbatim (the full GAII or GEAI). A second
   * connection for the same principal replaces the first — enforcing the
   * single-socket-per-principal invariant.
   */
  handleConnection(ws: WebSocket, identity: VerifiedToken, rawToken: string, installId?: string | null): void {
    const principal = identity.sub;
    const socketId = this.sockets.open(ws, principal);
    this.replaceIdentity(principal);

    const conn: ConnectConnection = {
      principal, ws, socketId, identity, rawToken, lastHeartbeat: Date.now(),
      installId: installId && installId.trim() !== '' ? installId.trim().slice(0, 64) : null,
    };
    this.connections.set(principal, conn);
    this.stats.connectionsTotal++;
    this.stats.activeConnections = this.connections.size;

    logger.info('Connect tunnel connected', { event: 'connect_tunnel.connect', principal, active: this.connections.size });

    this.send(ws, {
      type: 'welcome',
      id: randomUUID(),
      payload: {
        protocol_version: CONNECT_TUNNEL_PROTOCOL_VERSION,
        // THE NEGOTIATION, AND IT IS ONE FIELD. A client that sees this may `attach` further
        // identities to this socket; one that does not see it opens a socket per agent exactly as
        // before, so an older connector against a newer node and a newer connector against an
        // older node both work without anyone choosing a version.
        multiplex: true,
        heartbeat_interval_ms: this.config.connectTunnelHeartbeatIntervalMs,
        offline_threshold_ms: this.config.connectTunnelOfflineThresholdMs,
        request_timeout_ms: this.config.connectTunnelRequestTimeoutMs,
        // Epoch seconds the pinned bearer expires. The forward bearer is this
        // token verbatim, so the client should reconnect with a fresh token
        // before this — otherwise forward calls start 401-ing while the socket
        // stays open (silent breakage). Server does not auto-close at expiry:
        // agent JWTs run ~90 days, past setTimeout's safe range.
        token_expires_at: identity.exp,
        reconnect_hint: { strategy: 'exponential_backoff', base_ms: 1000, max_ms: 60000, jitter: true },
      },
      timestamp: new Date().toISOString(),
    });

    // Phase 2: drain queued tasks + pending messages, then live-push.
    void this.sendBacklog(conn);

    ws.on('message', (data) => {
      let frame: ConnectFrame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        this.stats.malformedFramesTotal++;
        this.send(ws, { type: 'error', code: 'BAD_FRAME', message: 'Frame is not valid JSON' });
        return;
      }
      // WHICH IDENTITY SENT THIS. `agent` names it on a shared socket; absent means the socket's
      // upgrade identity, which is every frame a pre-2026-09-03 client sends. Naming an identity
      // this socket has not proved is refused rather than served — the field routes, it never
      // grants, so a daemon can drive only the credentials it presented on this very socket.
      if (frame.type === 'attach') { void this.handleAttach(socketId, ws, frame); return; }
      const target = typeof frame.agent === 'string' && frame.agent ? frame.agent : principal;
      if (!this.sockets.holds(socketId, target)) {
        this.stats.malformedFramesTotal++;
        this.send(ws, { type: 'error', id: frame.id, agent: target, code: 'UNKNOWN_IDENTITY',
          message: 'This connection does not carry that identity. Attach it first.' });
        return;
      }
      if (frame.type === 'detach') { this.detachIdentity(socketId, target, 'detach'); return; }
      this.handleFrame(target, frame);
    });

    ws.on('close', () => {
      // EVERY identity on this socket goes, not just the one that opened it. A shared socket can
      // carry twelve, and forgetting only the primary would leave eleven entries pointing at a
      // closed WebSocket — read as `online` by presence, and silently dropping every deliver.
      for (const p of this.sockets.principalsOn(socketId)) {
        if (this.connections.get(p)?.socketId !== socketId) continue;
        this.connections.delete(p);
        this.ackedDeliveries.delete(p);   // in-session dedup set — bounded, never persisted
        this.clearSubscriptions(p);       // per-socket subscriptions die with the socket
        this.fairness.forget(p);
      }
      this.sockets.close(socketId);
      this.stats.activeConnections = this.connections.size;
      logger.info('Connect tunnel disconnected', { event: 'connect_tunnel.disconnect', principal, active: this.connections.size, sockets: this.sockets.socketCount });
    });

    ws.on('error', (err) => {
      logger.error('Connect tunnel WebSocket error', { event: 'connect_tunnel.error', principal, error: err.message });
    });
  }

  /**
   * Drop whatever an identity had on a PREVIOUS socket, because it is arriving on a new one.
   *
   * Was inline in handleConnection when a socket held exactly one identity. `attach` needs the same
   * three lines, and the rule it enforces — one live session per identity — is the same rule: the
   * second connection replaces the first. What changed is the blast radius. Closing the old socket
   * outright would take out every OTHER identity riding it, so the old session is detached and the
   * socket closes only if that identity was the last one on it.
   */
  private replaceIdentity(principal: string): void {
    const existing = this.connections.get(principal);
    if (existing) {
      this.connections.delete(principal);
      const { remaining } = this.sockets.detach(existing.socketId, principal);
      if (remaining === 0) {
        try { existing.ws.close(1000, 'replaced'); } catch (err) { logger.warn('replaceIdentity: ignore', { error: String(err) }); }
        this.sockets.close(existing.socketId);
      }
    }
    this.ackedDeliveries.delete(principal);
    this.clearSubscriptions(principal);
    this.fairness.forget(principal);
  }

  /**
   * One more identity on a socket that is already up.
   *
   * VERIFIED EXACTLY AS THE UPGRADE VERIFIES ITS OWN — same JWT check, same revocation check, same
   * role gate — because a second implementation of that is the drift this codebase keeps paying
   * for. What the socket has proved already buys nothing here: `attach` presents a credential and
   * is judged on it alone, so a daemon can only ever drive identities whose credentials it holds.
   *
   * This is also what ends the restart. The tunnel set used to be built from the registry at
   * startup, so taking on a new agent meant restarting the daemon and briefly dropping all 49
   * others (measured 2026-08-31). Now it is a frame.
   */
  private async handleAttach(socketId: string, ws: WebSocket, frame: ConnectFrame): Promise<void> {
    const agent = typeof frame.agent === 'string' ? frame.agent : '';
    const token = typeof frame.token === 'string' ? frame.token : '';
    if (!agent || !token) {
      this.stats.malformedFramesTotal++;
      this.send(ws, { type: 'error', id: frame.id, code: 'BAD_ATTACH_FRAME', message: 'attach requires agent and token' });
      return;
    }
    const refuse = (code: string, message: string) => {
      this.send(ws, { type: 'error', id: frame.id, agent, code, message });
    };
    try {
      const { verifyJWT } = await import('../auth/jwt.js');
      const { credentialRevoked } = await import('../auth/middleware.js');
      const payload = await verifyJWT(token);
      if (!payload?.sub) { refuse('ATTACH_UNAUTHORIZED', 'That credential did not verify.'); return; }
      if (await credentialRevoked(token, payload)) { refuse('ATTACH_UNAUTHORIZED', 'That credential has been revoked.'); return; }
      if (!payload.roles?.includes('agent') && !payload.roles?.includes('ecosystem')) {
        refuse('ATTACH_FORBIDDEN', 'Only an agent or an ecosystem app may ride this connection.');
        return;
      }
      // THE NAME MUST BE THE CREDENTIAL'S OWN. Trusting `frame.agent` over the verified `sub` would
      // let a daemon file one agent's proven credential under another agent's name and then act as
      // that one — the gate reads the normalized value, never the raw request (invariant 13).
      if (payload.sub !== agent) { refuse('ATTACH_FORBIDDEN', 'That credential belongs to a different identity.'); return; }

      const rec = this.sockets.get(socketId);
      if (!rec) { refuse('ATTACH_FAILED', 'This connection is no longer open.'); return; }
      this.replaceIdentity(payload.sub);
      this.sockets.attach(socketId, payload.sub);
      const conn: ConnectConnection = {
        principal: payload.sub, ws, socketId, identity: payload, rawToken: token,
        lastHeartbeat: Date.now(),
        // The installation is the SOCKET's property, so an attached identity inherits the one the
        // upgrade declared. It answers "which of this owner's machines", and the machine is the
        // same machine for every identity on one socket.
        installId: this.connections.get(rec.primary)?.installId ?? null,
      };
      this.connections.set(payload.sub, conn);
      this.stats.activeConnections = this.connections.size;
      logger.info('Connect tunnel identity attached', {
        event: 'connect_tunnel.attach', principal: payload.sub,
        onSocketWith: rec.principals.size, active: this.connections.size, sockets: this.sockets.socketCount,
      });
      this.send(ws, { type: 'attached', id: frame.id, agent: payload.sub, timestamp: new Date().toISOString() });
      void this.sendBacklog(conn);
    } catch (err) {
      logger.warn('Connect tunnel attach failed', { event: 'connect_tunnel.error', agent, error: String(err) });
      refuse('ATTACH_FAILED', 'That identity could not be attached.');
    }
  }

  /**
   * One identity leaves; the socket stays up for everyone else.
   *
   * THIS IS THE FENCE. A revoked credential, a deleted agent or a client's own `detach` all land
   * here, and none of them may drop the other eleven identities riding the same wire. The socket
   * closes only when this was the last one on it.
   */
  private detachIdentity(socketId: string, principal: string, reason: string): void {
    this.connections.delete(principal);
    this.ackedDeliveries.delete(principal);
    this.clearSubscriptions(principal);
    this.fairness.forget(principal);
    const { remaining } = this.sockets.detach(socketId, principal);
    this.stats.activeConnections = this.connections.size;
    logger.info('Connect tunnel identity detached', { event: 'connect_tunnel.detach', principal, reason, remaining });
    if (remaining === 0) {
      const rec = this.sockets.get(socketId);
      try { rec?.ws.close(1000, reason); } catch (err) { logger.warn('detachIdentity: ignore', { error: String(err) }); }
      this.sockets.close(socketId);
    }
  }

  private handleFrame(principal: string, frame: ConnectFrame): void {
    const conn = this.connections.get(principal);
    if (!conn) return;

    switch (frame.type) {
      case 'heartbeat': {
        conn.lastHeartbeat = Date.now();
        this.sendTo(conn, { type: 'heartbeat_ack', id: frame.id, timestamp: new Date().toISOString() });
        break;
      }
      case 'request': {
        void this.handleRequest(conn, frame);
        break;
      }
      case 'ack': {
        this.handleAck(principal, frame);
        break;
      }
      case 'invoke_result': {
        this.handleInvokeResult(frame);
        break;
      }
      case 'subscribe': {
        void this.handleSubscribe(conn, frame);
        break;
      }
      case 'disconnect': {
        try { conn.ws.close(1000, 'graceful'); } catch (err) { logger.warn('handleConnection: ignore', { error: String(err) }); }
        break;
      }
      default: {
        this.stats.malformedFramesTotal++;
        this.sendTo(conn, { type: 'error', id: frame.id, code: 'BAD_FRAME', message: `Unsupported or invalid frame type: ${String(frame.type)}` });
      }
    }
  }

  /**
   * Forward a tunneled `request`. The body lives in ./connect-tunnel-forward.ts, where the loopback
   * replay and its two guards — the origin pin and the header allowlist — sit together, because
   * that pair IS the reason scope enforcement holds through the tunnel by construction.
   */
  private async handleRequest(conn: ConnectConnection, frame: ConnectFrame): Promise<void> {
    await forwardRequest({
      config: this.config,
      stats: this.stats,
      fairness: this.fairness,
      loopbackBase: this.loopbackBase,
      sendTo: (c, f) => this.sendTo(c as ConnectConnection, f),
    }, conn, frame);
  }

  /**
   * Agent acknowledges a live `deliver`. Recorded as an IN-SESSION dedup marker
   * only (so onDelivery won't re-push the same id while this socket is up) — it
   * is NOT used to filter the backlog. Rationale: an ack means "I received the
   * push", not "the task is done". The store is the source of truth — a task
   * stays `queued`/`active` until its status changes — so the backlog is always
   * computed from storage. If ack suppressed backlog entries, an agent that
   * acked then crashed before finishing would never re-learn the task on
   * reconnect (a hole in the no-loss guarantee). The set is cleared on
   * disconnect, so it is bounded and never persists across sessions.
   */
  private handleAck(principal: string, frame: ConnectFrame): void {
    if (!frame.id) return;
    let set = this.ackedDeliveries.get(principal);
    if (!set) { set = new Set(); this.ackedDeliveries.set(principal, set); }
    set.add(frame.id);
    // Evict oldest-first past the window (a JS Set iterates in insertion order). See
    // ACK_DEDUP_WINDOW: without this the set grew for the life of the socket, and a socket that
    // never closes is exactly what a serve daemon is.
    while (set.size > ACK_DEDUP_WINDOW) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
    this.stats.acksTotal++;
  }

  /**
   * Server→principal capability invoke: send an `invoke` frame to the connected GEAI and await its
   * `invoke_result` reply (correlated by id), with a bounded timeout. This is the reverse of the
   * forward `request`/`response` path — the AIMEAT side is the initiator. The GEAI side maps the
   * `caller` to its bound account and enforces its OWN ACL; a refusal returns as `{ ok: false }`.
   * Rejects with a typed error if the principal is offline or does not reply in time.
   */
  invokeOnPrincipal(
    target: string, payload: { capability: string; input: unknown; caller: string }, timeoutMs?: number,
  ): Promise<{ ok: boolean; result: unknown }> {
    const conn = this.connections.get(target);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(Object.assign(new Error('Ecosystem app is offline'), { statusCode: 502, code: 'ECOSYSTEM_OFFLINE' }));
    }
    const id = randomUUID();
    const ttl = timeoutMs ?? this.config.connectTunnelRequestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(id);
        reject(Object.assign(new Error('Ecosystem invoke timed out'), { statusCode: 504, code: 'ECOSYSTEM_TIMEOUT' }));
      }, ttl);
      this.pendingInvokes.set(id, {
        resolve: (f) => resolve({ ok: f.ok === true, result: f.result }),
        reject,
        timer,
      });
      this.sendTo(conn, { type: 'invoke', id, capability: payload.capability, input: payload.input, caller: payload.caller, timeout_ms: ttl });
    });
  }

  private handleInvokeResult(frame: ConnectFrame): void {
    if (!frame.id) return;
    const pending = this.pendingInvokes.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingInvokes.delete(frame.id);
    pending.resolve(frame);
  }

  /**
   * Handle a `subscribe` frame: register the principal for record-write push on each (organism, ws,
   * space) it may READ. Authorization uses the SAME gate as the REST workspace read (canReadWorkspace)
   * so a pushed record never reaches an agent that couldn't read it via the API. Replies with a
   * `subscribed` frame listing accepted vs rejected refs. Idempotent (re-subscribing unions); the
   * agent re-subscribes after a reconnect (subscriptions die with the socket) and then does its one
   * catch-up read per the client design.
   */
  private async handleSubscribe(conn: ConnectConnection, frame: ConnectFrame): Promise<void> {
    const specs = Array.isArray(frame.spaces) ? frame.spaces : [];
    const accepted: WorkspaceSpaceRef[] = [];
    const rejected: Array<WorkspaceSpaceRef & { reason: string }> = [];
    for (const raw of specs) {
      const ref = coerceSpaceRef(raw);
      if (!ref) continue;  // malformed entry — drop silently
      const allowed = await this.canPrincipalReadSpace(conn, ref.organism_id, ref.ws);
      if (!allowed) { rejected.push({ ...ref, reason: 'access_denied' }); continue; }
      this.addSubscription(conn.principal, ref);
      accepted.push(ref);
    }
    logger.info('Connect tunnel subscribe', {
      event: 'connect_tunnel.subscribe', principal: conn.principal,
      accepted: accepted.length, rejected: rejected.length,
    });
    this.sendTo(conn, { type: 'subscribed', id: frame.id, payload: { accepted, rejected }, timestamp: new Date().toISOString() });
  }

  /** Does this principal pass the workspace READ gate for (organism, ws)? Same gate as the REST read. */
  private async canPrincipalReadSpace(conn: ConnectConnection, organismId: string, ws: string): Promise<boolean> {
    const organism = await this.storage.getOrganism(organismId);
    if (!organism) return false;
    const callerGaii = resolveIdentity(conn.identity, this.config.nodeId);
    return canReadWorkspace(this.storage, this.config, organism, conn.identity.sub, conn.identity.owner, callerGaii, ws);
  }

  private addSubscription(principal: string, ref: WorkspaceSpaceRef): void {
    const sk = spaceKeyOf(ref.organism_id, ref.ws, ref.space);
    let set = this.subscriptions.get(principal);
    if (!set) { set = new Set(); this.subscriptions.set(principal, set); }
    set.add(sk);
    let subs = this.spaceSubscribers.get(sk);
    if (!subs) { subs = new Set(); this.spaceSubscribers.set(sk, subs); }
    subs.add(principal);
  }

  /** Drop ALL of a principal's subscriptions (on disconnect/replace/timeout). */
  private clearSubscriptions(principal: string): void {
    const set = this.subscriptions.get(principal);
    if (!set) return;
    for (const sk of set) this.detachSubscriber(sk, principal);
    this.subscriptions.delete(principal);
  }

  /** Drop ONE (principal, spaceKey) subscription (on a mid-session access revocation). */
  private clearSubscriptionFor(principal: string, sk: string): void {
    this.subscriptions.get(principal)?.delete(sk);
    this.detachSubscriber(sk, principal);
  }

  private detachSubscriber(sk: string, principal: string): void {
    const subs = this.spaceSubscribers.get(sk);
    if (!subs) return;
    subs.delete(principal);
    if (subs.size === 0) this.spaceSubscribers.delete(sk);
  }

  /** Fan a memory write out as a `workspace.record` wake to its space's online subscribers. Body in
   *  ./connect-tunnel-push.ts. */
  private async onMemoryWrite(evt: MemoryWriteEvent): Promise<void> {
    await onMemoryWrite({
      stats: this.stats, connections: this.connections, spaceSubscribers: this.spaceSubscribers,
      sendTo: (c, f) => this.sendTo(c as ConnectConnection, f),
      canPrincipalReadSpace: (c, o, w) => this.canPrincipalReadSpace(c as ConnectConnection, o, w),
      clearSubscriptionFor: (pr, sk) => this.clearSubscriptionFor(pr, sk),
      pushTaskCancellations: (o, k) => this.pushTaskCancellations(o, k),
    }, evt);
  }
  /** On-connect snapshot from storage, so nothing is lost across a disconnect. Body in
   *  ./connect-tunnel-push.ts. */
  private async sendBacklog(conn: ConnectConnection): Promise<void> {
    await sendBacklog(this.pushCtx(), conn);
  }

  /**
   * The three ways a socket is closed because the node stopped honouring what it holds. Bodies live
   * in ./connect-tunnel-revocation.ts, where the three predicates sit side by side — the next time
   * something needs a socket closed, the question is which of these already reaches it.
   */
  onTokenRevoked(rawToken: string): void { revokeByToken(this.connections, (ws, f) => this.send(ws, f), (s, p, r) => this.detachIdentity(s, p, r), rawToken); }

  /** Deleting ONE agent: its socket goes, and nothing else on that daemon is touched. */
  closeForGaii(gaii: string): void { revokeByGaii(this.connections, (ws, f) => this.send(ws, f), (s, p, r) => this.detachIdentity(s, p, r), gaii); }

  /** Deactivating an account: every principal acting for that owner. */
  closeForOwner(owner: string): void { revokeByOwner(this.connections, (ws, f) => this.send(ws, f), (s, p, r) => this.detachIdentity(s, p, r), owner); }
  /** A cancel marker resolved to its agents and pushed. Body in ./connect-tunnel-push.ts. */
  private async pushTaskCancellations(ownerGaii: string, key: string): Promise<void> {
    await pushTaskCancellations(this.pushCtx(), ownerGaii, key);
  }

  /** What the two storage-reading pushes borrow. Built per call: they run rarely, and the maps they
   *  read are the live ones either way. */
  private pushCtx() {
    return {
      storage: this.storage, stats: this.stats, connections: this.connections,
      sendTo: (c: { principal: string; ws: WebSocket }, f: ConnectFrame) => this.sendTo(c as ConnectConnection, f),
    };
  }

  /**
   * Every principal of this OWNER holding a live socket right now. Body in
   * connect-tunnel-roster.ts, which is where the daemon grouping beside it also lives.
   */
  principalsForOwner(owner: string): string[] {
    return rosterPrincipalsForOwner(this.connections.values(), owner);
  }

  /**
   * An owner's connected DAEMONS, one entry per machine, grouped on the install id each connector
   * presents. Body in connect-tunnel-roster.ts.
   */
  daemonsForOwner(owner: string): Array<{ installId: string | null; principals: string[] }> {
    return rosterDaemonsForOwner(this.connections.values(), owner);
  }

  /** True if the agent currently holds an open tunnel socket. */
  isOnline(principal: string): boolean {
    const conn = this.connections.get(principal);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  getStats(): ConnectTunnelStats {
    let ackDedupEntries = 0;
    for (const set of this.ackedDeliveries.values()) ackDedupEntries += set.size;
    let subscriptionEntries = 0;
    for (const set of this.subscriptions.values()) subscriptionEntries += set.size;
    return { ...this.stats, activeConnections: this.connections.size, ackDedupEntries, subscriptionEntries };
  }

  /**
   * A frame addressed to ONE identity, stamped with which.
   *
   * A shared socket carries twelve conversations, so a reply that does not say whose it is cannot
   * be routed by the client. Stamped unconditionally, including on a socket carrying a single
   * identity: an older client ignores the extra field, and a rule with no exceptions is one nobody
   * has to remember.
   */
  private sendTo(conn: ConnectConnection, frame: ConnectFrame): void {
    this.send(conn.ws, { ...frame, agent: conn.principal });
  }

  private send(ws: WebSocket, frame: ConnectFrame): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(frame)); } catch (err) {
      logger.error('Connect tunnel send failed', { event: 'connect_tunnel.error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Close sockets whose heartbeat has gone silent past the offline threshold. */
  startHeartbeatMonitor(): void {
    const checkInterval = Math.max(this.config.connectTunnelHeartbeatIntervalMs, 10000);
    const offlineThreshold = this.config.connectTunnelOfflineThresholdMs;
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [principal, conn] of this.connections) {
        if (now - conn.lastHeartbeat > offlineThreshold) {
          logger.warn('Connect tunnel heartbeat timeout', { event: 'connect_tunnel.timeout', principal, elapsed_ms: now - conn.lastHeartbeat });
          try { conn.ws.close(1000, 'heartbeat_timeout'); } catch (err) { logger.warn('startHeartbeatMonitor: ignore', { error: String(err) }); }
          this.connections.delete(principal);
          this.ackedDeliveries.delete(principal);
          this.clearSubscriptions(principal);
        }
      }
      this.stats.activeConnections = this.connections.size;
    }, checkInterval);
    logger.info('Connect tunnel heartbeat monitor started', { checkInterval, offlineThreshold });
  }

  async shutdown(): Promise<void> {
    offDeliveryEvent(this.deliveryHandler);
    offMemoryWrittenEvent(this.memoryWriteHandler);
    setTokenRevokedHook(null);
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [principal, conn] of this.connections) {
      try { conn.ws.close(1000, 'shutdown'); } catch (err) { logger.warn('shutdown: ignore', { error: String(err) }); }
      this.connections.delete(principal);
      this.clearSubscriptions(principal);
    }
    this.stats.activeConnections = 0;
    if (_active === this) _active = null;
    logger.info('ConnectTunnelManager shut down');
  }
}

// Process-wide active manager — lets a lightweight read-only stats route expose
// connection metrics (the single-socket invariant test reads them) without
// threading the instance through the route-mounting plumbing.
let _active: ConnectTunnelManager | null = null;
export function setActiveConnectTunnelManager(m: ConnectTunnelManager | null): void { _active = m; }
export function getActiveConnectTunnelManager(): ConnectTunnelManager | null { return _active; }
