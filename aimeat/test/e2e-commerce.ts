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

/** The seller's published offers. Hoisted because PUT /v1/agents/:name/offers REPLACES the whole
 *  list: a later test that adds one must re-publish these too, or it silently deletes them. */
const BASE_OFFERS = [
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

await test('1. GET /.well-known/ucp — profile advertises checkout + the morsel handler', async () => {
    const res = await fetch(`${BASE}/.well-known/ucp`);
    assert(res.status === 200, `status ${res.status}`);
    const profile = await res.json() as any;
    assert(typeof profile.ucp?.version === 'string', 'missing ucp.version');
    assert(profile.ucp.services?.rest?.endpoint?.endsWith('/ucp/v1'), `rest endpoint: ${profile.ucp.services?.rest?.endpoint}`);
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
    const r = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment: { handler: 'com.example.no-such-rail' } }) });
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

await test('14. UCP adapter: create + complete via /ucp/v1 with the ucp envelope', async () => {
    const create = await json('/ucp/v1/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:translate-doc` }, quantity: 1 }] }),
    });
    assert(create.status === 201, `ucp create ${create.status}: ${JSON.stringify(create.body)}`);
    assert(create.body.ucp?.version === '2026-04-08', `ucp.version: ${JSON.stringify(create.body.ucp)}`);
    assert((create.body.ucp.capabilities || []).some((c: any) => c.name === 'dev.ucp.shopping.checkout'), 'ucp.capabilities echoed');
    const cs = create.body.checkout_session;
    assert(cs.status === 'open' && cs.totals?.grand_total === PRICE, `ucp session: ${JSON.stringify(cs)}`);
    assert(cs.line_items?.[0]?.item?.id === `offer:${vendorGaii}:translate-doc`, 'ucp item id round-trips');
    const done = await json(`/ucp/v1/checkout-sessions/${cs.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `ucp complete ${done.status}: ${JSON.stringify(done.body)}`);
    assert(done.body.checkout_session?.status === 'completed', `ucp completed: ${done.body.checkout_session?.status}`);
    assert(done.body.checkout_session?.payment?.receipt?.charged === PRICE, 'ucp receipt present');
});

await test('15. ACP surface: discovery doc + feed lists the public priced offer', async () => {
    const disc = await fetch(`${BASE}/.well-known/acp.json`);
    assert(disc.status === 200, `acp.json ${disc.status}`);
    const doc = await disc.json() as any;
    assert(doc.feed?.url?.endsWith('/v1/commerce/feed') && doc.checkout?.base_url?.endsWith('/acp/v1/checkout_sessions'), `acp doc: ${JSON.stringify(doc)}`);
    const feedRes = await fetch(`${BASE}/v1/commerce/feed`);
    assert(feedRes.status === 200, `feed ${feedRes.status}`);
    const feed = await feedRes.json() as any;
    const entry = (feed.products || []).find((p: any) => p.id === `offer:${vendorGaii}:translate-doc`);
    assert(!!entry, `public priced offer in feed (${feed.total} products)`);
    assert(entry.price?.amount === PRICE && entry.price?.currency === 'MORSEL', `feed price: ${JSON.stringify(entry.price)}`);
    assert(!(feed.products || []).some((p: any) => p.id.endsWith(':secret-work')), 'private offers stay out of the feed');
});

await test('16. ACP checkout: create by sku + complete (morsel settlement)', async () => {
    const create = await json('/acp/v1/checkout_sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:translate-doc`, quantity: 1 }] }),
    });
    assert(create.status === 201, `acp create ${create.status}: ${JSON.stringify(create.body)}`);
    assert(create.body.status === 'ready_for_payment', `acp status: ${create.body.status}`);
    const done = await json(`/acp/v1/checkout_sessions/${create.body.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200 && done.body.status === 'completed', `acp complete: ${done.status} ${done.body.status}`);
    // The stripe provider maps to a REGISTERED handler (card settlement is core), so the refusal
    // here is about the money: this session is priced in morsels and a card cannot settle it.
    const create2 = await json('/acp/v1/checkout_sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:translate-doc` }] }) });
    const stripe = await json(`/acp/v1/checkout_sessions/${create2.body.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment_data: { provider: 'stripe' } }) });
    assert(stripe.status === 422 && stripe.body.error?.code === 'CURRENCY_MISMATCH', `stripe against a morsel session: ${stripe.status} ${stripe.body.error?.code}`);
});

await test('17. 402 responses carry the x402-style accepts block', async () => {
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ agent: vendorGaii, offer_id: 'translate-doc', quantity: 1000 }] }),
    });
    const r = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(r.status === 402, `402 expected, got ${r.status}`);
    assert(Array.isArray(r.body.accepts) && r.body.accepts.some((a: any) => a.scheme === 'aimeat-checkout' && a.handler === 'io.aimeat.morsels'), `accepts: ${JSON.stringify(r.body.accepts)}`);
});

await test('18. Unknown item kinds and unpriced currencies are refused', async () => {
    const r = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'no-such-kind', agent: 'a', offer_id: 'o' }] }),
    });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_CHECKOUT', `unknown kind: ${r.status} ${r.body.error?.code}`);
    const eur = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ currency: 'EUR', items: [{ agent: vendorGaii, offer_id: 'translate-doc' }] }),
    });
    assert(eur.status === 422 && eur.body.error?.code === 'CURRENCY_NOT_SUPPORTED', `EUR offer on Community: ${eur.status} ${eur.body.error?.code}`);
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
const echoCapId = `ext:${extName}:echo`;
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
    // Capability aggregation (operator action) registers ext:{name}:echo in the capability registry.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(op.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body.error)}`);
    const cap = await json(`/v1/capabilities/${encodeURIComponent(echoCapId)}`);
    assert(cap.status === 200 && cap.body.data?.callable === true, `capability ${cap.status}: ${JSON.stringify(cap.body.error ?? cap.body.data)}`);

    // The tool manifest: PUBLIC memory record apps.{appId}.tools under the seller GHII.
    const tools = {
        tools: [
            { name: 'echo', description: 'Echo a message back (paid per call)', action_id: echoCapId, price: { morsels: 3, unit: 'per-call' } },
            { name: 'unpriced-echo', description: 'Callable but free-listed', action_id: echoCapId },
            // Task-path tools (phase B): no action_id → fulfillment queues an agent TASK.
            { name: 'concierge', description: 'Long-running white-glove run (task path)', price: { morsels: 5 }, agent: 'vendor' },
            { name: 'no-binding', description: 'Priced, no binding and no agent (task to the owner)', price: { morsels: 1 } },
            { name: 'broken', description: 'Priced, bound to a missing capability', action_id: 'ext:no-such-ext:nope', price: { morsels: 1 } },
        ],
    };
    const write = await json('/v1/memory', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ key: `apps.${appId}.tools`, value: tools, visibility: 'public' }),
    });
    assert(write.status === 200 || write.status === 201, `manifest write ${write.status}: ${JSON.stringify(write.body.error)}`);
});

