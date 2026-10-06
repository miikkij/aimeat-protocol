/**
 * @file test/e2e-app-tools-key.ts
 * @description A tool published over MCP for an app shows in both app catalogues and can be called.
 *
 *   WHY THIS SUITE EXISTS. aimeat_app_tools_publish wrote `apps.{app_id}.tools` with whatever id it
 *   was given, while the old catalogue (/app-catalog.html) and appcat (/v1/appcat) read the owner's
 *   own `apps.{filename}.tools`. On aimeat.io, kkk published the tools of `ai-slop-detector.html` as
 *   `ai-slop-detector`, and no catalogue showed them. The key is now decided once, in the shared
 *   memory write (services/app-tools-key.ts), so every door lands the manifest under the filename.
 *
 *   WHAT A CATALOGUE READS. Both pages read `GET /v1/memory/apps.{filename}.tools` as the owner
 *   (public/views/appcat/sections/tools-manifest.js, src/static/app-catalog/). That exact read is
 *   what this suite asserts, together with the call through aimeat_app_tool_invoke.
 * @structure
 *   - Phase 1: fixtures (the seller, who is the operator on the runner's empty database, an extension
 *     whose action the tool calls, the published app, the aggregate that registers the action)
 *   - Phase 2: the happy path (publish without the extension, both catalogue reads, the call)
 *   - Phase 3: the other doors and the refusals (REST, an id that names no app, another owner)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-tools-key
 * @version-history
 *   v1.0.1 — 2026-10-06 — The seller's agent holds memory:write, which aimeat_app_tools_publish asks
 *     since the secaudit 2026-10 follow-up (A4).
 *   v1.0.0 — 2026-09-27 — Initial (wish-tools-for-sale-published-over-mcp-do-not-show-in-the-app-cat).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
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
            body: JSON.stringify({ username: owner, display_name: owner, password: 'ToolsKeyTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `tk${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
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

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

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
        clientInfo: { name: 'e2e-app-tools-key', version: '1.0.0' },
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

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: an app tool manifest lives under the app filename ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const EXT = `tkext${STAMP}`;
const APP = `tkapp${STAMP}`;
const FILE = `${APP}.html`;
const IN_SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };
const OUT_SCHEMA = { type: 'object', properties: { echo: {}, caller: { type: 'string' } } };
const TOOL = { name: 'audit', description: 'Echoes what it was given', action_id: `ext:${EXT}:echo`, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 5 } };

const extManifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'app tools key e2e', author: 'e2e' },
    actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo', input: IN_SCHEMA, output: OUT_SCHEMA }],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 5000, max_api_calls: 1 },
}, null, 2);
const SCRIPTS = { echo: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }' };

// The first owner on the runner's emptied database is the operator, who may run the aggregate.
const seller = await makeOwner('tksell');
const other = await makeOwner('tkother');
// memory:write: aimeat_app_tools_publish asks it beside commerce:sell since the secaudit 2026-10
// follow-up (A4), the word the route it runs on asks.
const sellerAgent = await makeAgent(seller, ['commerce:sell', 'exchange:read', 'exchange:write', 'memory:read', 'memory:write']);
const session = await openSession(sellerAgent);

console.log('\nPhase 1 — fixtures');

await test('1. The seller installs an extension, publishes the app, and the action is registered', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: authed(seller.token), body: JSON.stringify({ manifest: extManifest, scripts: SCRIPTS }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: authed(seller.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: authed(seller.token), body: JSON.stringify({
            filename: FILE, content: Buffer.from('<!doctype html><title>Key</title><h1>key</h1>').toString('base64'),
            mime_type: 'text/html', name: 'Tools key app', description: 'An app whose tools are for sale', version: '1.0.0', category: 'tools', tags: [],
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: authed(seller.token) });
    assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)}`);
});

console.log('\nPhase 2 — published over MCP without the extension, shown and callable');

await test('2. aimeat_app_tools_publish with the app named without ".html" answers with the filename', async () => {
    const out = await callTool(session, 'aimeat_app_tools_publish', { app_id: APP, tools: [TOOL] });
    assert(!out.isError, `publish refused: ${out.text.slice(0, 300)}`);
    assert(out.data.app === `${seller.owner}/${FILE}`, `the answer names the app filename: ${out.text.slice(0, 300)}`);
    assert(out.data.tools?.[0]?.sku === `app-tool:${seller.owner}/${FILE}:audit`, `the sku names the filename: ${out.text.slice(0, 300)}`);
});

await test('3. The catalogues\' own read, GET /v1/memory/apps.{filename}.tools, returns the tool', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`apps.${FILE}.tools`)}`, { headers: authed(seller.token) });
    assert(r.status === 200, `catalogue read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const value = r.body.data.value ?? r.body.data.record?.value;
    assert(value?.tools?.[0]?.name === 'audit', `the manifest holds the tool: ${JSON.stringify(value).slice(0, 200)}`);
    const stray = await json(`/v1/memory/${encodeURIComponent(`apps.${APP}.tools`)}`, { headers: authed(seller.token) });
    assert(stray.status === 404, `nothing is left under the name without the extension: ${stray.status}`);
});

await test('4. …and a visitor reads the same public manifest by the owner\'s GHII', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(`${seller.owner}@${NODE_ID}`)}/${encodeURIComponent(`apps.${FILE}.tools`)}`, { headers: authed(other.token) });
    assert(r.status === 200, `public read ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('5. aimeat_app_tool_invoke calls the tool by the app filename and gets its answer', async () => {
    const out = await callTool(session, 'aimeat_app_tool_invoke', { owner: seller.owner, app: FILE, tool: 'audit', input: { q: 'hello' } });
    assert(!out.isError, `invoke refused: ${out.text.slice(0, 300)}`);
    assert(out.text.includes('hello'), `the action's echo comes back: ${out.text.slice(0, 300)}`);
});

console.log('\nPhase 3 — the other doors and the refusals');

await test('6. POST /v1/memory (the connector and CLI road) lands a nameless-extension key on the filename too', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authed(seller.token),
        body: JSON.stringify({ key: `apps.${APP}.tools`, visibility: 'public', tags: ['commerce', 'app-tools'], value: { version: 1, tools: [TOOL, { ...TOOL, name: 'audit2' }] } }),
    });
    assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    assert(w.body.data.key === `apps.${FILE}.tools`, `the answer names the stored key: ${w.body.data.key}`);
    const r = await json(`/v1/memory/${encodeURIComponent(`apps.${FILE}.tools`)}`, { headers: authed(seller.token) });
    assert((r.body.data.value ?? r.body.data.record?.value)?.tools?.length === 2, 'the catalogue read sees the rewrite');
});

await test('7. An id that names no app of the owner stays as given (a manifest may come before its app)', async () => {
    const out = await callTool(session, 'aimeat_app_tools_publish', { app_id: `noapp${STAMP}`, tools: [TOOL] });
    assert(!out.isError, `publish refused: ${out.text.slice(0, 300)}`);
    assert(out.data.app === `${seller.owner}/noapp${STAMP}`, `the id is kept: ${out.text.slice(0, 200)}`);
});

await test('8. Invoking by the name without the extension is refused and names the filename to use', async () => {
    const out = await callTool(session, 'aimeat_app_tool_invoke', { owner: seller.owner, app: APP, tool: 'audit', input: { q: 'x' } });
    assert(out.isError && out.text.startsWith('APP_TOOLS_NOT_FOUND'), `expected APP_TOOLS_NOT_FOUND: ${out.text.slice(0, 300)}`);
    assert(out.text.includes(FILE), `the refusal names ${FILE}: ${out.text.slice(0, 300)}`);
});

await test('9. Another owner writing the same name lands in their own namespace, never under the seller\'s app', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authed(other.token),
        body: JSON.stringify({ key: `apps.${APP}.tools`, visibility: 'public', value: { version: 1, tools: [{ name: 'hijack' }] } }),
    });
    assert(w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    assert(w.body.data.key === `apps.${APP}.tools` && w.body.data.owner_gaii === `${other.owner}@${NODE_ID}`,
        `kept as given, in their own namespace: ${JSON.stringify(w.body.data).slice(0, 200)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(`apps.${FILE}.tools`)}`, { headers: authed(seller.token) });
    const names = ((r.body.data.value ?? r.body.data.record?.value)?.tools ?? []).map((t: { name: string }) => t.name);
    assert(!names.includes('hijack'), `the seller's manifest is untouched: ${JSON.stringify(names)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
