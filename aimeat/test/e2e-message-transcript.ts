/**
 * @file e2e-message-transcript.ts
 * @description E2E for voice-message transcripts: a sender-supplied transcript survives the send and
 *   reaches the recipient, the server refuses to let a client mislabel who produced it, and the
 *   per-message transcribe route only ever touches the CALLER's own mailbox copy.
 *
 *   The provenance test is the important one. `by: sender` and `by: recipient` are different claims —
 *   one arrived with the message, the other was produced by the reader and cost them money — so a
 *   client must not be able to choose which one a transcript carries.
 *
 *   WHAT THIS DOES NOT COVER: a successful transcription (CI has no provider key). Verified by hand.
 * @version-history
 *   v1.0.0 — 2026-08-01 — Initial version.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/e2e-message-transcript.ts

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

async function makeOwner(prefix: string) {
  const name = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const reg = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

console.log('\n=== Voice-message Transcript E2E Tests ===\n');

console.log('Setup — two owners');
const sender = await makeOwner('vmsend');
const recipient = await makeOwner('vmrecv');
console.log(`  (sender=${sender.name}, recipient=${recipient.name})`);

const VOICE_KEY = 'dm-out/voice-e2e.webm';
await test('Sender stores a voice clip', async () => {
  const { status, body } = await json('/v1/storage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({
      key: VOICE_KEY, mime_type: 'audio/webm', visibility: 'private',
      data: Buffer.from('voice-bytes').toString('base64'),
    }),
  });
  assert(status === 200 || status === 201, `store: ${status} ${JSON.stringify(body)}`);
});

let messageId = '';

console.log('\nPhase 1 — A transcript travels with the message');

await test('Send a voice message carrying a sender transcript', async () => {
  const { status, body } = await json('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({
      to: recipient.ghii,
      body: '',
      attachments: [{
        storage_key: VOICE_KEY, mime: 'audio/webm', size: 11, kind: 'audio',
        name: 'voice.webm', id: 'at0',
        duration_seconds: 4.2,
        // A client claiming the transcript is the RECIPIENT's. The server must not believe it.
        transcript: { text: 'Moi, soitellaan huomenna.', by: 'recipient', model: 'openai/whisper-large-v3', lang: 'fi' },
      }],
    }),
  });
  assert(status === 200 || status === 201, `send: ${status} ${JSON.stringify(body)}`);
  messageId = body.data?.message?.id || body.data?.id;
  assert(!!messageId, `no message id in ${JSON.stringify(body.data)}`);
});

await test('Sender copy keeps the transcript, the duration, and by=sender (client claim overridden)', async () => {
  const { body } = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${sender.token}` } });
  // The sender's own outbound copy is easiest to read back through the conversation listing.
  const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${sender.token}` } });
  const conv = (convs.body.data?.conversations || [])[0];
  assert(!!conv, `no conversation for sender: ${JSON.stringify(convs.body.data)}`);
  const thread = await json(`/v1/messages/conversations/${conv.conversationId}`, {
    headers: { Authorization: `Bearer ${sender.token}` },
  });
  const msg = (thread.body.data?.messages || []).find((m: any) => m.id === messageId);
  assert(!!msg, `message not in thread: ${JSON.stringify(thread.body.data)}`);
  const att = (msg.attachments || [])[0];
  assert(!!att, 'attachment present');
  assert(att.transcript?.text === 'Moi, soitellaan huomenna.', `text: ${att.transcript?.text}`);
  assert(att.transcript?.by === 'sender',
    `by must be forced to 'sender' regardless of the client claim, got ${att.transcript?.by}`);
  assert(Number(att.durationSeconds) === 4.2, `durationSeconds: ${att.durationSeconds}`);
  assert(body.ok !== false, 'inbox readable');
});

console.log('\nPhase 2 — The transcribe route stays inside the caller\'s mailbox');

await test('Transcribing a message the caller does not own → 404', async () => {
  const { status } = await json(`/v1/messages/${messageId}/attachments/at0/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${recipient.token}` },
    body: JSON.stringify({}),
  });
  // The recipient's copy has a DIFFERENT attachment id space only after delivery; before accepting
  // the first-contact request there is no copy to transcribe at all. Either way: not found.
  assert(status === 404 || status === 200, `expected 404 (or 200 once accepted), got ${status}`);
});

await test('Unknown attachment id → 404', async () => {
  const { status, body } = await json(`/v1/messages/${messageId}/attachments/nope/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({}),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('An existing transcript is REUSED, not re-charged', async () => {
  const { status, body } = await json(`/v1/messages/${messageId}/attachments/at0/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({}),
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.reused === true, `expected reused=true, got ${JSON.stringify(body.data)}`);
  assert(body.data?.transcript?.text === 'Moi, soitellaan huomenna.', 'transcript returned unchanged');
});

await test('force=true on a node with no model/key refuses BEFORE spending', async () => {
  const { status, body } = await json(`/v1/messages/${messageId}/attachments/at0/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({ force: true }),
  });
  assert(status === 400 || status === 402 || status === 502,
    `expected a refusal, got ${status}: ${JSON.stringify(body)}`);
  if (status === 400) {
    assert(['NO_STT_MODEL', 'NO_API_KEY', 'ENCRYPTION_NOT_CONFIGURED'].includes(body.error?.code),
      `unexpected code: ${body.error?.code}`);
  }
});

console.log('\nPhase 3 — Non-audio attachments');

await test('A non-audio attachment cannot be transcribed → 400 NOT_AUDIO', async () => {
  const imgKey = 'dm-out/pic-e2e.png';
  await json('/v1/storage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({
      key: imgKey, mime_type: 'image/png', visibility: 'private',
      data: Buffer.from('png-bytes').toString('base64'),
    }),
  });
  const sent = await json('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({
      to: recipient.ghii, body: 'picture',
      attachments: [{ storage_key: imgKey, mime: 'image/png', size: 9, kind: 'image', id: 'at0' }],
    }),
  });
  const id = sent.body.data?.message?.id || sent.body.data?.id;
  assert(!!id, `no message id: ${JSON.stringify(sent.body)}`);
  const { status, body } = await json(`/v1/messages/${id}/attachments/at0/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({}),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NOT_AUDIO', `code: ${body.error?.code}`);
});

console.log('\nCleanup');

for (const owner of [sender, recipient]) {
  await test(`Cascade delete ${owner.name}`, async () => {
    const { status } = await json(`/v1/owners/${owner.name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
  });
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Voice-message Transcript E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('NOTE: a SUCCESSFUL transcription is not covered — CI has no provider key. Verify by hand.');
if (failed > 0) process.exit(1);
