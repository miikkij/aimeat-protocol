/**
 * @file test/e2e-federated-members-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description 'members' content is for this node's own accounts and the agents and apps acting for
 *   one, on every read path that runs the shared guard (services/access-guard.ts authorizeRead), not
 *   only on the two routes that said the reader was a visitor (GET /v1/memory/:gaii/:key and
 *   GET /v1/pub). A visitor signed in from another node reads a 'members' file through an
 *   extension's ctx.files.read only when its owner gave it a consent; the owner's permission
 *   simulation answers as the read does; the node's MCP endpoint admits no visitor session at all.
 *   Kept: a local account reads the same file through the extension, a public file stays readable to
 *   the visitor, and a consent naming the visitor admits it.
 *
 *   The home node is served on loopback the way test/e2e-federated-namesake.ts serves it: an active
 *   peer registered through the real operator routes, answering the verify route with a signed
 *   attestation.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federated-members-reads
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22, members-tier-admits-federated-visitor).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { registerOwner as registerWithPassword } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const as = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });

const stamp = Date.now().toString(36);
const homeNodeId = `aimeat-fake-home-mr-${stamp}`;
const visitorName = `fedmrcarol${stamp}`;
const visitorGhii = `${visitorName}@${homeNodeId}`;
const EXT = `fedmrpeek${stamp}`;
const MEMBERS_KEY = `fedmr/members-${stamp}.txt`;
/** The members file's content: a text the key does not contain, so a refusal naming the key is no leak. */
const MEMBERS_TEXT = `only-accounts-here-${stamp}`;
const PUBLIC_KEY = `fedmr/public-${stamp}.txt`;

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
/** The home node: the one route register-login.ts verifies a visitor's sign-in with. */
function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                const who = /"username"\s*:\s*"([^"]+)"/.exec(await readBody(req))?.[1] ?? visitorName;
                const payload = { verified: true, ghii: `${who}@${homeNodeId}`, display_name: 'A visitor', home_node: homeNodeId, home_url: homeUrl, scopes: ['memory:read'] };
                const sig = await ed.signAsync(new TextEncoder().encode(JSON.stringify(payload)), Buffer.from(homeKeys.privateKey, 'base64'));
                send(res, 200, { ok: true, data: { ...payload, signature: Buffer.from(sig).toString('base64') } });
                return;
            }
            send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
        })();
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
    });
}

async function registerOwner(name: string): Promise<{ ghii: string; token: string }> {
    const owner = await registerWithPassword(BASE, name);
    return { ghii: `${name}@${NODE_ID}`, token: owner.token };
}

const PEEK = `export default async function(ctx, input){
  try { const got = await ctx.files.read(input.ref); return { ok: true, size: got && got.size, b64: got ? got.base64 : null }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
}`;
const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'members reads e2e', author: 'e2e' },
    actions: [{ id: 'peek', method: 'POST', path: '/peek', script: 'peek' }],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 8000, max_api_calls: 8 },
});

let operator = { ghii: '', token: '' };
let alice = { ghii: '', token: '' };
let bob = { ghii: '', token: '' };
let fedToken = '';

/** Invoke the extension's peek action; `data.text` is the file's text when the read succeeded. */
const peek = async (token: string, ref: string) => {
    const r = await json(`/v1/ext/${EXT}/peek`, as(token, { method: 'POST', body: JSON.stringify({ ref }) }));
    if (r.body?.data?.b64) r.body.data.text = Buffer.from(r.body.data.b64 as string, 'base64').toString('utf8');
    return r;
};

console.log('\n=== members content and a visitor from another node, on every read path ===\n');

