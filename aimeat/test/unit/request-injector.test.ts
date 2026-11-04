/**
 * @file test/unit/request-injector.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's request to itself without a socket (src/services/request-injector.ts) is
 *   the same request the loopback fetch made: the same headers, method, body, client address and
 *   answer, run in a fresh async context, marked for the caller's bearer and for nobody else, never
 *   taken for a person at the node's own machine, and refused as a closed port is when the server is
 *   not listening. One Express app answers both ways, so every comparison is socket against
 *   in-process on the same route.
 * @usage cd aimeat && pnpm exec vitest run test/unit/request-injector.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item D-j).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerInProcessApp, noteListeningServer, withInProcessFetch } from '../../src/services/request-injector.js';
import { isInjectedRequest, injectedRequestCovers } from '../../src/auth/injected-request.js';
import { fromNodeMachine } from '../../src/auth/loopback-pass.js';
import { RULES, lineTexts } from '../../scripts/check-single-entry.js';

/** A request-scoped store of the caller's, which a request read from a socket never sees. */
const callerStore = new AsyncLocalStorage<string>();

function echoApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.all('/echo', (req, res) => {
    res.json({
      method: req.method, url: req.originalUrl, headers: req.headers, body: req.body ?? null,
      ip: req.ip, remote: req.socket.remoteAddress, protocol: req.protocol,
      injected: isInjectedRequest(req),
      coversA: injectedRequestCovers(req, 'bearer-a'),
      coversB: injectedRequestCovers(req, 'bearer-b'),
      thisMachine: fromNodeMachine(req),
      store: callerStore.getStore() ?? null,
    });
  });
  app.get('/idle', (req, res) => { req.setTimeout(60_000); res.setTimeout(60_000); res.json({ ok: true }); });
  app.get('/page', (_req, res) => { res.type('text/html').send('<!DOCTYPE html><p>not json</p>'); });
  app.get('/nothing', (_req, res) => { res.status(204).end(); });
  return app;
}

let server: http.Server;
let port: number;
let base: string;

beforeAll(async () => {
  const app = echoApp();
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  // What server.ts and index-start.ts do for the node.
  registerInProcessApp(port, app);
  noteListeningServer(port, server);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
});

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bearer-a', ...headers },
  body: JSON.stringify(body),
});

