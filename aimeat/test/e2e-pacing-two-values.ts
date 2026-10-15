/**
 * @file test/e2e-pacing-two-values.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An offer has two values: an optional money price and a pacing amount in morsels per
 *   use (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). Each use debits the
 *   pacing amount from the user's owner; part burns, the operator's existing share stays, and the
 *   rest is credited to the provider's owner. A morsel is never a price or a currency.
 *
 *   (a) a free offer with a pacing amount: the ledger rows on all three sides
 *   (b) a money price and a pacing amount: money through a money handler, pacing as in (a)
 *   (c) legacy morsel-priced offers, stored the old way at production size (39 products, 29 of them
 *       morsel-priced, as aimeat.io had on 2026-10-11), read and work as free plus paced
 *   (d) a user at zero balance is refused, and told how to get more
 *   (e) buying pacing capacity with money (Jouni 2026-10-11: build it now)
 *   (f) ACP, UCP and the feed show money only
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=pacing-two-values
 * @version-history
 *   2026-10-15 — (a) asserts the dashboard's morsels in circulation cover the three wallets (feature-list audit #169).
 *   2026-10-15 — A pack past the daily mint ceiling answers 429 PACING_PACK_CAP, refunded, session open (feature-list audit #137).
 *   v1.2.0 — 2026-10-12 — Node 4.0.0 refuses price.morsels (MORSEL_PRICE_REMOVED), and the setup's PUT
 *     offers carried the old client's offer, so the whole setup was refused there. That offer moved to
 *     the test whose subject it is, on an agent of its own, and the test is version-aware: stored as
 *     pacing with the mirror on 3.x, refused with nothing written on 4.0.0. (c): on 4.0.0 POST /v1/memory
 *     refuses the old stored form too, so the seed asserts that refusal with nothing written and then
 *     seeds the same 39 offers with `tollMorsels`; the read-back, the feed and the two purchases run
 *     unchanged on both releases.
 *   v1.1.0 — 2026-10-11 — The default node: before any setting changes, a 10-morsel use burns at least
 *     1 (AIMEAT_BURN_RATE, 0.10), and an ordinary buyer's tracking code does not say "granted".
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import { ownerSignIn } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { MORSEL_PRICE_FIELDS_REMOVED_IN } from '../src/config-pacing.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
  const name = `pv${label}${Date.now().toString().slice(-8)}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pacing', password: 'Pacing12345' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pacing', password: 'Pacing12345' }) }); }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body.error)}`);
  const tok = await ownerSignIn(BASE, name, 'Pacing12345');
  const token = tok.body.data.token as string;
  const roles: string[] = JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')).roles ?? [];
  return { name, token, ghii: `${name}@${NODE_ID}`, roles };
}
async function balance(token: string): Promise<number> {
  const r = await json('/v1/wallet', { headers: auth(token) });
  assert(r.status === 200, `wallet ${r.status}`);
  return Number(r.body.data.balance ?? 0);
}
async function rows(token: string, trackingCode: string): Promise<any[]> {
  const r = await json('/v1/wallet/transactions?limit=200', { headers: auth(token) });
  assert(r.status === 200, `transactions ${r.status}`);
  const list = (r.body.data.transactions ?? r.body.data.items ?? []) as any[];
  return list.filter(t => String(t.trackingCode ?? t.tracking_code ?? '').startsWith(trackingCode));
}
const sumOf = (list: any[], type: string) => list.filter(t => t.type === type).reduce((n, t) => n + Number(t.amount), 0);

const deliverable = { format: 'document', sample: 'untested' };
const BURN_RATE = 0.2;   // set below, so the split is known: ceil(20 %) burns
const FEE_PERCENT = 10;  // the operator's existing share, kept as it was (Needs Jouni's decision)

console.log('\n=== PACING: an offer has a money price and a pacing amount ===\n');

const op = await setupOwner('op');
const seller = await setupOwner('sel');
const buyer = await setupOwner('buy');
let vendorGaii = '';

// Before any setting is changed: the node's own default burn rate (AIMEAT_BURN_RATE, 0.10) burns part
// of every pacing charge, as the ruling says. Part burns, the operator share stays, the rest is earned.
await test('default node: a 10-morsel use burns at least 1, the operator takes its share, the provider earns the rest', async () => {
  const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'deflt', owner: seller.name, capabilities: ['social'] }) });
  assert(ag.status === 201, `agent ${ag.status}`);
  const pub = await json('/v1/agents/deflt/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: [
    { id: 'ten', title: 'Paced ten', ask: 'Send text.', deliverable, tollMorsels: 10, visibility: 'public' },
  ] }) });
  assert(pub.status === 200, `offers ${pub.status}`);
  const before = await balance(buyer.token);
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: `deflt#${seller.name}@${NODE_ID}`, offer_id: 'ten' }] }) });
  assert(open.status === 201, `open ${open.status}`);
  const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  const p = done.body.data.session.receipt.pacing;
  assert(p.morsels === 10 && p.burned >= 1 && p.burned + p.fee + p.providerEarned === 10, `the default burns part: ${JSON.stringify(p)}`);
  // An ordinary buyer pays for themselves: the tracking code does not say "granted".
  assert(String(p.trackingCode).startsWith('pacing:checkout:'), `tracking code: ${p.trackingCode}`);
  assert(await balance(buyer.token) === before - 10, 'the buyer pays the 10 morsels');
  const b = await rows(buyer.token, p.trackingCode);
  assert(sumOf(b, 'pacing_charge') + sumOf(b, 'pacing_burn') === -10 && sumOf(b, 'pacing_burn') <= -1, `buyer rows: ${JSON.stringify(b)}`);
  // The buyer paid in person: no row names an initiator, which a wallet would show as "your agent …".
  assert(b.every(x => !x.initiator_gaii && !x.initiatorGaii), `no initiator on an in-person use: ${JSON.stringify(b)}`);
  assert(sumOf(await rows(seller.token, p.trackingCode), 'pacing_earn') === p.providerEarned, 'the provider row');
});

await test('setup: the operator sets the burn rate, the fee and a pacing pack (50 morsels for 2 EUR)', async () => {
  assert(op.roles.includes('operator'), `the first owner is the operator: ${JSON.stringify(op.roles)}`);
  const r = await json('/v1/admin/config', {
    method: 'PUT', headers: auth(op.token),
    body: JSON.stringify({ changes: [
      { path: 'morsel_policy.burn_rate', value: BURN_RATE },
      { path: 'commerce.fee_percent', value: FEE_PERCENT },
      { path: 'commerce.fee_mode', value: 'operator' },
      { path: 'morsel_policy.pacing_pack_morsels', value: 50 },
      { path: 'morsel_policy.pacing_pack_price', value: 2_000_000 },
      { path: 'morsel_policy.pacing_pack_currency', value: 'EUR' },
    ] }),
  });
  assert(r.status === 200 && !r.body.data.errors, `config ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data?.errors)}`);
  const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
  assert(ag.status === 201, `agent ${ag.status}`);
  vendorGaii = `vendor#${seller.name}@${NODE_ID}`;
  const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: [
    { id: 'paced', title: 'Free and paced', ask: 'Send text.', deliverable, tollMorsels: 10, visibility: 'public' },
    { id: 'priced', title: 'Money and paced', ask: 'Send text.', deliverable, tollMorsels: 5, priceMoney: { amount: 1_000_000, currency: 'EUR' }, visibility: 'public' },
    { id: 'heavy', title: 'Heavily paced', ask: 'Send text.', deliverable, tollMorsels: 100, visibility: 'public' },
  ] }) });
  assert(pub.status === 200, `offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
});

let freeSession: any;
await test('(a) a free offer with a pacing amount: the buyer pays 10 morsels, 2 burn, 1 goes to the operator, 7 to the provider', async () => {
  const before = { buyer: await balance(buyer.token), seller: await balance(seller.token), op: await balance(op.token) };
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'paced' }] }) });
  assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body.error)}`);
  const s = open.body.data.session;
  assert(s.total === 0 && s.currency !== 'morsel' && s.pacingMorsels === 10, `a free session with pacing: ${JSON.stringify({ total: s.total, currency: s.currency, pacing: s.pacingMorsels })}`);
  const done = await json(`/v1/commerce/checkout-sessions/${s.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  freeSession = done.body.data.session;
  const p = freeSession.receipt?.pacing;
  assert(p?.morsels === 10 && p.burned === 2 && p.fee === 1 && p.providerEarned === 7, `pacing receipt: ${JSON.stringify(p)}`);
  assert(freeSession.receipt.charged === 0, `no money charged: ${JSON.stringify(freeSession.receipt)}`);
  assert(await balance(buyer.token) === before.buyer - 10, 'the buyer is debited the pacing amount');
  assert(await balance(seller.token) === before.seller + 7, 'the provider is credited the rest');
  assert(await balance(op.token) === before.op + 1, 'the operator keeps its existing share');
  const track = p.trackingCode as string;
  const b = await rows(buyer.token, track);
  assert(sumOf(b, 'pacing_charge') + sumOf(b, 'pacing_burn') === -10 && sumOf(b, 'pacing_burn') === -2, `buyer rows: ${JSON.stringify(b)}`);
  const sel = await rows(seller.token, track);
  assert(sumOf(sel, 'pacing_earn') === 7, `provider rows: ${JSON.stringify(sel)}`);
  const o = await rows(op.token, track);
  assert(sumOf(o, 'marketplace_fee') === 1, `operator rows: ${JSON.stringify(o)}`);
  // The operator's economy figures count what pacing burned.
  const dash = await json('/v1/admin/dashboard', { headers: auth(op.token) });
  const eco = dash.body?.data?.economy ?? {};
  assert(dash.status === 200 && eco.total_burned_all_time >= 2 + 1 && eco.burned_today >= 3, `burned on the economy page: ${JSON.stringify({ all: eco.total_burned_all_time, today: eco.burned_today })}`);
  // Feature-list audit #169: the supply was summed from agent rows, which always hold 0, so it read 0.
  // A balance lives on the person; the three people here hold at least what their wallets say.
  const held = await balance(buyer.token) + await balance(seller.token) + await balance(op.token);
  assert(eco.total_morsels_in_circulation >= held && held > 0,
    `morsels in circulation ${eco.total_morsels_in_circulation}, while three wallets alone hold ${held}`);
});

await test('(b) a money price and a pacing amount: 1 EUR through a money handler, 5 morsels of pacing as in (a)', async () => {
  const before = { buyer: await balance(buyer.token), seller: await balance(seller.token) };
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'priced' }] }) });
  assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body.error)}`);
  const s = open.body.data.session;
  assert(s.currency === 'EUR' && s.total === 1_000_000 && s.pacingMorsels === 5, `money session: ${JSON.stringify({ c: s.currency, t: s.total, p: s.pacingMorsels })}`);
  const noHandler = await json(`/v1/commerce/checkout-sessions/${s.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
  assert(noHandler.status === 422 && noHandler.body.error?.code === 'PAYMENT_HANDLER_REQUIRED', `a money session names its handler: ${noHandler.status} ${JSON.stringify(noHandler.body.error)}`);
  const done = await json(`/v1/commerce/checkout-sessions/${s.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'pm_test' } }) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  const r = done.body.data.session.receipt;
  assert(r.handler === 'test.money' && r.charged === 1_000_000, `money receipt: ${JSON.stringify(r)}`);
  assert(r.pacing?.morsels === 5 && r.pacing.burned === 1 && r.pacing.fee === 1 && r.pacing.providerEarned === 3, `pacing receipt: ${JSON.stringify(r.pacing)}`);
  assert(await balance(buyer.token) === before.buyer - 5, 'the buyer pays the pacing in morsels');
  assert(await balance(seller.token) === before.seller + 3, 'the provider gets the pacing rest in morsels');
});

// The old client's write is this test's subject, so it has an agent of its own (PUT offers replaces
// the whole list, and the vendor's offers are read by the tests below). On 3.x the write is stored as
// the pacing amount with the old field mirrored; on 4.0.0 it is refused and nothing is written.
await test('an old client writing price.morsels gets it stored as the pacing amount, with the old field mirrored and marked deprecated, on 3.x; 4.0.0 refuses it with MORSEL_PRICE_REMOVED and writes nothing', async () => {
  const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'oldclient', owner: seller.name, capabilities: ['social'] }) });
  assert(ag.status === 201, `agent ${ag.status}`);
  const oldClientGaii = `oldclient#${seller.name}@${NODE_ID}`;
  const pub = await json('/v1/agents/oldclient/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: [
    { id: 'legacy-write', title: 'Old client', ask: 'Send text.', deliverable, price: { morsels: 7, unit: 'per-call' }, visibility: 'public' },
  ] }) });
  const r = await json(`/v1/agents/${encodeURIComponent(oldClientGaii)}/offers`, { headers: auth(buyer.token) });
  assert(r.status === 200, `offers ${r.status}`);
  const offers = (r.body.data.offers ?? []) as any[];
  if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
    assert(pub.status === 400 && pub.body.error?.code === 'MORSEL_PRICE_REMOVED',
      `4.0.0 refuses price.morsels with 400 MORSEL_PRICE_REMOVED, got ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    assert(offers.length === 0, `nothing was written: ${JSON.stringify(offers)}`);
    return;
  }
  assert(pub.status === 200, `offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
  const o = offers.find(x => x.id === 'legacy-write');
  assert(o?.tollMorsels === 7, `stored as pacing: ${JSON.stringify(o)}`);
  assert(o.price?.morsels === 7 && typeof o.price?.deprecated === 'string', `old field mirrored, deprecated: ${JSON.stringify(o.price)}`);
  assert(!offers.some(x => x.priceMoney && String(x.priceMoney.currency).toLowerCase() === 'morsel'), 'no money field carries morsels');
});

// ── (c) production size: 39 products, 29 morsel-priced, stored the OLD way ──
const legacy = await setupOwner('leg');
const LEGACY_PRICES = [20, 1, 1, 1, 1, 3, 1, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 1, 3, 1, 1, 3, 1, 1, 1, 2, 1];   // aimeat.io, 2026-10-11
let legacyGaii = '';
// On 4.0.0 the memory write refuses the old stored form too, so no request can seed a record "as
// 3.26.1 stored it". There the test asserts that refusal and that nothing was written, then seeds the
// same 39 offers in the 4.0.0 form (`tollMorsels` with the same figures) and proves the rest unchanged.
await test('(c) 39 offers stored before the change (29 morsel-priced, 10 in EUR) read as free plus paced, and the feed lists only the 10 (on 4.0.0 the old form is refused at the write and the same shop is seeded with tollMorsels)', async () => {
  assert(LEGACY_PRICES.length === 29, 'production had 29 morsel-priced products');
  const ag = await json('/v1/agents', { method: 'POST', headers: auth(legacy.token), body: JSON.stringify({ name: 'oldshop', owner: legacy.name, capabilities: ['social'] }) });
  assert(ag.status === 201, `agent ${ag.status}`);
  legacyGaii = `oldshop#${legacy.name}@${NODE_ID}`;
  const shop = (pacing: (m: number) => Record<string, unknown>) => [
    ...LEGACY_PRICES.map((m, i) => ({ id: `old-${i}`, title: `Old ${i}`, ask: 'x', deliverable, ...pacing(m), visibility: 'public' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `eur-${i}`, title: `Euro ${i}`, ask: 'x', deliverable, priceMoney: { amount: 500_000 + i, currency: 'EUR' }, visibility: 'public' })),
  ];
  const rawWrite = (offers: unknown[]) => json('/v1/memory', { method: 'POST', headers: auth(legacy.token), body: JSON.stringify({ key: 'agents.oldshop.offers', agent: legacyGaii, value: { offers }, visibility: 'public' }) });
  // Written straight into the memory record, as a 3.26.1 node stored it: no normalising write path.
  const w = await rawWrite(shop(m => ({ price: { morsels: m, unit: 'per-call' } })));
  if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
    assert(w.status === 400 && w.body.error?.code === 'MORSEL_PRICE_REMOVED',
      `4.0.0 refuses the old stored form at the write with 400 MORSEL_PRICE_REMOVED, got ${w.status}: ${JSON.stringify(w.body.error)}`);
    const none = await json(`/v1/agents/${encodeURIComponent(legacyGaii)}/offers`, { headers: auth(buyer.token) });
    assert(none.status === 200 && (none.body.data.offers ?? []).length === 0, `nothing was written: ${JSON.stringify(none.body.data?.offers ?? none.body.error)}`);
    const seeded = await rawWrite(shop(m => ({ tollMorsels: m })));
    assert(seeded.status === 200 || seeded.status === 201, `4.0.0-form write ${seeded.status}: ${JSON.stringify(seeded.body.error)}`);
  } else {
    assert(w.status === 200 || w.status === 201, `raw write ${w.status}: ${JSON.stringify(w.body.error)}`);
  }
  const read = await json(`/v1/agents/${encodeURIComponent(legacyGaii)}/offers`, { headers: auth(buyer.token) });
  assert(read.status === 200, `read ${read.status}: ${JSON.stringify(read.body.error)}`);
  const got = (read.body.data.offers ?? []) as any[];
  assert(got.length === 39, `all 39 still there: ${got.length}`);
  const bad = got.filter(o => o.id.startsWith('old-') && o.tollMorsels !== LEGACY_PRICES[Number(o.id.slice(4))]);
  assert(bad.length === 0, `every old price reads as the pacing amount: ${JSON.stringify(bad.slice(0, 3))}`);
  const feed = await json('/v1/commerce/feed');
  const mine = (feed.body.products ?? []).filter((p: any) => String(p.id).includes(`oldshop#${legacy.name}`));
  assert(mine.length === 10 && mine.every((p: any) => p.price?.currency === 'EUR'), `feed lists the 10 euro offers only: ${mine.length}`);
});

await test('(c) a legacy morsel-priced offer is bought free, and its old price is charged as pacing', async () => {
  const before = await balance(buyer.token);
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: legacyGaii, offer_id: 'old-0' }] }) });
  assert(open.status === 201 && open.body.data.session.total === 0 && open.body.data.session.pacingMorsels === 20, `open ${open.status}: ${JSON.stringify(open.body.data?.session ?? open.body.error)}`);
  const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  assert(await balance(buyer.token) === before - 20, 'the old 20-morsel price is now 20 morsels of pacing');
});

await test('(c) a legacy client sending currency "morsel" and the morsel handler still completes a free session (deprecated, until 4.0.0)', async () => {
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: legacyGaii, offer_id: 'old-1' }], currency: 'morsel' }) });
  assert(open.status === 201 && open.body.data.session.currency !== 'morsel', `open ${open.status}: ${JSON.stringify(open.body.data?.session?.currency ?? open.body.error)}`);
  const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'io.aimeat.morsels' } }) });
  assert(done.status === 200 && done.body.data.session.receipt.pacing.morsels === 1, `complete ${done.status}: ${JSON.stringify(done.body.error ?? done.body.data?.session?.receipt)}`);
});

// ── (d) and (e): run out, then buy pacing capacity with money ──
const poor = await setupOwner('poor');
let refusal: any;
await test('(d) a user at zero balance is refused, and the refusal names the daily allowance and the pacing pack', async () => {
  let start = await balance(poor.token);
  // Spend down with the 100-morsel offer, then with the 10-morsel one, until less than 10 is left.
  for (const offer of ['heavy', 'paced']) {
    const cost = offer === 'heavy' ? 100 : 10;
    while (start >= cost) {
      const o = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: offer }] }) });
      const d = await json(`/v1/commerce/checkout-sessions/${o.body.data.session.id}/complete`, { method: 'POST', headers: auth(poor.token), body: JSON.stringify({}) });
      assert(d.status === 200, `spend-down ${d.status}: ${JSON.stringify(d.body.error)}`);
      start -= cost;
    }
  }
  assert(await balance(poor.token) < 10, `spent down: ${await balance(poor.token)}`);
  const o = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'paced' }] }) });
  const before = await balance(poor.token);
  refusal = await json(`/v1/commerce/checkout-sessions/${o.body.data.session.id}/complete`, { method: 'POST', headers: auth(poor.token), body: JSON.stringify({}) });
  assert(refusal.status === 402 && refusal.body.error?.code === 'INSUFFICIENT_MORSELS', `refused: ${refusal.status} ${JSON.stringify(refusal.body.error)}`);
  const msg = String(refusal.body.error.message);
  assert(/daily allowance/i.test(msg) && /pacing/i.test(msg) && /2\.00 EUR/.test(msg), `the message says how to get more: ${msg}`);
  assert(await balance(poor.token) === before, 'a refused use moves no morsels');
  const topup = (refusal.body.accepts ?? []).find((a: any) => a.scheme === 'aimeat-morsel-topup');
  assert(topup?.checkout_item?.kind === 'pacing-pack' && topup.price?.currency === 'EUR', `the 402 offers the pack: ${JSON.stringify(topup)}`);
  assert(!(refusal.body.accepts ?? []).some((a: any) => a.handler === 'io.aimeat.morsels' || (a.currencies ?? []).includes('morsel')), 'no morsel payment scheme');
});

await test('(e) the pacing pack is bought with money and adds 50 morsels', async () => {
  const before = await balance(poor.token);
  const wallet = await json('/v1/wallet', { headers: auth(poor.token) });
  const pack = wallet.body.data.pacing_pack;
  assert(pack?.morsels === 50 && pack.price?.amount === 2_000_000 && pack.price.currency === 'EUR', `the wallet names the pack: ${JSON.stringify(pack)}`);
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ items: [pack.checkout_item] }) });
  assert(open.status === 201 && open.body.data.session.currency === 'EUR' && open.body.data.session.total === 2_000_000, `open ${open.status}: ${JSON.stringify(open.body.data?.session ?? open.body.error)}`);
  const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'pm_test' } }) });
  assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  assert(await balance(poor.token) === before + 50, `50 morsels added: ${before} -> ${await balance(poor.token)}`);
  const again = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'paced' }] }) });
  const ok = await json(`/v1/commerce/checkout-sessions/${again.body.data.session.id}/complete`, { method: 'POST', headers: auth(poor.token), body: JSON.stringify({}) });
  assert(ok.status === 200, `the use goes through after the purchase: ${ok.status} ${JSON.stringify(ok.body.error)}`);
});

await test('(e) a pack past the daily mint ceiling answers 429 PACING_PACK_CAP, refunds and adds nothing', async () => {
  // feature-list audit #137: the ceiling refused correctly and refunded, but the buyer got 502
  // FULFILLMENT_FAILED. 201 packs of 50 is 10 050 morsels, past the default ceiling of 10 000.
  const before = await balance(poor.token);
  const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ items: [{ kind: 'pacing-pack', quantity: 201 }] }) });
  assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body.error)}`);
  const id = open.body.data.session.id;
  const done = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(poor.token), body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'pm_test' } }) });
  assert(done.status === 429 && done.body.error?.code === 'PACING_PACK_CAP', `expected 429 PACING_PACK_CAP, got ${done.status} ${JSON.stringify(done.body.error)}`);
  assert(/refunded/i.test(String(done.body.error.message)), `the message says the payment went back: ${done.body.error.message}`);
  assert(await balance(poor.token) === before, 'no morsels added past the ceiling');
  const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(poor.token) });
  assert(back.body.data.session.status === 'open', 'the session stays open');
});

await test('(e) a signed-out caller cannot buy a pack (401)', async () => {
  const r = await json('/v1/commerce/checkout-sessions', { method: 'POST', body: JSON.stringify({ items: [{ kind: 'pacing-pack', quantity: 1 }] }) });
  assert(r.status === 401 || r.status === 403, `signed-out pack purchase ${r.status}`);
});

await test('(f) ACP, UCP and the feed show money only: no morsel currency, no morsel handler, no free item as a product', async () => {
  const feed = await json('/v1/commerce/feed');
  const products = (feed.body.products ?? []) as any[];
  assert(!products.some(p => String(p.price?.currency).toLowerCase() === 'morsel'), 'no morsel currency in the feed');
  assert(!products.some(p => String(p.id).endsWith(':paced') || String(p.id).includes(':old-')), 'free items are not products in the money feed');
  const ucp = await json('/.well-known/ucp/2026-04-08');
  const handlers = (ucp.body.ucp?.payment_handlers ?? []) as any[];
  assert(!handlers.some(h => h.id === 'io.aimeat.morsels' || (h.currencies ?? []).includes('morsel')), `UCP handlers: ${JSON.stringify(handlers)}`);
  const acp = await json('/acp/v1/checkout_sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:paced` }] }) });
  assert(acp.status === 422 && acp.body.error?.code === 'MONEY_PRICE_REQUIRED', `ACP refuses a free item: ${acp.status}`);
});

console.log(`\nPacing two values E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
