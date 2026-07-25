/**
 * @file test/e2e-x402.ts
 * @description E2E for the x402 stablecoin settlement handler (TARGET-042): a USD-priced checkout
 *   session settled in USDC via the x402 `exact` scheme, NON-CUSTODIAL, against an OFF-CHAIN
 *   facilitator double (AIMEAT_X402_TEST_FACILITATOR=true — no testnet wallet needed). Proves: the
 *   /.well-known/ucp profile advertises the handler; an unpaid complete answers 402 carrying the real
 *   `exact` scheme (network/payTo/asset/maxAmountRequired) alongside the preserved native schemes;
 *   an X-PAYMENT retry verifies + settles and returns the resource; the same proof replayed is
 *   rejected; the session stays a USD session (model 2 — USDC is the method, not a currency) with no
 *   morsel movement; a seller without a USDC address is refused; and the exact scheme's network/asset
 *   come from the configured network registry (parameterization).
 *
 *   Requires the run env: AIMEAT_X402_ENABLED=true AIMEAT_X402_TEST_FACILITATOR=true.
 * @usage cd aimeat && AIMEAT_X402_ENABLED=true AIMEAT_X402_TEST_FACILITATOR=true pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=x402
 * @version-history
 *   v1.0.0 — 2026-07-18 — Initial x402 settlement suite (TARGET-042)
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `x4${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'X402', password: 'X402test1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'X402', password: 'X402test1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    return Number(r.body.data?.balance ?? r.body.data?.total ?? 0);
}

/** A seller publishes one PUBLIC, USD-priced offer and stores a commerce.psp with a payout address. */
async function sellerWithUsdOffer(label: string, offerId: string, amountMicros: number, psp: unknown) {
    const seller = await setupOwner(label);
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const offers = { offers: [{
        id: offerId, title: 'USD service', ask: 'A service priced in dollars, payable in USDC.',
        deliverable: { format: 'document', sample: 'untested' },
        priceMoney: { amount: amountMicros, currency: 'USD' }, visibility: 'public',
    }] };
    const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify(offers) });
    assert(pub.status === 200, `publish offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const pspWrite = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ key: 'commerce.psp', value: psp, visibility: 'private' }) });
    assert(pspWrite.status === 200 || pspWrite.status === 201, `psp write ${pspWrite.status}: ${JSON.stringify(pspWrite.body.error)}`);
    return { ...seller, vendorGaii: `vendor#${seller.name}@${NODE_ID}` };
}

/** Base64 X-PAYMENT header from the exact-scheme requirements (the buyer's signed authorization). */
function buildXPayment(requirements: any, from: string, nonce: string): string {
    const payload = {
        x402Version: 1, scheme: 'exact', network: requirements.network,
        payload: {
            signature: `0x${'ab'.repeat(65)}`,
            authorization: {
                from, to: requirements.payTo, value: requirements.maxAmountRequired,
                validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce,
            },
        },
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}
const BUYER_WALLET = `0x${'a'.repeat(40)}`;
const SELLER_ADDR = `0x${'b'.repeat(40)}`;
const freshNonce = () => `0x${randomBytes(32).toString('hex')}`;

console.log('\n=== AIMEAT x402 Settlement E2E (TARGET-042) ===\n');

let seller: Awaited<ReturnType<typeof sellerWithUsdOffer>>;
let buyer: Awaited<ReturnType<typeof setupOwner>>;
const PRICE_MICROS = 1_500_000; // 1.50 USD

await test('Setup: seller (USD offer + x402 payout address) + buyer', async () => {
    seller = await sellerWithUsdOffer('s', 'usd-service', PRICE_MICROS, { provider: 'x402', address: SELLER_ADDR });
    buyer = await setupOwner('b');
});

await test('1. /.well-known/ucp advertises the x402 handler with the USD currency', async () => {
    const profile = await (await fetch(`${BASE}/.well-known/ucp`)).json() as any;
    const handlers = (profile.ucp?.payment_handlers || []).map((h: any) => h.id);
    assert(handlers.includes('com.coinbase.x402'), `x402 handler advertised: ${JSON.stringify(handlers)}`);
    const x402 = (profile.ucp.payment_handlers || []).find((h: any) => h.id === 'com.coinbase.x402');
    assert((x402.currencies || []).includes('USD'), `x402 settles USD: ${JSON.stringify(x402.currencies)}`);
});

let sessionId = '';
await test('2. Buyer opens a USD checkout session → 201, currency USD (not USDC), total in micros', async () => {
    const r = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'USD', items: [{ agent: seller.vendorGaii, offer_id: 'usd-service' }] }),
    });
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    sessionId = s.id;
    assert(s.currency === 'USD' && s.total === PRICE_MICROS, `session: currency ${s.currency}, total ${s.total}`);
});

