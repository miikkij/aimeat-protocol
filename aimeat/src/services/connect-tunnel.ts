/**
 * @file connect-tunnel.ts
 * @description ConnectTunnelManager — server side of the Connector Forward
 *   Tunnel. Holds one persistent WebSocket per agent identity (GAII) and
 *   multiplexes id-correlated forward API calls (agent→server) plus realtime
 *   reverse delivery (server→agent). Forward `request` frames are dispatched
 *   through the REAL Express stack via a loopback self-`fetch` that reuses the
 *   agent's WS-upgrade JWT as the bearer, so `requireAuth`/`requireScope` and
 *   the AIMEAT envelope apply by construction (Phase 0 decision: Option B).
 *   Mirrors the framing/heartbeat patterns of the personal-node TunnelManager
 *   but is keyed by GAII, executes requests server-side, and is decoupled from
 *   the personal-node anchor/slot/mailbox model.
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
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { logger } from '../utils/logger.js';

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
    | 'backlog'
    | 'disconnect'
    | 'error';
  /** Correlation id (request↔response, heartbeat↔ack, deliver↔ack). */
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
  // ── error (S→C) ──
  code?: string;
  message?: string;
  timestamp?: string;
}

interface ConnectConnection {
  gaii: string;
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

export class ConnectTunnelManager {
  private connections = new Map<string, ConnectConnection>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly loopbackBase: string;
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
  }

  /**
   * Register an authenticated agent socket. `identity` is the JWT verified at
   * upgrade (roles include `agent`); `rawToken` is that same JWT, reused as the
   * forward bearer. A second connection for the same GAII replaces the first —
   * enforcing the single-socket-per-agent invariant.
   */
  handleConnection(ws: WebSocket, identity: VerifiedToken, rawToken: string): void {
    const gaii = identity.sub;

    const existing = this.connections.get(gaii);
    if (existing) {
      try { existing.ws.close(1000, 'replaced'); } catch { /* ignore */ }
      this.connections.delete(gaii);
    }

    const conn: ConnectConnection = { gaii, ws, identity, rawToken, lastHeartbeat: Date.now() };
    this.connections.set(gaii, conn);
    this.stats.connectionsTotal++;
    this.stats.activeConnections = this.connections.size;

    logger.info('Connect tunnel connected', { event: 'connect_tunnel.connect', gaii, active: this.connections.size });

    this.send(ws, {
      type: 'welcome',
      id: randomUUID(),
      payload: {
        protocol_version: CONNECT_TUNNEL_PROTOCOL_VERSION,
        heartbeat_interval_ms: this.config.connectTunnelHeartbeatIntervalMs,
        offline_threshold_ms: this.config.connectTunnelOfflineThresholdMs,
        request_timeout_ms: this.config.connectTunnelRequestTimeoutMs,
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
      this.handleFrame(gaii, frame);
    });

    ws.on('close', () => {
      // Only forget this socket if it is still the registered one (a replacement
      // may have already taken its place).
      if (this.connections.get(gaii)?.ws === ws) {
        this.connections.delete(gaii);
        this.stats.activeConnections = this.connections.size;
      }
      logger.info('Connect tunnel disconnected', { event: 'connect_tunnel.disconnect', gaii, active: this.connections.size });
    });

    ws.on('error', (err) => {
      logger.error('Connect tunnel WebSocket error', { event: 'connect_tunnel.error', gaii, error: err.message });
    });
  }

  private handleFrame(gaii: string, frame: ConnectFrame): void {
    const conn = this.connections.get(gaii);
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
        this.handleAck(gaii, frame);
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

    this.stats.forwardRequestsTotal++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.connectTunnelRequestTimeoutMs);

    try {
      const url = new URL(frame.path, this.loopbackBase);
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
      logger.warn('Connect tunnel forward dispatch failed', { event: 'connect_tunnel.error', gaii: conn.gaii, path: frame.path, error: err instanceof Error ? err.message : String(err) });
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

  // ── Phase 2 hooks (filled in Phase 2) ──────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unused-vars */
  private handleAck(_gaii: string, _frame: ConnectFrame): void { /* Phase 2 */ }
  private async sendBacklog(_conn: ConnectConnection): Promise<void> { /* Phase 2 */ }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** True if the agent currently holds an open tunnel socket. */
  isOnline(gaii: string): boolean {
    const conn = this.connections.get(gaii);
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
      for (const [gaii, conn] of this.connections) {
        if (now - conn.lastHeartbeat > offlineThreshold) {
          logger.warn('Connect tunnel heartbeat timeout', { event: 'connect_tunnel.timeout', gaii, elapsed_ms: now - conn.lastHeartbeat });
          try { conn.ws.close(1000, 'heartbeat_timeout'); } catch { /* ignore */ }
          this.connections.delete(gaii);
        }
      }
      this.stats.activeConnections = this.connections.size;
    }, checkInterval);
    logger.info('Connect tunnel heartbeat monitor started', { checkInterval, offlineThreshold });
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [gaii, conn] of this.connections) {
      try { conn.ws.close(1000, 'shutdown'); } catch { /* ignore */ }
      this.connections.delete(gaii);
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
