/**
 * @file test/e2e-mcp-crew.ts
 * @description The chat path to building an agent: the five aimeat_crew_* tools over a real MCP
 *   session, with the tunnel harness standing in for the agent's runtime (it answers `invoke`
 *   frames the way a crewaimeat JSON runtime does). Proves the loop a person's own AI runs —
 *   read → validate → try → publish → read again — lands the definition in the AGENT's namespace,
 *   and that the shortcut which cost a day (a plain aimeat_memory_write of crews.registry.<agent>
 *   from the chat principal) is refused with the pointer to the right tool.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-crew
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
function parseSSE(text: string, id: number): any {
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
    }
    return {};
}

interface Session { token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

async function callTool(s: Session, name: string, args: Record<string, unknown>) {
    const body = await rpc(s, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* plain text answer */ }
    return { isError: body?.result?.isError === true || body?.error !== undefined, text, data };
}

/** The runtime stand-in: validate by looking at the doc, try by echoing the prompt. */
const BAD_ERRORS = ["agents[0] (r): unknown tool 'taikasauva' (known: app_build, article_fetch, web)"];
function runtimeReply(f: any): { ok: boolean; result: unknown } {
    const doc = f.input?.doc ?? {};
    if (f.capability === 'crew.validate') {
        const bad = (doc.agents ?? []).some((a: any) => (a.tools ?? []).includes('taikasauva'));
        return { ok: true, result: { errors: bad ? BAD_ERRORS : [] } };
    }
    if (f.capability === 'crew.try') return { ok: true, result: { output: `ran once with: ${f.input?.prompt}`, duration_ms: 7 } };
    return { ok: false, result: { code: 'UNSUPPORTED', message: `no ${f.capability}` } };
}

const stamp = Date.now();
const owner = `mcrew${stamp}`;
const agentName = 'crewchat';
let ownerToken = '';
let agentToken = '';
let agentGaii = '';
let session: Session;
let tunnel: TunnelClient | null = null;

const goodDoc = {
    agent_name: agentName,
    agents: [{ name: 'r', role: 'Researcher', goal: 'Find', backstory: 'Reads', tools: ['web'], allow_delegation: false }],
    tasks: [{ id: 'research', description: 'Do this: {{ctx.prompt}}', expected_output: 'A brief', agent: 'r', context: [], async: false }],
};
const badDoc = { ...goodDoc, agents: [{ ...goodDoc.agents[0], tools: ['taikasauva'] }] };

console.log('\n=== aimeat_crew_* over MCP — E2E ===\n');

console.log('Setup');
await test('Owner, agent, agent MCP session, agent on the tunnel as its own runtime', async () => {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'McpCrewFlow1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: await sign(reg.body.data.private_key, owner + NODE_ID + ts) }) });
    ownerToken = tok.body.data.token;

    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: agentName, owner, capabilities: ['memory'], mode: 'task-runner', scopes: ['*'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    agentGaii = ag.body.data.agent.gaii;
    const agentKey = ag.body.data.private_key as string;
    const agTs = new Date().toISOString();
    const agTok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: agTs, signature: await sign(agentKey, agentGaii + agTs) }) });
    agentToken = agTok.body.data.token;

    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'mcp crew e2e', redirect_uris: [] }) });
    const ats = new Date().toISOString();
    const params = new URLSearchParams({ response_type: 'code', client_id: client.body.client_id, gaii: agentGaii, signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }) });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);
    session = { token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp crew e2e', version: '1.0.0' } });

    tunnel = await TunnelClient.connect(BASE, agentToken);
    await tunnel.waitForBacklog(1000);
    tunnel.onInvoke(runtimeReply);
});

