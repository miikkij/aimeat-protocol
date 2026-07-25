/**
 * @file e2e-public-activity.ts
 * @description E2E tests for the public landing activity feed. Verifies that genuinely
 *   public actions are recorded and surfaced by GET /v1/public/activity-feed under the
 *   right category — app publish (apps), public organism create (organisms), knowledge
 *   package with catalog_listed (agents) — and that NON-public actions are NOT surfaced
 *   (private organism, non-catalog knowledge). Also checks the synthetic activity
 *   entries do not leak into the existing /v1/public/activity-ticker.
 *
 *   Two harness quirks handled here: (1) recordPublicActivity runs AFTER the HTTP
 *   response (fire-and-forget), so we poll; (2) the feed endpoint caches 10 s per
 *   (category,limit) key, so each poll uses a different `limit` to bust the cache.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=public-activity
 * @version-history
 *   v1.0.0 — 2026-06-16 — Initial: feed recording + category routing + negative cases.
 *   v1.1.0 — 2026-07-25 — Phase 4 now says what it actually checks: NOTHING owned by system@ may
 *     appear in the ticker. The old name blamed the activity feed, which was always filtered
 *     correctly; the real leak was the seeded built-in skills (public since 2026-07-14), so a
 *     dedicated regression case names them.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `pactest${Date.now() % 100000}`;
const agentName = 'pacagent';
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Poll the feed until `predicate` matches an item, busting the 10 s cache each attempt
// by varying `limit`. Returns the matching item (or throws on timeout).
async function waitForFeed(category: string, predicate: (it: any) => boolean, attempts = 20): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    const { body } = await json(`/v1/public/activity-feed?category=${category}&limit=${60 + i}`);
    const items = body?.data?.items ?? [];
    const hit = items.find(predicate);
    if (hit) return hit;
    await sleep(150);
  }
  throw new Error(`No matching ${category} feed item after ${attempts} attempts`);
}
// Read the feed once (fresh cache key) and return all items.
async function readFeed(category: string): Promise<any[]> {
  const { body } = await json(`/v1/public/activity-feed?category=${category}&limit=200`);
  return body?.data?.items ?? [];
}

console.log('\n=== Public Activity Feed E2E Tests ===\n');
console.log('Phase 0: Setup');

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

console.log('\nPhase 1: Apps');

const appFile = `pac-app-${stamp}.html`;
await test('Publishing an app records an "apps" feed event', async () => {
  const r = await json('/v1/apps', ownerAuth({ method: 'POST', body: JSON.stringify({ filename: appFile, content: b64('<h1>pac</h1>'), name: `PAC App ${stamp}`, description: 'A tiny fixture app for the public-activity E2E suite.', category: 'utility', tags: ['pac'] }) }));
  assert(r.status === 201, `publish status ${r.status}: ${JSON.stringify(r.body)}`);
  const hit = await waitForFeed('apps', it => typeof it.summary === 'string' && it.summary.includes(`PAC App ${stamp}`));
  assert(hit.category === 'apps', 'event category is apps');
  assert(typeof hit.link === 'string' && hit.link.includes(appFile), `link points to the app, got ${hit.link}`);
  assert(typeof hit.at === 'string' && !!hit.at, 'event has a timestamp');
});

console.log('\nPhase 2: Organisms (public surfaces, private does not)');

const pubOrgName = `PAC Public ${stamp}`;
const privOrgName = `PAC Private ${stamp}`;
await test('Creating a PUBLIC organism records an "organisms" feed event', async () => {
  const r = await json('/v1/organisms', agentAuth({ method: 'POST', body: JSON.stringify({ name: pubOrgName, visibility: 'public' }) }));
  assert(r.status === 201, `create status ${r.status}: ${JSON.stringify(r.body)}`);
  const hit = await waitForFeed('organisms', it => typeof it.summary === 'string' && it.summary.includes(pubOrgName));
  assert(hit.category === 'organisms', 'event category is organisms');
});

await test('Creating a PRIVATE organism does NOT appear in the feed', async () => {
  const r = await json('/v1/organisms', agentAuth({ method: 'POST', body: JSON.stringify({ name: privOrgName, visibility: 'private' }) }));
  assert(r.status === 201, `create status ${r.status}: ${JSON.stringify(r.body)}`);
  // Give any (erroneous) async write time to land, then read fresh.
  await sleep(600);
  const items = await readFeed('organisms');
  const leaked = items.find(it => typeof it.summary === 'string' && it.summary.includes(privOrgName));
  assert(!leaked, 'private organism must not be announced publicly');
});

console.log('\nPhase 3: Knowledge (catalog_listed surfaces, non-catalog does not)');

const listedPkg = `PAC Listed ${stamp}`;
const unlistedPkg = `PAC Unlisted ${stamp}`;
const knowledgeBody = (name: string, listed: boolean) => JSON.stringify({
  package: {
    type: 'knowledge-package', name, version: '1.0.0', author: ownerName,
    content_type: 'research', tags: ['pac'], language: 'en', maturity: 'published',
    synthesis: { level: 'original', description: 'pac synthesis' },
    references: [], entries: [{ key: 'findings', title: 'Findings', visibility: 'public' }], links: [],
    sharing: { catalog_listed: listed, allow_clone: listed, morsel_price: 0 },
  },
  entry_data: { findings: { title: 'Findings', summary: 'x', findings: ['a'] } },
});

await test('Importing a catalog_listed knowledge package records an "agents" feed event', async () => {
  const r = await json('/v1/knowledge/import', agentAuth({ method: 'POST', body: knowledgeBody(listedPkg, true) }));
  assert(r.status === 201, `import status ${r.status}: ${JSON.stringify(r.body)}`);
  const hit = await waitForFeed('agents', it => typeof it.summary === 'string' && it.summary.includes(listedPkg));
  assert(hit.category === 'agents', 'event category is agents');
  assert(typeof hit.link === 'string' && hit.link.includes('/v1/knowledge/'), `link points to the package, got ${hit.link}`);
});

await test('Importing a non-catalog knowledge package does NOT appear in the feed', async () => {
  const r = await json('/v1/knowledge/import', agentAuth({ method: 'POST', body: knowledgeBody(unlistedPkg, false) }));
  assert(r.status === 201, `import status ${r.status}: ${JSON.stringify(r.body)}`);
  await sleep(600);
  const items = await readFeed('agents');
  const leaked = items.find(it => typeof it.summary === 'string' && it.summary.includes(unlistedPkg));
  assert(!leaked, 'non-catalog knowledge must not be announced publicly');
});

console.log('\nPhase 4: The system identity is not an actor');

await test('Nothing owned by system@ leaks into /v1/public/activity-ticker', async () => {
  const { body } = await json('/v1/public/activity-ticker');
  const items = body?.data?.items ?? [];
  // system@nodeId owns the activity feed AND the seeded built-in skills AND ecosystem
  // subscriptions; all reduce to actor "system". None of them is somebody DOING something.
  const leaked = items.find((it: any) => it.actor === 'system');
  assert(!leaked, `system-owned entries must be excluded from the ticker, got ${JSON.stringify(leaked)}`);
});

await test('The seeded built-in skills specifically are not ticker items', async () => {
  // The regression this guards: the ticker used to drop only the 'activity/' key prefix, so the
  // public skill seeds (newest public writes on a fresh node) filled all ten rows.
  const { body } = await json('/v1/public/activity-ticker');
  const items = body?.data?.items ?? [];
  const skillRow = items.find((it: any) => typeof it.key === 'string' && /skills?\./.test(it.key));
  assert(!skillRow, `seeded skills must not appear as activity, got ${JSON.stringify(skillRow)}`);
});

// node-stats-today's public_writes uses the SAME exclusion, but a count assertion is not
// deterministic on a shared test database (other suites write public memory too), so it is
// deliberately not asserted here rather than shipping a flaky test.

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
