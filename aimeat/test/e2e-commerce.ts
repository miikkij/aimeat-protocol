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
 *   2026-10-25 — 20: the signed-out capability read names the echo capability by its full id
 *     `ext:<seller>/<short>:echo`; the seller's own tool manifest keeps the bare binding, as names live in
 *     the owner's namespace (secaudit2026oct22).
 *   2026-10-20 — 27b: a PRIVATE app-tool manifest is not sold, at session creation or at completion
 *     (secaudit 2026-10, sellable-resolvers.ts:appToolSellableResolver:private-manifest-sold).
 *   2026-10-16 — 37c: PUT /v1/commerce/payout/invoice without a credential is refused (QA audit W29).
 *   2026-10-16 — 6b: three completions of one session at the same moment complete once and charge the
 *     pacing once (QA audit S8-04). 37c: the invoice rail is refused for a callable app-tool, a line
 *     delivered at once, until the seller turns invoice.accept_immediate on, and nothing is charged or
 *     delivered on the refusal (QA audit S8-03).
 *   v1.8.1 — 2026-10-12 — The seller's offers and the app-tool manifest carry their morsel amounts as
 *     tollMorsels instead of price.morsels, which node 4.0.0 refuses on the offers route with
 *     MORSEL_PRICE_REMOVED; 27 tests had failed in a cascade from that one setup. Tests 28, 31 and 32
 *     read toll_morsels, and assert the deprecated `price` mirror on 3.x and its absence on 4.0.0,
 *     which drops it (src/models/app-tool-schemas.ts presentToolPacing). Test 20 asserts 403
 *     SCOPE_REQUIRED (the H-3 check) on 3.x and 403 SCOPE_DENIED on 4.0.0, where the complete route's
 *     REST scope gate refuses an app without contract:spend before the session service is reached.
 *   v1.8.0 — 2026-10-11 — 2, 4, 5, 7, 9, 17, 18, 22 and 26 asserted the old model, where a morsel amount
 *     was a price settled by the morsel handler. A morsel amount is pacing now: a morsel-written offer or
 *     tool is free with that pacing, the receipt carries `pacing`, a short balance is INSUFFICIENT_MORSELS,
 *     the 402 names the daily allowance, and the handler checks run on a money offer (money-doc)
 *     (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
 *   v1.7.0 — 2026-09-16 — 34b: the Stripe secrets are stored encrypted, so the generic memory door
 *     and the operator's memory door carry a hint and no secret; 35 asserts the encrypted shape.
 *   v1.6.0 — 2026-07-28 — Seller payment rails now that money settlement is core: payout status
 *     reports card/stablecoin/invoice, the Stripe secret is written and cleared through
 *     /v1/commerce/payout/stripe without ever being echoed, one rail's write never clears the
 *     other's setting, a card sale with no seller credentials fails with PSP_NOT_CONFIGURED, and
 *     the invoice rail completes the same sale by booking a payable
 *   v1.5.0 — 2026-07-14 — Web Bot Auth: outbound UCP profile fetch carries a verifiable RFC 9421
 *     Ed25519 signature (verified against /.well-known/http-message-signatures-directory)
 *   v1.4.0 — 2026-07-14 — MCP card commerce_tools (TARGET-034 phase D): /v1/commerce/tools
 *     catalog shape + inline card embed + feed/card sku-drift guard
 *   v1.3.0 — 2026-07-14 — WebMCP bridge (TARGET-034 phase C): tool listing shape, 402→checkout→
 *     result round-trip, free-callable invoke + auth/404 gates, bridge lib serving
 *   v1.2.0 — 2026-07-14 — App-tool TASK path (TARGET-034 phase B): unbound tools purchasable —
 *     TASK queued for the manifest agent / owner GHII, buyer input on the task, feed fulfillment
 *     hint; the phase-A unbound-422 gate is gone
 *   v1.1.0 — 2026-07-14 — App-tool purchases (TARGET-034 phase A): manifest + feed listing +
 *     paid capability invoke with result on fulfillment, failure gates (404/422/400), refund on
 *     missing capability, free self-purchase
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
import { ownerSignIn } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { MORSEL_PRICE_FIELDS_REMOVED_IN } from '../src/config-pacing.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../src/utils/rest-scope-release.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function setupOwner(label: string) {
    const name = `com${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Commerce', password: 'Commerce1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Commerce', password: 'Commerce1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'Commerce1234');
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

/** The seller's published offers. Hoisted because PUT /v1/agents/:name/offers REPLACES the whole
 *  list: a later test that adds one must re-publish these too, or it silently deletes them. */
const BASE_OFFERS = [
    {
        id: 'translate-doc', title: 'Translate a document', ask: 'Send a document; I translate it to Finnish.',
        deliverable: { format: 'document', sample: 'untested' },
        tollMorsels: PRICE, visibility: 'public',
    },
    {
        id: 'secret-work', title: 'Private work', ask: 'Owner-only offer.',
        deliverable: { format: 'document', sample: 'untested' },
        tollMorsels: 1, visibility: 'private',
    },
    {
        id: 'free-listing', title: 'Listed but unpriced', ask: 'Public offer with no price.',
        deliverable: { format: 'document', sample: 'untested' },
        visibility: 'public',
    },
    {
        id: 'money-doc', title: 'Translate for money', ask: 'Send a document; I translate it for 1 EUR.',
        deliverable: { format: 'document', sample: 'untested' },
        priceMoney: { amount: 1_000_000, currency: 'EUR' }, tollMorsels: 2, visibility: 'public',
    },
];

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
    const offers = { offers: BASE_OFFERS };
    const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify(offers) });
    assert(pub.status === 200, `publish offers ${pub.status}: ${JSON.stringify(pub.body.error)}`);
});

// The signed-in checkout at /ucp/v1 is written against UCP 2026-04-08, and its profile has its own
// address since /.well-known/ucp became the 2026-08-25 profile of the guest checkout (2026-10-08).
await test('1. GET /.well-known/ucp/2026-04-08 — profile advertises checkout and money handlers only', async () => {
    const res = await fetch(`${BASE}/.well-known/ucp/2026-04-08`);
    assert(res.status === 200, `status ${res.status}`);
    const profile = await res.json() as any;
    assert(typeof profile.ucp?.version === 'string', 'missing ucp.version');
    // Services are keyed by VERTICAL and each entry names its own transport. The MCP server is
    // NOT declared here: it is real, but it is not a UCP binding, and /.well-known/mcp.json is
    // where it belongs.
    const shopping = profile.ucp.services?.shopping;
    assert(Array.isArray(shopping), 'ucp.services.shopping must be an array of entries');
    const svc = shopping[0];
    for (const f of ['version', 'spec', 'transport', 'endpoint', 'schema']) {
        assert(typeof svc?.[f] === 'string' && svc[f].length > 0, `service entry missing ${f}`);
    }
    assert(['rest', 'mcp', 'a2a', 'embedded'].includes(svc.transport), `bad transport: ${svc.transport}`);
    assert(svc.endpoint.endsWith('/ucp/v1'), `rest endpoint: ${svc.endpoint}`);
    assert(!profile.ucp.services.webmcp, 'webmcp is not a UCP transport and must not be a service');
    const checkout = profile.ucp.capabilities['dev.ucp.shopping.checkout']?.[0];
    assert(!!checkout?.endpoints?.create, 'missing checkout capability endpoints');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(checkout.version), `capability version must be YYYY-MM-DD, got ${checkout.version}`);
    // A UCP price is money: the morsel ledger is not a payment handler here (ruling D4, 2026-10-11).
    const handlers = profile.ucp.payment_handlers || [];
    assert(!handlers.some((h: any) => h.id === 'io.aimeat.morsels'), `the morsel ledger is advertised: ${JSON.stringify(handlers)}`);
    assert(!handlers.some((h: any) => (h.currencies || []).some((c: string) => c.toLowerCase() === 'morsel')),
        `a handler lists morsel as a currency: ${JSON.stringify(handlers)}`);
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
    // translate-doc carries only a pacing amount (tollMorsels; the 3.x `price: { morsels }`): the
    // session is free in money and carries the pacing (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
    assert(s.status === 'open' && s.total === 0 && s.currency !== 'morsel' && s.pacingMorsels === PRICE * 2, `session: ${JSON.stringify(s)}`);
    assert(s.sellerOwner === seller.name && s.buyerOwner === buyer.name, 'parties recorded');
});

await test('3. Buyer reads the session back; seller CANNOT (404 isolation)', async () => {
    const mine = await json(`/v1/commerce/checkout-sessions/${sessionId}`, { headers: auth(buyer.token) });
    assert(mine.status === 200 && mine.body.data.session.id === sessionId, `own read ${mine.status}`);
    const theirs = await json(`/v1/commerce/checkout-sessions/${sessionId}`, { headers: auth(seller.token) });
    assert(theirs.status === 404, `expected 404 for a foreign session, got ${theirs.status}`);
});

await test('4. PATCH items → quantity 1, pacing re-quoted', async () => {
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}`, {
        method: 'PATCH', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1 }] }),
    });
    assert(r.status === 200 && r.body.data.session.pacingMorsels === PRICE, `patch ${r.status}: ${JSON.stringify(r.body.data?.session)}`);
});

