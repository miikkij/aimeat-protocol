/**
 * @file connect-tunnel.ts
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
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { logger } from '../utils/logger.js';
import { onDeliveryEvent, offDeliveryEvent, type DeliveryEvent } from './event-bus.js';

export const CONNECT_TUNNEL_PROTOCOL_VERSION = '1.0';
export const CONNECT_TUNNEL_PATH = '/v1/connect/tunnel';

/** A single tunnel wire frame. JSON-encoded, id-correlated where applicable. */
export interface ConnectFrame {
  type:
    | 'welcome'
    | 'heartbeat'
    | 'heartbeat_ack'
    | 'request'
    | 'response'
    | 'deliver'
    | 'ack'
    | 'invoke'         // S→C: server invokes a capability ON the connected principal (a GEAI)
    | 'invoke_result'  // C→S: the principal's reply to an invoke, correlated by id
    | 'backlog'
    | 'disconnect'
    | 'error';
  /** Correlation id (request↔response, heartbeat↔ack, deliver↔ack, invoke↔invoke_result). */
  id?: string;
  // ── request (C→S) ──
  method?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  // ── response (S→C) ──
  status?: number;
  // ── deliver (S→C) ──
  kind?: string;
  payload?: unknown;
  // ── invoke (S→C) / invoke_result (C→S) ──
  capability?: string;       // invoke: the capability id/name to run on the principal
  input?: unknown;           // invoke: the input payload
  caller?: string;           // invoke: the AIMEAT caller GHII (the principal maps this to its account)
  ok?: boolean;              // invoke_result: whether the principal handled it successfully
  result?: unknown;          // invoke_result: the capability output
  // ── error (S→C) ──
  code?: string;
  message?: string;
  timestamp?: string;
}

interface ConnectConnection {
  principal: string;
  ws: WebSocket;
  identity: VerifiedToken;
  /** The raw agent JWT verified at upgrade, reused verbatim as the forward bearer. */
  rawToken: string;
  lastHeartbeat: number;
}

export interface ConnectTunnelStats {
  activeConnections: number;
  connectionsTotal: number;
  forwardRequestsTotal: number;
  forwardErrorsTotal: number;
  deliveriesTotal: number;
  acksTotal: number;
  malformedFramesTotal: number;
}

/**
 * Only these client-supplied request headers are forwarded on the loopback
 * call. Authorization/Host/Cookie are deliberately excluded — the pinned agent
 * JWT is the sole credential, so the tunnel can never be used to escalate past
 * the identity established at upgrade.
 */
const FORWARDABLE_HEADERS = new Set(['content-type', 'accept', 'idempotency-key', 'x-request-id']);