let requirements: any;
await test('3. Complete with NO proof → 402 carrying the real exact scheme + preserved native schemes', async () => {
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.coinbase.x402' } }),
    });
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.x402Version === 1 && Array.isArray(r.body.accepts), `x402 envelope: ${JSON.stringify(r.body).slice(0, 200)}`);
    requirements = (r.body.accepts || []).find((a: any) => a.scheme === 'exact');
    assert(!!requirements, `exact scheme present: ${JSON.stringify(r.body.accepts?.map((a: any) => a.scheme))}`);
    assert(requirements.network === 'base-sepolia', `network: ${requirements.network}`);
    assert(requirements.payTo === SELLER_ADDR, `payTo is the seller address: ${requirements.payTo}`);
    assert(requirements.asset === '0x036CbD53842c5426634e7929541eC2318f3dCF7e', `asset is Base Sepolia USDC: ${requirements.asset}`);
    assert(requirements.maxAmountRequired === String(PRICE_MICROS), `maxAmountRequired (USDC atomic = USD micros): ${requirements.maxAmountRequired}`);
    assert(!!requirements.extra?.name, `EIP-712 extra present: ${JSON.stringify(requirements.extra)}`);
    // Backward compatible: the AIMEAT-native schemes still ride in the same accepts[].
    const schemes = (r.body.accepts || []).map((a: any) => a.scheme);
    assert(schemes.includes('aimeat-checkout') && schemes.includes('aimeat-morsel-topup'), `native schemes preserved: ${JSON.stringify(schemes)}`);
    assert(schemes[0] === 'exact', `exact is first (x402 clients pick the first supported): ${JSON.stringify(schemes)}`);
});

const usedNonce = freshNonce();
await test('4. Retry with X-PAYMENT → verified + settled, resource returned, USDC tracking code', async () => {
    const buyerMorselsBefore = await balance(buyer.token);
    const sellerMorselsBefore = await balance(seller.token);
    const xPayment = buildXPayment(requirements, BUYER_WALLET, usedNonce);
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': xPayment }, body: JSON.stringify({}),
    });
    assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    assert(s.status === 'completed', `status ${s.status}`);
    assert(s.receipt?.handler === 'com.coinbase.x402', `receipt handler: ${JSON.stringify(s.receipt)}`);
    assert(String(s.receipt?.trackingCode).startsWith('x402_'), `x402 tracking code: ${s.receipt?.trackingCode}`);
    // Model 2: the session settled but its currency is still USD, never USDC.
    assert(s.currency === 'USD', `session currency stays USD (model 2): ${s.currency}`);
    // Non-custodial + off-ledger: no morsel balances moved for either party.
    assert(await balance(buyer.token) === buyerMorselsBefore, 'buyer morsel balance unchanged');
    assert(await balance(seller.token) === sellerMorselsBefore, 'seller morsel balance unchanged');
});

await test('5. Replay the SAME proof on a fresh session → 402 (single-use nonce rejected)', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'USD', items: [{ agent: seller.vendorGaii, offer_id: 'usd-service' }] }),
    });
    assert(create.status === 201, `create ${create.status}`);
    const xPayment = buildXPayment(requirements, BUYER_WALLET, usedNonce); // same nonce as test 4
    const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': xPayment }, body: JSON.stringify({}),
    });
    // A reused single-use nonce is rejected at whichever facilitator gate catches it first (verify or
    // settle) — both are a 402 that stops the replay. The onchain USDC nonce enforces the same rule.
    assert(r.status === 402 && ['X402_VERIFY_FAILED', 'X402_SETTLE_FAILED'].includes(r.body.error?.code), `replay rejected with 402: ${r.status} ${r.body.error?.code}`);
    // A FRESH nonce on the same fresh session settles — proving only the replay was the problem.
    const ok = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': buildXPayment(requirements, BUYER_WALLET, freshNonce()) }, body: JSON.stringify({}),
    });
    assert(ok.status === 200 && ok.body.data.session.status === 'completed', `fresh nonce settles: ${ok.status}`);
});