// QA audit 2026-10-14, K4 (S8-01): the session record is what completion charges from, so no memory
// route writes it, for the buyer in person either. It was a key the buyer's own session could write.
await test('4b. The checkout session record is the node\'s own: the buyer cannot write it through the memory routes', async () => {
    const key = `commerce.session.${sessionId}`;
    const post = await json('/v1/memory', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ key, value: { id: sessionId, status: 'open', items: [] }, visibility: 'owner' }),
    });
    assert(post.status >= 400 && post.body.error?.code === 'RESERVED_KEY', `POST: ${post.status} ${post.body.error?.code}`);
    const put = await json(`/v1/memory/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: auth(buyer.token), body: JSON.stringify({ value: { id: sessionId, items: [] }, version: 1 }),
    });
    assert(put.status >= 400, `PUT: ${put.status} ${put.body.error?.code}`);
    const del = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth(buyer.token) });
    assert(del.status >= 400, `DELETE: ${del.status} ${del.body.error?.code}`);
    const still = await json(`/v1/commerce/checkout-sessions/${sessionId}`, { headers: auth(buyer.token) });
    assert(still.status === 200 && still.body.data.session.pacingMorsels === PRICE && still.body.data.session.items.length === 1,
        `the session is unchanged: ${JSON.stringify(still.body.data?.session)}`);
});

await test('5. Complete → pacing charged and split, fulfillment TASK queued for the seller agent', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const opBefore = await balance(op.token);
    const r = await json(`/v1/commerce/checkout-sessions/${sessionId}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const s = r.body.data.session;
    assert(s.status === 'completed', `status ${s.status}`);
    const p = s.receipt?.pacing ?? {};
    assert(s.receipt?.handler === 'none' && s.receipt.charged === 0 && p.morsels === PRICE, `receipt: ${JSON.stringify(s.receipt)}`);
    assert(p.morsels === p.burned + p.fee + p.providerEarned, `pacing arithmetic: ${JSON.stringify(p)}`);
    assert((s.fulfillment?.taskIds || []).length === 1, `taskIds: ${JSON.stringify(s.fulfillment)}`);
    assert(await balance(buyer.token) === buyerBefore - PRICE, 'buyer debited the pacing');
    assert(await balance(seller.token) === sellerBefore + p.providerEarned, 'seller credited the rest of the pacing');
    // Operator share (operator mode is the default): when our neutral owner holds the operator
    // role (fresh DB), the share lands on them exactly. On a shared server another suite's owner may
    // be the operator — the seller/buyer legs above still pin the arithmetic.
    if (op.roles.includes('operator')) {
        assert(await balance(op.token) === opBefore + p.fee, 'operator received its share (fee mode: operator)');
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

// QA audit S8-04: completion tested `open` on the copy it had loaded and wrote `completed` only at the
// end, so two completions at the same moment each charged and each fulfilled. One claims the session.
await test('6b. Two completions of one session at the same moment: one completes, the other is 409, the pacing is charged once', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1 }] }),
    });
    assert(create.status === 201, `create ${create.status}`);
    const id = create.body.data.session.id;
    const before = await balance(buyer.token);
    const complete = () => json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    const results = await Promise.all([complete(), complete(), complete()]);
    const done = results.filter(r => r.status === 200);
    const refused = results.filter(r => r.status === 409 && r.body.error?.code === 'SESSION_NOT_OPEN');
    assert(done.length === 1 && refused.length === 2, `one completes and two are refused: ${JSON.stringify(results.map(r => [r.status, r.body.error?.code]))}`);
    assert(await balance(buyer.token) === before - PRICE, `the pacing is charged once: ${before} -> ${await balance(buyer.token)}`);
    assert((done[0]!.body.data.session.fulfillment?.taskIds ?? []).length === 1, 'one fulfilment');
});

await test('7. Not enough morsels for the pacing → 402, session stays open for retry', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1000 }] }),
    });
    assert(create.status === 201, `create ${create.status}`);
    const id = create.body.data.session.id;
    const before = await balance(buyer.token);
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 402 && r.body.error?.code === 'INSUFFICIENT_MORSELS', `expected 402, got ${r.status} ${r.body.error?.code}`);
    assert(await balance(buyer.token) === before, 'a refused use moves no morsels');
    const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(buyer.token) });
    assert(back.body.data.session.status === 'open', 'session still open after a failed charge');
});

// QA audit 2026-10-14, K4: completion compares the quote with the live price before it charges.
await test('7b. A price the seller changed after the quote is refused (409 PRICE_CHANGED), nothing is charged, the session stays open', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1 }] }),
    });
    assert(create.status === 201, `create ${create.status}`);
    const id = create.body.data.session.id;
    const raised = BASE_OFFERS.map(o => o.id === 'translate-doc' ? { ...o, tollMorsels: (o.tollMorsels ?? 0) + 1 } : o);
    const pub = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: raised }) });
    assert(pub.status === 200, `raise the price ${pub.status}`);
    try {
        const before = await balance(buyer.token);
        const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
        assert(r.status === 409 && r.body.error?.code === 'PRICE_CHANGED', `expected 409 PRICE_CHANGED, got ${r.status} ${r.body.error?.code}`);
        assert(await balance(buyer.token) === before, 'a refused completion moves no morsels');
        const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(buyer.token) });
        assert(back.body.data.session.status === 'open', 'the session stays open for a new quote');
    } finally {
        await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: BASE_OFFERS }) });
    }
});

await test('8. Unknown offer → 404; private offer cross-owner → 403; unpriced → 422', async () => {
    const ghost = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'no-such-offer' }] }) });
    assert(ghost.status === 404 && ghost.body.error?.code === 'OFFER_NOT_FOUND', `ghost: ${ghost.status} ${ghost.body.error?.code}`);
    const priv = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'secret-work' }] }) });
    assert(priv.status === 403 && priv.body.error?.code === 'OFFER_PRIVATE', `private: ${priv.status} ${priv.body.error?.code}`);
    const unpriced = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'free-listing' }] }) });
    assert(unpriced.status === 422 && unpriced.body.error?.code === 'OFFER_NOT_FOR_SALE', `unpriced: ${unpriced.status} ${unpriced.body.error?.code}`);
});

await test('9. A money session: no handler → 422 PAYMENT_HANDLER_REQUIRED, the old morsel handler → the same, an unknown one → 422', async () => {
    const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'money-doc' }] }) });
    assert(create.status === 201 && create.body.data.session.currency === 'EUR' && create.body.data.session.total === 1_000_000, `money session: ${JSON.stringify(create.body.data?.session ?? create.body.error)}`);
    const id = create.body.data.session.id;
    const before = await balance(buyer.token);
    const none = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(none.status === 422 && none.body.error?.code === 'PAYMENT_HANDLER_REQUIRED', `no handler: ${none.status} ${none.body.error?.code}`);
    const legacy = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'io.aimeat.morsels' } }) });
    assert(legacy.status === 422 && legacy.body.error?.code === 'PAYMENT_HANDLER_REQUIRED', `the morsel handler is not a payment: ${legacy.status} ${legacy.body.error?.code}`);
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.example.no-such-rail' } }) });
    assert(r.status === 422 && r.body.error?.code === 'UNKNOWN_PAYMENT_HANDLER', `expected 422, got ${r.status} ${r.body.error?.code}`);
    assert(await balance(buyer.token) === before, 'a refused completion moves no morsels');
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

