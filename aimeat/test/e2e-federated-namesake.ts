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
 *   v1.2.0 — 2026-09-13 — GET /v1/owners/:name: the visitor gets the namesake's public card, never
 *     its roles or its agent roster (the door compared the owner name).
 *   v1.1.0 — 2026-09-13 — The identity itself, which is the root: the visitor's session resolves to
 *     their HOME GHII, so it reads none of the namesake's memory (direct, ?owner_scope=true or a
 *     listing), writes into none of it, and GET /v1/ghii/me is not the namesake's profile.
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

    // ── The identity itself. Everything below follows from this one answer. ──
    await test('The visitor IS NOT the local namesake: their identity carries their HOME node', async () => {
        const me = await json('/v1/ghii/me', as(fedToken));
        const seen = me.body?.data?.ghii ?? '';
        assert(seen !== `${namesake}@${NODE_ID}`,
            `the visitor was handed the LOCAL account's identity: ${seen}`);
        assert(me.status === 404 || String(seen).endsWith(`@${homeNodeId}`),
            `a visitor is their home GHII or nothing here, got ${me.status} ${JSON.stringify(me.body?.data ?? me.body?.error).slice(0, 200)}`);
    });

    await test('GET /v1/owners/:name gives the visitor the namesake\'s public card, never its roles or agent roster', async () => {
        // "Is this you" was answered by comparing the session's owner NAME with the account, so a
        // visitor from another node was the local namesake at this door and saw who the operators are
        // and every agent GAII the account holds. Found 2026-09-13 reading the §83 shape door by door.
        const self = await json(`/v1/owners/${namesake}`, as(alice.token));
        assert(self.status === 200 && Array.isArray(self.body.data.roles) && Array.isArray(self.body.data.agents),
            `positive control: the local account sees its own roles and roster: ${JSON.stringify(self.body.data)}`);
        const seen = await json(`/v1/owners/${namesake}`, as(fedToken));
        assert(seen.status === 200, `the public card is public: ${seen.status}`);
        assert(seen.body.data.roles === undefined && seen.body.data.agents === undefined,
            `the visitor was shown the local account's roles or agents: ${JSON.stringify(seen.body.data)}`);
    });

    await test('The visitor cannot read the local namesake\'s PRIVATE memory', async () => {
        const w = await json('/v1/memory', as(alice.token, { method: 'POST', body: JSON.stringify({ key: 'namesake.private', value: { secret: `alice-${stamp}` }, visibility: 'private' }) }));
        assert(w.status === 201, `setup: the local account writes its own private record: ${w.status} ${JSON.stringify(w.body)}`);
        for (const path of ['/v1/memory/namesake.private', '/v1/memory/namesake.private?owner_scope=true']) {
            const r = await json(path, as(fedToken));
            const leaked = JSON.stringify(r.body?.data?.value ?? '');
            assert(!leaked.includes(`alice-${stamp}`),
                `the visitor read the local account's private memory via ${path}: ${r.status} ${leaked}`);
        }
        for (const path of ['/v1/memory', '/v1/memory?owner_scope=true', '/v1/memory?prefix=namesake.']) {
            const l = await json(path, as(fedToken));
            assert(!JSON.stringify(l.body?.data ?? '').includes('namesake.private'),
                `the visitor listed the local account's keys via ${path}: ${JSON.stringify(l.body?.data).slice(0, 300)}`);
        }
    });

    await test('A visitor\'s own write lands in THEIR namespace, never the namesake\'s', async () => {
        const vw = await json('/v1/memory', as(fedToken, { method: 'POST', body: JSON.stringify({ key: 'namesake.visitor', value: { by: `visitor-${stamp}` }, visibility: 'private' }) }));
        // The write is refused (no memory:write in this node's federated scopes) or it is stored
        // under the visitor's HOME identity. What it may never be is the namesake's namespace.
        if (vw.status === 201) {
            const landed = vw.body?.data?.owner_gaii ?? '';
            assert(landed !== `${namesake}@${NODE_ID}`, `the visitor wrote into the local account's namespace: ${landed}`);
        }
        const seen = await json('/v1/memory/namesake.visitor', as(alice.token));
        assert(!JSON.stringify(seen.body?.data?.value ?? '').includes(`visitor-${stamp}`),
            `the local account can see the visitor's write in its own namespace: ${JSON.stringify(seen.body?.data)}`);
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

    // THE WORK DOORS DO NOT REFUSE — THEY ANSWER, AND THE ANSWER WAS THE NAMESAKE'S. Three of them
    // decide "is this an owner session" and then fan out over `getAgentsByOwner(req.auth.owner)`,
    // which for a visitor is the local part of THEIR name and so names the local account. inbox and
    // overview were given `&& !req.auth.federated` when that was found; /v1/work/sent was missed.
    // So this is asserted on CONTENT and not on a status code: the door answers 200 either way.
    await test("The visitor's sent work is their own, never the local namesake's", async () => {
        // An agent of alice's asks an agent of bob's for something. Both are needed: a work request
        // to yourself is refused (SELF_WORK). Without a row to find, an empty list proves nothing.
        const newAgent = async (ownerName: string, ownerTok: string, label: string) => {
            const made = await json('/v1/agents', as(ownerTok, {
                method: 'POST', body: JSON.stringify({ name: label, owner: ownerName, capabilities: ['*'], model: 'test' }),
            }));
            assert(made.status === 201, `agent ${label}: ${made.status} ${JSON.stringify(made.body?.error)}`);
            const g = made.body.data.agent.gaii as string;
            const ts = new Date().toISOString();
            const tok = await json('/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii: g, timestamp: ts, signature: await signMsg(made.body.data.private_key, g + ts) }),
            });
            assert(tok.status === 200, `agent token ${label}: ${tok.status} ${JSON.stringify(tok.body?.error)}`);
            return { gaii: g, token: tok.body.data.token as string };
        };
        const asker = await newAgent(namesake, alice.token, `fedask${stamp}`);
        const doer = await newAgent(bobName, bob.token, `feddo${stamp}`);

        const action = `fedwork-probe-${stamp}`;
        const pub = await json('/v1/actions', as(doer.token, {
            method: 'POST',
            body: JSON.stringify({
                id: action, display_name: 'Federated namesake probe', description: 'Gives /v1/work/sent a row to find',
                input_schema: { type: 'object', properties: { text: { type: 'string' } } },
                output_schema: { type: 'object', properties: { result: { type: 'string' } } },
                pricing: { base_morsels: 1 },
            }),
        }));
        assert(pub.status === 201, `publish action: ${pub.status} ${JSON.stringify(pub.body?.error)}`);

        const mint = await json('/v1/admin/mint', as(operator.token, {
            method: 'POST', body: JSON.stringify({ gaii: asker.gaii, amount: 100 }),
        }));
        assert(mint.status === 200, `mint: ${mint.status} ${JSON.stringify(mint.body?.error)}`);

        const work = await json('/v1/work', as(asker.token, {
            method: 'POST',
            body: JSON.stringify({ action_id: action, provider_gaii: doer.gaii, input: { text: 'probe' }, ttl_hours: 24 }),
        }));
        assert(work.status === 201, `work submit: ${work.status} ${JSON.stringify(work.body?.error)}`);
        const tc = work.body.data.tracking_code as string;

        // The reach of a federated session is the LOCAL operator's decision, never the home node's:
        // register-login.ts takes the scopes from this peer's row. The default set has no
        // `work:read`, so the door refuses before the handler runs and the hole is unreachable — on
        // a node whose operator never granted it. Granting it here is what puts the handler in
        // front of the visitor, which is the configuration the finding is about.
        const scoped = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ federation_auth_scopes: ['memory:read', 'catalogue:read', 'work:read'] }),
        }));
        assert(scoped.status === 200, `granting the peer work:read: ${scoped.status} ${JSON.stringify(scoped.body?.error)}`);
        const relogin = await json('/v1/ghii/login', {
            method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }),
        });
        assert(relogin.status === 200, `federated re-login: ${relogin.status}`);
        const workToken = relogin.body.data.token as string;

        // The namesake sees their own, or the door would be broken in the other direction.
        const own = await json('/v1/work/sent', as(alice.token));
        assert(own.status === 200, `the namesake's own sent: ${own.status}`);
        assert((own.body.data.items as any[]).some(w => w.tracking_code === tc),
            `the namesake lost their own sent work: ${JSON.stringify(own.body.data.items).slice(0, 300)}`);

        // The visitor gets theirs, which is none.
        const seen = await json('/v1/work/sent', as(workToken));
        assert(seen.status === 200, `the visitor's sent: ${seen.status} ${JSON.stringify(seen.body?.error)}`);
        const codes = (seen.body.data.items as any[]).map(w => w.tracking_code);
        assert(!codes.includes(tc), `the visitor was handed the local namesake's sent work: ${JSON.stringify(codes)}`);

        // And the two doors that were fixed first stay fixed.
        for (const path of ['/v1/work/inbox', '/v1/work/overview']) {
            const r = await json(path, as(workToken));
            assert(r.status === 200, `${path}: ${r.status}`);
            assert(!JSON.stringify(r.body.data).includes(tc), `${path} handed the visitor the namesake's work`);
        }
    });

    // CORTEX WAS THE SAME NAME COMPARISON, ON THE WRITE SIDE TOO. Every ownership question in
    // services/cortex-lifecycle.ts is `ext.installedBy === caller.ownerName`, and callerOf() handed
    // it the bare owner name of a federated session — so the visitor did not merely READ the local
    // namesake's private cortexes, they owned them: update, deactivate, delete, and the namespace.
    await test("The local namesake's private cortex is not the visitor's to read or to delete", async () => {
        const cortexName = `fedns-private-${stamp}`;
        const manifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${cortexName}
  namespace: ${namesake}
  description: A private cortex of the LOCAL account
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: greeter
      filename: greeter.js
      exports: [hello]
      api_surface: hello()
`;
        const install = await json('/v1/cortex', as(alice.token, {
            method: 'POST',
            body: JSON.stringify({ manifest, libs: { 'greeter.js': 'window.hello = () => "local alice only";' } }),
        }));
        assert(install.status === 201, `install: ${install.status} ${JSON.stringify(install.body?.error)}`);

        // The namesake sees it, so an empty answer below is a fence and not a missing record.
        const mine = await json('/v1/cortex', as(alice.token));
        assert((mine.body.data.extensions as any[]).some(e => e.name === cortexName),
            `the namesake lost their own cortex: ${JSON.stringify((mine.body.data.extensions as any[]).map(e => e.name))}`);

        // The same point as the work door above: what a visitor may reach is this node's decision,
        // so grant the peer the words the cortex doors ask for and put the handlers in front of it.
        const scoped = await json(`/v1/federation/peers/${homeNodeId}`, as(operator.token, {
            method: 'PUT', body: JSON.stringify({ federation_auth_scopes: ['memory:read', 'catalogue:read', 'cortex:write'] }),
        }));
        assert(scoped.status === 200, `granting the peer cortex:write: ${scoped.status} ${JSON.stringify(scoped.body?.error)}`);
        const relogin = await json('/v1/ghii/login', {
            method: 'POST', body: JSON.stringify({ username: `${namesake}@${homeNodeId}`, password: 'the-home-node-decides' }),
        });
        assert(relogin.status === 200, `federated re-login: ${relogin.status}`);
        const cortexToken = relogin.body.data.token as string;

        const enc = encodeURIComponent(cortexName);
        const listed = await json('/v1/cortex', as(cortexToken));
        assert(listed.status === 200, `the visitor's list: ${listed.status}`);
        assert(!(listed.body.data.extensions as any[]).some(e => e.name === cortexName),
            "the visitor was shown the local namesake's private cortex");

        const detail = await json(`/v1/cortex/${enc}`, as(cortexToken));
        assert(detail.status !== 200, `the visitor opened it: ${detail.status} ${JSON.stringify(detail.body?.data ?? null).slice(0, 200)}`);

        const gone = await json(`/v1/cortex/${enc}`, as(cortexToken, { method: 'DELETE' }));
        assert(gone.status !== 200 && gone.status !== 204, `the visitor deleted it: ${gone.status}`);
        const after = await json('/v1/cortex', as(alice.token));
        assert((after.body.data.extensions as any[]).some(e => e.name === cortexName),
            "the visitor's DELETE removed the namesake's cortex");
    });
}

try {
    await run();
} finally {
    if (home) await new Promise<void>(r => home!.close(() => r()));
}
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
