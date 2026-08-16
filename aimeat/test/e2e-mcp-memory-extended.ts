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

await test('4. aimeat_memory_search finds entries by query (snippet hits, no full value)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'searchable' },
    }, 103);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const res = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(res.hits), 'res.hits is array');
    assert(res.hits.length >= 2, `expected at least 2 hits, got ${res.hits.length}`);
    // Size-bounded: hits carry a snippet + key/bytes, NOT the full value blob.
    for (const h of res.hits) {
        assert(typeof h.snippet === 'string', 'hit has a snippet string');
        assert(typeof h.bytes === 'number', 'hit reports bytes');
        assert(h.value === undefined, 'hit does NOT carry the full value');
    }
});

await test('4b. the search is scoped to the CALLER — another owner\'s records are not in it', async () => {
    // Every principal in this file belongs to one owner, so no other owner's records exist and the
    // scoping of aimeat_memory_search is asserted by nothing: replacing
    // `storage.searchMemory(agentGaii, …)` with an unscoped search, or one that reads a
    // caller-supplied gaii, keeps every hit assertion above passing while the tool returns every
    // owner's memory on the node.
    const strangerName = `mcpmemxout${Date.now()}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: strangerName, display_name: 'Outside Owner', password: 'McpMemx1234' }),
    });
    assert(reg.status === 201, `stranger ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: strangerName, timestamp: ts, signature: await signMsg(reg.body.data.private_key, strangerName + NODE_ID + ts) }),
    });
    const strangerToken = tok.body.data.token as string;

    // The same word the caller searches for, in someone else's namespace, and PRIVATE.
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${strangerToken}` },
        body: JSON.stringify({ key: 'outsider.note', value: { content: 'searchable content owned by nobody here' }, visibility: 'private' }),
    });
    assert(w.status === 201, `stranger write ${w.status}: ${JSON.stringify(w.body?.error)}`);

    const { body } = await mcpRpc('tools/call', { name: 'aimeat_memory_search', arguments: { query: 'searchable' } }, 1031);
    const res = JSON.parse(body.result.content[0].text);
    assert(res.hits.length >= 2, `the caller still finds their own: ${res.hits.length}`);
    assert(!res.hits.some((h: any) => h.key === 'outsider.note'),
        `the search returned another owner's record: ${JSON.stringify(res.hits.map((h: any) => h.key))}`);
});

await test('5. aimeat_memory_search with visibility filter', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'searchable', visibility: 'public' },
    }, 104);
    const res = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(res.hits), 'res.hits is array');
    for (const h of res.hits) {
        assert(h.visibility === 'public', `all hits should be public, got: ${h.visibility}`);
    }
});

await test('6. aimeat_memory_search with no match returns no hits', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_search',
        arguments: { query: 'xyzzy-no-match-unique-12345' },
    }, 105);
    const res = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(res.hits), 'res.hits is array');
    assert(res.hits.length === 0, `expected 0 hits, got ${res.hits.length}`);
    assert(res.total === 0, `expected total 0, got ${res.total}`);
});

await test('6b. aimeat_memory_search skips .version.N history by default (opt-in with include_versions)', async () => {
    // A workspace-style version snapshot is owned by the agent GAII — the historical bloat source.
    await mcpRpc('tools/call', { name: 'aimeat_memory_write', arguments: { key: 'search.ver.instance.version.1', value: { content: 'versioned gamma snapshot' } } }, 106);
    await mcpRpc('tools/call', { name: 'aimeat_memory_write', arguments: { key: 'search.ver.instance.latest', value: { content: 'versioned gamma current' } } }, 107);
    const def = JSON.parse((await mcpRpc('tools/call', { name: 'aimeat_memory_search', arguments: { query: 'gamma' } }, 108)).body.result.content[0].text);
    assert(def.hits.every((h: { key: string }) => !/\.version\.\d+$/.test(h.key)), 'default search excludes .version.N keys');
    assert(def.hits.some((h: { key: string }) => h.key === 'search.ver.instance.latest'), 'default search still finds the .latest');
    const inc = JSON.parse((await mcpRpc('tools/call', { name: 'aimeat_memory_search', arguments: { query: 'gamma', include_versions: true } }, 109)).body.result.content[0].text);
    assert(inc.hits.some((h: { key: string }) => h.key === 'search.ver.instance.version.1'), 'include_versions surfaces the .version.N snapshot');
});