await test('14. UCP adapter: an offer priced only in morsels is not sold in morsels (MONEY_PRICE_REQUIRED)', async () => {
    const create = await json('/ucp/v1/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:translate-doc` }, quantity: 1 }] }),
    });
    assert(create.status === 422 && create.body.error?.code === 'MONEY_PRICE_REQUIRED', `ucp create ${create.status}: ${JSON.stringify(create.body)}`);
    assert(create.body.ucp?.version === '2026-04-08', `ucp.version: ${JSON.stringify(create.body.ucp)}`);
    const asMorsel = await json('/ucp/v1/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:translate-doc` }, quantity: 1 }], currency: 'morsel' }),
    });
    assert(asMorsel.status === 422 && asMorsel.body.error?.code === 'MONEY_PRICE_REQUIRED', `currency morsel ${asMorsel.status}: ${JSON.stringify(asMorsel.body)}`);
    // A morsel session opened at the node's own checkout is not shown through UCP.
    const native = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }),
    });
    assert(native.status === 201, `native create ${native.status}`);
    const read = await json(`/ucp/v1/checkout-sessions/${native.body.data.session.id}`, { headers: auth(buyer.token) });
    assert(read.status === 422 && !JSON.stringify(read.body).includes('"currency":"morsel"'), `a morsel session through UCP: ${read.status} ${JSON.stringify(read.body)}`);
});

await test('15. ACP surface: discovery doc + feed lists money prices only, never MORSEL', async () => {
    const disc = await fetch(`${BASE}/.well-known/acp.json`);
    assert(disc.status === 200, `acp.json ${disc.status}`);
    const doc = await disc.json() as any;
    assert(doc.feed?.url?.endsWith('/v1/commerce/feed') && doc.checkout?.base_url?.endsWith('/acp/v1/checkout_sessions'), `acp doc: ${JSON.stringify(doc)}`);
    const feedRes = await fetch(`${BASE}/v1/commerce/feed`);
    assert(feedRes.status === 200, `feed ${feedRes.status}`);
    const feed = await feedRes.json() as any;
    // translate-doc is priced only in morsels. A morsel paces writes and is not a currency, so it is
    // not a product in a money feed (ruling D4, 2026-10-11).
    assert(!(feed.products || []).some((p: any) => p.id === `offer:${vendorGaii}:translate-doc`), 'a morsel-priced offer is not listed');
    assert(!(feed.products || []).some((p: any) => String(p.price?.currency).toLowerCase() === 'morsel'),
        `no feed price is in morsels: ${JSON.stringify((feed.products || []).map((p: any) => p.price))}`);
    assert(!(feed.products || []).some((p: any) => p.id.endsWith(':secret-work')), 'private offers stay out of the feed');
    assert(!/morsel/i.test(JSON.stringify(doc)), `the discovery document speaks of morsels: ${JSON.stringify(doc)}`);
});

await test('16. ACP checkout: an offer priced only in morsels is refused, not settled in morsels', async () => {
    const create = await json('/acp/v1/checkout_sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:translate-doc`, quantity: 1 }] }),
    });
    assert(create.status === 422 && create.body.error?.code === 'MONEY_PRICE_REQUIRED', `acp create ${create.status}: ${JSON.stringify(create.body)}`);
    assert(!JSON.stringify(create.body.accepts ?? []).includes('morsel'), 'no morsel scheme in the refusal');
});

await test('17. 402 responses carry the x402-style accepts block', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1000 }] }),
    });
    const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 402, `402 expected, got ${r.status}`);
    const accepts = (r.body.accepts ?? []) as any[];
    assert(accepts.some((a: any) => a.scheme === 'aimeat-morsel-topup' && a.daily_allowance?.url?.endsWith('/v1/wallet/request')), `the 402 says how to get more morsels: ${JSON.stringify(accepts)}`);
    assert(!accepts.some((a: any) => a.handler === 'io.aimeat.morsels' || (a.currencies ?? []).includes('morsel')), `no morsel payment scheme: ${JSON.stringify(accepts)}`);
});

await test('18. Unknown item kinds and unpriced currencies are refused', async () => {
    const r = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'no-such-kind', agent: 'a', offer_id: 'o' }] }),
    });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_CHECKOUT', `unknown kind: ${r.status} ${r.body.error?.code}`);
    // An offer priced in EUR only is not sold in USD.
    const usd = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'USD', items: [{ agent: vendorGaii, offer_id: 'money-doc' }] }),
    });
    assert(usd.status === 422 && usd.body.error?.code === 'CURRENCY_NOT_SUPPORTED', `EUR offer in USD: ${usd.status} ${usd.body.error?.code}`);
});

await test('19. Anonymous requests are rejected (401)', async () => {
    const r = await json('/v1/commerce/checkout-sessions', { method: 'POST', body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

// ─── App-tool purchases (TARGET-034 phase A): priced tool calls on agent-faced apps ───

const extName = `apptoolext${Date.now().toString(36)}`;
// Dotted appId on purpose: published filenames carry ".html", and the feed's manifest-key match
// must survive dots (regression: the phase-A [^.]+ pattern silently skipped every real app).
const appId = 'demoapp.html';
/** The binding as the seller writes it in their own tool manifest: the bare short name, which the
 *  node resolves to the seller's own extension. */
const echoCapId = `ext:${extName}:echo`;
/** The capability id the node registers for it: the extension's full name `<seller>/<short>`. */
const echoCapFull = () => `ext:${seller.name}/${extName}:echo`;
let appRef = '';

await test('20. Setup: seller installs an echo extension + declares the apps.{appId}.tools manifest', async () => {
    appRef = `${seller.name}/${appId}`;
    const manifest = `metadata:
  name: ${extName}
  version: 1.0.0
  description: "Commerce e2e echo extension"
  author: ${seller.name}

required_apis:
  - memory

actions:
  - id: echo
    method: POST
    path: /echo
    script: actions/echo.js
    description: "Echo input back"
    auth: authenticated
    input:
      message:
        type: string
        required: true
        description: "Message to echo"
    output:
      type: object
      properties:
        echoed: { type: string, description: "The echoed message" }

limits:
  memory_mb: 32
  timeout_ms: 3000
  max_api_calls: 5
`;
    const script = `export default async function(ctx, input) {
  return { echoed: 'Echo: ' + (input.message || '(empty)') };
}`;
    const install = await json('/v1/extensions', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ manifest, scripts: { 'actions/echo.js': script } }),
    });
    assert(install.status === 201 || install.status === 200, `ext install ${install.status}: ${JSON.stringify(install.body.error)}`);
    const act = await json(`/v1/extensions/${extName}/activate`, { method: 'POST', headers: auth(seller.token) });
    assert(act.status === 200, `ext activate ${act.status}: ${JSON.stringify(act.body.error)}`);
    // Capability aggregation (operator action) registers ext:{seller}/{name}:echo in the capability registry.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(op.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body.error)}`);
    const cap = await json(`/v1/capabilities/${encodeURIComponent(echoCapFull())}`);
    assert(cap.status === 200 && cap.body.data?.callable === true, `capability ${cap.status}: ${JSON.stringify(cap.body.error ?? cap.body.data)}`);

    // The tool manifest: PUBLIC memory record apps.{appId}.tools under the seller GHII.
    const tools = {
        tools: [
            { name: 'echo', description: 'Echo a message back (paid per call)', action_id: echoCapId, tollMorsels: 3 },
            { name: 'unpriced-echo', description: 'Callable but free-listed', action_id: echoCapId },
            // Task-path tools (phase B): no action_id → fulfillment queues an agent TASK.
            { name: 'concierge', description: 'Long-running white-glove run (task path)', tollMorsels: 5, agent: 'vendor' },
            { name: 'no-binding', description: 'Priced, no binding and no agent (task to the owner)', tollMorsels: 1 },
            { name: 'broken', description: 'Priced, bound to a missing capability', action_id: 'ext:no-such-ext:nope', tollMorsels: 1 },
        ],
    };
    const write = await json('/v1/memory', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ key: `apps.${appId}.tools`, value: tools, visibility: 'public' }),
    });
    assert(write.status === 200 || write.status === 201, `manifest write ${write.status}: ${JSON.stringify(write.body.error)}`);
});

