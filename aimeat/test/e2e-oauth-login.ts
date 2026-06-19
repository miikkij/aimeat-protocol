/**
 * @file e2e-oauth-login.ts
 * @description E2E guard tests for Google social login against a running node. In the standard
 *   test config Google sign-in is NOT configured, so both endpoints must report the feature as
 *   disabled (503) rather than 404 — proving the routes are mounted and correctly gated. The
 *   full mapping/session happy-path is covered by test/unit/oauth-login.test.ts (fake IdP).
 * @usage cd aimeat && E2E_BASE=http://localhost:40250 npx tsx test/e2e-oauth-login.ts
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial guard suite.
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