await test('21. Feed lists priced app-tools with the fulfillment hint (call vs task)', async () => {
    const feedRes = await fetch(`${BASE}/v1/commerce/feed`);
    const feed = await feedRes.json() as any;
    const sku = `app-tool:${appRef}:echo`;
    const entry = (feed.products || []).find((p: any) => p.id === sku);
    assert(!!entry, `app-tool in feed: ${sku} (${feed.total} products)`);
    assert(entry.price?.amount === 3 && entry.price?.currency === 'MORSEL', `feed price: ${JSON.stringify(entry.price)}`);
    assert(entry.fulfillment === 'call', `callable tool fulfillment hint: ${entry.fulfillment}`);
    // Phase B: unbound priced tools are purchasable on the task path and list too.
    const taskEntry = (feed.products || []).find((p: any) => p.id === `app-tool:${appRef}:concierge`);
    assert(!!taskEntry && taskEntry.fulfillment === 'task', `task tool in feed with hint: ${JSON.stringify(taskEntry)}`);
    assert(!(feed.products || []).some((p: any) => p.id === `app-tool:${appRef}:unpriced-echo`), 'unpriced tools stay out of the feed');
});

await test('22. Buy an app-tool call → charged, capability invoked, result on fulfillment.results', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'echo', input: { message: 'paid call' } }] }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const s0 = create.body.data.session;
    assert(s0.total === 3 && s0.sellerOwner === seller.name, `session: total ${s0.total}, seller ${s0.sellerOwner}`);
    const done = await json(`/v1/commerce/checkout-sessions/${s0.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    assert(s.status === 'completed' && s.receipt?.charged === 3, `receipt: ${JSON.stringify(s.receipt)}`);
    const result = s.fulfillment?.results?.[0];
    assert(result?.sku === `app-tool:${appRef}:echo`, `result sku: ${JSON.stringify(s.fulfillment)}`);
    assert(result?.result?.echoed === 'Echo: paid call', `capability result: ${JSON.stringify(result?.result)}`);
    assert((s.fulfillment?.taskIds || []).length === 0, 'callable fulfillment creates no TASK');
    assert(await balance(buyer.token) === buyerBefore - 3, 'buyer debited for the call');
    assert(await balance(seller.token) === sellerBefore + s.receipt.earned, 'app owner credited (minus fee)');
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

await test('26. Buy an unbound app-tool → charged, TASK queued for the manifest agent, input on the task', async () => {
    const buyerBefore = await balance(buyer.token);
    const sellerBefore = await balance(seller.token);
    const create = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: appRef, tool: 'concierge', input: { brief: 'weekly digest' } }], note: 'need it by friday' }),
    });
    assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
    const s0 = create.body.data.session;
    assert(s0.total === 5, `task-tool session total: ${s0.total}`);
    const done = await json(`/v1/commerce/checkout-sessions/${s0.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    assert(s.status === 'completed' && s.receipt?.charged === 5, `receipt: ${JSON.stringify(s.receipt)}`);
    assert(s.receipt.charged === s.receipt.earned + s.receipt.fee, 'fee arithmetic on the task path');
    assert((s.fulfillment?.taskIds || []).length === 1, `taskIds: ${JSON.stringify(s.fulfillment)}`);
    assert(!(s.fulfillment?.results || []).length, 'task fulfillment returns no inline result');
    assert(await balance(buyer.token) === buyerBefore - 5, 'buyer debited');
    assert(await balance(seller.token) === sellerBefore + s.receipt.earned, 'app owner credited (minus fee)');
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

// ─── WebMCP bridge (TARGET-034 phase C): app tools as a WebMCP surface + 402 payment flow ───

await test('28. GET /v1/apps/:owner/:app/webmcp — public WebMCP-shaped tool listing', async () => {
    const r = await fetch(`${BASE}/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp`);
    assert(r.status === 200, `listing ${r.status}`);
    const body = await r.json() as any;
    assert(body.webmcp?.spec?.includes('webmachinelearning/webmcp'), `webmcp spec ref: ${JSON.stringify(body.webmcp)}`);
    assert(body.library?.endsWith('/v1/libs/aimeat-webmcp.js'), `library: ${body.library}`);
    const echo = (body.tools || []).find((t: any) => t.name === 'echo');
    assert(!!echo && echo.inputSchema && echo.fulfillment === 'call', `echo tool: ${JSON.stringify(echo)}`);
    assert(echo.payment?.required === true && echo.payment.price?.morsels === 3, `echo payment: ${JSON.stringify(echo.payment)}`);
    assert(echo.payment.checkout?.items?.[0]?.kind === 'app-tool', 'ready-made checkout item');
    const free = (body.tools || []).find((t: any) => t.name === 'unpriced-echo');
    assert(free?.payment?.required === false, `unpriced tool payment: ${JSON.stringify(free?.payment)}`);
    const task = (body.tools || []).find((t: any) => t.name === 'concierge');
    assert(task?.fulfillment === 'task' && task.payment?.required === true, `task tool: ${JSON.stringify(task?.payment)}`);
    // The bridge library itself is served and carries the modelContext feature detection.
    const lib = await fetch(`${BASE}/v1/libs/aimeat-webmcp.js`);
    assert(lib.status === 200, `lib ${lib.status}`);
    const src = await lib.text();
    assert(src.includes('modelContext') && src.includes('provideContext'), 'lib feature-detects the WebMCP API');
});

await test('29. Priced tool unpaid → 402 with x402 accepts; paying the hinted checkout returns the result', async () => {
    const invokeUrl = `${BASE}/v1/apps/${encodeURIComponent(seller.name)}/${encodeURIComponent(appId)}/webmcp/tools/echo`;
    const r = await fetch(invokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { message: 'x' } }) });
    assert(r.status === 402, `unpaid invoke ${r.status}`);
    const body = await r.json() as any;
    assert(Array.isArray(body.accepts) && body.accepts.some((a: any) => a.scheme === 'aimeat-checkout'), `accepts: ${JSON.stringify(body.accepts)}`);
    assert(body.payment?.checkout?.items?.[0]?.tool === 'echo', `checkout hint: ${JSON.stringify(body.payment?.checkout)}`);
    // Follow the hint: same item, real input, through the normal checkout → the result rides back.
    const item = { ...body.payment.checkout.items[0], input: { message: 'paid via 402 flow' } };
    const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [item] }) });
    assert(create.status === 201, `create from hint ${create.status}: ${JSON.stringify(create.body.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    assert(done.body.data.session.fulfillment?.results?.[0]?.result?.echoed === 'Echo: paid via 402 flow', `402→checkout→result: ${JSON.stringify(done.body.data.session.fulfillment)}`);
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
    assert(echo.fulfillment === 'call' && echo.price?.morsels === 3, `echo entry: ${JSON.stringify(echo)}`);
    assert(echo.checkout_item?.kind === 'app-tool' && echo.checkout_item.tool === 'echo', 'ready-made checkout item');
    assert(echo.webmcp?.invoke?.includes('/webmcp/tools/echo'), `webmcp invoke url: ${echo.webmcp?.invoke}`);
    const task = (body.tools || []).find((t: any) => t.sku === `app-tool:${appRef}:concierge`);
    assert(task?.fulfillment === 'task' && task.price?.morsels === 5, `task entry: ${JSON.stringify(task)}`);
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
    assert(!!echo && echo.inputSchema && echo.price?.morsels === 3, `echo inline on the card: ${JSON.stringify(echo)}`);
    assert(ct.total === ct.tools.length, 'total matches inline entries');
    // The feed and the card come from the SAME enumerator — sku sets must agree.
    const feed = await (await fetch(`${BASE}/v1/commerce/feed`)).json() as any;
    const feedSkus = (feed.products || []).filter((p: any) => p.id.startsWith('app-tool:')).map((p: any) => p.id).sort();
    const cardSkus = (ct.tools || []).map((t: any) => t.sku).sort();
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
    assert(v.secretKey === 'sk_test_kept_alongside', `the stripe key landed: ${JSON.stringify(v)}`);

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
            body: JSON.stringify({ line_items: [{ item: { id: `offer:${vendorGaii}:translate-doc` }, quantity: 1 }] }),
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

console.log(`\n${'═'.repeat(50)}`);
console.log(`Commerce E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
