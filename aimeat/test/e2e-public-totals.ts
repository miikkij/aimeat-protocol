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
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
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
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const priv = body.data.private_key;
  const ts = new Date().toISOString();
  const sig = await signMsg(priv, ownerName + NODE_ID + ts);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
  ownerToken = tok.body.data?.token;
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

await test('Endpoint is public — works with no Authorization header', async () => {
  const res = await fetch(`${BASE}/v1/public/node-totals`);
  assert(res.status === 200, `unauthenticated status ${res.status}`);
  const body = await res.json() as any;
  assert(body?.ok === true && !!body?.data, 'unauthenticated call returns data');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
