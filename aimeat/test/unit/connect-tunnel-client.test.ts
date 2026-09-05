/**
 * @file connect-tunnel-client.test.ts
 * @description Unit tests for the connector-side ConnectTunnelClient
 *   (src/cli/connect/tunnel-client.ts) against a mock `ws` server. Covers:
 *   welcome adoption, request/response correlation (out-of-order), request
 *   timeout → synthetic 504, heartbeat liveness + dead-socket reconnect,
 *   deliver→ack, backlog emit, reconnect after server drop, upgrade 401/404
 *   classification, forwarded-401 stop, proactive pre-expiry token reconnect,
 *   and the no-hot-loop guarantee on auth failure.
 * @version-history
 *   v1.2.0 — 2026-09-04 — A mint that failed is a wait, not a dead agent: `start()` degrades rather
 *     than stopping, nobody is told to re-run `aimeat connect` about a key that is fine, and one
 *     refused mint keeps its identity off the shared socket without taking the socket down.
 *   v1.1.0 — 2026-09-03 — A refused `attach`: it answers rather than sitting out the request
 *     timeout, the identity does not stay on a socket it never got on, and the refusal reaches
 *     that one identity while the socket carries on.
 *   v1.0.0 — 2026-06-10 — Phase 3: initial coverage.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket as ServerWebSocket } from 'ws';
import { ConnectTunnelClient, type TunnelStartOutcome } from '../../src/cli/connect/tunnel-client.js';

interface MockFrame {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  body?: unknown;
  status?: number;
  kind?: string;
  payload?: unknown;
  [k: string]: unknown;
}

interface MockServerOptions {
  /** Reject every upgrade with this HTTP status (no WS established). */
  rejectUpgrade?: number;
  /** Destroy the upgrade socket without any HTTP response (tunnel disabled). */
  destroyUpgrade?: boolean;
  /** Merged over the default welcome payload (function = evaluated per connection). */
  welcome?: Record<string, unknown> | (() => Record<string, unknown>);
  /** Ack heartbeats (default true). */
  ackHeartbeats?: boolean;
  /** Close the socket right after sending welcome (drop test). */
  closeAfterWelcome?: boolean;
  /** Custom handler for request frames; default echoes a 200. */
  onRequest?: (frame: MockFrame, ws: ServerWebSocket) => void;
  /**
   * How the node answers `attach`. Default accepts. Return a code to refuse with, exactly as
   * services/connect-tunnel.ts does: an `error` frame carrying the id and the agent it refuses.
   */
  refuseAttach?: (frame: MockFrame) => string | null;
}

class MockTunnelServer {
  http!: Server;
  wss!: WebSocketServer;
  port = 0;
  upgradeAttempts = 0;
  /** Auth header seen per upgrade attempt. */
  authHeaders: Array<string | undefined> = [];
  sockets: ServerWebSocket[] = [];
  /** All frames received, across all sockets, in order. */
  received: MockFrame[] = [];

  constructor(private opts: MockServerOptions = {}) {}

  get url(): string { return `http://127.0.0.1:${this.port}`; }

