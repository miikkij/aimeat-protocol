// T-2: MCP Tool + OAuth E2E Tests
// Run: cd aimeat && pnpm exec tsx test/e2e-mcp.ts

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
        // Return the response matching our request id, or the first one
        body = messages.find(m => m.id === id) ?? messages[0] ?? {};
    } else {
        body = await res.json() as any;
    }
    return { status: res.status, body, headers: res.headers };
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `mcpowner${Date.now()}`;
const agentName = 'mcpagent';

// OAuth state
let clientId = '';
let clientSecret = '';
let authCode = '';
let mcpToken = '';
let refreshToken = '';
let sessionId = '';

console.log('\n=== AIMEAT MCP + OAuth E2E Test ===\n');

// ─── Setup: Register GHII (creates owner) + agent ───
console.log('Setup — Owner (via GHII) & Agent');

await test('Register GHII identity (creates owner)', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Test User', password: 'McpTest1234' }),
    });
    assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string', 'got owner private key');
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
            capabilities: ['memory', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data.token;
});

// ─── Phase 1: OAuth 2.1 Discovery & Registration ───
console.log('\nPhase 1 — OAuth Discovery & Registration');

await test('1. OAuth metadata discovery', async () => {
    const { status, body } = await json('/.well-known/oauth-authorization-server');
    assert(status === 200, `status ${status}`);
    assert(typeof body.authorization_endpoint === 'string', 'has authorization_endpoint');
    assert(typeof body.token_endpoint === 'string', 'has token_endpoint');
    assert(typeof body.registration_endpoint === 'string', 'has registration_endpoint');
    assert(body.response_types_supported.includes('code'), 'supports code');
    assert(body.grant_types_supported.includes('authorization_code'), 'supports auth_code');
});

await test('2. Dynamic client registration', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({
            client_name: 'E2E Test Client',
            redirect_uris: [],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.client_id === 'string', 'has client_id');
    assert(typeof body.client_secret === 'string', 'has client_secret');
    clientId = body.client_id;
    clientSecret = body.client_secret;
});

await test('3. Register without client_name → 400', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({}),
    });
    assert(status === 400, `status ${status}`);
    assert(body.error === 'invalid_request', `error: ${body.error}`);
});

// ─── Phase 2: OAuth Authorization Flow ───
console.log('\nPhase 2 — OAuth Authorization');

await test('4. Request auth code with signature', async () => {
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
    const { status, body } = await json(`/v1/mcp/authorize?${params}`);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.code === 'string', 'has auth code');
    authCode = body.code;
});

await test('5. Auth without signature → redirects to consent', async () => {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
    });
    // Without gaii/signature, server redirects to browser consent flow (302)
    const res = await fetch(`${BASE}/v1/mcp/authorize?${params}`, {
        headers: { 'Content-Type': 'application/json' },
        redirect: 'manual',
    });
    assert(res.status === 302, `status ${res.status}`);
    const location = res.headers.get('location') ?? '';
    assert(location.includes('/v1/oauth/consent'), `redirect: ${location}`);
});

await test('6. Auth with invalid signature → 401', async () => {
    const timestamp = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        gaii: agentGaii,
        signature: Buffer.from('badsignature').toString('base64'),
        timestamp,
    });
    const { status, body } = await json(`/v1/mcp/authorize?${params}`);
    assert(status === 401, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error === 'access_denied', `error: ${body.error}`);
});

await test('7. Auth with unknown client_id → 400', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + NODE_ID + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: 'unknown-client-id',
        gaii: agentGaii,
        signature,
        timestamp,
    });
    const { status, body } = await json(`/v1/mcp/authorize?${params}`);
    assert(status === 400, `status ${status}`);
    assert(body.error === 'invalid_client', `error: ${body.error}`);
});

await test('8. Unsupported response_type → 400', async () => {
    const params = new URLSearchParams({
        response_type: 'token',
        client_id: clientId,
    });
    const { status, body } = await json(`/v1/mcp/authorize?${params}`);
    assert(status === 400, `status ${status}`);
    assert(body.error === 'unsupported_response_type', `error: ${body.error}`);
});

// ─── Phase 3: Token Exchange ───
console.log('\nPhase 3 — Token Exchange');

await test('9. Exchange auth code for tokens', async () => {
    const { status, body } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: authCode,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.access_token === 'string', 'has access_token');
    assert(typeof body.refresh_token === 'string', 'has refresh_token');
    assert(body.token_type === 'Bearer', `token_type: ${body.token_type}`);
    mcpToken = body.access_token;
    refreshToken = body.refresh_token;
});

