/**
 * @file test/e2e-mcp-core-doors.ts
 * @description The doors of src/mcp/core.ts that no suite had ever knocked on: the whole work
 *   lifecycle over MCP, the owner-scope branches of the three memory tools, the catalogue rows, the
 *   agent roster, and the two resource templates.
 *
 *   WHY THIS SUITE EXISTS. core.ts is the file every MCP session loads, and five of its tools were
 *   registered, described, scope-mapped and never called by a test: aimeat_agents_list,
 *   aimeat_action_execute, aimeat_work_inbox, aimeat_work_accept and aimeat_work_deliver. Each one
 *   delegates to the service its REST twin calls — createWorkItem, acceptWork, deliverWork — and the
 *   version history of core.ts records that all three used to be second, thinner implementations
 *   that skipped the provider resolution, the work→task bridge and the requester's callback. Nothing
 *   held the two doors together afterwards, so the same drift could return unobserved.
 *
 *   The memory branches are the other half. aimeat_memory_read answers NOT_IN_YOUR_NAMESPACE for a
 *   key that lives under the owner's GHII, aimeat_memory_write refuses owner_scope without
 *   memory:write-as-owner, and aimeat_memory_list discloses values_omitted on the owner-scope path
 *   and truncated + hint past its limit. All four exist because the silent versions of them were
 *   read as "the platform cannot share this data" and cost a redesign; a branch nobody asserts is a
 *   branch that can go quiet again.
 *
 *   HOW IT IS BUILT. Every fixture is seeded through the REST doors other suites already keep green
 *   (POST /v1/actions, POST /v1/memory, POST /v1/ghii, POST /v1/agents), the MCP tool is then driven
 *   against that seed, and the record is read back through REST. A tool that decided something its
 *   route would not shows up as a mismatch rather than as a green run.
 * @structure
 *   - Phase 1: fixtures (requester owner + agent, provider owner + agent, a read-only agent)
 *   - Phase 2: the scope fence, and the same door refused to an anonymous caller
 *   - Phase 3: aimeat_agents_list and aimeat_catalogue_search
 *   - Phase 4: the work lifecycle — execute, inbox, accept, deliver, each cross-read over REST
 *   - Phase 5: the memory branches — owner_scope read, "it lives elsewhere", the write deny,
 *     owner-scope listing and truncation
 *   - Phase 6: MCP resources — the memory mapper in resources/list, the storage blob in resources/read
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-core-doors
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: the five uncalled core tools, five branches of the memory tools,
 *     and both resource templates.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string; ghii: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'CoreDoorsTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner, ghii: `${owner}@${NODE_ID}` };
    }
}

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(
    ownerCtx: { token: string; owner: string }, scopes: string[],
): Promise<{ token: string; gaii: string; name: string }> {
    const name = `cd${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, gaii, name };
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-core-doors', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the untested doors of src/mcp/core.ts ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const ACTION_ID = `cd-scrape-${STAMP}`;
const OWNER_KEY = `cd/${STAMP}/owner-record`;
const SIBLING_KEY = `cd/${STAMP}/sibling-record`;
const OWN_KEY = `cd/${STAMP}/own-record`;

let requesterOwner: Awaited<ReturnType<typeof makeOwner>>;
let providerOwner: Awaited<ReturnType<typeof makeOwner>>;
let requester: Awaited<ReturnType<typeof makeAgent>>;
let sibling: Awaited<ReturnType<typeof makeAgent>>;
let provider: Awaited<ReturnType<typeof makeAgent>>;
let readOnly: Awaited<ReturnType<typeof makeAgent>>;
let reqSession: McpSession;
let provSession: McpSession;
let readOnlySession: McpSession;
let trackingCode = '';

console.log('\nPhase 1 — fixtures');

await test('1. Two owners, three agents of the first and one of the second', async () => {
    requesterOwner = await makeOwner('cdreq');
    providerOwner = await makeOwner('cdprov');
    // The requester commissions work, reads it back over REST, and does the memory half of the suite.
    requester = await makeAgent(requesterOwner, ['work:request', 'work:read', 'memory:read', 'memory:write', 'storage:write']);
    // A second agent of the SAME owner, so the owner-scope read has a sibling namespace to find.
    sibling = await makeAgent(requesterOwner, ['memory:write']);
    provider = await makeAgent(providerOwner, ['work:read', 'work:accept', 'work:publish', 'memory:read']);
    // The denial fixture: one read word and nothing else.
    readOnly = await makeAgent(requesterOwner, ['memory:read']);
    assert(requester.gaii.endsWith(`@${NODE_ID}`), `requester gaii: ${requester.gaii}`);
    assert(provider.gaii !== requester.gaii, 'the two sides are different principals');
});

await test('2. Three MCP sessions open on /v1/mcp', async () => {
    reqSession = await openSession(requester.token);
    provSession = await openSession(provider.token);
    readOnlySession = await openSession(readOnly.token);
    assert(typeof reqSession.sessionId === 'string' && reqSession.sessionId.length > 0,
        `the requester session got no id: ${JSON.stringify(reqSession)}`);
});

console.log('\nPhase 2 — the scope fence, and the same door to an anonymous caller');

await test('3. A memory:read agent is handed the read tools and NONE of the work or write tools', async () => {
    const names = await toolNames(readOnlySession);
    assert(names.includes('aimeat_memory_read'), 'memory:read must carry aimeat_memory_read');
    assert(names.includes('aimeat_memory_list'), 'memory:read must carry aimeat_memory_list');
    for (const gated of ['aimeat_memory_write', 'aimeat_action_execute', 'aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver']) {
        assert(!names.includes(gated), `${gated} was offered to an agent holding only memory:read`);
    }
});

await test('4. The requester agent, which holds the work words, IS handed those same tools', async () => {
    // The positive control for test 3: without it, a filter that hid everything would look correct.
    const names = await toolNames(reqSession);
    for (const t of ['aimeat_action_execute', 'aimeat_memory_write', 'aimeat_agents_list', 'aimeat_catalogue_search']) {
        assert(names.includes(t), `${t} missing from the requester's surface`);
    }
    const provNames = await toolNames(provSession);
    for (const t of ['aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver']) {
        assert(provNames.includes(t), `${t} missing from the provider's surface`);
    }
});

console.log('\nPhase 3 — the roster and the catalogue');

await test('5. aimeat_agents_list returns the CALLER\'s owner roster, and it matches GET /v1/agents', async () => {
    const r = await callTool(reqSession, 'aimeat_agents_list', {});
    assert(!r.isError, `agents_list refused: ${r.text}`);
    const gaiis: string[] = (r.data.agents ?? []).map((a: any) => a.gaii);
    assert(gaiis.includes(requester.gaii), `own gaii missing: ${JSON.stringify(gaiis)}`);
    assert(gaiis.includes(sibling.gaii), `sibling gaii missing: ${JSON.stringify(gaiis)}`);
    assert(!gaiis.includes(provider.gaii), `another owner's agent leaked into the roster: ${JSON.stringify(gaiis)}`);

    const rest = await json('/v1/agents', { headers: authed(requesterOwner.token) });
    assert(rest.status === 200, `GET /v1/agents ${rest.status}`);
    const restGaiis: string[] = (rest.body.data.agents ?? []).map((a: any) => a.gaii);
    assert(restGaiis.length === gaiis.length,
        `the tool and the route disagree on the roster size: ${gaiis.length} vs ${restGaiis.length}`);
    for (const g of restGaiis) assert(gaiis.includes(g), `${g} is on the route and not on the tool`);
});

await test('6. The provider publishes an action over REST, with directives so the task bridge is live', async () => {
    // Directives are what services/work-task-bridge.ts reads as "this agent runs tasks"; without
    // them accepting work creates no task and test 11 would be asserting an absence.
    const dir = await json(`/v1/agents/${provider.name}/directives`, {
        method: 'PUT', headers: authed(providerOwner.token),
        body: JSON.stringify({
            purpose: 'Core doors E2E provider',
            rules: [{ id: 'rule-1', description: 'Deliver what was commissioned' }],
            memory_areas: [], resources: [],
        }),
    });
    assert(dir.status === 200, `directives ${dir.status}: ${JSON.stringify(dir.body)}`);

    const { status, body } = await json('/v1/actions', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({
            id: ACTION_ID,
            display_name: 'Core doors scrape',
            description: 'Scrapes a URL for the core-doors E2E',
            input_schema: { type: 'object', properties: { url: { type: 'string' } } },
            output_schema: { type: 'object', properties: { content: { type: 'string' } } },
            pricing: { base_morsels: 10 },
            tags: ['e2e', 'core-doors'],
        }),
    });
    assert(status === 201, `publish action ${status}: ${JSON.stringify(body)}`);
});

await test('7. aimeat_catalogue_search returns that row with its provider and its price', async () => {
    const r = await callTool(reqSession, 'aimeat_catalogue_search', { search: 'Core doors scrape' });
    assert(!r.isError, `catalogue_search refused: ${r.text}`);
    const rows: any[] = Array.isArray(r.data) ? r.data : (r.data.items ?? r.data.results ?? []);
    const mine = rows.find((a: any) => a.action_id === ACTION_ID);
    assert(mine !== undefined, `the published action is not in the answer: ${r.text.slice(0, 400)}`);
    assert(mine.provider_gaii === provider.gaii, `provider_gaii: ${mine.provider_gaii}`);
    assert(mine.pricing?.baseMorsels === 10,
        `the price did not survive the mapping: ${JSON.stringify(mine.pricing)}`);
});

console.log('\nPhase 4 — the work lifecycle, entirely over MCP');

await test('8. aimeat_action_execute commissions the work and holds the escrow', async () => {
    const r = await callTool(reqSession, 'aimeat_action_execute', {
        action_id: ACTION_ID, provider_gaii: provider.gaii, input: { url: 'https://example.com/core-doors' },
    });
    assert(!r.isError, `action_execute refused: ${r.text}`);
    trackingCode = r.data.tracking_code;
    assert(typeof trackingCode === 'string' && trackingCode.length > 0, `no tracking code: ${r.text}`);
    assert(r.data.status === 'pending', `status: ${r.data.status}`);
    assert(r.data.cost?.total > 0, `the cost is not carried: ${JSON.stringify(r.data.cost)}`);

    // The route's own view of the same row — one implementation, so the two must agree.
    const rest = await json(`/v1/work/${trackingCode}`, { headers: authed(requester.token) });
    assert(rest.status === 200, `GET /v1/work/${trackingCode} ${rest.status}: ${JSON.stringify(rest.body)}`);
    assert(rest.body.data.provider_gaii === provider.gaii, `provider on the record: ${rest.body.data.provider_gaii}`);
    assert(rest.body.data.requester_gaii === requester.gaii, `requester on the record: ${rest.body.data.requester_gaii}`);
    assert(rest.body.data.cost.total === r.data.cost.total, 'the tool and the route report different costs');
});

await test('9. An anonymous caller is refused the same work door (401)', async () => {
    const anon = await json(`/v1/work/${trackingCode}`);
    assert(anon.status === 401, `an anonymous caller read a work item: ${anon.status} ${JSON.stringify(anon.body)}`);
});

await test('10. aimeat_work_inbox shows the provider the pending item', async () => {
    const r = await callTool(provSession, 'aimeat_work_inbox', {});
    assert(!r.isError, `work_inbox refused: ${r.text}`);
    const items: any[] = Array.isArray(r.data) ? r.data : (r.data.items ?? []);
    const mine = items.find((w: any) => w.tracking_code === trackingCode);
    assert(mine !== undefined, `the commissioned item is not in the inbox: ${r.text.slice(0, 400)}`);
    assert(mine.status === 'pending', `status in the inbox: ${mine.status}`);
    assert(mine.requester_gaii === requester.gaii, `requester in the inbox: ${mine.requester_gaii}`);
});

await test('11. aimeat_work_accept takes the job on, and the work→task bridge runs', async () => {
    const r = await callTool(provSession, 'aimeat_work_accept', { tracking_code: trackingCode });
    assert(!r.isError, `work_accept refused: ${r.text}`);
    assert(r.data.status === 'accepted', `status: ${r.text}`);

    const rest = await json(`/v1/work/${trackingCode}`, { headers: authed(requester.token) });
    assert(rest.body.data.status === 'accepted', `the route sees ${rest.body.data.status}`);

    // The half this tool used to skip: accepting over MCP wrote the status and created no task, so
    // the agent that accepted had nothing to work from.
    const tasks = await json(`/v1/agents/${provider.name}/tasks`, { headers: authed(providerOwner.token) });
    assert(tasks.status === 200, `GET /v1/agents/${provider.name}/tasks ${tasks.status}`);
    const bridged = (tasks.body.data.tasks ?? []).find((t: any) => t.workTrackingCode === trackingCode);
    assert(bridged !== undefined,
        `no task was bridged for ${trackingCode}: ${JSON.stringify((tasks.body.data.tasks ?? []).map((t: any) => t.workTrackingCode))}`);
});

await test('12. A second accept of the same item is refused, and the item stays accepted', async () => {
    const r = await callTool(provSession, 'aimeat_work_accept', { tracking_code: trackingCode });
    assert(r.isError, `a second accept succeeded: ${r.text}`);
    const rest = await json(`/v1/work/${trackingCode}`, { headers: authed(requester.token) });
    assert(rest.body.data.status === 'accepted', `a refused accept moved the item to ${rest.body.data.status}`);
});

await test('13. aimeat_work_deliver settles it, and the output is on the record', async () => {
    const r = await callTool(provSession, 'aimeat_work_deliver', {
        tracking_code: trackingCode, output: { content: 'core-doors delivered' },
    });
    assert(!r.isError, `work_deliver refused: ${r.text}`);
    assert(r.data.status === 'delivered', `status: ${r.text}`);

    const rest = await json(`/v1/work/${trackingCode}`, { headers: authed(requester.token) });
    assert(rest.body.data.status === 'delivered', `the route sees ${rest.body.data.status}`);
    assert(rest.body.data.output?.content === 'core-doors delivered',
        `the delivered output is not on the record: ${JSON.stringify(rest.body.data.output)}`);
});

console.log('\nPhase 5 — the memory branches');

await test('14. The OWNER writes a record over REST, so it lands under the owner GHII', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authed(requesterOwner.token),
        body: JSON.stringify({ key: OWNER_KEY, value: { by: 'owner' }, visibility: 'owner' }),
    });
    assert(w.status === 201, `owner write ${w.status}: ${JSON.stringify(w.body)}`);
    const s = await json('/v1/memory', {
        method: 'POST', headers: authed(sibling.token),
        body: JSON.stringify({ key: SIBLING_KEY, value: { by: 'sibling' }, visibility: 'owner' }),
    });
    assert(s.status === 201, `sibling write ${s.status}: ${JSON.stringify(s.body)}`);
});

await test('15. aimeat_memory_read without owner_scope says WHERE the record lives, not "not found"', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_read', { key: OWNER_KEY });
    assert(r.isError, `the agent read another namespace as its own: ${r.text}`);
    assert(r.data.error === 'NOT_IN_YOUR_NAMESPACE', `code: ${r.text.slice(0, 300)}`);
    assert(r.data.found_under === requesterOwner.ghii, `found_under: ${r.data.found_under}`);
    assert(r.data.your_namespace === requester.gaii, `your_namespace: ${r.data.your_namespace}`);
    assert(typeof r.data.read_it === 'string' && r.data.read_it.includes('owner_scope'),
        `the refusal must name the retry: ${r.data.read_it}`);
});

await test('16. …and with owner_scope: true it returns the owner\'s record', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_read', { key: OWNER_KEY, owner_scope: true });
    assert(!r.isError, `owner-scope read refused: ${r.text}`);
    assert(r.data.key === OWNER_KEY, `key: ${r.data.key}`);
    assert(r.data.value?.by === 'owner', `value: ${JSON.stringify(r.data.value)}`);
});

await test('17. The same flag reaches a SIBLING agent\'s record, which is the other half of the scope', async () => {
    const blind = await callTool(reqSession, 'aimeat_memory_read', { key: SIBLING_KEY });
    assert(blind.isError && blind.data.found_under === sibling.gaii,
        `the sibling's namespace was not named: ${blind.text.slice(0, 300)}`);
    const seen = await callTool(reqSession, 'aimeat_memory_read', { key: SIBLING_KEY, owner_scope: true });
    assert(!seen.isError, `owner-scope read of a sibling key refused: ${seen.text}`);
    assert(seen.data.value?.by === 'sibling', `value: ${JSON.stringify(seen.data.value)}`);
});

await test('18. A key nobody in the owner scope holds still answers a plain miss', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_read', { key: `cd/${STAMP}/nothing-here`, owner_scope: true });
    assert(r.isError, 'a missing key must refuse');
    assert(r.text.includes('Memory not found'), `expected the bare miss, got: ${r.text.slice(0, 200)}`);
});

await test('19. aimeat_memory_write REFUSES owner_scope from a session without memory:write-as-owner', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_write', {
        key: `cd/${STAMP}/delegated`, value: { by: 'agent' }, owner_scope: true,
    });
    assert(r.isError, `a scope-less delegated write succeeded: ${r.text}`);
    assert(r.data.error === 'SCOPE_DENIED', `code: ${r.text.slice(0, 300)}`);
    assert(typeof r.data.message === 'string' && r.data.message.includes('memory:write-as-owner'),
        `the refusal must name the scope: ${r.data.message}`);
    // Refuse before you write: nothing landed in either namespace.
    const owner = await json(`/v1/memory/${encodeURIComponent(`cd/${STAMP}/delegated`)}?owner_scope=true`, {
        headers: authed(requesterOwner.token),
    });
    assert(owner.status === 404, `the refused write left a record: ${owner.status}`);
});

await test('20. …and the same write WITHOUT the flag lands in the agent\'s own namespace', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_write', { key: OWN_KEY, value: { by: 'agent' }, tags: ['cd'] });
    assert(!r.isError, `plain write refused: ${r.text}`);
    assert(r.data.written === true, `written: ${r.text}`);
    assert(r.data.owner_gaii === requester.gaii, `it landed under ${r.data.owner_gaii}`);
    assert(r.data.wrote_as_owner === undefined, 'a plain write must not report itself as delegated');
});

await test('21. aimeat_memory_list with owner_scope aggregates the identities and says values are omitted', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_list', { prefix: `cd/${STAMP}/`, owner_scope: true });
    assert(!r.isError, `owner-scope list refused: ${r.text}`);
    assert(r.data.values_omitted === true, `values_omitted: ${r.text.slice(0, 300)}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('owner_scope'),
        `the note must name the flag: ${r.data.note}`);
    const keys: string[] = (r.data.items ?? []).map((i: any) => i.key);
    for (const k of [OWNER_KEY, SIBLING_KEY, OWN_KEY]) {
        assert(keys.includes(k), `${k} missing from the owner-scope listing: ${JSON.stringify(keys)}`);
    }
    const ownerRow = (r.data.items ?? []).find((i: any) => i.key === OWNER_KEY);
    assert(ownerRow.owner_gaii === requesterOwner.ghii, `the row must name its holder, got ${ownerRow.owner_gaii}`);
    assert(ownerRow.value === undefined, 'an owner-scope listing must carry no values');
});

await test('22. …and past `limit` it says truncated, with the hint that names the cap', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_list', { prefix: `cd/${STAMP}/`, owner_scope: true, limit: 1 });
    assert(!r.isError, `truncated list refused: ${r.text}`);
    assert(r.data.truncated === true, `truncated: ${r.text.slice(0, 300)}`);
    assert(r.data.shown === 1 && (r.data.items ?? []).length === 1, `shown: ${r.data.shown}`);
    assert(typeof r.data.hint === 'string' && r.data.hint.includes('Showing first 1'),
        `the hint must state the cap: ${r.data.hint}`);
});

await test('23. A plain listing of the agent\'s own namespace carries neither note', async () => {
    const r = await callTool(reqSession, 'aimeat_memory_list', { prefix: `cd/${STAMP}/` });
    assert(!r.isError, `plain list refused: ${r.text}`);
    const items: any[] = Array.isArray(r.data) ? r.data : (r.data.items ?? []);
    assert(items.some((i: any) => i.key === OWN_KEY), `own key missing: ${r.text.slice(0, 300)}`);
    assert(!items.some((i: any) => i.key === OWNER_KEY), 'a plain listing must not reach the owner GHII');
    assert(r.data.values_omitted === undefined, 'the owner-scope note appeared on a plain listing');
});

console.log('\nPhase 6 — the two resource templates');

await test('24. resources/list carries the agent\'s own memory records through the aimeat://memory mapper', async () => {
    const body = await mcpRpc(reqSession, 'resources/list', {});
    const resources: any[] = body?.result?.resources ?? [];
    const mine = resources.find((r: any) => r.uri === `aimeat://memory/${encodeURIComponent(OWN_KEY)}`);
    assert(mine !== undefined,
        `the written key is not in resources/list: ${JSON.stringify(resources.map((r: any) => r.uri).slice(0, 20))}`);
    assert(mine.name === OWN_KEY, `name: ${mine.name}`);
    assert(mine.mimeType === 'application/json', `mimeType: ${mine.mimeType}`);
    assert(typeof mine.description === 'string' && mine.description.includes(OWN_KEY),
        `description: ${mine.description}`);
});

await test('25. resources/read on that memory uri returns the stored value', async () => {
    const body = await mcpRpc(reqSession, 'resources/read', { uri: `aimeat://memory/${encodeURIComponent(OWN_KEY)}` });
    const contents = body?.result?.contents?.[0];
    assert(contents !== undefined, `no contents: ${JSON.stringify(body).slice(0, 300)}`);
    assert(JSON.parse(contents.text).by === 'agent', `value: ${contents.text}`);
});

await test('26. A file uploaded with aimeat_storage_upload comes back as a blob on aimeat://storage', async () => {
    const key = `cd-${STAMP}.txt`;
    const payload = `core doors ${STAMP}`;
    const up = await callTool(reqSession, 'aimeat_storage_upload', {
        key, data_base64: Buffer.from(payload, 'utf8').toString('base64'), mime_type: 'text/plain',
    });
    assert(!up.isError, `storage_upload refused: ${up.text}`);

    const listed = await mcpRpc(reqSession, 'resources/list', {});
    const row = (listed?.result?.resources ?? []).find((r: any) => r.uri === `aimeat://storage/${encodeURIComponent(key)}`);
    assert(row !== undefined, `the uploaded file is not in resources/list: ${key}`);
    assert(row.mimeType === 'text/plain', `mimeType: ${row.mimeType}`);
    assert(typeof row.description === 'string' && row.description.includes('bytes'),
        `the storage description must state the size: ${row.description}`);

    const read = await mcpRpc(reqSession, 'resources/read', { uri: `aimeat://storage/${encodeURIComponent(key)}` });
    const contents = read?.result?.contents?.[0];
    assert(contents !== undefined, `no contents: ${JSON.stringify(read).slice(0, 300)}`);
    assert(typeof contents.blob === 'string', 'a storage resource answers with a blob, never text');
    assert(Buffer.from(contents.blob, 'base64').toString('utf8') === payload,
        `the bytes did not survive the round trip: ${contents.blob.slice(0, 40)}`);
});

await test('27. A storage key the caller does not hold answers "Not found" rather than another namespace', async () => {
    const read = await mcpRpc(reqSession, 'resources/read', { uri: `aimeat://storage/${encodeURIComponent(`cd-missing-${STAMP}.txt`)}` });
    assert(read?.result?.contents?.[0]?.text === 'Not found',
        `expected the miss, got ${JSON.stringify(read?.result?.contents?.[0]).slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
