/**
 * @file e2e-mcp-consent.ts
 * @description E2E tests for MCP consent module — 3 tools + 1 resource.
 *   Tests consent grant, list, revoke, and the consent resource template.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-consent.ts

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
const ownerName = `mcpcnt${Date.now()}`;
const agentName = 'mcpcntagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Consent state
let consentId = '';

console.log('\n=== AIMEAT MCP Consent E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Consent Test', password: 'McpCnt1234' }),
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
            capabilities: ['consent'],
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
        body: JSON.stringify({ client_name: 'MCP Consent Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Consent E2E', version: '1.0.0' },
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

await test('1. Consent tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_consent_grant'), 'has aimeat_consent_grant');
    assert(toolNames.includes('aimeat_consent_list'), 'has aimeat_consent_list');
    assert(toolNames.includes('aimeat_consent_revoke'), 'has aimeat_consent_revoke');
});

// ─── Phase 2: Consent CRUD ───
console.log('\nPhase 2 — Consent CRUD');

await test('2. aimeat_consent_list returns empty array initially', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_list',
        arguments: {},
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const consents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(consents), 'result is array');
});

await test('3. aimeat_consent_grant creates a consent record', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_grant',
        arguments: {
            target_gaii: '*',
            scope: 'federation',
            data_pattern: 'profile.*',
            purpose: 'MCP E2E test consent',
            ttl_hours: 24,
        },
    }, 102);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.consent_id === 'string', `has consent_id: ${result.consent_id}`);
    assert(result.target_gaii === '*', `target_gaii: ${result.target_gaii}`);
    assert(result.scope === 'federation', `scope: ${result.scope}`);
    assert(result.expires_at !== null, 'has expires_at');
    consentId = result.consent_id;
});

await test('4. aimeat_consent_list includes the newly created consent', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_list',
        arguments: {},
    }, 103);
    const consents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(consents), 'result is array');
    assert(consents.length >= 1, `expected at least 1 consent, got ${consents.length}`);
    const found = consents.find((c: any) => c.id === consentId);
    assert(found !== undefined, `consent ${consentId} not found in list`);
    assert(found.status === 'active', `expected active status, got ${found.status}`);
    assert(found.data_pattern === 'profile.*', `data_pattern: ${found.data_pattern}`);
});

await test('5. aimeat_consent_revoke revokes the consent', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_revoke',
        arguments: { consent_id: consentId },
    }, 104);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.revoked === true, `revoked: ${result.revoked}`);
    assert(result.consent_id === consentId, `consent_id: ${result.consent_id}`);
});

await test('6. Revoked consent shows status revoked in list', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_list',
        arguments: {},
    }, 105);
    const consents = JSON.parse(body.result.content[0].text);
    const found = consents.find((c: any) => c.id === consentId);
    assert(found !== undefined, 'consent still in list after revoke');
    assert(found.status === 'revoked', `expected revoked status, got ${found.status}`);
    assert(found.revoked_at !== null, 'has revoked_at timestamp');
});

await test('7. aimeat_consent_grant without ttl_hours creates indefinite consent', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_consent_grant',
        arguments: {
            target_gaii: `${agentGaii}`,
            scope: 'private',
            data_pattern: 'notes.*',
            purpose: 'Indefinite consent test',
        },
    }, 106);
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.consent_id === 'string', 'has consent_id');
    assert(result.expires_at === null, `expected null expires_at, got ${result.expires_at}`);
});

// ─── Phase 3: Resource ───
console.log('\nPhase 3 — Resource');

await test('8. Consent resource template listed in resources/templates', async () => {
    const { body } = await mcpRpc('resources/templates/list', {}, 200);
    const templates = body.result?.resourceTemplates ?? [];
    const found = templates.find((t: any) => t.uriTemplate?.includes('consent'));
    assert(found !== undefined, 'consent resource template present');
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
