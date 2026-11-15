/**
 * @file e2e-commerce-holds.ts
 * @description E2E tests for the commerce hold rail (TINKI phase 1): authorize a hold on the
 *   buyer's instrument without moving money, capture it (seller only, up to the held amount),
 *   release it (either party), and lazy expiry. Runs on the test.money handler
 *   (AIMEAT_TEST_MONEY_HANDLER=true) — no real PSP.
 * @version-history
 *   2026-11-15 — Audit M139: tests 1, 5 and 7 read the test money provider's books
 *     (GET /v1/admin/test-money/ledger): a hold charges nothing and holds the amount, a partial capture
 *     charges exactly the captured amount and ends the hold, a release ends the hold and charges
 *     nothing. Test 15: only the operator reads the books.
 *   2026-11-15 — Audit M140: test 14 ages a real hold in storage and proves lazy expiry (read
 *     'expired', capture 409).
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

import { ownerSignIn, setupOperator, tokenRoles } from './helpers/owner-login.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';

async function makeOwner(name: string): Promise<{ token: string; ghii: string }> {
  const reg = await json('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username: name, display_name: name, password: 'HoldTest1234' }),
  });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const tok = await ownerSignIn(BASE, name, 'HoldTest1234');
  assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
  return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}` };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Commerce Holds E2E Test ===\n');

const buyerName = `holdbuyer${Date.now()}`;
const sellerName = `holdseller${Date.now()}`;
const otherName = `holdother${Date.now()}`;
// The buyer's card for the holds whose money the books are read for; no other suite names it.
const CARD = `pm_hold_books_${Date.now()}`;
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
let buyer!: { token: string; ghii: string };
let seller!: { token: string; ghii: string };
let other!: { token: string; ghii: string };
let operatorToken = '';

/** What the test money provider's books say for CARD in EUR (zeros before the first movement). */
async function books(): Promise<{ charged: number; held: number; refunded: number }> {
  const r = await json(`/v1/admin/test-money/ledger?instrument=${encodeURIComponent(CARD)}`, { headers: authed(operatorToken) });
  assert(r.status === 200, `books: ${r.status} ${JSON.stringify(r.body.error ?? r.body).slice(0, 200)}`);
  const row = (r.body.data.instruments as any[]).find(x => x.instrument === CARD && x.currency === 'EUR');
  return { charged: row?.charged ?? 0, held: row?.held ?? 0, refunded: row?.refunded ?? 0 };
}

console.log('Setup');
await test('Register buyer, seller and bystander, and an operator who reads the books', async () => {
  buyer = await makeOwner(buyerName);
  seller = await makeOwner(sellerName);
  other = await makeOwner(otherName);
  operatorToken = (await setupOperator(BASE, ADMIN_PW, `holdops${Date.now()}`)).token;
});

// ─── Happy path: authorize → capture ───
console.log('\nPhase 1 — authorize + capture');

let holdId = '';
let booksBefore = { charged: 0, held: 0, refunded: 0 };
await test('1. Buyer places a hold (authorize, no money moves)', async () => {
  booksBefore = await books();
  const { status, body } = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 80_000000, currency: 'EUR', purpose: 'bid',
      reference: 'tinki-listing-1', payment: { handler: 'test.money', instrument: CARD },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  const hold = body.data.hold;
  assert(hold.status === 'held', `status: ${hold.status}`);
  assert(hold.amount === 80_000000, `amount: ${hold.amount}`);
  assert(hold.sellerGhii === seller.ghii, `sellerGhii: ${hold.sellerGhii}`);
  assert(typeof hold.trackingCode === 'string' && hold.trackingCode.length > 0, 'has trackingCode');
  holdId = hold.id;
  // The provider's books: the card is charged nothing, and the amount is held on it.
  const after = await books();
  assert(after.charged === booksBefore.charged, `a hold charged the card: ${booksBefore.charged} -> ${after.charged}`);
  assert(after.held === booksBefore.held + 80_000000, `held: ${booksBefore.held} -> ${after.held}, expected +80000000`);
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
  // The card is charged exactly the captured amount, and the rest of the hold is released.
  const after = await books();
  assert(after.charged === booksBefore.charged + 62_000000, `charged: ${booksBefore.charged} -> ${after.charged}, expected +62000000`);
  assert(after.held === booksBefore.held, `held after the capture: ${after.held}, expected ${booksBefore.held}`);
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
  const before = await books();
  const create = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 25_000000, currency: 'EUR', purpose: 'bid',
      reference: 'tinki-listing-2', payment: { handler: 'test.money', instrument: CARD },
    }),
  });
  assert(create.status === 201, `create: ${create.status}`);
  hold2 = create.body.data.hold.id;
  const held = await books();
  assert(held.held === before.held + 25_000000, `held: ${before.held} -> ${held.held}, expected +25000000`);
  const rel = await json(`/v1/commerce/holds/${hold2}/release`, {
    method: 'POST', headers: authed(buyer.token), body: JSON.stringify({}),
  });
  assert(rel.status === 200, `release: ${rel.status}: ${JSON.stringify(rel.body).slice(0, 200)}`);
  assert(rel.body.data.hold.status === 'released', `status: ${rel.body.data.hold.status}`);
  // The release gives the hold back, and the card was never charged for it.
  const after = await books();
  assert(after.held === before.held, `held after the release: ${after.held}, expected ${before.held}`);
  assert(after.charged === before.charged, `a released hold charged the card: ${before.charged} -> ${after.charged}`);
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

