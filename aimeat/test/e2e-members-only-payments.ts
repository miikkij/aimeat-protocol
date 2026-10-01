/**
 * @file e2e-members-only-payments.ts
 * @description An app whose plan says `members-only` refuses a non-member on every route that sells a
 *   call, BEFORE that route charges: the REST app-tool route, the MCP app-tool tool, and the checkout.
 *   The raw extension paywall already refused before its till opened (e2e-app-members), but these
 *   routes settled first and reached the paywall with an internal pass that skipped the question, so a
 *   paying non-member was charged and served. Each case is asserted as an observed effect: the refusal
 *   code, and the non-member's carried calls not moving.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-members-only-payments
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (wish-members-only-refuses-a-non-member-before-checkout-or-a-contr).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `mo${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MO', password: 'MoTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MO', password: 'MoTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'MoTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An agent of `who` holding `scopes`, through the device flow every agent uses. */
async function agentOf(who: { name: string; token: string }, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `mo${Date.now() % 100000}`, owner: who.name }) });
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
        const text = await res.text();
        for (const evt of text.split('\n\n')) {
            const data = evt.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
            if (!data) continue;
            const msg = JSON.parse(data);
            if (msg.id === id) return msg;
        }
        return {};
    };
    const init = await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'members-only E2E', version: '1.0.0' } } }) });
    const sid = init.headers.get('mcp-session-id') ?? undefined;
    await read(init, 1);
    await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(sid), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const res = await fetch(`${BASE}/v1/mcp`, { method: 'POST', headers: headers(sid), body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) });
    const body = await read(res, 2);
    return { status: res.status, isError: !!body.result?.isError, text: String(body.result?.content?.[0]?.text ?? body.error?.message ?? '') };
}

console.log('\n=== AIMEAT members-only on the routes that charge E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let member: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'members-shop.html';
const TOOL = 'lookup';
let ext = '';
let offering = '';

await test('setup: an app, its extension naming it, a priced tool, a member, and an outsider holding a grant', async () => {
    owner = await setupOwner('own');
    member = await setupOwner('mem');
    stranger = await setupOwner('str');
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        filename: APP, name: 'Members shop', description: 'members-only e2e',
        content: Buffer.from('<!doctype html><title>shop</title><p>shop', 'utf8').toString('base64') }) });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);

    ext = `moext${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${ext}`, '  version: 1.0.0', '  description: members-only fixture', '  author: t',
        'config:', '  app:', '    type: string', `    default: ${owner.name}/${APP}`,
        'actions:', `  - id: ${TOOL}`, '    method: POST', `    path: /${TOOL}`,
        '    input: { type: object }', '    output: { type: object }', `    script: ${TOOL}.js`,
    ].join('\n');
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        manifest, scripts: { [`${TOOL}.js`]: 'export default async function () { return { ok: true, answer: 42 }; }' } }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');
    // The operator's capability aggregation registers ext:<name>:<action>; the first account on a
    // fresh test database is the operator.
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(owner.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)}`);
    const cap = await json(`/v1/capabilities/${encodeURIComponent(`ext:${ext}:${TOOL}`)}`);
    assert(cap.status === 200, `capability ${cap.status}: ${JSON.stringify(cap.body?.error)}`);

    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const put = await json('/v1/memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        key: `apps.${APP}.tools`, visibility: 'public',
        value: { version: 1, tools: [{ name: TOOL, description: 'look it up', action_id: `ext:${ext}:${TOOL}`, inputSchema: schema, outputSchema: schema, price: { morsels: 3 }, exchange: true }] } }) });
    assert(put.status === 200 || put.status === 201, `tool manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);
    const listed = await json('/v1/exchange/offerings', { headers: auth(owner.token) });
    offering = ((listed.body.data.offerings as any[]).find(o => o.providerOwner === owner.name && o.action === TOOL)?.offeringId) ?? '';
    assert(!!offering, 'the tool is listed');

    const ok = await json(`/v1/apps/${owner.name}/${APP}/members`, { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'member', offerings: [offering] }) });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const grant = await json('/v1/exchange/grants', { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ consumer: stranger.name, offering_id: offering, note: 'an outsider the owner once carried' }) });
    assert(grant.status === 200 || grant.status === 201, `grant ${grant.status}: ${JSON.stringify(grant.body?.error)}`);
});