await test('21. Morsel-priced app-tools stay out of the money feed; the tool catalog keeps the fulfillment hint (call vs task)', async () => {
    const feedRes = await fetch(`${BASE}/v1/commerce/feed`);
    const feed = await feedRes.json() as any;
    for (const tool of ['echo', 'concierge', 'unpriced-echo']) {
        assert(!(feed.products || []).some((p: any) => p.id === `app-tool:${appRef}:${tool}`), `${tool} is not in the money feed`);
    }
    // The node's own tool catalog still lists them, with the hint the checkout acts on.
    const catalog = await (await fetch(`${BASE}/v1/commerce/tools`)).json() as any;
    const entry = (catalog.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:echo`);
    assert(entry?.fulfillment === 'call', `callable tool fulfillment hint: ${JSON.stringify(entry)}`);
    // Phase B: unbound priced tools are purchasable on the task path and list too.
    const taskEntry = (catalog.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:concierge`);
    assert(!!taskEntry && taskEntry.fulfillment === 'task', `task tool with hint: ${JSON.stringify(taskEntry)}`);
});

await test('22. Buy an app-tool call → pacing charged, capability invoked, result on fulfillment.results', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'echo', input: { message: 'paid call' } }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const s0 = create.body.data.session;
    assert(s0.total === 0 && s0.pacingMorsels === 3 && s0.sellerOwner === seller.name, `session: total ${s0.total}, pacing ${s0.pacingMorsels}, seller ${s0.sellerOwner}`);
    const done = await json(`/v1/commerce/checkout-sessions/${s0.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    assert(s.status === 'completed' && s.receipt?.charged === 0 && s.receipt.pacing?.morsels === 3, `receipt: ${JSON.stringify(s.receipt)}`);
    const result = s.fulfillment?.results?.[0];
    assert(result?.sku === `app-tool:${appRef}:echo`, `result sku: ${JSON.stringify(s.fulfillment)}`);
    assert(result?.result?.echoed === 'Echo: paid call', `capability result: ${JSON.stringify(result?.result)}`);
    assert((s.fulfillment?.taskIds || []).length === 0, 'callable fulfillment creates no TASK');
    assert(await balance(buyer.token) === buyerBefore - 3, 'buyer debited the pacing for the call');
    assert(await balance(seller.token) === sellerBefore + s.receipt.pacing.providerEarned, 'app owner credited the rest of the pacing');
});

await test('23. App-tool failure gates: unknown tool 404, unpriced 422, quantity>1 400, bad app ref 400', async () => {
    const post = (items: unknown) => json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items }) });
    const ghost = await post([{ kind: 'app-tool', app: appRef, tool: 'no-such-tool' }]);
    assert(ghost.status === 404 && ghost.body.error?.code === 'TOOL_NOT_FOUND', `ghost: ${ghost.status} ${ghost.body.error?.code}`);
    const unpriced = await post([{ kind: 'app-tool', app: appRef, tool: 'unpriced-echo' }]);
    assert(unpriced.status === 422 && unpriced.body.error?.code === 'TOOL_NOT_FOR_SALE', `unpriced: ${unpriced.status} ${unpriced.body.error?.code}`);
    const multi = await post([{ kind: 'app-tool', app: appRef, tool: 'echo', quantity: 2 }]);
    assert(multi.status === 400 && multi.body.error?.code === 'INVALID_ITEM', `quantity: ${multi.status} ${multi.body.error?.code}`);
    const badRef = await post([{ kind: 'app-tool', app: 'no-slash-here', tool: 'echo' }]);
    assert(badRef.status === 400 && badRef.body.error?.code === 'INVALID_ITEM', `bad app ref: ${badRef.status} ${badRef.body.error?.code}`);
});

await test('24. Fulfillment failure (missing capability) refunds the charge and leaves the session open', async () => {
    const buyerBefore = await balance(buyer.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'broken' }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const id = create.body.data.session.id;
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 502 && r.body.error?.code === 'FULFILLMENT_FAILED', `expected 502 FULFILLMENT_FAILED, got ${r.status} ${r.body.error?.code}`);
    assert(await balance(buyer.token) === buyerBefore, 'buyer refunded after failed fulfillment');
    const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(buyer.token) });
    assert(back.body.data.session.status === 'open', 'session stays open for retry');
});

await test('25. Self-purchase of an own app-tool is free and still invokes', async () => {
    const sellerBefore = await balance(seller.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'echo', input: { message: 'self call' } }] }),
    });
    assert(create.status === 201 && create.body.data.session.total === 0, `self create: ${create.status} total ${create.body.data?.session?.total}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(seller.token), body: JSON.stringify({}) });
    assert(done.status === 200 && done.body.data.session.status === 'completed', `self complete ${done.status}`);
    assert(done.body.data.session.fulfillment?.results?.[0]?.result?.echoed === 'Echo: self call', 'self-call result returned');
    assert(await balance(seller.token) === sellerBefore, 'no charge on self-purchase');
});

// ─── App-tool TASK path (TARGET-034 phase B): unbound tools fulfill as an agent TASK ───

await test('26. Buy an unbound app-tool → pacing charged, TASK queued for the manifest agent, input on the task', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'concierge', input: { brief: 'weekly digest' } }], note: 'need it by friday' }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const s0 = create.body.data.session;
    assert(s0.total === 0 && s0.pacingMorsels === 5, `task-tool session: total ${s0.total}, pacing ${s0.pacingMorsels}`);
    const done = await json(`/v1/commerce/checkout-sessions/${s0.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    const p = s.receipt?.pacing ?? {};
    assert(s.status === 'completed' && s.receipt?.charged === 0 && p.morsels === 5, `receipt: ${JSON.stringify(s.receipt)}`);
    assert(p.morsels === p.burned + p.fee + p.providerEarned, 'pacing arithmetic on the task path');
    assert((s.fulfillment?.taskIds || []).length === 1, `taskIds: ${JSON.stringify(s.fulfillment)}`);
    assert(!(s.fulfillment?.results || []).length, 'task fulfillment returns no inline result');
    assert(await balance(buyer.token) === buyerBefore - 5, 'buyer debited the pacing');
    assert(await balance(seller.token) === sellerBefore + p.providerEarned, 'app owner credited the rest of the pacing');
    // The TASK landed on the manifest-declared agent (vendor) with the app-tool scope + buyer input.
    const tasks = await json('/v1/agents/vendor/tasks', { headers: auth(seller.token) });
    const task = (tasks.body.data.tasks || []).find((t: any) => t.id === s.fulfillment.taskIds[0]);
    assert(!!task && task.status === 'queued', `task queued for vendor: ${JSON.stringify(task?.status)}`);
    assert((task.scope || []).some((sc: any) => sc.name === 'app_tool' && sc.value === 'concierge'), `app_tool scope: ${JSON.stringify(task.scope)}`);
    assert((task.scope || []).some((sc: any) => sc.name === 'commerce_session' && sc.value === s.id), 'commerce_session scope');
    assert(String(task.description).includes('weekly digest'), 'buyer input rides on the task description');
});

await test('27. Unbound tool with NO manifest agent → TASK assigned to the app owner GHII', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'no-binding' }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    assert(s.status === 'completed' && (s.fulfillment?.taskIds || []).length === 1, `owner-task fulfillment: ${JSON.stringify(s.fulfillment)}`);
});

// secaudit 2026-10 (sellable-resolvers.ts:appToolSellableResolver:private-manifest-sold): an owner
// withdraws an app's tools by making apps.{appId}.tools private, and the WebMCP route then answers 404.
// The checkout read the same record without its visibility, so a stranger still bought and ran the
// tool. It reads the manifest through publicManifestTools now, at session creation and at completion.
await test('27b. A PRIVATE tool manifest is not sold: a new session is 404, a session opened while public is refused at completion, nothing is charged or run', async () => {
    const wdApp = 'withdrawn.html';
    const wdRef = `${seller.name}/${wdApp}`;
    const putManifest = (visibility: 'public' | 'private') => json('/v1/memory', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ key: `apps.${wdApp}.tools`, visibility, value: { tools: [
            { name: 'echo', description: 'Echo, paced', action_id: echoCapId, tollMorsels: 2 },
        ] } }),
    });
    const open = () => json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: wdRef, tool: 'echo', input: { message: 'withdrawn call' } }] }),
    });
    const pub = await putManifest('public');
    // 201 on the first write of the key, 200 on each rewrite below (routes/memory/crud.ts).
    assert(pub.status === 201, `public manifest write ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const early = await open();
    assert(early.status === 201, `a session on the public manifest opens: ${early.status} ${JSON.stringify(early.body.error)}`);
    const earlyId = early.body.data.session.id as string;

    const priv = await putManifest('private');
    assert(priv.status === 200 && priv.body.data?.visibility === 'private', `private manifest write ${priv.status}: ${JSON.stringify(priv.body.error ?? priv.body.data?.visibility)}`);
    const webmcp = await json(`/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(wdApp)}/webmcp`);
    assert(webmcp.status === 404, `control: the WebMCP listing treats the private manifest as absent: ${webmcp.status}`);

    const late = await open();
    assert(late.status === 404 && late.body.error?.code === 'APP_TOOLS_NOT_FOUND',
        `a new session on a private manifest: ${late.status} ${JSON.stringify(late.body.error)}`);

    const buyerBefore = await balance(buyer.token);
    const done = await json(`/v1/commerce/checkout-sessions/${earlyId}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 404 && done.body.error?.code === 'APP_TOOLS_NOT_FOUND',
        `completing a session after the manifest turned private: ${done.status} ${JSON.stringify(done.body.error)}`);
    assert(await balance(buyer.token) === buyerBefore, 'nothing is charged on the refusal');
    const back = await json(`/v1/commerce/checkout-sessions/${earlyId}`, { headers: auth(buyer.token) });
    assert(back.body.data.session.status === 'open' && !back.body.data.session.fulfillment?.results?.length,
        `the session stays open with nothing run: ${JSON.stringify({ status: back.body.data.session.status, f: back.body.data.session.fulfillment })}`);

    // Positive control: published again, the same session completes and the tool runs.
    const again = await putManifest('public');
    assert(again.status === 200 && again.body.data?.visibility === 'public', `public again ${again.status}: ${JSON.stringify(again.body.error ?? again.body.data?.visibility)}`);
    const ok = await json(`/v1/commerce/checkout-sessions/${earlyId}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(ok.status === 200 && ok.body.data.session.fulfillment?.results?.[0]?.result?.echoed === 'Echo: withdrawn call',
        `the public manifest sells again: ${ok.status} ${JSON.stringify(ok.body.error ?? ok.body.data?.session?.fulfillment)}`);
});