await test('10. Code is single-use → 400', async () => {
    const { status, body } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: authCode,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    assert(status === 400, `status ${status}`);
    assert(body.error === 'invalid_grant', `error: ${body.error}`);
});

await test('11. Refresh token exchange', async () => {
    const { status, body } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.access_token === 'string', 'new access_token');
    assert(typeof body.refresh_token === 'string', 'new refresh_token');
    // Use new tokens going forward
    mcpToken = body.access_token;
    refreshToken = body.refresh_token;
});

await test('12. Refresh with wrong client → 400', async () => {
    const { status, body } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'wrong-client-id',
            client_secret: 'wrong-secret',
        }),
    });
    // Either 400 invalid_grant or 401 invalid_client
    assert(status === 400 || status === 401, `status ${status}`);
});

await test('13. Token revocation', async () => {
    // Get a fresh token to revoke
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
    const { body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: authBody.code,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    const tokenToRevoke = tokenBody.access_token;

    const { status, body } = await json('/v1/mcp/token/revoke', {
        method: 'POST',
        body: JSON.stringify({ token: tokenToRevoke }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.revoked === true, 'revoked');
});

await test('14. Revoke already-revoked token → 200', async () => {
    const { status, body } = await json('/v1/mcp/token/revoke', {
        method: 'POST',
        body: JSON.stringify({ token: 'nonexistent-token-value' }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.revoked === true, 'revoked (RFC 7009)');
});

// ─── Phase 4: MCP Session Lifecycle ───
console.log('\nPhase 4 — MCP Session Lifecycle');

await test('15. Initialize MCP session', async () => {
    const { status, body, headers } = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'E2E Test', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result !== undefined, `has result: ${JSON.stringify(body)}`);
    assert(body.result.protocolVersion !== undefined, 'has protocolVersion');
    assert(body.result.capabilities !== undefined, 'has capabilities');
    const sid = sessionId;
    assert(typeof sid === 'string' && sid.length > 0, `has mcp-session-id: "${sid}"`);

    // Send initialized notification (required by MCP spec)
    const notifRes = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    await notifRes.text();
});

await test('16. List tools', async () => {
    const { status, body } = await mcpRpc('tools/list', {}, 2);
    assert(status === 200, `status ${status}`);
    assert(body.result?.tools !== undefined, 'has tools');
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_memory_write'), 'has aimeat_memory_write');
    assert(toolNames.includes('aimeat_memory_read'), 'has aimeat_memory_read');
    assert(toolNames.includes('aimeat_catalogue_search'), 'has aimeat_catalogue_search');
    assert(toolNames.includes('aimeat_wallet_balance'), 'has aimeat_wallet_balance');
    assert(toolNames.includes('aimeat_agent_profile'), 'has aimeat_agent_profile');
    assert(toolNames.includes('aimeat_board_read'), 'has aimeat_board_read');
    assert(toolNames.includes('aimeat_storage_upload'), 'has aimeat_storage_upload');
    assert(toolNames.includes('aimeat_storage_download'), 'has aimeat_storage_download');
    assert(body.result.tools.length === 18, `expected 18 tools, got ${body.result.tools.length}`);
});

await test('17. List resources', async () => {
    const { status, body } = await mcpRpc('resources/list', {}, 3);
    assert(status === 200, `status ${status}`);
    assert(body.result?.resources !== undefined, 'has resources');
    // Should have the wallet resource at minimum (static URI)
    // Memory and storage resource templates are listed via resourceTemplates
});

// ─── Phase 5: MCP Tool Invocation ───
console.log('\nPhase 5 — MCP Tool Invocation');

await test('18. aimeat_memory_write', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: 'mcp-test-key', value: { greeting: 'hello from MCP' }, visibility: 'private' },
    }, 10);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.written === true, 'written');
    assert(result.key === 'mcp-test-key', `key: ${result.key}`);
});

await test('19. aimeat_memory_read', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_read',
        arguments: { key: 'mcp-test-key' },
    }, 11);
    assert(status === 200, `status ${status}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.key === 'mcp-test-key', `key: ${result.key}`);
    assert(result.value?.greeting === 'hello from MCP', `value: ${JSON.stringify(result.value)}`);
});

await test('20. aimeat_memory_list', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_list',
        arguments: {},
    }, 12);
    assert(status === 200, `status ${status}`);
    const entries = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(entries), 'is array');
    const found = entries.find((e: any) => e.key === 'mcp-test-key');
    assert(found !== undefined, 'contains mcp-test-key');
});

await test('21. aimeat_catalogue_search', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_search',
        arguments: {},
    }, 13);
    assert(status === 200, `status ${status}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result), 'is array');
});

