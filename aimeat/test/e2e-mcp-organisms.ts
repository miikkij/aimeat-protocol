/**
 * @file e2e-mcp-organisms.ts
 * @description E2E tests for MCP organisms module — 5 tools + 1 resource.
 *   Tests organism listing, detail retrieval, joining, leaving, member listing,
 *   and the organism details resource.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-organisms.ts

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
const ownerName = `mcporg${Date.now()}`;
const agentName = 'mcporgagent';

// Second user for join tests
let owner2Token = '';
let owner2PrivKey = '';
let agent2PrivKey = '';
let agent2Gaii = '';
const owner2Name = `mcporg2${Date.now()}`;
const agent2Name = 'mcporgagent2';
let mcpToken2 = '';
let sessionId2 = '';

// OAuth state
let clientId = '';
let clientSecret = '';
let clientId2 = '';
let clientSecret2 = '';

// Organism state
let organismId = '';
let approvalOrganismId = '';

console.log('\n=== AIMEAT MCP Organisms E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token (user 1) ───
console.log('Setup — Owner 1, Agent 1, MCP OAuth');

await test('Register GHII identity (user 1)', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Organisms Test', password: 'McpOrg1234' }),
    });
    assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner 1 auth token', async () => {
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
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['social'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('OAuth client registration (user 1)', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP Organisms Test Client', redirect_uris: [] }),
    });
    assert(status === 201, `status ${status}`);
    clientId = body.client_id;
    clientSecret = body.client_secret;
});

await test('OAuth authorize + token exchange (user 1)', async () => {
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

await test('Initialize MCP session (user 1)', async () => {
    const { status, body } = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'MCP Organisms E2E', version: '1.0.0' },
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

// ─── Setup user 2 ───
console.log('\nSetup — Owner 2, Agent 2, MCP OAuth');

async function mcpRpc2(method: string, params: Record<string, any> = {}, id: number = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken2 ? { Authorization: `Bearer ${mcpToken2}` } : {}),
            ...(sessionId2 ? { 'mcp-session-id': sessionId2, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId2 = sid;

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

await test('Register GHII identity (user 2)', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: owner2Name, display_name: 'MCP Organisms Test 2', password: 'McpOrg1234' }),
    });
    assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
    owner2PrivKey = body.data.private_key;
});

await test('Owner 2 auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = owner2Name + NODE_ID + timestamp;
    const signature = await signMsg(owner2PrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: owner2Name, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    owner2Token = body.data.token;
});

await test('Register agent 2', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({
            name: agent2Name,
            owner: owner2Name,
            capabilities: ['social'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agent2Gaii = body.data.agent.gaii;
    agent2PrivKey = body.data.private_key;
});

await test('OAuth client registration (user 2)', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP Organisms Test Client 2', redirect_uris: [] }),
    });
    assert(status === 201, `status ${status}`);
    clientId2 = body.client_id;
    clientSecret2 = body.client_secret;
});

await test('OAuth authorize + token exchange (user 2)', async () => {
    const timestamp = new Date().toISOString();
    const message = agent2Gaii + NODE_ID + timestamp;
    const signature = await signMsg(agent2PrivKey, message);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId2,
        gaii: agent2Gaii,
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
            client_id: clientId2,
            client_secret: clientSecret2,
        }),
    });
    assert(status === 200, `token status ${status}`);
    mcpToken2 = tokenBody.access_token;
});

await test('Initialize MCP session (user 2)', async () => {
    const { status, body } = await mcpRpc2('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'MCP Organisms E2E 2', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result !== undefined, 'has result');

    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken2}`,
            'mcp-session-id': sessionId2,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

// ─── Phase 1: Tool Registration ───
console.log('\nPhase 1 — Tool Registration');

await test('1. Organism tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_organism_list'), 'has aimeat_organism_list');
    assert(toolNames.includes('aimeat_organism_get'), 'has aimeat_organism_get');
    assert(toolNames.includes('aimeat_organism_join'), 'has aimeat_organism_join');
    assert(toolNames.includes('aimeat_organism_leave'), 'has aimeat_organism_leave');
    assert(toolNames.includes('aimeat_organism_members'), 'has aimeat_organism_members');
});

// ─── Phase 2: Create organisms via REST API (user 1 is operator, can create) ───
console.log('\nPhase 2 — Create Organisms (REST setup)');

await test('2. Create open organism via REST', async () => {
    const { status, body } = await json('/v1/organisms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'MCP Open Org',
            description: 'An open organism for MCP testing',
            type: 'community',
            join_policy: 'open',
            visibility: 'public',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.organism.id === 'string', 'has organism id');
    organismId = body.data.organism.id;
});

await test('3. Create approval-required organism via REST', async () => {
    const { status, body } = await json('/v1/organisms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'MCP Approval Org',
            description: 'Needs approval to join',
            type: 'team',
            join_policy: 'approval_required',
            visibility: 'public',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    approvalOrganismId = body.data.organism.id;
});

// ─── Phase 3: List and Get ───
console.log('\nPhase 3 — List and Get');

await test('4. List organisms shows the new organisms', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_list',
        arguments: {},
    }, 101);
    const orgs = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(orgs), 'is array');
    const found = orgs.find((o: any) => o.id === organismId);
    assert(found !== undefined, 'open organism in list');
    assert(found.name === 'MCP Open Org', `name: ${found.name}`);
    assert(typeof found.member_count === 'number', 'has member_count');
    assert(typeof found.board_id === 'string', 'has board_id');
});

await test('5. Get organism details', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_get',
        arguments: { organism_id: organismId },
    }, 102);
    const org = JSON.parse(body.result.content[0].text);
    assert(org.id === organismId, `id: ${org.id}`);
    assert(org.name === 'MCP Open Org', `name: ${org.name}`);
    assert(org.join_policy === 'open', `join_policy: ${org.join_policy}`);
    assert(Array.isArray(org.members), 'has members array');
    assert(org.member_count >= 1, 'at least 1 member (creator)');
});

await test('6. Get non-existent organism fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_get',
        arguments: { organism_id: 'nonexistent-organism-id' },
    }, 103);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 4: Join ───
console.log('\nPhase 4 — Join');

await test('7. User 2 joins open organism immediately', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_join',
        arguments: { organism_id: organismId },
    }, 104);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.status === 'joined', `status: ${result.status}`);
    assert(result.organism_id === organismId, `organism_id: ${result.organism_id}`);
});

await test('8. Joining again fails (already member)', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_join',
        arguments: { organism_id: organismId },
    }, 105);
    assert(body.result.isError === true, 'isError for double join');
});

await test('9. User 2 requests to join approval-required organism', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_join',
        arguments: { organism_id: approvalOrganismId, message: 'Please let me in!' },
    }, 106);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.status === 'pending_approval', `status: ${result.status}`);
});

await test('10. Joining non-existent organism fails', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_join',
        arguments: { organism_id: 'nonexistent-org' },
    }, 107);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 5: Members ───
console.log('\nPhase 5 — Members');

await test('11. List members of open organism (user 1)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_members',
        arguments: { organism_id: organismId },
    }, 108);
    const members = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(members), 'is array');
    // Should have at least creator + user 2 who just joined
    assert(members.length >= 2, `expected >= 2 members, got ${members.length}`);
    const hasRole = members.every((m: any) => typeof m.role === 'string');
    assert(hasRole, 'all members have role');
});

await test('12. List members of non-existent organism fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_members',
        arguments: { organism_id: 'nonexistent-org' },
    }, 109);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 6: Leave ───
console.log('\nPhase 6 — Leave');

await test('13. User 2 leaves open organism', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_leave',
        arguments: { organism_id: organismId },
    }, 110);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.left === true, `left: ${result.left}`);
});

await test('14. Leaving again fails (not a member)', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_leave',
        arguments: { organism_id: organismId },
    }, 111);
    assert(body.result.isError === true, 'isError');
});

await test('15. Creator cannot leave organism', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_organism_leave',
        arguments: { organism_id: organismId },
    }, 112);
    assert(body.result.isError === true, 'isError for creator leave attempt');
});

await test('16. Leave non-existent organism fails', async () => {
    const { body } = await mcpRpc2('tools/call', {
        name: 'aimeat_organism_leave',
        arguments: { organism_id: 'nonexistent-org' },
    }, 113);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 7: Resource ───
console.log('\nPhase 7 — Organism Resource');

await test('17. Read organism resource', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: `aimeat://organisms/${organismId}`,
    }, 114);
    assert(status === 200, `status ${status}`);
    assert(body.result?.contents?.[0] !== undefined, 'has contents');
    const org = JSON.parse(body.result.contents[0].text);
    assert(org.id === organismId, `id: ${org.id}`);
    assert(org.name === 'MCP Open Org', `name: ${org.name}`);
    assert(Array.isArray(org.members), 'has members');
});

await test('18. Read non-existent organism resource', async () => {
    const { body } = await mcpRpc('resources/read', {
        uri: 'aimeat://organisms/nonexistent-organism',
    }, 115);
    assert(body.result?.contents?.[0]?.text === 'Organism not found', `text: ${body.result?.contents?.[0]?.text}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete owner 1 (cascade)', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
});

await test('Delete owner 2 (cascade)', async () => {
    const { status } = await json(`/v1/owners/${owner2Name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