await test('6. A seller with no USDC address → 422 SELLER_NO_X402_ADDRESS (payTo gate)', async () => {
    const stripeSeller = await sellerWithUsdOffer('n', 'usd-service', PRICE_MICROS, { provider: 'stripe', secretKey: 'sk_test_x' });
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'USD', items: [{ agent: stripeSeller.vendorGaii, offer_id: 'usd-service' }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': buildXPayment({ network: 'base-sepolia', payTo: SELLER_ADDR, maxAmountRequired: String(PRICE_MICROS) }, BUYER_WALLET, freshNonce()) }, body: JSON.stringify({}),
    });
    assert(r.status === 422 && r.body.error?.code === 'SELLER_NO_X402_ADDRESS', `no-address gate: ${r.status} ${r.body.error?.code}`);
});

await test('7. Parameterization: the exact scheme network + asset come from the configured registry', async () => {
    // network is config.x402Network (base-sepolia here); asset is that network's registry entry.
    // Changing AIMEAT_X402_NETWORK selects a different entry with no code change (Solana etc. add an entry).
    assert(requirements.network === 'base-sepolia', `configured network drives the scheme: ${requirements.network}`);
    assert(requirements.asset === '0x036CbD53842c5426634e7929541eC2318f3dCF7e' && requirements.extra?.name === 'USDC',
        `asset + EIP-712 domain from the base-sepolia registry entry: ${JSON.stringify({ asset: requirements.asset, extra: requirements.extra })}`);
});

// -- Payout settings surface (the endpoint the Wallet tab uses): the two rails are reported apart,
// and a write to one never deletes the other's setting -- they share one opaque record.
await test('Payout status reports the x402 rail and its network', async () => {
  const r = await json('/v1/commerce/payout', { headers: auth(seller.token) });
  assert(r.status === 200, `payout status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const x = r.body.data.x402;
  assert(x && x.currency === 'USDC' && typeof x.network === 'string', `x402 block: ${JSON.stringify(x)}`);
  assert(r.body.data.stripe && Array.isArray(r.body.data.stripe.currencies), 'the fiat rail is reported separately');
});

await test('Setting the payout address is validated and merged, keeping the Stripe credential', async () => {
  const bad = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ address: 'not-an-address' }) });
  assert(bad.status === 400 && bad.body?.error?.code === 'INVALID_ADDRESS', `expected INVALID_ADDRESS, got ${bad.status}`);
  const seeded = await json('/v1/memory', { method: 'POST', headers: auth(seller.token),
    body: JSON.stringify({ key: 'commerce.psp', value: { provider: 'stripe', secretKey: 'sk_test_kept' }, visibility: 'private' }) });
  assert(seeded.status === 200 || seeded.status === 201, `seed ${seeded.status}`);
  const addr = '0x' + 'a1b2c3d4'.repeat(5);
  const ok = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ address: addr }) });
  assert(ok.status === 200 && ok.body.data.configured === true, `set address ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
  const rec = await json('/v1/memory/commerce.psp', { headers: auth(seller.token) });
  const v = (rec.body.data?.value ?? rec.body.data?.record?.value) as any;
  assert(v.payTo === addr, `address stored: ${JSON.stringify(v)}`);
  assert(v.secretKey === 'sk_test_kept', `the other rail credential survived: ${JSON.stringify(v)}`);
});

await test('Removing the payout address leaves the fiat rail intact', async () => {
  const del = await json('/v1/commerce/payout/x402', { method: 'DELETE', headers: auth(seller.token) });
  assert(del.status === 200 && del.body.data.configured === false, `delete ${del.status}`);
  const rec = await json('/v1/memory/commerce.psp', { headers: auth(seller.token) });
  const v = (rec.body.data?.value ?? rec.body.data?.record?.value) as any;
  assert(!v.payTo && v.secretKey === 'sk_test_kept', `only the address was cleared: ${JSON.stringify(v)}`);
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`x402 E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