console.log('\nThe loop');
await test('1. The five tools are on the session', async () => {
    const list = await rpc(session, 'tools/list', {});
    const names = new Set((list?.result?.tools ?? []).map((t: any) => t.name));
    for (const n of ['aimeat_crew_get', 'aimeat_crew_validate', 'aimeat_crew_try', 'aimeat_crew_draft', 'aimeat_crew_publish']) assert(names.has(n), `${n} listed`);
});
await test('2. aimeat_crew_get on an empty agent: no definition, online', async () => {
    const r = await callTool(session, 'aimeat_crew_get', { target_agent_name: agentName });
    assert(!r.isError, `get: ${r.text}`);
    assert(r.data.published === null && r.data.online === true, `empty + online: ${r.text}`);
});
await test('3. aimeat_crew_validate returns the runtime\'s messages verbatim', async () => {
    const r = await callTool(session, 'aimeat_crew_validate', { target_agent_name: agentName, doc: badDoc });
    assert(!r.isError, `validate: ${r.text}`);
    assert(r.data.valid === false && JSON.stringify(r.data.errors) === JSON.stringify(BAD_ERRORS), `verbatim: ${r.text}`);
});
await test('4. aimeat_crew_publish with a dirty doc is refused with CREW_INVALID and writes nothing', async () => {
    const r = await callTool(session, 'aimeat_crew_publish', { target_agent_name: agentName, doc: badDoc });
    assert(r.isError && r.data?.error?.code === 'CREW_INVALID', `refusal: ${r.text}`);
    const get = await callTool(session, 'aimeat_crew_get', { target_agent_name: agentName });
    assert(get.data.published === null, 'nothing published');
});
await test('5. aimeat_crew_publish lands revision 1 in the AGENT\'s namespace', async () => {
    const r = await callTool(session, 'aimeat_crew_publish', { target_agent_name: agentName, doc: goodDoc });
    assert(!r.isError && r.data.revision === 1, `publish: ${r.text}`);
    const live = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(live.status === 200 && live.body.data?.value?.doc?.agent_name === agentName, `live key in ${agentGaii}: ${live.status}`);
    const get = await callTool(session, 'aimeat_crew_get', { target_agent_name: agentName });
    assert(get.data.published?.revision === 1 && get.data.published?.publishedBy === agentGaii, `read back: ${get.text}`);
});
await test('6. aimeat_crew_try runs once and returns the output in one call', async () => {
    const r = await callTool(session, 'aimeat_crew_try', { target_agent_name: agentName, doc: goodDoc, prompt: 'kissoista', wait_seconds: 20 });
    assert(!r.isError, `try: ${r.text}`);
    assert(r.data.status === 'done' && r.data.result?.output === 'ran once with: kissoista', `output: ${r.text}`);
});
await test('7. aimeat_crew_draft saves, shows in get, and is discarded by omitting doc', async () => {
    const save = await callTool(session, 'aimeat_crew_draft', { target_agent_name: agentName, doc: { ...goodDoc, tags: ['draft'] } });
    assert(!save.isError && save.data.saved === true, `save: ${save.text}`);
    const get = await callTool(session, 'aimeat_crew_get', { target_agent_name: agentName });
    assert(get.data.draft?.doc?.tags?.[0] === 'draft', `draft visible: ${get.text}`);
    const drop = await callTool(session, 'aimeat_crew_draft', { target_agent_name: agentName });
    assert(!drop.isError && drop.data.discarded === true, `discard: ${drop.text}`);
});
await test('8. aimeat_crew_publish with revision restores through the validator', async () => {
    const second = await callTool(session, 'aimeat_crew_publish', { target_agent_name: agentName, doc: { ...goodDoc, tags: ['v2'] } });
    assert(second.data?.revision === 2, `second publish: ${second.text}`);
    const r = await callTool(session, 'aimeat_crew_publish', { target_agent_name: agentName, revision: 1 });
    assert(!r.isError && r.data.revision === 3, `restore: ${r.text}`);
    const get = await callTool(session, 'aimeat_crew_get', { target_agent_name: agentName });
    assert(!get.data.published.doc.tags?.length, 'revision 1\'s doc is live again');
});

console.log('\nThe shortcut that cost a day');
await test('9. aimeat_memory_write of crews.registry.<agent> from the chat principal is refused with the pointer', async () => {
    // Register a SECOND agent as "the chat client": a sibling principal writing the first agent's key.
    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'chatclient', owner, capabilities: ['memory'], scopes: ['*'] }) });
    assert(ag.status === 201, `chat client agent ${ag.status}`);
    const chatGaii = ag.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: chatGaii, timestamp: ts, signature: await sign(ag.body.data.private_key, chatGaii + ts) }) });
    const w = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${tok.body.data.token}` }, body: JSON.stringify({ key: `crews.registry.${agentName}`, value: { doc: goodDoc }, visibility: 'owner' }) });
    assert(w.status === 403, `misdirected write ${w.status}: ${JSON.stringify(w.body)}`);
    assert(/aimeat_crew_publish/.test(w.body.error?.message ?? ''), `points at the tool: ${w.body.error?.message}`);
    const chatSession = await (async () => {
        const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'chat client', redirect_uris: [] }) });
        const ats = new Date().toISOString();
        const params = new URLSearchParams({ response_type: 'code', client_id: client.body.client_id, gaii: chatGaii, signature: await sign(ag.body.data.private_key, chatGaii + NODE_ID + ats), timestamp: ats });
        const auth = await json(`/v1/mcp/authorize?${params}`);
        const token = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }) });
        const s: Session = { token: token.body.access_token, sessionId: '', nextId: 1 };
        await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'chat client', version: '1.0.0' } });
        return s;
    })();
    const mw = await callTool(chatSession, 'aimeat_memory_write', { key: `crews.registry.${agentName}`, value: { doc: goodDoc }, visibility: 'owner' });
    assert(mw.isError && /aimeat_crew_publish/.test(mw.text), `MCP memory_write refused with the pointer: ${mw.text}`);
    // The same sibling publishing through the tool lands it where it belongs.
    const pub = await callTool(chatSession, 'aimeat_crew_publish', { target_agent_name: agentName, doc: { ...goodDoc, tags: ['from-chat'] } });
    assert(!pub.isError && pub.data.revision === 4, `sibling publish through the tool: ${pub.text}`);
    const live = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(live.body.data?.value?.doc?.tags?.[0] === 'from-chat' && live.body.data?.value?.publishedBy === chatGaii, `landed in ${agentName}'s namespace, stamped by the chat principal`);
});
await test('10. With the runtime gone, validate says AGENT_OFFLINE rather than guessing', async () => {
    await tunnel!.close();
    tunnel = null;
    await new Promise(r => setTimeout(r, 300));
    const r = await callTool(session, 'aimeat_crew_validate', { target_agent_name: agentName, doc: goodDoc });
    assert(r.isError && r.data?.error?.code === 'AGENT_OFFLINE', `offline: ${r.text}`);
});

await test('Teardown', async () => { await tunnel?.close(); });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
