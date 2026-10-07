/**
 * @file e2e-app-tool-money-prices.ts
 * @description An app tool sold in money is listed, quoted and sold at EVERY money price it declares,
 *   whether the manifest states it in `priceMoney`, in `pricesMoney`, or in both. The invoke route
 *   counted `pricesMoney` as a price (402) while the catalog, the feed, the 402's payment block and
 *   the checkout read `priceMoney` only: a tool sold only in USD through `pricesMoney` was absent
 *   from every catalog, answered 402 naming no price, and the checkout refused to sell it, and the
 *   second currency of a tool sold in two could not be bought at all.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-tool-money-prices
 * @version-history
 *   v1.0.0 — 2026-10-07 — Initial.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `mp${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MP', password: 'MpTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MP', password: 'MpTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'MpTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT app tool money prices: priceMoney and pricesMoney E2E ===\n');

let seller: Awaited<ReturnType<typeof setupOwner>>;
let buyer: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'money-shop.html';
const schema = { type: 'object', properties: { q: { type: 'string' } } };

await test('setup: one tool sold only through pricesMoney (USD), one sold in EUR and USD', async () => {
    seller = await setupOwner('sel');
    buyer = await setupOwner('buy');
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
        filename: APP, name: 'Money shop', description: 'money-prices e2e',
        content: Buffer.from('<!doctype html><title>shop</title><p>shop', 'utf8').toString('base64') }) });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const put = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
        key: `apps.${APP}.tools`, visibility: 'public', value: { version: 1, tools: [
            { name: 'usdonly', description: 'sold only through pricesMoney', action_id: 'ext:mpnone:run', inputSchema: schema,
              pricesMoney: [{ amount: 250000, currency: 'USD' }] },
            { name: 'dual', description: 'sold in EUR and USD', action_id: 'ext:mpnone:run', inputSchema: schema,
              priceMoney: { amount: 100000, currency: 'EUR' },
              pricesMoney: [{ amount: 100000, currency: 'EUR' }, { amount: 120000, currency: 'USD' }] },
        ] } }) });
    assert(put.status === 200 || put.status === 201, `manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);
});

await test('the catalog lists the pricesMoney-only tool with its USD price, and the dual tool with both', async () => {
    const r = await json('/v1/commerce/tools');
    assert(r.status === 200, `catalog ${r.status}`);
    const mine = (r.body.tools as any[]).filter(t => t.app === `${seller.name}/${APP}`);
    const usd = mine.find(t => t.name === 'usdonly');
    assert(!!usd, `the pricesMoney-only tool is listed: ${JSON.stringify(mine.map(t => t.name))}`);
    assert(usd.priceMoney?.amount === 250000 && usd.priceMoney?.currency === 'USD', `its price: ${JSON.stringify(usd.priceMoney)}`);
    const dual = mine.find(t => t.name === 'dual');
    assert(dual?.priceMoney?.currency === 'EUR', `the dual tool's first price stays EUR: ${JSON.stringify(dual?.priceMoney)}`);
    assert(JSON.stringify((dual?.pricesMoney ?? []).map((p: any) => [p.currency, p.amount])) === JSON.stringify([['EUR', 100000], ['USD', 120000]]),
        `both prices: ${JSON.stringify(dual?.pricesMoney)}`);
});

await test('the ACP feed lists the pricesMoney-only tool in USD', async () => {
    const r = await json('/v1/commerce/feed');
    assert(r.status === 200, `feed ${r.status}`);
    const p = (r.body.products as any[]).find(x => x.id === `app-tool:${seller.name}/${APP}:usdonly`);
    assert(!!p && p.price?.currency === 'USD' && p.price?.amount === 250000, `feed entry: ${JSON.stringify(p)}`);
});

await test('the 402 for the pricesMoney-only tool names its price', async () => {
    const r = await json(`/v1/apps/${seller.name}/${APP}/webmcp/tools/usdonly`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ input: { q: 'x' } }) });
    assert(r.status === 402, `invoke ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.payment?.priceMoney?.amount === 250000 && r.body.payment?.priceMoney?.currency === 'USD',
        `the payment block names the price: ${JSON.stringify(r.body.payment)}`);
});

const openSession = (token: string | null, tool: string, currency: string) => json('/v1/commerce/checkout-sessions', {
    method: 'POST', headers: token ? auth(token) : {},
    body: JSON.stringify({ currency, items: [{ kind: 'app-tool', app: `${seller.name}/${APP}`, tool, input: { q: 'x' } }] }) });

await test('the checkout refuses a caller with no token', async () => {
    const r = await openSession(null, 'usdonly', 'USD');
    assert(r.status === 401, `a session opened without a token: ${r.status}`);
});

await test('the checkout sells the pricesMoney-only tool in USD at its price', async () => {
    const r = await openSession(buyer.token, 'usdonly', 'USD');
    assert(r.status === 201, `open ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const s = r.body.data.session;
    assert(s.currency === 'USD' && s.total === 250000, `session priced at 250000 USD: ${s.currency} ${s.total}`);
});

await test('the checkout sells the dual tool in USD at its USD price, and in EUR at its EUR price', async () => {
    const usd = await openSession(buyer.token, 'dual', 'USD');
    assert(usd.status === 201, `open in USD ${usd.status}: ${JSON.stringify(usd.body?.error)}`);
    assert(usd.body.data.session.currency === 'USD' && usd.body.data.session.total === 120000, `USD price 120000: ${usd.body.data.session.currency} ${usd.body.data.session.total}`);
    const eur = await openSession(buyer.token, 'dual', 'EUR');
    assert(eur.status === 201, `open in EUR ${eur.status}: ${JSON.stringify(eur.body?.error)}`);
    assert(eur.body.data.session.currency === 'EUR' && eur.body.data.session.total === 100000, `EUR price 100000: ${eur.body.data.session.currency} ${eur.body.data.session.total}`);
});

await test('a currency the tool is not sold in is still refused', async () => {
    const r = await openSession(buyer.token, 'usdonly', 'EUR');
    assert(r.status === 422 && r.body.error?.code === 'CURRENCY_NOT_SUPPORTED', `EUR for a USD-only tool: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\napp tool money prices E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
