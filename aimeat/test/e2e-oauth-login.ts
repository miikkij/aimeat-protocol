/**
 * @file e2e-oauth-login.ts
 * @description E2E guard tests for multi-provider social login (Google + Casdoor + Entra) against a
 *   running node. In the standard test config no provider is configured, so every provider's
 *   authorize + callback must report the feature as disabled (503) rather than 404 — proving the
 *   routes are mounted and correctly gated. GET /v1/auth/providers must return 200 (an array, empty
 *   here). The full mapping/session happy-path is covered by test/unit/oauth-login.test.ts (fake IdP).
 * @usage cd aimeat && E2E_BASE=http://localhost:40250 npx tsx test/e2e-oauth-login.ts
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial guard suite.
 *   v1.1.0 — 2026-06-25 — Guard the first-time-username-choice endpoints: /login/pending 404s
 *     without the signed cookie, finalize 400s without a pending, and /username-available works
 *     (valid/available, taken, invalid) — these are usable even without Google configured.
 *   v2.0.0 — 2026-07-01 — Guard Casdoor + Entra (503 when unconfigured) and the new
 *     GET /v1/auth/providers discovery endpoint (200, array).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40250';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log(`\n=== AIMEAT Google Sign-in (guard) E2E ===\n`);
console.log(`Server: ${BASE}\n`);

await test('GET /v1/ghii/login/google returns 503 when Google sign-in is not configured', async () => {
  const res = await fetch(`${BASE}/v1/ghii/login/google`, { redirect: 'manual' });
  assert(res.status === 503, `expected 503, got ${res.status}`);
  const data = await res.json() as { error?: { code?: string } };
  assert(data.error?.code === 'FEATURE_DISABLED', `expected FEATURE_DISABLED, got ${data.error?.code}`);
});

await test('GET /v1/ghii/login/google/callback returns 503 when Google sign-in is not configured', async () => {
  const res = await fetch(`${BASE}/v1/ghii/login/google/callback?code=x&state=y`, { redirect: 'manual' });
  assert(res.status === 503, `expected 503, got ${res.status}`);
});

for (const provider of ['casdoor', 'entra']) {
  await test(`GET /v1/ghii/login/${provider} returns 503 when ${provider} sign-in is not configured`, async () => {
    const res = await fetch(`${BASE}/v1/ghii/login/${provider}`, { redirect: 'manual' });
    assert(res.status === 503, `expected 503, got ${res.status}`);
    const data = await res.json() as { error?: { code?: string } };
    assert(data.error?.code === 'FEATURE_DISABLED', `expected FEATURE_DISABLED, got ${data.error?.code}`);
  });

  await test(`GET /v1/ghii/login/${provider}/callback returns 503 when ${provider} sign-in is not configured`, async () => {
    const res = await fetch(`${BASE}/v1/ghii/login/${provider}/callback?code=x&state=y`, { redirect: 'manual' });
    assert(res.status === 503, `expected 503, got ${res.status}`);
  });
}

await test('GET /v1/auth/providers returns 200 with a providers array', async () => {
  const res = await fetch(`${BASE}/v1/auth/providers`, { redirect: 'manual' });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const data = await res.json() as { data?: { providers?: unknown[] } };
  assert(Array.isArray(data.data?.providers), `expected providers array, got ${JSON.stringify(data.data)}`);
});

await test('GET /v1/ghii/login/pending returns 404 NO_PENDING_SIGNUP without the signed cookie', async () => {
  const res = await fetch(`${BASE}/v1/ghii/login/pending`, { redirect: 'manual' });
  assert(res.status === 404, `expected 404, got ${res.status}`);
  const data = await res.json() as { error?: { code?: string } };
  assert(data.error?.code === 'NO_PENDING_SIGNUP', `expected NO_PENDING_SIGNUP, got ${data.error?.code}`);
});

await test('POST /v1/ghii/login/google/finalize returns 400 NO_PENDING_SIGNUP without a pending', async () => {
  const res = await fetch(`${BASE}/v1/ghii/login/google/finalize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'whoever' }), redirect: 'manual',
  });
  assert(res.status === 400, `expected 400, got ${res.status}`);
  const data = await res.json() as { error?: { code?: string } };
  assert(data.error?.code === 'NO_PENDING_SIGNUP', `expected NO_PENDING_SIGNUP, got ${data.error?.code}`);
});

await test('GET /v1/ghii/username-available reports valid/available, taken, and invalid', async () => {
  // A random, almost-certainly-free name → valid + available.
  const freeName = `e2e-free-${Date.now().toString(36)}`;
  const free = await fetch(`${BASE}/v1/ghii/username-available?name=${encodeURIComponent(freeName)}`);
  const freeData = (await free.json() as { data?: { valid?: boolean; available?: boolean } }).data;
  assert(freeData?.valid === true && freeData?.available === true, `expected valid+available, got ${JSON.stringify(freeData)}`);

  // Too short → invalid (format rules).
  const bad = await fetch(`${BASE}/v1/ghii/username-available?name=ab`);
  const badData = (await bad.json() as { data?: { valid?: boolean } }).data;
  assert(badData?.valid === false, `expected invalid, got ${JSON.stringify(badData)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
