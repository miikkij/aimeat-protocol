/**
 * @file test/e2e-invoke-routes.ts
 * @description A REST route as a node capability: an agent finds it with `aimeat_discover` and runs it
 *   with `aimeat_invoke`, with its own credential, through the same route.
 *
 *   WHAT THIS HAS TO PROVE. The route is reachable through invoke, and nothing about it changes on the
 *   way: every call is made twice, once over plain REST and once through invoke, and the pair has to
 *   give the same status and the same error code. Six cases:
 *     (a) an agent finds a route no tool covers and runs it, and gets the route's own answer;
 *     (b) a route that admits only the owner in person refuses the agent through invoke as over REST,
 *         and still admits the owner in person through invoke;
 *     (c) a route with a permission word refuses an agent without the word and admits one with it;
 *     (d) another owner's agent gets the route's own refusal;
 *     (e) a body the route does not take gets the answer REST gives it;
 *     (f) invoking a tool id works as before.
 *   And the edges of the catalogue: a sign-in route is not a capability, an undeclared parameter is
 *   refused, and a path value cannot climb out of its segment.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=invoke-routes
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial, with route capabilities.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const PASSWORD = 'InvokeRoutesPass12345';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `invr${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: PASSWORD }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: PASSWORD }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const tok = await ownerSignIn(BASE, owner, PASSWORD);
    return { owner, token: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, scopes: string[]) {
    const name = `ir${randomBytes(3).toString('hex')}`;
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return { name, gaii, token: tok.body.data.token as string };
}

/** POST /v1/invoke as `token`. */
function invoke(token: string, capability: string, input: unknown) {
    return json('/v1/invoke', { method: 'POST', headers: auth(token), body: JSON.stringify({ capability, input }) });
}

/** The same call over REST and through invoke must agree on status and code. */
function sameAnswer(rest: { status: number; body: any }, via: { status: number; body: any }, what: string) {
    assert(via.status === rest.status, `${what}: invoke answered ${via.status}, REST ${rest.status} (${JSON.stringify(via.body?.error)})`);
    assert(via.body?.error?.code === rest.body?.error?.code,
        `${what}: invoke code ${via.body?.error?.code}, REST code ${rest.body?.error?.code}`);
}

let rpcId = 0;
async function rpc(token: string, sessionId: string | null, method: string, params: Record<string, unknown>) {
    const id = ++rpcId;
    const response = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST', headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth(token),
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await response.text();
    let message: any = null;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const messages = text.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
        message = messages.find(m => m.id === id) ?? messages[0] ?? null;
    } else if (text) { try { message = JSON.parse(text); } catch { message = text; } }
    return { status: response.status, sessionId: response.headers.get('mcp-session-id') ?? sessionId, message };
}
async function callTool(token: string, name: string, args: Record<string, unknown>) {
    const init = await rpc(token, null, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'invoke-routes-e2e', version: '1' } });
    assert(init.status === 200, `initialize ${init.status}`);
    const out = await rpc(token, init.sessionId, 'tools/call', { name, arguments: args });
    await fetch(`${BASE}/v1/mcp`, { method: 'DELETE', headers: { ...auth(token), 'mcp-session-id': init.sessionId ?? '' } }).catch(() => undefined);
    const text: string = out.message?.result?.content?.[0]?.text ?? JSON.stringify(out.message?.error ?? out.message);
    let data: any = null; try { data = JSON.parse(text); } catch { /* a sentence */ }
    return { isError: out.message?.result?.isError === true || !!out.message?.error, text, data };
}

const RUNS = 'route:GET /v1/ledger/usage/runs';
const CONTACTS = 'route:GET /v1/messages/contacts';
const TELEMETRY = 'route:GET /v1/agents/{name}/telemetry';
const BULK = 'route:POST /v1/memory/bulk';

