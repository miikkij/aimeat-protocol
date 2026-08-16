// v2 MCP purpose-scoped surfaces E2E. Verifies /v2/mcp/:role exposes exactly its surface allowlist
// (role filter), that scope-filtering still applies on top, and unknown roles 400.
//
// 2026-08-16 (August 2026 test-quality audit, e2e-mcp-v2:92): the header claimed the scope half was
// covered, but the only agent in the file held '*' plus every word outside the wildcard, so
// scopeAllowsTool was never allowed to remove anything on a /v2 surface. A second agent holding only
// memory:read now lists the same surface and must get a STRICT SUBSET of it — no memory_write, its
// reading tools intact, nothing off-surface — while the broad agent still has the write tools.
// Measured with the gate returning the surface membership directly instead of falling through to the
// scope check: the narrow agent is handed all 148 tools of the agent surface, and e2e-mcp-scopes
// stays green — that suite only drives /v1/mcp, where role is 'all' and there is no surface list to
// short-circuit on.
// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-v2.ts

import { MCP_SURFACES } from '../src/mcp/catalog/surfaces.js';
import { NOT_IN_WILDCARD } from '../public/views/profile/agents/scope-model.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* */ } }
    return out;
}

/** OAuth PATH A (shared /v1/mcp/* endpoints) + session init at /v2/mcp/:role. Returns tools/list. */
async function listToolsForRole(gaii: string, privKey: string, role: string): Promise<string[]> {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: `v2-${role}` }) });
    const clientId = reg.body.client_id, clientSecret = reg.body.client_secret;
    const ts = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + ts);
    const auth = await json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp: ts })}`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: clientId, client_secret: clientSecret }) });
    const token = tok.body.access_token as string;

    let sessionId = '';
    const path = `/v2/mcp/${role}`;
    async function rpc(method: string, params: Record<string, unknown>, id: number) {
        const res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id'); if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
        return { status: res.status, body };
    }
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'v2-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const { body } = await rpc('tools/list', {}, 2);
    return (body.result?.tools ?? []).map((t: any) => t.name);
}

console.log('\n=== AIMEAT v2 MCP Surfaces E2E ===\n');

const ownerName = `v2owner${Date.now()}`;
let agent = { gaii: '', key: '' };
let ownerKeyForTests = '';

await test('Setup: owner + broad-scoped agent', async () => {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'V2 Test', password: 'V2Test1234' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}`);
    const ownerKey = ghii.body.data.private_key as string;
    ownerKeyForTests = ownerKey;
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerKey, ownerName + NODE_ID + ts) }) });
    const ownerToken = tk.body.data.token;
    const r = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'v2agent', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes: ['*', ...NOT_IN_WILDCARD] }) });
    assert(r.status === 201, `agent ${r.status}: ${JSON.stringify(r.body)}`);
    agent = { gaii: r.body.data.agent.gaii, key: r.body.data.private_key };
});

// Each role's tools/list must equal exactly its surface allowlist (broad scopes → no scope trimming).
// The scope list is '*' PLUS every word no wildcard carries (utils/scope-coverage.ts, mirrored in
// scope-model.js): '*' is the one-click Full access template, and these are the calls the web door
// reserves to a logged-in person — the AI budget, the payout account, the sharing groups. Without
// the explicit grants those tools are correctly absent, and this test would be measuring the
// exception rather than the surface. Read from the list rather than named, so a new word does not
// quietly shrink what this asserts.
for (const role of ['appdev', 'agent', 'service', 'admin'] as const) {
    await test(`/v2/mcp/${role} exposes exactly its surface (${MCP_SURFACES[role].length} tools)`, async () => {
        const got = new Set(await listToolsForRole(agent.gaii, agent.key, role));
        const want = new Set(MCP_SURFACES[role]);
        const missing = [...want].filter(t => !got.has(t));
        const extra = [...got].filter(t => !want.has(t));
        assert(missing.length === 0, `missing from ${role}: ${missing.join(', ')}`);
        assert(extra.length === 0, `unexpected in ${role}: ${extra.join(', ')}`);
    });
}

