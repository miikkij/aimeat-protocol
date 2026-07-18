/**
 * @file test/e2e-enterprise-money.ts
 * @description EE real-money acceptance (TARGET-043) — the AIMEAT wiring around Stripe Connect,
 *   proven WITHOUT a real charge by settling EUR through the `test.money` double. Self-spawns a
 *   server with the proprietary ee/ module LOADED (no AIMEAT_EE_DISABLED) and
 *   AIMEAT_TEST_MONEY_HANDLER=true. Exercises: the KYB sell-gate (money checkout blocked → operator
 *   verify → allowed), a EUR org-offering checkout completing through the checkout core, the EE
 *   distribute money branch booking DAC7 + ALV/VAT + payables, the payables/dac7 read routes, and
 *   the Stripe-Connect onboarding gates (status without an account; onboard refused with no platform
 *   key). The live Stripe rail (Express account + Account Link + PaymentIntent + application fee) is
 *   proven separately against the real sk_test_ key; Express accounts require the hosted Account-Links
 *   onboarding to reach charges_enabled, which is the operator's one-time browser step.
 *
 *   NOT in run-e2e-ci ALL_SUITES: it needs the private ee/ module, absent on open-core CI. Run locally:
 *     cd aimeat && pnpm exec node --import tsx test/e2e-enterprise-money.ts
 * @version-history v0.1.0 — 2026-07-18 — initial EE money acceptance (TARGET-043)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_EE_MONEY_PORT ?? '40272';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-ee-money.db');

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
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `eem${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'EE Money', password: 'EeMoney1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1200)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'EE Money', password: 'EeMoney1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body.error || reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    const token = tok.body.data.token as string;
    const roles: string[] = (JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')).roles) ?? [];
    return { name, token, roles };
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ } }
}
async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    // Load the REAL ee/ module (drop AIMEAT_EE_DISABLED) and register the EUR/USD test-money double;
    // NO Stripe key so the checkout settles via test.money, not a live charge.
    const { AIMEAT_EE_DISABLED: _drop, AIMEAT_STRIPE_SECRET_KEY: _drop2, AIMEAT_PLATFORM_STRIPE_KEY: _drop3, ...rest } = process.env;
    const env = {
        ...rest,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_TEST_MONEY_HANDLER: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '2000', AIMEAT_RL_WORK: '2000', AIMEAT_RL_MEMORY: '2000', AIMEAT_RL_BOARDS: '2000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    let eeLoaded = false;
    child.stdout?.on('data', (d) => { if (String(d).includes('aimeat-enterprise')) eeLoaded = true; });
    child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) { (child as any)._eeLoaded = () => eeLoaded; return child; } } catch { /* not up */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

