/**
 * @file e2e-unfurl.ts
 * @description E2E tests for the link-preview endpoints GET /v1/unfurl and GET /v1/unfurl/image. A tiny
 *   local fixture HTTP server (127.0.0.1) serves an OG-tagged page + an image so the happy paths run with
 *   no real internet (the test env sets AIMEAT_DEV_MODE=true → loopback egress is permitted). Covers:
 *   auth required; url validation (400); happy-path metadata extraction; the image proxy (image + 415);
 *   a non-HTML target (hostname-only preview); and the failure mode that matters — the SSRF guard blocks
 *   a link-local / private target with 422 even though loopback is allowed.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=unfurl
 * @version-history
 *   v1.0.0 — 2026-07-21 — Initial: auth/validation, OG metadata happy path, image proxy, SSRF block.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `unftest${Date.now() % 100000}`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

let ownerToken = '';
const ownerAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...(o.headers as any), Authorization: `Bearer ${ownerToken}` } });

// A 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Local fixture content server — the target we unfurl. Loopback, so allowed only under AIMEAT_DEV_MODE.
let fixture: Server;
let fixtureBase = '';
function startFixture(): Promise<void> {
  return new Promise((resolve) => {
    fixture = createServer((req, res) => {
      if (req.url === '/page') {
        const img = `${fixtureBase}/img.png`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head>
          <title>Fallback Title</title>
          <meta property="og:site_name" content="Fixture Site" />
          <meta property="og:title" content="Hello &amp; Welcome" />
          <meta property="og:description" content="A tiny fixture page for the unfurl E2E." />
          <meta property="og:image" content="${img}" />
        </head><body>hi</body></html>`);
      } else if (req.url === '/img.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
      } else if (req.url === '/notimage') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not an image');
      } else {
        res.writeHead(404); res.end('nope');
      }
    });
    fixture.listen(0, '127.0.0.1', () => {
      const port = (fixture.address() as AddressInfo).port;
      fixtureBase = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

console.log('\n=== Unfurl (link preview) E2E Tests ===\n');
await startFixture();

await test('Register owner + get token', async () => {
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const ts = new Date().toISOString();
  const sig = await signMsg(body.data.private_key, ownerName + NODE_ID + ts);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
  ownerToken = tok.body.data?.token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

console.log('\nPhase 1: auth + validation');

await test('GET /v1/unfurl requires auth (401 without a token)', async () => {
  const { status } = await json(`/v1/unfurl?url=${encodeURIComponent(fixtureBase + '/page')}`);
  assert(status === 401, `unauth status ${status}`);
});

await test('Missing/invalid url param → 400', async () => {
  const a = await json('/v1/unfurl', ownerAuth());
  assert(a.status === 400, `no url: status ${a.status}`);
  const b = await json('/v1/unfurl?url=ftp://x/y', ownerAuth());
  assert(b.status === 400, `non-http url: status ${b.status}`);
});

console.log('\nPhase 2: metadata happy path');

await test('Unfurl an OG-tagged page returns title/description/image/siteName', async () => {
  const { status, body } = await json(`/v1/unfurl?url=${encodeURIComponent(fixtureBase + '/page')}`, ownerAuth());
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const d = body?.data ?? {};
  assert(d.title === 'Hello & Welcome', `title (entity-decoded), got ${JSON.stringify(d.title)}`);
  assert(d.description === 'A tiny fixture page for the unfurl E2E.', `description, got ${JSON.stringify(d.description)}`);
  assert(d.siteName === 'Fixture Site', `siteName, got ${JSON.stringify(d.siteName)}`);
  assert(typeof d.image === 'string' && d.image.endsWith('/img.png'), `absolute image url, got ${JSON.stringify(d.image)}`);
});

await test('A non-HTML target returns a hostname-only preview (no title)', async () => {
  const { status, body } = await json(`/v1/unfurl?url=${encodeURIComponent(fixtureBase + '/img.png')}`, ownerAuth());
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const d = body?.data ?? {};
  assert(d.title === null && d.image === null, `no title/image for a raw image, got ${JSON.stringify(d)}`);
  assert(d.siteName === '127.0.0.1', `hostname siteName, got ${JSON.stringify(d.siteName)}`);
});

console.log('\nPhase 3: image proxy');

await test('Image proxy streams the image back with an image/* content-type', async () => {
  const res = await fetch(`${BASE}/v1/unfurl/image?url=${encodeURIComponent(fixtureBase + '/img.png')}`, ownerAuth());
  assert(res.status === 200, `status ${res.status}`);
  assert((res.headers.get('content-type') || '').startsWith('image/'), `image content-type, got ${res.headers.get('content-type')}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert(buf.length === PNG.length, `proxied the PNG bytes, got ${buf.length}`);
});

await test('Image proxy rejects a non-image target with 415', async () => {
  const res = await fetch(`${BASE}/v1/unfurl/image?url=${encodeURIComponent(fixtureBase + '/notimage')}`, ownerAuth());
  assert(res.status === 415, `status ${res.status}`);
});

console.log('\nPhase 4: SSRF guard (the failure mode that matters)');

await test('A link-local (cloud-metadata) target is blocked with 422', async () => {
  const { status } = await json('/v1/unfurl?url=http://169.254.169.254/latest/meta-data/', ownerAuth());
  assert(status === 422, `link-local should be blocked, got ${status}`);
});

await test('A private (RFC1918) target is blocked with 422 — even though loopback is allowed', async () => {
  const { status } = await json('/v1/unfurl?url=http://10.0.0.1/', ownerAuth());
  assert(status === 422, `private target should be blocked, got ${status}`);
  const img = await fetch(`${BASE}/v1/unfurl/image?url=${encodeURIComponent('http://192.168.1.1/x.png')}`, ownerAuth());
  assert(img.status === 422, `private image target should be blocked, got ${img.status}`);
});

await new Promise<void>((r) => fixture.close(() => r()));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