// ─── WebMCP bridge (TARGET-034 phase C): app tools as a WebMCP surface + 402 payment flow ───

await test('28. GET /v1/apps/:owner/:app/webmcp — public WebMCP-shaped tool listing', async () => {
    const r = await fetch(`${BASE}/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp`);
    assert(r.status === 200, `listing ${r.status}`);
    const body = await r.json() as any;
    assert(body.webmcp?.spec?.includes('webmachinelearning/webmcp'), `webmcp spec ref: ${JSON.stringify(body.webmcp)}`);
    assert(body.library?.endsWith('/v1/libs/aimeat-webmcp.js'), `library: ${body.library}`);
    const echo = (body.tools || []).find((t: any) => t.name === 'echo');
    assert(!!echo && echo.inputSchema && echo.fulfillment === 'call', `echo tool: ${JSON.stringify(echo)}`);
    // echo carries tollMorsels: 3: it is free in money with 3 morsels of pacing. On 3.x the old
    // `price` field answers as a deprecated mirror of it; 4.0.0 drops the mirror.
    assert(echo.payment?.required === false && echo.toll_morsels === 3 && echo.payment.toll_morsels === 3, `echo payment: ${JSON.stringify(echo.payment)}`);
    if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
        assert(echo.payment.price === undefined, `4.0.0 answers no deprecated price mirror: ${JSON.stringify(echo.payment)}`);
    } else {
        assert(echo.payment.price?.morsels === 3 && typeof echo.payment.price?.deprecated === 'string', `deprecated mirror: ${JSON.stringify(echo.payment.price)}`);
    }
    const free = (body.tools || []).find((t: any) => t.name === 'unpriced-echo');
    assert(free?.payment?.required === false && free.toll_morsels === 0, `unpriced tool payment: ${JSON.stringify(free?.payment)}`);
    const task = (body.tools || []).find((t: any) => t.name === 'concierge');
    assert(task?.fulfillment === 'task' && task.payment?.required === false && task.toll_morsels === 5, `task tool: ${JSON.stringify(task)}`);
    // The bridge library itself is served and carries the modelContext feature detection.
    const lib = await fetch(`${BASE}/v1/libs/aimeat-webmcp.js`);
    assert(lib.status === 200, `lib ${lib.status}`);
    const src = await lib.text();
    assert(src.includes('modelContext') && src.includes('provideContext'), 'lib feature-detects the WebMCP API');
});

// 2026-10-11: this asserted the old model, where a morsel-priced tool answered 402 and was bought
// through the checkout. A morsel amount is pacing: the tool runs for a signed-in caller, who is
// charged the pacing; only a money price answers 402 (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
await test('29. A free tool with pacing: signed out → 401; signed in → it runs and the caller pays the pacing', async () => {
    const invokeUrl = `${BASE}/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools/echo`;
    const anon = await fetch(invokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { message: 'x' } }) });
    assert(anon.status === 401, `signed-out invoke ${anon.status}`);
    const before = await balance(buyer.token);
    const r = await json(`/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools/echo`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ input: { message: 'paced call' } }),
    });
    assert(r.status === 200 && r.body.data?.result?.echoed === 'Echo: paced call', `paced invoke: ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
    assert(r.body.data.pacing?.morsels === 3, `the answer names the pacing: ${JSON.stringify(r.body.data.pacing)}`);
    assert(await balance(buyer.token) === before - 3, 'the caller paid 3 morsels of pacing');
});

await test('30. WebMCP invoke gates: free-callable needs auth then invokes; unknown tool 404; no manifest 404', async () => {
    const base = `${BASE}/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools`;
    const anon = await fetch(`${base}/unpriced-echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { message: 'hi' } }) });
    assert(anon.status === 401, `anon free invoke ${anon.status}`);
    const authed = await json(`/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools/unpriced-echo`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ input: { message: 'free call' } }),
    });
    assert(authed.status === 200 && authed.body.data?.result?.echoed === 'Echo: free call', `free invoke: ${authed.status} ${JSON.stringify(authed.body.data)}`);
    const ghost = await json(`/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools/no-such-tool`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(ghost.status === 404 && ghost.body.error?.code === 'TOOL_NOT_FOUND', `ghost tool: ${ghost.status} ${ghost.body.error?.code}`);
    // 404 means "no such public app". A published app that sells nothing answers 200 with an empty
    // tool list — the two are different facts and only one of them is a missing resource.
    const noApp = await fetch(`${BASE}/v1/apps/${encodeURIComponent(buyer.name)}/nothing.html/webmcp`);
    assert(noApp.status === 404, `unknown app ${noApp.status}`);
});

// ─── MCP Server Card commerce_tools + the dedicated catalog (TARGET-034 phase D) ───

await test('31. GET /v1/commerce/tools — normalized priced app-tool catalog', async () => {
    const r = await fetch(`${BASE}/v1/commerce/tools`);
    assert(r.status === 200, `catalog ${r.status}`);
    const body = await r.json() as any;
    const echo = (body.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:echo`);
    assert(!!echo, `echo in catalog (${body.total} tools)`);
    assert(echo.fulfillment === 'call' && echo.toll_morsels === 3, `echo entry: ${JSON.stringify(echo)}`);
    assert(echo.checkout_item?.kind === 'app-tool' && echo.checkout_item.tool === 'echo', 'ready-made checkout item');
    assert(echo.webmcp?.invoke?.includes('/webmcp/tools/echo'), `webmcp invoke url: ${echo.webmcp?.invoke}`);
    const task = (body.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:concierge`);
    assert(task?.fulfillment === 'task' && task.toll_morsels === 5, `task entry: ${JSON.stringify(task)}`);
    // On 3.x an entry also answers the old `price` as a deprecated mirror of toll_morsels; 4.0.0 drops it.
    if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
        assert(echo.price === undefined && task.price === undefined, `4.0.0 answers no deprecated price mirror: ${JSON.stringify({ echo: echo.price, task: task.price })}`);
    } else {
        assert(echo.price?.morsels === 3 && typeof echo.price?.deprecated === 'string' && task.price?.morsels === 5,
            `deprecated price mirror on 3.x: ${JSON.stringify({ echo: echo.price, task: task.price })}`);
    }
    assert(!(body.tools || []).some((t: any) => t.name === 'unpriced-echo'), 'unpriced tools stay out');
    assert(body.checkout?.create?.url?.endsWith('/v1/commerce/checkout-sessions'), 'checkout pointer present');
});

