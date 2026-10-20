/**
 * @file test/e2e-money-path-races.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two requests at the same moment on the money paths: each test fires them together
 *   (Promise.all) against a real node on the run's backend, and asserts that exactly one of them has
 *   the effect and the other is refused (quality round 2026-10-18,
 *   wish-rahapolkujen-kilpatilanteet-kaksoismyynti-peruutus-ja-tilin-).
 *
 *   - Wrong passwords sent in parallel lock the account, as the same number sent one by one does.
 *   - An EXCHANGE delivery sent twice at once, over REST and over MCP, settles once.
 *   - Two creates with one UCP Idempotency-Key make one checkout.
 *   - Two completions of one UCP guest checkout charge the card once and book one sale.
 *   - A subscription cancelled while its renewal is charging stays cancelled.
 *
 *   The package-sale approval and the node-holder record are tested in e2e-package-sale.ts, which
 *   has the repository and the selling node this needs.
 *
 *   HOW A TEST CAN FAIL. Two HTTP requests to one process are interleaved only where a request
 *   waits for real I/O between its read and its write; a synchronous SQLite driver otherwise runs
 *   one to its end before the other starts (test/unit/memory-cas-primitives.test.ts). So a path
 *   whose check and write have no such wait between them is fired at the function the route calls,
 *   which interleaves at every await on both backends: the UCP completion and the MCP delivery. The
 *   renewal has no route, only the daily job, so its test runs the job and the cancel together.
 *
 *   The node is in this process (port 40296) on a database of its own on the run's backend
 *   (helpers/own-node-db.ts), so the payment handlers it charges through are stand-ins this file
 *   registers: Stripe's id for the UCP card, and a kept-card handler for the renewal.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=money-path-races
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-18 — Initial (wish-rahapolkujen-kilpatilanteet-kaksoismyynti-peruutus-ja-tilin-).
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { registerPaymentHandler } from '../src/commerce/payment-handlers.js';
import { STRIPE_HANDLER_ID } from '../src/commerce/stripe-handler.js';
import { completeGuestCheckout, createGuestCheckout } from '../src/commerce/ucp-guest-checkout.js';
import { cancelSubscription, runSubscriptionRenewals, SUBSCRIPTION_PREFIX } from '../src/commerce/subscriptions.js';
import { registerExchangeRunTools } from '../src/mcp/exchange-run.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner, ownerSignIn } from './helpers/owner-login.js';

const PORT = parseInt(process.env.E2E_RACES_PORT ?? '40296', 10);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_BASE_URL = BASE;
const adminPw = randomBytes(16).toString('base64url');
process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
const { config } = loadConfig({});
Object.assign(config, {
    port: PORT, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw, commerceEnabled: true,
    ...(await ownNodeDb('money-races', { memory: true })).config,
});
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

// The card the UCP checkout charges: Stripe's handler id, answering after a pause the way a call to
// Stripe does, and counting what it was asked to charge.
const ucpCharges: string[] = [];
registerPaymentHandler({
    id: STRIPE_HANDLER_ID, title: 'Stripe (stand-in)', currencies: ['USD', 'EUR'],
    async collect(_ctx, a) { await sleep(40); ucpCharges.push(a.reference); return { trackingCode: `pi_race_${ucpCharges.length}` }; },
    async refund() { return; },
} as never);

// The kept card a renewal charges. The charge waits until the test lets it go, so a cancel can land
// while it is in progress.
const KEPT = 'races.kept-card';
let releaseCharge: () => void = () => undefined;
let chargeStarted: () => void = () => undefined;
const renewalCharges: string[] = [];
registerPaymentHandler({
    id: KEPT, title: 'Kept card (stand-in)', currencies: ['EUR'],
    async collect() { throw new Error('not used'); },
    async refund() { return; },
    async chargeSaved(_ctx, a) {
        chargeStarted();
        await new Promise<void>(r => { releaseCharge = r; });
        renewalCharges.push(a.reference);
        return { trackingCode: `ch_race_${renewalCharges.length}` };
    },
} as never);

console.log('\n=== Two requests at once on the money paths ===\n');

const stamp = Date.now().toString(36).slice(-6);
await registerOwner(BASE, `raceop${stamp}`);   // the first owner on a fresh node is its operator
const provider = await registerOwner(BASE, `raceprov${stamp}`);
const consumer = await registerOwner(BASE, `racecons${stamp}`);
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

// ── The password lock ─────────────────────────────────────────────────────────────────────────

await test('Wrong passwords sent at the same moment lock the account, and the right one is then refused', async () => {
    const victim = await registerOwner(BASE, `racelock${stamp}`);
    const guesses = config.passwordLockoutAttempts + 2;
    const wrong = await Promise.all(Array.from({ length: guesses }, (_, i) =>
        json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: victim.name, password: `Wrong-guess-${i}-2026` }) })));
    assert(wrong.every(r => r.status === 401 || r.status === 429), `every guess is refused: ${JSON.stringify(wrong.map(r => r.status))}`);
    const right = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: victim.name, password: victim.password }) });
    assert(right.status === 429 && right.body.error?.code === 'PASSWORD_LOCKED',
        `${guesses} wrong guesses at once lock the account as ${config.passwordLockoutAttempts} one by one do: ${right.status} ${JSON.stringify(right.body.error ?? right.body.data?.token?.slice(0, 8))}`);
});

await test('One wrong password, then the right one, still signs in (the single request is unchanged)', async () => {
    const one = await registerOwner(BASE, `raceone${stamp}`);
    const wrong = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: one.name, password: 'Not-the-password-2026' }) });
    assert(wrong.status === 401, `wrong ${wrong.status}`);
    const right = await ownerSignIn(BASE, one.name, one.password);
    assert(right.status === 200 && typeof right.body.data?.token === 'string', `right ${right.status} ${JSON.stringify(right.body.error)}`);
});

// ── EXCHANGE agent work ───────────────────────────────────────────────────────────────────────

const TOLL = 5;
let offeringId = '';
async function startWork(): Promise<string> {
    const st = await json('/v1/exchange/work', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: offeringId, input: { text: 'a document' } }) });
    assert(st.status === 201, `start work ${st.status}: ${JSON.stringify(st.body?.error)}`);
    return st.body.data.work.work_id as string;
}

await test('Setup: the provider lists agent work, the consumer holds a contract for it', async () => {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ name: 'worker', owner: provider.name, capabilities: ['actions'] }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        kind: 'agent-work', agent_name: 'worker', task_type: 'summarize', title: 'Summaries', toll_morsels: TOLL,
        usage_terms: { derivatives: true, resale: false, attribution: true },
        input_schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
    }) });
    assert(r.status === 201, `offering ${r.status}: ${JSON.stringify(r.body?.error)}`);
    offeringId = r.body.data.offering.offeringId;
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: offeringId, cap_units: 100 }) });
    assert(acc.status === 201, `contract ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
});

await test('Two deliveries of one work at once over REST: one settles, the other is 409 WORK_NOT_OPEN, the consumer pays once', async () => {
    const id = await startWork();
    const before = await balance(consumer.token);
    const deliver = () => json(`/v1/exchange/work/${id}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: { summary: 'Short.' } }) });
    const results = await Promise.all([deliver(), deliver()]);
    const done = results.filter(r => r.status === 200);
    const refused = results.filter(r => r.status === 409 && r.body.error?.code === 'WORK_NOT_OPEN');
    assert(done.length === 1 && refused.length === 1, `one settles, one is refused: ${JSON.stringify(results.map(r => [r.status, r.body.error?.code]))}`);
    assert(await balance(consumer.token) === before - TOLL, `charged once: ${before} -> ${await balance(consumer.token)}`);
});

await test('Two deliveries of one work at once over MCP: one settles, the other is WORK_NOT_OPEN, the consumer pays once', async () => {
    const id = await startWork();
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { registerTool: (name: string, _config: unknown, h: (a: any) => Promise<any>) => { handlers[name] = h; } } as unknown as McpServer;
    registerExchangeRunTools(mock, storage, config, () => provider.ghii, () => provider.token, ['exchange:write']);
    const before = await balance(consumer.token);
    const results = await Promise.all([1, 2].map(() => handlers.aimeat_exchange_work_deliver!({ work_id: id, output: { summary: 'Short.' } })));
    const texts = results.map((r: any) => String(r.content?.[0]?.text ?? ''));
    const ok = results.filter((r: any) => !r.isError);
    const refused = texts.filter(t => t.includes('WORK_NOT_OPEN'));
    assert(ok.length === 1 && refused.length === 1, `one settles, one is refused: ${JSON.stringify(texts.map(t => t.slice(0, 80)))}`);
    assert(await balance(consumer.token) === before - TOLL, `charged once: ${before} -> ${await balance(consumer.token)}`);
});

await test('The consumer cannot deliver the provider\'s work over MCP, and nothing settles', async () => {
    const id = await startWork();
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { registerTool: (name: string, _config: unknown, h: (a: any) => Promise<any>) => { handlers[name] = h; } } as unknown as McpServer;
    registerExchangeRunTools(mock, storage, config, () => consumer.ghii, () => consumer.token, ['exchange:write']);
    const before = await balance(consumer.token);
    const r = await handlers.aimeat_exchange_work_deliver!({ work_id: id, output: { summary: 'Mine.' } });
    assert(r.isError === true && String(r.content?.[0]?.text ?? '').includes('NOT_FOUND'), `refused: ${JSON.stringify(r).slice(0, 200)}`);
    assert(await balance(consumer.token) === before, 'nothing settles');
});

await test('One delivery over REST settles as before', async () => {
    const id = await startWork();
    const before = await balance(consumer.token);
    const r = await json(`/v1/exchange/work/${id}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: { summary: 'Short.' } }) });
    assert(r.status === 200 && r.body.data.work.state === 'delivered' && r.body.data.work.charged_units === TOLL, `${r.status} ${JSON.stringify(r.body.error ?? r.body.data.work)}`);
    assert(await balance(consumer.token) === before - TOLL, 'charged once');
    const again = await json(`/v1/exchange/work/${id}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: {} }) });
    assert(again.status === 409 && again.body.error?.code === 'WORK_NOT_OPEN', `again ${again.status}`);
});

// ── The UCP checkout ──────────────────────────────────────────────────────────────────────────

const shop = await registerOwner(BASE, `raceshop${stamp}`);
const vendorName = `racevendor${stamp}`;
const PROFILE = 'https://platform.races.example/.well-known/ucp';
const UCP_HEADERS = { 'UCP-Agent': `profile="${PROFILE}"` };
let sku = '';

await test('Setup: the shop sells an offer for USD and takes card payment', async () => {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(shop.token), body: JSON.stringify({ name: vendorName, owner: shop.name, scopes: ['task:read', 'task:write'] }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    sku = `offer:${reg.body.data.agent.gaii}:audit`;
    const pub = await json(`/v1/agents/${vendorName}/offers`, { method: 'PUT', headers: auth(shop.token), body: JSON.stringify({ offers: [
        { id: 'audit', title: 'Audit', ask: 'Send a URL.', deliverable: { format: 'document', sample: 'untested' }, priceMoney: { amount: 19_990_000, currency: 'USD' }, visibility: 'public' },
    ] }) });
    assert(pub.status === 200, `offers ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const now = new Date().toISOString();
    await storage.setMemory({ key: 'commerce.psp', ownerGaii: shop.ghii, value: { secretKey: 'sk_test_races' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
});

await test('Two creates with one Idempotency-Key at once make one checkout', async () => {
    const key = `races-${stamp}-${randomBytes(8).toString('hex')}`;
    const create = () => json('/ucp/2026-08-25/checkout-sessions', {
        method: 'POST', headers: { ...UCP_HEADERS, 'Idempotency-Key': key }, body: JSON.stringify({ line_items: [{ item: { id: sku }, quantity: 1 }] }),
    });
    const results = await Promise.all([create(), create()]);
    const ids = new Set(results.filter(r => r.status === 201).map(r => r.body.id));
    const refused = results.filter(r => r.status === 409 && r.body.code === 'idempotency_conflict');
    assert(ids.size === 1 && results.every(r => r.status === 201 || refused.includes(r)),
        `one checkout, and a second answer is that one or a refusal: ${JSON.stringify(results.map(r => [r.status, r.body.id ?? r.body.code]))}`);
    const again = await create();
    assert(again.status === 201 && ids.has(again.body.id), `the key answers the same checkout after: ${again.status} ${again.body.id}`);
});

await test('Two completions with one Idempotency-Key at once: one runs, the other is 409 idempotency_conflict, and the key then answers the first', async () => {
    const created = await json('/ucp/2026-08-25/checkout-sessions', { method: 'POST', headers: UCP_HEADERS,
        body: JSON.stringify({ line_items: [{ item: { id: sku }, quantity: 1 }], buyer: { email: 'pat@example.com' } }) });
    assert(created.status === 201, `create ${created.status} ${JSON.stringify(created.body)}`);
    const key = `races-${stamp}-${randomBytes(8).toString('hex')}`;
    const body = JSON.stringify({ payment: { instruments: [{ id: 'i1', handler_id: 'stripe_payments', type: 'card', selected: true, credential: { type: 'stripe_payment_token', token: 'spt_races_222222' } }] } });
    const complete = () => json(`/ucp/2026-08-25/checkout-sessions/${created.body.id}/complete`, { method: 'POST', headers: { ...UCP_HEADERS, 'Idempotency-Key': key }, body });
    const results = await Promise.all([complete(), complete()]);
    const done = results.filter(r => r.status === 200 && r.body.status === 'completed');
    const refused = results.filter(r => r.status === 409 && r.body.code === 'idempotency_conflict');
    assert(done.length === 1 && refused.length === 1, `one runs, one hears the key is in use: ${JSON.stringify(results.map(r => [r.status, r.body.status ?? r.body.code, r.body.messages?.[0]?.code]))}`);
    const replayed = await complete();
    assert(replayed.status === 200 && replayed.body.status === 'completed' && replayed.body.order?.id === done[0]!.body.order?.id, `the key answers the first: ${replayed.status} ${JSON.stringify(replayed.body.messages ?? replayed.body.status)}`);
});

await test('A completion with an Idempotency-Key that fails can be sent again with the key', async () => {
    const created = await json('/ucp/2026-08-25/checkout-sessions', { method: 'POST', headers: UCP_HEADERS,
        body: JSON.stringify({ line_items: [{ item: { id: sku }, quantity: 1 }] }) });
    assert(created.status === 201 && created.body.status === 'incomplete', `create ${created.status}`);
    const key = `races-${stamp}-${randomBytes(8).toString('hex')}`;
    const body = JSON.stringify({ payment: { instruments: [{ id: 'i1', handler_id: 'stripe_payments', type: 'card', selected: true, credential: { type: 'stripe_payment_token', token: 'spt_races_333333' } }] } });
    const complete = () => json(`/ucp/2026-08-25/checkout-sessions/${created.body.id}/complete`, { method: 'POST', headers: { ...UCP_HEADERS, 'Idempotency-Key': key }, body });
    const first = await complete();
    assert(first.status === 200 && first.body.messages?.[0]?.code === 'missing', `no email: ${first.status} ${JSON.stringify(first.body.messages)}`);
    const second = await complete();
    assert(second.status === 200 && second.body.messages?.[0]?.code === 'missing', `the key runs again, it is not held: ${second.status} ${JSON.stringify(second.body)}`);
});

await test('Two completions of one guest checkout at once: the card is charged once and one order is booked', async () => {
    const s = await createGuestCheckout(storage, config, { profileUrl: PROFILE, lineItems: [{ item: { id: sku }, quantity: 1 }], buyer: { email: 'pat@example.com' } });
    const payment = { instruments: [{ selected: true, credential: { type: 'stripe_payment_token', token: 'spt_races_000000' } }] };
    const charged = ucpCharges.length;
    const outcomes = await Promise.allSettled([1, 2].map(() => completeGuestCheckout(storage, config, s.id, PROFILE, payment)));
    const done = outcomes.filter(o => o.status === 'fulfilled');
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    assert(ucpCharges.length - charged === 1, `the card is charged once, not ${ucpCharges.length - charged} times`);
    assert(done.length === 1 && refused.length === 1 && (refused[0]!.reason as { code?: string }).code === 'checkout_locked',
        `one completes, the other is checkout_locked: ${JSON.stringify(outcomes.map(o => o.status === 'fulfilled' ? 'completed' : (o.reason as { code?: string }).code))}`);
    const orders = (await storage.listMemory(shop.ghii, { prefix: 'commerce.order.uco_' })).filter(r => (r.value as { ucpOrder?: { checkoutId?: string } }).ucpOrder?.checkoutId === s.id);
    assert(orders.length === 1, `one order: ${orders.length}`);
});

await test('One completion over HTTP completes as before, and a second one after it is refused', async () => {
    const created = await json('/ucp/2026-08-25/checkout-sessions', { method: 'POST', headers: UCP_HEADERS,
        body: JSON.stringify({ line_items: [{ item: { id: sku }, quantity: 1 }], buyer: { email: 'pat@example.com' } }) });
    assert(created.status === 201 && created.body.status === 'ready_for_complete', `create ${created.status} ${JSON.stringify(created.body)}`);
    const body = JSON.stringify({ payment: { instruments: [{ id: 'i1', handler_id: 'stripe_payments', type: 'card', selected: true, credential: { type: 'stripe_payment_token', token: 'spt_races_111111' } }] } });
    const one = await json(`/ucp/2026-08-25/checkout-sessions/${created.body.id}/complete`, { method: 'POST', headers: UCP_HEADERS, body });
    assert(one.status === 200 && one.body.status === 'completed', `complete ${one.status} ${JSON.stringify(one.body.messages ?? one.body.status)}`);
    const two = await json(`/ucp/2026-08-25/checkout-sessions/${created.body.id}/complete`, { method: 'POST', headers: UCP_HEADERS, body });
    assert(two.status === 200 && two.body.messages?.[0]?.code === 'checkout_closed', `again ${two.status} ${JSON.stringify(two.body.messages)}`);
});

// ── A subscription's renewal and its cancel ──────────────────────────────────────────────────

const EXT = `racesubs${stamp}`;
await test('A subscription cancelled while its renewal is charging stays cancelled, and the renewal still extends it', async () => {
    const manifest = JSON.stringify({
        metadata: { name: EXT, version: '1.0.0', description: 'races e2e', author: 'e2e' },
        actions: [{ id: 'plans', method: 'POST', path: '/plans', script: 'plans' }],
        limits: { timeout_ms: 5000, max_api_calls: 5 },
    });
    const scripts = { plans: `export default async function(ctx){ await ctx.memory.set('subscription.plans', { plans: [{ id: 'monthly', title: 'Monthly', amount: 3990000, currency: 'EUR', period_days: 30 }] }); return { ok: true }; }` };
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(shop.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(shop.token) })).status === 200, 'activate');
    const plans = await json(`/v1/ext/${EXT}/plans`, { method: 'POST', headers: auth(shop.token), body: '{}' });
    assert(plans.status === 200, `plans ${plans.status}: ${JSON.stringify(plans.body?.error)}`);

    const until = new Date(Date.now() + 86_400_000).toISOString();
    const now = new Date().toISOString();
    await storage.setMemory({
        key: `${SUBSCRIPTION_PREFIX}${EXT}.monthly`, ownerGaii: consumer.ghii, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        value: {
            ext: EXT, plan: 'monthly', title: 'Monthly', seller_ghii: shop.ghii, buyer_ghii: consumer.ghii, amount: 3990000, currency: 'EUR', period_days: 30,
            started_at: now, active_until: until, auto_renew: true, kept_payment: { handler: KEPT, customer: 'cus_race', payment_method: 'pm_race' }, updated_at: now,
        },
    });
    const started = new Promise<void>(r => { chargeStarted = r; });
    const [outcomes] = await Promise.all([
        runSubscriptionRenewals(storage, config),
        (async () => { await started; await cancelSubscription(storage, consumer.ghii, EXT, 'monthly'); releaseCharge(); })(),
    ]);
    const mine = outcomes.find(o => o.ext === EXT);
    assert(mine?.result === 'renewed' && renewalCharges.length === 1, `renewed once: ${JSON.stringify(mine)} charges ${renewalCharges.length}`);
    const rec = (await storage.getMemory(consumer.ghii, `${SUBSCRIPTION_PREFIX}${EXT}.monthly`))!.value as { auto_renew: boolean; active_until: string };
    assert(rec.auto_renew === false, `the cancel made during the charge holds: auto_renew ${rec.auto_renew}`);
    assert(Date.parse(rec.active_until) === Date.parse(until) + 30 * 86_400_000, `the paid renewal extends the period: ${rec.active_until}`);
});

server.close();
console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
