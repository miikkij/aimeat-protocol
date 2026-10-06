/**
 * @file test/unit/headless-network.test.ts
 * @description What a page the node opens in its headless browser may reach
 *   (services/headless-network.ts): the node's own origin from its loopback with no credential,
 *   nothing private unless the operator listed it, no method but GET and HEAD, no scheme but http(s).
 *   Driven with recorded routes against two real loopback servers, one standing in for the node and
 *   one for a private service. Before 2026-10-05 every sub-request went to the browser's own network
 *   (secaudit 2026-10, SSRF-1).
 * @version-history
 *   v1.1.0 — 2026-10-06 — headlessRequestHandlerFor, the rule aimeat screenshot-worker installs
 *     (secaudit 2026-10 follow-up, Part C).
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import { headlessRequestHandler, headlessRequestHandlerFor, serveDocumentOnce, type HeadlessRoute } from '../../src/services/headless-network.js';

interface Recorded { kind: 'fulfill' | 'abort' | 'fallback'; status?: number; body?: string; headers?: Record<string, string> }

function route(url: string, method = 'GET', headers: Record<string, string> = {}, resourceType = 'fetch'): { r: HeadlessRoute; out: Recorded[] } {
  const out: Recorded[] = [];
  const r: HeadlessRoute = {
    request: () => ({ url: () => url, method: () => method, resourceType: () => resourceType, headers: () => headers }),
    fulfill: async (o) => { out.push({ kind: 'fulfill', status: o.status, body: o.body === undefined ? undefined : String(o.body), headers: o.headers }); },
    abort: async () => { out.push({ kind: 'abort' }); },
    fallback: async () => { out.push({ kind: 'fallback' }); },
  };
  return { r, out };
}

function serve(answer: string): Promise<{ server: Server; port: number; seen: IncomingHttpHeaders[] }> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('Set-Cookie', 'sid=secret');
    res.setHeader('Content-Type', 'text/plain');
    res.end(answer);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as AddressInfo).port, seen })));
}

let node: Awaited<ReturnType<typeof serve>>;
let privateService: Awaited<ReturnType<typeof serve>>;
const saved = { egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, dev: process.env.AIMEAT_DEV_MODE };

beforeAll(async () => {
  node = await serve('own');
  privateService = await serve('private');
});
afterAll(() => { node.server.close(); privateService.server.close(); });
// A public node: loopback is not open to every fetch (the localhost profile opens it).
beforeEach(() => { delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; delete process.env.AIMEAT_DEV_MODE; });
afterEach(() => {
  if (saved.egress === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = saved.egress;
  if (saved.dev === undefined) delete process.env.AIMEAT_DEV_MODE; else process.env.AIMEAT_DEV_MODE = saved.dev;
});

const configOf = (egress = '') => ({ port: node.port, baseUrl: 'https://node.example', screenshotEgress: egress }) as unknown as AimeatConfig;

describe('headlessRequestHandler', () => {
  it('serves the node\'s own origin from its loopback, with no credential and no cookie back', async () => {
    const before = node.seen.length;
    const { r, out } = route('https://node.example/v1/libs/x.js?v=1', 'GET', { accept: '*/*', authorization: 'Bearer abc', cookie: 'sid=1' });
    await headlessRequestHandler(configOf())(r);
    expect(out).toEqual([{ kind: 'fulfill', status: 200, body: 'own', headers: { 'content-type': 'text/plain' } }]);
    expect(node.seen.length).toBe(before + 1);
    const sent = node.seen[node.seen.length - 1]!;
    expect(sent.authorization).toBeUndefined();
    expect(sent.cookie).toBeUndefined();
  });

  it('refuses a private address the page names, and the private service never hears from it', async () => {
    const before = privateService.seen.length;
    for (const url of [
      `http://127.0.0.1:${privateService.port}/admin`,
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
    ]) {
      const { r, out } = route(url);
      await headlessRequestHandler(configOf())(r);
      expect(out, url).toEqual([{ kind: 'abort' }]);
    }
    expect(privateService.seen.length).toBe(before);
  });

  it('lets a private origin the operator listed through, and only that origin', async () => {
    const before = privateService.seen.length;
    const { r, out } = route(`http://127.0.0.1:${privateService.port}/data`);
    await headlessRequestHandler(configOf(`http://127.0.0.1:${privateService.port}`))(r);
    expect(out[0]).toMatchObject({ kind: 'fulfill', status: 200, body: 'private' });
    expect(privateService.seen.length).toBe(before + 1);
    const other = route('http://10.0.0.1/');
    await headlessRequestHandler(configOf(`http://127.0.0.1:${privateService.port}`))(other.r);
    expect(other.out).toEqual([{ kind: 'abort' }]);
  });

  it('sends nothing but GET and HEAD, and nothing but http(s), not even to the node itself', async () => {
    const before = node.seen.length;
    for (const [url, method] of [
      ['https://node.example/v1/memory', 'POST'],
      ['https://node.example/v1/memory/x', 'DELETE'],
      ['ftp://node.example/x', 'GET'],
      ['file:///etc/passwd', 'GET'],
    ] as const) {
      const { r, out } = route(url, method);
      await headlessRequestHandler(configOf())(r);
      expect(out, `${method} ${url}`).toEqual([{ kind: 'abort' }]);
    }
    expect(node.seen.length).toBe(before);
  });
});

