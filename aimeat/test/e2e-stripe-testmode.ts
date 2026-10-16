/**
 * @file test/e2e-stripe-testmode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A card sale through the node, settled on Stripe in TEST MODE (QA audit F14a-01,
 *   F23a-01, P7-02). Every other money suite settles through the in-process test.money handler, which a
 *   production node does not register, so the checkout over the real Stripe handler had no run at all.
 *
 *   The seller stores their own Stripe test key (PUT /v1/commerce/payout/stripe, sealed with the node's
 *   key), publishes an offer priced in euros, and a buyer completes a checkout with the test card
 *   `pm_card_visa`. The receipt's tracking code is the PaymentIntent, which is then read from Stripe's
 *   own API: succeeded, for the price in cents, in euros, on the seller's account, with no platform
 *   fee or transfer. The handler's refund, hold rail and saved card against Stripe are in
 *   test/unit/stripe-testmode.test.ts.
 *
 *   RUNS ONLY WITH A KEY: STRIPE_TEST_SECRET_KEY, a test-mode secret. Without it the suite prints one
 *   `⏭ SKIPPED` line, which the runner counts as skipped and never as passed. A live key is refused.
 * @usage cd aimeat && STRIPE_TEST_SECRET_KEY=sk_test_… pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-stripe-testmode
 * @version-history
 *   2026-10-16 — Initial (QA audit F14a-01, F23a-01, P7-02).
 */
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const KEY = process.env.STRIPE_TEST_SECRET_KEY ?? '';

console.log('\n=== AIMEAT card sale on Stripe test mode E2E ===\n');
if (!KEY) {
    console.log('  ⏭ SKIPPED: a card sale settled on Stripe test mode — STRIPE_TEST_SECRET_KEY is not set');
    console.log('\n📊 Results: 0 passed, 0 failed, 1 skipped\n');
    process.exit(0);
}
if (!KEY.startsWith('sk_test_') && !KEY.startsWith('rk_test_')) {
    console.error('  ❌ STRIPE_TEST_SECRET_KEY is not a test-mode key; refusing to run against real money.');
    console.log('\n📊 Results: 0 passed, 1 failed\n');
    process.exit(1);
}

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function setupOwner(label: string) {
    const name = `stm${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Stripe test', password: 'Stripe12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'Stripe12345');
    return { name, token: tok.body.data.token as string };
}

let seller: { name: string; token: string };
let buyer: { name: string; token: string };
let vendorGaii = '';
let paymentIntent = '';

await test('Setup: a seller with their own Stripe test key and an offer priced in euros, and a buyer', async () => {
    seller = await setupOwner('s');
    buyer = await setupOwner('b');
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    vendorGaii = `vendor#${seller.name}@${NODE_ID}`;
    const key = await json('/v1/commerce/payout/stripe', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ secret_key: KEY }) });
    assert(key.status === 200, `seller key ${key.status}: ${JSON.stringify(key.body?.error)}`);
    const offers = await json('/v1/agents/vendor/offers', {
        method: 'PUT', headers: auth(seller.token),
        body: JSON.stringify({ offers: [{
            id: 'eur-card', title: 'A service paid by card', ask: 'Priced in euros.',
            deliverable: { format: 'document', sample: 'untested' },
            priceMoney: { amount: 2_340_000, currency: 'EUR' }, visibility: 'public',
        }] }),
    });
    assert(offers.status === 200, `offer ${offers.status}: ${JSON.stringify(offers.body?.error)}`);
});

await test('The buyer pays by card and the checkout completes with a Stripe PaymentIntent on its receipt', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'eur-card', quantity: 1 }], currency: 'EUR' }),
    });
    assert(create.status === 201, `session ${create.status}: ${JSON.stringify(create.body?.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ payment: { handler: 'com.stripe.spt', instrument: 'pm_card_visa' } }),
    });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    paymentIntent = String(done.body.data.session?.receipt?.trackingCode ?? '');
    assert(/^pi_/.test(paymentIntent), `the receipt names a PaymentIntent: ${paymentIntent}`);
    assert(done.body.data.session?.status === 'completed', `session status: ${done.body.data.session?.status}`);
});

await test('Stripe recorded the charge: succeeded, 234 cents in euros, on the seller\'s account, no platform fee', async () => {
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntent}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const pi = await res.json() as any;
    assert(res.status === 200, `Stripe ${res.status}: ${JSON.stringify(pi.error)}`);
    assert(pi.status === 'succeeded' && pi.amount === 234 && pi.amount_received === 234 && pi.currency === 'eur', `intent: ${JSON.stringify({ status: pi.status, amount: pi.amount, currency: pi.currency })}`);
    assert(!pi.application_fee_amount && !pi.transfer_data, 'a platform fee or a transfer was set on the charge');
});

await test('A card Stripe declines fails the checkout, and the buyer is told why', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'eur-card', quantity: 1 }], currency: 'EUR' }),
    });
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ payment: { handler: 'com.stripe.spt', instrument: 'pm_card_chargeDeclined' } }),
    });
    assert(done.status === 422 && done.body.error?.code === 'PSP_ERROR', `declined: ${done.status} ${JSON.stringify(done.body?.error)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
