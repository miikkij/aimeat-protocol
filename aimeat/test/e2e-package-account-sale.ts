/**
 * @file e2e-package-account-sale.ts
 * @description E2E for an author selling their own package to another account of the same node
 *   (Jouni, 2026-10-31, "optio B"; wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 *   Owner A is the author, B the buyer, C another owner. The money moves on the node's test payment
 *   handler (test.money), never a real card.
 *
 *   Happy path: A connects a payment account, makes the package private and sets 12 EUR with one
 *   memory part as the preview; everyone sees the listing (the preview's content, no other content);
 *   B pays through the checkout and can then read, export and install the package, and a later
 *   version; A sees the sale; B's agent buys a second package over MCP within its daily limit.
 *
 *   Failure modes: no payment account (NO_PAYMENT_ACCOUNT), a public package (PRICE_NEEDS_PRIVATE),
 *   another owner pricing it (403), a morsel price (400), making it public while on sale
 *   (PACKAGE_PRICED); B reading, exporting or installing before paying (402 PURCHASE_REQUIRED); the
 *   author buying their own (OWN_PACKAGE); a payment that fails on the invoice rail leaves no
 *   purchase; an agent past its daily limit buys nothing; buying twice (ALREADY_BOUGHT); C reading B's
 *   purchase, A's sales or refunding (403, empty); a refund ends B's access, the update of B's copy,
 *   and a second refund is ALREADY_REFUNDED; an ended sale is no longer listed, and B, who bought it,
 *   keeps reading it.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-account-sale
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body).slice(0, 400)}`;
const stamp = Date.now() % 10_000_000;
const EUR = (n: number) => ({ amount: n * 1_000_000, currency: 'EUR' });

async function mkOwner(label: string) {
    const name = `pas${label}${stamp}`;
    const body = JSON.stringify({ username: name, display_name: name, password: 'PkgSale12345!' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'PkgSale12345!');
    return { name, token: tk.body.data.token as string };
}

const APP_HTML = '<!DOCTYPE html><html><head><title>Template</title></head><body><h1>The paid template</h1></body></html>';
const LISTING = JSON.stringify({ entries: [{ key: 'kit.listing', value: { title: 'Template', screenshots: ['data:image/png;base64,iVBORw0KGgo='] } }] });
const publish = (token: string, name: string, visibility = 'private') => json('/v1/packages', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
        name, description: 'A template to sell', category: 'other', tags: ['template'], visibility, status: 'published',
        components: [
            { id: 'ui', type: 'app', label: 'Template app', content: APP_HTML },
            { id: 'listing', type: 'memory', label: 'Listing', content: LISTING },
        ],
    }),
});
const setPrice = (token: string, group: string, body: Record<string, unknown>) =>
    json(`/v1/packages/${encodeURIComponent(group)}/price`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
async function checkout(token: string, group: string, handler = 'test.money') {
    const open = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(token), body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'package-account', app: group }] }),
    });
    if (open.status !== 201) return { open, done: null as any };
    const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(token), body: JSON.stringify({ payment: { handler, instrument: 'card-ok' } }),
    });
    return { open, done };
}
const purchases = async (token: string) => (await json('/v1/package-purchases', { headers: auth(token) })).body.data?.purchases as any[];

console.log('\n=== A package an author sells to accounts of this node ===\n');
let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let group = '', second = '', publicGroup = '', order = '', instanceId = '';

await test('Setup: an operator, the author A, the buyer B and another owner C; A publishes two private packages and a public one', async () => {
    OP = await mkOwner('op');   // on a fresh database the first account is the operator
    A = await mkOwner('a'); B = await mkOwner('b'); C = await mkOwner('c');
    const p = await publish(A.token, `tpl${stamp}`);
    assert(p.status === 201, `publish: ${show(p)}`);
    group = p.body.data.packageGroupId;
    const q = await publish(A.token, `kit${stamp}`);
    assert(q.status === 201, `publish second: ${show(q)}`);
    second = q.body.data.packageGroupId;
    const r = await publish(A.token, `free${stamp}`, 'public');
    assert(r.status === 201, `publish public: ${show(r)}`);
    publicGroup = r.body.data.packageGroupId;
});

await test('1. FAILURE: A cannot set a price before connecting a payment account (NO_PAYMENT_ACCOUNT), and nothing is listed', async () => {
    const r = await setPrice(A.token, group, { price: EUR(12) });
    assert(r.status === 409 && r.body.error?.code === 'NO_PAYMENT_ACCOUNT', show(r));
    const list = await json('/v1/packages?for_sale=true');
    assert(!list.body.data.packages.some((x: any) => x.packageGroupId === group), `listed: ${show(list)}`);
});

await test('2. FAILURE: a public package, another owner, and a morsel price are refused', async () => {
    const key = await json('/v1/commerce/payout/stripe', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ secret_key: 'sk_test_account_sale_e2e' }) });
    assert(key.status === 200, `stripe key: ${show(key)}`);
    const pub = await setPrice(A.token, publicGroup, { price: EUR(5) });
    assert(pub.status === 409 && pub.body.error?.code === 'PRICE_NEEDS_PRIVATE', `public: ${show(pub)}`);
    const other = await setPrice(B.token, group, { price: EUR(1) });
    assert(other.status === 403 && other.body.error?.code === 'FORBIDDEN', `B prices A's: ${show(other)}`);
    const morsel = await setPrice(A.token, group, { price: { amount: 5, currency: 'morsel' } });
    assert(morsel.status === 400 && morsel.body.error?.code === 'INVALID_INPUT', `morsel: ${show(morsel)}`);
    const badPreview = await setPrice(A.token, group, { price: EUR(12), preview: ['ui'] });
    assert(badPreview.status === 400, `an app part as preview: ${show(badPreview)}`);
});

await test('3. A sets 12 EUR with the listing part as preview; anyone sees the listing with the preview and no other content', async () => {
    const r = await setPrice(A.token, group, { price: EUR(12), preview: ['listing'] });
    assert(r.status === 200 && r.body.data.sale.state === 'on_sale' && r.body.data.sale.price.amount === 12_000_000 && r.body.data.sale.buyable === true, show(r));
    const list = await json('/v1/packages?for_sale=true');
    const row = list.body.data.packages.find((x: any) => x.packageGroupId === group);
    assert(row && row.sale?.price?.amount === 12_000_000 && row.buy?.kind === 'package-account' && row.author === A.name, `listing: ${show(list)}`);
    const ui = row.components.find((c: any) => c.id === 'ui');
    const listing = row.components.find((c: any) => c.id === 'listing');
    assert(ui && ui.content === undefined, `the app's content is not listed: ${JSON.stringify(ui)}`);
    assert(listing?.content === LISTING && listing.preview === true, `the preview's content is: ${JSON.stringify(listing)}`);
    for (const who of [undefined, B.token]) {
        const g = await json(`/v1/packages/${encodeURIComponent(group)}`, who ? { headers: auth(who) } : {});
        assert(g.status === 200 && g.body.data.listing_only === true && g.body.data.entitled === false, `listing read: ${show(g)}`);
        assert(!JSON.stringify(g.body.data).includes('The paid template'), 'the app content leaked into the listing');
    }
});

await test('3b. The operator reads the sold package, and the read is written to the operator trail in A\'s account', async () => {
    const trail = async () => {
        const r = await json('/v1/account/events?limit=200', { headers: auth(A.token) });
        assert(r.status === 200, `account events: ${show(r)}`);
        return (r.body.data.events as any[]).filter((e) => e.kind === 'operator_acted' && e.data?.area === 'package' && e.data?.action === 'read');
    };
    const before = (await trail()).length;
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(OP.token) });
    assert(g.status === 200 && g.body.data.listing_only !== true && JSON.stringify(g.body.data).includes('The paid template'), `operator read: ${show(g)}`);
    const after = await trail();
    assert(after.length === before + 1, `one operator_acted line for the read, got ${after.length - before}`);
});

await test('4. FAILURE: B reads a version, exports or installs before paying: 402 PURCHASE_REQUIRED, and the anonymous reader too', async () => {
    const versions = await json(`/v1/packages/${encodeURIComponent(group)}/versions`, { headers: auth(A.token) });
    const version = versions.body.data.versions[0].version;
    const v = await json(`/v1/packages/${encodeURIComponent(group)}/versions/${version}`, { headers: auth(B.token) });
    assert(v.status === 402 && v.body.error?.code === 'PURCHASE_REQUIRED', `version: ${show(v)}`);
    const e = await json(`/v1/packages/${encodeURIComponent(group)}/export`, { headers: auth(B.token) });
    assert(e.status === 402 && e.body.error?.code === 'PURCHASE_REQUIRED', `export: ${show(e)}`);
    const anon = await json(`/v1/packages/${encodeURIComponent(group)}/export`);
    assert(anon.status === 402, `anonymous export: ${show(anon)}`);
    const i = await json(`/v1/packages/${encodeURIComponent(group)}/install`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ label: 'early' }) });
    assert(i.status === 402 && i.body.error?.code === 'PURCHASE_REQUIRED', `install: ${show(i)}`);
    const list = await json('/v1/packages?author=' + encodeURIComponent(A.name), { headers: auth(B.token) });
    assert(!list.body.data.packages.some((x: any) => x.packageGroupId === group), 'the private package is not in the public list');
});

await test('5. FAILURE: while on sale the package cannot be made public (PACKAGE_PRICED), and the author cannot buy their own', async () => {
    const pub = await json(`/v1/packages/${encodeURIComponent(group)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'public' }) });
    assert(pub.status === 409 && pub.body.error?.code === 'PACKAGE_PRICED', `public: ${show(pub)}`);
    const members = await json(`/v1/packages/${encodeURIComponent(group)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'members' }) });
    assert(members.status === 409 && members.body.error?.code === 'PACKAGE_PRICED', `members: ${show(members)}`);
    const own = await checkout(A.token, group);
    assert(own.open.status === 409 && own.open.body.error?.code === 'OWN_PACKAGE', `own: ${show(own.open)}`);
});

await test('6. FAILURE: a payment the invoice rail refuses leaves no purchase', async () => {
    const r = await checkout(B.token, group, 'io.aimeat.invoice');
    assert(r.open.status === 201, `open: ${show(r.open)}`);
    assert(r.done.status >= 400, `completed on the invoice rail: ${show(r.done)}`);
    const mine = await purchases(B.token);
    assert(!mine.some((p: any) => p.group_id === group && p.entitled), `entitled after a refused payment: ${JSON.stringify(mine)}`);
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(B.token) });
    assert(g.body.data.listing_only === true, 'B reads the content after a refused payment');
});

await test('7. B pays 12 EUR; the purchase says what it covers, and B reads, exports and installs the package', async () => {
    const r = await checkout(B.token, group);
    assert(r.open.status === 201 && r.open.body.data.session.total === 12_000_000 && r.open.body.data.session.sellerOwner === A.name, `open: ${show(r.open)}`);
    assert(r.done.status === 200, `complete: ${show(r.done)}`);
    order = r.done.body.data.session.id;
    const result = r.done.body.data.session.fulfillment.results[0].result;
    assert(result.entitled === true && result.covers === 'line', `result: ${JSON.stringify(result)}`);
    const mine = await purchases(B.token);
    const p = mine.find((x: any) => x.group_id === group);
    assert(p?.entitled === true && p.state === 'paid' && p.order === order && p.amount === 12_000_000, `purchases: ${JSON.stringify(mine)}`);
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(B.token) });
    assert(g.status === 200 && !g.body.data.listing_only && g.body.data.entitled === true && JSON.stringify(g.body.data.components).includes('The paid template'), `full read: ${show(g)}`);
    const e = await fetch(`${BASE}/v1/packages/${encodeURIComponent(group)}/export`, { headers: auth(B.token) });
    assert(e.status === 200 && (e.headers.get('content-type') ?? '').includes('zip'), `export: ${e.status}`);
    const i = await json(`/v1/packages/${encodeURIComponent(group)}/install`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ label: 'bought' }) });
    assert(i.status === 201 || i.status === 200, `install: ${show(i)}`);
    instanceId = i.body.data.instance?.id ?? i.body.data.id;
    assert(!!instanceId, `instance id: ${show(i)}`);
});

await test('8. FAILURE: B cannot buy it twice (ALREADY_BOUGHT)', async () => {
    const r = await checkout(B.token, group);
    assert(r.open.status === 409 && r.open.body.error?.code === 'ALREADY_BOUGHT', show(r.open));
});

await test('9. FAILURE: C, another owner, reads nothing of B\'s purchase or A\'s sales, and cannot refund', async () => {
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(C.token) });
    assert(g.body.data.listing_only === true, `C reads the content: ${show(g)}`);
    const e = await json(`/v1/packages/${encodeURIComponent(group)}/export`, { headers: auth(C.token) });
    assert(e.status === 402, `C exports: ${show(e)}`);
    assert((await purchases(C.token)).length === 0, 'C sees purchases');
    const s = await json(`/v1/packages/${encodeURIComponent(group)}/sales`, { headers: auth(C.token) });
    assert(s.status === 403, `C reads A's sales: ${show(s)}`);
    const b = await json(`/v1/packages/${encodeURIComponent(group)}/sales`, { headers: auth(B.token) });
    assert(b.status === 403, `B reads A's sales: ${show(b)}`);
    const f = await json(`/v1/packages/${encodeURIComponent(group)}/sales/${order}/refund`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(f.status === 403, `C refunds: ${show(f)}`);
});

await test('10. A sees the sale; a later version reaches B with the purchase', async () => {
    const s = await json(`/v1/packages/${encodeURIComponent(group)}/sales`, { headers: auth(A.token) });
    assert(s.status === 200 && s.body.data.sales.length === 1 && s.body.data.sales[0].buyer === B.name && s.body.data.sales[0].state === 'paid'
        && s.body.data.totals.EUR === 12_000_000, `sales: ${show(s)}`);
    const v = await json(`/v1/packages/${encodeURIComponent(group)}/versions`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ status: 'published', changelog: 'v2', components: [{ id: 'ui', type: 'app', label: 'Template app', content: APP_HTML.replace('paid template', 'paid template v2') }, { id: 'listing', type: 'memory', label: 'Listing', content: LISTING }] }),
    });
    assert(v.status === 201, `new version: ${show(v)}`);
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(B.token) });
    assert(JSON.stringify(g.body.data.components ?? []).includes('paid template v2'), `B reads v2: ${show(g)}`);
    const plan = await json(`/v1/instances/${instanceId}/check-update`, { headers: auth(B.token) });
    assert(plan.status === 200 && plan.body.data.updateAvailable === true, `B's copy sees the update: ${show(plan)}`);
});

await test('11. FAILURE: B\'s agent buys nothing without a daily limit, nor past it; within it, it buys over MCP', async () => {
    const r = await setPrice(A.token, second, { price: EUR(3) });
    assert(r.status === 200, `price second: ${show(r)}`);
    const agent = await makeAgent(BASE, B, ['commerce:buy', 'packages:write']);
    const s = await openSession(BASE, agent.token);
    const list = await callTool(s, 'aimeat_package_list', { for_sale: true });
    assert(!list.isError && list.data.packages.some((x: any) => x.packageGroupId === second), `MCP list: ${list.text.slice(0, 300)}`);
    const offer = await callTool(s, 'aimeat_package_buy', { action: 'offer', group_id: second });
    assert(!offer.isError && offer.data.sale?.price?.amount === 3_000_000, `MCP offer: ${offer.text.slice(0, 300)}`);
    const open = await callTool(s, 'aimeat_package_buy', { action: 'checkout', group_id: second });
    assert(!open.isError && open.data.total === 3_000_000, `MCP checkout: ${open.text.slice(0, 300)}`);
    const noLimit = await callTool(s, 'aimeat_checkout_complete', { session_id: open.data.session_id, handler: 'test.money' });
    assert(noLimit.isError && /PURCHASE_LIMIT_NOT_SET/.test(noLimit.text), `no limit: ${noLimit.text.slice(0, 300)}`);
    const lim = await json(`/v1/agents/${agent.name}/purchase-limit`, { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ currency: 'EUR', per_day: 2 }) });
    assert(lim.status === 200, `limit 2: ${show(lim)}`);
    const past = await callTool(s, 'aimeat_checkout_complete', { session_id: open.data.session_id, handler: 'test.money' });
    assert(past.isError && /PURCHASE_LIMIT_REACHED/.test(past.text), `past the limit: ${past.text.slice(0, 300)}`);
    assert(!(await purchases(B.token)).some((p: any) => p.group_id === second && p.entitled), 'entitled past the limit');
    await json(`/v1/agents/${agent.name}/purchase-limit`, { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ currency: 'EUR', per_day: 10 }) });
    const ok = await callTool(s, 'aimeat_checkout_complete', { session_id: open.data.session_id, handler: 'test.money' });
    assert(!ok.isError, `within the limit: ${ok.text.slice(0, 300)}`);
    const mine = await callTool(s, 'aimeat_package_buy', { action: 'purchases' });
    assert(mine.data.purchases.some((p: any) => p.group_id === second && p.entitled === true), `MCP purchases: ${mine.text.slice(0, 300)}`);
    const got = await callTool(s, 'aimeat_package_get', { group_id: second });
    assert(!got.isError && got.data.entitled === true, `the agent reads the bought package: ${got.text.slice(0, 300)}`);
});

await test('11b. The author\'s agent prices and reads the sales over MCP; B\'s agent is refused both on A\'s package', async () => {
    const seller = await makeAgent(BASE, A, ['commerce:sell', 'packages:write']);
    const s = await openSession(BASE, seller.token);
    const set = await callTool(s, 'aimeat_package_price_set', { group_id: second, price: { amount: 4_000_000, currency: 'EUR' } });
    assert(!set.isError && set.data.sale?.price?.amount === 4_000_000, `MCP price: ${set.text.slice(0, 300)}`);
    const back = await callTool(s, 'aimeat_package_price_set', { group_id: second, price: { amount: 3_000_000, currency: 'EUR' } });
    assert(!back.isError, `MCP price back: ${back.text.slice(0, 300)}`);
    const sales = await callTool(s, 'aimeat_package_sales', { group_id: second, action: 'list' });
    assert(!sales.isError && sales.data.sales.some((x: any) => x.buyer === B.name && x.state === 'paid'), `MCP sales: ${sales.text.slice(0, 300)}`);
    const other = await makeAgent(BASE, B, ['commerce:sell', 'packages:write']);
    const o = await openSession(BASE, other.token);
    const p = await callTool(o, 'aimeat_package_price_set', { group_id: second, price: { amount: 1_000_000, currency: 'EUR' } });
    assert(p.isError && /FORBIDDEN/.test(p.text), `B's agent prices A's: ${p.text.slice(0, 300)}`);
    const l = await callTool(o, 'aimeat_package_sales', { group_id: second, action: 'list' });
    assert(l.isError && /FORBIDDEN/.test(l.text), `B's agent reads A's sales: ${l.text.slice(0, 300)}`);
    const r = await callTool(o, 'aimeat_package_sales', { group_id: second, action: 'refund', order: 'cs_none' });
    assert(r.isError && /FORBIDDEN/.test(r.text), `B's agent refunds on A's: ${r.text.slice(0, 300)}`);
});

await test('12. A refunds B: B is told, reads only the listing again, cannot export, update or migrate the copy; a second refund is ALREADY_REFUNDED', async () => {
    const r = await json(`/v1/packages/${encodeURIComponent(group)}/sales/${order}/refund`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(r.status === 200 && r.body.data.state === 'refunded' && r.body.data.outcome === 'refunded', `refund: ${show(r)}`);
    const g = await json(`/v1/packages/${encodeURIComponent(group)}`, { headers: auth(B.token) });
    assert(g.body.data.listing_only === true, `B reads the content after the refund: ${show(g)}`);
    const e = await json(`/v1/packages/${encodeURIComponent(group)}/export`, { headers: auth(B.token) });
    assert(e.status === 402, `export after the refund: ${show(e)}`);
    const plan = await json(`/v1/instances/${instanceId}/check-update`, { headers: auth(B.token) });
    assert(plan.status === 402 && plan.body.error?.code === 'PURCHASE_REQUIRED', `update after the refund: ${show(plan)}`);
    const latest = (await json(`/v1/packages/${encodeURIComponent(group)}/versions`, { headers: auth(A.token) })).body.data.versions[0].version;
    const mig = await json(`/v1/instances/${instanceId}/apply-migration`, {
        method: 'POST', headers: auth(B.token), body: JSON.stringify({ targetVersion: latest, components: [{ componentId: 'ui', action: 'replace' }] }),
    });
    assert(mig.status === 402 && mig.body.error?.code === 'PURCHASE_REQUIRED', `naming the new version after the refund: ${show(mig)}`);
    const p = (await purchases(B.token)).find((x: any) => x.group_id === group);
    assert(p?.state === 'refunded' && p.entitled === false, `purchase after the refund: ${JSON.stringify(p)}`);
    const n = await json('/v1/notifications?limit=50', { headers: auth(B.token) });
    assert((n.body.data?.notifications ?? []).some((x: any) => x.type === 'package_purchase_refunded'), `B told: ${show(n)}`);
    const again = await json(`/v1/packages/${encodeURIComponent(group)}/sales/${order}/refund`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(again.status === 409 && again.body.error?.code === 'ALREADY_REFUNDED', `again: ${show(again)}`);
});

await test('13. An ended sale is not listed and cannot be bought; B, who bought the second package, keeps it; A can share it again', async () => {
    const end = await setPrice(A.token, second, { price: null });
    assert(end.status === 200 && end.body.data.sale.state === 'ended', `end: ${show(end)}`);
    const list = await json('/v1/packages?for_sale=true');
    assert(!list.body.data.packages.some((x: any) => x.packageGroupId === second), 'ended sale still listed');
    const buy = await checkout(C.token, second);
    assert(buy.open.status === 404 && buy.open.body.error?.code === 'NOT_FOR_SALE', `buy an ended one: ${show(buy.open)}`);
    const g = await json(`/v1/packages/${encodeURIComponent(second)}`, { headers: auth(B.token) });
    assert(g.status === 200 && g.body.data.entitled === true && !g.body.data.listing_only, `B keeps it: ${show(g)}`);
    const c = await json(`/v1/packages/${encodeURIComponent(second)}`, { headers: auth(C.token) });
    assert(c.status === 404, `C after the end: ${show(c)}`);
    const pub = await json(`/v1/packages/${encodeURIComponent(second)}`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ visibility: 'members' }) });
    assert(pub.status === 200, `share after the end: ${show(pub)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