// secaudit2026oct22: the hold ledger is service-owned, so no memory route writes or restores a hold;
// the account holder in person still deletes a finished hold of their own, as before, so the records
// the hold book never removes do not fill the key limit.
await test('13. The buyer deletes a finished hold of their own, cannot put it back, and nobody writes one', async () => {
  const key = `commerce.hold.${holdId}`;
  const write = await json('/v1/memory', { method: 'POST', headers: authed(buyer.token), body: JSON.stringify({ key, value: { id: holdId, status: 'held' }, visibility: 'private' }) });
  assert(write.status === 403 && write.body.error?.code === 'RESERVED_KEY', `a write over the hold: ${write.status} ${JSON.stringify(write.body.error)}`);
  const del = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: authed(buyer.token) });
  assert(del.status === 200, `the owner deletes a finished hold: ${del.status} ${JSON.stringify(del.body.error)}`);
  const back = await json(`/v1/memory/${encodeURIComponent(key)}/restore`, { method: 'POST', headers: authed(buyer.token), body: '{}' });
  assert(back.status === 403, `a deleted hold is not put back: ${back.status} ${JSON.stringify(back.body.error)}`);
});

// ─── Lazy expiry ───
console.log('\nPhase 4 — lazy expiry');

// No route ages a hold, and the clock of the node cannot be moved, so the two copies of a real hold
// (the buyer's record and the seller's mirror) get a past expiresAt through the node's own storage,
// the way e2e-designbook plants a stored part. The rail still holds the authorization.
await test('14. A hold past its expiry reads as expired and cannot be captured', async () => {
  const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
  const sqlitePath = pinnedSqlitePath();
  const dbUrl = serverDbUrl();
  assert((provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl), `backend "${provider}" is not reachable from this process`);
  const storage = await createStorage({ provider, sqlitePath, dbUrl });
  const create = await json('/v1/commerce/holds', {
    method: 'POST', headers: authed(buyer.token),
    body: JSON.stringify({
      seller: sellerName, amount: 5_000000, currency: 'EUR', purpose: 'bid',
      reference: 'tinki-listing-4', payment: { handler: 'test.money', instrument: 'pm_test_hold' },
    }),
  });
  assert(create.status === 201, `create: ${create.status}`);
  const id = create.body.data.hold.id as string;
  const past = new Date(Date.now() - 60_000).toISOString();
  for (const [ghii, key] of [[buyer.ghii, `commerce.hold.${id}`], [seller.ghii, `commerce.hold-in.${id}`]] as const) {
    const rec = await storage.getMemory(ghii, key);
    assert(!!rec, `no stored record ${key} under ${ghii}`);
    const value = (typeof rec!.value === 'string' ? JSON.parse(rec!.value) : rec!.value) as Record<string, unknown>;
    await storage.setMemory({ ...rec!, value: { ...value, expiresAt: past }, version: rec!.version + 1 });
  }
  const cap = await json(`/v1/commerce/holds/${id}/capture`, {
    method: 'POST', headers: authed(seller.token), body: JSON.stringify({}),
  });
  assert(cap.status === 409 && cap.body.error?.code === 'HOLD_NOT_CAPTURABLE',
    `capture of an expired hold: expected 409 HOLD_NOT_CAPTURABLE, got ${cap.status} ${JSON.stringify(cap.body.error ?? cap.body.data?.hold?.status)}`);
  const read = await json(`/v1/commerce/holds/${id}`, { headers: authed(buyer.token) });
  assert(read.status === 200 && read.body.data.hold.status === 'expired', `buyer read: ${read.status} ${read.body.data?.hold?.status}`);
});

// ─── The provider's books ───
console.log('\nPhase 5 — who reads the books');

await test('15. Only the operator reads the test money books; a filter that is too long is refused', async () => {
  // The first owner on a fresh node is its operator, so the refusal is asked of the bystander.
  assert(!tokenRoles(other.token).includes('operator'), 'the bystander must not be an operator');
  const asOwner = await json(`/v1/admin/test-money/ledger?instrument=${encodeURIComponent(CARD)}`, { headers: authed(other.token) });
  assert(asOwner.status === 403, `an owner who is not the operator reads the books: expected 403, got ${asOwner.status}`);
  const anon = await json('/v1/admin/test-money/ledger');
  assert(anon.status === 401, `no token: expected 401, got ${anon.status}`);
  const long = await json(`/v1/admin/test-money/ledger?seller=${'x'.repeat(300)}`, { headers: authed(operatorToken) });
  assert(long.status === 400 && long.body.error?.code === 'INVALID_INPUT', `a 300-character filter: ${long.status} ${JSON.stringify(long.body.error)}`);
  const sellerOnly = await json(`/v1/admin/test-money/ledger?seller=${encodeURIComponent(seller.ghii)}`, { headers: authed(operatorToken) });
  assert(sellerOnly.status === 200 && sellerOnly.body.data.instruments.length === 0, `a seller filter answers sellers only: ${JSON.stringify(sellerOnly.body.data).slice(0, 200)}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
