/**
 * @file e2e-commerce-holds.ts
 * @description E2E tests for the commerce hold rail (TINKI phase 1): authorize a hold on the
 *   buyer's instrument without moving money, capture it (seller only, up to the held amount),
 *   release it (either party), and lazy expiry. Runs on the test.money handler
 *   (AIMEAT_TEST_MONEY_HANDLER=true) — no real PSP.
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial: hold lifecycle happy paths + authz failures (TINKI phase 1)
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-commerce-holds.ts

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

async function makeOwner(name: string): Promise<{ token: string; ghii: string }> {
  const reg = await json('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username: name, display_name: name, password: 'HoldTest1234' }),
  });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: name, timestamp, signature }),
  });
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}` };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Commerce Holds E2E Test ===\n');

const buyerName = `holdbuyer${Date.now()}`;
const sellerName = `holdseller${Date.now()}`;
const otherName = `holdother${Date.now()}`;
let buyer!: { token: string; ghii: string };
let seller!: { token: string; ghii: string };
let other!: { token: string; ghii: string };

console.log('Setup');
await test('Register buyer, seller and bystander', async () => {
  buyer = await makeOwner(buyerName);
  seller = await makeOwner(sellerName);
  other = await makeOwner(otherName);
});

// ─── Happy path: authorize → capture ───
console.log('\nPhase 1 — authorize + capture');

let holdId = '';
await test('1. Buyer places a hold (authorize, no money moves)', async () => {
  const { status, body } = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 80_000000, currency: 'EUR', purpose: 'bid',
      reference: 'tinki-listing-1', payment: { handler: 'test.money', instrument: 'pm_test_hold' },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const hold = body.data.hold;
  assert(hold.status === 'held', `status: ${hold.status}`);
  assert(hold.amount === 80_000000, `amount: ${hold.amount}`);
  assert(hold.sellerGhii === seller.ghii, `sellerGhii: ${hold.sellerGhii}`);
  assert(typeof hold.trackingCode === 'string' && hold.trackingCode.length > 0, 'has trackingCode');
  holdId = hold.id;
});

await test('2. Buyer and seller can both read the hold; bystander cannot', async () => {
  const b = await json(`/v1/commerce/holds/${holdId}`, { headers: authed(buyer.token) });
  assert(b.status === 200 && b.body.data.hold.id === holdId, `buyer read: ${b.status}`);
  const s = await json(`/v1/commerce/holds/${holdId}`, { headers: authed(seller.token) });
  assert(s.status === 200 && s.body.data.hold.id === holdId, `seller read: ${s.status}`);
  const o = await json(`/v1/commerce/holds/${holdId}`, { headers: authed(other.token) });
  assert(o.status === 404, `bystander read should 404 (no existence leak), got ${o.status}`);
});

await test('3. Buyer cannot capture (only the seller may)', async () => {
  const { status } = await json(`/v1/commerce/holds/${holdId}/capture`, {
    method: 'POST', headers: authed(buyer.token), body: JSON.stringify({}),
  });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('4. Capture above the held amount is rejected', async () => {
  const { status, body } = await json(`/v1/commerce/holds/${holdId}/capture`, {
    method: 'POST', headers: authed(seller.token),
    body: JSON.stringify({ amount: 90_000000 }),
  });
  assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
});

await test('5. Seller captures a partial amount (the second price)', async () => {
  const { status, body } = await json(`/v1/commerce/holds/${holdId}/capture`, {
    method: 'POST', headers: authed(seller.token),
    body: JSON.stringify({ amount: 62_000000 }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const hold = body.data.hold;
  assert(hold.status === 'captured', `status: ${hold.status}`);
  assert(hold.capturedAmount === 62_000000, `capturedAmount: ${hold.capturedAmount}`);
});

await test('6. A captured hold cannot be captured again or released', async () => {
  const cap = await json(`/v1/commerce/holds/${holdId}/capture`, {
    method: 'POST', headers: authed(seller.token), body: JSON.stringify({}),
  });
  assert(cap.status === 409, `re-capture: expected 409, got ${cap.status}`);
  const rel = await json(`/v1/commerce/holds/${holdId}/release`, {
    method: 'POST', headers: authed(buyer.token), body: JSON.stringify({}),
  });
  assert(rel.status === 409, `release after capture: expected 409, got ${rel.status}`);
});

// ─── Release path ───
console.log('\nPhase 2 — release (losing bid)');

let hold2 = '';
await test('7. Second hold releases cleanly by the buyer', async () => {
  const create = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 25_000000, currency: 'EUR', purpose: 'bid',
      reference: 'tinki-listing-2', payment: { handler: 'test.money', instrument: 'pm_test_hold' },
    }),
  });
  assert(create.status === 201, `create: ${create.status}`);
  hold2 = create.body.data.hold.id;
  const rel = await json(`/v1/commerce/holds/${hold2}/release`, {
    method: 'POST', headers: authed(buyer.token), body: JSON.stringify({}),
  });
  assert(rel.status === 200, `release: ${rel.status}: ${JSON.stringify(rel.body).slice(0, 200)}`);
  assert(rel.body.data.hold.status === 'released', `status: ${rel.body.data.hold.status}`);
});

await test('8. A released hold cannot be captured', async () => {
  const { status } = await json(`/v1/commerce/holds/${hold2}/capture`, {
    method: 'POST', headers: authed(seller.token), body: JSON.stringify({}),
  });
  assert(status === 409, `expected 409, got ${status}`);
});

await test('9. Bystander cannot release someone else\'s hold', async () => {
  const create = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 10_000000, currency: 'EUR', purpose: 'deposit',
      reference: 'tinki-listing-3', payment: { handler: 'test.money', instrument: 'pm_test_hold' },
    }),
  });
  assert(create.status === 201, `create: ${create.status}`);
  const { status } = await json(`/v1/commerce/holds/${create.body.data.hold.id}/release`, {
    method: 'POST', headers: authed(other.token), body: JSON.stringify({}),
  });
  assert(status === 404, `expected 404 (no existence leak), got ${status}`);
});

// ─── Lists + validation ───
console.log('\nPhase 3 — lists and validation');

await test('10. Buyer sees own holds; seller sees holds against them', async () => {
  const b = await json('/v1/commerce/holds', { headers: authed(buyer.token) });
  assert(b.status === 200 && b.body.data.holds.length >= 3, `buyer list: ${b.status} n=${b.body.data?.holds?.length}`);
  const s = await json('/v1/commerce/holds?side=seller', { headers: authed(seller.token) });
  assert(s.status === 200 && s.body.data.holds.length >= 3, `seller list: ${s.status} n=${s.body.data?.holds?.length}`);
  const o = await json('/v1/commerce/holds', { headers: authed(other.token) });
  assert(o.status === 200 && o.body.data.holds.length === 0, `bystander list should be empty, n=${o.body.data?.holds?.length}`);
});

await test('11. Morsel holds are rejected (handler cannot authorize)', async () => {
  const { status, body } = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({ seller: sellerName, amount: 100, currency: 'morsel', purpose: 'bid', reference: 'x' }),
  });
  assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body).slice(0, 200)}`);
});

await test('12. Unknown seller is rejected', async () => {
  const { status } = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({ seller: 'no-such-owner-xyz', amount: 100, currency: 'EUR', purpose: 'bid', reference: 'x', payment: { handler: 'test.money', instrument: 'pm' } }),
  });
  assert(status === 404, `expected 404, got ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
