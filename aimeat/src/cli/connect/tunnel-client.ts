/**
 * @file tunnel-client.ts
 * @description Node-side client for the Connector Forward Tunnel
 *   (`/v1/connect/tunnel`). One instance per agent. Holds a single persistent
 *   WebSocket to the AIMEAT node and multiplexes id-correlated forward API
 *   calls (`forward()` → request/response frames) plus realtime reverse
 *   delivery (`deliver`/`backlog` → onDeliver/onBacklog, auto-`ack`).
 *   Mirrors the reconnect/heartbeat/correlation patterns of the browser
 *   personal-tunnel client (src/routes/lib-tunnel.ts) in Node `ws`.
 *
 *   Token model: RFC 8628 device-auth, long-lived (~90 day) agent JWT, no
 *   refresh flow. The token is re-read from the keychain on EVERY (re)connect
 *   (picks up a re-run `aimeat connect`), and the client proactively
 *   reconnects with a fresh token shortly before the server-advertised
 *   `token_expires_at`. On an auth failure (upgrade 401/403 or a forwarded
 *   401) the client STOPS and surfaces the "Run: aimeat connect" guidance —
 *   it never hot-loops against a dead credential.
 *
 * @structure
 *   - ConnectTunnelClient — start()/forward()/close(), heartbeat with
 *     dead-socket detection, exponential backoff + jitter reconnect (hints
 *     adopted from the server `welcome`), deliver→ack, backlog emit.
 *   - TunnelStartOutcome — 'online' | 'unsupported' | 'auth_failed' |
 *     'unreachable' (drives the serve daemon's graceful degradation).
 * @usage
 *   const client = new ConnectTunnelClient({ nodeUrl, getToken, onDeliver });
 *   const outcome = await client.start();
 *   if (outcome === 'online') { const { status, body } = await client.forward('GET', '/v1/memory'); }
 *   await client.close();
 * @version-history
 *   v1.0.0 — 2026-06-10 — Phase 3: initial tunnel client (forward correlation,
 *     heartbeat + dead-conn detection, reconnect backoff, deliver/backlog,
 *     proactive pre-expiry token reconnect, auth-failure stop).
 *   v1.1.0 — 2026-06-22 — P1 record push: subscribe() sends a `subscribe` frame; onConnect fires
 *     after each (re)connect so the serve daemon re-subscribes (per-socket subscriptions) and the
 *     consumer catches up; `subscribed` ack logged. workspace.record delivers ride the existing
 *     onDeliver path (auto-acked like any deliver).
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

/** Result of a forwarded API call — HTTP status + parsed (envelope) body. */
export interface ForwardResult {
  status: number;
  body: unknown;
}

