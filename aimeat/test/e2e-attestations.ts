/**
 * @file e2e-attestations.ts
 * @description E2E tests for dual-signed attestations (TINKI phase 1): an append-only record
 *   two-to-four principals co-sign with their registered Ed25519 keys — the trade-deed primitive.
 *   Covers the full signing lifecycle, party gating, bad signatures, immutability after
 *   completion, and public verifiability without auth.
 * @version-history
 *   v1.1.0 — 2026-08-17 — E2E quality, attestations:162. Every attestation in the file had exactly two
 *     parties, so "the last party signed" and "a second signature arrived" were the same event and the
 *     completion rule was never told apart from counting to two. Test 8b runs a three-party deed: the
 *     middle signature must leave it open with the third slot empty, the third completes it, and the
 *     public reader verifies it.
 *   v1.0.0 — 2026-08-06 — Initial: create/sign/complete + authz and immutability failures
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-attestations.ts

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
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

async function makeOwner(name: string): Promise<{ token: string; ghii: string; privKey: string }> {
  const reg = await json('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username: name, display_name: name, password: 'AttestTest1234' }),
  });
  assert(reg.status === 201, `register ${name}: ${reg.status}`);
  const privKey = reg.body.data.private_key;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, name + NODE_ID + timestamp);
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}`, privKey };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Attestations E2E Test ===\n');

const aName = `attsigna${Date.now()}`;
const bName = `attsignb${Date.now()}`;
const cName = `attsignc${Date.now()}`;
let A!: { token: string; ghii: string; privKey: string };
let B!: { token: string; ghii: string; privKey: string };
let C!: { token: string; ghii: string; privKey: string };

console.log('Setup');
await test('Register three owners', async () => {
  A = await makeOwner(aName);
  B = await makeOwner(bName);
  C = await makeOwner(cName);
});

const payload = { kind: 'tinki-deed', listing: 'l-123', price: 62_000000, currency: 'EUR' };
let attId = '';
let payloadHash = '';

console.log('\nPhase 1 — create');

await test('1. A creates an attestation with parties [A, B]', async () => {
  const { status, body } = await json('/v1/attestations', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ payload, parties: [A.ghii, B.ghii], reference: 'tinki-listing-1' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const att = body.data.attestation;
  assert(att.state === 'open', `state: ${att.state}`);
  assert(typeof att.payloadHash === 'string' && att.payloadHash.length === 64, 'has sha256 payloadHash');
  assert(Array.isArray(att.parties) && att.parties.length === 2, 'has parties');
  attId = att.id;
  payloadHash = att.payloadHash;
});

await test('2. Creator must be a party', async () => {
  const { status } = await json('/v1/attestations', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ payload, parties: [B.ghii, C.ghii] }),
  });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('3. Unknown party is rejected', async () => {
  const { status } = await json('/v1/attestations', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ payload, parties: [A.ghii, `nobody-xyz@${NODE_ID}`] }),
  });
  assert(status === 404, `expected 404, got ${status}`);
});

console.log('\nPhase 2 — sign');

await test('4. Non-party cannot sign', async () => {
  const signature = await signMsg(C.privKey, `aimeat-attest:${attId}:${payloadHash}`);
  const { status } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(C.token), body: JSON.stringify({ signature }),
  });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('5. A signs with a valid signature (still open)', async () => {
  const signature = await signMsg(A.privKey, `aimeat-attest:${attId}:${payloadHash}`);
  const { status, body } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ signature }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const att = body.data.attestation;
  assert(att.state === 'open', `state: ${att.state}`);
  assert(att.signatures[A.ghii], 'A signature recorded');
});

await test('6. A cannot sign twice', async () => {
  const signature = await signMsg(A.privKey, `aimeat-attest:${attId}:${payloadHash}`);
  const { status } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ signature }),
  });
  assert(status === 409, `expected 409, got ${status}`);
});

await test('7. A wrong signature is rejected', async () => {
  const signature = await signMsg(B.privKey, `aimeat-attest:${attId}:WRONG`);
  const { status } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(B.token), body: JSON.stringify({ signature }),
  });
  assert(status === 422, `expected 422, got ${status}`);
});

await test('8. B signs — attestation completes', async () => {
  const signature = await signMsg(B.privKey, `aimeat-attest:${attId}:${payloadHash}`);
  const { status, body } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(B.token), body: JSON.stringify({ signature }),
  });
  assert(status === 200, `status ${status}`);
  const att = body.data.attestation;
  assert(att.state === 'complete', `state: ${att.state}`);
  assert(typeof att.completedAt === 'string', 'completedAt set');
});

/**
 * EVERY ATTESTATION IN THIS FILE HAS EXACTLY TWO PARTIES, so "the last party signed" and "a second
 * signature arrived" are the same event, and the rule that decides completion — every party present,
 * not merely more than one — has never been distinguished from counting to two.
 *
 * Three parties separate them. The middle signature is the one that matters: it must leave the deed
 * OPEN, and the third party's slot must still be empty.
 */
