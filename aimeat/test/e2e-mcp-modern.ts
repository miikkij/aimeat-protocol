/**
 * @file test/e2e-mcp-modern.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP 2026-07-28 on /v1/mcp and /v2/mcp/:role (mcp/modern-endpoint.ts). A request that
 *   carries the per-request `_meta` envelope is served statelessly by the SDK v2 handler; anything
 *   else keeps the 2025-era session code on the same URL.
 *
 *   HAPPY PATH: server/discover, tools/list and tools/call with the three standard headers, no
 *   session id, the same tool list a 2025 session gets, and a real SDK v2 client that negotiates
 *   2026-07-28 by itself. FAILURE MODES: a header that disagrees with the body (400, -32020), a modern
 *   header without the envelope (400, -32602), a revision the node does not serve (400, -32022), no
 *   token (401 with the resource-metadata challenge, the public tools/list excepted), a scope the
 *   agent lacks (SCOPE_DENIED), another owner's agent reading the same key (its own empty namespace),
 *   and a deleted agent's token (refused). CHANGE NOTIFICATIONS: an open subscriptions/listen stream
 *   hears tools/list_changed after the owner narrows the agent's scopes, and deleting the agent
 *   closes the stream (mcp/session-registry.ts).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-modern
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (MCP SDK v2 migration steps 5 and 6, plan doc-mvguy322f9se).
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, toolNames, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const MODERN = '2026-07-28';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

/** The per-request envelope every modern request carries in params._meta. */
function envelope(version = MODERN): Record<string, unknown> {
    return {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'e2e-mcp-modern', version: '1.0.0' },
    };
}

/** The three standard headers of a modern request POST (SEP-2243). */
function standardHeaders(method: string, name?: string, version = MODERN): Record<string, string> {
    return { 'MCP-Protocol-Version': version, 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) };
}

interface Answer { status: number; headers: Headers; body: any }

let rpcId = 0;
/** One modern POST. `headers` replaces the standard headers when given; `params._meta` is added unless `noEnvelope`. */
async function modern(path: string, token: string | null, method: string, params: Record<string, unknown> = {}, opts: { headers?: Record<string, string>; version?: string; noEnvelope?: boolean } = {}): Promise<Answer> {
    const name = typeof params.name === 'string' ? params.name : undefined;
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers ?? standardHeaders(method, name, opts.version)),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: opts.noEnvelope ? params : { ...params, _meta: envelope(opts.version) } }),
    });
    const text = await res.text();
    const dataLine = text.split('\n').find(l => l.startsWith('data:'));
    let body: any;
    try { body = JSON.parse(dataLine ? dataLine.slice(5) : text); } catch { body = { _raw: text.slice(0, 300) }; }
    return { status: res.status, headers: res.headers, body };
}

async function rest(path: string, method: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { _raw: text } }; }
}

function toolText(answer: Answer): string { return String(answer.body?.result?.content?.[0]?.text ?? ''); }

console.log('\n=== MCP 2026-07-28 (stateless) E2E ===\n');

let alice = { name: '', token: '' };
let bob = { name: '', token: '' };
let agent: McpAgent;
let narrow: McpAgent;
let bobAgent: McpAgent;

await test('Setup: two owners, a broad agent and a memory:read agent for the first, one agent for the second', async () => {
    alice = await registerOwner(BASE, `modern${Date.now().toString(36)}a`);
    bob = await registerOwner(BASE, `modern${Date.now().toString(36)}b`);
    agent = await makeAgent(BASE, alice, ['memory:read', 'memory:write', 'agent:read', 'wallet:read', 'contacts:read']);
    narrow = await makeAgent(BASE, alice, ['memory:read']);
    bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write']);
    assert(agent.gaii.includes(`#${alice.name}@`) && bobAgent.gaii.includes(`#${bob.name}@`), `each agent belongs to its owner: ${agent.gaii}, ${bobAgent.gaii}`);
});

