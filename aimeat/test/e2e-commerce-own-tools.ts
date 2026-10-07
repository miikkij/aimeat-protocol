/**
 * @file e2e-commerce-own-tools.ts
 * @description GET /v1/commerce/tools?include=own: an authenticated caller also gets its own owner's
 *   UNPRICED callable app tools (price null, own: true) after the priced catalog, so an agent finds
 *   its owner's free tools in the same read as the priced ones instead of one listing per app.
 *   Asserted: the agent sees its owner's free tool once and the other owner's priced tool as before;
 *   it never sees the other owner's free tool, a private manifest's tool, or an unpriced task tool;
 *   an anonymous read and a read without the flag are unchanged; and the listed invoke URL runs for
 *   the agent unmetered.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-commerce-own-tools
 * @version-history
 *   v1.0.0 — 2026-10-07 — Initial (wish-commerce-tool-catalog-includes-the-caller-s-own-unpriced-cal).
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
    const name = `ot${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'OT', password: 'OtTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'OT', password: 'OtTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'OtTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An agent of `who` holding `scopes`, through the device flow every agent uses. */
async function agentOf(who: { name: string; token: string }, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `ot${Date.now() % 100000}`, owner: who.name }) });
    await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: who.token }) });
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    const token = (t.body?.access_token ?? t.body?.data?.access_token) as string | undefined;
    assert(!!token, `agent token: ${JSON.stringify(t.body?.error ?? t.status)}`);
    return token as string;
}

async function publishApp(owner: { token: string }, filename: string) {
    const r = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        filename, name: filename, description: 'own-tools e2e',
        content: Buffer.from(`<!doctype html><title>${filename}</title><p>${filename}`, 'utf8').toString('base64') }) });
    assert(r.status === 200 || r.status === 201, `publish ${filename} ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

async function putManifest(owner: { token: string }, filename: string, visibility: 'public' | 'private', tools: unknown[]) {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        key: `apps.${filename}.tools`, visibility, value: { version: 1, tools } }) });
    assert(r.status === 200 || r.status === 201, `manifest ${filename} ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

const catalog = (token?: string, query = '') =>
    json(`/v1/commerce/tools${query}`, token ? { headers: auth(token) } : {});
const skus = (tools: any[]) => tools.map(t => t.sku as string);

console.log('\n=== AIMEAT commerce catalog: the caller\'s own unpriced tools E2E ===\n');

let a: Awaited<ReturnType<typeof setupOwner>>;
let b: Awaited<ReturnType<typeof setupOwner>>;
let aAgent = '';
let ext = '';
const A_FREE = 'a-free.html';
const A_SHOP = 'a-shop.html';
const A_PRIVATE = 'a-private.html';
const B_FREE = 'b-free.html';
const B_SHOP = 'b-shop.html';
const schema = { type: 'object', properties: { q: { type: 'string' } } };

await test('setup: A has a free tool on an installed extension, a priced tool and a private manifest; B has a free and a priced tool', async () => {
    a = await setupOwner('a');
    b = await setupOwner('b');
    for (const f of [A_FREE, A_SHOP, A_PRIVATE]) await publishApp(a, f);
    for (const f of [B_FREE, B_SHOP]) await publishApp(b, f);

    ext = `otext${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${ext}`, '  version: 1.0.0', '  description: own-tools fixture', '  author: t',
        'actions:', '  - id: run', '    method: POST', '    path: /run',
        '    input: { type: object }', '    output: { type: object }', '    script: run.js',
    ].join('\n');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(a.token), body: JSON.stringify({
        manifest, scripts: { 'run.js': 'export default async function () { return { ok: true, answer: 42 }; }' } }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(a.token), body: '{}' })).status === 200, 'activate');
    // The first account on a fresh test database is the operator, whose aggregation registers
    // ext:<name>:<action> as a capability.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(a.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)}`);
    const cap = await json(`/v1/capabilities/${encodeURIComponent(`ext:${ext}:run`)}`);
    assert(cap.status === 200, `capability ${cap.status}: ${JSON.stringify(cap.body?.error)}`);

    const actionId = `ext:${ext}:run`;
    await putManifest(a, A_FREE, 'public', [
        { name: 'free_call', description: 'A runs this for free', action_id: actionId, inputSchema: schema },
        { name: 'free_task', description: 'no binding, nothing to run', inputSchema: schema },
    ]);
    await putManifest(a, A_SHOP, 'public', [
        { name: 'paid_call', description: 'A sells this', action_id: actionId, inputSchema: schema, price: { morsels: 3 } },
    ]);
    await putManifest(a, A_PRIVATE, 'private', [
        { name: 'hidden_call', description: 'a private manifest', action_id: actionId, inputSchema: schema },
    ]);
    await putManifest(b, B_FREE, 'public', [
        { name: 'b_free_call', description: 'B runs this for free', action_id: actionId, inputSchema: schema },
    ]);
    await putManifest(b, B_SHOP, 'public', [
        { name: 'b_paid_call', description: 'B sells this', action_id: actionId, inputSchema: schema, price: { morsels: 2 } },
    ]);
    aAgent = await agentOf(a, ['exchange:write']);
});

