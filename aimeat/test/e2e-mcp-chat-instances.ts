/**
 * @file e2e-mcp-chat-instances.ts
 * @description E2E tests for MCP chat-instances module — 3 tools + 1 resource.
 *   Tests instance list, create, status, and the instances resource template.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 *   v1.1.0 — 2026-08-10 — Phase 4: both doors, one write. The tool and POST /v1/chat-instances now
 *     share services/chat-instance-write.ts, so re-registering a session behaves the same way
 *     through either, and a session opened through one is visible through the other.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-chat-instances.ts

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
const ownerName = `mcpci${Date.now()}`;
const agentName = 'mcpciagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Instance state
let instanceId = '';

console.log('\n=== AIMEAT MCP Chat Instances E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Chat Instances Test', password: 'McpCi1234' }),
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
            capabilities: ['memory'],
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
        body: JSON.stringify({ client_name: 'MCP Chat Instances Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Chat Instances E2E', version: '1.0.0' },
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

await test('1. Chat instance tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_instance_list'), 'has aimeat_instance_list');
    assert(toolNames.includes('aimeat_instance_create'), 'has aimeat_instance_create');
    assert(toolNames.includes('aimeat_instance_status'), 'has aimeat_instance_status');
});

// ─── Phase 2: Instance CRUD ───
console.log('\nPhase 2 — Instance CRUD');

await test('2. aimeat_instance_list returns an array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_list',
        arguments: {},
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const instances = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(instances), 'result is array');
});

await test('3. aimeat_instance_create registers a new instance', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_create',
        arguments: { name: 'mcp-e2e-test-app', model: 'gpt-4o' },
    }, 102);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.id === 'string', `has id: ${result.id}`);
    assert(result.name === 'mcp-e2e-test-app', `name: ${result.name}`);
    assert(typeof result.created_at === 'string', 'has created_at');
    instanceId = result.id;
});

await test('4. aimeat_instance_list includes the newly created instance', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_list',
        arguments: {},
    }, 103);
    const instances = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(instances), 'result is array');
    const found = instances.find((i: any) => i.id === instanceId);
    assert(found !== undefined, `instance ${instanceId} found in list`);
});

await test('5. aimeat_instance_status returns instance details', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_status',
        arguments: { instance_id: instanceId },
    }, 104);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.id === instanceId, `id matches: ${result.id}`);
    assert(result.app_name === 'mcp-e2e-test-app', `app_name: ${result.app_name}`);
    assert(typeof result.ghii === 'string', 'has ghii');
    assert(typeof result.created_at === 'string', 'has created_at');
});

await test('6. aimeat_instance_status returns error for unknown instance', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_status',
        arguments: { instance_id: 'nonexistent-instance-id' },
    }, 105);
    assert(body.result?.isError === true, 'returns isError for unknown instance');
});

await test('7. aimeat_instance_create is idempotent (returns existing on duplicate)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_instance_create',
        arguments: { name: 'mcp-e2e-test-app', model: 'gpt-4o' },
    }, 106);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.id === instanceId, `same id returned: ${result.id} === ${instanceId}`);
    assert(result.status === 'existing', `status should be existing, got ${result.status}`);
});

// ─── Phase 3: Resource ───
console.log('\nPhase 3 — Resource');

await test('8. Instances resource template listed in resources/templates', async () => {
    const { body } = await mcpRpc('resources/templates/list', {}, 200);
    const templates = body.result?.resourceTemplates ?? [];
    const found = templates.find((t: any) => t.uriTemplate?.includes('instances'));
    assert(found !== undefined, 'instances resource template present');
});

// ─── Phase 4: Both doors, one write ───
console.log('\nPhase 4 — Both doors, one write');

let restInstanceId = '';

await test('9. POST /v1/chat-instances registers a session', async () => {
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ platform: 'claude', app_name: 'both-doors' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.chat_instance?.app_name === 'both-doors', 'app_name matches');
    restInstanceId = body.data.chat_instance.id;
});

await test('10. Re-registering the same session returns the same instance, not a failure', async () => {
    // The id is deterministic, so a returning session asks for the row it already has. Before the
    // shared write this hit the primary key and surfaced as a 500 on HTTP while the MCP tool
    // returned the existing row.
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ platform: 'claude', app_name: 'both-doors' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.chat_instance?.id === restInstanceId, `same id: ${body.data?.chat_instance?.id} === ${restInstanceId}`);
});

await test('11. The instance the MCP tool created is listed over HTTP', async () => {
    const { body } = await json('/v1/chat-instances', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const found = (body.data?.chat_instances ?? []).find((ci: any) => ci.id === instanceId);
    assert(found !== undefined, `instance ${instanceId} listed over HTTP`);
    assert(found.app_name === 'mcp-e2e-test-app', `app_name: ${found.app_name}`);
    assert(found.is_anonymous === false, 'is_anonymous derived from the owner, not hardcoded');
    assert(found.ghii === `${ownerName}@${NODE_ID}`, `ghii: ${found.ghii}`);
});

await test('12. platform is required, whichever door asks', async () => {
    const { status, body } = await json('/v1/chat-instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ app_name: 'no-platform' }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.error?.code === 'INVALID_INPUT', `code: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
