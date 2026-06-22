/**
 * @file aimeat/test/e2e-enterprise-stub.ts
 * @description Open-core edition-matrix test: with NO proprietary `ee/` module active (Community
 *   edition — the shared e2e server runs with AIMEAT_EE_DISABLED=true), the gated `/v1/orgs`
 *   commerce namespace must return a clear ENTERPRISE_REQUIRED envelope (HTTP 501) from the stub
 *   provider, while the rest of the node works normally.
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness.
 * @version-history v0.1.0 — 2026-06-23 — initial stub-path test for the enterprise seam
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

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? (await res.json()) as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

console.log('\n=== AIMEAT Enterprise Stub (Community edition) E2E Test ===\n');
console.log(`Base: ${BASE}\n`);

await test('POST /v1/orgs returns ENTERPRISE_REQUIRED on a Community node', async () => {
  const { status, body } = await json('/v1/orgs', {
    method: 'POST',
    body: JSON.stringify({ slug: 'acme', name: 'Acme Oy' }),
  });
  assert(status === 501, `Expected 501, got ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === false, 'Expected ok: false');
  assert(body.error?.code === 'ENTERPRISE_REQUIRED', `Expected ENTERPRISE_REQUIRED, got ${body.error?.code}`);
});

await test('GET org offerings namespace is also gated', async () => {
  const { status, body } = await json('/v1/orgs/alice/acme/offerings');
  assert(status === 501, `Expected 501, got ${status}`);
  assert(body.error?.code === 'ENTERPRISE_REQUIRED', `Expected ENTERPRISE_REQUIRED, got ${body.error?.code}`);
});

await test('Invoke namespace is gated too', async () => {
  const { status, body } = await json('/v1/orgs/alice/acme/offerings/x/invoke', { method: 'POST', body: '{}' });
  assert(status === 501, `Expected 501, got ${status}`);
  assert(body.error?.code === 'ENTERPRISE_REQUIRED', `Expected ENTERPRISE_REQUIRED, got ${body.error?.code}`);
});

await test('Core (non-enterprise) routes still work — catalogue is open', async () => {
  const { status } = await json('/v1/catalogue');
  assert(status === 200, `Expected 200 from /v1/catalogue, got ${status}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`Enterprise stub E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All enterprise stub tests passed!\n');