// The surface allowlist is one half of the gate; the agent's own scopes are the other. Every session
// above belongs to an agent holding '*' plus every word outside it, so scopeAllowsTool has never been
// allowed to remove anything on a /v2 surface. A narrow agent is the only way to see that half.
let narrow = { gaii: '', key: '' };

await test('Setup: a second agent holding only memory:read', async () => {
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerKeyForTests, ownerName + NODE_ID + ts) }) });
    const r = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${tk.body.data.token}` },
        body: JSON.stringify({ name: 'v2narrow', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'] }),
    });
    assert(r.status === 201, `narrow agent ${r.status}: ${JSON.stringify(r.body)}`);
    narrow = { gaii: r.body.data.agent.gaii, key: r.body.data.private_key };
});

await test('A memory:read agent gets a STRICT SUBSET of the agent surface — no write tools', async () => {
    const got = new Set(await listToolsForRole(narrow.gaii, narrow.key, 'agent'));
    const surface = new Set(MCP_SURFACES.agent);

    // Everything it does get must still be on the surface allowlist: scopes narrow, never widen.
    const offSurface = [...got].filter(t => !surface.has(t));
    assert(offSurface.length === 0, `scopes must not add tools outside the surface: ${offSurface.join(', ')}`);
    assert(got.size < surface.size, `a memory:read agent must see fewer than the ${surface.size} tools of the full surface, saw ${got.size}`);

    // The write tools of this surface are exactly what memory:read does not buy.
    assert(!got.has('aimeat_memory_write'), 'memory_write must be absent for a memory:read agent');
    assert(got.has('aimeat_memory_read') || got.has('aimeat_memory_list'),
        `…while its reading tools remain: ${[...got].slice(0, 8).join(', ')}`);

    // And the broad agent still has them, so the difference is the scope list and not the surface.
    const broad = new Set(await listToolsForRole(agent.gaii, agent.key, 'agent'));
    assert(broad.has('aimeat_memory_write'), 'the broad agent must still hold memory_write');
});

await test('cross-surface isolation: agent has no marketplace/admin; appdev no memory; instance_* nowhere', async () => {
    const agentTools = new Set(await listToolsForRole(agent.gaii, agent.key, 'agent'));
    assert(!agentTools.has('aimeat_board_post'), 'agent must not have board_post');
    assert(!agentTools.has('aimeat_wallet_balance'), 'agent must not have wallet_balance');
    assert(!agentTools.has('aimeat_admin_mint'), 'agent must not have admin_mint');
    assert(!agentTools.has('aimeat_instance_create'), 'instance_* must be absent from v2');
    const appdevTools = new Set(await listToolsForRole(agent.gaii, agent.key, 'appdev'));
    assert(appdevTools.has('aimeat_app_publish'), 'appdev must have app_publish');
    assert(!appdevTools.has('aimeat_memory_write'), 'appdev must not have memory_write');
});

await test("handbook_get surface:'agent' returns the agent surface handbook", async () => {
    // Reuse the agent surface session path: register/authorize/token then call the tool.
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'v2-hb' }) });
    const ts = new Date().toISOString();
    const sig = await signMsg(agent.key, agent.gaii + NODE_ID + ts);
    const auth = await json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii: agent.gaii, signature: sig, timestamp: ts })}`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }) });
    const token = tok.body.access_token as string;
    let sid = '';
    const call = async (method: string, params: Record<string, unknown>, id: number) => {
        const res = await fetch(`${BASE}/v2/mcp/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
        const s = res.headers.get('mcp-session-id'); if (s) sid = s;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
    };
    await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'v2-hb', version: '1.0.0' } }, 1);
    const body = await call('tools/call', { name: 'aimeat_handbook_get', arguments: { surface: 'agent' } }, 2);
    const text = body.result?.content?.[0]?.text ?? '';
    assert(text.includes('Agent Surface Handbook'), `expected agent handbook, got: ${text.slice(0, 80)}`);
});

await test('unknown role → 400', async () => {
    const res = await json('/v2/mcp/nonsense', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert(res.status === 400, `expected 400, got ${res.status}`);
});

console.log(`\n────────────────────────────────────────`);
console.log(`v2 MCP Surfaces E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
