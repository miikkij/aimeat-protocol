// v2 MCP purpose-scoped surfaces E2E. Verifies /v2/mcp/:role exposes exactly its surface allowlist
// (role filter), that scope-filtering still applies on top, and unknown roles 400.
// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-v2.ts

import { MCP_SURFACES } from '../src/mcp/catalog/surfaces.js';

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
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
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

await test('Setup: owner + broad-scoped agent', async () => {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'V2 Test', password: 'V2Test1234' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}`);
    const ownerKey = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerKey, ownerName + NODE_ID + ts) }) });
    const ownerToken = tk.body.data.token;
    const r = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'v2agent', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes: ['*'] }) });
    assert(r.status === 201, `agent ${r.status}: ${JSON.stringify(r.body)}`);
    agent = { gaii: r.body.data.agent.gaii, key: r.body.data.private_key };
});

// Each role's tools/list must equal exactly its surface allowlist (broad scopes → no scope trimming).
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

await test('unknown role → 400', async () => {
    const res = await json('/v2/mcp/nonsense', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert(res.status === 400, `expected 400, got ${res.status}`);
});

console.log(`\n────────────────────────────────────────`);
console.log(`v2 MCP Surfaces E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
