/**
 * @file test/e2e-ui-components.ts
 * @description E2E for the component catalogue of the node's own interface: GET /v1/ui/components,
 *   GET /v1/ui/components/:id, and aimeat_ui_component_list / aimeat_ui_component_get over a real
 *   MCP session.
 *
 *   WHAT IS PROVEN HERE AND NOWHERE ELSE. `pnpm check:ui-library` proves the catalogue agrees with
 *   the files in the tree. This proves the running node serves it: the list and one entry over
 *   HTTP, every sheet and module an entry names answering as a real file from the same node, the
 *   refusals worded with their codes, and the MCP tool answering exactly what the route answers.
 *   The catalogue is public, so the second principal asked is nobody at all: an anonymous caller
 *   and a signed-in one must read the same thing.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ui-components
 * @version-history
 *   v1.1.0 — 2026-09-23 — The design lab's preview page is served as the app (phase 2).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT UI component catalogue E2E ===\n');

const ownerName = `uilib${Date.now()}`;
let ownerToken = '';
let ownerKey = '';

await test('Setup: one owner', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status}`);
    ownerKey = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerKey, ownerName + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;
});

let listed: any[] = [];

await test('The list is public, and names components and shapes with their pages', async () => {
    const r = await json('/v1/ui/components');
    assert(r.status === 200 && r.body.ok === true, `list: ${r.status}`);
    listed = r.body.data.components;
    assert(r.body.data.total === listed.length, 'total matches the rows');
    const ids = new Set(listed.map(c => c.id));
    for (const id of ['step-card', 'turn', 'composer', 'conversation-frame', 'slab', 'section']) {
        assert(ids.has(id), `${id} is in the catalogue`);
    }
    const turn = listed.find(c => c.id === 'turn');
    assert(turn.kind === 'component' && turn.module === '/components/Turn.js', `turn row: ${JSON.stringify(turn)}`);
    assert(turn.pages.includes('views/chat.js'), `the chat page draws a turn: ${turn.pages}`);
    assert(listed.filter(c => c.status === 'active').every(c => c.pages.length > 0), 'every active part names a page');
});

await test('A signed-in caller reads exactly what an anonymous one reads', async () => {
    const r = await json('/v1/ui/components', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(r.status === 200, `signed in: ${r.status}`);
    assert(JSON.stringify(r.body.data.components) === JSON.stringify(listed), 'the same rows');
});

await test('kind, status and q narrow the list', async () => {
    const shapes = (await json('/v1/ui/components?kind=shape')).body.data.components;
    assert(shapes.length > 0 && shapes.every((c: any) => c.kind === 'shape' && c.module === null), 'only shapes, none with a module');
    const unused = (await json('/v1/ui/components?status=unused')).body.data.components;
    assert(unused.some((c: any) => c.id === 'agent-card'), 'the unused home agent card is listed as unused');
    assert(unused.every((c: any) => c.status === 'unused' && c.pages.length === 0), 'unused parts name no page');
    const found = (await json('/v1/ui/components?q=' + encodeURIComponent('tool call'))).body.data.components;
    assert(found.some((c: any) => c.id === 'work-log'), `q finds the work log: ${found.map((c: any) => c.id)}`);
});

await test('A kind or a status outside the vocabulary is refused with its code', async () => {
    const k = await json('/v1/ui/components?kind=widget');
    assert(k.status === 400 && k.body.error?.code === 'INVALID_INPUT', `kind: ${k.status} ${JSON.stringify(k.body.error)}`);
    assert(/component, shape/.test(k.body.error.message), 'the refusal names the choices');
    const s = await json('/v1/ui/components?status=retired');
    assert(s.status === 400 && s.body.error?.code === 'INVALID_INPUT', `status: ${s.status}`);
});

await test('One entry, whole, by id or by name', async () => {
    const r = await json('/v1/ui/components/step-card');
    assert(r.status === 200, `get: ${r.status}`);
    const e = r.body.data;
    assert(e.data?.shape?.startsWith('StepCard('), `the data shape: ${e.data?.shape}`);
    assert(typeof e.data.fields.title === 'string', 'the fields say what each prop carries');
    assert(e.variants.some((v: any) => v.class === 'poster-step--open'), 'the variants name their classes');
    assert(e.tokens.includes('--sun') && e.tokens.includes('--text'), `the tokens it reads: ${e.tokens}`);
    assert(e.exports.includes('StepCard') && e.exports.includes('StepLede'), `the exports: ${e.exports}`);
    assert(e.example && typeof e.example === 'object', 'one example data set');
    const byName = await json('/v1/ui/components/StepCard');
    assert(byName.status === 200 && byName.body.data.id === 'step-card', 'the name finds the same entry');
});

await test('An unknown part is a 404 with its code', async () => {
    const r = await json('/v1/ui/components/no-such-part');
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `unknown: ${r.status} ${JSON.stringify(r.body.error)}`);
    // A missing ROUTE is also a 404 NOT_FOUND; the words tell the catalogue's refusal from it.
    assert(/no part called "no-such-part"/.test(r.body.error.message), `the catalogue refused it: ${r.body.error.message}`);
});

await test('Every sheet and module the catalogue names is served by this node', async () => {
    assert(listed.length > 0, 'the catalogue has rows to check');
    const files = new Set<string>();
    for (const c of listed) { files.add(c.sheet); if (c.module) files.add(c.module); }
    const missing: string[] = [];
    for (const f of files) {
        const res = await fetch(`${BASE}${f}`);
        await res.arrayBuffer();
        if (res.status !== 200) missing.push(`${f} → ${res.status}`);
    }
    assert(missing.length === 0, `not served: ${missing.join(', ')}`);
});

await test("The design lab's preview page is served as the app", async () => {
    // A refresh or a frame loads this address from the server, which answered 404 before it was
    // registered beside the other app addresses.
    const res = await fetch(`${BASE}/v1/design-lab/frame?id=turn&v=0&theme=dark`);
    const body = await res.text();
    assert(res.status === 200, `preview page: ${res.status}`);
    // The server stamps a nonce on the tag, so the attribute order is not fixed.
    assert(/<script[^>]*type="importmap"/.test(body), 'it is the app shell');
});

let mcpToken = '';
let mcpSession = '';

async function mcpRpc(method: string, params: Record<string, unknown> = {}, id = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(mcpSession ? { 'mcp-session-id': mcpSession, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) mcpSession = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/event-stream')) return await res.json() as any;
    const messages = (await res.text()).split('\n\n').map(evt => {
        const data = evt.trim().split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
        try { return data ? JSON.parse(data) : null; } catch { return null; }
    }).filter(Boolean);
    return messages.find((m: any) => m.id === id) ?? messages[0] ?? {};
}

await test('Over MCP, the tools answer what the route answers', async () => {
    const agent = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'uilibagent', owner: ownerName, capabilities: ['ui'], model: 'gpt-4o' }),
    });
    assert(agent.status === 201, `agent: ${agent.status} ${JSON.stringify(agent.body.error ?? '')}`);
    const gaii = agent.body.data.agent.gaii as string;
    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'UI library E2E', redirect_uris: [] }) });
    assert(client.status === 201, `mcp register: ${client.status}`);
    const ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii,
        signature: await signMsg(agent.body.data.private_key, gaii + NODE_ID + ts), timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }),
    });
    assert(tok.status === 200, `mcp token: ${tok.status}`);
    mcpToken = tok.body.access_token;

    await mcpRpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'UI library E2E', version: '1.0.0' } });
    const tools = await mcpRpc('tools/list', {}, 2);
    const names = new Set((tools?.result?.tools ?? []).map((t: any) => t.name));
    assert(names.has('aimeat_ui_component_list') && names.has('aimeat_ui_component_get'), 'both tools are registered');

    const list = await mcpRpc('tools/call', { name: 'aimeat_ui_component_list', arguments: { kind: 'component' } }, 3);
    assert(list?.result?.isError !== true, `list errored: ${JSON.stringify(list?.result ?? list).slice(0, 300)}`);
    const overMcp = JSON.parse(list.result.content[0].text);
    const overHttp = (await json('/v1/ui/components?kind=component')).body.data;
    assert(JSON.stringify(overMcp.components) === JSON.stringify(overHttp.components), 'the same rows over both doors');

    const one = await mcpRpc('tools/call', { name: 'aimeat_ui_component_get', arguments: { id: 'composer' } }, 4);
    const entry = JSON.parse(one.result.content[0].text);
    const http = (await json('/v1/ui/components/composer')).body.data;
    assert(JSON.stringify(entry) === JSON.stringify(http), 'the same entry over both doors');
});

await test('Over MCP, an unknown part is refused with NOT_FOUND', async () => {
    const r = await mcpRpc('tools/call', { name: 'aimeat_ui_component_get', arguments: { id: 'no-such-part' } }, 5);
    assert(r?.result?.isError === true, `expected an error result: ${JSON.stringify(r?.result ?? r).slice(0, 200)}`);
    assert(String(r.result.content[0].text).startsWith('NOT_FOUND:'), `the code leads: ${r.result.content[0].text}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