await test('32. MCP Server Card embeds the catalog inline (default mode) + keeps the pointer url', async () => {
    const r = await fetch(`${BASE}/.well-known/mcp.json`);
    assert(r.status === 200, `card ${r.status}`);
    const card = await r.json() as any;
    const ct = card.commerce_tools;
    assert(ct?.mode === 'inline', `commerce_tools mode: ${JSON.stringify(ct?.mode)} (AIMEAT_MCP_CARD_COMMERCE_TOOLS default is inline)`);
    assert(ct.url?.endsWith('/v1/commerce/tools'), `pointer url kept in inline mode: ${ct.url}`);
    const echo = (ct.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:echo`);
    assert(!!echo && echo.inputSchema && echo.toll_morsels === 3, `echo inline on the card: ${JSON.stringify(echo)}`);
    // The card's entry is the catalog's entry: the 3.x mirror on 3.x, none on 4.0.0.
    if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
        assert(echo.price === undefined, `4.0.0 answers no deprecated price mirror on the card: ${JSON.stringify(echo.price)}`);
    } else {
        assert(echo.price?.morsels === 3 && typeof echo.price?.deprecated === 'string', `deprecated price mirror on the card: ${JSON.stringify(echo.price)}`);
    }
    assert(ct.total === ct.tools.length, 'total matches inline entries');
    // The feed and the card come from the SAME enumerator — sku sets must agree. The feed is the
    // money surface, so it carries the card's money-priced tools (ruling D4, 2026-10-11).
    const feed = await (await fetch(`${BASE}/v1/commerce/feed`)).json() as any;
    const feedSkus = (feed.products || []).filter((p: any) => p.id.startsWith('app-tool:')).map((p: any) => p.id).sort();
    const cardSkus = (ct.tools || []).filter((t: any) => t.priceMoney).map((t: any) => t.sku).sort();
    assert(JSON.stringify(feedSkus) === JSON.stringify(cardSkus), `feed/card sku drift: ${JSON.stringify({ feedSkus, cardSkus })}`);
});

// ─── Seller payment rails: the credentials a seller brings themselves ───
// Every money rail settles to the SELLER — the node has no platform account and holds no key —
// so "can I take money" is answered entirely by what the seller has set on themselves.

await test('34. Payout status reports all three money rails; the Stripe secret is never returned', async () => {
    const before = await json('/v1/commerce/payout', { headers: auth(seller.token) });
    assert(before.status === 200, `payout status ${before.status}: ${JSON.stringify(before.body?.error)}`);
    assert(before.body.data.stripe?.configured === false, `no credentials yet: ${JSON.stringify(before.body.data.stripe)}`);
    // Invoice needs no credential at all, so it is reported as available from the start.
    assert(before.body.data.invoice?.available === true, `invoice rail advertised: ${JSON.stringify(before.body.data.invoice)}`);

    const set = await json('/v1/commerce/payout/stripe', {
        method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ secret_key: 'sk_test_e2e_seller_key_1234' }),
    });
    assert(set.status === 200 && set.body.data.configured === true, `set ${set.status}: ${JSON.stringify(set.body?.error)}`);
    assert(set.body.data.keyHint === '…1234', `only the last four are echoed: ${JSON.stringify(set.body.data)}`);

    const after = await json('/v1/commerce/payout', { headers: auth(seller.token) });
    assert(after.body.data.stripe?.configured === true, `configured after set: ${JSON.stringify(after.body.data.stripe)}`);
    assert(!JSON.stringify(after.body).includes('sk_test_e2e_seller_key_1234'), 'the secret must never appear in a response body');

    const gone = await json('/v1/commerce/payout/stripe', { method: 'DELETE', headers: auth(seller.token) });
    assert(gone.status === 200 && gone.body.data.configured === false, `delete ${gone.status}`);
    const cleared = await json('/v1/commerce/payout', { headers: auth(seller.token) });
    assert(cleared.body.data.stripe?.configured === false, 'credentials are gone after delete');
});

await test('34b. THE LEAK: the Stripe secrets are not readable through the generic memory doors', async () => {
    // The commerce doors masked the key, and the same record was readable whole through
    // GET /v1/memory/commerce.psp (the door an app grant and an agent with owner_scope use) and the
    // operator's GET /v1/admin/memory/:owner/:key. Stored encrypted now, so every such door carries
    // ciphertext and a hint only.
    const KEY = 'sk_test_e2e_generic_door_9d41';
    const HOOK = 'whsec_e2e_generic_door_77c2';
    const set = await json('/v1/commerce/payout/stripe', {
        method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ secret_key: KEY, webhook_secret: HOOK }),
    });
    assert(set.status === 200, `set ${set.status}: ${JSON.stringify(set.body?.error)}`);
    const raw = await json('/v1/memory/commerce.psp', { headers: auth(seller.token) });
    assert(raw.status === 200, `memory read ${raw.status}`);
    const rawText = JSON.stringify(raw.body);
    assert(!rawText.includes(KEY) && !rawText.includes(HOOK), `GET /v1/memory/commerce.psp returns a Stripe secret: ${rawText.slice(0, 300)}`);
    const v = (raw.body.data?.value ?? raw.body.data?.record?.value) as any;
    assert(v.secretKey?.hint === '…9d41', `the stored key carries its hint: ${JSON.stringify(v.secretKey)}`);
    if (op.roles.includes('operator')) {
        const adm = await json(`/v1/admin/memory/${encodeURIComponent(`${seller.name}@${NODE_ID}`)}/commerce.psp`, { headers: auth(op.token) });
        assert(adm.status === 200, `admin memory read ${adm.status}: ${JSON.stringify(adm.body?.error)}`);
        const admText = JSON.stringify(adm.body);
        assert(!admText.includes(KEY) && !admText.includes(HOOK), 'the operator\'s memory door returns a seller\'s Stripe secret');
    }
    const status = await json('/v1/commerce/payout', { headers: auth(seller.token) });
    assert(status.body.data.stripe?.configured === true && status.body.data.stripe?.keyHint === '…9d41',
        `payout status still reads the sealed key: ${JSON.stringify(status.body.data.stripe)}`);
    await json('/v1/commerce/payout/stripe', { method: 'DELETE', headers: auth(seller.token) });
});

await test('35. A too-short Stripe secret is refused, and one rail never clears the other', async () => {
    const bad = await json('/v1/commerce/payout/stripe', {
        method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ secret_key: 'sk_1' }),
    });
    assert(bad.status === 400 && bad.body?.error?.code === 'INVALID_PSP', `expected INVALID_PSP, got ${bad.status}/${JSON.stringify(bad.body?.error)}`);

    // The two rails share ONE opaque record, so the real risk is a write wiping the neighbour.
    const addr = '0x' + 'c3d4e5f6'.repeat(5);
    const x = await json('/v1/commerce/payout/x402', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ address: addr }) });
    assert(x.status === 200, `seed x402 address ${x.status}: ${JSON.stringify(x.body?.error)}`);
    const set = await json('/v1/commerce/payout/stripe', {
        method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ secret_key: 'sk_test_kept_alongside' }),
    });
    assert(set.status === 200, `set stripe ${set.status}`);
    const rec = await json('/v1/memory/commerce.psp', { headers: auth(seller.token) });
    const v = (rec.body.data?.value ?? rec.body.data?.record?.value) as any;
    assert(String(v.payTo ?? '').toLowerCase() === addr.toLowerCase(), `the x402 address survived: ${JSON.stringify(v)}`);
    assert(v.secretKey?.hint === '…side' && !JSON.stringify(v).includes('sk_test_kept_alongside'),
        `the stripe key landed, encrypted: ${JSON.stringify(v)}`);

    // ...and clearing Stripe leaves the address alone.
    await json('/v1/commerce/payout/stripe', { method: 'DELETE', headers: auth(seller.token) });
    const after = await json('/v1/memory/commerce.psp', { headers: auth(seller.token) });
    const v2 = (after.body.data?.value ?? after.body.data?.record?.value) as any;
    assert(!v2.secretKey && String(v2.payTo ?? '').toLowerCase() === addr.toLowerCase(),
        `stripe cleared, address kept: ${JSON.stringify(v2)}`);
});

await test('36. A card sale by a seller with no credentials fails with PSP_NOT_CONFIGURED, not a charge', async () => {
    // The seller cleared their key in the test above. The Stripe handler is registered on EVERY
    // node now, so the refusal has to come from the seller's own missing credential — and it has to
    // name the fix. A money-priced offer is published here so the session really reaches settlement.
    const priced = await json('/v1/agents/vendor/offers', {
        method: 'PUT', headers: auth(seller.token),
        // Re-publish the existing offers alongside the new one: this endpoint replaces the list.
        body: JSON.stringify({ offers: BASE_OFFERS.concat([{
            id: 'eur-service', title: 'Service priced in euros', ask: 'A euro-priced service.',
            deliverable: { format: 'document', sample: 'untested' },
            priceMoney: { amount: 2_000_000, currency: 'EUR' }, visibility: 'public',
        }] as never) }),
    });
    assert(priced.status === 200, `publish EUR offer ${priced.status}: ${JSON.stringify(priced.body?.error)}`);

    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'eur-service', quantity: 1 }], currency: 'EUR' }),
    });
    assert(create.status === 201, `EUR session ${create.status}: ${JSON.stringify(create.body?.error)}`);

    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ payment: { handler: 'com.stripe.spt', instrument: 'pm_card_visa' } }),
    });
    assert(done.status === 403 && done.body?.error?.code === 'PSP_NOT_CONFIGURED',
        `expected PSP_NOT_CONFIGURED, got ${done.status}/${JSON.stringify(done.body?.error)}`);
    assert(/Wallet tab|aimeat_commerce_psp_set/.test(String(done.body.error.message)),
        `the message names where to fix it: ${done.body.error.message}`);
});

await test('37. The same EUR sale settles offline through the invoice rail, booking a payable', async () => {
    // The rail that needs no credential at all: nothing is captured, the order completes, and what
    // the buyer owes is booked for the seller to bill. This is what a seller without Stripe uses.
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'eur-service', quantity: 1 }], currency: 'EUR' }),
    });
    assert(create.status === 201, `EUR session ${create.status}: ${JSON.stringify(create.body?.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'io.aimeat.invoice' } }),
    });
    assert(done.status === 200, `invoice complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    const tracking = String(done.body.data.session?.receipt?.trackingCode ?? '');
    assert(tracking.startsWith('inv_'), `invoice tracking code: ${tracking}`);

    const book = await json(`/v1/memory/commerce.payable.${encodeURIComponent(tracking)}`, { headers: auth(seller.token) });
    const v = (book.body.data?.value ?? book.body.data?.record?.value) as any;
    const entry = (v?.items ?? [])[0];
    assert(entry && entry.method === 'invoice' && entry.status === 'pending',
        `a pending payable is booked for the seller: ${JSON.stringify(v)}`);
    assert(entry.currency === 'EUR' && entry.amount > 0, `the payable carries the money amount: ${JSON.stringify(entry)}`);
});

await test('37b. UCP and ACP sell the EUR offer in money: the feed lists it, the session is EUR, completion names its handler', async () => {
    const feed = await (await fetch(`${BASE}/v1/commerce/feed`)).json() as any;
    const listed = (feed.products || []).find((p: any) => p.id === `offer:${vendorGaii}:eur-service`);
    assert(listed?.price?.currency === 'EUR' && listed.price.amount === 2_000_000, `EUR offer in the feed: ${JSON.stringify(listed)}`);

    const ucp = await json('/ucp/v1/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:eur-service` }, quantity: 1 }] }),
    });
    assert(ucp.status === 201, `ucp create ${ucp.status}: ${JSON.stringify(ucp.body)}`);
    const cs = ucp.body.checkout_session;
    assert(cs.currency === 'EUR' && cs.totals?.grand_total === 2_000_000, `the session is in EUR: ${JSON.stringify(cs)}`);
    assert(!(cs.payment?.handlers || []).some((h: any) => h.id === 'io.aimeat.morsels'), `handlers: ${JSON.stringify(cs.payment?.handlers)}`);
    const unnamed = await json(`/ucp/v1/checkout-sessions/${cs.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(unnamed.status === 422 && unnamed.body.error?.code === 'PAYMENT_HANDLER_REQUIRED' && /io\.aimeat\.invoice/.test(unnamed.body.error.message),
        `complete with no handler: ${unnamed.status} ${JSON.stringify(unnamed.body.error)}`);
    const done = await json(`/ucp/v1/checkout-sessions/${cs.id}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'io.aimeat.invoice' } }),
    });
    assert(done.status === 200 && done.body.checkout_session?.status === 'completed', `ucp invoice complete ${done.status}: ${JSON.stringify(done.body)}`);

    const acp = await json('/acp/v1/checkout_sessions', {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:eur-service` }] }),
    });
    assert(acp.status === 201 && acp.body.currency === 'EUR', `acp create ${acp.status}: ${JSON.stringify(acp.body)}`);
    const acpDone = await json(`/acp/v1/checkout_sessions/${acp.body.id}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment_data: { handler: 'io.aimeat.invoice' } }),
    });
    assert(acpDone.status === 200 && acpDone.body.status === 'completed', `acp invoice complete ${acpDone.status}: ${JSON.stringify(acpDone.body)}`);
});