/** Forward dispatch only accepts these HTTP methods. */
const FORWARDABLE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export class ConnectTunnelManager {
  private connections = new Map<string, ConnectConnection>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly loopbackBase: string;
  /** Per-agent set of deliver ids the agent has acked — excluded from later backlogs. */
  private ackedDeliveries = new Map<string, Set<string>>();
  /** Server-initiated invokes awaiting an `invoke_result` reply, keyed by correlation id. */
  private pendingInvokes = new Map<string, { resolve: (f: ConnectFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly deliveryHandler: (evt: DeliveryEvent) => void;
  private stats: ConnectTunnelStats = {
    activeConnections: 0,
    connectionsTotal: 0,
    forwardRequestsTotal: 0,
    forwardErrorsTotal: 0,
    deliveriesTotal: 0,
    acksTotal: 0,
    malformedFramesTotal: 0,
  };

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {
    // Forward dispatch targets the node's own loopback interface so requests run
    // through the real Express stack. NOT the public base URL — that would add a
    // public-internet hop, which is exactly what the tunnel eliminates.
    this.loopbackBase = `http://127.0.0.1:${config.port}`;

    // Realtime reverse delivery: fan a targeted delivery event out to the
    // matching agent's socket if connected. If offline, the durable store
    // (tasks stay `queued`, messages stay pending) covers it via backlog-on-connect.
    this.deliveryHandler = (evt: DeliveryEvent) => this.onDelivery(evt);
    onDeliveryEvent(this.deliveryHandler);
  }

  private onDelivery(evt: DeliveryEvent): void {
    const conn = this.connections.get(evt.target);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;          // offline → backlog handles it
    if (this.ackedDeliveries.get(evt.target)?.has(evt.id)) return;       // already acked — skip
    this.stats.deliveriesTotal++;
    this.send(conn.ws, { type: 'deliver', id: evt.id, kind: evt.kind, payload: evt.payload });
  }

  /**
   * Register an authenticated principal socket — an agent (GAII) or an ecosystem
   * app (GEAI). `identity` is the JWT verified at upgrade (roles include `agent`
   * OR `ecosystem`); `rawToken` is that same JWT, reused as the forward bearer.
   * The principal is the JWT `sub` verbatim (the full GAII or GEAI). A second
   * connection for the same principal replaces the first — enforcing the
   * single-socket-per-principal invariant.
   */
  handleConnection(ws: WebSocket, identity: VerifiedToken, rawToken: string): void {
    const principal = identity.sub;

    const existing = this.connections.get(principal);
    if (existing) {
      try { existing.ws.close(1000, 'replaced'); } catch { /* ignore */ }
      this.connections.delete(principal);
    }
    // Fresh session → fresh in-session dedup state (the replaced socket's close
    // handler won't clear it, since the registered ws is now the new one).
    this.ackedDeliveries.delete(principal);

    const conn: ConnectConnection = { principal, ws, identity, rawToken, lastHeartbeat: Date.now() };
    this.connections.set(principal, conn);
    this.stats.connectionsTotal++;
    this.stats.activeConnections = this.connections.size;

    logger.info('Connect tunnel connected', { event: 'connect_tunnel.connect', principal, active: this.connections.size });

    this.send(ws, {
      type: 'welcome',
      id: randomUUID(),
      payload: {
        protocol_version: CONNECT_TUNNEL_PROTOCOL_VERSION,
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
      this.handleFrame(principal, frame);
    });

    ws.on('close', () => {
      // Only forget this socket if it is still the registered one (a replacement
      // may have already taken its place).
      if (this.connections.get(principal)?.ws === ws) {
        this.connections.delete(principal);
        this.ackedDeliveries.delete(principal);  // in-session dedup set — bounded, never persisted
        this.stats.activeConnections = this.connections.size;
      }
      logger.info('Connect tunnel disconnected', { event: 'connect_tunnel.disconnect', principal, active: this.connections.size });
    });

    ws.on('error', (err) => {
      logger.error('Connect tunnel WebSocket error', { event: 'connect_tunnel.error', principal, error: err.message });
    });
  }

  private handleFrame(principal: string, frame: ConnectFrame): void {
    const conn = this.connections.get(principal);
    if (!conn) return;

    switch (frame.type) {
      case 'heartbeat': {
        conn.lastHeartbeat = Date.now();
        this.send(conn.ws, { type: 'heartbeat_ack', id: frame.id, timestamp: new Date().toISOString() });
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
      case 'disconnect': {
        try { conn.ws.close(1000, 'graceful'); } catch { /* ignore */ }
        break;
      }
      default: {
        this.stats.malformedFramesTotal++;
        this.send(conn.ws, { type: 'error', id: frame.id, code: 'BAD_FRAME', message: `Unsupported or invalid frame type: ${String(frame.type)}` });
      }
    }
  }

  /**
   * Forward a tunneled `request` through the real Express stack (loopback
   * self-fetch with the pinned agent bearer) and return the correlated
   * `response`. Scope enforcement + the AIMEAT envelope hold by construction.
   */
  private async handleRequest(conn: ConnectConnection, frame: ConnectFrame): Promise<void> {
    const { id } = frame;
    if (!id || typeof frame.method !== 'string' || typeof frame.path !== 'string' || !frame.path.startsWith('/')) {
      this.stats.malformedFramesTotal++;
      this.send(conn.ws, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'request requires id, method, and an absolute path' });
      return;
    }
    if (!FORWARDABLE_METHODS.has(frame.method.toUpperCase())) {
      this.stats.malformedFramesTotal++;
      this.send(conn.ws, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: `Unsupported method: ${frame.method}` });
      return;
    }

    // SSRF guard: `path.startsWith('/')` is NOT enough — a protocol-relative path
    // like `//evil.com/x` (or a backslash variant) resolves against the loopback
    // scheme to an off-host origin, which would make the server fetch an arbitrary
    // host AND ship the agent's bearer to it. Pin the resolved origin to loopback.
    let url: URL;
    try {
      url = new URL(frame.path, this.loopbackBase);
    } catch {
      this.stats.malformedFramesTotal++;
      this.send(conn.ws, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'Invalid request path' });
      return;
    }
    if (url.origin !== this.loopbackBase) {
      this.stats.malformedFramesTotal++;
      logger.warn('Connect tunnel rejected off-host forward path', { event: 'connect_tunnel.ssrf_block', principal: conn.principal, path: frame.path, resolvedOrigin: url.origin });
      this.send(conn.ws, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'request path must stay on this node (loopback)' });
      return;
    }

    this.stats.forwardRequestsTotal++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.connectTunnelRequestTimeoutMs);

    try {
      if (frame.query) {
        for (const [k, v] of Object.entries(frame.query)) url.searchParams.set(k, String(v));
      }

      const headers: Record<string, string> = { Authorization: `Bearer ${conn.rawToken}` };
      if (frame.headers) {
        for (const [k, v] of Object.entries(frame.headers)) {
          if (FORWARDABLE_HEADERS.has(k.toLowerCase())) headers[k] = String(v);
        }
      }
      const hasBody = frame.body !== undefined && frame.body !== null && frame.method.toUpperCase() !== 'GET' && frame.method.toUpperCase() !== 'HEAD';
      if (hasBody && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, {
        method: frame.method,
        headers,
        body: hasBody ? JSON.stringify(frame.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let body: unknown;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }

      this.send(conn.ws, { type: 'response', id, status: res.status, body });
    } catch (err) {
      this.stats.forwardErrorsTotal++;
      const aborted = err instanceof Error && err.name === 'AbortError';
      logger.warn('Connect tunnel forward dispatch failed', { event: 'connect_tunnel.error', principal: conn.principal, path: frame.path, error: err instanceof Error ? err.message : String(err) });
      this.send(conn.ws, {
        type: 'response',
        id,
        status: aborted ? 504 : 502,
        body: {
          ok: false,
          protocol: 'aimeat',
          version: 'v1',
          node: this.config.nodeId,
          error: { code: aborted ? 'TUNNEL_TIMEOUT' : 'TUNNEL_DISPATCH_ERROR', message: aborted ? 'Forward request timed out' : 'Forward dispatch failed' },
        },
      });
    } finally {
      clearTimeout(timer);
    }
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
      this.send(conn.ws, { type: 'invoke', id, capability: payload.capability, input: payload.input, caller: payload.caller });
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
   * On connect, send a snapshot of everything outstanding for this agent —
   * queued + active tasks and pending messages — straight from storage (the
   * source of truth), so nothing is lost across a disconnect (mirrors
   * TunnelManager.sendMailboxSummary). A task leaves the backlog only when its
   * status changes (done/failed/etc.), never because of an ack. After this the
   * manager live-pushes via `deliver`.
   */
  private async sendBacklog(conn: ConnectConnection): Promise<void> {
    try {
      const principal = conn.principal;
      const [queued, active, pendingMessages] = await Promise.all([
        this.storage.listAgentTasks(principal, { status: 'queued' }),
        this.storage.listAgentTasks(principal, { status: 'active' }),
        this.storage.listPendingMessages(principal).catch(() => []),
      ]);
      // Dedup tasks by id (a task can't be both queued and active, but guard).
      const taskById = new Map<string, unknown>();
      for (const t of [...queued.tasks, ...active.tasks]) taskById.set(t.id, t);
      const tasks = [...taskById.values()];
      const messages = pendingMessages;

      if (conn.ws.readyState !== WebSocket.OPEN) return;
      this.send(conn.ws, {
        type: 'backlog',
        id: randomUUID(),
        payload: { tasks, messages },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Connect tunnel backlog failed', { event: 'connect_tunnel.error', principal: conn.principal, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** True if the agent currently holds an open tunnel socket. */
  isOnline(principal: string): boolean {
    const conn = this.connections.get(principal);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  getStats(): ConnectTunnelStats {
    return { ...this.stats, activeConnections: this.connections.size };
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
          try { conn.ws.close(1000, 'heartbeat_timeout'); } catch { /* ignore */ }
          this.connections.delete(principal);
          this.ackedDeliveries.delete(principal);
        }
      }
      this.stats.activeConnections = this.connections.size;
    }, checkInterval);
    logger.info('Connect tunnel heartbeat monitor started', { checkInterval, offlineThreshold });
  }

  async shutdown(): Promise<void> {
    offDeliveryEvent(this.deliveryHandler);
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [principal, conn] of this.connections) {
      try { conn.ws.close(1000, 'shutdown'); } catch { /* ignore */ }
      this.connections.delete(principal);
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
