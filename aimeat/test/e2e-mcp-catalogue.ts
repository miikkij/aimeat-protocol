/**
 * @file e2e-mcp-catalogue.ts
 * @description E2E tests for MCP catalogue module — 3 tools: agent directory, public boards, people directory.
 * @version-history
 *   2026-10-20 — Phase 4 asks the opt-in question both doors now ask: aimeat_catalogue_directory
 *     answers from the same DirectoryService as GET /v1/catalogue/directory, so the two list the same
 *     people, and an owner with a public profile and no federation consent is in neither. The old
 *     tests 12 and 13 asserted the tool's own rule (a public `profile.location` record was enough),
 *     which is the policy the fix removed (secaudit 2026-10).
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
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn, registerOwner } from './helpers/owner-login.js';
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
});

await test('Owner auth token', async () => {
    const { body } = await ownerSignIn(BASE, ownerName, 'McpCat1234');
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
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        gaii: agentGaii,
        signature,
        timestamp,
        ...authorizeParams(pkce),
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
            ...tokenParams(pkce),
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
    const other = await registerOwner(BASE, otherOwner);

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${other.token}` },
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

    // `system`, not `public`, since 2026-08-30: boards came back as Core (RFC §27) and a public board
    // stopped being the operator's — any account may keep one up to config.boardPublicPerOwnerMax,
    // which is the point of a notice board. A `system` board, one the node itself speaks through, is
    // still the operator's alone, and that is the gate this test was always about.
    const pub = await json('/v1/boards', {
        method: 'POST', headers: agentAuth,
        body: JSON.stringify({ name: 'not-allowed-system', visibility: 'system', description: 'should be refused' }),
    });
    assert(pub.status === 403, `a non-operator agent creating a system board expected 403, got ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    assert(pub.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${pub.body.error?.code}`);

    // The refusal is about `public`, not about creating boards at all — otherwise this test would
    // pass just as well against an agent that may create nothing.
    const priv = await json('/v1/boards', {
        method: 'POST', headers: agentAuth,
        body: JSON.stringify({ name: 'allowed-private', visibility: 'private', description: 'ordinary board' }),
    });
    assert(priv.status === 201, `the same agent must still create a private board, got ${priv.status}: ${JSON.stringify(priv.body).slice(0, 200)}`);

    await json(`/v1/owners/${otherOwner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${other.token}` } });
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

// ONE LISTING, ONE OPT-IN. The people directory has two doors: GET /v1/catalogue/directory and this
// tool. The REST door answers from the DirectoryService, which lists a person only while they hold
// an active `federation` consent. The tool had a listing of its own over listGHIIs, which asked only
// whether a bare `profile.location` record was public, so it published people the REST door kept out
// (secaudit 2026-10). The two tests below assert that the doors now answer the same people, with a
// control who has everything but the consent. Tests 9 to 11 above assert only that the answer is an
// array, which is what a broken filter returns too.
let dirOwnerB = '';
let dirOwnerBGhii = '';
const dirOwnerAGhii = () => `${ownerName}@${NODE_ID}`;

/** The REST door's people, polled while the consent reaches the index (a 2 s debounce rebuild). */
async function restDirectoryPeople(waitFor?: string): Promise<any[]> {
    let entries: any[] = [];
    for (let i = 0; i < 40; i++) {
        const r = await json('/v1/catalogue/directory?type=people&per_page=50', {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 200, `REST directory: ${r.status} ${JSON.stringify(r.body)}`);
        entries = r.body.data.entries as any[];
        if (!waitFor || entries.some(e => e.ghii === waitFor)) break;
        await new Promise(res => setTimeout(res, 500));
    }
    return entries;
}

await test('12. Setup: A publishes a profile and never consents, B publishes one and consents', async () => {
    // A is the control: a PUBLIC profile under the documented key, an agent (registered in the setup
    // above), and no federation consent. Before the fix the tool listed A on the public profile alone.
    // Both key shapes, because the two doors used to read different ones: the index reads
    // `profile.<username>.location`, and the tool's own listing read the bare `profile.location`.
    // A publishes both and consents to nothing, so neither door has an excuse to list them.
    for (const key of [`profile.${ownerName}.location`, 'profile.location']) {
        const aLoc = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ key, value: { city: 'Tampere' }, visibility: 'public', tags: ['profile', 'location'] }),
        });
        // 201, not 200: POST /v1/memory answers 200 only when it overwrote a key that existed.
        assert(aLoc.status === 201, `A ${key}: ${aLoc.status} ${JSON.stringify(aLoc.body)}`);
    }

    dirOwnerB = `catdir${Date.now()}`;
    const ownerB = await registerOwner(BASE, dirOwnerB);
    dirOwnerBGhii = ownerB.ghii;
    const bAuth = { Authorization: `Bearer ${ownerB.token}` };
    const bRecords = [
        [`profile.${dirOwnerB}.location`, { city: 'Helsinki' }],
        [`profile.${dirOwnerB}.interests`, ['music', 'sailing']],
    ] as const;
    for (const [key, value] of bRecords) {
        const w = await json('/v1/memory', { method: 'POST', headers: bAuth, body: JSON.stringify({ key, value, visibility: 'public', tags: ['profile'] }) });
        assert(w.status === 201, `B ${key}: ${w.status} ${JSON.stringify(w.body)}`);
    }
    // The index reads a person only when their owner has an agent, and only while a federation
    // consent is active. B has both; A has the agent and nothing else.
    const bAgent = await json('/v1/agents', {
        method: 'POST', headers: bAuth,
        body: JSON.stringify({ name: 'catdirbot', owner: dirOwnerB, model: 'gpt-4o' }),
    });
    assert(bAgent.status === 201, `B agent: ${bAgent.status} ${JSON.stringify(bAgent.body)}`);
    const consent = await json('/v1/consent', {
        method: 'POST', headers: bAuth,
        body: JSON.stringify({
            data_pattern: 'profile.*', recipient: '*', scope: 'federation',
            purpose: 'Be findable in this node\'s people directory',
        }),
    });
    assert(consent.status === 201, `B consent: ${consent.status} ${JSON.stringify(consent.body)}`);
});

