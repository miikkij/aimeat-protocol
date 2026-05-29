/**
 * @file ai.ts
 * @description E2E tests for the app-level AI endpoints (/v1/ai/*). Covers
 *   auth, validation, settings CRUD, and the NO_API_KEY rejection path. The
 *   "happy path" (real OpenRouter call) is left out — it requires a live key
 *   and network access; the existing openrouter.ts test pattern is the
 *   reference for that.
 * @version-history
 *   v1.0.0 — 2026-05-29 — Initial.
 */
// Run: cd aimeat && pnpm exec tsx test/ai.ts
// Requires: server running on port 40251 with AIMEAT_ENCRYPTION_KEY set

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: unknown) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: ${msg}`);
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
  type AnyBody = Record<string, unknown> & { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } };
  const body = ct.includes('json')
    ? (await res.json() as AnyBody)
    : ({ _raw: await res.text(), _ct: ct } as unknown as AnyBody);
  return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `aitest${Date.now()}`;

console.log('\n=== AI capability E2E tests ===\n');

// ─── Setup: register + auth ───
await test('Register test owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = (body.data as { private_key?: string })?.private_key ?? '';
  assert(ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner sign-in → token', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = (body.data as { token?: string })?.token ?? '';
  assert(ownerToken.length > 0, 'got owner token');
});

// ─── Auth enforcement ───
console.log('\nAuth enforcement');

await test('POST /v1/ai/complete without auth → 401', async () => {
  const { status } = await json('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hello' }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/ai/usage without auth → 401', async () => {
  const { status } = await json('/v1/ai/usage');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/ai/settings without auth → 401', async () => {
  const { status } = await json('/v1/ai/settings');
  assert(status === 401, `expected 401, got ${status}`);
});

// ─── Validation ───
console.log('\nValidation');

await test('POST /v1/ai/complete without prompt → 400 INVALID_BODY', async () => {
  const { status, body } = await json('/v1/ai/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({}),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.error?.code === 'INVALID_BODY', `expected INVALID_BODY, got ${body.error?.code}`);
});

await test('POST /v1/ai/complete with no key → 400 NO_API_KEY', async () => {
  const { status, body } = await json('/v1/ai/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ prompt: 'hello' }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NO_API_KEY', `expected NO_API_KEY, got ${body.error?.code}`);
});

await test('POST /v1/ai/complete with overlong prompt → 400 PROMPT_TOO_LONG', async () => {
  const big = 'x'.repeat(200_001);
  const { status, body } = await json('/v1/ai/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ prompt: big }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'PROMPT_TOO_LONG', `expected PROMPT_TOO_LONG, got ${body.error?.code}`);
});

// ─── Settings CRUD ───
console.log('\nSettings');

await test('GET /v1/ai/settings shows defaults for a fresh user', async () => {
  const { status, body } = await json('/v1/ai/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}`);
  const d = body.data as { daily_budget_usd?: number; app_quotas?: Record<string, unknown>; app_allowlist?: unknown };
  assert(d?.daily_budget_usd === 1.0, `expected default $1, got ${d?.daily_budget_usd}`);
  assert(typeof d?.app_quotas === 'object', 'app_quotas object present');
  assert(d?.app_allowlist === null, 'app_allowlist null by default');
});

await test('POST /v1/ai/settings updates daily budget', async () => {
  const { status, body } = await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ daily_budget_usd: 2.5 }),
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert((body.data as { saved?: boolean })?.saved === true, 'data.saved true');
});

await test('GET /v1/ai/settings reflects updated budget', async () => {
  const { body } = await json('/v1/ai/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const d = body.data as { daily_budget_usd?: number };
  assert(d?.daily_budget_usd === 2.5, `expected $2.5, got ${d?.daily_budget_usd}`);
});

await test('POST /v1/ai/settings with negative budget → 400 INVALID_BUDGET', async () => {
  const { status, body } = await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ daily_budget_usd: -1 }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.error?.code === 'INVALID_BUDGET', `expected INVALID_BUDGET, got ${body.error?.code}`);
});

await test('POST /v1/ai/settings sets app allowlist', async () => {
  const { status } = await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ app_allowlist: ['comicland-v2'] }),
  });
  assert(status === 200, `expected 200, got ${status}`);
});

await test('Allowlisted user: call without app_id → 403 APP_ID_REQUIRED', async () => {
  const { status, body } = await json('/v1/ai/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ prompt: 'hello' }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'APP_ID_REQUIRED', `expected APP_ID_REQUIRED, got ${body.error?.code}`);
});

await test('Allowlisted user: call with disallowed app → 403 APP_NOT_ALLOWED', async () => {
  const { status, body } = await json('/v1/ai/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ prompt: 'hello', app_id: 'random-app' }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'APP_NOT_ALLOWED', `expected APP_NOT_ALLOWED, got ${body.error?.code}`);
});

// ─── Usage ───
console.log('\nUsage');

await test('GET /v1/ai/usage shows zero spend for fresh user', async () => {
  // Reset settings (clear allowlist) so the user can call freely in the future.
  await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ app_allowlist: null }),
  });
  const { status, body } = await json('/v1/ai/usage', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}`);
  const d = body.data as { spent_today_usd?: number; total_calls?: number };
  assert(d?.spent_today_usd === 0, `expected $0 spent, got ${d?.spent_today_usd}`);
  assert(d?.total_calls === 0, `expected 0 calls, got ${d?.total_calls}`);
});

// ─── Library availability ───
console.log('\nLibrary');

await test('GET /v1/libs/aimeat-ai.js serves the lib', async () => {
  const res = await fetch(`${BASE}/v1/libs/aimeat-ai.js`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes('AIMEAT.ai'), 'lib defines AIMEAT.ai');
  assert(text.includes('isAvailable'), 'lib exposes isAvailable');
  assert(text.includes('complete'), 'lib exposes complete');
  assert(text.includes('completeJson'), 'lib exposes completeJson');
});

await test('GET /v1/libs lists aimeat-ai', async () => {
  const { body } = await json('/v1/libs');
  const libs = (body.libraries as Array<{ name?: string }>) || [];
  const found = libs.find(l => l.name === 'aimeat-ai');
  assert(!!found, 'aimeat-ai listed in /v1/libs');
});

// ─── Done ───
console.log(`\n${passed}/${passed + failed} passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
if (failed > 0) process.exit(1);