console.log('\n=== A REST route as a node capability: found with discover, run with invoke ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const withWallet = await addAgent(a.owner, a.token, ['memory:read', 'memory:write', 'wallet:read', 'catalogue:read', 'agent:read']);
    const noWallet = await addAgent(a.owner, a.token, ['memory:read', 'catalogue:read']);
    const stranger = await addAgent(b.owner, b.token, ['memory:read', 'agent:read', 'wallet:read']);

    // ── (a) found and run ─────────────────────────────────────────────────────
    await test('(a) the catalogue lists a route no tool covers, with its contract', async () => {
        const r = await json(`/v1/capabilities/node/${encodeURIComponent(RUNS)}`);
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const cap = r.body.data.capability;
        assert(cap.kind === 'route', `kind route, got ${cap.kind}`);
        assert(cap.method === 'GET' && cap.path === '/v1/ledger/usage/runs', `method and path, got ${cap.method} ${cap.path}`);
        assert(Array.isArray(cap.parameters) && cap.parameters.some((p: any) => p.name === 'run_id' && p.in === 'query'), 'its query parameters');
    });

    await test('(a) an agent finds it with aimeat_discover over MCP', async () => {
        const out = await callTool(withWallet.token, 'aimeat_discover', { q: 'usage runs', type: 'capability', limit: 50 });
        assert(!out.isError, `discover failed: ${out.text.slice(0, 200)}`);
        const ids = ((out.data?.entries ?? out.data?.data?.entries ?? []) as any[]).map(e => e.id);
        assert(ids.includes(RUNS), `expected ${RUNS} in ${JSON.stringify(ids.slice(0, 10))}`);
    });

    await test('(a) and discover over REST tags it as a route', async () => {
        const r = await json('/v1/discover?q=usage%20runs&type=capability&per_page=50', { headers: auth(withWallet.token) });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const entry = ((r.body.data.entries as any[]) ?? []).find(e => e.id === RUNS);
        assert(entry?.id === RUNS && entry.type === 'capability', `the route is found as a capability: ${JSON.stringify(entry)}`);
        assert(entry.tags.includes('route'), `tagged route: ${JSON.stringify(entry.tags)}`);
    });

    await test('(a) an agent runs it with aimeat_invoke over MCP and gets the route\'s own answer', async () => {
        const rest = await json('/v1/ledger/usage/runs?limit=5', { headers: auth(withWallet.token) });
        assert(rest.status === 200, `REST answered ${rest.status}`);
        const out = await callTool(withWallet.token, 'aimeat_invoke', { capability: RUNS, input: { query: { limit: 5 } } });
        assert(!out.isError, `invoke failed: ${out.text.slice(0, 300)}`);
        assert(out.data?.capability === RUNS, `it names what it ran: ${out.data?.capability}`);
        assert(JSON.stringify(Object.keys(out.data?.result ?? {}).sort()) === JSON.stringify(Object.keys(rest.body.data ?? {}).sort()),
            `the same answer as REST: ${JSON.stringify(out.data?.result)} vs ${JSON.stringify(rest.body.data)}`);
    });

    // ── (b) owner in person only ──────────────────────────────────────────────
    await test('(b) a route for the owner in person refuses the agent through invoke exactly as over REST', async () => {
        const rest = await json('/v1/messages/contacts', { headers: auth(withWallet.token) });
        assert(rest.status === 403, `REST should refuse the agent, got ${rest.status}`);
        sameAnswer(rest, await invoke(withWallet.token, CONTACTS, {}), 'owner-only route');
    });

    await test('(b) and admits the owner in person through invoke', async () => {
        const rest = await json('/v1/messages/contacts', { headers: auth(a.token) });
        assert(rest.status === 200, `REST admits the owner, got ${rest.status}`);
        const via = await invoke(a.token, CONTACTS, {});
        assert(via.status === 200, `invoke admits the owner, got ${via.status}: ${JSON.stringify(via.body?.error)}`);
    });

    // ── (c) permission word ───────────────────────────────────────────────────
    await test('(c) without the permission word the agent gets the route\'s own refusal', async () => {
        const rest = await json('/v1/ledger/usage/runs', { headers: auth(noWallet.token) });
        assert(rest.status === 403, `REST should refuse without wallet:read, got ${rest.status}`);
        sameAnswer(rest, await invoke(noWallet.token, RUNS, {}), 'missing word');
    });

    await test('(c) with the word the same call is admitted', async () => {
        const via = await invoke(withWallet.token, RUNS, { query: { limit: 3 } });
        assert(via.status === 200, `expected 200, got ${via.status}: ${JSON.stringify(via.body?.error)}`);
        assert(via.body.data.capability === RUNS, 'it names what it ran');
        assert(via.body.data.status === 200, `and the route's status: ${via.body.data.status}`);
    });

    // ── (d) another owner's agent ─────────────────────────────────────────────
    await test('(d) another owner\'s agent gets the route\'s own refusal', async () => {
        const path = `/v1/agents/${encodeURIComponent(withWallet.name)}/telemetry`;
        const rest = await json(path, { headers: auth(stranger.token) });
        assert(rest.status >= 400, `REST should refuse another owner's agent, got ${rest.status}`);
        sameAnswer(rest, await invoke(stranger.token, TELEMETRY, { path: { name: withWallet.name } }), 'cross-owner');
        // And the agent's own owner reads it, so the refusal above is about who asked.
        const own = await invoke(a.token, TELEMETRY, { path: { name: withWallet.name } });
        assert(own.status === 200, `the owner reads their agent's telemetry, got ${own.status}: ${JSON.stringify(own.body?.error)}`);
    });

    // ── (e) a body the route does not take ────────────────────────────────────
    await test('(e) a body that does not match the contract gets the answer REST gives', async () => {
        const bad = { entries: 'not a list' };
        const rest = await json('/v1/memory/bulk', { method: 'POST', headers: auth(withWallet.token), body: JSON.stringify(bad) });
        assert(rest.status === 400, `REST refuses the body, got ${rest.status}`);
        sameAnswer(rest, await invoke(withWallet.token, BULK, { body: bad }), 'bad body');
    });

    // ── (f) tools as before ───────────────────────────────────────────────────
    await test('(f) invoking a tool id works as before', async () => {
        const r = await invoke(withWallet.token, 'aimeat_memory_write', { key: 'invr.note', value: { hello: 'tool' } });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const back = await json('/v1/memory/invr.note', { headers: auth(withWallet.token) });
        assert(back.status === 200 && back.body.data.value.hello === 'tool', 'the write is there');
    });

    // ── the edges ─────────────────────────────────────────────────────────────
    await test('a sign-in route is not a capability', async () => {
        const r = await invoke(withWallet.token, 'route:POST /v1/ghii/login', { body: { username: a.owner, password: PASSWORD } });
        assert(r.status === 404, `expected 404, got ${r.status}`);
        assert(r.body?.error?.code === 'NO_SUCH_CAPABILITY', `expected NO_SUCH_CAPABILITY, got ${r.body?.error?.code}`);
    });

    await test('a query parameter the route does not declare is refused, not sent', async () => {
        const r = await invoke(withWallet.token, RUNS, { query: { sneaky: 1 } });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(JSON.stringify(r.body?.error ?? {}).includes('sneaky'), 'and the refusal names it');
    });

    await test('a path value cannot climb out of its segment', async () => {
        const r = await invoke(a.token, TELEMETRY, { path: { name: '..' } });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    // secaudit2026nov26: a tool builds its path from the caller's values with encodeURIComponent,
    // which leaves `.` and `..`, and the URL parser of the in-process request then removed them, so
    // this input reached POST /v1/auth/refresh and answered 200 with a fresh token.
    await test('a tool\'s path value cannot climb out of its segment either', async () => {
        const r = await invoke(a.token, 'aimeat_extension_invoke', { extension_name: '..', instance_id: 'auth', action_id: 'refresh' });
        assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
        assert(r.body?.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body?.error?.code}`);
        assert(!JSON.stringify(r.body).includes('"token"'), 'and no token comes back');
    });

    await test('a missing path value is refused before anything is sent', async () => {
        const r = await invoke(a.token, TELEMETRY, {});
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(JSON.stringify(r.body?.error ?? {}).includes('name'), 'and the refusal names it');
    });
}

run()
    .catch(err => { failed++; console.error(`  ❌ setup: ${err.message}`); })
    .finally(() => {
        console.log(`\n  ${passed} passed, ${failed} failed\n`);
        process.exit(failed > 0 ? 1 : 0);
    });
