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
});
