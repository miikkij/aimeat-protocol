/**
 * @file openrouter.ts
 * @description E2E tests for OpenRouter settings endpoints.
 *   Tests save/retrieve/delete of encrypted API key and preferences,
 *   auth enforcement (401 without token), and validation errors on /complete.
 * @version-history
 *   v1.1.0 — 2026-08-01 — Phase 5: speech-to-text settings (sttModel/sttLanguage round-trip, empty
 *     clears rather than falling back), the node limits served with the settings, and the
 *     ?modality= parameter on the model listing.
 *   v1.0.0 — 2026-03-20 — Initial implementation
 */

// Run: cd aimeat && pnpm exec tsx test/openrouter.ts
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
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `ortest${Date.now()}`;

// Track whether encryption is available

console.log('\n=== OpenRouter Settings E2E Tests ===\n');

// ─── Setup: Register owner ───
console.log('Setup — Register owner');

await test('Register test owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth — sign + token', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

// ─── Phase 1: Auth enforcement ───
console.log('\nPhase 1 — Auth enforcement (401 without token)');

await test('PUT /v1/openrouter/settings without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/settings', {
    method: 'PUT',
    body: JSON.stringify({ apiKey: 'sk-test', model: 'openai/gpt-4o' }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/openrouter/settings without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/settings');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('DELETE /v1/openrouter/settings without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/settings', { method: 'DELETE' });
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/openrouter/models without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/models');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('POST /v1/openrouter/test without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/test', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await test('POST /v1/openrouter/complete without auth → 401', async () => {
  const { status } = await json('/v1/openrouter/complete', {
    method: 'POST',
    body: JSON.stringify({ projectId: 'p1', prompt: 'hello' }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

// ─── Phase 2: Settings CRUD ───
console.log('\nPhase 2 — Settings CRUD');

await test('PUT /v1/openrouter/settings — save API key and preferences', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      apiKey: 'sk-or-test-key-abc123',
      model: 'openai/gpt-4o-mini',
      autoRetry: true,
      maxRetries: 5,
    }),
  });

  // 503 is NOT an environment question here. AIMEAT_ENCRYPTION_KEY is set in .env.test.sqlite and
  // .env.test.postgres-kysely and defaulted again in test/run-e2e-server.ts, so an ENCRYPTION_NOT_
  // CONFIGURED answer means the node is broken. This used to return early and take twelve tests with
  // it, which is how a suite disables itself without anyone noticing.
  assert(status !== 503, `encryption must be configured on the test node, got 503: ${JSON.stringify(body)}`);

  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `body.ok: ${JSON.stringify(body)}`);
  assert(body.data?.saved === true, `data.saved: ${JSON.stringify(body.data)}`);
});

await test('GET /v1/openrouter/settings — returns hasApiKey: true, no raw key', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, 'body.ok');
  assert(body.data?.hasApiKey === true, `hasApiKey should be true: ${JSON.stringify(body.data)}`);
  // Verify preferences were saved
  assert(body.data?.model === 'openai/gpt-4o-mini', `model: ${body.data?.model}`);
  assert(body.data?.autoRetry === true, `autoRetry: ${body.data?.autoRetry}`);
  assert(body.data?.maxRetries === 5, `maxRetries: ${body.data?.maxRetries}`);
});