// QA audit S8-03: the buyer named the invoice rail for anything, and a line delivered during
// completion (here a callable app-tool) ran for a book entry the seller never agreed to.
await test('37c. The invoice rail is refused for a tool call until the seller takes invoices for it; nothing runs on the refusal', async () => {
    const key = `apps.${appId}.tools`;
    const current = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(seller.token) });
    const doc = (current.body.data?.value ?? current.body.data?.record?.value) as { tools: any[] };
    assert(Array.isArray(doc?.tools), `the manifest reads back: ${JSON.stringify(current.body)}`);
    const withPaid = { ...doc, tools: [...doc.tools.filter((t: any) => t.name !== 'paid-echo'),
        { name: 'paid-echo', description: 'Echo, sold in euros per call', action_id: echoCapId, priceMoney: { amount: 1_000_000, currency: 'EUR' } }] };
    const write = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ key, value: withPaid, visibility: 'public' }) });
    assert(write.status === 200 || write.status === 201, `manifest write ${write.status}: ${JSON.stringify(write.body.error)}`);

    const open = async () => {
        const r = await json('/v1/commerce/checkout-sessions', {
            method: 'POST', headers: auth(buyer.token),
            body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'paid-echo', input: { message: 'on credit' } }], currency: 'EUR' }),
        });
        assert(r.status === 201 && r.body.data.session.total === 1_000_000, `EUR tool session ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data?.session)}`);
        return r.body.data.session.id as string;
    };
    const completeOnInvoice = (id: string) => json(`/v1/commerce/checkout-sessions/${id}/complete`, {
        method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'io.aimeat.invoice' } }),
    });

    const id = await open();
    const refused = await completeOnInvoice(id);
    assert(refused.status === 422 && refused.body.error?.code === 'INVOICE_NOT_ACCEPTED', `expected 422 INVOICE_NOT_ACCEPTED, got ${refused.status} ${JSON.stringify(refused.body.error)}`);
    const after = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: auth(buyer.token) });
    assert(after.body.data.session.status === 'open' && !after.body.data.session.fulfillment, `nothing ran and the session stays open: ${JSON.stringify(after.body.data.session)}`);

    const payout = await json('/v1/commerce/payout', { headers: auth(seller.token) });
    assert(payout.body.data.invoice?.accept_immediate === false, `off by default: ${JSON.stringify(payout.body.data.invoice)}`);
    const bad = await json('/v1/commerce/payout/invoice', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ accept_immediate: 'yes' }) });
    assert(bad.status === 400, `a non-boolean is refused: ${bad.status}`);
    const anon = await json('/v1/commerce/payout/invoice', { method: 'PUT', body: JSON.stringify({ accept_immediate: true }) });
    assert(anon.status === 401, `no credential, no change to anyone's invoice setting: ${anon.status}`);
    const on = await json('/v1/commerce/payout/invoice', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ accept_immediate: true }) });
    assert(on.status === 200 && on.body.data.accept_immediate === true, `turn on: ${on.status} ${JSON.stringify(on.body)}`);
    assert((await json('/v1/commerce/payout', { headers: auth(seller.token) })).body.data.invoice?.accept_immediate === true, 'reported on');

    const done = await completeOnInvoice(id);
    assert(done.status === 200 && done.body.data.session.status === 'completed', `with the seller's consent: ${done.status} ${JSON.stringify(done.body.error)}`);
    assert(String(done.body.data.session.receipt?.trackingCode ?? '').startsWith('inv_'), `booked on the invoice rail: ${JSON.stringify(done.body.data.session.receipt)}`);
    assert((done.body.data.session.fulfillment?.results ?? []).length === 1, `the tool ran once: ${JSON.stringify(done.body.data.session.fulfillment)}`);

    const off = await json('/v1/commerce/payout/invoice', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ accept_immediate: false }) });
    assert(off.status === 200 && off.body.data.accept_immediate === false, `turn off again: ${off.status}`);
});

