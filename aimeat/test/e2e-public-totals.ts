/**
 * @file e2e-public-totals.ts
 * @description E2E tests for GET /v1/public/node-totals — the cumulative public counters
 *   powering the landing "Happening on this node" panel that replaced the often-empty
 *   activity feed. Verifies the happy path (correct shape; all six counters are
 *   non-negative integers) and that the figures reflect real state: after registering an
 *   agent and publishing a public app + public organism, agents/apps/organisms are >= 1.
 *
 *   The endpoint caches 30 s, but the cache is now event-bus invalidated (services/cache.ts): a
 *   write in a counted domain (here a public organism → `domain:organisms`) drops the entry, so the
 *   next read reflects it before the TTL. This suite both warms the cache and asserts that drop.
 *   A negative check confirms it needs no auth (public).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=public-totals
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial: node-totals shape + reflects-real-state + public-access.
 *   v1.1.0 — 2026-06-22 — Assert the generic cache layer invalidates node-totals on a relevant
 *     write (new public organism reflected before the 30s TTL).
 *   v1.2.0 — 2026-06-28 — Import a catalog-listed knowledge package as a fixture and assert
 *     knowledge_packages >= 1 (regression: the counter undercounted to 0 on busy nodes).
 *   2026-11-15 — Audit M142, L113: an unlisted package leaves knowledge_packages unchanged, and one
 *     real app fetch moves downloads by exactly 1.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ownerName = `pttest${Date.now() % 100000}`;
const agentName = 'ptagent';
const stamp = Date.now();

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
let agentToken = '';
let agentGaii = '';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const ownerAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...(o.headers as any), Authorization: `Bearer ${ownerToken}` } });
const agentAuth = (o: RequestInit = {}): RequestInit => ({ ...o, headers: { ...(o.headers as any), Authorization: `Bearer ${agentToken}` } });

const NUM_FIELDS = ['apps', 'organisms', 'agents', 'agents_online', 'knowledge_packages', 'downloads'];
const isNonNegInt = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isInteger(n);

console.log('\n=== Public Node Totals E2E Tests ===\n');
console.log('Phase 0: Setup + fixtures (BEFORE first node-totals call — cold cache counts them)');

await test('Register owner', async () => {
  ownerToken = (await registerOwner(BASE, ownerName)).token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register agent', async () => {
  const reg = await json('/v1/agents', ownerAuth({ method: 'POST', body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }) }));
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
  agentGaii = reg.body.data.agent.gaii;
  const ts = new Date().toISOString();
  const sig = await signMsg(reg.body.data.private_key, agentGaii + ts);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: sig }) });
  agentToken = tok.body.data?.token;
  assert(typeof agentToken === 'string', 'got agent token');
});

await test('Publish a public app + create a public organism', async () => {
  const app = await json('/v1/apps', ownerAuth({ method: 'POST', body: JSON.stringify({ filename: `pt-app-${stamp}.html`, content: b64('<h1>pt</h1>'), name: `PT App ${stamp}`, description: 'A tiny fixture app for the node-totals E2E suite.', category: 'utility', tags: ['pt'] }) }));
  assert(app.status === 201, `publish status ${app.status}: ${JSON.stringify(app.body)}`);
  const org = await json('/v1/organisms', agentAuth({ method: 'POST', body: JSON.stringify({ name: `PT Org ${stamp}`, visibility: 'public' }) }));
  assert(org.status === 201, `org status ${org.status}: ${JSON.stringify(org.body)}`);
});

await test('Import a public (catalog-listed) knowledge package', async () => {
  const pkg = {
    type: 'knowledge-package',
    name: `PT Knowledge ${stamp}`,
    content_type: 'research',
    tags: ['pt'],
    entries: [{ key: 'note', title: 'A note', visibility: 'public', value: { body: 'hello' } }],
  };
  const imp = await json('/v1/knowledge/import', ownerAuth({ method: 'POST', body: JSON.stringify({ package: pkg, overrides: { catalog_listed: true } }) }));
  assert(imp.status === 201, `import status ${imp.status}: ${JSON.stringify(imp.body)}`);
  assert(imp.body.data?.catalog_listed === true, `package is catalog-listed, got ${JSON.stringify(imp.body.data)}`);
});

console.log('\nPhase 1: node-totals shape + reflects real state');

await test('GET /v1/public/node-totals returns ok with all six non-negative integer counters', async () => {
  const { status, body } = await json('/v1/public/node-totals');
  assert(status === 200, `status ${status}`);
  assert(body?.ok === true, `ok flag, got ${JSON.stringify(body)}`);
  const d = body?.data ?? {};
  for (const f of NUM_FIELDS) assert(isNonNegInt(d[f]), `field ${f} is a non-negative integer, got ${d[f]}`);
  assert(d.agents_online <= d.agents, 'agents_online never exceeds total agents');
});

await test('Counters reflect the fixtures just published (apps/organisms/agents >= 1)', async () => {
  const { body } = await json('/v1/public/node-totals');
  const d = body?.data ?? {};
  assert(d.apps >= 1, `at least the published app is counted, got apps=${d.apps}`);
  assert(d.organisms >= 1, `at least the public organism is counted, got organisms=${d.organisms}`);
  assert(d.agents >= 1, `at least the registered agent is counted, got agents=${d.agents}`);
  assert(d.knowledge_packages >= 1, `at least the catalog-listed knowledge package is counted, got knowledge_packages=${d.knowledge_packages}`);
});

await test('Cache invalidates on a relevant write (new public organism reflected before the 30s TTL)', async () => {
  // Warm the cache, then create another public organism. The create emits emitChange('organisms'),
  // which the central wiring turns into invalidateTag('domain:organisms') — dropping this entry even
  // though node-totals has no cache-bust param and the 30s TTL has not elapsed.
  const before = (await json('/v1/public/node-totals')).body?.data?.organisms ?? 0;
  const org = await json('/v1/organisms', agentAuth({ method: 'POST', body: JSON.stringify({ name: `PT Org Inval ${stamp}`, visibility: 'public' }) }));
  assert(org.status === 201, `org status ${org.status}: ${JSON.stringify(org.body)}`);
  const after = (await json('/v1/public/node-totals')).body?.data?.organisms ?? 0;
  assert(after === before + 1, `organisms should rise immediately after creating one (cache invalidated, not waiting out TTL): ${after} vs ${before}`);
});

// The question a public counter actually raises. This endpoint has no refusal to test — it is meant
// to answer everyone, and the test below asserts that. What it must NOT do is count something the
// person who made it kept private: a counter that rises when a private organism is created tells an
// anonymous caller that one was created, which is the whole of what "private" was supposed to
// prevent. The cache invalidation above makes this measurable in the same breath rather than after
// a 30s TTL.
await test('A PRIVATE organism does not move the public counter', async () => {
  const before = (await json('/v1/public/node-totals')).body?.data?.organisms ?? 0;
  const org = await json('/v1/organisms', agentAuth({
    method: 'POST', body: JSON.stringify({ name: `PT Org Private ${stamp}`, visibility: 'private' }),
  }));
  assert(org.status === 201, `private org status ${org.status}: ${JSON.stringify(org.body)}`);
  const after = (await json('/v1/public/node-totals')).body?.data?.organisms ?? 0;
  assert(after === before,
    `a private organism moved the public counter ${before} → ${after}, which tells an anonymous caller it exists`);
});

const importPackage = (name: string, listed: boolean) => json('/v1/knowledge/import', ownerAuth({ method: 'POST', body: JSON.stringify({
  package: { type: 'knowledge-package', name, content_type: 'research', tags: ['pt'], entries: [{ key: 'note', title: 'A note', visibility: 'public', value: { body: 'hello' } }] },
  overrides: { catalog_listed: listed },
}) }));

// Neither a package import nor a download drops the 30 s cache entry, so a public organism is
// created first: its change event drops every node-totals entry, and the read after it is fresh.
let fresh = 0;
async function freshTotals(): Promise<Record<string, number>> {
  const org = await json('/v1/organisms', agentAuth({ method: 'POST', body: JSON.stringify({ name: `PT Org Fresh ${stamp}-${fresh++}`, visibility: 'public' }) }));
  assert(org.status === 201, `org status ${org.status}`);
  return (await json('/v1/public/node-totals')).body?.data ?? {};
}

// The same question for knowledge packages: an unlisted one must not move the public counter. The
// listed import beside it is the control that the read is fresh, so "unchanged" is measured.
await test('An UNLISTED knowledge package does not move the public counter; a listed one moves it by 1', async () => {
  const before = (await freshTotals()).knowledge_packages ?? 0;
  const hidden = await importPackage(`PT Hidden ${stamp}`, false);
  assert(hidden.status === 201 && hidden.body.data?.catalog_listed === false, `unlisted import: ${hidden.status} ${JSON.stringify(hidden.body.data ?? hidden.body.error)}`);
  const listed = await importPackage(`PT Listed ${stamp}`, true);
  assert(listed.status === 201, `listed import: ${listed.status}`);
  const after = (await freshTotals()).knowledge_packages ?? 0;
  assert(after === before + 1, `knowledge_packages should rise by exactly the listed package: ${before} → ${after}`);
});

// A real download, read back through the counter. The count is written after the response, so
// the fresh read is asked a few times.
await test('downloads rises by exactly 1 after the fixture app is fetched once', async () => {
  const before = (await freshTotals()).downloads ?? 0;
  const got = await fetch(`${BASE}/v1/apps/${ownerName}/pt-app-${stamp}.html`);
  assert(got.status === 200, `app fetch ${got.status}`);
  await got.arrayBuffer();
  let after = before;
  for (let i = 0; i < 5 && after === before; i++) after = (await freshTotals()).downloads ?? 0;
  assert(after === before + 1, `downloads should rise by exactly 1: ${before} → ${after}`);
});

await test('Endpoint is public — works with no Authorization header', async () => {
  const res = await fetch(`${BASE}/v1/public/node-totals`);
  assert(res.status === 200, `unauthenticated status ${res.status}`);
  const body = await res.json() as any;
  assert(body?.ok === true && !!body?.data, 'unauthenticated call returns data');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
