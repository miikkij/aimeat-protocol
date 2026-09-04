/**
 * @file tunnel-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-09-05 — A frame for an identity this socket no longer holds goes NOWHERE. `handlersFor`
 *     fell back to the opener's handlers for any name not in the map, and the 401 eviction removed a
 *     name from the map without telling the node, which kept pushing — so an evicted agent's next
 *     task was filed on the opener's channel, queued under the wrong agent, run, and acked as
 *     received. Two owners on one daemon share a socket, so that crossed an ownership boundary. The
 *     client now knows its own gaii (`opts.gaii`), drops a frame for a name it does not hold, sends
 *     `detach` on eviction, and no longer stops the whole client on a straggling 401 for an
 *     already-evicted name. Found by an adversarial review, verified link by link.
 *   2026-09-04 — "No stored token" is no longer said about an agent whose key is fine. A credential
 *     that could not be MINTED right now throws (agent-key.ts `MintFailedError`) where a missing
 *     one still answers null, so a busy node degrades an agent to direct HTTP and retries instead
 *     of stopping it for good with a remedy that would re-enrol a healthy agent. Measured on a
 *     live 62-identity fleet: the mint budget ran out during the joining burst, twenty-two agents
 *     printed the wrong cause, and none came back without a restart. Types and constants moved to
 *     tunnel-client-types.ts in the same commit (pure extraction, 800-line limit), re-exported here.
 *   2026-09-03 — A refused `attach` is an ANSWER. The `error` frame carrying it resolves the
 *     promise waiting on its id instead of letting it sit out the request timeout, and the identity
 *     comes off a socket it never got on. Found on a real 50-agent fleet: sixteen expired
 *     credentials, each recorded as a passenger before the node had judged it and never removed,
 *     held a 30s timer apiece and were re-attempted on every reconnect — 24 log lines accusing
 *     agents that were up of failing to re-attach. The fence held; the log did not.
 *   2026-09-03 — Carries several identities on one socket: `attachIdentity` proves each one's own
 *     credential, inbound frames route on `agent`, and a 401 or `auth_revoked` for an attached
 *     identity stops that one rather than the connection eleven others use. Attachments are
 *     re-sent after a reconnect, like subscriptions. Falls back to one socket per agent against a
 *     node whose `welcome` does not say `multiplex`.
 *   v1.0.0 — 2026-06-10 — Phase 3: initial tunnel client (forward correlation,
 *     heartbeat + dead-conn detection, reconnect backoff, deliver/backlog,
 *     proactive pre-expiry token reconnect, auth-failure stop).
 *   v1.1.0 — 2026-06-22 — P1 record push: subscribe() sends a `subscribe` frame; onConnect fires
 *     after each (re)connect so the serve daemon re-subscribes (per-socket subscriptions) and the
 *     consumer catches up; `subscribed` ack logged. workspace.record delivers ride the existing
 *     onDeliver path (auto-acked like any deliver).
 *   v1.2.0 — 2026-08-28 — Server-initiated `invoke`: the frame the node sends when it wants THIS
 *     principal to run something (Crew tab: validate or try a crew definition) is handed to
 *     `onInvoke`, answered with `replyInvoke()`, and refused at once as UNSUPPORTED when the
 *     consumer registered no handler — the node must not wait a full timeout on a client that
 *     cannot answer.
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { getInstallId } from './install-id.js';

import type {
  ConnectTunnelClientOptions, ForwardOptions, ForwardResult, PendingForward,
  TunnelFrame, TunnelIdentity, TunnelStartOutcome, TunnelStatus,
} from './tunnel-client-types.js';
import {
  ATTACH_REFUSAL_CODES, MAX_TIMER_CHUNK_MS, RE_AUTH_GUIDANCE, TOKEN_DEAD_CODES, wsUrl,
} from './tunnel-client-types.js';

// Re-exported, not relocated. Every one of these was imported FROM this file before the split, so
// carrying the names here is what makes the extraction a move rather than a change to N callers.
export type {
  ConnectTunnelClientOptions, ForwardOptions, ForwardResult,
  TunnelIdentity, TunnelStartOutcome, TunnelStatus,
};

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
  /**
   * The identities attached to this socket, beyond the one that opened it.
   *
   * Keyed by GAII, which is the only thing that tells two owners' `concierge` apart. The socket's
   * OWN identity is not in here: its handlers are `this.opts`, and a frame with no `agent` field
   * belongs to it — which is exactly how a node older than 2026-09-03 keeps working, since it
   * never stamps one.
   */
  private identities = new Map<string, TunnelIdentity>();
  /** In-flight `attach` frames, correlated by id like everything else on this wire. */
  private pendingAttach = new Map<string, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
  /** Does this node speak `attach`? Read from the `welcome` frame; false means one socket per agent,
   *  as before, and the hub falls back to that without anyone asking. */
  private multiplex = false;
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

  /** Does this node carry several identities on one socket? False against a node older than
   *  2026-09-03, and the hub then opens one socket per agent exactly as before. */
  supportsMultiplex(): boolean { return this.multiplex; }

  /**
   * Put one more identity on this socket.
   *
   * Sends `attach` with that identity's OWN credential — the node verifies it exactly as it
   * verifies an upgrade, so riding a socket someone else opened grants nothing. Resolves true when
   * the node accepts. Called again after every reconnect, because a socket's attachments die with
   * the socket.
   *
   * THE MAP IS WHO IS ON THE SOCKET, so a refused identity does not stay in it. It used to be
   * written before the node had judged the credential — refuse before you write, invariant 14, in
   * the connector — and nothing removed it when the answer came back no. Measured on a real fleet
   * on 2026-09-03: sixteen expired credentials, each recorded as a passenger it had never been,
   * re-attempted on every reconnect and logged 24 `could not re-attach` lines naming agents that
   * were up. Nothing was actually knocked off — the fence held — but the log said otherwise, and a
   * log that accuses the wrong thing costs someone an afternoon.
   */
  async attachIdentity(identity: TunnelIdentity): Promise<boolean> {
    this.identities.set(identity.gaii, identity);
    const ok = await this.sendAttach(identity);
    if (!ok) this.identities.delete(identity.gaii);
    return ok;
  }

  private async sendAttach(identity: TunnelIdentity): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.multiplex) return false;
    // THIS IS WHERE THE BUDGET ACTUALLY RUNS OUT. Sixty-two identities joining one socket is
    // sixty-two mints inside a few seconds, so the node's per-minute limit is reached here before
    // it is reached anywhere else. Answering false leaves this identity off the shared socket and
    // the caller opens it a private one, which retries with backoff instead of stopping.
    let token: string | null;
    try {
      token = await identity.getToken();
    } catch (err) {
      console.error(`[${this.label}] ${identity.gaii}: no credential right now (${String(err)}) — not joining the shared socket yet`);
      return false;
    }
    if (!token) return false;
    const id = randomUUID();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.pendingAttach.delete(id); resolve(false); }, this.opts.requestTimeoutMs);
      this.pendingAttach.set(id, { resolve, timer });
      try { this.ws!.send(JSON.stringify({ type: 'attach', id, agent: identity.gaii, token })); }
      catch (err) {
        console.error(`[${this.label}] ${identity.gaii}: attach send failed: ${(err as Error).message}`);
        clearTimeout(timer); this.pendingAttach.delete(id); resolve(false);
      }
    });
  }

  /**
   * Take one identity off this socket. The socket stays up for everyone else — which is the whole
   * point of the fence, and is also what makes replacing a refused credential a local event.
   */
  detachIdentity(gaii: string): void {
    this.identities.delete(gaii);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ type: 'detach', agent: gaii })); }
    catch (err) { console.error(`[${this.label}] detach send failed: ${(err as Error).message}`); }
  }

  /** How many identities ride this socket, the socket's own included. For /local/status. */
  identityCount(): number { return this.identities.size + 1; }

  /**
   * Send a forward `request` frame and resolve on the correlated `response`.
   * Resolves a synthetic 504 envelope if no response arrives within the
   * (welcome-advertised) request timeout. Rejects only when the tunnel is not
   * connected at call time.
   */
  forward(method: string, path: string, opts: ForwardOptions = {}, agent?: string): Promise<ForwardResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') {
      return Promise.reject(new Error('Tunnel not connected'));
    }
    const id = randomUUID();
    // `agent` names WHOSE call this is. Omitted for the socket's own identity, which is every call
    // a single-agent client makes and every call against a node that does not multiplex.
    const frame: TunnelFrame = { type: 'request', id, agent, method, path, query: opts.query, headers: opts.headers, body: opts.body };
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
  subscribe(spaces: Array<{ organism_id: string; ws: string; space: string }>, agent?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return;
    if (!spaces.length) return;
    try { this.ws.send(JSON.stringify({ type: 'subscribe', id: randomUUID(), agent, spaces })); }
    catch (err) { console.error(`[${this.label}] subscribe send failed: ${(err as Error).message}`); }
  }

  /**
   * Answer a server-initiated `invoke` by correlation id. Best-effort: with the socket gone the
   * node has already timed the call out on its side, so there is nothing left to tell it.
   */
  replyInvoke(id: string, ok: boolean, result: unknown, agent?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ type: 'invoke_result', id, agent, ok, result })); }
    catch (err) { console.error(`[${this.label}] invoke_result send failed: ${(err as Error).message}`); }
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
      try { ws.send(JSON.stringify({ type: 'disconnect', id: randomUUID(), timestamp: new Date().toISOString() })); } catch (err) { logger.warn('close: ignore', { error: String(err) }); }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), 1_000);
        ws.once('close', () => { clearTimeout(t); resolve(); });
        // eslint-disable-next-line aimeat/no-silent-catch -- closing a socket that is already being discarded; the catch completes the same teardown the success path does
        try { ws.close(1000, 'client_close'); } catch { clearTimeout(t); resolve(); }
      });
    }
  }

  /* ───────── internals ───────── */

  private setStatus(s: TunnelStatus): void {
    if (this.status === s) return;
    this.status = s;
    try { this.opts.onStatusChange?.(s); } catch (err) { logger.warn('close: listener error — ignore', { error: String(err) }); }
  }

  /** Stop permanently: no reconnects, timers cleared, pendings rejected. */
  private stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.rejectPending();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(1000, 'stopped'); } catch (err) { logger.warn('close: ignore', { error: String(err) }); }
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
    try { this.opts.onAuthFailure?.(message); } catch (err) { logger.warn('close: listener error — ignore', { error: String(err) }); }
  }

  /**
   * One connection attempt. Re-reads the token from the keychain, opens the
   * socket with `Authorization: Bearer` (server-preferred), and resolves on
   * welcome (or classifies the failure).
   */
  private async connectOnce(): Promise<TunnelStartOutcome> {
    if (this.stopped) return this.authFailed ? 'auth_failed' : 'unreachable';
    this.setStatus('connecting');

    // TWO WAYS TO HAVE NO TOKEN IN HAND, AND ONLY ONE OF THEM IS THIS AGENT'S FAULT. A key-holder
    // that could not mint right now throws; there is nothing wrong with it and the next attempt
    // will very likely work, so this is the same case as a node that did not answer. Answering
    // null means there is genuinely no credential, which no amount of retrying fixes.
    //
    // They were one value until 2026-09-04, and the cost was measured on a live fleet: the node's
    // mint budget ran out, twenty-two agents printed "Stopped: No stored token. Run: aimeat
    // connect" while holding perfectly good keys, and not one of them tried again — the message
    // named the wrong cause AND the wrong remedy, and `authFailure` is terminal by design.
    let token: string | null;
    try {
      token = await this.opts.getToken();
    } catch (err) {
      // Not `authFailure`: that one stops for good, and this is a wait.
      console.error(`[${this.label}] No credential right now (${String(err)}). Retrying.`);
      this.setStatus('offline');
      return 'unreachable';
    }
    if (!token) {
      this.authFailure('No stored token');
      return 'auth_failed';
    }

    return new Promise<TunnelStartOutcome>((resolve) => {
      let settled = false;
      const settle = (o: TunnelStartOutcome) => { if (!settled) { settled = true; resolve(o); } };

      let ws: WebSocket;
      try {
        // The install id says WHICH MACHINE this socket is on, so an owner running two daemons
        // is two daemons to the node rather than one ambiguous answer. Not a credential: the
        // token beside it is still what authenticates.
        ws = new WebSocket(this.opts.wsUrl ?? wsUrl(this.opts.nodeUrl), {
          headers: { Authorization: `Bearer ${token}`, 'X-AIMEAT-Install': getInstallId() },
        });
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
        try { ws.terminate(); } catch (err) { logger.warn('settle: ignore', { error: String(err) }); }
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
    // Does this node carry several identities on one socket? Absent on a node older than
    // 2026-09-03, which is exactly the fallback signal: the hub then opens one socket per agent.
    this.multiplex = p.multiplex === true;

    this.connectCount++;
    this.reconnectAttempts = 0;
    this.lastHeartbeatAck = Date.now();
    this.setStatus('online');
    this.startHeartbeat();
    this.scheduleTokenRefresh();
    // Subscriptions are per-socket on the server — re-send them now, then let the consumer catch up.
    try { this.opts.onConnect?.(this.connectCount); } catch (err) { console.error(`[${this.label}] onConnect handler error: ${(err as Error).message}`); }

    // ATTACHMENTS DIE WITH THE SOCKET, like subscriptions, and for the same reason: the node holds
    // them against a connection. Re-sent here so a reconnect restores every identity without the
    // hub having to watch for one — each with its own freshly resolved credential.
    for (const identity of [...this.identities.values()]) {
      void this.sendAttach(identity).then(ok => {
        if (!ok) { console.error(`[${this.label}] ${identity.gaii}: could not re-attach after reconnect`); return; }
        try { identity.onConnect?.(this.connectCount); }
        catch (err) { console.error(`[${this.label}] onConnect handler error: ${(err as Error).message}`); }
      });
    }
  }

  /**
   * Whose handlers a frame belongs to.
   *
   * `agent` names the identity on a shared socket; absent — or naming the socket's own identity —
   * means this client's own `opts`. A node older than 2026-09-03 stamps nothing, so every frame
   * lands on `opts` and the multiplex path is simply never taken.
   */
  /**
   * Whose handlers a frame goes to, or NULL when it names an identity this socket no longer holds.
   *
   * IT USED TO FALL BACK TO THE OPENER. `(identities.get(gaii)) || this.opts` cannot tell "this
   * frame names the socket's own identity" from "this frame names one I evicted": both miss the map
   * and both landed on `this.opts`, the handlers of whoever opened the socket. The node stamps
   * every outbound frame with the principal it is for and keeps pushing until told to detach, so
   * after an attached agent's credential died, its next task arrived here stamped with its name,
   * missed the map, and was filed on the OPENER's channel — queued for `/local/tasks/next` under
   * the wrong agent, its runner launched, and the auto-ack telling the node the right agent had it.
   * With two owners on one daemon that is a task crossing an ownership boundary. Found by an
   * adversarial review on 2026-09-05, verified link by link.
   *
   * THE THREE CASES, in order. A frame with no `agent` is a legacy node's and is the socket's own.
   * A frame naming my own gaii is mine. A frame naming an attached identity is that identity's.
   * Anything else names an identity this socket does not hold, and the only correct thing to do
   * with it is nothing: dropped, logged, never handed to somebody else's handlers.
   */
  private handlersFor(frame: TunnelFrame): Pick<ConnectTunnelClientOptions, 'onDeliver' | 'onInvoke' | 'onBacklog' | 'onAuthFailure'> | null {
    const gaii = typeof frame.agent === 'string' ? frame.agent : '';
    if (!gaii) return this.opts;
    if (this.opts.gaii && gaii === this.opts.gaii) return this.opts;
    const attached = this.identities.get(gaii);
    if (attached) return attached;
    // A client built without its own gaii cannot distinguish the second case from the fourth, so it
    // keeps the old behaviour for the socket's own frames — which is every frame from a node that
    // never learnt to stamp. The hub and the private socket both set it, so this is the legacy path.
    if (!this.opts.gaii) return this.opts;
    console.error(`[${this.label}] frame for ${gaii}, which this socket does not hold — dropped, not delivered to somebody else`);
    return null;
  }

  private handleFrame(frame: TunnelFrame): void {
    const h = this.handlersFor(frame);
    switch (frame.type) {
      case 'attached': {
        const p = frame.id ? this.pendingAttach.get(frame.id) : undefined;
        if (p && frame.id) { clearTimeout(p.timer); this.pendingAttach.delete(frame.id); p.resolve(true); }
        break;
      }
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
          // Same fence as auth_revoked: a 401 is a verdict on ONE identity's credential, so on a
          // shared socket it stops that identity rather than the connection eleven others use.
          const who = typeof frame.agent === 'string' ? frame.agent : '';
          const att = who ? this.identities.get(who) : undefined;
          const msg = `Forwarded request returned ${frame.status} ${errCode || 'UNAUTHORIZED'}`;
          if (att) {
            // detachIdentity, NOT identities.delete. Deleting only here left the NODE holding the
            // principal on this socket and pushing its deliveries down it, stamped with a name
            // this client no longer knew — and those frames fell back onto the opener's handlers.
            // A detach frame tells the node to stop, which is the half that was missing.
            this.detachIdentity(who);
            try { att.onAuthFailure?.(msg); } catch (err) { console.error(`[${this.label}] onAuthFailure handler error: ${(err as Error).message}`); }
          } else if (who && this.opts.gaii && who !== this.opts.gaii) {
            // A 401 for an identity this socket does not hold — a straggler for one already
            // evicted, racing the detach. Before this it took the branch below and STOPPED THE
            // WHOLE CLIENT, dropping every other identity on the socket for a credential none of
            // them presented. Logged and ignored: the identity is already gone.
            console.error(`[${this.label}] ${who}: ${msg} — not on this socket, ignored`);
          } else {
            this.authFailure(msg);
          }
        }
        break;
      }
      case 'deliver': {
        // Not held here: no handler, and NO ACK. An ack tells the node the named agent received
        // this, and it did not — acking a frame we dropped would have the node mark a task as
        // delivered to an agent that never saw it, which is worse than the node retrying.
        if (!h) break;
        const id = frame.id ?? '';
        try { h.onDeliver?.(frame.kind ?? '', frame.payload, id); }
        catch (err) { console.error(`[${this.label}] onDeliver handler error: ${(err as Error).message}`); }
        if (id && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ack', id, agent: frame.agent }));
        }
        break;
      }
      case 'invoke': {
        const id = frame.id ?? '';
        const capability = frame.capability ?? '';
        if (!id) break;
        // Not held here: dropped, and NOT answered. Replying UNSUPPORTED would be answering in the
        // name of an identity this socket evicted — the exact thing the null exists to stop. The
        // node's timeout is the node's; the detach already told it this identity is gone.
        if (!h) break;
        if (!h.onInvoke) {
          this.replyInvoke(id, false, { code: 'UNSUPPORTED', message: `This client does not answer "${capability}" calls.` });
          break;
        }
        try { h.onInvoke({ id, capability, input: frame.input, caller: frame.caller, timeout_ms: frame.timeout_ms }); }
        catch (err) {
          console.error(`[${this.label}] onInvoke handler error: ${(err as Error).message}`);
          this.replyInvoke(id, false, { code: 'HANDLER_ERROR', message: (err as Error).message });
        }
        break;
      }
      case 'backlog': {
        // A backlog for an identity this socket does not hold is somebody else's queue. Dropped.
        if (!h) break;
        const p = (frame.payload ?? {}) as { tasks?: unknown[]; messages?: unknown[] };
        try { h.onBacklog?.({ tasks: p.tasks ?? [], messages: p.messages ?? [] }); }
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
        // THE FENCE, CLIENT SIDE. On a socket carrying twelve identities, one revoked credential
        // must stop that one and leave the other eleven running. `agent` says whose: an attached
        // identity is dropped on its own, and only a revocation of the socket's OWN credential
        // stops the whole client — which is what it always did, and is still right, because that
        // is the credential the connection itself stands on.
        const revoked = typeof frame.agent === 'string' ? frame.agent : '';
        const attached = revoked ? this.identities.get(revoked) : undefined;
        if (attached) {
          this.identities.delete(revoked);
          try { attached.onAuthFailure?.(frame.message ?? 'Token revoked by server'); }
          catch (err) { console.error(`[${this.label}] onAuthFailure handler error: ${(err as Error).message}`); }
          break;
        }
        // Server revoked the pinned bearer — stop + surface re-auth guidance (same path as a
        // forwarded 401). Removes the client's periodic auth-liveness probe.
        this.authFailure(frame.message ?? 'Token revoked by server');
        break;
      }
      case 'error': {
        console.error(`[${this.label}] Server error frame: ${frame.code ?? ''} ${frame.message ?? ''}`);
        // AN ANSWER IS AN ANSWER, INCLUDING NO. A refused `attach` comes back as this frame,
        // carrying the id it refuses, and this case used to log and walk away — so the promise
        // waiting on that id sat until the request timeout, holding a timer, for every refused
        // credential, on every reconnect. Sixteen dead tokens on one real fleet meant sixteen of
        // them at a time (2026-09-03).
        const pa = frame.id ? this.pendingAttach.get(frame.id) : undefined;
        if (pa && frame.id) { clearTimeout(pa.timer); this.pendingAttach.delete(frame.id); pa.resolve(false); }
        // The node judging a credential is the same verdict a forwarded 401 carries, so it takes
        // the same fence: it stops THAT identity and tells its owner, and the connection the other
        // forty-eight are riding does not notice.
        if (ATTACH_REFUSAL_CODES.has(frame.code ?? '')) {
          const who = typeof frame.agent === 'string' ? frame.agent : '';
          const att = who ? this.identities.get(who) : undefined;
          if (att) {
            this.identities.delete(who);
            try { att.onAuthFailure?.(`Attach refused: ${frame.code} ${frame.message ?? ''}`.trim()); }
            catch (err) { console.error(`[${this.label}] onAuthFailure handler error: ${(err as Error).message}`); }
          }
        }
        break;
      }
      case 'disconnect': {
        try { this.ws?.close(1000, 'server_disconnect'); } catch (err) { logger.warn('p: ignore', { error: String(err) }); }
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
        try { this.ws.terminate(); } catch (err) { logger.warn('p: ignore', { error: String(err) }); }
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
      try { this.ws?.terminate(); } catch (err) { logger.warn('p: ignore', { error: String(err) }); }
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