await test('server/discover with a token names 2026-07-28 and the capabilities, without a session id', async () => {
    const r = await modern('/v1/mcp', agent.token, 'server/discover');
    assert(r.status === 200, `discover ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(r.headers.get('mcp-session-id') === null, 'a modern answer sets no session id');
    assert(r.body.result?.supportedVersions?.includes(MODERN), `supportedVersions: ${JSON.stringify(r.body.result?.supportedVersions)}`);
    assert(r.body.result?.capabilities?.tools?.listChanged === true, 'tools.listChanged is declared');
    assert(r.body.result?.capabilities?.resources?.subscribe === undefined, 'resources.subscribe is not declared (decision 12)');
    assert(typeof r.body.result?.instructions === 'string' && r.body.result.instructions.length > 100, 'the instructions come with discover');
});

await test('tools/list on 2026-07-28 is the same list a 2025 session gets, marked uncacheable', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list');
    assert(r.status === 200, `tools/list ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const modernNames = (r.body.result?.tools ?? []).map((t: any) => t.name).sort();
    const legacyNames = (await toolNames(await openSession(BASE, agent.token, 'e2e-mcp-modern-legacy'))).sort();
    assert(modernNames.length > 0, 'the modern list is not empty');
    assert(JSON.stringify(modernNames) === JSON.stringify(legacyNames), `the lists differ: modern ${modernNames.length}, legacy ${legacyNames.length}`);
    assert(r.body.result?.ttlMs === 0, `ttlMs is 0 until notifications reach every client (decision 14): ${r.body.result?.ttlMs}`);
});

await test('tools/call on 2026-07-28 writes and reads back under the agent, with the serverInfo stamp', async () => {
    const w = await modern('/v1/mcp', agent.token, 'tools/call', { name: 'aimeat_memory_write', arguments: { key: 'modern/probe', value: { era: MODERN } } });
    assert(w.status === 200 && w.body.result?.isError !== true, `write: ${w.status} ${toolText(w).slice(0, 200)}`);
    const r = await modern('/v1/mcp', agent.token, 'tools/call', { name: 'aimeat_memory_read', arguments: { key: 'modern/probe' } });
    assert(r.status === 200 && r.body.result?.isError !== true, `read: ${r.status} ${toolText(r).slice(0, 200)}`);
    assert(toolText(r).includes(MODERN), `the value written is read back: ${toolText(r).slice(0, 200)}`);
    assert(r.body.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name, 'the result carries the serverInfo stamp');
});

await test('A role surface (/v2/mcp/chat) serves 2026-07-28 as well', async () => {
    const r = await modern('/v2/mcp/chat', agent.token, 'tools/list');
    assert(r.status === 200, `chat tools/list ${r.status}`);
    const names = (r.body.result?.tools ?? []).map((t: any) => t.name);
    assert(names.includes('aimeat_memory_read') && names.length < 60, `the chat surface lists its small set: ${names.length}`);
});

// Decision 2026-10-20, item 4: the chat surface lists its core set on 2026-07-28 too, and with no
// session to keep a switched-on tool, a call by name and aimeat_invoke reach any permitted tool.
await test('On chat, 2026-07-28: a tool off the core list runs by name, aimeat_invoke runs another, and the finder names a third', async () => {
    const listed = (await modern('/v2/mcp/chat', agent.token, 'tools/list')).body.result?.tools?.map((t: any) => t.name) ?? [];
    assert(!listed.includes('aimeat_wallet_balance') && !listed.includes('aimeat_contact_list'), 'wallet_balance and contact_list are off the core list');
    const wallet = await modern('/v2/mcp/chat', agent.token, 'tools/call', { name: 'aimeat_wallet_balance', arguments: {} });
    assert(wallet.body.result?.isError !== true && toolText(wallet).includes('balance'), `a call by name runs: ${toolText(wallet).slice(0, 200)}`);
    const viaInvoke = await modern('/v2/mcp/chat', agent.token, 'tools/call', { name: 'aimeat_invoke', arguments: { capability: 'aimeat_contact_list', input: {} } });
    assert(viaInvoke.body.result?.isError !== true && toolText(viaInvoke).includes('contacts'), `invoke runs it: ${toolText(viaInvoke).slice(0, 200)}`);
    const found = await modern('/v2/mcp/chat', agent.token, 'tools/call', { name: 'aimeat_tools_find', arguments: { purpose: 'list my contacts' } });
    assert(toolText(found).includes('aimeat_contact_list'), `the finder names contact_list: ${toolText(found).slice(0, 200)}`);
});

await test('An SDK v2 client negotiates 2026-07-28 by itself and calls a tool', async () => {
    const client = new Client({ name: 'e2e-mcp-modern-sdk', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } } as never);
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/v1/mcp`), { requestInit: { headers: { Authorization: `Bearer ${agent.token}` } } });
    await client.connect(transport);
    try {
        const era = (client as unknown as { getNegotiatedProtocolVersion?: () => string }).getNegotiatedProtocolVersion?.();
        assert(era === MODERN, `negotiated ${era}`);
        const r = await client.callTool({ name: 'aimeat_memory_read', arguments: { key: 'modern/probe' } });
        assert(JSON.stringify(r.content).includes(MODERN), `call: ${JSON.stringify(r).slice(0, 200)}`);
    } finally { await client.close(); }
});

await test('A 2025 client on the same URL still gets a session', async () => {
    const s = await openSession(BASE, agent.token, 'e2e-mcp-modern-2025');
    assert(typeof s.sessionId === 'string' && s.sessionId.length > 0, 'initialize set a session id');
});

await test('→400 -32020 when the MCP-Protocol-Version header disagrees with the envelope', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list', {}, { headers: standardHeaders('tools/list', undefined, '2025-11-25') });
    assert(r.status === 400 && r.body.error?.code === -32020, `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('→400 -32020 when the Mcp-Method header disagrees with the body', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list', {}, { headers: standardHeaders('tools/call') });
    assert(r.status === 400 && r.body.error?.code === -32020, `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('→400 -32020 when the standard headers are missing', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list', {}, { headers: {} });
    assert(r.status === 400 && r.body.error?.code === -32020, `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('→400 -32602 when a modern header comes without the envelope', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list', {}, { noEnvelope: true });
    assert(r.status === 400 && r.body.error?.code === -32602, `${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('→400 -32022 for a revision the node does not serve, naming the one it does', async () => {
    const r = await modern('/v1/mcp', agent.token, 'tools/list', {}, { version: '2099-01-01' });
    assert(r.status === 400 && r.body.error?.code === -32022, `${r.status} ${JSON.stringify(r.body.error)}`);
    assert(r.body.error?.data?.supported?.includes(MODERN), `supported: ${JSON.stringify(r.body.error?.data)}`);
});

await test('→401 with the resource-metadata challenge for server/discover and tools/call without a token', async () => {
    for (const [method, params] of [['server/discover', {}], ['tools/call', { name: 'aimeat_memory_list', arguments: {} }]] as const) {
        const r = await modern('/v1/mcp', null, method, params);
        assert(r.status === 401, `${method} without a token: ${r.status}`);
        assert((r.headers.get('www-authenticate') ?? '').includes('resource_metadata='), `${method}: WWW-Authenticate ${r.headers.get('www-authenticate')}`);
    }
});

await test('tools/list without a token stays the public catalogue (decision 3), in the modern result shape', async () => {
    const r = await modern('/v1/mcp', null, 'tools/list');
    assert(r.status === 200, `public tools/list ${r.status}`);
    assert((r.body.result?.tools ?? []).length > 0, 'the public list is not empty');
    assert(r.body.result?.resultType === 'complete' && r.body.result?.cacheScope === 'public', `result shape: ${JSON.stringify({ resultType: r.body.result?.resultType, cacheScope: r.body.result?.cacheScope })}`);
});

await test('→SCOPE_DENIED: a memory:read agent cannot write on 2026-07-28 either', async () => {
    const r = await modern('/v1/mcp', narrow.token, 'tools/call', { name: 'aimeat_memory_write', arguments: { key: 'modern/denied', value: 'x' } });
    assert(r.body.result?.isError === true && toolText(r).startsWith('SCOPE_DENIED'), `${r.status} ${toolText(r).slice(0, 200)}`);
});

await test("→ another owner's agent reading the same key reads its own empty namespace, never the first owner's value", async () => {
    const r = await modern('/v1/mcp', bobAgent.token, 'tools/call', { name: 'aimeat_memory_read', arguments: { key: 'modern/probe', owner_scope: true } });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.result?.isError === true && !toolText(r).includes(MODERN), `the other owner's value leaked: ${toolText(r).slice(0, 200)}`);
});

// Change notifications: one listen stream, read as it arrives.
let listenReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let listenBuffer = '';
const decoder = new TextDecoder();

/** Read the listen stream until `want` appears in it or the stream ends; answers what happened. */
async function readUntil(want: string, ms: number): Promise<'seen' | 'closed' | 'timeout'> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (listenBuffer.includes(want)) return 'seen';
        const chunk = await Promise.race([
            listenReader!.read(),
            new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), Math.max(1, deadline - Date.now()))),
        ]);
        if (chunk === 'timeout') break;
        if (chunk.done) return listenBuffer.includes(want) ? 'seen' : 'closed';
        listenBuffer += decoder.decode(chunk.value, { stream: true });
    }
    return listenBuffer.includes(want) ? 'seen' : 'timeout';
}

