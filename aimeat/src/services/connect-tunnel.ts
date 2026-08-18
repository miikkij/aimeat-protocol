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
import { logger } from '../utils/logger.js';
import {
  onDeliveryEvent, offDeliveryEvent, type DeliveryEvent,
  onMemoryWrittenEvent, offMemoryWrittenEvent, type MemoryWriteEvent,
} from './event-bus.js';
import { canReadWorkspace } from './workspace-access.js';
import { resolveIdentity } from '../utils/gaii.js';

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
    | 'subscribe'      // C→S: subscribe to workspace record events for one or more (organism, ws, space)
    | 'subscribed'     // S→C: subscribe ack — which space refs were accepted vs rejected
    | 'auth_revoked'   // S→C: the connected principal's bearer was revoked — stop + re-auth
    | 'backlog'        // S→C: on-connect snapshot of queued+active tasks + pending messages
    | 'disconnect'
    | 'error';
  /** Correlation id (request↔response, heartbeat↔ack, deliver↔ack, invoke↔invoke_result, subscribe↔subscribed). */
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
  // ── subscribe (C→S) ──
  spaces?: WorkspaceSpaceRef[];  // the (organism_id, ws, space) tuples to subscribe to
  // ── error (S→C) ──
  code?: string;
  message?: string;
  timestamp?: string;
}

/** One workspace records-space an agent can subscribe to for record-write push. */
export interface WorkspaceSpaceRef {
  organism_id: string;
  ws: string;
  /** The key segment for the records space (the manifest objectType's `namespace`), e.g. 'task'. */
  space: string;
}

interface ParsedRecordKey { organismId: string; ws: string; rest: string }

/**
 * Parse a workspace record memory key `organism.{orgId}.w.{ws}.{rest}` into (orgId, ws, rest), or null
 * if it is not a workspace-scoped key (legacy `organism.{id}.…` roots without `.w.{ws}.`, or any
 * non-organism key). `orgId` and `ws` carry no dots so positional split is safe; `rest` is
 * `{namespace}.{instanceId}[.role]` and is matched by PREFIX against a subscription's space
 * (the manifest objectType namespace can be multi-segment, e.g. `shared.tasks`).
 */
function parseWorkspaceRecordKey(key: string): ParsedRecordKey | null {
  const seg = key.split('.');
  if (seg.length < 6 || seg[0] !== 'organism' || seg[2] !== 'w') return null;
  const organismId = seg[1], ws = seg[3];
  if (!organismId || !ws) return null;
  return { organismId, ws, rest: seg.slice(4).join('.') };
}

/** Stable composite key for the (organism, ws, space) subscription index. Ids carry no '|'. */
function spaceKeyOf(organismId: string, ws: string, space: string): string {
  return `${organismId}|${ws}|${space}`;
}

