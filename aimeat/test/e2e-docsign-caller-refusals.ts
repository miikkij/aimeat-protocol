/**
 * @file e2e-docsign-caller-refusals.ts
 * @description Who may create, read, sign, cancel and delete a document signing request, by kind of
 *   caller (routes/docsign.ts, services/docsign/records.ts), and the MCP tools that list, read and
 *   cancel requests (src/mcp/docsign.ts), each called and refused.
 *
 *   WHY THIS SUITE. The rules that decide who signs how are single lines, and five had no test (QA
 *   audit F03b-03):
 *   - an app grant may not sign with method `session` (records.ts, signRequest). An app grant acts
 *     under its owner's identity, so that one line is what keeps an installed app holding
 *     memory:write from sealing a signature recorded as the person's own;
 *   - a visitor signed in from another node may not create or sign (refuseVisitor), even when the
 *     receiving node granted its sessions memory:write;
 *   - a caller without the scope word is refused (requireScope on every route);
 *   - a request with no credential is refused with 401 (requireAuth; the anonymous identity the lane
 *     node runs with stops there too, before the service).
 *   The owner-level personal access token half of the finding is in e2e-docsign.ts (method `session`
 *   refused for a token, direct and exchanged).
 *
 *   W27 (MCP tools called and refused): aimeat_docsign_requests, aimeat_docsign_request_get and
 *   aimeat_docsign_cancel. aimeat_docsign_validate is in e2e-docsign-validation.ts.
 * @structure
 *   - Setup: operator, alice, bob; a request alice made, one bob made; agents of alice; an app grant
 *     of alice; a visitor from a home node served on loopback
 *   - Phase 1: no credential
 *   - Phase 2: an agent without the scope word
 *   - Phase 3: an app grant and method session
 *   - Phase 4: a visitor from another node
 *   - Phase 5: the MCP tools
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=docsign-caller-refusals
 * @version-history
 *   v1.1.0 — 2026-10-17 — Phase 5: an agent without memory:read is listed aimeat_docsign_requests
 *     (permission ask, mcp/permission-ask-gate.ts), and its call is refused SCOPE_DENIED with the
 *     allow address and no request in the answer.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03b-03, W27).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const call = (method: string, path: string, token: string | null, body?: unknown) =>
    json(path, { method, headers: token ? auth(token) : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const claims = (token: string): Record<string, any> => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

const stamp = Date.now().toString(36);
const names = { op: `dcrop${stamp}`, alice: `dcralice${stamp}`, bob: `dcrbob${stamp}` };
const ghii = (n: string) => `${n}@${NODE_ID}`;
const randomSha = () => createHash('sha256').update(randomBytes(16)).digest('hex');
const doc = (name: string) => ({ sha256: randomSha(), name, size: 10 });

let operator = { name: '', token: '' };
let alice = { name: '', token: '' };
let bob = { name: '', token: '' };
let aliceRequest = '';
let bobRequest = '';

// ── The visitor's home node: one route, the signed attestation register-login.ts verifies ──
const homeNodeId = `aimeat-fake-home-dcr-${stamp}`;
let homeKeys = { publicKey: '', privateKey: '' };
let homeUrl = '';
let home: Server | null = null;

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => { let raw = ''; req.on('data', c => { raw += c.toString(); }); req.on('end', () => resolve(raw)); });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'))).toString('base64');
}
function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                const who = /"username"\s*:\s*"([^"]+)"/.exec(await readBody(req))?.[1] ?? 'visitor';
                const payload = { verified: true, ghii: `${who}@${homeNodeId}`, display_name: 'A visitor', home_node: homeNodeId, home_url: homeUrl, scopes: ['memory:read', 'memory:write'] };
                send(res, 200, { ok: true, data: { ...payload, signature: await signMsg(homeKeys.privateKey, JSON.stringify(payload)) } });
                return;
            }
            send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
        })();
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
    });
}

// ── An app grant of alice: authorize, consent, token (PKCE), as e2e-access-page.ts does ──
const APP_FILE = `docsign-refusals-${stamp}.html`;
const REDIRECT = 'http://localhost:9911/callback';
async function appGrantToken(owner: { name: string; token: string }, scope: string): Promise<{ token: string; roles: string[] }> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${APP_FILE}`, response_type: 'code', scope, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
    assert(!!rid, `authorize gave a request id: ${res.status} ${res.headers.get('location')}`);
    const con = await call('POST', '/v1/app-grants/authorize-consent', owner.token, { request_id: rid });
    assert(con.status === 200, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await call('POST', '/v1/app-grants/token', null, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT });
    assert(tok.status === 200, `app token: ${tok.status} ${JSON.stringify(tok.body)}`);
    const token = tok.body.data.access_token as string;
    return { token, roles: claims(token).roles ?? [] };
}

async function run(): Promise<void> {
    console.log('\n=== Document signing: refusals by kind of caller ===\n');
    console.log('Setup');

    await test('An operator, alice and bob; a request each, naming its creator', async () => {
        operator = await registerOwner(BASE, names.op);
        alice = await registerOwner(BASE, names.alice);
        bob = await registerOwner(BASE, names.bob);
        const a = await call('POST', '/v1/docsign/requests', alice.token, { title: 'alice', document: doc('a.txt'), parties: [ghii(names.alice)] });
        assert(a.status === 201, `alice's request: ${a.status} ${JSON.stringify(a.body)}`);
        aliceRequest = a.body.data.request.id;
        const b = await call('POST', '/v1/docsign/requests', bob.token, { title: 'bob', document: doc('b.txt'), parties: [ghii(names.bob)] });
        assert(b.status === 201, `bob's request: ${b.status} ${JSON.stringify(b.body)}`);
        bobRequest = b.body.data.request.id;
    });

    console.log('\nPhase 1 — No credential');

    await test('Every signing route answers 401 to a request with no credential', async () => {
        const doors: Array<[string, string, unknown?]> = [
            ['POST', '/v1/docsign/requests', { title: 'x', document: doc('x.txt'), parties: [ghii(names.alice)] }],
            ['GET', '/v1/docsign/requests'],
            ['GET', `/v1/docsign/requests/${aliceRequest}`],
            ['POST', `/v1/docsign/requests/${aliceRequest}/passkey-options`, {}],
            ['POST', `/v1/docsign/requests/${aliceRequest}/sign`, { method: 'session' }],
            ['POST', `/v1/docsign/requests/${aliceRequest}/cancel`, {}],
            ['DELETE', `/v1/docsign/requests/${aliceRequest}`],
        ];
        for (const [method, path, body] of doors) {
            const r = await call(method, path, null, body);
            assert(r.status === 401, `${method} ${path} without a credential: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
        const still = await call('GET', `/v1/docsign/requests/${aliceRequest}`, alice.token);
        assert(still.body.data.request.state === 'open' && Object.keys(still.body.data.request.signatures ?? {}).length === 0, `nothing changed: ${JSON.stringify(still.body.data.request)}`);
    });

    console.log('\nPhase 2 — An agent without the scope word');

    await test('An agent of alice holding memory:read only cannot create, sign, cancel or delete (403 SCOPE_DENIED)', async () => {
        const reader = await makeAgent(BASE, alice, ['memory:read']);
        const doors: Array<[string, string, unknown?]> = [
            ['POST', '/v1/docsign/requests', { title: 'x', document: doc('x.txt'), parties: [reader.gaii] }],
            ['POST', `/v1/docsign/requests/${aliceRequest}/sign`, { method: 'session' }],
            ['POST', `/v1/docsign/requests/${aliceRequest}/cancel`, {}],
            ['DELETE', `/v1/docsign/requests/${aliceRequest}`],
        ];
        for (const [method, path, body] of doors) {
            const r = await call(method, path, reader.token, body);
            assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `${method} ${path}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
        // Positive control for the same agent: the word it holds opens the read.
        const read = await call('GET', `/v1/docsign/requests/${aliceRequest}`, reader.token);
        assert(read.status === 200, `the agent reads its owner's request: ${read.status} ${JSON.stringify(read.body?.error)}`);
    });

    await test('An agent of alice without memory:read cannot list or read requests (403 SCOPE_DENIED)', async () => {
        const none = await makeAgent(BASE, alice, ['catalogue:read']);
        for (const path of ['/v1/docsign/requests', `/v1/docsign/requests/${aliceRequest}`]) {
            const r = await call('GET', path, none.token);
            assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `GET ${path}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
    });

    console.log('\nPhase 3 — An app grant and method session');

    await test('An app grant of alice holding memory:write cannot sign as alice with method session (400 METHOD_NOT_ALLOWED); alice in person can', async () => {
        const pub = await call('POST', '/v1/apps', alice.token, {
            filename: APP_FILE, content: Buffer.from('<!DOCTYPE html><html><body>docsign refusals</body></html>').toString('base64'),
            name: 'Docsign refusals', description: 'a docsign refusal fixture', category: 'utility',
        });
        assert(pub.status === 200 || pub.status === 201, `publish the app: ${pub.status} ${JSON.stringify(pub.body)}`);
        const app = await appGrantToken(alice, 'memory:read memory:write');
        assert(app.roles.includes('app'), `the token is an app grant: ${JSON.stringify(app.roles)}`);
        // The grant passes requireScope and reads the request as alice's: the refusal is the method rule.
        const read = await call('GET', `/v1/docsign/requests/${aliceRequest}`, app.token);
        assert(read.status === 200, `the app grant reads alice's request: ${read.status} ${JSON.stringify(read.body?.error)}`);
        const r = await call('POST', `/v1/docsign/requests/${aliceRequest}/sign`, app.token, { method: 'session' });
        assert(r.status === 400 && r.body.error?.code === 'METHOD_NOT_ALLOWED', `app grant, method session: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const after = await call('GET', `/v1/docsign/requests/${aliceRequest}`, alice.token);
        assert(Object.keys(after.body.data.request.signatures ?? {}).length === 0, `no signature was sealed: ${JSON.stringify(after.body.data.request.signatures)}`);
        const own = await call('POST', `/v1/docsign/requests/${aliceRequest}/sign`, alice.token, { method: 'session' });
        assert(own.status === 200 && own.body.data.request.state === 'complete', `alice in person signs: ${own.status} ${JSON.stringify(own.body?.error ?? own.body.data.request.state)}`);
    });

    console.log('\nPhase 4 — A visitor from another node');

    let visitor = '';
    await test('A visitor from a peer node, granted memory:write here, signs in as a visitor', async () => {
        homeKeys = await (async () => {
            const priv = ed.utils.randomSecretKey();
            return { publicKey: Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
        })();
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const reg = await call('POST', '/v1/federation/peers', operator.token, { node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey });
        assert(reg.status === 201, `peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const act = await call('PUT', `/v1/federation/peers/${homeNodeId}`, operator.token, { status: 'active', federation_auth_scopes: ['memory:read', 'memory:write'] });
        assert(act.status === 200, `peer activate: ${act.status} ${JSON.stringify(act.body)}`);
        const login = await call('POST', '/v1/ghii/login', null, { username: `dcrvisitor${stamp}@${homeNodeId}`, password: 'the-home-node-decides' });
        assert(login.status === 200, `federated login: ${login.status} ${JSON.stringify(login.body)}`);
        visitor = login.body.data.token;
        const c = claims(visitor);
        assert(c.federated === true && (c.scopes ?? []).includes('memory:write'), `a visitor holding memory:write: ${JSON.stringify({ federated: c.federated, roles: c.roles, scopes: c.scopes })}`);
    });

    await test('The visitor cannot create a request (403 FORBIDDEN), even one naming a local person', async () => {
        const r = await call('POST', '/v1/docsign/requests', visitor, { title: 'visitor', document: doc('v.txt'), parties: [ghii(names.bob)] });
        assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN', `visitor create: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('The visitor cannot sign (403 FORBIDDEN), and cannot read, cancel or delete bob\'s request', async () => {
        const s = await call('POST', `/v1/docsign/requests/${bobRequest}/sign`, visitor, { method: 'session' });
        assert(s.status === 403 && s.body.error?.code === 'FORBIDDEN', `visitor sign: ${s.status} ${JSON.stringify(s.body?.error)}`);
        for (const [method, path] of [['GET', `/v1/docsign/requests/${bobRequest}`], ['POST', `/v1/docsign/requests/${bobRequest}/cancel`], ['DELETE', `/v1/docsign/requests/${bobRequest}`]] as const) {
            const r = await call(method, path, visitor, method === 'POST' ? {} : undefined);
            assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `visitor ${method} ${path}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
        const still = await call('GET', `/v1/docsign/requests/${bobRequest}`, bob.token);
        assert(still.body.data.request.state === 'open' && Object.keys(still.body.data.request.signatures ?? {}).length === 0, `bob's request is untouched: ${JSON.stringify(still.body.data.request)}`);
    });

    console.log('\nPhase 5 — The MCP tools');

    await test('aimeat_docsign_requests lists what the agent\'s owner is a party to, and not bob\'s; an agent without memory:read is refused it with the allow address', async () => {
        const agent = await makeAgent(BASE, alice, ['memory:read']);
        const s = await openSession(BASE, agent.token);
        const r = await callTool(s, 'aimeat_docsign_requests', {});
        assert(!r.isError, `list: ${r.text}`);
        const ids = (r.data.requests as Array<{ id: string }>).map(x => x.id);
        assert(ids.includes(aliceRequest) && !ids.includes(bobRequest), `alice's request and not bob's: ${JSON.stringify(ids)}`);
        const none = await openSession(BASE, (await makeAgent(BASE, alice, ['catalogue:read'])).token);
        const refused = await callTool(none, 'aimeat_docsign_requests', {});
        // Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
        assert(refused.isError && refused.offered && /^SCOPE_DENIED/.test(refused.text) && refused.text.includes('/v1/allow?') && !refused.text.includes(aliceRequest),
            `without memory:read: ${refused.text}`);
    });

    await test('aimeat_docsign_request_get reads alice\'s request with its checks; bob\'s answers as absent', async () => {
        const s = await openSession(BASE, (await makeAgent(BASE, alice, ['memory:read'])).token);
        const r = await callTool(s, 'aimeat_docsign_request_get', { id: aliceRequest });
        assert(!r.isError && r.data.request?.id === aliceRequest && Array.isArray(r.data.checks), `get: ${r.text.slice(0, 300)}`);
        const other = await callTool(s, 'aimeat_docsign_request_get', { id: bobRequest });
        assert(other.isError && other.offered && /NOT_FOUND/.test(other.text), `bob's request: ${other.text}`);
    });

    await test('aimeat_docsign_cancel cancels the agent\'s own request; bob\'s request, and one the agent did not make, are refused', async () => {
        const agent = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);
        const made = await call('POST', '/v1/docsign/requests', agent.token, { title: 'agent', document: doc('g.txt'), parties: [agent.gaii] });
        assert(made.status === 201, `the agent's request: ${made.status} ${JSON.stringify(made.body)}`);
        const own = made.body.data.request.id as string;
        const s = await openSession(BASE, agent.token);
        const theirs = await callTool(s, 'aimeat_docsign_cancel', { id: bobRequest });
        assert(theirs.isError && theirs.offered && /NOT_FOUND/.test(theirs.text), `bob's request: ${theirs.text}`);
        // alice's second request names alice, so the agent reads it, but only its creator cancels it.
        const second = await call('POST', '/v1/docsign/requests', alice.token, { title: 'alice 2', document: doc('a2.txt'), parties: [ghii(names.alice)] });
        const notMine = await callTool(s, 'aimeat_docsign_cancel', { id: second.body.data.request.id });
        assert(notMine.isError && /FORBIDDEN/.test(notMine.text), `a request the agent did not make: ${notMine.text}`);
        const r = await callTool(s, 'aimeat_docsign_cancel', { id: own });
        assert(!r.isError && r.data.request?.state === 'cancelled', `cancel: ${r.text.slice(0, 300)}`);
        const back = await call('GET', `/v1/docsign/requests/${own}`, agent.token);
        assert(back.body.data.request.state === 'cancelled', `read back over REST: ${JSON.stringify(back.body.data?.request?.state)}`);
        const bobs = await call('GET', `/v1/docsign/requests/${bobRequest}`, bob.token);
        assert(bobs.body.data.request.state === 'open', 'bob\'s request is still open');
    });
}

await run();
(home as Server | null)?.close();
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
