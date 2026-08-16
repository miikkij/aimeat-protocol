/**
 * @file e2e-ai-transcribe.ts
 * @description E2E for POST /v1/ai/transcribe — the speech-to-text endpoint. Covers the gates that
 *   must hold regardless of any provider: authentication, the ownership boundary on `storage_key`,
 *   the "no model chosen" refusal, size limits, and the daily budget.
 *
 *   WHAT THIS DOES NOT COVER: a successful transcription. CI has no provider key, so every call that
 *   would reach OpenRouter stops at NO_API_KEY. A real transcription is verified by hand with a key
 *   before the feature is called done — stated here rather than left for someone to assume.
 * @version-history
 *   v1.0.0 — 2026-08-01 — Initial version.
 */
// 2026-08-16 (August 2026 test-quality audit, e2e-ai-transcribe:96): every call here was an owner
// session, so gateOwnerOrAiUseAgent — the word that stops an agent from spending the owner's provider
// budget — was never executed on THIS route; the same gate is exercised elsewhere only on
// /v1/ai/complete. Phase 1 now drives both halves: an agent without ai:use is refused 403 with the
// word named, and one with it is past the gate and gets a work-level answer instead. Measured with
// the transcribe gate deleted (src/routes/ai.ts:194): the scopeless agent walks through it.

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/e2e-ai-transcribe.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
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
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

/** Register an owner and return { name, token }. */
async function makeOwner(prefix: string) {
  const name = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const reg = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const privKey = reg.body.data.private_key;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, name + NODE_ID + timestamp);
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { name, token: tok.body.data.token as string };
}

console.log('\n=== AI Transcription E2E Tests ===\n');

console.log('Setup — two owners');
const alice = await makeOwner('sttalice');
const mallory = await makeOwner('sttmallory');
console.log(`  (alice=${alice.name}, mallory=${mallory.name})`);

// Alice uploads an audio file so there is a real storage key to point at. The bytes are not valid
// audio; nothing in these tests reaches a decoder, and every path that would is gated first.
const AUDIO_KEY = 'stt-test/clip.webm';
await test('Setup — alice stores an audio file', async () => {
  const { status, body } = await json('/v1/storage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      key: AUDIO_KEY,
      mime_type: 'audio/webm',
      visibility: 'private',
      data: Buffer.from('not-really-audio').toString('base64'),
    }),
  });
  assert(status === 200 || status === 201, `store: ${status} ${JSON.stringify(body)}`);
});

console.log('\nPhase 1 — Gate');

await test('POST /v1/ai/transcribe without auth → 401', async () => {
  const { status } = await json('/v1/ai/transcribe', {
    method: 'POST',
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

// 401 is the door; the gate that matters on this route is gateOwnerOrAiUseAgent, because a
// transcription spends the OWNER's provider key against their daily budget. Every call in this file
// was an owner session, and no other suite touches transcribe with a non-owner principal — the same
// gate is only ever exercised on /v1/ai/complete.
await test('An agent WITHOUT ai:use is refused → 403 naming the word', async () => {
  const reg = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ name: 'sttnarrow', owner: alice.name, capabilities: ['memory'], scopes: ['memory:read'] }),
  });
  assert(reg.status === 201, `create agent: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
  });
  assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);

  const r = await json('/v1/ai/transcribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tok.body.data.token}` },
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body.error)}`);
  assert(JSON.stringify(r.body.error ?? '').includes('ai:use'), `the refusal must name the word: ${JSON.stringify(r.body.error)}`);
});

await test('An agent WITH ai:use passes the gate and meets the same refusal an owner gets', async () => {
  const reg = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ name: 'sttwide', owner: alice.name, capabilities: ['memory'], scopes: ['memory:read', 'ai:use'] }),
  });
  assert(reg.status === 201, `create agent: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
  });
  assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);

  const r = await json('/v1/ai/transcribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tok.body.data.token}` },
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  assert(r.status !== 403, `an ai:use agent must be past the gate, got 403: ${JSON.stringify(r.body.error)}`);
  // Past the gate the route answers about the WORK, not about permission. Here that is a 404: the
  // storage lookup is keyed to the calling principal, and the fixture was stored by the owner, so
  // the agent has no such file of its own. 400/402/502 are the other work-level answers.
  assert([400, 402, 404, 502].includes(r.status),
    `expected a work-level refusal rather than a permission one, got ${r.status}: ${JSON.stringify(r.body.error)}`);
  assert(!JSON.stringify(r.body.error ?? '').includes('ai:use'), `and not the scope refusal: ${JSON.stringify(r.body.error)}`);
});

await test('No audio source → 400 INVALID_BODY', async () => {
  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({}),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'INVALID_BODY', `code: ${body.error?.code}`);
});

console.log('\nPhase 2 — Ownership boundary');

await test('Unknown storage key → 404', async () => {
  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ storage_key: 'stt-test/does-not-exist.webm' }),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test("Another owner's storage key → 404, not 403 (existence is not disclosed)", async () => {
  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${mallory.token}` },
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
  assert(!JSON.stringify(body).includes(alice.name), 'response must not name the other owner');
});

console.log('\nPhase 3 — Model + size + budget');

await test('No sttModel configured → 400 NO_STT_MODEL (never falls back to the text model)', async () => {
  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  // NO_API_KEY can win the race on a node with no encryption key configured; both are the same
  // refusal-before-spending, and neither may be a silent fallback to the default text model.
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(['NO_STT_MODEL', 'NO_API_KEY', 'ENCRYPTION_NOT_CONFIGURED'].includes(body.error?.code),
    `unexpected code: ${body.error?.code}`);
});

await test('Oversized inline audio → 400 AUDIO_TOO_LARGE (before any provider call)', async () => {
  // 8.1 MB of base64 — over the inline ceiling, well under the storage quota, so this can only be
  // the inline guard talking.
  const huge = 'A'.repeat(8_100_000);
  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ audio_base64: huge, mime: 'audio/webm' }),
  });
  assert(status === 400 || status === 413, `expected 400/413, got ${status}: ${JSON.stringify(body)}`);
  if (status === 400) {
    assert(body.error?.code === 'AUDIO_TOO_LARGE', `code: ${body.error?.code}`);
  }
});

await test('Daily budget spent → 402, and the budget check precedes the provider', async () => {
  const put = await json('/v1/openrouter/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ sttModel: 'openai/whisper-large-v3', apiKey: 'sk-or-v1-fake-for-test' }),
  });
  if (put.status === 503) { console.log('    (Skipped — encryption not configured on this node)'); return; }
  assert(put.status === 200, `settings PUT: ${put.status} ${JSON.stringify(put.body)}`);

  const budget = await json('/v1/ai/settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ daily_budget_usd: 0 }),
  });
  assert(budget.status === 200, `budget POST: ${budget.status}`);

  const { status, body } = await json('/v1/ai/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ storage_key: AUDIO_KEY }),
  });
  assert(status === 402, `expected 402, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'QUOTA_EXHAUSTED', `code: ${body.error?.code}`);
});

console.log('\nCleanup');

for (const owner of [alice, mallory]) {
  await test(`Cascade delete ${owner.name}`, async () => {
    const { status } = await json(`/v1/owners/${owner.name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
  });
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`AI Transcription E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('NOTE: a SUCCESSFUL transcription is not covered — CI has no provider key. Verify by hand.');
if (failed > 0) process.exit(1);
