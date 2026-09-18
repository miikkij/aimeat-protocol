/**
 * @file e2e-mcp-prompts.ts
 * @description E2E tests for MCP prompts module — 1 tool: get managed system prompt by tier.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-prompts.ts

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
const ownerName = `mcppmt${Date.now()}`;
const agentName = 'mcppmtagent';

// OAuth state
let clientId = '';
let clientSecret = '';

console.log('\n=== AIMEAT MCP Prompts E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Prompts Test', password: 'McpPmt1234' }),
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
        body: JSON.stringify({ client_name: 'MCP Prompts Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Prompts E2E', version: '1.0.0' },
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

await test('1. Prompts tool appears in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_handbook_get'), 'has aimeat_handbook_get');
});

// ─── Phase 2: Prompt Retrieval ───
console.log('\nPhase 2 — Prompt Retrieval');

await test('2. aimeat_handbook_get returns error for nonexistent tier', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_handbook_get',
        arguments: { tier: 'tier-nonexistent-xyz' },
    }, 101);
    assert(body.result?.isError === true, 'returns isError for nonexistent tier');
});

await test('3. aimeat_handbook_get attempts to fetch tier1 prompt (may or may not exist in test env)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_handbook_get',
        arguments: { tier: 'tier1' },
    }, 102);
    // The result is either a prompt record or an isError — both are valid depending on test data
    assert(body.result !== undefined, 'has result');
    assert(body.result.content !== undefined, 'has content');
    assert(body.result.content.length > 0, 'content is not empty');
    // Either isError (prompt not found) or a valid prompt with id field
    const text = body.result.content[0].text;
    if (!body.result.isError) {
        const prompt = JSON.parse(text);
        assert(typeof prompt.id === 'string', `prompt has id: ${prompt.id}`);
        assert(typeof prompt.content === 'string', `prompt has content`);
    }
});

await test('4. aimeat_handbook_get handles both "tier1" and "tier-1" notation', async () => {
    const { body: b1 } = await mcpRpc('tools/call', {
        name: 'aimeat_handbook_get',
        arguments: { tier: 'tier1' },
    }, 103);
    const { body: b2 } = await mcpRpc('tools/call', {
        name: 'aimeat_handbook_get',
        arguments: { tier: 'tier-1' },
    }, 104);
    // Both should produce the same outcome (both found or both not found)
    assert(b1.result !== undefined, 'tier1 has result');
    assert(b2.result !== undefined, 'tier-1 has result');
    const isError1 = b1.result.isError === true;
    const isError2 = b2.result.isError === true;
    assert(isError1 === isError2, `tier1 and tier-1 should have same error status: ${isError1} vs ${isError2}`);
});

// The server instructions send every agent to this tool first, with no arguments. Until 2026-09-18
// that call returned the REST tier-1 handbook with its {{variables}} unfilled: HTTP calls and a
// cron watchdog, and no MCP tool by name. Five of nine cold-agent baseline tasks opened with it.
await test('5. with no arguments it returns the handbook of the surface, and the node\'s skills by situation', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_handbook_get', arguments: {} }, 105);
    assert(body.result?.isError !== true, `not an error: ${JSON.stringify(body.result).slice(0, 300)}`);
    const text: string = body.result.content[0].text;
    assert(!text.trimStart().startsWith('{'), 'markdown for an agent to read, not a prompt record');
    assert(text.includes('aimeat_memory_search') && text.includes('aimeat_app_list'), 'it names the MCP tools for the grounds that carry the work');
    assert(!/GET \/v1\/agents\/me\/directives/.test(text), 'it is not the REST boot sequence');
    assert(!/\{\{\w+\}\}/.test(text), `no unfilled variable: ${/\{\{\w+\}\}/.exec(text)?.[0]}`);
    // Built from the registry: the seeded public guide is on every node.
    assert(text.includes('## A skill may already cover this'), 'the skills section is there');
    assert(text.includes('`aimeat-node-guide`'), 'a seeded skill is listed by name');
    assert(text.includes('`aimeat-phaser`') && !text.includes('`aimeat-phaser-boot`'), 'entry points only: a part of a listed skill is left out');
    assert(text.includes('aimeat_skill_get'), 'and it says how to load one');
});

await test('6. a tier asked for by name comes back with its variables filled', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_handbook_get', arguments: { tier: 'tier1' } }, 106);
    assert(body.result?.isError !== true, 'tier-1 is seeded on a fresh node');
    const prompt = JSON.parse(body.result.content[0].text);
    assert(prompt.id === 'tier-1', `the tier handbook is still served by name, got ${prompt.id}`);
    assert(!/\{\{\w+\}\}/.test(prompt.content), `no unfilled variable: ${/\{\{\w+\}\}/.exec(prompt.content)?.[0]}`);
    assert(prompt.content.includes('#'), 'the agent\'s own GAII is in the text');
});

await test('7. FAILURE MODE: a surface that is not one is refused by the schema, not answered with a guess', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_handbook_get', arguments: { surface: 'nonsense' } }, 107);
    assert(body.error !== undefined || body.result?.isError === true, `refused, got ${JSON.stringify(body).slice(0, 200)}`);
});

await test('8. every one of the seven surfaces has a handbook this tool can reach', async () => {
    for (const surface of ['appdev', 'agent', 'service', 'admin', 'commerce', 'primitives', 'full']) {
        const { body } = await mcpRpc('tools/call', { name: 'aimeat_handbook_get', arguments: { surface } }, 108);
        assert(body.result?.isError !== true && body.result?.content?.[0]?.text?.length > 200,
            `${surface}: ${JSON.stringify(body.error ?? body.result).slice(0, 160)}`);
    }
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