async function main() {
    console.log('\n=== EE Money acceptance (TARGET-043) — real ee/ + test.money double ===\n');
    const server = await startServer();
    try {
        let op!: Awaited<ReturnType<typeof setupOwner>>;
        let seller!: Awaited<ReturnType<typeof setupOwner>>;
        let buyer!: Awaited<ReturnType<typeof setupOwner>>;
        const slug = 'acme';
        const EUR = 15_000_000; // 15.00 EUR in 6-decimal micro-units

        await test('EE module is loaded (not the Community stub)', async () => {
            const r = await json('/v1/orgs', { method: 'POST', body: JSON.stringify({ slug: 'x', name: 'x' }) });
            assert(r.status !== 501, `got ENTERPRISE_REQUIRED (501) — ee/ module not loaded: ${JSON.stringify(r.body.error)}`);
        });

        await test('Setup: operator-neutral + seller + buyer; seller agent + public priced offer', async () => {
            op = await setupOwner('o'); seller = await setupOwner('s'); buyer = await setupOwner('b');
            assert(!seller.roles.includes('operator'), 'seller must not be operator');
            const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
            assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
            const offers = { offers: [{ id: 'translate-doc', title: 'Translate a document', ask: 'Send a document; I translate it.', deliverable: { format: 'document', sample: 'untested' }, price: { morsels: 10, unit: 'per-call' }, visibility: 'public' }] };
            const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify(offers) });
            assert(pub.status === 200, `publish offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
        });

        await test('Seller creates a company with a Y-tunnus + lists a EUR-priced offering', async () => {
            const org = await json('/v1/orgs', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ slug, name: 'ACME Test Oy', businessId: '1234567-8' }) });
            assert(org.status === 200, `create org ${org.status}: ${JSON.stringify(org.body.error)}`);
            const list = await json(`/v1/orgs/${slug}/offerings`, { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ agentName: 'vendor', offerId: 'translate-doc' }) });
            assert(list.status === 200, `list offering ${list.status}: ${JSON.stringify(list.body.error)}`);
            const price = await json(`/v1/orgs/${slug}/offerings`, { method: 'PATCH', headers: auth(seller.token), body: JSON.stringify({ agentName: 'vendor', offerId: 'translate-doc', priceMoney: { amount: EUR, currency: 'EUR' } }) });
            assert(price.status === 200, `set priceMoney ${price.status}: ${JSON.stringify(price.body.error)}`);
            assert(price.body.data.priceMoney?.amount === EUR, `priceMoney not stored: ${JSON.stringify(price.body.data.priceMoney)}`);
        });

        await test('KYB gate: a EUR checkout is refused before verification (KYB_REQUIRED 403)', async () => {
            const cs = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'org-offering', org: `${seller.name}/${slug}`, agent: 'vendor', offer_id: 'translate-doc' }] }) });
            assert(cs.status === 403 && cs.body.error?.code === 'KYB_REQUIRED', `expected KYB_REQUIRED 403, got ${cs.status} ${cs.body.error?.code}`);
        });

        await test('Connect: status shows no account, then onboard (real Stripe test mode if a key is set)', async () => {
            const st = await json(`/v1/orgs/${slug}/connect/status`, { headers: auth(seller.token) });
            assert(st.status === 200 && st.body.data.connected === false, `status ${st.status}: ${JSON.stringify(st.body.data || st.body.error)}`);
            const on = await json(`/v1/orgs/${slug}/connect/onboard`, { method: 'POST', headers: auth(seller.token), body: '{}' });
            if (on.status === 501) {
                // No platform key configured — the gate refuses cleanly.
                assert(on.body.error?.code === 'STRIPE_PLATFORM_NOT_CONFIGURED', `expected STRIPE_PLATFORM_NOT_CONFIGURED, got ${on.body.error?.code}`);
                console.log('     (no Stripe platform key — onboarding gate refused, as designed)');
            } else {
                // A platform key IS configured (.env sk_test_) — the route created a real Express
                // connected account under the operator's Stripe Platform and returned a hosted link.
                assert(on.status === 200, `onboard ${on.status}: ${JSON.stringify(on.body.error)}`);
                assert(/^acct_[A-Za-z0-9]+$/.test(String(on.body.data.connectAccountId)), `no acct_ id: ${on.body.data.connectAccountId}`);
                assert(/^https:\/\/connect\.stripe\.com\//.test(String(on.body.data.onboardingUrl)), `no hosted onboarding URL: ${on.body.data.onboardingUrl}`);
                const st2 = await json(`/v1/orgs/${slug}/connect/status`, { headers: auth(seller.token) });
                assert(st2.status === 200 && st2.body.data.connected === true, `status after onboard: ${JSON.stringify(st2.body.data)}`);
                assert(st2.body.data.chargesEnabled === false, 'a brand-new Express account is not yet chargeable (needs hosted onboarding)');
                console.log(`     (created real Stripe Express account ${on.body.data.connectAccountId} + hosted Account Link)`);
            }
        });

        await test('Operator verifies KYB (Y-tunnus present) → verified', async () => {
            const kyb = await json(`/v1/orgs/${seller.name}/${slug}/kyb`, { method: 'POST', headers: auth(op.token), body: JSON.stringify({ status: 'verified' }) });
            assert(kyb.status === 200 && kyb.body.data.org?.kybStatus === 'verified', `kyb ${kyb.status}: ${JSON.stringify(kyb.body.error || kyb.body.data)}`);
        });

        let fee = 0;
        await test('HYVÄKSYMISKRITEERI: KYB-verified seller sells a EUR offer, buyer charged (test.money)', async () => {
            const cs = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'org-offering', org: `${seller.name}/${slug}`, agent: 'vendor', offer_id: 'translate-doc' }] }) });
            assert(cs.status === 200 || cs.status === 201, `create EUR session ${cs.status}: ${JSON.stringify(cs.body.error)}`);
            const sess = cs.body.data.session;
            assert(sess?.total === EUR, `session total ${sess?.total} != ${EUR}`);
            const done = await json(`/v1/commerce/checkout-sessions/${sess.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'test.money' } }) });
            assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
            const completed = done.body.data.session;
            assert(completed?.status === 'completed', `status ${completed?.status}`);
            assert(completed.receipt?.charged === EUR, `charged ${completed.receipt?.charged}`);
            fee = completed.receipt?.fee ?? 0;
            assert(fee > 0, `expected a platform fee, got ${fee}`);
        });

        await test('Payables booked: gross = 15.00 EUR, VAT + member/org split present', async () => {
            const p = await json(`/v1/orgs/${slug}/payables`, { headers: auth(seller.token) });
            assert(p.status === 200, `payables ${p.status}: ${JSON.stringify(p.body.error)}`);
            const t = p.body.data.totals?.EUR;
            assert(!!t, `no EUR payables totals: ${JSON.stringify(p.body.data.totals)}`);
            assert(t.gross === EUR, `payables gross ${t.gross} != ${EUR}`);
            assert(t.vat > 0, `payables vat ${t.vat}`);
            assert(t.memberCut > 0 && t.orgCut > 0, `split member=${t.memberCut} org=${t.orgCut}`);
            assert(t.count === 1, `payables count ${t.count}`);
        });

        await test('DAC7 + ALV booked: consideration, 1 transaction, VAT amount', async () => {
            const d = await json(`/v1/orgs/${slug}/dac7`, { headers: auth(seller.token) });
            assert(d.status === 200, `dac7 ${d.status}: ${JSON.stringify(d.body.error)}`);
            assert(d.body.data.dac7?.totalConsideration === EUR, `dac7 consideration ${d.body.data.dac7?.totalConsideration}`);
            assert(d.body.data.dac7?.totalTransactions === 1, `dac7 transactions ${d.body.data.dac7?.totalTransactions}`);
            assert(d.body.data.dac7?.businessId === '1234567-8', `dac7 businessId ${d.body.data.dac7?.businessId}`);
            assert(d.body.data.vat?.totalVat > 0, `vat total ${d.body.data.vat?.totalVat}`);
            assert(d.body.data.vat?.rate === 25.5, `vat rate ${d.body.data.vat?.rate}`);
        });

        await test('Cross-owner isolation: the buyer cannot read the seller company payables (403/404)', async () => {
            const p = await json(`/v1/orgs/${slug}/payables`, { headers: auth(buyer.token) });
            assert(p.status === 404 || p.status === 403, `expected 403/404 for a non-member, got ${p.status}`);
        });

    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 300));
        cleanupDb();
    }
    console.log('\n' + '─'.repeat(48));
    console.log(`EE money acceptance: ${passed} passed, ${failed} failed of ${passed + failed}`);
    if (failed > 0) process.exit(1);
    console.log('✅ All EE money acceptance checks passed!\n');
}

await main();