describe('headlessRequestHandlerFor (aimeat screenshot-worker, a browser outside the node)', () => {
  // The worker names the node by its own address; here that address is a loopback server, which a
  // public profile refuses to every fetch, so reaching it proves the node's origin is the one allowed.
  const workerRule = () => ({ own: [`http://127.0.0.1:${node.port}`], ownFetchBase: `http://127.0.0.1:${node.port}`, egress: [] });

  it('fetches the node at its own address with no credential, and nothing private beside it', async () => {
    const nodeBefore = node.seen.length;
    const own = route(`http://127.0.0.1:${node.port}/v1/apps/a/x.html?mode=inline`, 'GET', { authorization: 'Bearer abc' }, 'document');
    await headlessRequestHandlerFor(workerRule())(own.r);
    expect(own.out).toEqual([{ kind: 'fulfill', status: 200, body: 'own', headers: { 'content-type': 'text/plain' } }]);
    expect(node.seen.length).toBe(nodeBefore + 1);
    expect(node.seen[node.seen.length - 1]!.authorization).toBeUndefined();

    const privateBefore = privateService.seen.length;
    for (const url of [`http://127.0.0.1:${privateService.port}/admin`, 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/']) {
      const { r, out } = route(url, 'GET', {}, 'document');
      await headlessRequestHandlerFor(workerRule())(r);
      expect(out, url).toEqual([{ kind: 'abort' }]);
    }
    expect(privateService.seen.length).toBe(privateBefore);
  });
});

describe('serveDocumentOnce', () => {
  it('answers the first document with the app\'s bytes and hands everything after it to the context guard', async () => {
    let handler: ((r: HeadlessRoute) => unknown) | null = null;
    await serveDocumentOnce({ route: async (_m, h) => { handler = h; } }, '<p>app</p>');
    const first = route('https://node.example/v1/apps/a/x.html?mode=inline', 'GET', {}, 'document');
    await handler!(first.r);
    expect(first.out).toEqual([{ kind: 'fulfill', status: 200, body: '<p>app</p>', headers: undefined }]);
    const frame = route('http://10.0.0.1/', 'GET', {}, 'document');
    await handler!(frame.r);
    const script = route('https://node.example/v1/libs/x.js');
    await handler!(script.r);
    expect([...frame.out, ...script.out]).toEqual([{ kind: 'fallback' }, { kind: 'fallback' }]);
  });
});
