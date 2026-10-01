/**
 * @file e2e-agent-purchase-limit.ts
 * @description E2E for an agent's daily purchase limit in money (decision D5, Jouni 2026-10-02):
 *   GET/PUT /v1/agents/:name/purchase-limit and the refusal in completeSession.
 *
 *   Happy path: the owner sets a 3 EUR daily limit on their agent; the agent buys a 2 EUR offer and
 *   sees 2 spent today; the owner's own purchase is not limited.
 *
 *   Failure modes covered:
 *     - with no limit set, the agent's money checkout is refused (PURCHASE_LIMIT_NOT_SET), naming the card;
 *     - the agent cannot set its own limit (403);
 *     - a purchase past the limit is refused (PURCHASE_LIMIT_REACHED) and the session stays open;
 *     - another owner cannot read the agent's limit (404);
 *     - a morsel or unknown currency is not a limit (400).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-agent-purchase-limit
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

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
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function owner(tag: string) {
    const name = `buy${tag}${stamp}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Limit Test', password: 'Limit12345678' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.data.token as string };
}
async function agent(ownerToken: string, ownerName: string, name: string, scopes: string[]) {
    const reg = await json('/v1/agents', auth(ownerToken, { method: 'POST', body: JSON.stringify({ name, owner: ownerName, capabilities: ['commerce'], scopes }) }));
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

console.log('\n=== Agent purchase limit E2E ===\n');
// A neutral first owner: on a fresh database the first one becomes the operator.
await owner('o');
const seller = await owner('s');
const buyer = await owner('b');
const vendor = await agent(seller.token, seller.name, 'vendor', ['task:read', 'task:write']);
const pub = await json('/v1/agents/vendor/offers', auth(seller.token, {
    method: 'PUT', body: JSON.stringify({ offers: [{
        id: 'eur-two', title: 'Two-euro service', ask: 'A small paid service.',
        deliverable: { format: 'document', sample: 'untested' },
        priceMoney: { amount: 2_000_000, currency: 'EUR' }, visibility: 'public',
    }] }),
}));
assert(pub.status === 200, `offer ${pub.status}: ${JSON.stringify(pub.body.error)}`);
const shopper = await agent(buyer.token, buyer.name, 'shopper', ['commerce:buy', 'memory:read']);

/** Open a 2 EUR session and complete it on the invoice rail, as `token`. */
async function buy(token: string) {
    const open = await json('/v1/commerce/checkout-sessions', auth(token, {
        method: 'POST', body: JSON.stringify({ items: [{ agent: vendor.gaii, offer_id: 'eur-two', quantity: 1 }], currency: 'EUR' }),
    }));
    assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body.error)}`);
    const id = open.body.data.session.id as string;
    const done = await json(`/v1/commerce/checkout-sessions/${id}/complete`, auth(token, {
        method: 'POST', body: JSON.stringify({ payment: { handler: 'io.aimeat.invoice' } }),
    }));
    return { id, done };
}
const limitPath = '/v1/agents/shopper/purchase-limit';

await test('1. FAILURE: with no limit set, the agent\'s money checkout is refused and names the card', async () => {
    const { done } = await buy(shopper.token);
    assert(done.status === 403 && done.body.error?.code === 'PURCHASE_LIMIT_NOT_SET', `${done.status} ${JSON.stringify(done.body.error)}`);
    assert(/tab=agents&agent=shopper/.test(done.body.error.message), `names the card: ${done.body.error.message}`);
});

await test('2. FAILURE: the agent cannot set its own limit', async () => {
    const r = await json(limitPath, auth(shopper.token, { method: 'PUT', body: JSON.stringify({ currency: 'EUR', per_day: 100 }) }));
    assert(r.status === 403, `agent PUT: ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('3. FAILURE: a morsel or unknown currency is not a limit', async () => {
    const m = await json(limitPath, auth(buyer.token, { method: 'PUT', body: JSON.stringify({ currency: 'morsel', per_day: 5 }) }));
    assert(m.status === 400, `morsel: ${m.status}`);
    const n = await json(limitPath, auth(buyer.token, { method: 'PUT', body: JSON.stringify({ currency: 'EUR', per_day: -1 }) }));
    assert(n.status === 400, `negative: ${n.status}`);
});

await test('4. the owner sets 3 EUR a day; the agent buys 2 EUR and sees 2 spent today', async () => {
    const set = await json(limitPath, auth(buyer.token, { method: 'PUT', body: JSON.stringify({ currency: 'EUR', per_day: 3 }) }));
    assert(set.status === 200 && set.body.data.limits[0]?.per_day === 3, `set: ${set.status} ${JSON.stringify(set.body.data ?? set.body.error)}`);
    const { done } = await buy(shopper.token);
    assert(done.status === 200, `buy within the limit: ${done.status} ${JSON.stringify(done.body.error)}`);
    const read = await json(limitPath, auth(shopper.token));
    assert(read.status === 200 && read.body.data.limits[0]?.spent_today === 2, `the agent reads its own: ${JSON.stringify(read.body.data)}`);
});

await test('5. FAILURE: a purchase past the limit is refused, and the session stays open', async () => {
    const { id, done } = await buy(shopper.token);
    assert(done.status === 403 && done.body.error?.code === 'PURCHASE_LIMIT_REACHED', `${done.status} ${JSON.stringify(done.body.error)}`);
    const s = await json(`/v1/commerce/checkout-sessions/${id}`, auth(buyer.token));
    assert(s.body.data?.session?.status === 'open', `still open: ${JSON.stringify(s.body.data?.session?.status)}`);
});

await test('6. the owner\'s own purchase is not limited', async () => {
    const { done } = await buy(buyer.token);
    assert(done.status === 200, `owner buys: ${done.status} ${JSON.stringify(done.body.error)}`);
});

await test('7. FAILURE: another owner cannot read the agent\'s limit', async () => {
    const r = await json(`/v1/agents/${encodeURIComponent(shopper.gaii)}/purchase-limit`, auth(seller.token));
    assert(r.status === 404, `cross-owner read: ${r.status}`);
});

await test('8. the agent reads its limit from its owner\'s record, as the commerce handbook says', async () => {
    const r = await json('/v1/memory/commerce.agent-limits?owner_scope=true', auth(shopper.token));
    assert(r.status === 200, `record read: ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.value?.limits?.[shopper.gaii]?.EUR === 3_000_000, `limit in micro-units: ${JSON.stringify(r.body.data?.value)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