  async start(): Promise<void> {
    this.http = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      this.upgradeAttempts++;
      this.authHeaders.push(req.headers.authorization);
      if (this.opts.rejectUpgrade) {
        const text = this.opts.rejectUpgrade === 401 ? 'Unauthorized' : this.opts.rejectUpgrade === 403 ? 'Forbidden' : 'Not Found';
        socket.write(`HTTP/1.1 ${this.opts.rejectUpgrade} ${text}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
      if (this.opts.destroyUpgrade) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.handleSocket(ws));
    });
    await new Promise<void>((resolve) => this.http.listen(0, '127.0.0.1', resolve));
    this.port = (this.http.address() as { port: number }).port;
  }

  private handleSocket(ws: ServerWebSocket): void {
    this.sockets.push(ws);
    const overrides = typeof this.opts.welcome === 'function' ? this.opts.welcome() : this.opts.welcome;
    ws.send(JSON.stringify({
      type: 'welcome',
      id: 'w1',
      payload: {
        protocol_version: '1.0',
        heartbeat_interval_ms: 30_000,
        offline_threshold_ms: 90_000,
        request_timeout_ms: 30_000,
        reconnect_hint: { strategy: 'exponential_backoff', base_ms: 20, max_ms: 100, jitter: false },
        ...overrides,
      },
    }));
    if (this.opts.closeAfterWelcome) {
      setTimeout(() => { try { ws.close(1000, 'mock_drop'); } catch { /* ignore */ } }, 20);
    }
    ws.on('message', (data) => {
      let frame: MockFrame;
      try { frame = JSON.parse(data.toString()); } catch { return; }
      this.received.push(frame);
      if (frame.type === 'heartbeat' && (this.opts.ackHeartbeats ?? true)) {
        ws.send(JSON.stringify({ type: 'heartbeat_ack', id: frame.id }));
      }
      if (frame.type === 'request') {
        if (this.opts.onRequest) this.opts.onRequest(frame, ws);
        else ws.send(JSON.stringify({ type: 'response', id: frame.id, status: 200, body: { ok: true, echo: frame.path } }));
      }
      if (frame.type === 'attach') {
        const code = this.opts.refuseAttach?.(frame) ?? null;
        if (code) ws.send(JSON.stringify({ type: 'error', id: frame.id, agent: frame.agent, code, message: 'That credential did not verify.' }));
        else ws.send(JSON.stringify({ type: 'attached', id: frame.id, agent: frame.agent }));
      }
    });
  }

  send(frame: MockFrame, socketIndex = -1): void {
    const ws = socketIndex >= 0 ? this.sockets[socketIndex] : this.sockets[this.sockets.length - 1];
    ws.send(JSON.stringify(frame));
  }

  framesOfType(type: string): MockFrame[] { return this.received.filter(f => f.type === type); }

  async stop(): Promise<void> {
    for (const ws of this.sockets) { try { ws.terminate(); } catch { /* ignore */ } }
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(cond: () => boolean, timeoutMs = 2_000, stepMs = 10): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await sleep(stepMs);
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function makeClient(server: MockTunnelServer, overrides: Partial<ConstructorParameters<typeof ConnectTunnelClient>[0]> = {}): { client: ConnectTunnelClient; tokenCalls: () => number } {
  let calls = 0;
  const client = new ConnectTunnelClient({
    nodeUrl: server.url,
    getToken: async () => { calls++; return `tok-${calls}`; },
    reconnectBaseMs: 20,
    reconnectMaxMs: 100,
    reconnectJitter: false,
    ...overrides,
  });
  cleanups.push(() => client.close());
  return { client, tokenCalls: () => calls };
}

async function startServer(opts: MockServerOptions = {}): Promise<MockTunnelServer> {
  const server = new MockTunnelServer(opts);
  await server.start();
  cleanups.push(() => server.stop());
  return server;
}

describe('ConnectTunnelClient', () => {
  it('connects with a Bearer header, parses welcome, adopts server config', async () => {
    const server = await startServer({ welcome: { heartbeat_interval_ms: 12_345, request_timeout_ms: 7_000, token_expires_at: 1234567890 } });
    const { client, tokenCalls } = makeClient(server);
    const outcome = await client.start();
    expect(outcome).toBe('online');
    expect(client.isOnline()).toBe(true);
    expect(client.getConnectCount()).toBe(1);
    expect(tokenCalls()).toBe(1);
    expect(server.authHeaders[0]).toBe('Bearer tok-1');
    expect(client.getServerConfig()?.heartbeat_interval_ms).toBe(12_345);
    expect(client.getTokenExpiresAt()).toBe(1234567890);
  });

  it('correlates concurrent forwards even when responses arrive out of order', async () => {
    const buffered: Array<{ frame: MockFrame; ws: ServerWebSocket }> = [];
    const server = await startServer({
      onRequest: (frame, ws) => {
        buffered.push({ frame, ws });
        if (buffered.length === 2) {
          // Respond in REVERSE order of arrival.
          for (const { frame: f, ws: w } of [...buffered].reverse()) {
            w.send(JSON.stringify({ type: 'response', id: f.id, status: 200, body: { ok: true, path: f.path } }));
          }
        }
      },
    });
    const { client } = makeClient(server);
    await client.start();
    const [a, b] = await Promise.all([
      client.forward('GET', '/v1/alpha'),
      client.forward('GET', '/v1/beta'),
    ]);
    expect(a.status).toBe(200);
    expect((a.body as { path: string }).path).toBe('/v1/alpha');
    expect((b.body as { path: string }).path).toBe('/v1/beta');
  });

  it('resolves a synthetic 504 when no response arrives within the advertised timeout', async () => {
    const server = await startServer({
      welcome: { request_timeout_ms: 100 },
      onRequest: () => { /* never respond */ },
    });
    const { client } = makeClient(server);
    await client.start();
    const t0 = Date.now();
    const r = await client.forward('GET', '/v1/never');
    expect(r.status).toBe(504);
    expect((r.body as { error: { code: string } }).error.code).toBe('TUNNEL_TIMEOUT');
    // request_timeout_ms(100) + proportional grace(100) ≈ 200ms, not the 30s default
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it('emits onDeliver and acks the deliver id', async () => {
    const server = await startServer();
    const delivered: Array<{ kind: string; payload: unknown; id: string }> = [];
    const { client } = makeClient(server, {
      onDeliver: (kind, payload, id) => delivered.push({ kind, payload, id }),
    });
    await client.start();
    server.send({ type: 'deliver', id: 'task-1', kind: 'task_assigned', payload: { id: 'task-1', title: 'T' } });
    await waitFor(() => delivered.length === 1);
    expect(delivered[0].kind).toBe('task_assigned');
    expect(delivered[0].id).toBe('task-1');
    await waitFor(() => server.framesOfType('ack').length === 1);
    expect(server.framesOfType('ack')[0].id).toBe('task-1');
  });

  it('emits onBacklog with tasks + messages', async () => {
    const server = await startServer();
    const backlogs: Array<{ tasks: unknown[]; messages: unknown[] }> = [];
    const { client } = makeClient(server, { onBacklog: (p) => backlogs.push(p) });
    await client.start();
    server.send({ type: 'backlog', id: 'b1', payload: { tasks: [{ id: 't1' }], messages: [{ id: 'm1' }] } });
    await waitFor(() => backlogs.length === 1);
    expect(backlogs[0].tasks).toHaveLength(1);
    expect(backlogs[0].messages).toHaveLength(1);
  });

  it('sends heartbeats at the advertised interval and stays online while acked', async () => {
    const server = await startServer({ welcome: { heartbeat_interval_ms: 40 } });
    const { client } = makeClient(server);
    await client.start();
    await waitFor(() => server.framesOfType('heartbeat').length >= 3, 2_000);
    expect(client.getConnectCount()).toBe(1);
    expect(client.isOnline()).toBe(true);
  });

  it('detects a dead socket (no heartbeat_ack within ~3× interval) and reconnects', async () => {
    const server = await startServer({ welcome: { heartbeat_interval_ms: 40 }, ackHeartbeats: false });
    const { client } = makeClient(server);
    await client.start();
    expect(client.getConnectCount()).toBe(1);
    // No acks → at ~3×40ms past the welcome the client must terminate + reconnect.
    await waitFor(() => client.getConnectCount() >= 2, 3_000);
    expect(client.isOnline()).toBe(true);
  });

  it('reconnects with backoff after the server drops the connection', async () => {
    const server = await startServer({ closeAfterWelcome: true });
    const { client, tokenCalls } = makeClient(server);
    const outcome = await client.start();
    expect(outcome).toBe('online');
    await waitFor(() => client.getConnectCount() >= 3, 4_000);
    // Token is re-read from the keychain on every (re)connect.
    expect(tokenCalls()).toBeGreaterThanOrEqual(3);
  });

  it('classifies an upgrade 401 as auth failure and does NOT hot-loop', async () => {
    const server = await startServer({ rejectUpgrade: 401 });
    const failures: string[] = [];
    const { client } = makeClient(server, { onAuthFailure: (m) => failures.push(m) });
    const outcome: TunnelStartOutcome = await client.start();
    expect(outcome).toBe('auth_failed');
    expect(failures).toHaveLength(1);
    expect(client.getStatus()).toBe('stopped');
    await sleep(400); // several reconnect-base periods
    expect(server.upgradeAttempts).toBe(1); // no retry against a dead credential
  });

  it('classifies an upgrade 404 as unsupported (degrade signal)', async () => {
    const server = await startServer({ rejectUpgrade: 404 });
    const { client } = makeClient(server);
    expect(await client.start()).toBe('unsupported');
  });

  it('classifies a destroyed upgrade socket (tunnel disabled) as unreachable (degrade signal)', async () => {
    const server = await startServer({ destroyUpgrade: true });
    const { client } = makeClient(server);
    expect(await client.start()).toBe('unreachable');
  });

  it('stops (with guidance) when a forwarded request returns 401 — no reconnect loop', async () => {
    const server = await startServer({
      onRequest: (frame, ws) => {
        ws.send(JSON.stringify({ type: 'response', id: frame.id, status: 401, body: { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } } }));
      },
    });
    const failures: string[] = [];
    const { client } = makeClient(server, { onAuthFailure: (m) => failures.push(m) });
    await client.start();
    const r = await client.forward('GET', '/v1/memory');
    expect(r.status).toBe(401); // the caller still sees the response
    await waitFor(() => failures.length === 1);
    expect(client.getStatus()).toBe('stopped');
    await sleep(300);
    expect(server.upgradeAttempts).toBe(1); // stopped — no hot-loop
  });

  it('does NOT stop on a scope-denial 403 (per-route, not token death)', async () => {
    const server = await startServer({
      onRequest: (frame, ws) => {
        ws.send(JSON.stringify({ type: 'response', id: frame.id, status: 403, body: { ok: false, error: { code: 'SCOPE_DENIED', message: 'nope' } } }));
      },
    });
    const { client } = makeClient(server);
    await client.start();
    const r = await client.forward('POST', '/v1/memory', { body: { k: 'v' } });
    expect(r.status).toBe(403);
    await sleep(100);
    expect(client.isOnline()).toBe(true);
  });

  it('proactively reconnects with a fresh token before token_expires_at', async () => {
    // First connection: token expires in ~2s. Reconnections get a fresh 60s
    // expiry so the client settles online instead of churning.
    let first = true;
    const server = await startServer({
      welcome: () => {
        const exp = first ? 2 : 60;
        first = false;
        return { token_expires_at: Math.floor(Date.now() / 1000) + exp };
      },
    });
    const { client, tokenCalls } = makeClient(server, { tokenRefreshLeadMs: 1_500 });
    await client.start();
    expect(tokenCalls()).toBe(1);
    // expires in ~2s, lead 1.5s → refresh-reconnect due in ~0.5s
    await waitFor(() => client.getConnectCount() >= 2, 4_000);
    expect(tokenCalls()).toBeGreaterThanOrEqual(2);
    expect(server.authHeaders[server.authHeaders.length - 1]).not.toBe('Bearer tok-1');
    expect(client.isOnline()).toBe(true);
  });

  it('sends a graceful disconnect frame on close()', async () => {
    const server = await startServer();
    const { client } = makeClient(server);
    await client.start();
    await client.close();
    await waitFor(() => server.framesOfType('disconnect').length === 1);
    expect(client.getStatus()).toBe('stopped');
  });

  it('rejects forward() when the tunnel is not connected', async () => {
    const server = await startServer();
    const { client } = makeClient(server);
    await client.start();
    await client.close();
    await expect(client.forward('GET', '/v1/memory')).rejects.toThrow(/not connected/i);
  });

  /* ── A refused passenger ──
     Measured on a real fleet on 2026-09-03: sixteen expired credentials on one daemon. Each was
     recorded as riding the shared socket before the node had judged it, and nothing took it back
     off, so every reconnect re-attempted all sixteen and logged them as agents that "could not
     re-attach" — naming agents that were up. Nothing was knocked off, the fence held; the log
     accused the wrong thing and that cost an afternoon. These three pin the three parts. */

  it('does not wait out the request timeout when the node refuses an attach', async () => {
    // The refusal arrives as an `error` frame, and `error` used to log and walk away — so the
    // promise waiting on that id sat for the full 30s request_timeout_ms, once per dead
    // credential, on every reconnect. Sixteen of them at a time on the fleet this was found on.
    const server = await startServer({ welcome: { multiplex: true }, refuseAttach: () => 'ATTACH_UNAUTHORIZED' });
    const { client } = makeClient(server);
    await client.start();
    const began = Date.now();
    const ok = await client.attachIdentity({ gaii: 'ghost#alice@node', getToken: async () => 'dead' });
    expect(ok).toBe(false);
    expect(Date.now() - began).toBeLessThan(1_500);   // request_timeout_ms is 30_000
  });

  it('a refused identity is not left riding the socket, so a reconnect does not retry it', async () => {
    const server = await startServer({ welcome: { multiplex: true }, refuseAttach: (f) => (f.agent === 'ghost#alice@node' ? 'ATTACH_UNAUTHORIZED' : null) });
    const { client } = makeClient(server);
    await client.start();
    expect(await client.attachIdentity({ gaii: 'live#alice@node', getToken: async () => 'good' })).toBe(true);
    expect(await client.attachIdentity({ gaii: 'ghost#alice@node', getToken: async () => 'dead' })).toBe(false);
    // identityCount() counts the socket's own identity plus its passengers. The refused one is
    // not a passenger: it never got on.
    expect(client.identityCount()).toBe(2);

    const before = server.framesOfType('attach').length;
    server.sockets[server.sockets.length - 1].terminate();   // an abrupt drop, not a graceful close
    await waitFor(() => client.getConnectCount() >= 2, 4_000);
    await waitFor(() => server.framesOfType('attach').length > before, 4_000);
    await sleep(120);
    const reattached = server.framesOfType('attach').slice(before).map(f => f.agent);
    expect(reattached).toContain('live#alice@node');
    expect(reattached).not.toContain('ghost#alice@node');
  });

  it('a refusal reaches that identity alone, and the socket carries on', async () => {
    const failures: string[] = [];
    const server = await startServer({ welcome: { multiplex: true }, refuseAttach: (f) => (f.agent === 'ghost#alice@node' ? 'ATTACH_UNAUTHORIZED' : null) });
    const { client } = makeClient(server);
    await client.start();
    await client.attachIdentity({ gaii: 'live#alice@node', getToken: async () => 'good' });
    await client.attachIdentity({
      gaii: 'ghost#alice@node',
      getToken: async () => 'dead',
      onAuthFailure: (msg: string) => failures.push(msg),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/ATTACH_UNAUTHORIZED/);
    // The whole point of the fence: one dead credential is not the other forty-eight's problem.
    expect(client.isOnline()).toBe(true);
    const res = await client.forward('GET', '/v1/memory', {}, 'live#alice@node');
    expect(res.status).toBe(200);
  });
});

/**
 * TWO WAYS TO ARRIVE WITHOUT A TOKEN, AND THEY NEED OPPOSITE ANSWERS.
 *
 * They were one value until 2026-09-04, and a live 62-identity fleet paid for it: the node's mint
 * budget ran out during the joining burst, and twenty-two agents holding perfectly good keys
 * printed "Stopped: No stored token. Run: aimeat connect" and never tried again. The message named
 * the wrong cause, prescribed a remedy that would re-enrol a healthy agent, and `authFailure` is
 * terminal by design, so nothing recovered without a restart.
 *
 * The distinction is now the throw: null means there is no credential and a person must act;
 * throwing means one could not be obtained THIS SECOND and waiting is the whole fix.
 */
describe('a credential that could not be minted, versus one that does not exist', () => {
  it('treats a mint that failed as a wait, not as a dead agent', async () => {
    const server = await startServer();
    const failures: string[] = [];
    const { client } = makeClient(server, {
      getToken: async () => { throw new Error('MINT_RATE_LIMITED'); },
      onAuthFailure: (msg: string) => failures.push(msg),
    });

    const outcome = await client.start();

    // 'unreachable' is the degrade signal: the caller drops to direct HTTP and keeps trying.
    // 'auth_failed' is what it answered before, and it is what makes serve give up on the agent.
    expect(outcome).toBe('unreachable');
    // Nobody is told to go and re-run `aimeat connect` about a key that is fine.
    expect(failures).toHaveLength(0);
  });

  it('still stops when there genuinely is no credential, because retrying cannot fix that', async () => {
    const server = await startServer();
    const failures: string[] = [];
    const { client } = makeClient(server, {
      getToken: async () => null,
      onAuthFailure: (msg: string) => failures.push(msg),
    });

    expect(await client.start()).toBe('auth_failed');
    expect(failures).toEqual(['No stored token']);
  });

  it('leaves an identity off the shared socket without killing the socket others are on', async () => {
    // This is where the budget actually runs out: sixty-two joins is sixty-two mints in seconds.
    const server = await startServer({ welcome: { multiplex: true } });
    const { client } = makeClient(server);
    await client.start();

    const joined = await client.attachIdentity({
      gaii: 'unlucky#alice@node',
      getToken: async () => { throw new Error('MINT_RATE_LIMITED'); },
    });

    expect(joined).toBe(false);
    // The socket forty-eight other agents are riding does not go down because one mint was refused.
    expect(client.isOnline()).toBe(true);
  });
});

/**
 * A FRAME FOR AN IDENTITY THIS SOCKET NO LONGER HOLDS GOES NOWHERE.
 *
 * `handlersFor` used to be `identities.get(gaii) || this.opts`, and `this.opts` are the handlers of
 * whoever OPENED the socket. It could not tell "this frame names the socket's own identity" from
 * "this frame names one I evicted": both missed the map, both fell back to the opener. The node
 * stamps every outbound frame with the principal it is for and keeps pushing until told to detach,
 * and the 401 eviction never sent one. So after an attached agent's credential died, its next task
 * arrived stamped with its name, missed the map, and was filed on the OPENER's channel — queued
 * under the wrong agent, its runner launched, and the auto-ack telling the node the right agent had
 * it. Two owners on one daemon share a socket, so that is a task crossing an ownership boundary.
 *
 * Found by an adversarial review on 2026-09-05 and verified link by link before this was written.
 */
describe('a frame for an evicted identity', () => {
  const OPENER = 'concierge#alice@node';
  const VICTIM = 'news-fetcher#bob@node';

  /** Opener on a multiplexing node, with VICTIM attached; a forward from VICTIM answers 401. */
  async function evictedFixture() {
    const server = await startServer({
      welcome: { multiplex: true },
      onRequest: (frame, ws) => {
        const status = frame.agent === VICTIM ? 401 : 200;
        // `agent` echoed on the response, because that is what the real node does: sendTo() stamps
        // every outbound frame with the principal it is for. Without it the client cannot tell
        // whose 401 this is and treats it as its own — which is a different test.
        ws.send(JSON.stringify({ type: 'response', id: frame.id, agent: frame.agent, status, body: status === 401 ? { ok: false, error: { code: 'TOKEN_EXPIRED' } } : { ok: true } }));
      },
    });
    const openerDelivers: string[] = [];
    const { client } = makeClient(server, {
      gaii: OPENER,
      onDeliver: (kind, _payload, id) => openerDelivers.push(`${kind}:${id}`),
    });
    await client.start();
    const victimFailures: string[] = [];
    await client.attachIdentity({
      gaii: VICTIM,
      getToken: async () => 'about-to-die',
      onAuthFailure: (m) => victimFailures.push(m),
    });
    // The 401 that evicts VICTIM.
    await client.forward('GET', '/v1/memory', {}, VICTIM);
    await waitFor(() => victimFailures.length === 1);
    return { server, client, openerDelivers, victimFailures };
  }

  it('is told to the node with a detach, so the node stops pushing', async () => {
    const { server } = await evictedFixture();
    // THE HALF THAT WAS MISSING. Deleting the identity locally left the node holding it on this
    // socket and pushing its deliveries down it, stamped with a name this client no longer knew.
    await waitFor(() => server.framesOfType('detach').length === 1);
    expect(server.framesOfType('detach')[0].agent).toBe(VICTIM);
  });

  it('is dropped, not handed to the socket opener, and not acked', async () => {
    const { server, openerDelivers } = await evictedFixture();
    await waitFor(() => server.framesOfType('detach').length === 1);
    const acksBefore = server.framesOfType('ack').length;

    // The node has not processed the detach yet (or a deliver was already in flight): a task for
    // VICTIM arrives stamped with VICTIM's name. Before the fix this landed in openerDelivers.
    const ws = server.sockets[server.sockets.length - 1];
    ws.send(JSON.stringify({ type: 'deliver', agent: VICTIM, kind: 'task_assigned', id: 'bobs-task', payload: { title: 'bob\'s work' } }));
    await new Promise(r => setTimeout(r, 150));

    expect(openerDelivers).toEqual([]);
    // No ack either: an ack tells the node VICTIM received it, and VICTIM is gone.
    expect(server.framesOfType('ack').length).toBe(acksBefore);
  });

  it('still delivers to the opener when the frame is genuinely the opener\'s', async () => {
    // The fence must not swallow the socket's OWN traffic. Two frames prove the discrimination:
    // one unstamped (a legacy node), one stamped with the opener's own gaii.
    const { server, openerDelivers } = await evictedFixture();
    const ws = server.sockets[server.sockets.length - 1];
    ws.send(JSON.stringify({ type: 'deliver', kind: 'task_assigned', id: 'legacy-1', payload: {} }));
    ws.send(JSON.stringify({ type: 'deliver', agent: OPENER, kind: 'task_assigned', id: 'mine-1', payload: {} }));
    await waitFor(() => openerDelivers.length === 2);
    expect(openerDelivers).toEqual(['task_assigned:legacy-1', 'task_assigned:mine-1']);
  });

  it('a second 401 for the evicted identity does not stop the whole client', async () => {
    // Before the fix a straggling 401 for an already-evicted name took the else branch and called
    // authFailure(), dropping the socket for every other identity riding it.
    const { server, client } = await evictedFixture();
    await waitFor(() => server.framesOfType('detach').length === 1);
    const ws = server.sockets[server.sockets.length - 1];
    ws.send(JSON.stringify({ type: 'response', id: 'stray', agent: VICTIM, status: 401, body: { ok: false, error: { code: 'TOKEN_EXPIRED' } } }));
    await new Promise(r => setTimeout(r, 150));
    expect(client.isOnline()).toBe(true);
  });
});