/** Validate one subscribe-frame entry into a WorkspaceSpaceRef, or null if malformed. */
function coerceSpaceRef(raw: unknown): WorkspaceSpaceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const organism_id = typeof r.organism_id === 'string' ? r.organism_id : '';
  const ws = typeof r.ws === 'string' ? r.ws : '';
  const space = typeof r.space === 'string' ? r.space : '';
  if (!organism_id || !ws || !space) return null;
  return { organism_id, ws, space };
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
      try { existing.ws.close(1000, 'replaced'); } catch (err) { logger.warn('handleConnection: ignore', { error: String(err) }); }
      this.connections.delete(principal);
    }
    // Fresh session → fresh in-session dedup state (the replaced socket's close
    // handler won't clear it, since the registered ws is now the new one).
    this.ackedDeliveries.delete(principal);
    // Subscriptions are per-socket — drop the replaced session's; the new socket re-subscribes.
    this.clearSubscriptions(principal);

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
        this.clearSubscriptions(principal);      // per-socket subscriptions die with the socket
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
      // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
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
    this.send(conn.ws, { type: 'subscribed', id: frame.id, payload: { accepted, rejected }, timestamp: new Date().toISOString() });
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

  /**
   * Fan a memory write out as a `workspace.record` wake to every online subscriber of its space.
   * Only published/committed state triggers a contract agent: a bare write or `.latest` (drafts are
   * working copies, `.version.N` is history — neither is a contract trigger). The payload is a
   * lightweight envelope (coordinates + op + ts, NO record value): the agent does its own authorized
   * read for content. Access is RE-validated here so a mid-session consent revocation stops delivery
   * immediately (a stale subscription is dropped on the spot). The deliver `id` is unique per write so
   * each update is its own wake (never suppressed by the in-session ack dedup).
   */
  private async onMemoryWrite(evt: MemoryWriteEvent): Promise<void> {
    // P3: a cancel marker write (`agents.cancel.task.<id>` / `agents.cancel.run.<run>`, value = task
    // id list) → push `task.cancelled` to each affected agent's socket, so daemons stop polling the
    // owner-scoped `agents.cancel.*` memory before every dispatch. Handled before the subscriber gate.
    if (evt.key.startsWith('agents.cancel.')) { await this.pushTaskCancellations(evt.ownerGaii, evt.key); return; }

    if (this.spaceSubscribers.size === 0) return;  // no subscribers anywhere — cheapest exit
    const parsed = parseWorkspaceRecordKey(evt.key);
    if (!parsed) return;
    const op = evt.op ?? 'updated';
    const ts = new Date(evt.timestamp).toISOString();
    // The space (namespace) can be multi-segment, so match by prefix against each subscription in
    // this (organism, ws) rather than positional split. Subscriptions are few, so this stays cheap.
    const wsPrefix = `${spaceKeyOf(parsed.organismId, parsed.ws, '')}`;  // "orgId|ws|"
    for (const [sk, subs] of this.spaceSubscribers) {
      if (!sk.startsWith(wsPrefix) || subs.size === 0) continue;
      const namespace = sk.slice(wsPrefix.length);
      if (!(parsed.rest === namespace || parsed.rest.startsWith(`${namespace}.`))) continue;
      const tail = parsed.rest === namespace ? '' : parsed.rest.slice(namespace.length + 1);
      if (tail === '') continue;  // a write to the space root itself — no instance, not a record
      const parts = tail.split('.');
      const instanceId = parts[0];
      const role = parts.slice(1).join('.');
      if (role !== '' && role !== 'latest') continue;  // skip drafts + version history
      for (const principal of [...subs]) {
        const conn = this.connections.get(principal);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) continue;
        const allowed = await this.canPrincipalReadSpace(conn, parsed.organismId, parsed.ws);
        if (!allowed) { this.clearSubscriptionFor(principal, sk); continue; }
        this.stats.deliveriesTotal++;
        this.send(conn.ws, {
          type: 'deliver',
          id: `${sk}/${instanceId}#${evt.timestamp}`,
          kind: 'workspace.record',
          payload: {
            type: 'workspace.record',
            organism_id: parsed.organismId, ws: parsed.ws, space: namespace,
            id: instanceId, op, ts,
          },
        });
      }
    }
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
        this.storage.listPendingMessages(principal).catch(err => { logger.warn('resolve: continuing after a suppressed failure', { error: String(err) }); return []; }),
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

  /**
   * P2: a bearer was revoked — if its socket is live, tell the principal to stop + re-auth, then
   * close. The forward bearer IS this token, so leaving the socket open would just 401 every forward
   * call (silent breakage); pushing `auth_revoked` lets the client surface re-auth guidance at once
   * and removes the client's periodic auth-liveness probe. Matched by the pinned rawToken.
   */
  onTokenRevoked(rawToken: string): void {
    for (const conn of this.connections.values()) {
      if (conn.rawToken !== rawToken) continue;
      this.send(conn.ws, { type: 'auth_revoked', message: 'Token revoked', timestamp: new Date().toISOString() });
      try { conn.ws.close(1000, 'auth_revoked'); } catch (err) { logger.warn('onTokenRevoked: ignore', { error: String(err) }); }
      break;  // single-socket-per-principal — at most one match
    }
  }

  /**
   * P3: resolve a cancel marker (its value is a list of task ids) to the owning agents and push a
   * `task.cancelled` wake to each online one. The agent records it locally and skips dispatch — no
   * more per-dispatch `agents.cancel.*` memory scan. Best-effort; a missed push is caught by the
   * agent's cheap single-task status re-check.
   */
  private async pushTaskCancellations(ownerGaii: string, key: string): Promise<void> {
    try {
      const rec = await this.storage.getMemory(ownerGaii, key);
      const ids = Array.isArray(rec?.value) ? (rec!.value as unknown[]).map(String) : [];
      for (const taskId of ids) {
        const task = await this.storage.getAgentTask(taskId);
        if (!task) continue;
        const conn = this.connections.get(task.agentGaii);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) continue;
        this.stats.deliveriesTotal++;
        this.send(conn.ws, { type: 'deliver', id: `cancel/${taskId}`, kind: 'task.cancelled', payload: { type: 'task.cancelled', id: taskId } });
      }
    } catch (err) {
      logger.warn('Connect tunnel cancel push failed', { event: 'connect_tunnel.error', key, error: err instanceof Error ? err.message : String(err) });
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
