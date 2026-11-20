/**
 * @file test/e2e-app-ref-bare-name.ts
 * @description An app named without `.html` is the same app on every kind of input: a REST path, a
 *   REST body, the MCP tools that read and call an app's tools, and the owner-only PATCH and DELETE.
 *
 *   WHY THIS SUITE EXISTS. An app is stored by its filename (`lifecycle-central.html`) and every
 *   person and AI names it without the extension. aimeat_app_tools_get and aimeat_app_tool_invoke
 *   answered APP_TOOLS_NOT_FOUND to `lifecycle-central`, and their hint, cut at twelve names in
 *   alphabetical order, never named the right one. services/app/app-ref.ts is now the one rule
 *   (exact filename first, then `.html`), and middleware/app-ref-path.ts applies it to every
 *   `/v1/apps/<owner>/<name>` path.
 *
 *   WHAT IT REFUSES. A name prefixed with ANOTHER owner never resolves into this owner's app, and
 *   another owner's PATCH or DELETE by the bare name reaches nothing of the app's owner.
 * @structure
 *   - Phase 1: fixtures (two owners, an agent of the first, an app with a tool manifest)
 *   - Phase 2: the designed use (REST path, MCP read and call, publish by the bare name, PATCH, DELETE)
 *   - Phase 3: the refusals (another owner's prefix, another owner's PATCH and DELETE)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-ref-bare-name
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            redirect: 'manual',
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body, headers: res.headers };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'BareNameTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const tok = await ownerSignIn(BASE, owner, 'BareNameTest1234');
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `bn${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return tok.body.data.token as string;
}

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-app-ref-bare-name', version: '1.0.0' },
    });
    return session;
}

async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

function publishBody(filename: string, title: string): string {
    return JSON.stringify({
        filename, content: Buffer.from(`<!doctype html><title>${title}</title><h1>${title}</h1>`).toString('base64'),
        mime_type: 'text/html', name: title, description: 'An app for the bare-name suite', version: '1.0.0', category: 'tools', tags: [],
    });
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: an app named without .html is the same app everywhere ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const APP = `bnapp${STAMP}`;
const FILE = `${APP}.html`;
const NEW = `bnnew${STAMP}`;
const TOOL = { name: 'ping', description: 'A tool with no backing action', inputSchema: { type: 'object', properties: {} } };

const alice = await makeOwner('bnalice');
const bob = await makeOwner('bnbob');
const aliceAgent = await makeAgent(alice, ['app:read', 'app:write', 'commerce:sell', 'exchange:read', 'exchange:write', 'memory:read', 'memory:write', 'ext:invoke']);
const session = await openSession(aliceAgent);
const bobAgent = await makeAgent(bob, ['app:read', 'exchange:read', 'exchange:write', 'memory:read']);
const bobSession = await openSession(bobAgent);

console.log('\nPhase 1 — fixtures');

await test('1. Alice publishes the app as a .html file and a public tool manifest for it', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(FILE, 'Bare one') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const tools = await callTool(session, 'aimeat_app_tools_publish', { app_id: FILE, tools: [TOOL] });
    assert(!tools.isError, `tools publish refused: ${tools.text.slice(0, 300)}`);
});

console.log('\nPhase 2 — the bare name reaches the app on every input');

await test('2. GET /v1/apps/<owner>/<name> answers as GET /v1/apps/<owner>/<name>.html does', async () => {
    const full = await json(`/v1/apps/${alice.owner}/${FILE}`);
    const bare = await json(`/v1/apps/${alice.owner}/${APP}`);
    assert(full.status === 200 || (full.status >= 300 && full.status < 400), `the .html path answers: ${full.status}`);
    assert(bare.status === full.status, `the bare path answers the same status: ${bare.status} vs ${full.status}`);
    assert(bare.headers.get('location') === full.headers.get('location'), `the same redirect target: ${bare.headers.get('location')} vs ${full.headers.get('location')}`);
    if (full.status === 200) assert(String(bare.body._raw ?? '').includes('Bare one'), 'the bare path serves the app');
});

await test('3. A JSON route under the app takes the bare name too (GET .../news)', async () => {
    const full = await json(`/v1/apps/${alice.owner}/${FILE}/news`, { headers: authed(alice.token) });
    const bare = await json(`/v1/apps/${alice.owner}/${APP}/news`, { headers: authed(alice.token) });
    assert(full.status === 200, `the .html route answers: ${full.status} ${JSON.stringify(full.body?.error)}`);
    assert(bare.status === 200, `the bare route answers: ${bare.status} ${JSON.stringify(bare.body?.error)}`);
});

await test('4. aimeat_app_tools_get reads the manifest by the bare name, and by owner/name with no owner argument', async () => {
    const bare = await callTool(session, 'aimeat_app_tools_get', { app_id: APP });
    assert(!bare.isError, `read by the bare name refused: ${bare.text.slice(0, 300)}`);
    assert(bare.data.manifest?.tools?.[0]?.name === 'ping', `the manifest comes back: ${bare.text.slice(0, 300)}`);
    const prefixed = await callTool(bobSession, 'aimeat_app_tools_get', { app_id: `${alice.owner}/${APP}` });
    assert(!prefixed.isError, `another owner's public read by owner/name refused: ${prefixed.text.slice(0, 300)}`);
    assert(prefixed.data.manifest?.tools?.[0]?.name === 'ping', `the public manifest comes back: ${prefixed.text.slice(0, 300)}`);
});

await test('5. POST /v1/apps under the bare name updates the .html app instead of starting a second one', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(APP, 'Bare two') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const data = pub.body.data ?? {};
    assert(data.filename === FILE, `the publish lands on ${FILE}: ${JSON.stringify(data).slice(0, 300)}`);
    assert(data.isUpdate === true || data.is_update === true || Number(data.versionNumber ?? data.version_number ?? data.version) === 2,
        `it is the app's second version: ${JSON.stringify(data).slice(0, 300)}`);
    const stray = await json(`/v1/apps/${alice.owner}/${APP}/news`, { headers: authed(alice.token) });
    assert(stray.status === 200, 'the bare name still resolves to the one app');
});

await test('6. A new HTML app published under a name with no extension is stored as name.html', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: authed(alice.token), body: publishBody(NEW, 'Brand new') });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    assert(pub.body.data?.filename === `${NEW}.html`, `stored as ${NEW}.html: ${JSON.stringify(pub.body.data).slice(0, 300)}`);
});

await test('7. PATCH /v1/apps/<name> (the owner is the caller) changes the .html app', async () => {
    const p = await json(`/v1/apps/${APP}`, { method: 'PATCH', headers: authed(alice.token), body: JSON.stringify({ description: 'Patched by the bare name' }) });
    assert(p.status === 200, `patch ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const list = await json(`/v1/apps?owner=${alice.owner}&q=${APP}`, { headers: authed(alice.token) });
    const row = (list.body.data?.apps ?? []).find((a: any) => a.filename === FILE);
    assert(row, `the app is listed: ${JSON.stringify(list.body.data).slice(0, 300)}`);
    const desc = row.description ?? row.manifest?.description;
    assert(desc === 'Patched by the bare name', `the description changed: ${desc}`);
});

console.log('\nPhase 3 — the refusals');

await test('8. A name prefixed with another owner never resolves into this owner\'s app', async () => {
    const out = await callTool(session, 'aimeat_app_tool_invoke', { owner: alice.owner, app: `${bob.owner}/${APP}`, tool: 'ping', input: {} });
    assert(out.isError && out.text.startsWith('APP_TOOLS_NOT_FOUND'), `expected APP_TOOLS_NOT_FOUND: ${out.text.slice(0, 300)}`);
    const path = await json(`/v1/apps/${bob.owner}/${APP}/news`, { headers: authed(bob.token) });
    assert(path.status === 404, `bob's path does not reach alice's app: ${path.status}`);
});

await test('9. Another owner\'s PATCH and DELETE by the bare name reach nothing of alice\'s', async () => {
    const p = await json(`/v1/apps/${APP}`, { method: 'PATCH', headers: authed(bob.token), body: JSON.stringify({ description: 'hijack' }) });
    assert(p.status === 404 || p.status === 403, `bob's patch is refused: ${p.status}`);
    const d = await json(`/v1/apps/${APP}`, { method: 'DELETE', headers: authed(bob.token) });
    assert(d.status === 404 || d.status === 403, `bob's delete is refused: ${d.status}`);
    const still = await json(`/v1/apps/${alice.owner}/${FILE}/news`, { headers: authed(alice.token) });
    assert(still.status === 200, `alice's app is still there: ${still.status}`);
});

await test('10. DELETE /v1/apps/<name> by the owner removes the .html app', async () => {
    const before = await json(`/v1/apps/${alice.owner}/${NEW}.html/news`, { headers: authed(alice.token) });
    assert(before.status === 200, `the .html app is there before the delete: ${before.status}`);
    const d = await json(`/v1/apps/${NEW}`, { method: 'DELETE', headers: authed(alice.token) });
    assert(d.status === 200, `delete ${d.status}: ${JSON.stringify(d.body?.error)}`);
    const gone = await json(`/v1/apps/${alice.owner}/${NEW}.html/news`, { headers: authed(alice.token) });
    assert(gone.status === 404, `the app is gone: ${gone.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
