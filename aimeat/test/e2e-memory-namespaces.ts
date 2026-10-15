/**
 * @file e2e-memory-namespaces.ts
 * @description E2E for the same-owner memory namespace model — the rule that memory is keyed by
 *   the WRITER, and everything that follows from it. This behaviour had NO test coverage, and its
 *   absence cost real time: an agent read a key an app had saved, got a bare "not found", and the
 *   conclusion drawn was that the platform could not share owner data between an app and an agent
 *   at all. It can — through an app-grant credential — and the difference is which token you hold.
 *
 *   Locks in, on both surfaces:
 *     1. A plain AGENT token writes into the agent's own GAII namespace, never the owner's.
 *     2. An APP-GRANT token (sub = owner GHII, roles ['app']) writes into the OWNER's namespace.
 *     3. GET /v1/memory/:key?owner_scope=true reads across the union; without it, an agent sees
 *        only its own namespace. An agent reads another identity's PRIVATE record there only with
 *        memory:read-as-owner.
 *     4. When a key exists under BOTH, owner-scope resolves GHII-first and the agent's copy is
 *        shadowed — reported as `also_under` on the survivor instead of vanishing silently.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-memory-namespaces
 * @version-history
 *   2026-10-15 — "the agent CAN read it with ?owner_scope=true" asserted the hole: an agent holding
 *     memory:read read the owner's private record. Now it is 404 without memory:read-as-owner on REST
 *     read, list, count, ?agent=, search and the MCP read, a sibling's owner-visible record is still
 *     read, "*" does not carry the word, the app grant is unaffected, another owner's agent reaches
 *     nothing, and the granted word opens the reads (feature-list audit #42).
 *   v1.2.0 — 2026-10-11 — An `agents.` key that carries an identity where the agent's name belongs
 *     is refused on POST, PUT, PATCH, bulk and the node MCP tool, for the agent and for the owner,
 *     and the name alone is accepted (utils/agent-key-address.ts).
 *   v1.1.0 — 2026-09-13 — SHADOWED_BY_OWNER_COPY on every agent write the owner's copy hides: over
 *     POST /v1/memory, which never warned, and over the node MCP tool on a key the agent already
 *     held, where it went quiet after the first write. Includes the create, app-save, write-again
 *     sequence from the appdev pitfall, and a second owner's same-named key as the cross-owner case.
 *   v1.0.0 — 2026-07-26 — Initial. Written after the namespace model was mis-diagnosed as a
 *     platform limitation; these assertions are what stop a refactor changing it silently.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { registerOwner } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
// Read from the node's own response envelope during setup rather than guessing: the MCP authorize
// signature is over `gaii + nodeId + timestamp`, so a wrong id is an opaque 'Invalid signature'.
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

const owner = `nsowner${Date.now() % 1000000}`;
const FILENAME = 'ns-demo.html';
const REDIRECT = 'http://localhost:9911/callback';
const SHARED_KEY = 'nstest.shared.doc';
const AGENT_ONLY_KEY = 'nstest.agentonly.doc';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function getToken(subject: string, priv: string, isAgent: boolean): Promise<string> {
    assert(isAgent, 'an owner signs in with registerOwner() from helpers/owner-login.js');
    const timestamp = new Date().toISOString();
    // Agents sign `gaii + timestamp`.
    const signature = await signMsg(priv, subject + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: subject, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// ── The node MCP door, for the same agent. The shadowing warning has to reach an agent on both of
//    the doors it writes through, and the MCP one is where it used to go quiet after the first write.
let mcpToken = '', mcpSession = '', mcpNextId = 1;
function parseSSE(text: string, id: number): any {
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON-RPC frame */ }
    }
    return {};
}
async function rpc(method: string, params: Record<string, unknown> = {}, notify = false) {
    const id = mcpNextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken}`,
            ...(mcpSession ? { 'mcp-session-id': mcpSession, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) mcpSession = sid;
    if (notify) { await res.text(); return {}; }
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}
async function openMcpSession(gaii: string, priv: string): Promise<void> {
    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'ns-shadow e2e', redirect_uris: [] }) });
    const ts = new Date().toISOString();
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii,
        signature: await signMsg(priv, gaii + NODE_ID + ts), timestamp: ts,
        ...authorizeParams(pkce),
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret, ...tokenParams(pkce) }),
    });
    assert(tok.status === 200, `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);
    mcpToken = tok.body.access_token;
    mcpSession = '';
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ns-shadow e2e', version: '1.0.0' } });
    await rpc('notifications/initialized', {}, true);
}
async function mcpWrite(args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
    const body = await rpc('tools/call', { name: 'aimeat_memory_write', arguments: args });
    const text = body?.result?.content?.[0]?.text ?? '';
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _raw: text || JSON.stringify(body) }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data };
}