// ─── Web Bot Auth: outbound safeFetch traffic is signed (RFC 9421) and verifiable ───

await test('33. Outbound UCP profile fetch carries a verifiable Web Bot Auth signature', async () => {
    // Local capture server plays the UCP platform profile the node fetches via safeFetch
    // (AIMEAT_WEB_BOT_AUTH_SIGN=true in the test env; AIMEAT_DEV_MODE permits loopback egress).
    const { createServer } = await import('node:http');
    let captured: Record<string, string | string[] | undefined> = {};
    const srv = createServer((req, res) => {
        captured = { ...req.headers };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ucp: { capabilities: [{ name: 'dev.ucp.shopping.checkout' }] } }));
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
        const create = await json('/ucp/v1/checkout-sessions', {
            method: 'POST', headers: { ...auth(buyer.token), 'UCP-Agent': `http://127.0.0.1:${port}/profile` },
            body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:eur-service` }, quantity: 1 }] }),
        });
        assert(create.status === 201, `ucp create ${create.status}: ${JSON.stringify(create.body)}`);
        assert(typeof captured['signature'] === 'string' && typeof captured['signature-input'] === 'string' && typeof captured['signature-agent'] === 'string',
            `outbound request signed: ${JSON.stringify(Object.keys(captured))}`);
        const sigInput = String(captured['signature-input']);
        assert(sigInput.includes('tag="web-bot-auth"') && sigInput.includes('alg="ed25519"') && sigInput.includes('nonce="'), `signature-input: ${sigInput}`);
        // Verify against the served key directory: reconstruct the RFC 9421 base and check Ed25519.
        const dir = await (await fetch(`${BASE}/.well-known/http-message-signatures-directory`)).json() as any;
        const jwk = dir.keys[0];
        assert(sigInput.includes(`keyid="${jwk.kid}"`), `keyid matches directory kid: ${sigInput}`);
        const params = sigInput.replace(/^sig1=/, '');
        const base = `"@authority": 127.0.0.1:${port}\n"signature-agent": ${String(captured['signature-agent'])}\n"@signature-params": ${params}`;
        const sigB64 = /:(.*):/.exec(String(captured['signature']))?.[1] ?? '';
        const ok = await ed.verifyAsync(
            new Uint8Array(Buffer.from(sigB64, 'base64')),
            new TextEncoder().encode(base),
            new Uint8Array(Buffer.from(jwk.x, 'base64url')),
        );
        assert(ok, 'RFC 9421 signature verifies against the directory JWK');
    } finally {
        srv.close();
    }
});

// ── The spend permission at the one place money leaves the buyer (2026-08 audit H-3) ──
// `appSpendRefusal` enforces the `contract:spend` scope and the per-app ceiling, and its docblock
// says it must run "at EVERY place that actually charges". All four completion doors went straight
// to handler.collect(), which debits the buyer GHII — and an app-grant token's `sub` IS that GHII.
// So an app the owner approved for reading notes could spend their balance. The gate lives in
// completeSession now, which is the single door money actually passes through.
{
    const APP_FILE = `spendtest-${Date.now()}.html`;
    const REDIRECT = 'http://localhost:9912/callback';
    const verifier = Buffer.from(`${Date.now()}-spend-verifier-padding`).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    /** Publish an app owned by the BUYER, then run authorize→consent→token for the given scope. */
    async function buyerAppToken(scope: string): Promise<string> {
        const pub = await json('/v1/apps', {
            method: 'POST', headers: auth(buyer.token),
            body: JSON.stringify({
                filename: APP_FILE, name: 'Spend Test', description: 'H-3 regression',
                category: 'tool', content: Buffer.from('<html><body>spend</body></html>').toString('base64'),
            }),
        });
        assert(pub.status === 200 || pub.status === 201 || pub.status === 409, `publish app ${pub.status}: ${JSON.stringify(pub.body.error)}`);
        const q = new URLSearchParams({
            app: `${buyer.name}/${APP_FILE}`, response_type: 'code', scope,
            redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const loc = res.headers.get('location') ?? '';
        const rid = decodeURIComponent(/req=([^&]+)/.exec(loc)?.[1] ?? '');
        assert(!!rid, `no request id in ${loc}`);
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ request_id: rid }),
        });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
        });
        assert(!!tok.body.data?.access_token, `token: ${JSON.stringify(tok.body)}`);
        return tok.body.data.access_token;
    }

    async function openSession(token: string): Promise<string> {
        const r = await json('/v1/commerce/checkout-sessions', {
            method: 'POST', headers: auth(token),
            body: JSON.stringify({ items: [{ kind: 'offer', agent: vendorGaii, offer_id: BASE_OFFERS[0].id, quantity: 1 }] }),
        });
        assert(r.status === 201, `open session ${r.status}: ${JSON.stringify(r.body.error)}`);
        return r.body.data.session.id;
    }

    // On 3.x the REST scope gate of the complete route lets the app through (counted, not refused),
    // so the H-3 check in the session service answers 403 SCOPE_REQUIRED. From 4.0.0 that gate
    // (REST_SCOPE_GATES_ENFORCED_IN) refuses first with 403 SCOPE_DENIED: an app grant can hold
    // contract:spend but not commerce:buy, so an app without contract:spend never reaches the H-3
    // check on this route. Either way the buyer is not charged.
    await test('20. An app WITHOUT contract:spend cannot complete a checkout (H-3): 3.x answers SCOPE_REQUIRED from the session service, 4.0.0 SCOPE_DENIED from the REST scope gate', async () => {
        const narrow = await buyerAppToken('memory:read');
        const sid = await openSession(buyer.token);
        const before = await balance(buyer.token);
        const r = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, {
            method: 'POST', headers: auth(narrow), body: JSON.stringify({}),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        const expected = await removedOn(BASE, REST_SCOPE_GATES_ENFORCED_IN) ? 'SCOPE_DENIED' : 'SCOPE_REQUIRED';
        assert(r.body.error?.code === expected, `code: expected ${expected}, got ${JSON.stringify(r.body.error)}`);
        assert(await balance(buyer.token) === before, 'the buyer must not be charged by a refused app');
    });

    await test('21. An app WITH contract:spend completes normally (the gate is a scope, not a ban)', async () => {
        const spender = await buyerAppToken('memory:read contract:spend');
        const sid = await openSession(buyer.token);
        const before = await balance(buyer.token);
        const r = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, {
            method: 'POST', headers: auth(spender), body: JSON.stringify({}),
        });
        assert(r.status === 200, `expected 200 with contract:spend, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        assert(await balance(buyer.token) < before, 'the granted app did charge the buyer');
    });

    await test('22. The owner\'s own session still completes (the gate only sees app tokens)', async () => {
        const sid = await openSession(buyer.token);
        const r = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, {
            method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}),
        });
        assert(r.status === 200, `owner complete must still work, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    });
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Commerce E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
