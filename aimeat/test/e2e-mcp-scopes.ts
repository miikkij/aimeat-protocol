// MCP audit Phase 3 (F1): scope enforcement on the /v1/mcp tool surface.
// Verifies a narrow-scoped agent only sees/can-call the tools its scopes allow, while a
// broad ('*') agent sees the full surface. Run: cd aimeat && pnpm exec tsx test/e2e-mcp-scopes.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ } }
    }
    return out;
}

interface McpClient {
    list(): Promise<string[]>;
    call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }>;
}

/** Full OAuth PATH A (agent signature) + MCP session init for one agent. Returns a tool client. */
async function connectMcp(gaii: string, privKey: string): Promise<McpClient> {
    // 1. Register an OAuth client
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'scope-e2e' }) });
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;

    // 2. Authorize via agent signature (PATH A): message = gaii + nodeId + timestamp
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const authQs = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp });
    const auth = await json(`/v1/mcp/authorize?${authQs}`);
    const code = auth.body.code as string;
    assert(typeof code === 'string', `authorize returned code (${JSON.stringify(auth.body)})`);

    // 3. Exchange for an access token
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret }),
    });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange (${JSON.stringify(tok.body)})`);

    let sessionId = '';
    async function rpc(method: string, params: Record<string, unknown>, id: number) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json();
        return { status: res.status, body };
    }

    // 4. Initialize the session + send the initialized notification
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'scope-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    return {
        async list() {
            const { body } = await rpc('tools/list', {}, 2);
            return (body.result?.tools ?? []).map((t: any) => t.name);
        },
        async call(name, args) {
            const { body } = await rpc('tools/call', { name, arguments: args }, 3);
            const ok = body.error === undefined && body.result?.isError !== true;
            return { ok, body };
        },
    };
}

console.log('\n=== AIMEAT MCP Scope Enforcement E2E (F1) ===\n');

const ownerName = `scopeowner${Date.now()}`;
let ownerToken = '';
let narrow: { gaii: string; key: string } = { gaii: '', key: '' };
let broad: { gaii: string; key: string } = { gaii: '', key: '' };

await test('Setup: register owner + narrow and broad agents', async () => {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Scope Test', password: 'ScopeTest1234' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const ownerKey = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(ownerKey, ownerName + NODE_ID + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
    ownerToken = tk.body.data.token;

    const mkAgent = async (name: string, scopes: string[]) => {
        const r = await json('/v1/agents', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
        });
        assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
        return { gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
    };
    narrow = await mkAgent('narrowagent', ['memory:read']);
    broad = await mkAgent('broadagent', ['*']);
});

await test('Narrow agent (memory:read) sees only scope-allowed + ungated tools', async () => {
    const client = await connectMcp(narrow.gaii, narrow.key);
    const tools = await client.list();
    // Allowed: memory:read tool + ungated tools
    assert(tools.includes('aimeat_memory_read'), 'has aimeat_memory_read (memory:read)');
    assert(tools.includes('aimeat_catalogue_search'), 'has aimeat_catalogue_search (ungated)');
    assert(tools.includes('aimeat_board_read'), 'has aimeat_board_read (ungated public)');
    assert(tools.includes('aimeat_task_list'), 'has aimeat_task_list (ungated)');
    // Filtered: requires scopes the narrow agent lacks
    assert(!tools.includes('aimeat_memory_write'), 'memory_write FILTERED (needs memory:write)');
    assert(!tools.includes('aimeat_wallet_balance'), 'wallet_balance FILTERED (needs wallet:read)');
    assert(!tools.includes('aimeat_board_post'), 'board_post FILTERED (needs social:write)');
    assert(!tools.includes('aimeat_work_inbox'), 'work_inbox FILTERED (needs work:read)');
    assert(!tools.includes('aimeat_consent_grant'), 'consent_grant FILTERED (needs consent:manage)');
});

await test('Narrow agent cannot call a filtered tool (memory_write)', async () => {
    const client = await connectMcp(narrow.gaii, narrow.key);
    const { ok } = await client.call('aimeat_memory_write', { key: 'x', value: 'y' });
    assert(!ok, 'calling filtered aimeat_memory_write must not succeed');
    // And the write must not have happened (read it back via an allowed tool)
    const back = await client.call('aimeat_memory_read', { key: 'x' });
    const text = back.body.result?.content?.[0]?.text ?? '';
    assert(!text.includes('"value": "y"') && !text.includes('"value":"y"'), 'filtered write must not persist');
});

await test('Broad agent (*) sees the full tool surface', async () => {
    const client = await connectMcp(broad.gaii, broad.key);
    const tools = await client.list();
    assert(tools.includes('aimeat_memory_write'), 'has memory_write');
    assert(tools.includes('aimeat_wallet_balance'), 'has wallet_balance');
    assert(tools.includes('aimeat_board_post'), 'has board_post');
    assert(tools.includes('aimeat_consent_grant'), 'has consent_grant');
});

console.log(`\n────────────────────────────────────────`);
console.log(`MCP Scope Enforcement E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
