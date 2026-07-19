/**
 * @file aimeat/test/e2e-appdev-pitfalls.ts
 * @description Curated appdev-pitfall registry E2E — the agent-facing "what bites app builders"
 *   surface. Asserts (a) GET /v1/appdev/pitfalls serves a paginated index with total + facet
 *   counts, (b) applies_to/severity filters work, (c) pagination slices deterministically,
 *   (d) GET /v1/appdev/pitfalls/:id serves a full entry, and the failure mode (unknown id →
 *   404 NOT_FOUND). Registry source: src/data/appdev-pitfalls.ts.
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=appdev-pitfalls).
 * @version-history v1.0.0 — 2026-07-19 — initial (AppDev Knowledge Base, Phase 1).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

console.log('\n=== AIMEAT AppDev Pitfalls E2E Test ===\n');
console.log(`Base: ${BASE}\n`);

let total = 0;

await test('GET /v1/appdev/pitfalls returns a paginated index with facets', async () => {
  const { status, body } = await json('/v1/appdev/pitfalls');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.ok === true, 'Expected ok: true');
  const d = body.data;
  assert(Array.isArray(d.pitfalls) && d.pitfalls.length > 0, 'no pitfalls served');
  assert(typeof d.total === 'number' && d.total >= 20, `expected >=20 curated entries, got ${d.total}`);
  assert(d.limit === 25 && d.offset === 0, `default paging wrong: limit=${d.limit} offset=${d.offset}`);
  assert(d.pitfalls.length === Math.min(25, d.total), 'page size does not match limit/total');
  total = d.total;
  for (const p of d.pitfalls) {
    assert(typeof p.id === 'string' && p.id.length > 0, 'entry missing id');
    assert(typeof p.symptom === 'string' && p.symptom.length > 10, `${p.id}: symptom missing`);
    assert(typeof p.fix === 'string' && p.fix.length > 10, `${p.id}: fix missing`);
    assert(Array.isArray(p.appliesTo) && p.appliesTo.length > 0, `${p.id}: appliesTo missing`);
    assert(['info', 'warn', 'critical'].includes(p.severity), `${p.id}: bad severity ${p.severity}`);
    assert(p.source === 'curated', `${p.id}: bad source ${p.source}`);
  }
  assert(d.facets && typeof d.facets.applies_to === 'object' && typeof d.facets.severity === 'object', 'facets missing');
  assert((d.facets.severity.critical ?? 0) > 0, 'no critical entries counted in facets');
});

await test('severity ordering: criticals come before infos', async () => {
  const { body } = await json('/v1/appdev/pitfalls?limit=100');
  const sevs = body.data.pitfalls.map((p: any) => p.severity);
  const lastCritical = sevs.lastIndexOf('critical');
  const firstInfo = sevs.indexOf('info');
  assert(firstInfo === -1 || lastCritical < firstInfo, 'critical entries not sorted before info');
});

await test('?applies_to=realtime filters to realtime entries', async () => {
  const { body } = await json('/v1/appdev/pitfalls?applies_to=realtime');
  const d = body.data;
  assert(d.pitfalls.length > 0, 'no realtime entries');
  assert(d.pitfalls.every((p: any) => p.appliesTo.includes('realtime')), 'filter leaked non-realtime entries');
  assert(d.total < total, 'filtered total should be smaller than full total');
});

await test('?severity=critical filters by severity', async () => {
  const { body } = await json('/v1/appdev/pitfalls?severity=critical');
  const d = body.data;
  assert(d.pitfalls.length > 0, 'no critical entries');
  assert(d.pitfalls.every((p: any) => p.severity === 'critical'), 'severity filter leaked');
});

await test('pagination: limit+offset slice deterministically, no overlap', async () => {
  const { body: p1 } = await json('/v1/appdev/pitfalls?limit=5&offset=0');
  const { body: p2 } = await json('/v1/appdev/pitfalls?limit=5&offset=5');
  assert(p1.data.pitfalls.length === 5, 'page 1 wrong size');
  assert(p2.data.pitfalls.length > 0, 'page 2 empty');
  const ids1 = new Set(p1.data.pitfalls.map((p: any) => p.id));
  assert(p2.data.pitfalls.every((p: any) => !ids1.has(p.id)), 'pages overlap');
  assert(p1.data.total === p2.data.total, 'total differs between pages');
});

await test('GET /v1/appdev/pitfalls/:id returns the full entry', async () => {
  const { status, body } = await json('/v1/appdev/pitfalls/login-is-silent-only');
  assert(status === 200, `Expected 200, got ${status}`);
  const p = body.data?.pitfall;
  assert(p?.id === 'login-is-silent-only', 'wrong entry');
  assert(/mountLoginButton/.test(p.fix), 'fix body missing expected guidance');
});

await test('unknown id → 404 NOT_FOUND', async () => {
  const { status, body } = await json('/v1/appdev/pitfalls/no-such-pitfall');
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `Expected NOT_FOUND, got ${body.error?.code}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`AppDev pitfalls E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All appdev-pitfall tests passed!\n');