const restCall = (token: string) => json(`/v1/apps/${owner.name}/${APP}/webmcp/tools/${TOOL}`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ input: { q: 'x' } }) });
const setAccess = (access: string) => json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
    method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: {}, access }) });
/** How many calls the owner has carried for this person so far. */
const carriedCalls = async (account: string) => {
    const r = await json(`/v1/exchange/grants?app_id=${encodeURIComponent(`${owner.name}/${APP}`)}`, { headers: auth(owner.token) });
    return ((r.body.data?.grants as any[]) ?? [])
        .filter(g => String(g.consumer_gaii).toLowerCase().startsWith(account.toLowerCase()))
        .reduce((n, g) => n + (g.budget?.calls ?? 0), 0);
};

await test('members-free: the outsider\'s REST call goes through, so the refusals below are the plan\'s doing', async () => {
    await setAccess('members-free');
    const r = await restCall(stranger.token);
    assert(r.status === 200, `an outsider holding a grant is served while the app is members-free: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await test('members-only: the REST app-tool route refuses the outsider before it charges', async () => {
    await setAccess('members-only');
    const before = await carriedCalls(stranger.name);
    const r = await restCall(stranger.token);
    assert(r.status === 403 && r.body.error?.code === 'MEMBERS_ONLY', `the outsider was served: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(await carriedCalls(stranger.name) === before, 'and nothing was settled for the refused call');
    const m = await restCall(member.token);
    assert(m.status === 200, `a member is still served: ${m.status} ${JSON.stringify(m.body?.error)}`);
    const o = await restCall(owner.token);
    assert(o.status === 200, `the owner is still served: ${o.status} ${JSON.stringify(o.body?.error)}`);
});

await test('members-only: the MCP app-tool tool refuses the outsider before it charges', async () => {
    const before = await carriedCalls(stranger.name);
    const theirAgent = await agentOf(stranger, ['exchange:write']);
    const memberAgent = await agentOf(member, ['exchange:write']);
    const r = await mcpCall(theirAgent, 'aimeat_app_tool_invoke', { owner: owner.name, app: APP, tool: TOOL, input: { q: 'x' } });
    assert(r.isError && /MEMBERS_ONLY/.test(r.text), `the outsider was served over MCP: ${r.status} ${r.text.slice(0, 200)}`);
    assert(await carriedCalls(stranger.name) === before, 'and nothing was settled for the refused call');
    const m = await mcpCall(memberAgent, 'aimeat_app_tool_invoke', { owner: owner.name, app: APP, tool: TOOL, input: { q: 'x' } });
    assert(!m.isError, `a member is still served over MCP: ${m.text.slice(0, 200)}`);
});

await test('members-only: the checkout refuses to open a session for the outsider', async () => {
    const open = (token: string) => json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(token),
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: `${owner.name}/${APP}`, tool: TOOL, input: { q: 'x' } }] }) });
    const r = await open(stranger.token);
    assert(r.status === 403 && r.body.error?.code === 'MEMBERS_ONLY', `a session opened for the outsider: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const m = await open(member.token);
    assert(m.status === 201, `a member can still open one: ${m.status} ${JSON.stringify(m.body?.error)}`);
});

await test('members-free again: the outsider is served, so the stance is the only thing that changed', async () => {
    await setAccess('members-free');
    const r = await restCall(stranger.token);
    assert(r.status === 200, `served again once the app sells to everybody: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log(`\nmembers-only payments E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
