/**
 * @file test/e2e-mcp-scopes.ts
 * @description MCP audit Phase 3 (F1): scope enforcement on the /v1/mcp tool surface. A narrow agent
 *   sees and can call only what its scopes allow; a broad ('*') agent sees the full surface — MINUS
 *   the words no wildcard carries, which is the half this file used to leave out.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-scopes
 * @version-history
 *   v1.2.0 — 2026-09-24 — The operator's agents (security audit A8-1). An operator's agent holding
 *     only memory:read was offered, and could call, every administration tool, because those tools
 *     asked only whether the ACCOUNT runs the node. Asserted now: that agent is offered none of the
 *     catalog's operator tools and is refused one called by name; an agent the operator ticked
 *     operator:admin for is offered and answered; the HTTP admin doors answer as they did.
 *   v1.1.0 — 2026-08-15 — The '*' agent is now asserted NEGATIVELY as well. The suite checked only
 *     that four ordinary tools ARE present, so reintroducing a local wildcard rule inside
 *     scopeAllowsTool — the exact regression mcp/catalog/scopes.ts v1.7.0 records — kept it green
 *     while a Full-access agent gained twelve reserved tools, among them the URL a decrypted AI key
 *     is sent to and the seller's payment credentials. Both new cases derive their tool list from
 *     TOOL_SCOPES x SCOPES_OUTSIDE_WILDCARD, because a hand-written list is how the rule was lost the
 *     first time.
 *   v1.0.0 — 2026-07 — Initial (MCP audit phase 3, F1).
 */

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
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TOOL_SCOPES } from '../src/mcp/catalog/scopes.js';
import { SCOPES_OUTSIDE_WILDCARD } from '../src/utils/scope-coverage.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/mcp/catalog/definitions.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ } }
    }
    return out;
}

interface McpClient {
    list(): Promise<string[]>;
    call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }>;
}