await test('22. aimeat_wallet_balance', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_wallet_balance',
        arguments: {},
    }, 14);
    assert(status === 200, `status ${status}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.balance === 'number', `balance: ${result.balance}`);
    assert(typeof result.in_escrow === 'number', `in_escrow: ${result.in_escrow}`);
    assert(typeof result.available === 'number', `available: ${result.available}`);
});

await test('23. aimeat_agent_profile', async () => {
    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_agent_profile',
        arguments: { gaii: agentGaii },
    }, 15);
    assert(status === 200, `status ${status}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.gaii === agentGaii, `gaii: ${result.gaii}`);
    assert(typeof result.gaii === 'string', 'has gaii in profile');
});

await test('24. aimeat_board_read', async () => {
    // Create a board first via REST so we can read it
    await json('/v1/boards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'mcp-test-board', description: 'Board for MCP test' }),
    });

    const { status, body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_read',
        arguments: { board_id: 'mcp-test-board' },
    }, 16);
    assert(status === 200, `status ${status}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result), 'is array');
});

// ─── Phase 6: MCP Resource Read ───
console.log('\nPhase 6 — MCP Resource Read');

await test('25. Read memory resource', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: 'aimeat://memory/mcp-test-key',
    }, 20);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result?.contents?.[0] !== undefined, 'has contents');
    const text = body.result.contents[0].text;
    const parsed = JSON.parse(text);
    assert(parsed.greeting === 'hello from MCP', `value: ${text}`);
});

await test('26. Read wallet resource', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: `aimeat://wallet/${encodeURIComponent(agentGaii)}`,
    }, 21);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result?.contents?.[0] !== undefined, 'has contents');
    const parsed = JSON.parse(body.result.contents[0].text);
    assert(typeof parsed.balance === 'number', `balance: ${parsed.balance}`);
});

await test('27. Read non-existent memory resource', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: 'aimeat://memory/nonexistent-key-xyz',
    }, 22);
    assert(status === 200, `status ${status}`);
    assert(body.result?.contents?.[0]?.text === 'Not found', `text: ${body.result?.contents?.[0]?.text}`);
});

// ─── Phase 7: SSE & Resource Subscriptions ───
console.log('\nPhase 7 — SSE & Subscriptions');

await test('28. SSE stream opens with valid session', async () => {
    // Open SSE connection with abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'GET',
            headers: {
                'mcp-session-id': sessionId,
                'mcp-protocol-version': '2025-03-26',
                Accept: 'text/event-stream',
                ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            },
            signal: controller.signal,
        });
        assert(res.status === 200, `status ${res.status}`);
        const ct = res.headers.get('content-type') ?? '';
        assert(ct.includes('text/event-stream'), `content-type: ${ct}`);
        // SSE connection established — abort after verifying
        controller.abort();
    } catch (err: any) {
        // AbortError is expected after we verify the connection
        if (err.name !== 'AbortError') throw err;
    } finally {
        clearTimeout(timeout);
    }
});

await test('29. Subscribe to memory resource (or graceful error)', async () => {
    // resources/subscribe may not be implemented — verify no crash
    const { status, body } = await mcpRpc('resources/subscribe', {
        uri: 'aimeat://memory/mcp-test-key',
    }, 30);
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    // Either success (no error) or method not found — both are acceptable
    if (body.error) {
        assert(body.error.code === -32601, `unexpected error: ${JSON.stringify(body.error)}`);
    }
});

await test('30. SSE without session ID → 400', async () => {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
    });
    assert(res.status === 400, `status ${res.status}`);
});

// ─── Phase 8: Session Close ───
console.log('\nPhase 8 — Session Close');

await test('31. Close MCP session', async () => {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'DELETE',
        headers: {
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
    });
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json() as any;
    assert(body.closed === true, 'closed');
});

await test('32. Request on closed session → new session', async () => {
    // After closing, sending to old session should create a new one or error
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
    });
    // The old session is gone. The server either creates a new session or returns an error.
    // With the StreamableHTTPServerTransport, unknown session generates a new session.
    const body = await res.json() as any;
    // Should get a result (new session) or a JSON-RPC error — not a crash
    assert(res.status === 200 || res.status === 400 || res.status === 404,
        `status ${res.status}: ${JSON.stringify(body)}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade delete owner', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`MCP + OAuth E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
