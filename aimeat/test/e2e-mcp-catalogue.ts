/**
 * @file e2e-mcp-catalogue.ts
 * @description E2E tests for MCP catalogue module — 3 tools: agent directory, public boards, people directory.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-catalogue.ts

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
const ownerName = `mcpcat${Date.now()}`;
const agentName = 'mcpcatagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Board state
let publicBoardId = '';

console.log('\n=== AIMEAT MCP Catalogue E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Catalogue Test', password: 'McpCat1234' }),
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
            capabilities: ['catalogue', 'discovery'],
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
        body: JSON.stringify({ client_name: 'MCP Catalogue Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Catalogue E2E', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result !== undefined, 'has result');

    // Send initialized notification
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

await test('1. Catalogue tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_catalogue_agents'), 'has aimeat_catalogue_agents');
    assert(toolNames.includes('aimeat_catalogue_boards'), 'has aimeat_catalogue_boards');
    assert(toolNames.includes('aimeat_catalogue_directory'), 'has aimeat_catalogue_directory');
});

// ─── Phase 2: Agent Directory ───
console.log('\nPhase 2 — Agent Directory');

await test('2. aimeat_catalogue_agents returns an array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_agents',
        arguments: {},
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const agents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(agents), 'result is array');
});

await test('3. aimeat_catalogue_agents finds the test agent by name', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_agents',
        arguments: { search: agentName },
    }, 102);
    const agents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(agents), 'result is array');
    const found = agents.find((a: any) => a.gaii === agentGaii);
    assert(found !== undefined, `agent ${agentGaii} should appear in search results`);
});

await test('4. aimeat_catalogue_agents filters by category', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_agents',
        arguments: { category: 'catalogue' },
    }, 103);
    const agents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(agents), 'result is array');
    const found = agents.find((a: any) => a.gaii === agentGaii);
    assert(found !== undefined, 'agent with "catalogue" capability appears in category filter');
});

await test('5. aimeat_catalogue_agents with no match returns empty array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_agents',
        arguments: { search: 'xyzzy-no-match-12345' },
    }, 104);
    const agents = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(agents), 'result is array');
    assert(agents.length === 0, `expected 0 results, got ${agents.length}`);
});

// ─── Phase 3: Public Boards ───
console.log('\nPhase 3 — Public Boards');

await test('6. Create a public board for testing', async () => {
    // First owner is operator, so can create public boards
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: 'catalogue-public-board', visibility: 'public', description: 'Public board for catalogue test' },
    }, 200);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.id === 'string', 'has id');
    publicBoardId = result.id;
});

await test('7. aimeat_catalogue_boards returns array including public board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_boards',
        arguments: {},
    }, 201);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const boards = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(boards), 'result is array');
    const found = boards.find((b: any) => b.id === publicBoardId);
    assert(found !== undefined, 'public board appears in catalogue');
    assert(found.name === 'catalogue-public-board', `name: ${found.name}`);
});

await test('8. aimeat_catalogue_boards excludes private boards', async () => {
    // Create a private board
    const createRes = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: 'private-board-should-not-appear', visibility: 'private' },
    }, 202);
    const created = JSON.parse(createRes.body.result.content[0].text);

    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_boards',
        arguments: {},
    }, 203);
    const boards = JSON.parse(body.result.content[0].text);
    const found = boards.find((b: any) => b.id === created.id);
    assert(found === undefined, 'private board should NOT appear in public catalogue');
});

// ─── Phase 4: People Directory ───
console.log('\nPhase 4 — People Directory');

await test('9. aimeat_catalogue_directory returns an array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_directory',
        arguments: {},
    }, 300);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const entries = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(entries), 'result is array');
});

await test('10. aimeat_catalogue_directory with city filter returns array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_directory',
        arguments: { city: 'Helsinki' },
    }, 301);
    const entries = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(entries), 'result is array');
    // All returned entries should have Helsinki in city
    for (const e of entries) {
        assert(
            e.city?.toLowerCase().includes('helsinki'),
            `entry city should include Helsinki, got: ${e.city}`,
        );
    }
});

await test('11. aimeat_catalogue_directory with interest filter returns array', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_catalogue_directory',
        arguments: { interest: 'music' },
    }, 302);
    const entries = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(entries), 'result is array');
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