await test('subscriptions/listen opens a stream that acknowledges the subscription', async () => {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agent.token}`, ...standardHeaders('subscriptions/listen') },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true }, _meta: envelope() } }),
    });
    assert(res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/event-stream'), `listen ${res.status} ${res.headers.get('content-type')}`);
    listenReader = res.body!.getReader();
    const ack = await readUntil('notifications/subscriptions/acknowledged', 5000);
    assert(ack === 'seen', `the acknowledgement: ${ack}; stream so far: ${listenBuffer.slice(0, 300)}`);
});

await test('Narrowing the agent\'s scopes reaches the open stream as tools/list_changed', async () => {
    assert(listenReader !== undefined, 'the listen stream is open');
    const p = await rest(`/v1/agents/${agent.name}/scopes`, 'PATCH', alice.token, { scopes: ['memory:read', 'agent:read'] });
    assert(p.status === 200, `PATCH scopes ${p.status}: ${JSON.stringify(p.body).slice(0, 200)}`);
    const heard = await readUntil('notifications/tools/list_changed', 5000);
    assert(heard === 'seen', `tools/list_changed: ${heard}; stream: ${listenBuffer.slice(-300)}`);
});

await test('Deleting the agent closes its open listen stream, and its token is refused', async () => {
    assert(listenReader !== undefined, 'the listen stream is open');
    const d = await rest(`/v1/agents/${agent.name}`, 'DELETE', alice.token);
    assert(d.status === 200, `DELETE agent ${d.status}: ${JSON.stringify(d.body).slice(0, 200)}`);
    const end = await readUntil('\u0000never', 5000);
    assert(end === 'closed', `the stream after the delete: ${end}`);
    const r = await modern('/v1/mcp', agent.token, 'tools/list');
    // A token whose agent is gone is refused 401: authenticate() refuses a revoked token, and the
    // admission (services/mcp-agent-admission.ts) refuses an unknown agent, both with 401.
    assert(r.status === 401, `a deleted agent's token: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
});

if (listenReader) await listenReader.cancel().catch(() => undefined);

console.log(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
