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

/** An agent of `who` holding `scopes`, through the device flow every agent uses. */
async function agentOf(who: { name: string; token: string }, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `mp${Date.now() % 100000}`, owner: who.name }) });
    await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: who.token }) });
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    const token = (t.body?.access_token ?? t.body?.data?.access_token) as string | undefined;
    assert(!!token, `agent token: ${JSON.stringify(t.body?.error ?? t.status)}`);
    return token as string;
}

/** One MCP session on an agent's token: initialize, then tools/call. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
    const headers = (sid?: string): Record<string, string> => ({
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
        ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
    });
    const read = async (res: Response, id: number) => {
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('text/event-stream')) return await res.json() as any;
        for (const evt of (await res.text()).split('\n\n')) {
            const data = evt.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
            if (!data) continue;
            const msg = JSON.parse(data);
            if (msg.id === id) return msg;
        }
        return {};
    };
    const init = await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'money-prices E2E', version: '1.0.0' } } }) });
    const sid = init.headers.get('mcp-session-id') ?? undefined;
    await read(init, 1);
    await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(sid), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const res = await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(sid), body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) });
    const body = await read(res, 2);
    return { isError: !!body.result?.isError, text: String(body.result?.content?.[0]?.text ?? body.error?.message ?? '') };
}

await test('aimeat_app_tools_publish reports a tool sold only through pricesMoney as priced', async () => {
    // The tool asks memory:write beside commerce:sell (the word the route it writes through asks).
    const agent = await agentOf(seller, ['commerce:sell', 'memory:write']);
    const r = await mcpCall(agent, 'aimeat_app_tools_publish', { app_id: 'money-mcp.html', tools: [
        { name: 'usdonly', description: 'sold only through pricesMoney', action_id: 'ext:mpnone:run', inputSchema: schema,
          pricesMoney: [{ amount: 250000, currency: 'USD' }] },
        { name: 'free', description: 'no price', action_id: 'ext:mpnone:run', inputSchema: schema },
    ] });
    assert(!r.isError, `publish: ${r.text.slice(0, 300)}`);
    const tools = (JSON.parse(r.text).tools ?? []) as any[];
    const priced = Object.fromEntries(tools.map(t => [t.name, t.priced]));
    assert(priced.usdonly === true && priced.free === false, `priced flags: ${JSON.stringify(priced)}`);
});

console.log(`\napp tool money prices E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
