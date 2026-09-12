/**
 * @file test/e2e-federated-namesake.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A visitor signed in from another node never reaches the mailbox of the LOCAL account
 *   that happens to share their name.
 *
 *   WHY. A federated login mints roles:['owner'] with `owner` set to the local part of the visitor's
 *   home GHII (routes/ghii/register-login.ts). Every door in routes/messages.ts derives the mailbox
 *   from that name, so `alice@other-node` signing in here was handed the mailbox of `alice@this-node`:
 *   her contact requests, her address book, and the power to accept, block, mark read and transcribe
 *   in it. requireRole('owner') admitted the session because its role says owner. A visitor has no
 *   mailbox on this node at all (their messages are addressed to their home GHII and delivered
 *   there), so every messages door now refuses a federated session with requireLocalSession().
 *
 *   The home node is served on loopback the way test/e2e-federated-session.ts serves it: an active
 *   peer registered through the real operator routes, answering the verify door with a SIGNED
 *   attestation. The runner pins AIMEAT_FEDERATION_AUTH_POLICY=all_peers and private egress.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federated-namesake
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial, with requireLocalSession on every door in routes/messages.ts.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function newKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return { publicKey: Buffer.from(pub).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
}
function claims(token: string): Record<string, any> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

const stamp = Date.now().toString(36);
const operatorName = `fednsop${stamp}`;
const namesake = `fednsalice${stamp}`;          // a LOCAL account, and the visitor's name on their home node
const bobName = `fednsbob${stamp}`;
const carolName = `fednscarol${stamp}`;
const homeNodeId = `aimeat-fake-home-ns-${stamp}`;

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

/** The home node: one door, the signed attestation register-login.ts verifies. */
function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                await readBody(req);
                const payload = {
                    verified: true,
                    ghii: `${namesake}@${homeNodeId}`,
                    display_name: 'A visitor who shares a local name',
                    home_node: homeNodeId,
                    home_url: homeUrl,
                    scopes: ['memory:read'],
                };
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

async function registerOwner(name: string): Promise<{ ghii: string; token: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { ghii: `${name}@${NODE_ID}`, token: tok.body.data.token };
}