await test('GET /v1/openrouter/settings — no apiKey or encrypted field in response', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}`);
  // The raw API key must never appear in the response
  assert(!('apiKey' in (body.data ?? {})), `apiKey must not be in response: ${JSON.stringify(body.data)}`);
  assert(!('encrypted' in (body.data ?? {})), `encrypted must not be in response: ${JSON.stringify(body.data)}`);
  // Verify the raw key string is not present anywhere in the serialized response
  const serialized = JSON.stringify(body);
  assert(!serialized.includes('sk-or-test-key-abc123'), 'raw API key must not appear in response');
});

await test('PUT /v1/openrouter/settings — update preferences only (no apiKey)', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ model: 'anthropic/claude-3-haiku', maxRetries: 2 }),
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.saved === true, 'saved');
});

await test('GET /v1/openrouter/settings — preferences updated, hasApiKey still true', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.data?.hasApiKey === true, 'hasApiKey still true after pref-only update');
  assert(body.data?.model === 'anthropic/claude-3-haiku', `model updated: ${body.data?.model}`);
  assert(body.data?.maxRetries === 2, `maxRetries updated: ${body.data?.maxRetries}`);
});

await test('PUT/GET /v1/openrouter/settings — visionModel persists and clears', async () => {
  // Set a vision-capable model (used for image inputs — the Secretary doc/image intake).
  const set = await json('/v1/openrouter/settings', {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ visionModel: 'qwen/qwen-2.5-vl-72b-instruct' }),
  });
  assert(set.status === 200 && set.body.data?.saved === true, `set visionModel: ${set.status} ${JSON.stringify(set.body)}`);
  const got = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(got.body.data?.visionModel === 'qwen/qwen-2.5-vl-72b-instruct', `visionModel persisted: ${got.body.data?.visionModel}`);
  // Clearing it (null) falls back to the default model for image requests.
  const clear = await json('/v1/openrouter/settings', {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ visionModel: null }),
  });
  assert(clear.status === 200, `clear visionModel: ${clear.status}`);
  const got2 = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(got2.body.data?.visionModel === null, `visionModel cleared: ${JSON.stringify(got2.body.data?.visionModel)}`);
});

await test('DELETE /v1/openrouter/settings — removes key and settings', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.deleted === true, `data.deleted: ${JSON.stringify(body.data)}`);
});

await test('GET /v1/openrouter/settings after delete — hasApiKey: false', async () => {
  const { status, body } = await json('/v1/openrouter/settings', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.hasApiKey === false, `hasApiKey should be false after delete: ${JSON.stringify(body.data)}`);
});

// ─── Phase 3: /complete validation ───
console.log('\nPhase 3 — /complete validation');

await test('POST /v1/openrouter/complete without projectId → 400', async () => {
  const { status, body } = await json('/v1/openrouter/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ prompt: 'hello world' }),
  });
  // If encryption not configured, expect 503; otherwise 400
  assert(
    status === 400 || status === 503,
    `expected 400 or 503, got ${status}: ${JSON.stringify(body)}`
  );
  if (status === 400) {
    assert(body.error?.code === 'INVALID_BODY', `error code: ${body.error?.code}`);
  }
});

await test('POST /v1/openrouter/complete without prompt → 400', async () => {
  const { status, body } = await json('/v1/openrouter/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ projectId: 'test-project-id' }),
  });
  assert(
    status === 400 || status === 503,
    `expected 400 or 503, got ${status}: ${JSON.stringify(body)}`
  );
  if (status === 400) {
    assert(body.error?.code === 'INVALID_BODY', `error code: ${body.error?.code}`);
  }
});

await test('POST /v1/openrouter/complete with non-existent project → 404', async () => {
  const { status, body } = await json('/v1/openrouter/complete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ projectId: 'nonexistent-project-xyz', prompt: 'hello world' }),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NOT_FOUND', `error code: ${body.error?.code}`);
});

// ─── Phase 5: Speech-to-text settings ───
console.log('\nPhase 5 — Speech-to-text settings');

await test('PUT settings — sttModel + sttLanguage round-trip', async () => {
  const put = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ sttModel: 'openai/whisper-large-v3', sttLanguage: 'fi' }),
  });
  assert(put.status === 200, `PUT status ${put.status}: ${JSON.stringify(put.body)}`);

  const get = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(get.body.data?.sttModel === 'openai/whisper-large-v3', `sttModel: ${get.body.data?.sttModel}`);
  assert(get.body.data?.sttLanguage === 'fi', `sttLanguage: ${get.body.data?.sttLanguage}`);
});

await test('PUT settings — empty sttModel CLEARS it (transcription off, no silent fallback)', async () => {
  await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ sttModel: '' }),
  });
  const get = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  // null, not the default model: sending audio to a text model would produce an opaque provider
  // error instead of "choose a transcription model".
  assert(get.body.data?.sttModel === null, `expected null, got ${JSON.stringify(get.body.data?.sttModel)}`);
});

await test('GET settings — node limits are served with the settings', async () => {
  const { body } = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${ownerToken}` } });
  const limits = body.data?.limits;
  assert(!!limits, 'limits present');
  assert(typeof limits.voice_msg_max_seconds === 'number' && limits.voice_msg_max_seconds > 0,
    `voice_msg_max_seconds: ${limits.voice_msg_max_seconds}`);
  assert(typeof limits.stt_max_mb === 'number' && limits.stt_max_mb > 0, `stt_max_mb: ${limits.stt_max_mb}`);
});

await test('GET /v1/openrouter/models?modality=transcription — accepted and echoed', async () => {
  const { status, body } = await json('/v1/openrouter/models?modality=transcription', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  // Without a real provider key this is a 400/502; what matters here is that the parameter is
  // ACCEPTED rather than rejected as unknown, and that a success echoes which catalogue was read.
  assert(status !== 404 && status !== 422, `unexpected status ${status}: ${JSON.stringify(body)}`);
  if (status === 200) assert(body.data?.modality === 'transcription', `modality echo: ${body.data?.modality}`);
});

await test('GET /v1/openrouter/models?modality=bogus — falls back to chat, never errors', async () => {
  const { status, body } = await json('/v1/openrouter/models?modality=bogus', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status !== 500, `unexpected 500: ${JSON.stringify(body)}`);
  if (status === 200) assert(body.data?.modality === 'chat', `modality: ${body.data?.modality}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade delete owner', async () => {
  const { status } = await json(`/v1/owners/${ownerName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200 || status === 204, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`OpenRouter E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