await test('6c. aimeat_memory_search honours limit', async () => {
    for (let i = 0; i < 5; i++) await mcpRpc('tools/call', { name: 'aimeat_memory_write', arguments: { key: `search.lim.${i}`, value: { content: 'limitword delta' } } }, 110 + i);
    const res = JSON.parse((await mcpRpc('tools/call', { name: 'aimeat_memory_search', arguments: { query: 'limitword', limit: 2 } }, 120)).body.result.content[0].text);
    assert(res.hits.length <= 2, `limit 2 → at most 2 hits, got ${res.hits.length}`);
    assert(res.truncated === true, 'truncated flag set when more matched than the limit');
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

await test('8b. read_public refuses every non-public tier, not just private', async () => {
    // Only 'private' and 'public' are ever tested here, so changing the guard from
    // `record.visibility !== 'public'` to `record.visibility === 'private'` keeps the suite green
    // while 'owner', 'group' and 'members' records become world-readable through the tool — including
    // the visibility:'owner' records this same file writes further down.
    for (const tier of ['owner', 'members']) {
        const key = `readpublic.tier.${tier}`;
        const w = await mcpRpc('tools/call', {
            name: 'aimeat_memory_write',
            arguments: { key, value: { content: `a ${tier} record` }, visibility: tier },
        }, 2100 + tier.length);
        assert(JSON.parse(w.body.result.content[0].text).written === true, `write ${tier}: ${w.body.result.content[0].text}`);

        const r = await mcpRpc2('tools/call', {
            name: 'aimeat_memory_read_public', arguments: { gaii: agentGaii, key },
        }, 2200 + tier.length);
        assert(r.body.result?.isError === true,
            `read_public handed back a '${tier}' record: ${r.body.result?.content?.[0]?.text}`);
        assert(!String(r.body.result.content[0].text).includes(`a ${tier} record`),
            `and the value came with it: ${r.body.result.content[0].text}`);
    }
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

// ─── The live channel hears an agent's write ────────────────────────────────────────────────
//
// An agent writes a record over MCP and the human's page fills in without a refresh. That only
// works if the write EMITS on the SSE `memory` domain, and for a long time this one surface did
// not: the REST paths emitted, every other MCP surface emitted, and `aimeat_memory_write` wrote
// straight to storage in silence. Nothing looked broken — the data was there on the next reload —
// which is why it survived. Measured on production before the fix: five writes through
// POST /v1/memory produced five frames on one open stream, three through this tool produced none.
//
// The assertion is deliberately about the OWNER's stream rather than the agent's. What the fix
// buys is a human watching their agent work, so that is what is checked.
await test('10. aimeat_memory_write reaches the owner\'s live stream on the "memory" domain', async () => {
    const ticket = await json('/v1/events/ticket', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(ticket.status === 200 && !!ticket.body.data?.ticket, `ticket: ${ticket.status}`);

    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${ticket.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream status ${res.status}`);

    let buf = '';
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) buf += dec.decode(value, { stream: true });
            }
        } catch { /* aborted below */ }
    })();

    const domains = () => buf.split('\n')
        .filter(l => l.startsWith('data: '))
        .flatMap(l => { try { const p = JSON.parse(l.slice(6)); return Array.isArray(p.domains) ? p.domains : []; } catch { return []; } });

    // Let the stream open before the write, or the frame races the connection.
    const openDeadline = Date.now() + 3_000;
    while (Date.now() < openDeadline && !buf.includes(':open')) await new Promise(r => setTimeout(r, 50));
    assert(buf.includes(':open'), 'stream must open before the write');

    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: 'sse.mcp.probe', value: { at: Date.now() }, visibility: 'owner' },
    }, 203);
    assert(body.result?.content?.[0]?.text !== undefined, 'write returned content');
    assert(JSON.parse(body.result.content[0].text).written === true, 'write reported success');

    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline && !domains().includes('memory')) await new Promise(r => setTimeout(r, 100));
    const seen = domains();
    ctrl.abort();
    assert(seen.includes('memory'),
        `an MCP memory write must emit the "memory" domain; the owner stream saw ${JSON.stringify(seen)}`);
});

// ─── Phase 4: expected_version, the optimistic lock (core.ts v1.15.0) ───
//
// The REST key route has always refused a stale write with 409 VERSION_CONFLICT. Over MCP the same
// write was last-write-wins, so an agent could silently overwrite an edit a person had just made in
// the browser. These four cover both directions: the lock refuses when it should, and omitting it
// leaves every existing caller working exactly as before.
console.log('\nPhase 4 — expected_version');

const LOCK_KEY = 'lock.probe.record';

await test('11. expected_version 0 creates a key that does not exist yet', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: LOCK_KEY, value: { round: 1 }, visibility: 'owner', expected_version: 0 },
    }, 210);
    assert(body.result?.isError !== true, `create with expected_version 0 must succeed: ${body.result?.content?.[0]?.text}`);
    assert(JSON.parse(body.result.content[0].text).written === true, 'write reported success');
});

await test('12. expected_version 0 on an existing key is refused', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: LOCK_KEY, value: { round: 'must not land' }, visibility: 'owner', expected_version: 0 },
    }, 211);
    assert(body.result?.isError === true, 'asserting a fresh key over an existing one must be refused');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.error === 'VERSION_CONFLICT', `error code: ${result.error}`);
    assert(result.current_version > 0, `current_version must report the real version, got ${result.current_version}`);
});

await test('13. a stale expected_version is refused and nothing is written', async () => {
    const read = await mcpRpc('tools/call', { name: 'aimeat_memory_read', arguments: { key: LOCK_KEY } }, 212);
    const current = JSON.parse(read.body.result.content[0].text);
    const version = current.version ?? current.record?.version;
    assert(typeof version === 'number', `read must expose a version, got ${JSON.stringify(current).slice(0, 200)}`);

    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: LOCK_KEY, value: { round: 'stale, must not land' }, visibility: 'owner', expected_version: version - 1 },
    }, 213);
    assert(body.result?.isError === true, 'a stale version must be refused');
    const result = JSON.parse(body.result.content[0].text);
    assert(result.error === 'VERSION_CONFLICT', `error code: ${result.error}`);
    assert(result.your_version === version - 1 && result.current_version === version,
        `both versions must be reported: ${JSON.stringify(result)}`);

    // The refusal has to be a refusal, not a warning that wrote anyway.
    const after = await mcpRpc('tools/call', { name: 'aimeat_memory_read', arguments: { key: LOCK_KEY } }, 214);
    const value = JSON.parse(after.body.result.content[0].text);
    assert(JSON.stringify(value).includes('must not land') === false, 'the refused value must not be in the record');
});

await test('14. the current expected_version succeeds, and omitting it still works', async () => {
    const read = await mcpRpc('tools/call', { name: 'aimeat_memory_read', arguments: { key: LOCK_KEY } }, 215);
    const current = JSON.parse(read.body.result.content[0].text);
    const version = current.version ?? current.record?.version;

    const locked = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: LOCK_KEY, value: { round: 2 }, visibility: 'owner', expected_version: version },
    }, 216);
    assert(locked.body.result?.isError !== true, `matching version must succeed: ${locked.body.result?.content?.[0]?.text}`);

    // Backwards compatibility: every caller written before v1.15.0 passes no version at all.
    const unlocked = await mcpRpc('tools/call', {
        name: 'aimeat_memory_write',
        arguments: { key: LOCK_KEY, value: { round: 3 }, visibility: 'owner' },
    }, 217);
    assert(unlocked.body.result?.isError !== true, 'omitting expected_version must behave exactly as before');
});

// ─── Summary ───
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
