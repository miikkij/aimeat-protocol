/**
 * @file test/e2e-commerce.ts
 * @description E2E for the commerce core (TARGET-033 phase 1): checkout sessions over agent
 *   offers. Covers the UCP discovery profile, create/read/update/cancel, the morsel-settled
 *   complete (charge + fee + fulfillment TASK + seller order copy), and the failure gates —
 *   insufficient balance (402), unknown offer (404), private offer (403), unpriced offer (422),
 *   unknown payment handler (422), double-complete and complete-after-cancel (409), and the
 *   cross-owner 403/404 isolation Rule 10 requires.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=commerce
 * @version-history
 *   v1.0.0 — 2026-07-13 — Initial commerce checkout suite (TARGET-033 phase 1)
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
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `com${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Commerce', password: 'Commerce1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Commerce', password: 'Commerce1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    const token = tok.body.data.token as string;
    const roles: string[] = (JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8')).roles) ?? [];
    return { name, token, roles };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    assert(r.status === 200, `wallet ${r.status}`);
    return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

console.log('\n=== AIMEAT Commerce E2E (TARGET-033) ===\n');

let op: Awaited<ReturnType<typeof setupOwner>>;
let seller: Awaited<ReturnType<typeof setupOwner>>;
let buyer: Awaited<ReturnType<typeof setupOwner>>;
let vendorGaii = '';
const PRICE = 10;

await test('Setup: operator-neutral + seller + buyer owners; seller publishes priced offers', async () => {
    // Register a NEUTRAL owner first: on a fresh DB the first registered owner is self-healed
    // into the operator role — without this, the SELLER would be the operator and the fee leg
    // would credit the seller, breaking the balance assertions below.
    op = await setupOwner('o');
    seller = await setupOwner('s'); buyer = await setupOwner('b');
    assert(!seller.roles.includes('operator') && !buyer.roles.includes('operator'), 'seller/buyer must not hold the operator role');
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    vendorGaii = `vendor#${seller.name}@${NODE_ID}`;
    const offers = {
        offers: [
            {
                id: 'translate-doc', title: 'Translate a document', ask: 'Send a document; I translate it to Finnish.',
                deliverable: { format: 'document', sample: 'untested' },
                price: { morsels: PRICE, unit: 'per-call' }, visibility: 'public',
            },
            {
                id: 'secret-work', title: 'Private work', ask: 'Owner-only offer.',
                deliverable: { format: 'document', sample: 'untested' },
                price: { morsels: 1 }, visibility: 'private',
            },
            {
                id: 'free-listing', title: 'Listed but unpriced', ask: 'Public offer with no price.',
                deliverable: { format: 'document', sample: 'untested' },
                visibility: 'public',
            },
        ],
    };
    const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify(offers) });
    assert(pub.status === 200, `publish offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
});

await test('1. GET /.well-known/ucp — profile advertises checkout + the morsel handler', async () => {
    const res = await fetch(`${BASE}/.well-known/ucp`);
    assert(res.status === 200, `status ${res.status}`);
    const profile = await res.json() as any;
    assert(typeof profile.ucp?.version === 'string', 'missing ucp.version');
    assert(profile.ucp.services?.rest?.endpoint?.endsWith('/v1/commerce'), `rest endpoint: ${profile.ucp.services?.rest?.endpoint}`);
    assert(profile.ucp.services?.mcp?.endpoint?.endsWith('/v1/mcp'), 'missing mcp transport');
    const checkout = (profile.ucp.capabilities || []).find((c: any) => String(c.name).includes('checkout'));
    assert(!!checkout?.endpoints?.create, 'missing checkout capability endpoints');
    const handlers = (profile.ucp.payment_handlers || []).map((h: any) => h.id);
    assert(handlers.includes('io.aimeat.morsels'), `morsel handler missing: ${JSON.stringify(handlers)}`);
    assert(Array.isArray(profile.signing_keys) && profile.signing_keys[0]?.crv === 'Ed25519', 'missing Ed25519 signing key');
});

let sessionId = '';
await test('2. Buyer opens a checkout session (quantity 2) → 201, priced from the live offer', async () => {
    const r = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 2 }], note: 'Two documents attached tomorrow' }),
    });
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    sessionId = s.id;
    assert(s.status === 'open' && s.total === PRICE * 2 && s.currency === 'morsel', `session: ${JSON.stringify(s)}`);
    assert(s.sellerOwner === seller.name && s.buyerOwner === buyer.name, 'parties recorded');
});

await test('3. Buyer reads the session back; seller CANNOT (404 isolation)', async () => {
    const mine = await json(`/v1/commerce/checkout-sessions/${sessionId}`, { headers: auth(buyer.token) });
    assert(mine.status === 200 && mine.body.data.session.id === sessionId, `own read ${mine.status}`);
    const theirs = await json(`/v1/commerce/checkout-sessions/${sessionId}`, { headers: auth(seller.token) });
    assert(theirs.status === 404, `expected 404 for a foreign session, got ${theirs.status}`);
});

await test('4. PATCH items → quantity 1, total re-quoted', async () => {
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}`, {
        method: 'PATCH', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1 }] }),
    });
    assert(r.status === 200 && r.body.data.session.total === PRICE, `patch ${r.status}: ${JSON.stringify(r.body.data?.session)}`);
});

await test('5. Complete → charged, fee split, fulfillment TASK queued for the seller agent', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const opBefore = await balance(op.token);
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    assert(s.status === 'completed', `status ${s.status}`);
    assert(s.receipt?.handler === 'io.aimeat.morsels' && s.receipt.charged === PRICE, `receipt: ${JSON.stringify(s.receipt)}`);
    assert(s.receipt.charged === s.receipt.earned + s.receipt.fee, 'fee arithmetic');
    assert((s.fulfillment?.taskIds || []).length === 1, `taskIds: ${JSON.stringify(s.fulfillment)}`);
    assert(await balance(buyer.token) === buyerBefore - PRICE, 'buyer debited');
    assert(await balance(seller.token) === sellerBefore + s.receipt.earned, 'seller credited (minus fee)');
    // Fee destination (operator mode is the default): when our neutral owner holds the operator
    // role (fresh DB), the fee lands on them exactly. On a shared server another suite's owner may
    // be the operator — the seller/buyer legs above still pin the arithmetic.
    if (op.roles.includes('operator')) {
        assert(await balance(op.token) === opBefore + s.receipt.fee, 'operator received the fee (fee mode: operator)');
    }
    const tasks = await json('/v1/agents/vendor/tasks', { headers: auth(seller.token) });
    const task = (tasks.body.data.tasks || []).find((t: any) => (t.scope || []).some((sc: any) => sc.name === 'commerce_session' && sc.value === sessionId));
    assert(!!task, 'fulfillment task visible to the seller');
    assert(task.status === 'queued', `task status ${task.status}`);
});

await test('6. Double-complete is refused (409 SESSION_NOT_OPEN)', async () => {
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 409 && r.body.error?.code === 'SESSION_NOT_OPEN', `expected 409 SESSION_NOT_OPEN, got ${r.status} ${r.body.error?.code}`);
});

await test('7. Insufficient balance → 402, session stays open for retry', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1000 }] }),
    });
    assert(create.status === 201, `create ${create.status}`);
    const id = create.body.data.session.id;
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 402 && r.body.error?.code === 'INSUFFICIENT_BALANCE', `expected 402, got ${r.status} ${r.body.error?.code}`);
    const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(buyer.token) });
    assert(back.body.data.session.status === 'open', 'session still open after a failed charge');
});

await test('8. Unknown offer → 404; private offer cross-owner → 403; unpriced → 422', async () => {
    const ghost = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'no-such-offer' }] }) });
    assert(ghost.status === 404 && ghost.body.error?.code === 'OFFER_NOT_FOUND', `ghost: ${ghost.status} ${ghost.body.error?.code}`);
    const priv = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'secret-work' }] }) });
    assert(priv.status === 403 && priv.body.error?.code === 'OFFER_PRIVATE', `private: ${priv.status} ${priv.body.error?.code}`);
    const unpriced = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'free-listing' }] }) });
    assert(unpriced.status === 422 && unpriced.body.error?.code === 'OFFER_NOT_FOR_SALE', `unpriced: ${unpriced.status} ${unpriced.body.error?.code}`);
});

await test('9. Unknown payment handler → 422', async () => {
    const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }) });
    const id = create.body.data.session.id;
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.stripe.spt' } }) });
    assert(r.status === 422 && r.body.error?.code === 'UNKNOWN_PAYMENT_HANDLER', `expected 422, got ${r.status} ${r.body.error?.code}`);
});

await test('10. Cancel closes the session; complete after cancel → 409', async () => {
    const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }) });
    const id = create.body.data.session.id;
    const cancel = await json(`/v1/commerce/checkout-sessions/${id}`, { method: 'PATCH', headers: auth(buyer.token), body: JSON.stringify({ cancel: true }) });
    assert(cancel.status === 200 && cancel.body.data.session.status === 'cancelled', `cancel: ${cancel.status}`);
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 409, `expected 409 after cancel, got ${r.status}`);
});

await test('11. Seller order copy exists under the seller GHII (commerce.order.*)', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`commerce.order.${sessionId}`)}`, { headers: auth(seller.token) });
    assert(r.status === 200, `order read ${r.status}: ${JSON.stringify(r.body.error)}`);
    const order = r.body.data.value ?? r.body.data.record?.value ?? r.body.data;
    assert((order.id ?? order.session?.id) === sessionId || JSON.stringify(order).includes(sessionId), 'order carries the session id');
});

await test('12. Buyer list shows own sessions; seller sees none of them', async () => {
    const mine = await json('/v1/commerce/checkout-sessions', { headers: auth(buyer.token) });
    assert(mine.status === 200, `list ${mine.status}`);
    const ids = (mine.body.data.sessions || []).map((s: any) => s.id);
    assert(ids.includes(sessionId), `completed session in buyer list: ${JSON.stringify(ids)}`);
    const sellers = await json('/v1/commerce/checkout-sessions', { headers: auth(seller.token) });
    const sellerIds = (sellers.body.data.sessions || []).map((s: any) => s.id);
    assert(!sellerIds.includes(sessionId), 'buyer sessions are not visible in the seller\'s session list');
});

await test('13. Seller order list shows the received order; buyer\'s order list does not', async () => {
    const got = await json('/v1/commerce/orders', { headers: auth(seller.token) });
    assert(got.status === 200, `orders ${got.status}`);
    const ids = (got.body.data.orders || []).map((o: any) => o.id);
    assert(ids.includes(sessionId), `order in seller list: ${JSON.stringify(ids)}`);
    const buyers = await json('/v1/commerce/orders', { headers: auth(buyer.token) });
    const buyerIds = (buyers.body.data.orders || []).map((o: any) => o.id);
    assert(!buyerIds.includes(sessionId), 'the order copy belongs to the seller, not the buyer');
});

await test('14. Anonymous requests are rejected (401)', async () => {
    const r = await json('/v1/commerce/checkout-sessions', { method: 'POST', body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`Commerce E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