async function sendDm(fromToken: string, to: string, body: string): Promise<{ id: string; conversationId: string }> {
    const r = await json('/v1/messages', as(fromToken, { method: 'POST', body: JSON.stringify({ to, body }) }));
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body)}`);
    return { id: r.body.data.message.id, conversationId: r.body.data.message.conversationId };
}

console.log('\n=== A visitor from another node and the local account that shares their name ===\n');

let operator = { ghii: '', token: '' };
let alice = { ghii: '', token: '' };   // the local namesake
let bob = { ghii: '', token: '' };
let fedToken = '';
let fromBob = { id: '', conversationId: '' };
let fromCarol = { id: '', conversationId: '' };

async function run() {
    await test('Setup: an operator, the local namesake and two correspondents; a home node on loopback', async () => {
        operator = await registerOwner(operatorName);
        assert((claims(operator.token).roles ?? []).includes('operator'), 'this suite needs to be the first owner on a freshly deleted database');
        alice = await registerOwner(namesake);
        bob = await registerOwner(bobName);
        const carol = await registerOwner(carolName);
        fromBob = await sendDm(bob.token, alice.ghii, `bob to the local alice ${stamp}`);
        fromCarol = await sendDm(carol.token, alice.ghii, `carol to the local alice ${stamp}`);

        homeKeys = await newKeyPair();
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const reg = await json('/v1/federation/peers', as(operator.token, { method: 'POST', body: JSON.stringify({ node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey }) }));
        assert(reg.status === 201, `peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const act = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, { method: 'PUT', body: JSON.stringify({ status: 'active' }) }));
        assert(act.status === 200, `peer activate: ${act.status} ${JSON.stringify(act.body)}`);
    });

    await test('The visitor signs in from the home node, and the session carries the LOCAL name', async () => {
        const r = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }) });
        assert(r.status === 200, `federated login: ${r.status} ${JSON.stringify(r.body)}`);
        fedToken = r.body.data.token;
        const c = claims(fedToken);
        assert(c.federated === true && c.owner === namesake, `the session this suite is about: ${JSON.stringify({ federated: c.federated, owner: c.owner })}`);
    });

    await test('The local account itself still reads its own mailbox', async () => {
        const reqs = await json('/v1/messages/contacts', as(alice.token));
        assert(reqs.status === 200, `the namesake's own contacts: ${reqs.status}`);
        const inbox = await json('/v1/messages/overview', as(alice.token));
        assert(inbox.status === 200, `the namesake's own overview: ${inbox.status}`);
    });

    // Every door in routes/messages.ts, as the visitor. Each is refused with 403, and the ones that
    // would change something are checked afterwards from the local account's own session.
    const reads: Array<[string, () => string]> = [
        ['GET /v1/messages/requests', () => '/v1/messages/requests'],
        ['GET /v1/messages/contacts', () => '/v1/messages/contacts'],
        ['GET /v1/messages/inbox', () => '/v1/messages/inbox'],
        ['GET /v1/messages/conversations', () => '/v1/messages/conversations'],
        ['GET /v1/messages/overview', () => '/v1/messages/overview'],
        ['GET /v1/messages/conversations/:id', () => `/v1/messages/conversations/${encodeURIComponent(fromBob.conversationId)}`],
        ['GET /v1/messages/agent-inbox', () => '/v1/messages/agent-inbox'],
        ['GET /v1/messages/agent-thread/:id', () => `/v1/messages/agent-thread/${encodeURIComponent(fromBob.conversationId)}`],
        ['GET /v1/messages/broadcast/:id', () => '/v1/messages/broadcast/does-not-matter'],
    ];
    for (const [label, path] of reads) {
        await test(`${label} refuses the visitor`, async () => {
            const r = await json(path(), as(fedToken));
            assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
        });
    }

    await test('POST accept / block, and the local contact states do not move', async () => {
        const before = await json('/v1/messages/contacts', as(alice.token));
        const accept = await json(`/v1/messages/requests/${encodeURIComponent(bob.ghii)}/accept`, as(fedToken, { method: 'POST' }));
        assert(accept.status === 403, `accept: expected 403, got ${accept.status}: ${JSON.stringify(accept.body).slice(0, 300)}`);
        const block = await json(`/v1/messages/contacts/${encodeURIComponent(bob.ghii)}/block`, as(fedToken, { method: 'POST' }));
        assert(block.status === 403, `block: expected 403, got ${block.status}: ${JSON.stringify(block.body).slice(0, 300)}`);
        const after = await json('/v1/messages/contacts', as(alice.token));
        assert(JSON.stringify(after.body.data.contacts) === JSON.stringify(before.body.data.contacts),
            `the visitor changed the local account's contacts: ${JSON.stringify(before.body.data.contacts)} → ${JSON.stringify(after.body.data.contacts)}`);
    });

    await test('Marking read, one message or a whole thread, is refused and nothing is marked', async () => {
        const one = await json(`/v1/messages/${encodeURIComponent(fromCarol.id)}/read`, as(fedToken, { method: 'PATCH' }));
        assert(one.status === 403, `PATCH read: expected 403, got ${one.status}: ${JSON.stringify(one.body).slice(0, 300)}`);
        const thread = await json(`/v1/messages/conversations/${encodeURIComponent(fromBob.conversationId)}/read`, as(fedToken, { method: 'POST' }));
        assert(thread.status === 403, `POST thread read: expected 403, got ${thread.status}: ${JSON.stringify(thread.body).slice(0, 300)}`);
        for (const convo of [fromBob.conversationId, fromCarol.conversationId]) {
            const own = await json(`/v1/messages/conversations/${encodeURIComponent(convo)}`, as(alice.token));
            const inbound = (own.body.data.messages ?? []).filter((m: any) => m.direction === 'inbound');
            assert(inbound.length > 0, `setup: the local account should hold an inbound message in ${convo}`);
            assert(inbound.every((m: any) => !m.readAt), `the visitor marked the local account's messages read: ${JSON.stringify(inbound.map((m: any) => m.readAt))}`);
        }
    });

    await test('The address book doors (/v1/contacts) refuse the visitor, and nothing is saved', async () => {
        const list = await json('/v1/contacts', as(fedToken));
        assert(list.status === 403, `GET /v1/contacts: expected 403, got ${list.status}: ${JSON.stringify(list.body).slice(0, 300)}`);
        const save = await json('/v1/contacts', as(fedToken, { method: 'POST', body: JSON.stringify({ identity: bob.ghii, name: 'saved by the visitor' }) }));
        assert(save.status === 403, `POST /v1/contacts: expected 403, got ${save.status}: ${JSON.stringify(save.body).slice(0, 300)}`);
        const invite = await json('/v1/contacts/invite', as(fedToken, { method: 'POST', body: JSON.stringify({ email: 'nobody@example.invalid' }) }));
        assert(invite.status === 403, `POST /v1/contacts/invite: expected 403, got ${invite.status}`);
        const own = await json('/v1/contacts', as(alice.token));
        assert(own.status === 200, `the namesake's own address book: ${own.status}`);
        assert(!JSON.stringify(own.body.data).includes('saved by the visitor'), 'the visitor saved a contact into the local account');
    });

    await test('Transcribe, delete, send and broadcast refuse the visitor', async () => {
        const tr = await json(`/v1/messages/${encodeURIComponent(fromBob.id)}/attachments/none/transcribe`, as(fedToken, { method: 'POST', body: '{}' }));
        assert(tr.status === 403, `transcribe: expected 403, got ${tr.status}: ${JSON.stringify(tr.body).slice(0, 300)}`);
        const del = await json(`/v1/messages/${encodeURIComponent(fromBob.id)}`, as(fedToken, { method: 'DELETE' }));
        assert(del.status === 403, `delete: expected 403, got ${del.status}`);
        const sendAs = await json('/v1/messages', as(fedToken, { method: 'POST', body: JSON.stringify({ to: bob.ghii, body: 'not from the local alice' }) }));
        assert(sendAs.status === 403, `send: expected 403, got ${sendAs.status}`);
        const broad = await json('/v1/messages/broadcast', as(fedToken, { method: 'POST', body: JSON.stringify({ to: [bob.ghii], body: 'nor this' }) }));
        assert(broad.status === 403, `broadcast: expected 403, got ${broad.status}`);
    });

    await test('The refusal names the reason: a session from another node has no mailbox here', async () => {
        const r = await json('/v1/messages/requests', as(fedToken));
        assert(r.body?.error?.code === 'FORBIDDEN', `code: ${JSON.stringify(r.body?.error)}`);
    });
}

try {
    await run();
} finally {
    if (home) await new Promise<void>(r => home!.close(() => r()));
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
