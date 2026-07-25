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
 *   Since EURC joined the rail it also proves the SECOND settlement asset: a EUR-priced offering is
 *   offered in EURC (asset + EIP-712 domain), settles, and stays a EUR session; both currencies are
 *   advertised and reported; and — the assertion that protects buyers — EVERY currency the node
 *   advertises really produces a settleable exact scheme, so nothing is offered that cannot be paid.
 *
 *   Requires the run env: AIMEAT_X402_ENABLED=true AIMEAT_X402_TEST_FACILITATOR=true.
 * @usage cd aimeat && AIMEAT_X402_ENABLED=true AIMEAT_X402_TEST_FACILITATOR=true pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=x402
 * @version-history
 *   v1.1.0 — 2026-07-25 — EUR/EURC settlement + the advertise-only-what-can-settle round trip (TARGET-042)
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

/** A seller publishes one PUBLIC, money-priced offer and stores a commerce.psp with a payout address. */
async function sellerWithUsdOffer(label: string, offerId: string, amountMicros: number, psp: unknown, currency: 'USD' | 'EUR' = 'USD') {
    const seller = await setupOwner(label);
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const offers = { offers: [{
        id: offerId, title: `${currency} service`, ask: `A service priced in ${currency}, payable in the matching stablecoin.`,
        deliverable: { format: 'document', sample: 'untested' },
        priceMoney: { amount: amountMicros, currency }, visibility: 'public',
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

let advertised: string[] = [];
await test('1. /.well-known/ucp advertises the x402 handler with BOTH settleable currencies', async () => {
    const profile = await (await fetch(`${BASE}/.well-known/ucp`)).json() as any;
    const handlers = (profile.ucp?.payment_handlers || []).map((h: any) => h.id);
    assert(handlers.includes('com.coinbase.x402'), `x402 handler advertised: ${JSON.stringify(handlers)}`);
    const x402 = (profile.ucp.payment_handlers || []).find((h: any) => h.id === 'com.coinbase.x402');
    advertised = x402.currencies || [];
    // The UCP profile derives its currency list straight from the handler, so adding EURC to the
    // network registry propagates here with no change to wellknown.ts — this asserts that it does.
    assert(advertised.includes('USD'), `x402 settles USD: ${JSON.stringify(advertised)}`);
    assert(advertised.includes('EUR'), `x402 settles EUR via EURC: ${JSON.stringify(advertised)}`);
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
    // The tracking code names the token that moved, so a USD sale is visibly settled in USDC.
    assert(String(s.receipt?.trackingCode).startsWith('x402_USDC_'), `x402 tracking code names the asset: ${s.receipt?.trackingCode}`);
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

/* ── EUR settles in EURC on the SAME rail (TARGET-042) ─────────────────────────────────────────────
 * The second settlement asset, proving the model-2 claim twice over: the session currency stays EUR
 * and only the instrument changes. The registry's EURC entry (address, decimals, EIP-712 domain) was
 * verified against the live Base Sepolia contract and against the public facilitator before shipping;
 * these tests keep it honest end to end. */

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_SEPOLIA_EURC = '0x808456652fdb597867f38412077A9182bf77359F';
const EUR_PRICE_MICROS = 2_400_000; // 2.40 EUR

let eurSeller: Awaited<ReturnType<typeof sellerWithUsdOffer>>;
let eurSessionId = '';
let eurRequirements: any;

await test('8. A EUR-priced offering yields a 402 whose exact scheme carries the EURC asset + domain', async () => {
    eurSeller = await sellerWithUsdOffer('e', 'eur-service', EUR_PRICE_MICROS, { provider: 'x402', address: SELLER_ADDR }, 'EUR');
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'EUR', items: [{ agent: eurSeller.vendorGaii, offer_id: 'eur-service' }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const s = create.body.data.session;
    eurSessionId = s.id;
    assert(s.currency === 'EUR' && s.total === EUR_PRICE_MICROS, `session: currency ${s.currency}, total ${s.total}`);

    const r = await json(`/v1/commerce/checkout-sessions/${eurSessionId}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.coinbase.x402' } }),
    });
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    eurRequirements = (r.body.accepts || []).find((a: any) => a.scheme === 'exact');
    assert(!!eurRequirements, `exact scheme present for a EUR session: ${JSON.stringify(r.body.accepts?.map((a: any) => a.scheme))}`);
    // THE assertion the whole change turns on: a euro price is offered in EURC, never in USDC.
    assert(eurRequirements.asset === BASE_SEPOLIA_EURC, `asset is Base Sepolia EURC: ${eurRequirements.asset}`);
    assert(eurRequirements.asset !== BASE_SEPOLIA_USDC, 'a EUR price is never offered in the USD token');
    // The EIP-712 domain the buyer signs against — a wrong value invalidates every signature.
    assert(eurRequirements.extra?.name === 'EURC' && eurRequirements.extra?.version === '2',
        `EURC EIP-712 domain: ${JSON.stringify(eurRequirements.extra)}`);
    // EURC carries 6 decimals like USDC, so micros map 1:1 — 2.40 EUR asks for 2.40 EURC.
    assert(eurRequirements.maxAmountRequired === String(EUR_PRICE_MICROS), `maxAmountRequired: ${eurRequirements.maxAmountRequired}`);
    assert(eurRequirements.network === 'base-sepolia' && eurRequirements.payTo === SELLER_ADDR,
        `same network + the seller's one address: ${eurRequirements.network} ${eurRequirements.payTo}`);
});

await test('9. The EUR session settles through the facilitator and the tracking code says EURC', async () => {
    const buyerMorselsBefore = await balance(buyer.token);
    const r = await json(`/v1/commerce/checkout-sessions/${eurSessionId}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': buildXPayment(eurRequirements, BUYER_WALLET, freshNonce()) },
        body: JSON.stringify({}),
    });
    assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    assert(s.status === 'completed', `status ${s.status}`);
    assert(s.receipt?.handler === 'com.coinbase.x402', `receipt handler: ${JSON.stringify(s.receipt)}`);
    assert(String(s.receipt?.trackingCode).startsWith('x402_EURC_'), `tracking code names EURC: ${s.receipt?.trackingCode}`);
    // Model 2: the money that settled was EURC, but the session is still a EUR session.
    assert(s.currency === 'EUR', `session currency stays EUR (model 2): ${s.currency}`);
    assert(await balance(buyer.token) === buyerMorselsBefore, 'no morsel balance moved on a money sale');
});

await test('10. Every ADVERTISED currency really settles — nothing is offered that cannot be paid', async () => {
    // The rule this whole change is governed by, asserted end to end: for each currency the node
    // advertises in /.well-known/ucp, a session in that currency must produce a usable exact scheme.
    // A currency advertised without a working asset fails HERE rather than at a buyer's wallet.
    assert(advertised.length > 0, 'the handler advertises at least one currency');
    // Reuse the sellers already standing (registration is rate limited, and these are exactly the
    // fixtures the advertised currencies need). A NEW advertised currency with no fixture fails here
    // loudly — which is the point: an unproven currency must never reach a buyer unnoticed.
    const fixtures: Record<string, { gaii: string; offerId: string }> = {
        USD: { gaii: seller.vendorGaii, offerId: 'usd-service' },
        EUR: { gaii: eurSeller.vendorGaii, offerId: 'eur-service' },
    };
    for (const currency of advertised) {
        const fixture = fixtures[currency];
        assert(!!fixture, `${currency} is advertised but this suite has no seller proving it settles — add one`);
        const create = await json('/v1/commerce/checkout-sessions', {
            method: 'POST', headers: auth(buyer.token),
            body: JSON.stringify({ currency, items: [{ agent: fixture.gaii, offer_id: fixture.offerId }] }),
        });
        assert(create.status === 201, `${currency}: create ${create.status}: ${JSON.stringify(create.body.error)}`);
        const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
            method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.coinbase.x402' } }),
        });
        const exact = (r.body.accepts || []).find((a: any) => a.scheme === 'exact');
        assert(!!exact, `${currency} is advertised, so it must carry an exact scheme: ${JSON.stringify(r.body.accepts?.map((a: any) => a.scheme))}`);
        assert(/^0x[a-fA-F0-9]{40}$/.test(exact.asset) && !!exact.extra?.name && !!exact.extra?.version,
            `${currency} resolves to a real asset with an EIP-712 domain: ${JSON.stringify({ asset: exact.asset, extra: exact.extra })}`);
        // And it settles, not merely parses.
        const settled = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
            method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': buildXPayment(exact, BUYER_WALLET, freshNonce()) }, body: JSON.stringify({}),
        });
        assert(settled.status === 200, `${currency} settles: ${settled.status} ${JSON.stringify(settled.body.error)}`);
    }
});

// -- Payout settings surface (the endpoint the Wallet tab uses): the two rails are reported apart,
// and a write to one never deletes the other's setting -- they share one opaque record.
await test('Payout status reports the x402 rail and its network', async () => {
  const r = await json('/v1/commerce/payout', { headers: auth(seller.token) });
  assert(r.status === 200, `payout status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const x = r.body.data.x402;
  // The rail reports what it can settle for THIS network; the currency list grew with EURC.
  assert(x && typeof x.network === 'string' && Array.isArray(x.currencies) && x.currencies.includes('USD'),
    `x402 block: ${JSON.stringify(x)}`);
  // Both currencies are reported once EURC resolves, each with the token it settles in, so the
  // seller sees that ONE address covers a dollar sale and a euro sale alike.
  assert(x.currencies.includes('EUR'), `EUR is reported as settleable: ${JSON.stringify(x.currencies)}`);
  const symbols = (x.assets || []).map((a: any) => `${a.currency}:${a.symbol}`);
  assert(symbols.includes('USD:USDC') && symbols.includes('EUR:EURC'), `assets name their tokens: ${JSON.stringify(x.assets)}`);
  assert((x.assets || []).every((a: any) => a.decimals === 6 && /^0x[a-fA-F0-9]{40}$/.test(a.address)),
    `every asset carries a real contract + decimals: ${JSON.stringify(x.assets)}`);
  // It must match what the node actually advertises to buyers — one truth, two surfaces.
  assert(JSON.stringify([...x.currencies].sort()) === JSON.stringify([...advertised].sort()),
    `payout currencies match the UCP profile: ${JSON.stringify(x.currencies)} vs ${JSON.stringify(advertised)}`);
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
  // Stored in canonical EIP-55 form (mixed case is what a wallet shows, so it can be eyeballed).
  assert(String(v.payTo).toLowerCase() === addr.toLowerCase(), `address stored: ${JSON.stringify(v)}`);
  assert(v.secretKey === 'sk_test_kept', `the other rail credential survived: ${JSON.stringify(v)}`);
});

await test('The USDC token contract is refused as a payout address', async () => {
  // The real misconfiguration this guards: the settlement asset from our own network registry is the
  // address most likely to be on a seller's clipboard, and funds sent there are unrecoverable.
  const r = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token),
    body: JSON.stringify({ address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }) });
  assert(r.status === 400 && r.body?.error?.code === 'ADDRESS_IS_TOKEN_CONTRACT',
    `expected ADDRESS_IS_TOKEN_CONTRACT, got ${r.status}/${JSON.stringify(r.body?.error)}`);
  assert(/USDC/.test(r.body.error.message), `the message names the token: ${r.body.error.message}`);
});

await test('A mistyped address is caught by its EIP-55 checksum', async () => {
  // Same address as the good one below with a single character case-flipped: the shape still passes,
  // the checksum does not. This is the class of error a human cannot proof-read.
  const bad = '0xF0A131F770018639DE3Da1D64F2C70aA295a685C';
  const r = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ address: bad }) });
  assert(r.status === 400 && r.body?.error?.code === 'ADDRESS_CHECKSUM', `expected ADDRESS_CHECKSUM, got ${r.status}/${JSON.stringify(r.body?.error)}`);
  // An all-lowercase address carries no checksum at all, so it must be accepted and normalised.
  const lower = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token),
    body: JSON.stringify({ address: '0xf0a131f770018639de3da1d64f2c70aa295a685c' }) });
  assert(lower.status === 200, `lowercase accepted: ${lower.status}/${JSON.stringify(lower.body?.error)}`);
  assert(lower.body.data.address === '0xf0A131F770018639DE3Da1D64F2C70aA295a685C',
    `stored in canonical EIP-55 form so it can be compared against a wallet: ${lower.body.data.address}`);
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
