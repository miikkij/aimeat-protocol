/**
 * @file test/e2e-x402-testnet.ts
 * @description REAL Base Sepolia testnet acceptance for x402 settlement (TARGET-042 criterion 5),
 *   run against the REAL facilitator (default https://x402.org/facilitator) — NOT the off-chain
 *   double. Two phases:
 *   - Phase A (autonomous, no wallet): open a USD session, assert the 402 carries the exact scheme
 *     pointing at base-sepolia + the real payTo + USDC asset, and that a BOGUS X-PAYMENT is rejected
 *     by the REAL facilitator (proves AIMEAT is wired to x402.org, no USDC spent).
 *   - Phase B (real onchain settle): the harness GENERATES ITS OWN throwaway buyer key (never the
 *     operator's wallet key) into a gitignored *.key file that can never be committed, prints the
 *     buyer address for one-time funding, and — once that address holds >= the price in testnet USDC
 *     — signs the EIP-3009 TransferWithAuthorization with viem (locally), settles ~0.10 USDC
 *     buyer -> payTo through the real facilitator, confirms the resource returns, then replays the
 *     same proof and asserts rejection. Gas is facilitator-sponsored, so no ETH is needed. If the
 *     buyer address is not yet funded, Phase B prints funding instructions and skips (Phase A still
 *     passes).
 *
 *   Self-skips unless AIMEAT_X402_ENABLED=true AND the real facilitator is in use (skips when
 *   AIMEAT_X402_TEST_FACILITATOR=true), so a normal CI sweep never hits the network.
 * @usage cd aimeat && AIMEAT_X402_ENABLED=true pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=x402-testnet
 * @version-history
 *   v1.1.0 — 2026-07-18 — Self-generated throwaway buyer key (gitignored) + on-chain balance gate +
 *     viem EIP-3009 signing; no operator key involved (TARGET-042 criterion 5)
 *   v1.0.0 — 2026-07-18 — Initial real-testnet acceptance harness
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const PRICE_MICROS = 100_000; // 0.10 USDC — small so a modest faucet/topup covers it with margin
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// The throwaway buyer key lives here. `*.key` is already in .gitignore, so it is NEVER committed.
const KEYFILE = process.env.X402_TEST_KEYFILE ?? resolve(process.cwd(), '.x402-testnet-buyer.key');

// ── Skip guard: this suite is ONLY for the real facilitator. ──
if (process.env.AIMEAT_X402_ENABLED !== 'true' || process.env.AIMEAT_X402_TEST_FACILITATOR === 'true') {
    console.log('\n=== x402 TESTNET E2E — SKIPPED ===');
    console.log('  ⏭  needs AIMEAT_X402_ENABLED=true and the REAL facilitator (unset AIMEAT_X402_TEST_FACILITATOR).');
    process.exit(0);
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
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function edsign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `x4tn${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'X402TN', password: 'X402testnet1' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'X402TN', password: 'X402testnet1' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await edsign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Seller payTo: a distinct RECEIVER (needs no funds/gas). Default a fresh random address; override
// with X402_TEST_PAYTO to keep the 0.10 USDC in an address you control.
const PAYTO = (process.env.X402_TEST_PAYTO && /^0x[a-fA-F0-9]{40}$/.test(process.env.X402_TEST_PAYTO))
    ? process.env.X402_TEST_PAYTO
    : `0x${randomBytes(20).toString('hex')}`;

async function sellerWithUsdOffer(label: string) {
    const seller = await setupOwner(label);
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const offers = { offers: [{
        id: 'usd-testnet', title: 'Testnet USD service', ask: 'Priced in dollars, payable in USDC on Base Sepolia.',
        deliverable: { format: 'document', sample: 'untested' },
        priceMoney: { amount: PRICE_MICROS, currency: 'USD' }, visibility: 'public',
    }] };
    const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify(offers) });
    assert(pub.status === 200, `publish offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const pspWrite = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ key: 'commerce.psp', value: { provider: 'x402', address: PAYTO }, visibility: 'private' }) });
    assert(pspWrite.status === 200 || pspWrite.status === 201, `psp write ${pspWrite.status}`);
    return { ...seller, vendorGaii: `vendor#${seller.name}@${NODE_ID}` };
}

function xPaymentHeader(requirements: any, from: string, signature: string, nonce: string, validBefore: string): string {
    const payload = {
        x402Version: 1, scheme: 'exact', network: requirements.network,
        payload: { signature, authorization: { from, to: requirements.payTo, value: requirements.maxAmountRequired, validAfter: '0', validBefore, nonce } },
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

console.log('\n=== AIMEAT x402 REAL TESTNET E2E (TARGET-042 criterion 5) ===');
console.log(`  facilitator: ${process.env.AIMEAT_X402_FACILITATOR_URL ?? 'https://x402.org/facilitator (default)'}`);
console.log(`  network: base-sepolia · price: ${PRICE_MICROS} (0.10 USDC) · payTo: ${PAYTO}\n`);

let seller: Awaited<ReturnType<typeof sellerWithUsdOffer>>;
let buyer: Awaited<ReturnType<typeof setupOwner>>;
let requirements: any;
let openSessionId = '';

// ── Phase A: real-facilitator wiring, no wallet needed ──

await test('A1. Setup: seller (USD 0.10 offer + x402 payTo) + buyer', async () => {
    seller = await sellerWithUsdOffer('s');
    buyer = await setupOwner('b');
});

await test('A2. Open USD session + unpaid complete → 402 with real base-sepolia exact scheme', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'USD', items: [{ agent: seller.vendorGaii, offer_id: 'usd-testnet' }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    openSessionId = create.body.data.session.id;
    const r = await json(`/v1/commerce/checkout-sessions/${openSessionId}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.coinbase.x402' } }),
    });
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    requirements = (r.body.accepts || []).find((a: any) => a.scheme === 'exact');
    assert(!!requirements, `exact scheme present: ${JSON.stringify(r.body.accepts?.map((a: any) => a.scheme))}`);
    assert(requirements.network === 'base-sepolia', `network base-sepolia: ${requirements.network}`);
    assert(requirements.payTo === PAYTO, `payTo is the seller address: ${requirements.payTo}`);
    assert(requirements.asset.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase(), `asset is base-sepolia USDC: ${requirements.asset}`);
    assert(requirements.maxAmountRequired === String(PRICE_MICROS), `maxAmountRequired: ${requirements.maxAmountRequired}`);
});

await test('A3. Bogus X-PAYMENT is rejected by the REAL facilitator (proves x402.org wiring, no USDC spent)', async () => {
    const nonce = `0x${randomBytes(32).toString('hex')}`;
    const bogus = xPaymentHeader(requirements, `0x${randomBytes(20).toString('hex')}`, `0x${randomBytes(65).toString('hex')}`, nonce, String(Math.floor(Date.now() / 1000) + 3600));
    const r = await json(`/v1/commerce/checkout-sessions/${openSessionId}/complete`, {
        method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': bogus }, body: JSON.stringify({}),
    });
    assert(r.status === 402 && r.body.error?.code === 'X402_VERIFY_FAILED', `real facilitator rejects bogus sig: ${r.status} ${r.body.error?.code} — ${r.body.error?.message}`);
    const back = await json(`/v1/commerce/checkout-sessions/${openSessionId}`, { headers: auth(buyer.token) });
    assert(back.body.data.session.status === 'open', 'session still open after a rejected proof');
});

// ── Phase B: the real onchain settle with a SELF-GENERATED throwaway buyer key ──

// Generate (or reuse) a throwaway buyer key. The operator's own key is NEVER used or requested.
const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
let pk: string;
let generated = false;
if (existsSync(KEYFILE)) { pk = readFileSync(KEYFILE, 'utf8').trim(); }
else { pk = generatePrivateKey(); writeFileSync(KEYFILE, pk, { mode: 0o600 }); generated = true; }
const account = privateKeyToAccount(pk as `0x${string}`);
console.log(`\n  Throwaway buyer wallet ${generated ? '(freshly generated)' : '(reused)'}: ${account.address}`);
console.log(`  Key stored at ${KEYFILE} — matched by .gitignore '*.key', never committed.`);

// On-chain USDC balance of the throwaway buyer on Base Sepolia.
const { createPublicClient, http, parseAbi } = await import('viem');
const { baseSepolia } = await import('viem/chains');
let balance = 0n;
try {
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    balance = await client.readContract({
        address: requirements.asset as `0x${string}`,
        abi: parseAbi(['function balanceOf(address owner) view returns (uint256)']),
        functionName: 'balanceOf', args: [account.address],
    }) as bigint;
} catch (e: any) { console.log(`  (balance check failed: ${e.message})`); }
console.log(`  USDC balance: ${balance} atomic (need ${PRICE_MICROS} = 0.10 USDC)\n`);

if (balance < BigInt(PRICE_MICROS)) {
    console.log('  ⏭  Phase B (real onchain settle) SKIPPED — the throwaway buyer is not funded yet.');
    console.log(`     Send >= 0.10 testnet USDC to ${account.address} on Base Sepolia`);
    console.log('     (faucet.circle.com, or a small send from your own wallet — your key is never used here),');
    console.log('     then re-run this suite. No ETH needed: the facilitator sponsors gas.');
} else {
    // One signature; the replay reuses it.
    const nonce = `0x${randomBytes(32).toString('hex')}`;
    const validBefore = String(Math.floor(Date.now() / 1000) + 3600);
    let signature = '';

    await test('B1. Real settle: sign EIP-3009 with the throwaway key + pay 0.10 USDC on Base Sepolia', async () => {
        signature = await account.signTypedData({
            domain: { name: requirements.extra.name, version: requirements.extra.version, chainId: baseSepolia.id, verifyingContract: requirements.asset as `0x${string}` },
            types: { TransferWithAuthorization: [
                { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
            ] },
            primaryType: 'TransferWithAuthorization',
            message: {
                from: account.address, to: requirements.payTo as `0x${string}`, value: BigInt(requirements.maxAmountRequired),
                validAfter: 0n, validBefore: BigInt(validBefore), nonce: nonce as `0x${string}`,
            },
        });
        const header = xPaymentHeader(requirements, account.address, signature, nonce, validBefore);
        const r = await json(`/v1/commerce/checkout-sessions/${openSessionId}/complete`, {
            method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': header }, body: JSON.stringify({}),
        });
        assert(r.status === 200, `settle ${r.status}: ${JSON.stringify(r.body.error)}`);
        const s = r.body.data.session;
        assert(s.status === 'completed', `status ${s.status}`);
        assert(s.receipt?.handler === 'com.coinbase.x402', `handler: ${JSON.stringify(s.receipt)}`);
        assert(String(s.receipt?.trackingCode).startsWith('x402_'), `onchain tracking code: ${s.receipt?.trackingCode}`);
        assert(s.currency === 'USD', `session currency stays USD (model 2): ${s.currency}`);
        console.log(`     settled onchain: ${s.receipt?.trackingCode}`);
    });

    await test('B2. Replay the SAME proof on a fresh session → rejected (single-use nonce)', async () => {
        const create = await json('/v1/commerce/checkout-sessions', {
            method: 'POST', headers: auth(buyer.token),
            body: JSON.stringify({ currency: 'USD', items: [{ agent: seller.vendorGaii, offer_id: 'usd-testnet' }] }),
        });
        assert(create.status === 201, `create ${create.status}`);
        const header = xPaymentHeader(requirements, account.address, signature, nonce, validBefore);
        const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
            method: 'POST', headers: { ...auth(buyer.token), 'X-PAYMENT': header }, body: JSON.stringify({}),
        });
        assert(r.status === 402 && ['X402_VERIFY_FAILED', 'X402_SETTLE_FAILED'].includes(r.body.error?.code), `replay rejected with 402: ${r.status} ${r.body.error?.code}`);
    });
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`x402 testnet E2E: ${passed} passed, ${failed} failed (${passed + failed} run${balance < BigInt(PRICE_MICROS) ? '; Phase B awaits buyer funding' : ''})`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
