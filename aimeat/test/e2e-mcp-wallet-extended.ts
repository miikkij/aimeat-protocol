/**
 * @file e2e-mcp-wallet-extended.ts
 * @description E2E tests for MCP wallet-extended module — 1 tool: transaction history.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-wallet-extended.ts

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
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// Parse SSE text into JSON-RPC messages
function parseSSE(text: string): any[] {
    const messages: any[] = [];
    const events = text.split('\n\n');
    for (const evt of events) {
        const lines = evt.trim().split('\n');
        let data = '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                data += line.slice(6);
            }
        }
        if (data) {
            try { messages.push(JSON.parse(data)); } catch { /* skip */ }
        }
    }
    return messages;
}

// JSON-RPC helper for MCP calls
let mcpToken = '';
let sessionId = '';

async function mcpRpc(method: string, params: Record<string, any> = {}, id: number = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const ct = res.headers.get('content-type') ?? '';
    let body: any;
    if (ct.includes('text/event-stream')) {
        const text = await res.text();
        const messages = parseSSE(text);
        body = messages.find(m => m.id === id) ?? messages[0] ?? {};
    } else {
        body = await res.json() as any;
    }
    return { status: res.status, body, headers: res.headers };
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `mcpwltx${Date.now()}`;
const agentName = 'mcpwltxagent';

// OAuth state
let clientId = '';
let clientSecret = '';

console.log('\n=== AIMEAT MCP Wallet Extended E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Wallet Extended Test', password: 'McpWlt1234' }),
    });
    assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['wallet'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('OAuth client registration', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP Wallet Extended Test Client', redirect_uris: [] }),
    });
    assert(status === 201, `status ${status}`);
    clientId = body.client_id;
    clientSecret = body.client_secret;
});

await test('OAuth authorize + token exchange', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + NODE_ID + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        gaii: agentGaii,
        signature,
        timestamp,
    });
    const { body: authBody } = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authBody.code === 'string', 'has auth code');

    const { status, body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: authBody.code,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    assert(status === 200, `token status ${status}`);
    mcpToken = tokenBody.access_token;
});

await test('Initialize MCP session', async () => {
    const { status, body } = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'MCP Wallet Extended E2E', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result !== undefined, 'has result');

    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken}`,
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

// ─── Phase 1: Tool Registration ───
console.log('\nPhase 1 — Tool Registration');

await test('1. Wallet extended tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_wallet_transactions'), 'has aimeat_wallet_transactions');
});

// ─── Phase 2: Transaction History ───
console.log('\nPhase 2 — Transaction History');

await test('2. aimeat_wallet_transactions returns an array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_wallet_transactions',
        arguments: {},
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const txs = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(txs), 'result is array');
});

await test('3. aimeat_wallet_transactions includes welcome_bonus from GHII creation', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_wallet_transactions',
        arguments: {},
    }, 102);
    const txs = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(txs), 'result is array');
    // GHII creation should produce a welcome_bonus transaction
    const bonus = txs.find((tx: any) => tx.type === 'welcome_bonus');
    assert(bonus !== undefined, 'should have a welcome_bonus transaction');
    assert(typeof bonus.amount === 'number', `bonus amount should be number, got: ${typeof bonus.amount}`);
    assert(bonus.amount > 0, `bonus amount should be positive, got: ${bonus.amount}`);
});

await test('4. aimeat_wallet_transactions respects limit parameter', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_wallet_transactions',
        arguments: { limit: 1 },
    }, 103);
    const txs = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(txs), 'result is array');
    assert(txs.length <= 1, `expected at most 1 transaction, got ${txs.length}`);
});

await test('5. aimeat_wallet_transactions transaction shape has required fields', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_wallet_transactions',
        arguments: {},
    }, 104);
    const txs = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(txs) && txs.length > 0, 'should have at least one transaction');
    const tx = txs[0];
    assert(typeof tx.id === 'string', `tx.id should be string, got: ${typeof tx.id}`);
    assert(typeof tx.type === 'string', `tx.type should be string, got: ${typeof tx.type}`);
    assert(typeof tx.amount === 'number', `tx.amount should be number, got: ${typeof tx.amount}`);
    assert(typeof tx.timestamp === 'string', `tx.timestamp should be string, got: ${typeof tx.timestamp}`);
});

// ─── The other half of "scope-gated": an agent that was NOT given the word ───
//
// Test 1 asserts the tool IS present for an agent registered with the `wallet` capability, and no
// agent without it is ever built here. The handler in src/mcp/wallet-extended.ts does no scope check
// of its own — it goes straight to storage.getTransactions, unlike its HTTP twin GET
// /v1/wallet/transactions which carries requireScope('wallet:read') — so the registration filter is
// the ENTIRE gate. Delete the `aimeat_wallet_transactions: 'wallet:read'` entry from
// mcp/catalog/scopes.ts and every agent the owner ever connected reads the whole morsel ledger:
// counterparties, tracking codes, amounts. All eleven tests stay green.
await test('12. An agent WITHOUT wallet:read neither sees the tool nor can call it', async () => {
    const reg = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'mcpwltxnarrow', owner: ownerName,
            capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'],
        }),
    });
    assert(reg.status === 201, `narrow agent ${reg.status}: ${JSON.stringify(reg.body)}`);
    const narrowGaii = reg.body.data.agent.gaii as string;
    const narrowKey = reg.body.data.private_key as string;

    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'narrow', redirect_uris: [] }) });
    const ts = new Date().toISOString();
    const sig = await signMsg(narrowKey, narrowGaii + NODE_ID + ts);
    const authz = await json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.body.client_id, gaii: narrowGaii, signature: sig, timestamp: ts })}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }),
    });
    const narrowToken = tok.body.access_token as string;
    assert(typeof narrowToken === 'string', `narrow mcp token: ${JSON.stringify(tok.body)}`);

    // Its own session, so the tool list is the one this agent was served.
    let narrowSession = '';
    const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${narrowToken}`,
                ...(narrowSession ? { 'mcp-session-id': narrowSession, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) narrowSession = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find((m: any) => m.id === id) ?? {})
            : await res.json() as any;
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'narrow', version: '1.0.0' } }, 200);

    const list = await rpc('tools/list', {}, 201);
    const names = (list.result?.tools ?? []).map((t: any) => t.name);
    assert(names.length > 0, 'the narrow agent was served a tool surface at all');
    assert(!names.includes('aimeat_wallet_transactions'),
        'an agent without wallet:read was handed the owner\'s ledger tool');

    // Absence from the list is the registration filter. A client that already knows the name does not
    // read the list, so the call has to fail too — and this handler has no check of its own.
    const call = await rpc('tools/call', { name: 'aimeat_wallet_transactions', arguments: {} }, 202);
    assert(call.error !== undefined || call.result?.isError === true,
        `the narrow agent CALLED the ledger tool: ${JSON.stringify(call).slice(0, 200)}`);
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
