/**
 * @file e2e-mcp-memory-extended.ts
 * @description E2E tests for MCP memory-extended module — 2 tools: full-text search and
 *   public memory cross-agent read.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-memory-extended.ts

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
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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
// Second agent for cross-agent read tests
let agent2PrivKey = '';
let agent2Gaii = '';
let mcpToken2 = '';
let sessionId2 = '';

const ownerName = `mcpmemx${Date.now()}`;
const agentName = 'mcpmemxagent';
const agent2Name = 'mcpmemxagent2';

// OAuth state
let clientId = '';
let clientSecret = '';
let clientId2 = '';
let clientSecret2 = '';

console.log('\n=== AIMEAT MCP Memory Extended E2E Test ===\n');

// ─── Setup: Register GHII + 2 agents + MCP OAuth tokens ───
console.log('Setup — Owner, Agents, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Memory Extended Test', password: 'McpMemX1234' }),
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

await test('Register agent 1', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('Register agent 2', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agent2Name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agent2Gaii = body.data.agent.gaii;
    agent2PrivKey = body.data.private_key;
});

await test('OAuth for agent 1', async () => {
    const { status: regStatus, body: regBody } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP MemExt Test Client 1', redirect_uris: [] }),
    });
    assert(regStatus === 201, `register status ${regStatus}`);
    clientId = regBody.client_id;
    clientSecret = regBody.client_secret;

    const timestamp = new Date().toISOString();
    const message = agentGaii + NODE_ID + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii: agentGaii, signature, timestamp });
    const { body: authBody } = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authBody.code === 'string', 'has auth code');

    const { status, body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: authBody.code, client_id: clientId, client_secret: clientSecret }),
    });
    assert(status === 200, `token status ${status}`);
    mcpToken = tokenBody.access_token;
});

await test('OAuth for agent 2', async () => {
    const { status: regStatus, body: regBody } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP MemExt Test Client 2', redirect_uris: [] }),
    });
    assert(regStatus === 201, `register status ${regStatus}`);
    clientId2 = regBody.client_id;
    clientSecret2 = regBody.client_secret;

    const timestamp = new Date().toISOString();
    const message = agent2Gaii + NODE_ID + timestamp;
    const signature = await signMsg(agent2PrivKey, message);
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId2, gaii: agent2Gaii, signature, timestamp });
    const { body: authBody } = await json(`/v1/mcp/authorize?${params}`);

    const { status, body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: authBody.code, client_id: clientId2, client_secret: clientSecret2 }),
    });
    assert(status === 200, `token2 status ${status}`);
    mcpToken2 = tokenBody.access_token;
});

await test('Initialize MCP session for agent 1', async () => {
    const { status, body } = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'MCP MemExt E2E', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}`);
    assert(body.result !== undefined, 'has result');
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mcpToken}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

// Initialize a separate MCP session for agent 2
await test('Initialize MCP session for agent 2', async () => {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mcpToken2}`, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'MCP MemExt E2E Agent2', version: '1.0.0' } } }),
    });
    const sid2 = res.headers.get('mcp-session-id');
    if (sid2) sessionId2 = sid2;
    assert(res.status === 200, `status ${res.status}`);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mcpToken2}`, 'mcp-session-id': sessionId2, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

// Helper: MCP call as agent 2
async function mcpRpc2(method: string, params: Record<string, any> = {}, id: number = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken2}`,
            'mcp-session-id': sessionId2,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const ct = res.headers.get('content-type') ?? '';
    let body: any;
    if (ct.includes('text/event-stream')) {
        const text = await res.text();
        const msgs = text.split('\n\n').flatMap(evt => {
            const lines = evt.trim().split('\n');
            let data = '';
            for (const l of lines) { if (l.startsWith('data: ')) data += l.slice(6); }
            if (!data) return [];
            try { return [JSON.parse(data)]; } catch { return []; }
        });
        body = msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
    } else {
        body = await res.json() as any;
    }
    return { status: res.status, body };
}

// ─── Phase 1: Tool Registration ───
console.log('\nPhase 1 — Tool Registration');

await test('1. Memory extended tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_memory_search'), 'has aimeat_memory_search');
    assert(toolNames.includes('aimeat_memory_read_public'), 'has aimeat_memory_read_public');
});

// ─── Phase 2: Write some memory via core tool (setup) ───
console.log('\nPhase 2 — Memory search');

await test('2. Write private memory entry for search test', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: 'search.test.private', value: { content: 'searchable private content alpha' }, visibility: 'private' },
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.key === 'search.test.private', `key: ${result.key}`);
});

await test('3. Write public memory entry for search test', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: 'search.test.public', value: { content: 'searchable public content beta' }, visibility: 'public' },
    }, 102);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.key === 'search.test.public', `key: ${result.key}`);
});

await test('4. aimeat_memory_search finds entries by query', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'searchable' },
    }, 103);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const results = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(results), 'result is array');
    assert(results.length >= 2, `expected at least 2 results, got ${results.length}`);
});

await test('5. aimeat_memory_search with visibility filter', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'searchable', visibility: 'public' },
    }, 104);
    const results = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(results), 'result is array');
    for (const r of results) {
        assert(r.visibility === 'public', `all results should be public, got: ${r.visibility}`);
    }
});

await test('6. aimeat_memory_search with no match returns empty array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'xyzzy-no-match-unique-12345' },
    }, 105);
    const results = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(results), 'result is array');
    assert(results.length === 0, `expected 0 results, got ${results.length}`);
});

// ─── Phase 3: Cross-agent public memory read ───
console.log('\nPhase 3 — Cross-agent public memory read');

await test('7. aimeat_memory_read_public reads public entry from agent 1 (as agent 2)', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_memory_read_public',
        arguments: { gaii: agentGaii, key: 'search.test.public' },
    }, 200);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.key === 'search.test.public', `key: ${result.key}`);
    assert(result.visibility === 'public', `visibility: ${result.visibility}`);
});

await test('8. aimeat_memory_read_public denies access to private entry', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_memory_read_public',
        arguments: { gaii: agentGaii, key: 'search.test.private' },
    }, 201);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    assert(body.result.isError === true, 'should be error');
    const text = body.result.content[0].text;
    assert(text.includes('Access denied') || text.includes('not public'), `error message: ${text}`);
});

await test('9. aimeat_memory_read_public returns error for non-existent key', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_memory_read_public',
        arguments: { gaii: agentGaii, key: 'no.such.key.xyzzy' },
    }, 202);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    assert(body.result.isError === true, 'should be error');
    const text = body.result.content[0].text;
    assert(text.includes('not found') || text.includes('not found'), `error message: ${text}`);
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