await test('8b. With three parties, the deed completes only when the third one signs', async () => {
  const created = await json('/v1/attestations', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ payload, parties: [A.ghii, B.ghii, C.ghii], reference: 'tinki-listing-3' }),
  });
  assert(created.status === 201, `create: ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`);
  const id = created.body.data.attestation.id as string;
  const hash = created.body.data.attestation.payloadHash as string;
  assert(created.body.data.attestation.state === 'open', 'a fresh deed is open');

  const sign = async (who: { token: string; privKey: string }) => json(`/v1/attestations/${id}/sign`, {
    method: 'POST', headers: authed(who.token),
    body: JSON.stringify({ signature: await signMsg(who.privKey, `aimeat-attest:${id}:${hash}`) }),
  });

  const first = await sign(A);
  assert(first.status === 200, `A signs: ${first.status}`);
  assert(first.body.data.attestation.state === 'open', `one of three must leave it open, got ${first.body.data.attestation.state}`);

  const second = await sign(B);
  assert(second.status === 200, `B signs: ${second.status}`);
  assert(second.body.data.attestation.state === 'open',
    `two of three must STILL leave it open, got ${second.body.data.attestation.state}`);
  assert(second.body.data.attestation.signatures[C.ghii] === undefined,
    'the third party has not signed and must have no signature');
  assert(!second.body.data.attestation.completedAt, 'completedAt must not be set while a party is missing');

  const third = await sign(C);
  assert(third.status === 200, `C signs: ${third.status}`);
  assert(third.body.data.attestation.state === 'complete', `the third signature completes it, got ${third.body.data.attestation.state}`);
  assert(typeof third.body.data.attestation.completedAt === 'string', 'completedAt set');

  // …and the public reader agrees, which is the answer anyone outside actually gets.
  const read = await json(`/v1/attestations/${id}`);
  assert(read.status === 200, `public read: ${read.status}`);
  assert(read.body.data.verified === true, `a complete three-party deed must verify: ${JSON.stringify(read.body.data.verified)}`);
});

await test('9. Signing after completion is refused (append-only)', async () => {
  const signature = await signMsg(A.privKey, `aimeat-attest:${attId}:${payloadHash}`);
  const { status } = await json(`/v1/attestations/${attId}/sign`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ signature }),
  });
  assert(status === 409, `expected 409, got ${status}`);
});

console.log('\nPhase 3 — public verifiability');

await test('10. Anyone can read and the node verifies the signatures', async () => {
  const { status, body } = await json(`/v1/attestations/${attId}`);
  assert(status === 200, `status ${status}`);
  const att = body.data.attestation;
  assert(att.state === 'complete', `state: ${att.state}`);
  assert(body.data.verified === true, `verified: ${body.data.verified}`);
  assert(att.payload.listing === 'l-123', 'payload readable');
});

await test('11. Unknown attestation is 404', async () => {
  const { status } = await json('/v1/attestations/att-does-not-exist');
  assert(status === 404, `expected 404, got ${status}`);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