async function run() {
    await test('Setup: an operator, an owner with a members and a public file, a local reader, an extension, a home node', async () => {
        operator = await registerOwner(`fedmrop${stamp}`);
        alice = await registerOwner(`fedmralice${stamp}`);
        bob = await registerOwner(`fedmrbob${stamp}`);
        for (const [key, visibility, text] of [[MEMBERS_KEY, 'members', MEMBERS_TEXT], [PUBLIC_KEY, 'public', `public-${stamp}`]] as const) {
            const put = await json('/v1/storage', as(alice.token, { method: 'POST', body: JSON.stringify({ key, data: Buffer.from(text).toString('base64'), mime_type: 'text/plain', visibility }) }));
            assert(put.status === 201 && put.body.data.visibility === visibility, `storing ${key}: ${put.status} ${JSON.stringify(put.body?.error ?? put.body?.data?.visibility)}`);
        }
        const inst = await json('/v1/extensions', as(alice.token, { method: 'POST', body: JSON.stringify({ manifest, scripts: { peek: PEEK } }) }));
        assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${EXT}/activate`, as(alice.token, { method: 'POST' }));
        assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);

        const priv = ed.utils.randomSecretKey();
        homeKeys = { publicKey: Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const reg = await json('/v1/federation/peers', as(operator.token, { method: 'POST', body: JSON.stringify({ node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey }) }));
        assert(reg.status === 201, `peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        // What a visitor may reach is this node's decision: the operator grants the peer's visitors
        // the words the reads below ask for, so a refusal below is the guard and not a missing word.
        const act2 = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ status: 'active', federation_auth_scopes: ['memory:read', 'catalogue:read', 'storage:read', 'ext:invoke'] }),
        }));
        assert(act2.status === 200, `peer activate: ${act2.status} ${JSON.stringify(act2.body)}`);
        const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: visitorGhii, password: 'the-home-node-decides' }) });
        assert(login.status === 200, `federated login: ${login.status} ${JSON.stringify(login.body)}`);
        fedToken = login.body.data.token;
        const claims = JSON.parse(Buffer.from(fedToken.split('.')[1], 'base64url').toString());
        assert(claims.federated === true && (claims.scopes ?? []).includes('ext:invoke'), `the visitor session: ${JSON.stringify({ federated: claims.federated, scopes: claims.scopes })}`);
    });

    await test('An extension reads a members file for a local account, and refuses it for the visitor', async () => {
        const ref = `${alice.ghii}/${MEMBERS_KEY}`;
        const local = await peek(bob.token, ref);
        assert(local.status === 200 && local.body.data?.ok === true && local.body.data.text === MEMBERS_TEXT,
            `a local account lost its members read through the extension: ${local.status} ${JSON.stringify(local.body?.data ?? local.body?.error)}`);
        const visitor = await peek(fedToken, ref);
        assert(visitor.status === 200, `the visitor's invoke: ${visitor.status} ${JSON.stringify(visitor.body?.error)}`);
        assert(visitor.body.data?.ok === false, `a visitor from another node read a members file through ctx.files.read: ${JSON.stringify(visitor.body.data)}`);
        assert(!JSON.stringify(visitor.body).includes(MEMBERS_TEXT), 'the visitor was handed the members file content');
    });

    await test('Kept: the visitor reads a public file through the extension, and a members file once a consent names it', async () => {
        const pub = await peek(fedToken, `${alice.ghii}/${PUBLIC_KEY}`);
        assert(pub.status === 200 && pub.body.data?.ok === true && pub.body.data.text === `public-${stamp}`,
            `a visitor lost its public read: ${pub.status} ${JSON.stringify(pub.body?.data ?? pub.body?.error)}`);
        const c = await json('/v1/consent', as(alice.token, { method: 'POST', body: JSON.stringify({ data_pattern: `storage:${MEMBERS_KEY}`, recipient: visitorGhii, purpose: 'the visitor by name' }) }));
        assert(c.status === 201, `setup: a consent for the visitor: ${c.status} ${JSON.stringify(c.body?.error)}`);
        try {
            const consented = await peek(fedToken, `${alice.ghii}/${MEMBERS_KEY}`);
            assert(consented.status === 200 && consented.body.data?.ok === true && consented.body.data.text === MEMBERS_TEXT,
                `a consent for the visitor by name did not admit it: ${JSON.stringify(consented.body?.data ?? consented.body?.error)}`);
        } finally {
            if (c.body?.data?.id) await json(`/v1/consent/${encodeURIComponent(c.body.data.id as string)}`, as(alice.token, { method: 'DELETE' }));
        }
    });

    await test('The owner\'s permission check answers for a visitor as the read does', async () => {
        const key = `fedmr.note${stamp}`;
        const w = await json('/v1/memory', as(alice.token, { method: 'POST', body: JSON.stringify({ key, value: { note: 'm' }, visibility: 'members' }) }));
        assert(w.status === 201, `setup: a members record: ${w.status}`);
        const ask = (accessor: string) => json(`/v1/permissions/check?key=${encodeURIComponent(key)}&accessor=${encodeURIComponent(accessor)}`, as(alice.token));
        const local = await ask(bob.ghii);
        assert(local.status === 200 && local.body.data.allowed === true, `a local account must read a members record: ${JSON.stringify(local.body?.data ?? local.body?.error)}`);
        const visitor = await ask(visitorGhii);
        assert(visitor.status === 200 && visitor.body.data.allowed === false,
            `the check said a visitor from another node may read a members record, which the read refuses: ${JSON.stringify(visitor.body?.data ?? visitor.body?.error)}`);
        const read = await json(`/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(key)}`, as(fedToken));
        assert(read.status === 404 || read.status === 403, `the read itself: ${read.status}`);
        // The check is the owner's own: it needs consent:manage, which a visitor session never holds.
        const visitorAsks = await json(`/v1/permissions/check?key=${encodeURIComponent(key)}&accessor=${encodeURIComponent(visitorGhii)}`, as(fedToken));
        assert(visitorAsks.status === 403, `a visitor ran the owner's permission check: ${visitorAsks.status} ${JSON.stringify(visitorAsks.body?.data ?? visitorAsks.body?.error)}`);
        await json(`/v1/memory/${encodeURIComponent(key)}`, as(alice.token, { method: 'DELETE' }));
    });

    await test('The node\'s MCP endpoint admits no visitor session, so aimeat_storage_download is not a visitor path', async () => {
        const r = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'members reads e2e', version: '1.0.0' } } }),
        });
        const text = await r.text();
        assert(r.status === 401 || r.status === 403, `a visitor session opened MCP: ${r.status} ${text.slice(0, 200)}`);
    });
}

try {
    await run();
} finally {
    if (home) await new Promise<void>(r => home!.close(() => r()));
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