describe('a request the node sends itself in process', () => {
  it('carries what the loopback fetch carried and reads the same answer', async () => {
    const overSocket = await (await fetch(`${base}/echo?x=1`, post({ a: 1 }))).json();
    const inProcess = await withInProcessFetch({ port }, { forBearer: 'bearer-a' },
      async (fetchIn) => (await fetchIn('/echo?x=1', post({ a: 1 }))).json());
    for (const field of ['method', 'url', 'headers', 'body', 'ip', 'remote', 'protocol', 'store']) {
      expect(inProcess[field], field).toEqual(overSocket[field]);
    }
    expect(overSocket.injected).toBe(false);
    expect(inProcess.injected).toBe(true);
  });

  it('is marked for the bearer it was sent for, and for no other', async () => {
    const forA = await withInProcessFetch({ port }, { forBearer: 'bearer-a' },
      async (fetchIn) => (await fetchIn('/echo', post({}))).json());
    expect(forA.coversA).toBe(true);
    expect(forA.coversB).toBe(false);
    const forNobody = await withInProcessFetch({ port }, {},
      async (fetchIn) => (await fetchIn('/echo', post({}))).json());
    expect(forNobody.injected).toBe(true);
    expect(forNobody.coversA).toBe(false);
    const overSocket = await (await fetch(`${base}/echo`, post({}))).json();
    expect(overSocket.coversA).toBe(false);
  });

  it('is never a person at the node\'s own machine', async () => {
    const overSocket = await (await fetch(`${base}/echo`, { method: 'GET' })).json();
    expect(overSocket.thisMachine).toBe(true);
    const inProcess = await withInProcessFetch({ port }, {},
      async (fetchIn) => (await fetchIn('/echo', { method: 'GET' })).json());
    expect(inProcess.thisMachine).toBe(false);
  });

  it('runs the route in a fresh async context, without the caller\'s request-scoped stores', async () => {
    const seen = await callerStore.run('the caller', () => withInProcessFetch({ port }, {},
      async (fetchIn) => (await fetchIn('/echo', { method: 'GET' })).json()));
    expect(seen.store).toBeNull();
    // The caller's own context is intact after the dispatch.
    const after = await callerStore.run('the caller', async () => {
      await withInProcessFetch({ port }, {}, async (fetchIn) => (await fetchIn('/echo', { method: 'GET' })).text());
      return callerStore.getStore();
    });
    expect(after).toBe('the caller');
  });

  it('serves a route that sets an idle timeout, an empty answer and a non-JSON answer as the socket does', async () => {
    const idle = await withInProcessFetch({ port }, {}, async (fetchIn) => (await fetchIn('/idle')).json());
    expect(idle).toEqual({ ok: true });
    const nothing = await withInProcessFetch({ port }, {}, async (fetchIn) => {
      const r = await fetchIn('/nothing');
      return { status: r.status, text: await r.text() };
    });
    expect(nothing).toEqual({ status: 204, text: '' });
    const socketError = await (await fetch(`${base}/page`)).json().then(() => null, (e: Error) => e.message);
    const injectedError = await withInProcessFetch({ port }, {},
      async (fetchIn) => (await fetchIn('/page')).json().then(() => null, (e: Error) => e.message));
    expect(socketError).toBeTruthy();
    expect(injectedError).toBe(socketError);
  });

  it('answers without any socket when the app\'s server never listened', async () => {
    const closed = await new Promise<http.Server>((resolve) => { const s = http.createServer().listen(0, '127.0.0.1', () => resolve(s)); });
    const freePort = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(() => r(null)));
    registerInProcessApp(freePort, echoApp());
    const out = await withInProcessFetch({ port: freePort }, { forBearer: 'bearer-a' },
      async (fetchIn) => (await fetchIn('/echo', post({ b: 2 }))).json());
    expect(out.body).toEqual({ b: 2 });
    expect(out.coversA).toBe(true);
    expect(out.remote).toBe('127.0.0.1');
  });

  it('is refused as a closed port is, when the server stopped listening or no app is registered', async () => {
    const stopped = await new Promise<http.Server>((resolve) => { const s = http.createServer().listen(0, '127.0.0.1', () => resolve(s)); });
    const stoppedPort = (stopped.address() as AddressInfo).port;
    registerInProcessApp(stoppedPort, echoApp());
    noteListeningServer(stoppedPort, stopped);
    await new Promise((r) => stopped.close(() => r(null)));
    const unregistered = await new Promise<http.Server>((resolve) => { const s = http.createServer().listen(0, '127.0.0.1', () => resolve(s)); });
    const unregisteredPort = (unregistered.address() as AddressInfo).port;
    await new Promise((r) => unregistered.close(() => r(null)));
    for (const target of [stoppedPort, unregisteredPort]) {
      const failure = await withInProcessFetch({ port: target }, {}, async (fetchIn) => fetchIn('/echo'))
        .then(() => null, (e: Error & { cause?: { code?: string } }) => ({ message: e.message, code: e.cause?.code }));
      expect(failure).toEqual({ message: 'fetch failed', code: 'ECONNREFUSED' });
    }
  });
});

describe('the self-fetch ratchet (check:single-entry, rule self-fetch)', () => {
  const rule = RULES.find(r => r.id === 'self-fetch')!;
  const hits = (src: string) => lineTexts(src).filter(l => rule.pattern.test(l)).length;

  it('counts a request to the node\'s own port on 127.0.0.1, however the port is reached', () => {
    expect(hits([
      'const r = await fetch(`http://127.0.0.1:${config.port}/v1/ext/${name}/${action}`, init);',
      'const client = new AimeatClient(`http://127.0.0.1:${config.port}`, bearer);',
      'this.base = `http://127.0.0.1:${ctx.config.port}`;',
    ].join('\n'))).toBe(3);
  });

  it('does not count a comment, a public base URL or another program\'s port', () => {
    expect(hits([
      '// a fetch to http://127.0.0.1:${config.port} is what this replaced',
      'const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;',
      "const lmstudio = 'http://127.0.0.1:1234/v1';",
    ].join('\n'))).toBe(0);
  });
});