await test('13. Both doors list the owner who granted a federation consent', async () => {
    const rest = await restDirectoryPeople(dirOwnerBGhii);
    assert(rest.some(e => e.ghii === dirOwnerBGhii),
        `the REST door must list the consented owner: ${JSON.stringify(rest.map(e => e.ghii))}`);

    const { body } = await mcpRpc('tools/call', { name: 'aimeat_catalogue_directory', arguments: {} }, 303);
    const entries = JSON.parse(body.result.content[0].text) as any[];
    const b = entries.find(e => e.ghii === dirOwnerBGhii);
    assert(!!b, `the MCP door must list them too: ${JSON.stringify(entries.map(e => e.ghii))}`);
    assert(b.city === 'Helsinki', `and carry their public city: ${JSON.stringify(b)}`);

    const restPeople = rest.map(e => e.ghii).sort();
    const mcpPeople = entries.map(e => e.ghii).sort();
    assert(JSON.stringify(restPeople) === JSON.stringify(mcpPeople),
        `the two doors list different people: REST ${JSON.stringify(restPeople)} vs MCP ${JSON.stringify(mcpPeople)}`);
});

await test('14. CONTROL: an owner who never consented is in neither door, public profile or not', async () => {
    const rest = await restDirectoryPeople();
    assert(!rest.some(e => e.ghii === dirOwnerAGhii()),
        `the REST door listed an owner who never consented: ${JSON.stringify(rest.map(e => e.ghii))}`);

    const { body } = await mcpRpc('tools/call', { name: 'aimeat_catalogue_directory', arguments: {} }, 304);
    const entries = JSON.parse(body.result.content[0].text) as any[];
    assert(!entries.some(e => e.ghii === dirOwnerAGhii()),
        `the MCP door listed an owner who never consented: ${JSON.stringify(entries.map(e => e.ghii))}`);
    assert(!JSON.stringify(entries).includes('Tampere'), 'and their city must not appear anywhere in the answer');
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
