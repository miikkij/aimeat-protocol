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
    // A7 (E2E test-quality audit). This used to read "First owner is operator, so can create public
    // boards", which states an escalation as if it were the feature. It is neither: the first owner
    // registered on an empty node is promoted to operator on purpose (routes/ghii/register-login.ts),
    // and creating a public board is operator-only (services/board-write.ts:130). This suite's owner
    // happens to be that first owner, which is why the call below succeeds — it is a property of the
    // fixture, not a permission any agent has. Test 6b pins the gate the comment used to hide.
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: 'catalogue-public-board', visibility: 'public', description: 'Public board for catalogue test' },
    }, 200);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.id === 'string', 'has id');
    publicBoardId = result.id;
});

// A7 (E2E test-quality audit). The gate test 6 passes only by being the bootstrap owner. Asserted
// here through the HTTP door, which calls the SAME createBoard in services/board-write.ts that the
// MCP tool calls — one implementation, so proving it on either door proves the rule. A second owner
// registered on a node that already has one is an ordinary account with no operator role.
await test('6b. A later owner\'s agent cannot create a public board (the operator gate)', async () => {
    const otherOwner = `cat2${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherOwner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `second owner ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
    const ts = new Date().toISOString();
    const otherTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: otherOwner, timestamp: ts, signature: await signMsg(reg.body.data.private_key, otherOwner + NODE_ID + ts) }),
    });
    assert(otherTok.body.ok === true, `second owner token: ${JSON.stringify(otherTok.body.error)}`);

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${otherTok.body.data.token}` },
        body: JSON.stringify({ name: 'cat2-bot', owner: otherOwner, capabilities: ['catalogue'], scopes: ['social:write', 'social:read'] }),
    });
    assert(ag.status === 201, `second agent ${ag.status}: ${JSON.stringify(ag.body).slice(0, 200)}`);
    const ats = new Date().toISOString();
    const agGaii = ag.body.data.agent.gaii as string;
    const agTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agGaii, timestamp: ats, signature: await signMsg(ag.body.data.private_key, agGaii + ats) }),
    });
    assert(agTok.body.ok === true, `second agent token: ${JSON.stringify(agTok.body.error)}`);
    const agentAuth = { Authorization: `Bearer ${agTok.body.data.token}` };

    const pub = await json('/v1/boards', {
        method: 'POST', headers: agentAuth,
        body: JSON.stringify({ name: 'not-allowed-public', visibility: 'public', description: 'should be refused' }),
    });
    assert(pub.status === 403, `a non-operator agent creating a public board expected 403, got ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    assert(pub.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${pub.body.error?.code}`);

    // The refusal is about `public`, not about creating boards at all — otherwise this test would
    // pass just as well against an agent that may create nothing.
    const priv = await json('/v1/boards', {
        method: 'POST', headers: agentAuth,
        body: JSON.stringify({ name: 'allowed-private', visibility: 'private', description: 'ordinary board' }),
    });
    assert(priv.status === 201, `the same agent must still create a private board, got ${priv.status}: ${JSON.stringify(priv.body).slice(0, 200)}`);

    await json(`/v1/owners/${otherOwner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherTok.body.data.token}` } });
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

// The directory is an OPT-IN: it lists people whose profile.location is public, and the two tests
// above assert only that the answer is an array. An array is what a broken filter returns too. The
// gate is one line in the per-GHII loop, and nothing had ever asked it about somebody who did not
// opt in — so publishing every owner on the node would have passed both.
let dirOwnerB = '';

await test('12. Setup: A keeps a PRIVATE profile, B publishes one', async () => {
    const priv = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'profile.location', value: { city: 'Tampere' }, visibility: 'private' }),
    });
    assert(priv.status === 200 || priv.status === 201, `A private profile: ${priv.status}`);

    dirOwnerB = `catdir${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: dirOwnerB, public_key: 'placeholder' }) });
    assert(reg.status === 201, `owner B: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: dirOwnerB, timestamp: ts, signature: await signMsg(reg.body.data.private_key, dirOwnerB + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner B token: ${JSON.stringify(tok.body.error)}`);
    const bAuth = { Authorization: `Bearer ${tok.body.data.token}` };
    for (const [key, value] of [['profile.location', { city: 'Helsinki' }], ['profile.interests', ['music', 'sailing']]] as const) {
        const w = await json('/v1/memory', { method: 'POST', headers: bAuth, body: JSON.stringify({ key, value, visibility: 'public' }) });
        assert(w.status === 200 || w.status === 201, `B ${key}: ${w.status}`);
    }
});

await test('13. The directory lists the owner who opted IN and not the one who did not', async () => {
    const { body } = await mcpRpc('tools/call', { name: 'aimeat_catalogue_directory', arguments: {} }, 303);
    const entries = JSON.parse(body.result.content[0].text) as any[];

    const b = entries.find(e => e.ghii === `${dirOwnerB}@${NODE_ID}`);
    assert(!!b, `the opted-in owner must be listed: ${JSON.stringify(entries.map(e => e.ghii))}`);
    assert(b.city === 'Helsinki', `and carry their public city: ${JSON.stringify(b)}`);

    // The whole point: A's location is private, so A is not in the directory at all.
    assert(!entries.some(e => e.ghii === `${ownerName}@${NODE_ID}`),
        `an owner with a PRIVATE profile must not be listed: ${JSON.stringify(entries.map(e => e.ghii))}`);
    assert(!JSON.stringify(entries).includes('Tampere'), 'and their private city must not appear anywhere in the answer');
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
