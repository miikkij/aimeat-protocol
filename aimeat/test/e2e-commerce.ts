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
    // The stripe provider maps to the (absent on Community) EE handler → 422.
    const create2 = await json('/acp/v1/checkout_sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items: [{ id: `offer:${vendorGaii}:translate-doc` }] }) });
    const stripe = await json(`/acp/v1/checkout_sessions/${create2.body.id}/complete`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ payment_data: { provider: 'stripe' } }) });
    assert(stripe.status === 422 && stripe.body.error?.code === 'UNKNOWN_PAYMENT_HANDLER', `stripe on Community: ${stripe.status} ${stripe.body.error?.code}`);
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

await test('18. Community node rejects org-offering items (no EE resolver) and money currencies', async () => {
    const r = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(buyer.token),
        body: JSON.stringify({ items: [{ kind: 'org-offering', org: 'x/y', agent: 'a', offer_id: 'o' }] }),
    });
    assert(r.status === 422 && r.body.error?.code === 'UNKNOWN_ITEM_KIND', `org-offering on Community: ${r.status} ${r.body.error?.code}`);
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
const appId = 'demoapp';
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
            { name: 'no-binding', description: 'Priced but no capability binding', price: { morsels: 1 } },
            { name: 'broken', description: 'Priced, bound to a missing capability', action_id: 'ext:no-such-ext:nope', price: { morsels: 1 } },
        ],
    };
    const write = await json('/v1/memory', {
        method: 'POST', headers: auth(seller.token),
        body: JSON.stringify({ key: `apps.${appId}.tools`, value: tools, visibility: 'public' }),
    });
    assert(write.status === 200 || write.status === 201, `manifest write ${write.status}: ${JSON.stringify(write.body.error)}`);
});

await test('21. Feed lists the callable, priced app-tool (sku app-tool:<owner>/<appId>:<tool>)', async () => {
    const feedRes = await fetch(`${BASE}/v1/commerce/feed`);
    const feed = await feedRes.json() as any;
    const sku = `app-tool:${appRef}:echo`;
    const entry = (feed.products || []).find((p: any) => p.id === sku);
    assert(!!entry, `app-tool in feed: ${sku} (${feed.total} products)`);
    assert(entry.price?.amount === 3 && entry.price?.currency === 'MORSEL', `feed price: ${JSON.stringify(entry.price)}`);
    assert(!(feed.products || []).some((p: any) => p.id === `app-tool:${appRef}:no-binding`), 'unbound tools stay out of the feed');
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

await test('23. App-tool failure gates: unknown tool 404, unbound 422, unpriced 422, quantity>1 400, bad app ref 400', async () => {
    const post = (items: unknown) => json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ items }) });
    const ghost = await post([{ kind: 'app-tool', app: appRef, tool: 'no-such-tool' }]);
    assert(ghost.status === 404 && ghost.body.error?.code === 'TOOL_NOT_FOUND', `ghost: ${ghost.status} ${ghost.body.error?.code}`);
    const unbound = await post([{ kind: 'app-tool', app: appRef, tool: 'no-binding' }]);
    assert(unbound.status === 422 && unbound.body.error?.code === 'TOOL_NOT_CALLABLE', `unbound: ${unbound.status} ${unbound.body.error?.code}`);
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

console.log(`\n${'═'.repeat(50)}`);
console.log(`Commerce E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