/** Full OAuth PATH A (agent signature) + MCP session init for one agent. Returns a tool client. */
async function connectMcp(gaii: string, privKey: string): Promise<McpClient> {
    // 1. Register an OAuth client
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'scope-e2e' }) });
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;

    // 2. Authorize via agent signature (PATH A): message = gaii + nodeId + timestamp
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const authQs = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp });
    const auth = await json(`/v1/mcp/authorize?${authQs}`);
    const code = auth.body.code as string;
    assert(typeof code === 'string', `authorize returned code (${JSON.stringify(auth.body)})`);

    // 3. Exchange for an access token
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret }),
    });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange (${JSON.stringify(tok.body)})`);

    let sessionId = '';
    async function rpc(method: string, params: Record<string, unknown>, id: number) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json();
        return { status: res.status, body };
    }

    // 4. Initialize the session + send the initialized notification
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'scope-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    return {
        async list() {
            const { body } = await rpc('tools/list', {}, 2);
            return (body.result?.tools ?? []).map((t: any) => t.name);
        },
        async call(name, args) {
            const { body } = await rpc('tools/call', { name, arguments: args }, 3);
            const ok = body.error === undefined && body.result?.isError !== true;
            return { ok, body };
        },
    };
}

console.log('\n=== AIMEAT MCP Scope Enforcement E2E (F1) ===\n');

const ownerName = `scopeowner${Date.now()}`;
let ownerToken = '';
let narrow: { gaii: string; key: string } = { gaii: '', key: '' };
let broad: { gaii: string; key: string } = { gaii: '', key: '' };

await test('Setup: register owner + narrow and broad agents', async () => {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Scope Test', password: 'ScopeTest1234' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const ownerKey = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(ownerKey, ownerName + NODE_ID + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
    ownerToken = tk.body.data.token;

    const mkAgent = async (name: string, scopes: string[]) => {
        const r = await json('/v1/agents', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
        });
        assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
        return { gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
    };
    narrow = await mkAgent('narrowagent', ['memory:read']);
    broad = await mkAgent('broadagent', ['*']);
});

await test('Narrow agent (memory:read) sees only scope-allowed + ungated tools', async () => {
    const client = await connectMcp(narrow.gaii, narrow.key);
    const tools = await client.list();
    // Allowed: memory:read tool + ungated tools
    assert(tools.includes('aimeat_memory_read'), 'has aimeat_memory_read (memory:read)');
    assert(tools.includes('aimeat_catalogue_search'), 'has aimeat_catalogue_search (ungated)');
    assert(tools.includes('aimeat_board_read'), 'has aimeat_board_read (ungated public)');
    assert(tools.includes('aimeat_task_list'), 'has aimeat_task_list (ungated)');
    // Filtered: requires scopes the narrow agent lacks
    assert(!tools.includes('aimeat_memory_write'), 'memory_write FILTERED (needs memory:write)');
    assert(!tools.includes('aimeat_wallet_balance'), 'wallet_balance FILTERED (needs wallet:read)');
    assert(!tools.includes('aimeat_board_post'), 'board_post FILTERED (needs social:write)');
    assert(!tools.includes('aimeat_work_inbox'), 'work_inbox FILTERED (needs work:read)');
    assert(!tools.includes('aimeat_consent_grant'), 'consent_grant FILTERED (needs consent:manage)');
});

await test('Narrow agent cannot call a filtered tool (memory_write)', async () => {
    const client = await connectMcp(narrow.gaii, narrow.key);
    const { ok } = await client.call('aimeat_memory_write', { key: 'x', value: 'y' });
    assert(!ok, 'calling filtered aimeat_memory_write must not succeed');
    // And the write must not have happened (read it back via an allowed tool)
    const back = await client.call('aimeat_memory_read', { key: 'x' });
    const text = back.body.result?.content?.[0]?.text ?? '';
    assert(!text.includes('"value": "y"') && !text.includes('"value":"y"'), 'filtered write must not persist');
});

await test('Broad agent (*) sees the full tool surface', async () => {
    const client = await connectMcp(broad.gaii, broad.key);
    const tools = await client.list();
    assert(tools.includes('aimeat_memory_write'), 'has memory_write');
    assert(tools.includes('aimeat_wallet_balance'), 'has wallet_balance');
    assert(tools.includes('aimeat_board_post'), 'has board_post');
    assert(tools.includes('aimeat_consent_grant'), 'has consent_grant');
});

// "Full access" is one click, and a handful of permissions are deliberately not in it:
// SCOPES_OUTSIDE_WILDCARD (src/utils/scope-coverage.ts) names the words only an exact grant confers —
// the URL a decrypted AI key is sent to, the spend cap, the seller's payment credentials, who is in a
// sharing group, who may read a board, and an agent's own permission list.
//
// The test above asserts only that four ordinary tools ARE present, which is the hole: reintroduce a
// local wildcard rule inside scopeAllowsTool that answers yes to '*' for everything — the exact
// regression src/mcp/catalog/scopes.ts v1.7.0 records — and this suite stays green while a Full-access
// agent gains every one of those tools.
//
// Derived from TOOL_SCOPES and SCOPES_OUTSIDE_WILDCARD rather than a copied list of tool names, so a
// word added to the vocabulary is covered on the day it is added rather than the day someone
// remembers this file. A hand-written list is how the rule got lost the first time.
await test("Broad agent (*) does NOT see the tools riding a word no wildcard carries", async () => {
    const reserved = Object.entries(TOOL_SCOPES)
        .filter(([, scope]) => SCOPES_OUTSIDE_WILDCARD.includes(scope))
        .map(([tool]) => tool);
    assert(reserved.length > 0, 'the vocabulary names at least one such tool, or this test proves nothing');

    const client = await connectMcp(broad.gaii, broad.key);
    const tools = await client.list();
    const leaked = reserved.filter(t => tools.includes(t));
    assert(leaked.length === 0,
        `a '*' agent must not be handed ${leaked.join(', ')} — those need the exact word, ticked per agent`);

    // Absence from tools/list is the REGISTRATION filter. A client that already knows the name does
    // not read the list, so the call itself has to be refused as well — the two are different gates
    // and only one of them was ever asked about here.
    const { ok, body } = await client.call(reserved[0]!, {});
    assert(!ok, `a '*' agent CALLED ${reserved[0]}: ${JSON.stringify(body).slice(0, 200)}`);
});

// The other half of the same rule: the word is not withheld from an agent that WAS given it. Without
// this, deleting every one of those tools from the surface would also pass the test above.
await test('An agent granted the exact word DOES see the tool it names', async () => {
    const [probeTool, probeScope] = Object.entries(TOOL_SCOPES)
        .find(([, scope]) => SCOPES_OUTSIDE_WILDCARD.includes(scope)) ?? [];
    assert(!!probeTool && !!probeScope, 'no reserved tool to probe with');

    const ticked = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'tickedagent', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o',
            scopes: ['memory:read', probeScope],
        }),
    });
    assert(ticked.status === 201, `register tickedagent ${ticked.status}: ${JSON.stringify(ticked.body)}`);

    const client = await connectMcp(ticked.body.data.agent.gaii as string, ticked.body.data.private_key as string);
    const tools = await client.list();
    assert(tools.includes(probeTool!),
        `an agent holding ${probeScope} must see ${probeTool} — the exception withholds it from wildcards, not from a grant`);
});

// ─── The operator's agents (security audit A8-1) ───
//
// The administration tools asked one question, whether the ACCOUNT behind the session runs this
// node, and sat outside the scope table, so every agent an operator connected was offered all of
// them. The operator here comes through the admin-password door, which always grants the role, so
// the arms below do not depend on which owner registered first.
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const opName = `scopeop${Date.now()}`;
let opToken = '';
let opReader: { gaii: string; key: string } = { gaii: '', key: '' };
let opAdmin: { gaii: string; key: string } = { gaii: '', key: '' };
/** Every tool the catalog names as the operator's. Derived, so a new one is covered the day it lands. */
const OPERATOR_TOOLS = CLI_FALLBACK_TOOL_DEFINITIONS.filter(d => d.caller === 'operator').map(d => d.name);

await test("Setup: an operator, an agent holding memory:read only, and one holding operator:admin", async () => {
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: opName }),
    });
    assert(reg.status === 200 && reg.body.owner?.roles?.includes('operator'),
        `operator ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: opName, timestamp: ts, signature: await signMsg(reg.body.private_key, opName + NODE_ID + ts) }),
    });
    opToken = tk.body.data.token;
    const mk = async (name: string, scopes: string[]) => {
        const r = await json('/v1/agents', {
            method: 'POST',
            headers: { Authorization: `Bearer ${opToken}` },
            body: JSON.stringify({ name, owner: opName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
        });
        assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
        return { gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
    };
    opReader = await mk('opreader', ['memory:read']);
    opAdmin = await mk('opadmin', ['memory:read', 'operator:admin']);
    assert(OPERATOR_TOOLS.length > 20, `the catalog names ${OPERATOR_TOOLS.length} operator tools; this proves nothing`);
});

await test("An operator's agent holding only memory:read is offered none of the operator's tools", async () => {
    const client = await connectMcp(opReader.gaii, opReader.key);
    const tools = await client.list();
    assert(tools.includes('aimeat_memory_read'), 'the session itself works: memory_read is offered');
    const leaked = OPERATOR_TOOLS.filter(t => tools.includes(t));
    assert(leaked.length === 0, `a memory:read agent of the operator was offered ${leaked.length}: ${leaked.join(', ')}`);
});

await test('…and is refused one it calls by name, however it learned the name', async () => {
    const client = await connectMcp(opReader.gaii, opReader.key);
    const answered: string[] = [];
    for (const [name, args] of [
        ['aimeat_admin_security_overview', {}],
        ['aimeat_admin_agents', { limit: 1 }],
        ['aimeat_admin_cors_overview', {}],
        ['aimeat_mcp_registry_list', {}],
    ] as const) {
        const { ok } = await client.call(name, args);
        if (ok) answered.push(name);
    }
    assert(answered.length === 0, `these answered an agent holding only memory:read: ${answered.join(', ')}`);
});

await test("An agent the operator ticked operator:admin for is offered them, and answered", async () => {
    const client = await connectMcp(opAdmin.gaii, opAdmin.key);
    const tools = await client.list();
    for (const t of ['aimeat_admin_security_overview', 'aimeat_admin_totp_reset', 'aimeat_mcp_registry_set', 'aimeat_seo_status']) {
        assert(tools.includes(t), `an agent holding operator:admin was not offered ${t}`);
    }
    // The repair word is its own tick: operator:admin does not stand in for it.
    assert(!tools.includes('aimeat_admin_organism_owner_add'), 'operator:admin opened the organism repair as well');
    const { ok, body } = await client.call('aimeat_admin_security_overview', {});
    assert(ok === true, `the operator's ticked agent was refused: ${JSON.stringify(body).slice(0, 200)}`);
    const overview = JSON.parse(body.result.content[0].text);
    assert(typeof overview.generated_at === 'string' && typeof overview.now?.status === 'string',
        `the overview came back without its reading: ${JSON.stringify(overview).slice(0, 200)}`);
});

await test('The HTTP admin doors answer as they did: the operator in person passes, an agent token does not', async () => {
    const inPerson = await json('/v1/admin/security/overview', { headers: { Authorization: `Bearer ${opToken}` } });
    assert(inPerson.status === 200, `the operator in person: ${inPerson.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: opAdmin.gaii, timestamp: ts, signature: await signMsg(opAdmin.key, opAdmin.gaii + ts) }),
    });
    assert(tk.body.ok === true, `agent token: ${JSON.stringify(tk.body.error)}`);
    const asAgent = await json('/v1/admin/security/overview', { headers: { Authorization: `Bearer ${tk.body.data.token}` } });
    assert(asAgent.status === 403, `an agent token on the HTTP admin door: expected 403, got ${asAgent.status}`);
});

console.log(`\n────────────────────────────────────────`);
console.log(`MCP Scope Enforcement E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