export interface ForwardOptions {
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export type TunnelStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'stopped';

/**
 * Outcome of the FIRST connection attempt (`start()`):
 * - 'online'      — tunnel established; the client now auto-reconnects on drops.
 * - 'unsupported' — node has the tunnel disabled or is too old (upgrade 404 /
 *                   no handler). Caller should degrade to direct fetch + poll.
 * - 'auth_failed' — upgrade rejected 401/403. Caller should surface re-auth
 *                   guidance; the client is stopped (no retry loop).
 * - 'unreachable' — network-level failure. Caller should degrade; the client
 *                   is stopped.
 */
export type TunnelStartOutcome = 'online' | 'unsupported' | 'auth_failed' | 'unreachable';

export interface ConnectTunnelClientOptions {
  /** Base HTTP(S) URL of the AIMEAT node (e.g. https://aimeat.io). */
  nodeUrl: string;
  /**
   * Full WebSocket endpoint to dial (connector profile §6). When set, it is used verbatim instead of
   * deriving `{nodeUrl}/v1/connect/tunnel` — lets the same client target a non-AIMEAT, ecosystem-hosted
   * tunnel endpoint (the AIMEAT→ecosystem initiation direction). Default: derive from `nodeUrl`.
   */
  wsUrl?: string;
  /**
   * Returns the current agent JWT. Called on EVERY (re)connect so a token
   * refreshed via `aimeat connect` is picked up without restarting serve.
   */
  getToken: () => Promise<string | null>;
  /** Log label, e.g. "tunnel:claude". Defaults to "tunnel". */
  label?: string;
  /** Realtime reverse delivery (the client acks automatically). */
  onDeliver?: (kind: string, payload: unknown, id: string) => void;
  /** On-connect snapshot of queued tasks + pending messages. */
  onBacklog?: (payload: { tasks: unknown[]; messages: unknown[] }) => void;
  /**
   * Fired after each (re)connect is welcomed — used to RE-SEND subscriptions (which die with the
   * old socket) and to drive a catch-up read on the consumer. `connectCount` is 1 on first connect,
   * incrementing per reconnect.
   */
  onConnect?: (connectCount: number) => void;
  /** Fired once when the client stops due to an auth failure. */
  onAuthFailure?: (message: string) => void;
  onStatusChange?: (status: TunnelStatus) => void;
  /** Defaults below are pre-welcome fallbacks; the server `welcome` overrides them. */
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectJitter?: boolean;
  /** Reconnect this long before the advertised `token_expires_at`. Default 60s. */
  tokenRefreshLeadMs?: number;
}

interface PendingForward {
  resolve: (r: ForwardResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TunnelFrame {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  status?: number;
  kind?: string;
  payload?: unknown;
  code?: string;
  message?: string;
  timestamp?: string;
}

/**
 * Forwarded-response auth codes that mean the pinned bearer itself is dead
 * (stop the client, surface re-auth guidance). Deliberately NARROWER than the
 * poller's AUTH_ERROR_CODES: FORBIDDEN/SCOPE_DENIED on a forwarded call is a
 * per-route scope denial, not token death — killing the whole tunnel for one
 * scope-denied tool call would be wrong.
 */
const TOKEN_DEAD_CODES = new Set(['UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED']);

const RE_AUTH_GUIDANCE = 'Run: aimeat connect';
/** Cap a single token-refresh timer chunk; the chain re-evaluates each firing. */
const MAX_TIMER_CHUNK_MS = 24 * 60 * 60 * 1000;

function wsUrl(nodeUrl: string): string {
  return nodeUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/v1/connect/tunnel';
}

export class ConnectTunnelClient {
  private readonly opts: Required<Pick<ConnectTunnelClientOptions,
    'heartbeatIntervalMs' | 'requestTimeoutMs' | 'reconnectBaseMs' | 'reconnectMaxMs' | 'reconnectJitter' | 'tokenRefreshLeadMs'>> &
    ConnectTunnelClientOptions;
  private readonly label: string;

  private ws: WebSocket | null = null;
  private status: TunnelStatus = 'idle';
  private stopped = false;
  private welcomed = false;

  private pending = new Map<string, PendingForward>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeartbeatAck = 0;
  private reconnectAttempts = 0;
  /** Total successful (welcomed) connections — observable for tests. */
  private connectCount = 0;
  private tokenExpiresAt: number | null = null; // epoch seconds
  private serverConfig: Record<string, unknown> | null = null;
  private authFailed = false;

  constructor(options: ConnectTunnelClientOptions) {
    this.opts = {
      heartbeatIntervalMs: 30_000,
      requestTimeoutMs: 30_000,
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 60_000,
      reconnectJitter: true,
      tokenRefreshLeadMs: 60_000,
      ...options,
    };
    this.label = options.label ?? 'tunnel';
  }

  getStatus(): TunnelStatus { return this.status; }
  isOnline(): boolean { return this.status === 'online'; }
  getConnectCount(): number { return this.connectCount; }
  getTokenExpiresAt(): number | null { return this.tokenExpiresAt; }
  getServerConfig(): Record<string, unknown> | null { return this.serverConfig; }

  /**
   * First connection attempt. Resolves with the outcome; on anything other
   * than 'online' the client is stopped (the caller decides whether to
   * degrade to direct fetch + poll or surface re-auth guidance).
   */
  async start(): Promise<TunnelStartOutcome> {
    const outcome = await this.connectOnce();
    if (outcome !== 'online') this.stop();
    return outcome;
  }

  /**
   * Send a forward `request` frame and resolve on the correlated `response`.
   * Resolves a synthetic 504 envelope if no response arrives within the
   * (welcome-advertised) request timeout. Rejects only when the tunnel is not
   * connected at call time.
   */
  forward(method: string, path: string, opts: ForwardOptions = {}): Promise<ForwardResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') {
      return Promise.reject(new Error('Tunnel not connected'));
    }
    const id = randomUUID();
    const frame: TunnelFrame = { type: 'request', id, method, path, query: opts.query, headers: opts.headers, body: opts.body };
    return new Promise<ForwardResult>((resolve) => {
      // Small grace over the server timeout so the server's own synthetic 504
      // (same id) normally wins; this local timer is the dead-socket fallback.
      const grace = Math.min(5_000, this.opts.requestTimeoutMs);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          status: 504,
          body: { ok: false, error: { code: 'TUNNEL_TIMEOUT', message: `Forward ${method} ${path} timed out after ${this.opts.requestTimeoutMs}ms` } },
        });
      }, this.opts.requestTimeoutMs + grace);
      this.pending.set(id, { resolve, timer });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  /**
   * Send a `subscribe` frame for workspace record push. Fire-and-forget (the server replies with a
   * `subscribed` frame surfaced via onDeliver-adjacent logging). No-op if the socket is not open —
   * the caller re-subscribes on the next `onConnect`. `spaces` are (organism_id, ws, space) tuples.
   */
  subscribe(spaces: Array<{ organism_id: string; ws: string; space: string }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return;
    if (!spaces.length) return;
    try { this.ws.send(JSON.stringify({ type: 'subscribe', id: randomUUID(), spaces })); }
    catch (err) { console.error(`[${this.label}] subscribe send failed: ${(err as Error).message}`); }
  }

