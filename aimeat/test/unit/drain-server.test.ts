/**
 * @file test/unit/drain-server.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The drain a stop begins with (server-bootstrap/drain.ts), on a real HTTP server: a
 *   request in flight finishes, a new connection is refused, a live stream is ended at once so the
 *   server closes without waiting for the limit, the readiness phase is `draining`, and a request
 *   that outlasts the limit is cut. Until 2026-11-04 the stop accepted new requests for its first
 *   4 s, and an open live stream kept the server from closing, so it always left with exit code 1.
 *   test/e2e-graceful-shutdown.ts proves the same through a real SIGTERM where the system has one.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: drain-first shutdown).
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { trackRequests, drainServer } from '../../src/server-bootstrap/drain.js';
import { endOnDrain, nodePhase } from '../../src/services/node-lifecycle.js';

interface Harness { server: http.Server; port: number; release: () => void; tracker: ReturnType<typeof trackRequests> }

/** /slow answers when release() is called; /stream is a live stream registered for the drain; / answers at once. */
async function start(): Promise<Harness> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') { void gate.then(() => { res.end('slow done'); }); return; }
    if (req.url === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(':open\n\n');
      endOnDrain(res);
      return;
    }
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const tracker = trackRequests(server);
  return { server, port: (server.address() as AddressInfo).port, release, tracker };
}

function get(port: number, path: string): Promise<{ status: number; body: string; connection: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, connection: res.headers.connection }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Open a live stream and resolve when the server has ended it. */
function openStream(port: number): Promise<{ opened: Promise<void>; ended: Promise<void> }> {
  return new Promise((resolve, reject) => {
    let opened: () => void = () => undefined;
    const openedP = new Promise<void>((r) => { opened = r; });
    const req = http.request({ host: '127.0.0.1', port, path: '/stream', agent: false }, (res) => {
      const ended = new Promise<void>((r) => { res.on('end', () => r()); res.on('close', () => r()); });
      res.once('data', () => opened());
      resolve({ opened: openedP, ended });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('drainServer', () => {
  it('finishes the request in flight, refuses a new connection, ends the live stream, and closes before the limit', async () => {
    const h = await start();
    const stream = await openStream(h.port);
    await stream.opened;
    const slow = get(h.port, '/slow');
    await new Promise((r) => setTimeout(r, 100));
    expect(h.tracker.inFlight()).toBe(2);

    const drained = drainServer(h.server, h.tracker, { timeoutMs: 5_000, pollMs: 20 });
    expect(nodePhase()).toBe('draining');
    await stream.ended;                                   // ended at once, not at the limit
    await expect(get(h.port, '/')).rejects.toThrow();     // the listening socket is closed
    h.release();
    const answer = await slow;
    expect(answer.status).toBe(200);
    expect(answer.body).toBe('slow done');
    const result = await drained;
    expect(result.endedStreams).toBe(1);
    expect(result.cut).toBe(0);
    expect(result.waitedMs).toBeLessThan(5_000);
    expect(h.server.listening).toBe(false);
  });

  it('cuts a request that outlasts the limit and says so', async () => {
    const h = await start();
    const slow = get(h.port, '/slow').catch((err: Error) => err);
    await new Promise((r) => setTimeout(r, 100));
    const result = await drainServer(h.server, h.tracker, { timeoutMs: 300, pollMs: 20 });
    expect(result.cut).toBe(1);
    expect(await slow).toBeInstanceOf(Error);
    h.release();
  });
});
