/**
 * @file test/unit/peer-fetch.test.ts
 * @description peerFetch (utils/peer-fetch.ts), the one fetch for a request to another node: no
 *   redirect is followed, a slow peer times out, and an answer over the ceiling is refused, against a
 *   real HTTP server on loopback (secaudit 2026-10, C6).
 * @usage pnpm test -- peer-fetch
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C6).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { peerFetch } from '../../src/utils/peer-fetch.js';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (req.url === '/refuse') { res.writeHead(404); res.end('{"error":"no"}'); return; }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/json' }); res.end(); return; }
    if (req.url === '/big') { res.writeHead(200); res.end('x'.repeat(10_000)); return; }
    if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 1_000); return; }
    res.writeHead(500); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('peerFetch', () => {
  it('answers the peer\'s body and status, its refusal included', async () => {
    expect(await peerFetch(`${base}/json`)).toMatchObject({ ok: true, status: 200, json: { ok: true } });
    expect(await peerFetch(`${base}/refuse`)).toMatchObject({ ok: true, status: 404, json: { error: 'no' } });
  });

  it('does not follow a redirect', async () => {
    expect(await peerFetch(`${base}/redirect`)).toMatchObject({ ok: false, reason: 'redirect' });
  });

  it('refuses an answer over the ceiling and times out a slow peer', async () => {
    expect(await peerFetch(`${base}/big`, {}, { maxBytes: 1_000 })).toMatchObject({ ok: false, reason: 'too-large' });
    expect(await peerFetch(`${base}/slow`, {}, { timeoutMs: 100 })).toMatchObject({ ok: false, reason: 'timeout' });
  });
});