let anonymous: any[] = [];

await test('anonymous: the catalog lists the priced tools only, and include=own changes nothing', async () => {
    const r = await catalog();
    assert(r.status === 200, `catalog ${r.status}: ${JSON.stringify(r.body?.error)}`);
    anonymous = r.body.tools;
    const names = anonymous.map(t => t.name);
    assert(names.includes('paid_call') && names.includes('b_paid_call'), `both priced tools listed: ${names.join(',')}`);
    assert(!names.some(n => ['free_call', 'free_task', 'hidden_call', 'b_free_call'].includes(n)), `no unpriced tool for an anonymous caller: ${names.join(',')}`);
    assert(anonymous.every(t => t.own === undefined), 'no entry carries own');
    const flagged = await catalog(undefined, '?include=own');
    assert(flagged.status === 200, `flagged anonymous ${flagged.status}`);
    assert(JSON.stringify(skus(flagged.body.tools)) === JSON.stringify(skus(anonymous)), 'include=own without a token is the anonymous answer');
});

await test('A\'s agent without the flag gets the anonymous catalog, in the same order', async () => {
    const r = await catalog(aAgent);
    assert(r.status === 200, `catalog ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(JSON.stringify(skus(r.body.tools)) === JSON.stringify(skus(anonymous)), 'the unflagged answer did not change');
});

let ownEntry: any;

await test('A\'s agent with include=own sees A\'s free callable tool once, marked own, after the unchanged priced list', async () => {
    const r = await catalog(aAgent, '?include=own');
    assert(r.status === 200, `catalog ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const tools: any[] = r.body.tools;
    assert(r.body.total === tools.length, 'total counts every entry');
    assert(JSON.stringify(skus(tools.slice(0, anonymous.length))) === JSON.stringify(skus(anonymous)), 'the priced entries come first, unchanged');
    const own = tools.slice(anonymous.length);
    assert(own.length === 1, `exactly one own entry: ${JSON.stringify(own.map(t => t.sku))}`);
    ownEntry = own[0];
    assert(ownEntry.sku === `app-tool:${a.name}/${A_FREE}:free_call`, `sku ${ownEntry.sku}`);
    assert(ownEntry.app === `${a.name}/${A_FREE}` && ownEntry.ownerName === a.name, `app ${ownEntry.app} owner ${ownEntry.ownerName}`);
    assert(ownEntry.own === true && ownEntry.price === null, `own ${ownEntry.own} price ${JSON.stringify(ownEntry.price)}`);
    assert(ownEntry.fulfillment === 'call' && ownEntry.description === 'A runs this for free', `fulfillment ${ownEntry.fulfillment}`);
    assert(JSON.stringify(ownEntry.inputSchema) === JSON.stringify(schema), 'inputSchema as published');
    assert(typeof ownEntry.webmcp?.invoke === 'string' && ownEntry.webmcp.invoke.endsWith(`/v1/apps/${a.name}/${A_FREE}/webmcp/tools/free_call`), `invoke ${ownEntry.webmcp?.invoke}`);
    assert(ownEntry.checkout_item === undefined, 'an own free tool has nothing to check out');
    assert(tools.filter(t => t.name === 'free_call').length === 1, 'listed once');
    assert(!tools.some(t => t.name === 'free_task'), 'an unpriced task tool has nothing to run and is not listed');
    assert(!tools.some(t => t.name === 'hidden_call'), 'a private manifest is not listed');
    const bPaid = tools.find(t => t.name === 'b_paid_call');
    assert(!!bPaid && bPaid.own === undefined && bPaid.price?.morsels === 2, `B's priced tool as before: ${JSON.stringify(bPaid)}`);
});

await test('SECURITY: A\'s agent never sees B\'s unpriced tool, and B sees B\'s own and not A\'s', async () => {
    const r = await catalog(aAgent, '?include=own');
    assert(!(r.body.tools as any[]).some(t => t.name === 'b_free_call' || String(t.sku).includes(`${b.name}/${B_FREE}`)),
        `B's free tool reached A's agent: ${JSON.stringify(skus(r.body.tools))}`);
    const ownerRead = await catalog(a.token, '?include=own');
    assert(!(ownerRead.body.tools as any[]).some(t => t.name === 'b_free_call'), 'nor A in person');
    const bRead = await catalog(b.token, '?include=own');
    const bOwn = (bRead.body.tools as any[]).filter(t => t.own === true);
    assert(JSON.stringify(bOwn.map(t => t.name)) === JSON.stringify(['b_free_call']), `B's own entries: ${JSON.stringify(bOwn.map(t => t.sku))}`);
});

await test('the listed invoke URL runs A\'s free tool for A\'s agent, unmetered', async () => {
    const r = await json(ownEntry.webmcp.invoke, { method: 'POST', headers: auth(aAgent), body: JSON.stringify({ input: { q: 'x' } }) });
    assert(r.status === 200, `invoke ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data?.metered === false, `metered ${JSON.stringify(r.body.data?.metered)}`);
    assert(r.body.data?.result?.answer === 42, `result ${JSON.stringify(r.body.data?.result)}`);
});

console.log(`\ncommerce own tools E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