const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

let ownerToken = '', ownerPriv = '';
let agentGaii = '', agentToken = '', agentPriv = '';
let appToken = '';
const ownerGhii = () => `${owner}@${NODE_ID}`;

async function main() {
    console.log('\n=== Memory namespaces (agent GAII vs owner GHII) E2E ===\n');
    console.log('Setup');

    await test('register owner + agent + publish an app', async () => {
        const registered = await registerOwner(BASE, owner);
        const reg = registered.registration;
        if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
        ownerPriv = registered.privateKey;
        ownerToken = registered.token;

        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            // Explicit scopes: an agent minted without them gets the '*' wildcard, which would
            // satisfy every gate and make the write-as-owner refusal untestable.
            body: JSON.stringify({ name: 'nsbot', owner, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
        });
        assert(ag.status === 201, `register agent: ${ag.status} ${JSON.stringify(ag.body)}`);
        agentGaii = ag.body.data.agent.gaii;
        agentPriv = ag.body.data.private_key;
        agentToken = await getToken(agentGaii, agentPriv, true);

        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>ns</body></html>'), name: 'NS Demo', description: 'namespace demo', category: 'utility' }),
        });
        assert(pub.status === 201, `publish app: ${pub.status}`);
    });

    await test('mint an app-grant token (sub = owner GHII, roles ["app"])', async () => {
        const q = new URLSearchParams({
            app: `${owner}/${FILENAME}`, response_type: 'code', scope: 'memory:read memory:write memory:delete',
            redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')![1]);
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ request_id: rid }),
        });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.body.ok === true, `token exchange: ${JSON.stringify(tok.body.error)}`);
        appToken = tok.body.data.access_token;
        const claims = JSON.parse(Buffer.from(appToken.split('.')[1], 'base64url').toString());
        assert(claims.sub === ownerGhii(), `app-grant sub must be the owner GHII, got ${claims.sub}`);
        assert(Array.isArray(claims.roles) && claims.roles.includes('app'), 'app-grant carries roles ["app"]');
    });

    // ── 1. An APP-GRANT credential writes the OWNER's namespace ──────────────
    console.log('\nPhase 1: an app-grant token writes the OWNER namespace');

    await test('app-grant write lands under the owner GHII, not under an agent', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${appToken}` },
            body: JSON.stringify({ key: SHARED_KEY, value: { by: 'app' }, visibility: 'private' }),
        });
        assert(w.status === 201, `app write: ${w.status} ${JSON.stringify(w.body)}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === SHARED_KEY);
        assert(!!row, 'the app-written key is listed');
        assert(row.owner_gaii === ownerGhii(), `expected owner GHII, got ${row.owner_gaii}`);
    });

    // ── 2. A plain AGENT token writes its OWN namespace ──────────────────────
    console.log('\nPhase 2: a plain agent token writes its OWN namespace');

    await test('agent write lands under the agent GAII', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AGENT_ONLY_KEY, value: { by: 'agent' }, visibility: 'owner' }),
        });
        assert(w.status === 201, `agent write: ${w.status} ${JSON.stringify(w.body)}`);
        // Positive control for Phase 3: nobody else holds this key, so nothing shadows it.
        assert(w.body.data.shadowed_by === undefined && w.body.data.warnings === undefined,
            `an unshared key must carry no warning, got ${JSON.stringify(w.body.data.warnings)}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === AGENT_ONLY_KEY);
        assert(!!row, 'the agent-written key is visible owner-scope');
        assert(row.owner_gaii === agentGaii, `expected the agent GAII, got ${row.owner_gaii}`);
    });

    await test('the agent CANNOT reach the app-written key without owner_scope', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(r.status === 404, `expected 404 in the agent's own namespace, got ${r.status}`);
    });

    // ── 2b. memory:read-as-owner (feature-list audit #42, Jouni 2026-10-15) ───
    // This test asserted that an agent holding memory:read reads the owner's PRIVATE record with
    // ?owner_scope=true. That was the hole: reading as the owner now costs its own word, outside every
    // wildcard. Without it an agent reads what visibility admits a same-owner reader.
    const mcpRead = async (args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name: 'aimeat_memory_read', arguments: args });
        return { isError: body?.result?.isError === true || body?.error !== undefined, text: String(body?.result?.content?.[0]?.text ?? JSON.stringify(body)) };
    };
    const asAgent = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
    let sibGaii = '';

    await test('without memory:read-as-owner, owner_scope does not reach the owner\'s PRIVATE record (REST read, list, MCP read)', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, asAgent(agentToken));
        assert(r.status === 404, `REST read: expected 404, got ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(SHARED_KEY)}`, asAgent(agentToken));
        assert(l.status === 200 && !l.body.data.items.some((i: any) => i.key === SHARED_KEY), `REST list shows it: ${JSON.stringify(l.body.data.items)}`);
        const c = await json(`/v1/memory?owner_scope=true&count=true&prefix=${encodeURIComponent(SHARED_KEY)}`, asAgent(agentToken));
        assert(c.status === 200 && c.body.data.count === 0, `the count counts it: ${JSON.stringify(c.body.data)}`);
        await openMcpSession(agentGaii, agentPriv);
        const m = await mcpRead({ key: SHARED_KEY, owner_scope: true });
        assert(m.isError && !m.text.includes('"app"'), `MCP read: ${m.text}`);
    });

    await test('a sibling agent\'s private record is hidden on ?agent= and owner_scope; its owner-visible record is read', async () => {
        const sib = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'nssib', owner, capabilities: ['memory'], scopes: ['memory:write'] }),
        });
        assert(sib.status === 201, `register sibling: ${sib.status} ${JSON.stringify(sib.body)}`);
        sibGaii = sib.body.data.agent.gaii;
        const sibToken = await getToken(sibGaii, sib.body.data.private_key, true);
        for (const [key, visibility] of [['nstest.sib.private', 'private'], ['nstest.sib.shared', 'owner']]) {
            const w = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${sibToken}` }, body: JSON.stringify({ key, value: { by: 'sibling' }, visibility }) });
            assert(w.status === 201, `sibling write ${key}: ${w.status}`);
        }
        const viaAgent = await json(`/v1/memory/nstest.sib.private?agent=${encodeURIComponent(sibGaii)}`, asAgent(agentToken));
        assert(viaAgent.status === 404, `?agent= private: expected 404, got ${viaAgent.status}`);
        const viaScope = await json('/v1/memory/nstest.sib.private?owner_scope=true', asAgent(agentToken));
        assert(viaScope.status === 404, `owner_scope private: expected 404, got ${viaScope.status}`);
        const shared = await json('/v1/memory/nstest.sib.shared?owner_scope=true', asAgent(agentToken));
        assert(shared.status === 200 && shared.body.data.value.by === 'sibling', `owner-visible record: ${shared.status}`);
        const listed = await json(`/v1/memory?agent=${encodeURIComponent(sibGaii)}&prefix=nstest.sib.`, asAgent(agentToken));
        const keys = (listed.body.data.items ?? []).map((i: any) => i.key);
        assert(keys.includes('nstest.sib.shared') && !keys.includes('nstest.sib.private'), `?agent= list: ${JSON.stringify(keys)}`);
        const found = await json(`/v1/memory/search?q=sibling&agent=${encodeURIComponent(sibGaii)}`, asAgent(agentToken));
        assert(!(found.body.data.results ?? []).some((x: any) => x.key === 'nstest.sib.private'), `?agent= search: ${JSON.stringify(found.body.data)}`);
    });

    await test('"Full access" (*) does not carry memory:read-as-owner', async () => {
        const star = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'nsstar', owner, capabilities: ['memory'], scopes: ['*'] }),
        });
        assert(star.status === 201, `register: ${star.status}`);
        const starToken = await getToken(star.body.data.agent.gaii, star.body.data.private_key, true);
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, asAgent(starToken));
        assert(r.status === 404, `cross-scope: expected 404, got ${r.status}`);
    });

    await test('the owner\'s app grant still reads everything with owner_scope (the rule is one direction)', async () => {
        const r = await json(`/v1/memory/nstest.sib.private?owner_scope=true`, asAgent(appToken));
        assert(r.status === 200 && r.body.data.value.by === 'sibling', `app grant: ${r.status}`);
    });

    await test('another owner\'s agent holding memory:read-as-owner reaches nothing of this owner (cross-owner)', async () => {
        const other = `nsread${Date.now() % 1000000}`;
        const otherToken = (await registerOwner(BASE, other)).token;
        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
            body: JSON.stringify({ name: 'nsreader', owner: other, capabilities: ['memory'], scopes: ['memory:read', 'memory:read-as-owner'] }),
        });
        assert(ag.status === 201, `register: ${ag.status} ${JSON.stringify(ag.body)}`);
        const t = await getToken(ag.body.data.agent.gaii, ag.body.data.private_key, true);
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, asAgent(t));
        assert(r.status === 404, `owner_scope: expected 404, got ${r.status}`);
        const a = await json(`/v1/memory/nstest.sib.private?agent=${encodeURIComponent(sibGaii)}`, asAgent(t));
        assert(a.status === 403, `?agent=: expected 403, got ${a.status}`);
    });

    await test('the owner grants memory:read-as-owner, and the agent reads the private records (REST and MCP)', async () => {
        const p = await json('/v1/agents/nsbot/scopes', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:read-as-owner'] }),
        });
        assert(p.status === 200, `grant: ${p.status} ${JSON.stringify(p.body)}`);
        agentToken = await getToken(agentGaii, agentPriv, true);
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, asAgent(agentToken));
        assert(r.status === 200 && r.body.data.value.by === 'app', `owner_scope read: ${r.status} ${JSON.stringify(r.body)}`);
        const sibPrivate = await json(`/v1/memory/nstest.sib.private?agent=${encodeURIComponent(sibGaii)}`, asAgent(agentToken));
        assert(sibPrivate.status === 200, `?agent= private: ${sibPrivate.status}`);
        await openMcpSession(agentGaii, agentPriv);
        const m = await mcpRead({ key: SHARED_KEY, owner_scope: true });
        assert(!m.isError && m.text.includes('app'), `MCP read: ${m.text}`);
    });

    // ── 3. Shadowing is real, and now visible ────────────────────────────────
    console.log('\nPhase 3: a same-key collision is reported, not hidden');

    await test('an agent copy of an owner-held key is shadowed GHII-first', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: SHARED_KEY, value: { by: 'agent-newer' }, visibility: 'owner' }),
        });
        assert(w.status === 201, `agent shadow write: ${w.status}`);
        // The write door says so. It used to pass ownerScoped:true for every caller, "no owner copy
        // to shadow", which is false for an agent, so this answer carried nothing.
        assert(w.body.data.shadowed_by === ownerGhii(), `REST must name the owner copy, got ${JSON.stringify(w.body.data)}`);
        assert((w.body.data.warnings ?? []).some((x: any) => x.code === 'SHADOWED_BY_OWNER_COPY'),
            `warnings must carry SHADOWED_BY_OWNER_COPY, got ${JSON.stringify(w.body.data.warnings)}`);
        const r = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.body.data.value.by === 'app', `GHII copy must win, got ${JSON.stringify(r.body.data.value)}`);
    });

    // THE SEQUENCE THE WARNING WENT QUIET ON (appdev pitfall data/owner-copy-shadows-agent-write):
    // the agent CREATES the key, the owner then saves it from the app, and the agent writes again.
    // The check ran only when the agent had no copy yet, so from the second write on, every agent
    // update was hidden behind the owner's copy with no word, on the node MCP door as well.
    const SEQ_KEY = 'nstest.sequence.model';
    await test('agent creates a key, the app saves it as the owner: the agent write that follows is warned (REST)', async () => {
        const first = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: SEQ_KEY, value: { rev: 1, by: 'agent' }, visibility: 'owner' }),
        });
        assert(first.status === 201 && first.body.data.shadowed_by === undefined, `first agent write: ${first.status} ${JSON.stringify(first.body.data)}`);
        const app = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${appToken}` },
            body: JSON.stringify({ key: SEQ_KEY, value: { rev: 2, by: 'app' }, visibility: 'private' }),
        });
        assert(app.status === 201 && app.body.data.owner_gaii === ownerGhii(), `app save: ${app.status} ${JSON.stringify(app.body.data)}`);
        const again = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: SEQ_KEY, value: { rev: 3, by: 'agent' }, visibility: 'owner' }),
        });
        assert(again.status === 200, `second agent write updates its own copy: ${again.status}`);
        assert(again.body.data.shadowed_by === ownerGhii(), `the second agent write must be warned, got ${JSON.stringify(again.body.data)}`);
    });

    await test('…and the same agent is warned over the node MCP door, on a key it already holds', async () => {
        await openMcpSession(agentGaii, agentPriv);
        const w = await mcpWrite({ key: SEQ_KEY, value: { rev: 4, by: 'agent-mcp' }, visibility: 'owner' });
        assert(!w.isError, `mcp write refused: ${JSON.stringify(w.data)}`);
        assert(w.data.owner_gaii === agentGaii, `lands in the agent namespace, got ${w.data.owner_gaii}`);
        assert(w.data.shadowed_by === ownerGhii() && w.data.warning === 'SHADOWED_BY_OWNER_COPY',
            `MCP must warn on a key the agent already holds, got ${JSON.stringify(w.data)}`);
        assert((w.data.warnings ?? []).some((x: any) => x.code === 'SHADOWED_BY_OWNER_COPY'), 'and in warnings');
        const r = await json(`/v1/memory/${encodeURIComponent(SEQ_KEY)}?owner_scope=true`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.body.data.value.by === 'app', `what the warning says is true: the owner copy still wins, got ${JSON.stringify(r.body.data.value)}`);
    });

    await test('a second owner\'s copy of the same key name shadows nothing here (cross-owner)', async () => {
        // The check looks under THIS agent's owner only. A different person holding the same key
        // name is a different namespace entirely and must not appear in the answer.
        const other = `nsother${Date.now() % 1000000}`;
        const otherToken = (await registerOwner(BASE, other)).token;
        const own = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
            body: JSON.stringify({ key: 'nstest.crossowner.only', value: { by: 'other' } }),
        });
        assert(own.status === 201, `other owner write: ${own.status}`);
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.crossowner.only', value: { by: 'agent' } }),
        });
        assert(w.status === 201 && w.body.data.shadowed_by === undefined,
            `another owner's key must not be named, got ${JSON.stringify(w.body.data)}`);
    });

    await test('an agent WITHOUT memory:read is not told the owner holds the key (the warning is a read)', async () => {
        // Naming the owner's copy says a key exists in the owner's namespace. An agent reads owner
        // scope with memory:read; one that cannot read there must not learn it by writing a key.
        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'nswriteonly', owner, capabilities: ['memory'], scopes: ['memory:write'] }),
        });
        assert(ag.status === 201, `register write-only agent: ${ag.status} ${JSON.stringify(ag.body)}`);
        const wo = await getToken(ag.body.data.agent.gaii, ag.body.data.private_key, true);
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${wo}` },
            body: JSON.stringify({ key: SHARED_KEY, value: { by: 'write-only agent' } }),
        });
        assert(w.status === 201, `write-only agent write: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data.shadowed_by === undefined && w.body.data.warnings === undefined,
            `a caller that cannot read owner scope must not be told, got ${JSON.stringify(w.body.data)}`);
    });

    await test('the shadowed copy is named in also_under instead of disappearing', async () => {
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(SHARED_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const rows = l.body.data.items.filter((i: any) => i.key === SHARED_KEY);
        assert(rows.length === 1, `dedup keeps one row, got ${rows.length}`);
        assert(rows[0].owner_gaii === ownerGhii(), 'the surviving row is the GHII copy');
        assert(Array.isArray(rows[0].also_under) && rows[0].also_under.includes(agentGaii),
            `also_under must name the shadowed agent copy, got ${JSON.stringify(rows[0].also_under)}`);
    });

    await test('a key held by only ONE identity carries no also_under', async () => {
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const row = l.body.data.items.find((i: any) => i.key === AGENT_ONLY_KEY);
        assert(row && row.also_under === undefined, 'no collision means no also_under');
    });

    // ── 4. The app-grant credential can UPDATE the owner's record ────────────
    console.log('\nPhase 4: the app-grant credential updates the owner record itself');

    await test('app-grant PUT updates the owner copy (the round trip an agent token cannot do)', async () => {
        const cur = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const u = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${appToken}` },
            body: JSON.stringify({ value: { by: 'app-updated' }, visibility: 'private', version: cur.body.data.version }),
        });
        assert(u.status === 200, `app-grant update: ${u.status} ${JSON.stringify(u.body)}`);
        const after = await json(`/v1/memory/${encodeURIComponent(SHARED_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(after.body.data.value.by === 'app-updated', 'the owner record itself changed');
        assert(after.body.data.owner_gaii === undefined || after.body.data.owner_gaii === ownerGhii(),
            'still the owner copy');
    });

    // ── 5. …and can DELETE one, which is where the model had a hole ──────────
    //
    // An app-grant token lists across the owner scope, so an app renders keys its owner's AGENTS
    // wrote. Deleting one was refused, because the cross-namespace lookup on DELETE was written for
    // `roles:['owner']` alone. The result was a delete control pointing at a record it could never
    // remove — and for an app whose whole premise is "your AI writes these for you", that is every
    // record, for every user, not an edge case.
    //
    // This is not a widening of what an app may reach: the same credential already deletes anything
    // in the owner's OWN namespace, so fencing off the agent-written subset protected nothing.
    console.log('\nPhase 5: the app-grant credential deletes an agent-written key');

    await test('without owner_scope, an app-grant delete of an agent-only key still 404s', async () => {
        const d = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` },
        });
        assert(d.status === 404, `unscoped delete must stay in the caller's namespace, got ${d.status}`);
        const still = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(still.status === 200, 'and the record is untouched');
    });

    await test('with ?owner_scope=true, the app-grant deletes the agent-written key', async () => {
        const d = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` },
        });
        assert(d.status === 200, `owner-scope delete: ${d.status} ${JSON.stringify(d.body)}`);
    });

    await test('the record is gone from the owner scope, not merely hidden from the app', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(AGENT_ONLY_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 404, `expected the key to be gone, got ${r.status}`);
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(AGENT_ONLY_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        const rows = (l.body.data.items ?? []).filter((i: any) => i.key === AGENT_ONLY_KEY);
        assert(rows.length === 0, `owner-scope listing still returns it: ${JSON.stringify(rows)}`);
    });


    // == 4. memory:write-as-owner -- an agent writing INTO the owner's namespace ==
    //
    // Two conditions, both required. Most of these tests are about the cases that must REFUSE,
    // because the failures that matter are a silent redirect and a bypassed reserved-key guard.
    console.log('\nPhase 4: memory:write-as-owner');

    const AS_OWNER_KEY = 'nstest.asowner.note';
    const AS_OWNER_PUBLIC_KEY = 'nstest.asowner.public';

    await test('WITHOUT the scope: owner_scope is refused, and nothing is written anywhere', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_KEY, value: { by: 'agent' }, owner_scope: true }),
        });
        assert(w.status === 403, `expected 403 without the scope, got ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.error?.code === 'SCOPE_DENIED', `code: ${w.body.error?.code}`);
        const r = await json(`/v1/memory/${encodeURIComponent(AS_OWNER_KEY)}?owner_scope=true`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 404, 'a refused write must not leave a record behind');
    });

    await test('WITHOUT the flag: an agent write still lands in the AGENT namespace', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.asowner.unmoved', value: { by: 'agent' } }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === agentGaii,
            `ordinary writes must not move, got ${w.body.data.owner_gaii}`);
    });

    await test('the owner grants memory:write-as-owner', async () => {
        const p = await json('/v1/agents/nsbot/scopes', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:write-as-owner'] }),
        });
        assert(p.status === 200, `grant: ${p.status} ${JSON.stringify(p.body)}`);
        agentToken = await getToken(agentGaii, agentPriv, true);   // a live token keeps its old scopes
    });

    await test('WITH the scope AND the flag: the write lands under the OWNER GHII', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_KEY, value: { by: 'agent-as-owner' }, owner_scope: true }),
        });
        assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data.owner_gaii === ownerGhii(),
            `expected the owner GHII, got ${w.body.data.owner_gaii}`);
        assert(w.body.data.shadowed_by === undefined, 'a write INTO the owner namespace shadows nothing');
    });

    await test('the OWNER reads it as their own record, no owner_scope needed', async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(AS_OWNER_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(r.status === 200, `owner read: ${r.status}`);
        assert(r.body.data.value.by === 'agent-as-owner', `value: ${JSON.stringify(r.body.data.value)}`);
    });

    await test('THE GUARD: a reserved server-trusted key is refused even with the scope', async () => {
        for (const key of ['openrouter.settings', 'ai-usage.today', 'profile.card']) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
                body: JSON.stringify({ key, value: { evil: true }, owner_scope: true }),
            });
            assert(w.status === 403, `${key} must be refused, got ${w.status}`);
            assert(w.body.error?.code === 'RESERVED_KEY', `${key} code: ${w.body.error?.code}`);
        }
    });

    await test('visibility is untouched: a public record written as the owner stays public', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: AS_OWNER_PUBLIC_KEY, value: { hello: 'world' }, visibility: 'public', owner_scope: true }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === ownerGhii(), 'lands under the owner');
        assert(w.body.data.visibility === 'public', `visibility must survive, got ${w.body.data.visibility}`);
        const pub = await json(`/v1/memory/${encodeURIComponent(ownerGhii())}/${encodeURIComponent(AS_OWNER_PUBLIC_KEY)}`);
        assert(pub.status === 200, `public read: ${pub.status} ${JSON.stringify(pub.body)}`);
    });



    await test('a WILDCARD agent still cannot write the reserved keys', async () => {
        // The one deliberate break from the '*'-bundles-everything convention. "Full access" is one
        // click; redirecting a decrypted AI key is not what someone is choosing when they click it.
        const ag = await json('/v1/agents', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ name: 'nswild', owner, capabilities: ['memory'], scopes: ['*'] }),
        });
        assert(ag.status === 201, `register wildcard agent: ${ag.status}`);
        const wildToken = await getToken(ag.body.data.agent.gaii, ag.body.data.private_key, true);
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${wildToken}` },
            body: JSON.stringify({ key: 'openrouter.settings', value: { baseUrl: 'https://evil.test' }, owner_scope: true }),
        });
        assert(w.status === 403, `'*' must not reach a reserved key, got ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.error?.code === 'RESERVED_KEY', `code: ${w.body.error?.code}`);
        // ...but '*' DOES carry write-as-owner, so an ordinary key still works for it.
        const ok = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${wildToken}` },
            body: JSON.stringify({ key: 'nstest.wild.ordinary', value: { by: 'wild' }, owner_scope: true }),
        });
        assert(ok.status === 201 && ok.body.data.owner_gaii === ownerGhii(),
            `'*' should still carry write-as-owner: ${ok.status} ${JSON.stringify(ok.body.data)}`);
    });

    await test('WITH memory:write-reserved the owner CAN hand over the AI keys', async () => {
        const p = await json('/v1/agents/nsbot/scopes', {
            method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:write-as-owner', 'memory:write-reserved'] }),
        });
        assert(p.status === 200, `grant: ${p.status} ${JSON.stringify(p.body)}`);
        agentToken = await getToken(agentGaii, agentPriv, true);

        for (const key of ['openrouter.settings', 'ai-usage.today', 'profile.card']) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
                body: JSON.stringify({ key, value: { managed: 'by agent' }, owner_scope: true }),
            });
            assert(w.status === 201 || w.status === 200, `${key}: ${w.status} ${JSON.stringify(w.body)}`);
            assert(w.body.data.owner_gaii === ownerGhii(), `${key} must land under the owner`);
        }
    });

    await test('the reserved grant does NOT imply the redirect: without the flag it still stays put', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.reserved.unmoved', value: { by: 'agent' } }),
        });
        assert(w.status === 201, `write: ${w.status}`);
        assert(w.body.data.owner_gaii === agentGaii, `got ${w.body.data.owner_gaii}`);
    });

    // ── An `agents.` key names the agent by its NAME ─────────────────────────
    // A crew runtime built its keys from the agent's identity on 2026-10-11, the node stored them and
    // answered 201, and nothing read them: the offer it "published" never reached the offers page.
    console.log('\nPhase: an agents.* key that carries an identity where the name belongs is refused');

    const identityKey = (leaf: string) => `agents.${agentGaii}.${leaf}`;
    const nothingStored = async (label: string) => {
        const l = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent('agents.nsbot#')}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(l.status === 200, `list: ${l.status}`);
        assert(l.body.data.items.length === 0, `${label}: nothing may be stored, got ${JSON.stringify(l.body.data.items.map((i: any) => i.key))}`);
    };

    await test('POST by the agent itself: 400, the right address in the message, nothing stored', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: identityKey('offers'), value: { offers: [] }, visibility: 'owner' }),
        });
        assert(w.status === 400, `expected 400, got ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.error?.code === 'AGENT_KEY_NOT_A_NAME', `code: ${w.body.error?.code}`);
        assert(String(w.body.error?.message).includes('agents.nsbot.'), `the message names the right address: ${w.body.error?.message}`);
        await nothingStored('POST');
    });

    await test('the owner in person is refused the same key (the rule is the address, not the caller)', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ key: identityKey('readme'), value: 'x' }),
        });
        assert(w.status === 400 && w.body.error?.code === 'AGENT_KEY_NOT_A_NAME', `got ${w.status} ${w.body.error?.code}`);
    });

    await test('the node MCP tool refuses it with the same code', async () => {
        const w = await mcpWrite({ key: identityKey('readme'), value: 'x' });
        assert(w.isError, `the tool call must be an error, got ${JSON.stringify(w.data)}`);
        assert(JSON.stringify(w.data).includes('AGENT_KEY_NOT_A_NAME'), `code in the answer: ${JSON.stringify(w.data)}`);
        await nothingStored('MCP');
    });

    await test('PATCH, which creates an absent key, refuses it', async () => {
        const w = await json(`/v1/memory/${encodeURIComponent(identityKey('tasks.t1.live'))}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ patch: { step: 1 } }),
        });
        assert(w.status === 400 && w.body.error?.code === 'AGENT_KEY_NOT_A_NAME', `got ${w.status} ${JSON.stringify(w.body.error)}`);
    });

    await test('PUT refuses it', async () => {
        const w = await json(`/v1/memory/${encodeURIComponent(identityKey('readme'))}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ value: 'x', version: 1 }),
        });
        assert(w.status === 400 && w.body.error?.code === 'AGENT_KEY_NOT_A_NAME', `got ${w.status} ${JSON.stringify(w.body.error)}`);
    });

    await test('a bulk write drops that entry with the reason and stores the entry beside it', async () => {
        const w = await json('/v1/memory/bulk', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ entries: [
                { key: identityKey('statistics.custom.eval_context'), value: { n: 1 } },
                { key: 'agents.nsbot.statistics.custom.eval_context', value: { n: 1 } },
            ] }),
        });
        assert(JSON.stringify(w.body).includes('agents.nsbot.'), `the refused entry carries the reason: ${JSON.stringify(w.body)}`);
        await nothingStored('bulk');
        const ok = await json(`/v1/memory/${encodeURIComponent('agents.nsbot.statistics.custom.eval_context')}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(ok.status === 200, `the correctly addressed entry is stored: ${ok.status}`);
    });

    await test('the name alone is accepted, and so is an "@" outside the agents. prefix', async () => {
        const byName = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'agents.nsbot.readme', value: 'hello', visibility: 'owner' }),
        });
        assert(byName.status === 201, `agents.<name>.readme: ${byName.status} ${JSON.stringify(byName.body)}`);
        const email = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({ key: 'nstest.contacts.alice@example.com', value: { name: 'Alice' } }),
        });
        assert(email.status === 201, `an email address in another key: ${email.status} ${JSON.stringify(email.body)}`);
    });


    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

await main();