  /** Graceful shutdown: `disconnect` frame + socket close + timers cleared. */
  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    this.rejectPending();
    const ws = this.ws;
    this.setStatus('stopped');
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'disconnect', id: randomUUID(), timestamp: new Date().toISOString() })); } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), 1_000);
        ws.once('close', () => { clearTimeout(t); resolve(); });
        try { ws.close(1000, 'client_close'); } catch { clearTimeout(t); resolve(); }
      });
    }
  }

  /* ───────── internals ───────── */

  private setStatus(s: TunnelStatus): void {
    if (this.status === s) return;
    this.status = s;
    try { this.opts.onStatusChange?.(s); } catch { /* listener error — ignore */ }
  }

  /** Stop permanently: no reconnects, timers cleared, pendings rejected. */
  private stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.rejectPending();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(1000, 'stopped'); } catch { /* ignore */ }
    }
    this.setStatus('stopped');
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
  }

  private rejectPending(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ status: 503, body: { ok: false, error: { code: 'TUNNEL_DISCONNECTED', message: 'Tunnel connection lost before a response arrived' } } });
    }
    this.pending.clear();
  }

  private authFailure(message: string): void {
    if (this.authFailed) return;
    this.authFailed = true;
    console.error(`[${this.label}] Stopped: ${message}. ${RE_AUTH_GUIDANCE}`);
    this.stop();
    try { this.opts.onAuthFailure?.(message); } catch { /* listener error — ignore */ }
  }

  /**
   * One connection attempt. Re-reads the token from the keychain, opens the
   * socket with `Authorization: Bearer` (server-preferred), and resolves on
   * welcome (or classifies the failure).
   */
  private async connectOnce(): Promise<TunnelStartOutcome> {
    if (this.stopped) return this.authFailed ? 'auth_failed' : 'unreachable';
    this.setStatus('connecting');

    const token = await this.opts.getToken();
    if (!token) {
      this.authFailure('No stored token');
      return 'auth_failed';
    }

    return new Promise<TunnelStartOutcome>((resolve) => {
      let settled = false;
      const settle = (o: TunnelStartOutcome) => { if (!settled) { settled = true; resolve(o); } };

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.opts.wsUrl ?? wsUrl(this.opts.nodeUrl), { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        this.setStatus('offline');
        settle('unreachable');
        return;
      }
      this.ws = ws;
      this.welcomed = false;

      // Upgrade rejected with an HTTP status (server reachable, tunnel said no).
      ws.on('unexpected-response', (_req, res) => {
        const code = res.statusCode ?? 0;
        try { ws.terminate(); } catch { /* ignore */ }
        if (code === 401 || code === 403) {
          this.authFailure(`Tunnel upgrade rejected (${code})`);
          settle('auth_failed');
        } else {
          // 404 / anything else: node too old or tunnel disabled.
          console.error(`[${this.label}] Tunnel not available on this node (upgrade ${code}).`);
          settle('unsupported');
        }
      });

      ws.on('message', (data) => {
        let frame: TunnelFrame;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        if (frame.type === 'welcome' && !this.welcomed) {
          this.welcomed = true;
          this.handleWelcome(frame);
          settle('online');
          return;
        }
        this.handleFrame(frame);
      });

      ws.on('error', (err) => {
        if (!this.welcomed) {
          console.error(`[${this.label}] Tunnel connect failed: ${err.message}`);
          settle('unreachable');
        }
      });

      ws.on('close', () => {
        const wasWelcomed = this.welcomed;
        if (this.ws === ws) {
          this.ws = null;
          if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
          this.rejectPending();
          if (!this.stopped) this.setStatus('offline');
        }
        if (!wasWelcomed) {
          // A reachable node with the tunnel feature off destroys the upgrade
          // socket without an HTTP response — classify as unsupported-ish
          // network failure; the daemon degrades either way.
          settle('unreachable');
        }
        if (!this.stopped && wasWelcomed) this.scheduleReconnect();
      });
    });
  }

  private handleWelcome(frame: TunnelFrame): void {
    const p = (frame.payload ?? {}) as Record<string, unknown>;
    this.serverConfig = p;
    if (typeof p.heartbeat_interval_ms === 'number' && p.heartbeat_interval_ms > 0) {
      this.opts.heartbeatIntervalMs = p.heartbeat_interval_ms;
    }
    if (typeof p.request_timeout_ms === 'number' && p.request_timeout_ms > 0) {
      this.opts.requestTimeoutMs = p.request_timeout_ms;
    }
    const hint = p.reconnect_hint as { base_ms?: number; max_ms?: number; jitter?: boolean } | undefined;
    if (hint) {
      if (typeof hint.base_ms === 'number') this.opts.reconnectBaseMs = hint.base_ms;
      if (typeof hint.max_ms === 'number') this.opts.reconnectMaxMs = hint.max_ms;
      if (typeof hint.jitter === 'boolean') this.opts.reconnectJitter = hint.jitter;
    }
    this.tokenExpiresAt = typeof p.token_expires_at === 'number' ? p.token_expires_at : null;

    this.connectCount++;
    this.reconnectAttempts = 0;
    this.lastHeartbeatAck = Date.now();
    this.setStatus('online');
    this.startHeartbeat();
    this.scheduleTokenRefresh();
    // Subscriptions are per-socket on the server — re-send them now, then let the consumer catch up.
    try { this.opts.onConnect?.(this.connectCount); } catch (err) { console.error(`[${this.label}] onConnect handler error: ${(err as Error).message}`); }
  }

  private handleFrame(frame: TunnelFrame): void {
    switch (frame.type) {
      case 'heartbeat_ack': {
        this.lastHeartbeatAck = Date.now();
        break;
      }
      case 'response': {
        const p = frame.id ? this.pending.get(frame.id) : undefined;
        if (p && frame.id) {
          clearTimeout(p.timer);
          this.pending.delete(frame.id);
          p.resolve({ status: frame.status ?? 0, body: frame.body });
        }
        // A forwarded 401 means the pinned bearer is dead — every subsequent
        // call would 401 too while the socket sits open (silent breakage).
        const errCode = ((frame.body as { error?: { code?: string } } | null)?.error?.code) ?? '';
        if (frame.status === 401 || TOKEN_DEAD_CODES.has(errCode)) {
          this.authFailure(`Forwarded request returned ${frame.status} ${errCode || 'UNAUTHORIZED'}`);
        }
        break;
      }
      case 'deliver': {
        const id = frame.id ?? '';
        try { this.opts.onDeliver?.(frame.kind ?? '', frame.payload, id); }
        catch (err) { console.error(`[${this.label}] onDeliver handler error: ${(err as Error).message}`); }
        if (id && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ack', id }));
        }
        break;
      }
      case 'backlog': {
        const p = (frame.payload ?? {}) as { tasks?: unknown[]; messages?: unknown[] };
        try { this.opts.onBacklog?.({ tasks: p.tasks ?? [], messages: p.messages ?? [] }); }
        catch (err) { console.error(`[${this.label}] onBacklog handler error: ${(err as Error).message}`); }
        break;
      }
      case 'subscribed': {
        const p = (frame.payload ?? {}) as { accepted?: unknown[]; rejected?: unknown[] };
        const acc = p.accepted?.length ?? 0;
        const rej = p.rejected?.length ?? 0;
        if (rej > 0) console.error(`[${this.label}] Record subscribe: ${acc} accepted, ${rej} rejected (access)`);
        break;
      }
      case 'auth_revoked': {
        // Server revoked the pinned bearer — stop + surface re-auth guidance (same path as a
        // forwarded 401). Removes the client's periodic auth-liveness probe.
        this.authFailure(frame.message ?? 'Token revoked by server');
        break;
      }
      case 'error': {
        console.error(`[${this.label}] Server error frame: ${frame.code ?? ''} ${frame.message ?? ''}`);
        break;
      }
      case 'disconnect': {
        try { this.ws?.close(1000, 'server_disconnect'); } catch { /* ignore */ }
        break;
      }
      default:
        break;
    }
  }

  /* ── heartbeat with dead-socket detection ── */

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const interval = this.opts.heartbeatIntervalMs;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const sinceLast = Date.now() - this.lastHeartbeatAck;
      if (sinceLast > interval * 3) {
        // Dead socket: no ack within 3× interval. Terminate (not close — the
        // peer is gone) and let the close handler schedule the reconnect. The
        // server reaps at offline_threshold_ms (~90s); 3×interval stays under it.
        console.error(`[${this.label}] Heartbeat ack timeout (${sinceLast}ms), reconnecting...`);
        try { this.ws.terminate(); } catch { /* ignore */ }
        return;
      }
      this.ws.send(JSON.stringify({ type: 'heartbeat', id: randomUUID(), timestamp: new Date().toISOString() }));
    }, interval);
  }

  /* ── reconnect with exponential backoff + jitter (welcome hints) ── */

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = this.opts.reconnectBaseMs;
    const max = this.opts.reconnectMaxMs;
    let delay = Math.min(base * Math.pow(2, this.reconnectAttempts), max);
    if (this.opts.reconnectJitter) {
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay = Math.max(base, delay + jitter);
    }
    this.reconnectAttempts++;
    console.error(`[${this.label}] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectOnce().then((outcome) => {
        // After an established session, transient failures keep retrying with
        // backoff; only an explicit auth rejection stops the client (handled
        // inside connectOnce → authFailure → stop).
        if (outcome !== 'online' && outcome !== 'auth_failed' && !this.stopped) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  /* ── proactive pre-expiry token reconnect ── */

  private scheduleTokenRefresh(): void {
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
    if (!this.tokenExpiresAt) return;
    const target = this.tokenExpiresAt * 1000 - this.opts.tokenRefreshLeadMs;
    const delay = target - Date.now();
    if (delay <= 0) {
      // Already inside the lead window — reconnect now with a fresh token. The
      // server does NOT auto-close at expiry; without this, forward calls
      // start 401-ing while the socket stays open.
      console.error(`[${this.label}] Token nearing expiry — reconnecting with a fresh token`);
      try { this.ws?.terminate(); } catch { /* ignore */ }
      return;
    }
    // Agent JWTs run ~90 days — past a single setTimeout's safe range. Chain
    // capped chunks and re-evaluate at each firing.
    this.tokenTimer = setTimeout(() => {
      this.tokenTimer = null;
      this.scheduleTokenRefresh();
    }, Math.min(delay, MAX_TIMER_CHUNK_MS));
    this.tokenTimer.unref?.();
  }
}
