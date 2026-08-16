/**
 * @file ai.ts
 * @description E2E tests for the app-level AI endpoints (/v1/ai/*). Covers
 *   auth, validation, settings CRUD, and the NO_API_KEY rejection path. The
 *   "happy path" (real OpenRouter call) is left out — it requires a live key
 *   and network access; the existing openrouter.ts test pattern is the
 *   reference for that.
 * @version-history
 *   v1.0.0 — 2026-05-29 — Initial.
 *   v1.1.0 — 2026-06-25 — Cover GET /v1/ai/available (auth + keyless-owner false) and assert the
 *     aimeat-ai.js lib probes it.
 *   v1.2.0 — 2026-07-05 — Assert per-app quota default is null (= the daily budget) and that a
 *     per-app quota round-trips through /v1/ai/settings.
 */
// Run: cd aimeat && pnpm exec tsx test/ai.ts
// Requires: server running on port 40251 with AIMEAT_ENCRYPTION_KEY set

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

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

await test('GET /v1/ai/available without auth → 401', async () => {
  const { status } = await json('/v1/ai/available');
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
  const d = body.data as { daily_budget_usd?: number; app_quotas?: Record<string, unknown>; app_allowlist?: unknown; defaults?: { per_app_daily_usd?: number | null } };
  assert(d?.daily_budget_usd === 1.0, `expected default $1, got ${d?.daily_budget_usd}`);
  assert(typeof d?.app_quotas === 'object', 'app_quotas object present');
  assert(d?.app_allowlist === null, 'app_allowlist null by default');
  // v1.4.0: an app defaults to the whole daily budget — no separate hidden per-app cap.
  assert(d?.defaults?.per_app_daily_usd === null, `expected per_app_daily_usd default null, got ${d?.defaults?.per_app_daily_usd}`);
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

await test('POST + GET /v1/ai/settings round-trips a per-app quota', async () => {
  const post = await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ app_quotas: { drop: { daily_usd: 0.5 } } }),
  });
  assert(post.status === 200, `expected 200, got ${post.status}: ${JSON.stringify(post.body)}`);
  const { body } = await json('/v1/ai/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  const q = (body.data as { app_quotas?: Record<string, { daily_usd?: number }> })?.app_quotas ?? {};
  assert(q.drop?.daily_usd === 0.5, `expected drop cap 0.5, got ${JSON.stringify(q.drop)}`);
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

// ─── Availability probe ───
console.log('\nAvailability');

await test('GET /v1/ai/available (owner, no key) → 200 { available:false }', async () => {
  const { status, body } = await json('/v1/ai/available', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  const d = body.data as { available?: boolean };
  assert(d?.available === false, `expected available:false for a keyless owner, got ${d?.available}`);
});

// ─── Library availability ───
console.log('\nLibrary');

await test('GET /v1/libs/aimeat-ai.js serves the lib', async () => {
  const res = await fetch(`${BASE}/v1/libs/aimeat-ai.js`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  // Componentized (SDK-libs migration): attaches via _core `attach('ai', …)` — not a literal
  // `AIMEAT.ai =` — and esbuild may normalize the quote style, so match either.
  assert(/attach\(["']ai["']/.test(text), 'lib attaches the AIMEAT.ai surface');
  assert(text.includes('isAvailable'), 'lib exposes isAvailable');
  assert(text.includes('/v1/ai/available'), 'isAvailable probes /v1/ai/available');
  assert(text.includes('complete'), 'lib exposes complete');
  assert(text.includes('completeJson'), 'lib exposes completeJson');
});

await test('GET /v1/libs lists aimeat-ai', async () => {
  const { body } = await json('/v1/libs');
  const libs = (body.libraries as Array<{ name?: string }>) || [];
  const found = libs.find(l => l.name === 'aimeat-ai');
  assert(!!found, 'aimeat-ai listed in /v1/libs');
});

await test('POST /v1/ai/complete needs ai:use — an agent without it is refused, one with it is not', async () => {
  // This is the endpoint that spends the owner's OpenRouter key against their daily budget, and the
  // gate is "an owner session OR a token carrying ai:use". Only a human owner session is ever used
  // here — no agent JWT, no app-grant token, no ecosystem token — so the scope half of
  // gateOwnerOrAiUseAgent is never reached. Weaken routes/ai.ts to `if (roles.includes('owner'))
  // return true;` — literally the H-2 defect the code comment above it records, where a mirrored
  // agent token spent the owner's AI budget without the word the owner would have had to grant — and
  // all 21 tests stay green. (e2e-librarian covers routes/librarian.ts, which is a SECOND copy of
  // this gate; nothing covered this one.)
  const mkAgent = async (name: string, scopes: string[]) => {
    const reg = await json('/v1/agents', {
      method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
    });
    assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = (reg.body.data as any).agent.gaii as string;
    const ts = new Date().toISOString();
    const t = await json('/v1/auth/token', {
      method: 'POST',
      body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg((reg.body.data as any).private_key, gaii + ts) }),
    });
    return (t.body.data as any).token as string;
  };

  const narrow = await mkAgent('ai-narrow', ['memory:read']);
  const refused = await json('/v1/ai/complete', {
    method: 'POST', headers: { Authorization: `Bearer ${narrow}` }, body: JSON.stringify({ prompt: 'hello' }),
  });
  assert(refused.status === 403,
    `an agent without ai:use reached the AI door: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
  assert(/ai:use/.test(JSON.stringify(refused.body?.error ?? {})),
    `the refusal must name the missing word: ${JSON.stringify(refused.body?.error)}`);

  // The positive control: with the word, the same agent gets PAST the gate and is stopped by the
  // missing API key instead — which is how we know the 403 above was the scope and not the door.
  const wide = await mkAgent('ai-wide', ['memory:read', 'ai:use']);
  const allowed = await json('/v1/ai/complete', {
    method: 'POST', headers: { Authorization: `Bearer ${wide}` }, body: JSON.stringify({ prompt: 'hello' }),
  });
  assert(allowed.status === 400 && (allowed.body as any).error?.code === 'NO_API_KEY',
    `a ticked agent should reach NO_API_KEY, got ${allowed.status} ${JSON.stringify(allowed.body?.error)}`);
});

// ─── Done ───
console.log(`\n${passed}/${passed + failed} passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
if (failed > 0) process.exit(1);
