/**
 * @file test/e2e-peer-registration-proof.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package repository registers a node as a peer only after the node's own card
 *   answers with the same id and key, and a peer registered that way reaches nothing but packages
 *   (the peer-registration incident of 2026-10-01, finding F of docs/specs/package-sale-design.md).
 *
 *   WHAT WAS OPEN. Any owner with packages:write named any node id that was not yet a peer, with a
 *   url and key of their own, and the repository wrote it as an active peer. Under the federated
 *   sign-in policy aimeat.io runs (all_peers), a password typed for user@<that id> then went to the
 *   chosen url, and the reply was verified with the chosen key, so the registrant could sign in as any
 *   user of that node; and a direct message to someone@<that id> went to the chosen url too.
 *
 *   The stubs here are what such a registrant runs: a node:http server answering the card, the
 *   sign-in verification and the message route, recording what arrives, so an assertion holds what
 *   this node actually sent rather than what it says about itself.
 *
 *   One repository node, booted in this process on a free port, with the sign-in policy set to
 *   all_peers as on aimeat.io. Every stub and the closed port are free ports too, so nothing here is
 *   pinned.
 * @structure Phase 1 boot · 2 who may register, and the card check · 3 a registered packages-only
 *   peer: its origin, no sign-in, no messages · 4 a node that does not answer: the grant waits, its
 *   first signed request finishes it · 5 releasing a node id · 6 the Security page · 7 the federation
 *   routes the sweep found · cleanup
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-peer-registration-proof
 * @version-history
 *   v1.2.0 — 2026-10-10 — Phase 4: an unsigned request, or one signed with another key, naming a waiting
 *     node writes nothing to its pending record or the peer registry (secaudit 2026-10-10 I7).
 *   v1.1.0 — 2026-10-01 — Phase 6: the Security page entries for a failed card check and a held node
 *     id. Phase 7: the five sweep defects (a pending introduction no longer deletes a leaving peer,
 *     an open join cannot replace a held id, a message waits for a live link, a peer speaks only for
 *     its own people, a join saves a peer only with a key from the node asked and never over an
 *     existing one, a waiting join's key is proven by the approved card).
 *   v1.0.0 — 2026-10-01 — Initial. Against the code before the fix, the refusals of Phase 2, the
 *     sign-in and message assertions of Phase 3 and the pending registration of Phase 4 fail.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { sign, generateKeyPair } from '../src/auth/keypair.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** A port nothing listens on at this moment. */
async function freePort(): Promise<number> {
    const s = createHttpServer();
    await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
    const port = (s.address() as AddressInfo).port;
    await new Promise<void>(r => s.close(() => r()));
    return port;
}

function makeJson(baseUrl: string) {
    return async (path: string, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

// ─── A node someone else runs ────────────────────────────────────────────────

interface Stub {
    server: HttpServer; url: string; nodeId: string; keys: { publicKey: string; privateKey: string };
    verify: unknown[]; messages: unknown[];
    /** How it answers an introduction and a key exchange, changeable while the test runs. */
    behave: { introduceStatus?: 'auto_approved' | 'pending'; exchangeAs?: string };
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => { let raw = ''; req.on('data', c => { raw += c.toString(); }); req.on('end', () => resolve(raw)); });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/**
 * A server that says it is `nodeId` (or `cardId`) with `keys` (or `cardKey`), signs every sign-in it
 * is asked about, and takes every message. On `port` when given, so a closed port can open later.
 */
async function startStub(nodeId: string, opts: { port?: number; cardId?: string; cardKey?: string } = {}): Promise<Stub> {
    const keys = await generateKeyPair();
    const stub = { nodeId, keys, verify: [] as unknown[], messages: [] as unknown[], behave: {} } as Partial<Stub>;
    const server = createHttpServer((req, res) => {
        void (async () => {
            const body = req.method === 'POST' ? await readBody(req) : '';
            if (req.method === 'GET' && req.url === '/.well-known/aimeat') {
                send(res, 200, { ok: true, data: { node_id: opts.cardId ?? nodeId, protocol: 'aimeat', public_key: opts.cardKey ?? keys.publicKey } });
                return;
            }
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                stub.verify!.push(JSON.parse(body));
                const who = (JSON.parse(body) as { username?: string }).username ?? 'someone';
                const payload = { verified: true, ghii: `${who}@${nodeId}`, display_name: who, home_node: nodeId, home_url: stub.url, scopes: [] };
                send(res, 200, { ok: true, data: { ...payload, signature: await sign(keys.privateKey, JSON.stringify(payload)) } });
                return;
            }
            if (req.method === 'POST' && req.url === '/v1/federation/message') {
                stub.messages!.push(JSON.parse(body));
                send(res, 200, { ok: true, data: { received: true } });
                return;
            }
            if (req.method === 'POST' && req.url === '/v1/federation/peer/introduce') {
                send(res, 200, { ok: true, data: { request_id: `req-${randomUUID()}`, status: stub.behave!.introduceStatus ?? 'auto_approved' } });
                return;
            }
            if (req.method === 'POST' && req.url === '/v1/federation/key-exchange') {
                send(res, 200, { ok: true, data: { node_id: stub.behave!.exchangeAs ?? opts.cardId ?? nodeId, node_public_key: opts.cardKey ?? keys.publicKey, agent_keys: [] } });
                return;
            }
            send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
        })();
    });
    const port = await new Promise<number>(r => server.listen(opts.port ?? 0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
    stub.server = server;
    stub.url = `http://127.0.0.1:${port}`;
    return stub as Stub;
}

const closeStub = (s: Stub | null) => s ? new Promise<void>(r => { s.server.closeAllConnections?.(); s.server.close(() => r()); }) : Promise.resolve();

// ─── The repository ──────────────────────────────────────────────────────────

const ts = Date.now().toString(36);
let R: { server: Server; config: AimeatConfig; baseUrl: string; nodeId: string; adminPw: string; json: ReturnType<typeof makeJson> };
let opsToken = '';
let malloryToken = '';
let groupId = '';
const stubs: Stub[] = [];

async function setupOwner(ownerName: string): Promise<string> {
    const reg = await R.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': R.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await R.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': R.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const grant = (nodeId: string, node: { url: string; public_key: string }, token = opsToken) =>
    R.json(`/v1/packages/${encodeURIComponent(groupId)}/entitlements/${nodeId}`, {
        method: 'PUT', headers: auth(token), body: JSON.stringify({ note: 'a sale', node }),
    });
const peerList = async () => {
    const r = await R.json('/v1/federation/peers', { headers: auth(opsToken) });
    assert(r.status === 200, `peer list: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as { peers: any[]; pending_registrations: any[] };
};
const entitled = async (nodeId: string) => {
    const r = await R.json(`/v1/packages/${encodeURIComponent(groupId)}/entitlements`, { headers: auth(opsToken) });
    return (r.body.data.entitlements as any[]).some(e => e.nodeId === nodeId);
};

console.log('\nPhase 1 — A repository with federated sign-in open to all peers, as aimeat.io runs');

await test('Boot the repository and its owners, and publish one private package', async () => {
    const port = await freePort();
    const adminPw = randomBytes(16).toString('base64url');
    const nodeId = `aimeat-test-001-proofrepo${ts}`;
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';
    const { config } = loadConfig({});
    Object.assign(config, {
        port, nodeId, baseUrl: `http://127.0.0.1:${port}`, devMode: true, testMode: true, adminPassword: adminPw,
        storageProvider: 'memory', packagesEnabled: true, packageFederationEnabled: true, packageCreateRole: 'owner',
        packageRepository: true, federationAuthPolicy: 'all_peers', federationTimeoutMs: 3000,
    } satisfies Partial<AimeatConfig>);
    const { app } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    R = { server, config, baseUrl: config.baseUrl, nodeId, adminPw, json: makeJson(config.baseUrl) };
    opsToken = await setupOwner(`ops${ts}`);
    // Two owners: the admin setup route takes five calls a minute, and each owner is two.
    malloryToken = await setupOwner(`mallory${ts}`);
    const pkg = await R.json('/v1/packages', {
        method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ name: `proof-${ts}`, description: 'A package to sell', category: 'utility', visibility: 'private',
            components: [{ id: 'note', type: 'memory', label: 'Note', content: JSON.stringify({ hello: 'world' }), dependencies: [] }] }),
    });
    assert(pkg.status === 201, `package: ${pkg.status} ${JSON.stringify(pkg.body)}`);
    groupId = pkg.body.data.packageGroupId;
});

console.log('\nPhase 2 — Who may register a peer, and on what proof');

await test('An owner with no package here cannot name a seller, so cannot register a peer that way', async () => {
    const x = await startStub(`aimeat-test-001-squat${ts}`); stubs.push(x);
    const r = await R.json(`/v1/package-sellers/${x.nodeId}`, {
        method: 'PUT', headers: auth(malloryToken), body: JSON.stringify({ node: { url: x.url, public_key: x.keys.publicKey } }),
    });
    assert(r.status === 403 && r.body.error?.code === 'NOT_AN_AUTHOR', `expected 403 NOT_AN_AUTHOR: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(await peerList()).peers.some(p => p.node_id === x.nodeId), 'no peer was written');
});

await test('Without the repository role nobody names a seller', async () => {
    R.config.packageRepository = false;
    try {
        const r = await R.json(`/v1/package-sellers/aimeat-test-001-norole${ts}`, {
            method: 'PUT', headers: auth(opsToken), body: JSON.stringify({ note: 'no role' }),
        });
        assert(r.status === 404 && r.body.error?.code === 'NOT_A_REPOSITORY', `expected 404 NOT_A_REPOSITORY: ${r.status} ${JSON.stringify(r.body)}`);
    } finally { R.config.packageRepository = true; }
});

await test('A grant naming a node whose card says it is another node is refused, and writes nothing', async () => {
    const other = await startStub(`aimeat-test-001-other${ts}`); stubs.push(other);
    const claimed = `aimeat-test-001-claimed${ts}`;
    const r = await grant(claimed, { url: other.url, public_key: other.keys.publicKey });
    assert(r.status === 409 && r.body.error?.code === 'PEER_ID_MISMATCH', `expected 409 PEER_ID_MISMATCH: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(await peerList()).peers.some(p => p.node_id === claimed), 'no peer was written');
    assert(!(await entitled(claimed)), 'no entitlement was written');
});

await test('A grant whose key is not the one the node\'s card publishes is refused, and writes nothing', async () => {
    const x = await startStub(`aimeat-test-001-wrongkey${ts}`); stubs.push(x);
    const someoneElse = (await generateKeyPair()).publicKey;
    const r = await grant(x.nodeId, { url: x.url, public_key: someoneElse });
    assert(r.status === 409 && r.body.error?.code === 'PEER_KEY_MISMATCH', `expected 409 PEER_KEY_MISMATCH: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!(await peerList()).peers.some(p => p.node_id === x.nodeId), 'no peer was written');
    assert(!(await entitled(x.nodeId)), 'no entitlement was written');
});

console.log('\nPhase 3 — A packages-only peer reaches packages and nothing else');

let squat: Stub;
await test('A node whose card answers with the same id and key is registered packages-only, and its origin names who asked', async () => {
    // The registrant runs this server, so the card check passes: what a card proves is the url's
    // own word. What follows is why that is enough.
    squat = await startStub(`aimeat-test-001-target${ts}`); stubs.push(squat);
    const r = await grant(squat.nodeId, { url: squat.url, public_key: squat.keys.publicKey });
    assert(r.status === 200 && r.body.data.peer_registered === true && r.body.data.peer_pending === false, `grant: ${r.status} ${JSON.stringify(r.body)}`);
    const p = (await peerList()).peers.find(x => x.node_id === squat.nodeId);
    assert(p?.tier === 'contact' && p.allow_messaging === false && p.share_catalogue === false, `packages-only: ${JSON.stringify(p)}`);
    assert(p.origin?.kind === 'recorded' && p.origin.source === 'package-grant' && p.origin.by === `ops${ts}` && p.origin.group_id === groupId && p.origin.proof === 'node-card',
        `origin: ${JSON.stringify(p.origin)}`);
    const ov = await R.json('/v1/admin/federation/overview', { headers: auth(opsToken) });
    const row = (ov.body.data.roster as any[]).find(x => x.node_id === squat.nodeId);
    assert(row?.origin?.kind === 'recorded' && row.origin.source === 'package-grant', `overview origin (aimeat_admin_federation reads this): ${JSON.stringify(row)}`);
});

await test('It is not a home node for a federated sign-in, and no password leaves this node', async () => {
    const r = await R.json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: `alice@${squat.nodeId}`, password: 'typed-by-alice' }) });
    assert(r.status === 403 && r.body.error?.code === 'FEDERATION_AUTH_NOT_ALLOWED', `expected 403 FEDERATION_AUTH_NOT_ALLOWED: ${r.status} ${JSON.stringify(r.body)}`);
    assert(squat.verify.length === 0, `the registrant's server received ${squat.verify.length} sign-in request(s): ${JSON.stringify(squat.verify)}`);
});

await test('A direct message to someone at its node id is not sent there', async () => {
    const r = await R.json('/v1/messages', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ to: `alice@${squat.nodeId}`, body: 'for alice only' }) });
    assert(r.status === 201 && r.body.data.message?.status === 'undeliverable', `expected an undeliverable message: ${r.status} ${JSON.stringify(r.body)}`);
    assert(squat.messages.length === 0, `the registrant's server received ${squat.messages.length} message(s)`);
});

console.log('\nPhase 4 — A node that does not answer: the sale stands, the registration waits');

const waiting = `aimeat-test-001-asleep${ts}`;
let waitingPort = 0;
let waitingKeys = { publicKey: '', privateKey: '' };
await test('A grant naming a node that does not answer is granted, and the node is not a peer yet', async () => {
    waitingPort = await freePort();
    waitingKeys = await generateKeyPair();
    const r = await grant(waiting, { url: `http://127.0.0.1:${waitingPort}`, public_key: waitingKeys.publicKey });
    assert(r.status === 200 && r.body.data.peer_registered === false && r.body.data.peer_pending === true, `grant: ${r.status} ${JSON.stringify(r.body)}`);
    assert(await entitled(waiting), 'the entitlement is written');
    const list = await peerList();
    assert(!list.peers.some(p => p.node_id === waiting), 'not a peer yet');
    const pend = list.pending_registrations.find(p => p.node_id === waiting);
    assert(pend?.source === 'package-grant' && pend.public_key === waitingKeys.publicKey && typeof pend.last_problem === 'string', `pending: ${JSON.stringify(list.pending_registrations)}`);
});

await test('A second grant naming the waiting node under another key is refused', async () => {
    const r = await grant(waiting, { url: `http://127.0.0.1:${waitingPort}`, public_key: (await generateKeyPair()).publicKey });
    assert(r.status === 409 && r.body.error?.code === 'PEER_KEY_MISMATCH', `expected 409 PEER_KEY_MISMATCH: ${r.status} ${JSON.stringify(r.body)}`);
});

// Secaudit 2026-10-10 I7. x-source-node is typed by the caller, and the listing adopted the pending
// node it named before any signature was checked: a request with no signature at all made this node
// read the card and register the peer. The node is up here, so on the old code the first request below
// registered it (and wrote its pending record); now nothing is fetched or written for it.
await test('An unsigned request, or one signed with another key, naming the waiting node writes nothing', async () => {
    // The node comes up, under the key the grant named.
    const node = await startStub(waiting, { port: waitingPort, cardKey: waitingKeys.publicKey }); stubs.push(node);
    const before = (await peerList()).pending_registrations.find(p => p.node_id === waiting);
    assert(!!before, 'the registration is pending');

    const bare = await R.json('/v1/federation/packages', { headers: { 'x-source-node': waiting } });
    assert(bare.status === 401, `unsigned: ${bare.status} ${JSON.stringify(bare.body)}`);

    const other = await generateKeyPair();
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(16).toString('hex');
    const forged = await sign(other.privateKey, JSON.stringify({ source_node: waiting, timestamp, purpose: 'package', group_id: '*', audience: R.nodeId, nonce }));
    const wrongKey = await R.json('/v1/federation/packages', { headers: { 'x-source-node': waiting, 'x-timestamp': timestamp, 'x-audience': R.nodeId, 'x-nonce': nonce, 'x-signature': forged } });
    // Still no peer by that id, so the peer gate answers before the signature is read.
    assert(wrongKey.status === 403, `another key: ${wrongKey.status} ${JSON.stringify(wrongKey.body)}`);

    const list = await peerList();
    assert(!list.peers.some(p => p.node_id === waiting), `not registered: ${JSON.stringify(list.peers.find(p => p.node_id === waiting))}`);
    const after = list.pending_registrations.find(p => p.node_id === waiting);
    assert(JSON.stringify(after) === JSON.stringify(before), `the pending record is unchanged: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
});

await test('The node\'s first signed request reads its card, registers it, and is served what it was sold', async () => {
    // The node is up (the test above started it) and asks the repository what it may pull.
    const timestamp = new Date().toISOString();
    // The repository it is for and a one-time nonce are part of the signed message (secaudit 2026-10, PKG-10).
    const nonce = randomBytes(16).toString('hex');
    const signature = await sign(waitingKeys.privateKey, JSON.stringify({ source_node: waiting, timestamp, purpose: 'package', group_id: '*', audience: R.nodeId, nonce }));
    const r = await R.json('/v1/federation/packages', { headers: { 'x-source-node': waiting, 'x-timestamp': timestamp, 'x-audience': R.nodeId, 'x-nonce': nonce, 'x-signature': signature } });
    assert(r.status === 200 && (r.body.data.packages as any[]).some(p => p.group_id === groupId), `listing: ${r.status} ${JSON.stringify(r.body)}`);
    const list = await peerList();
    const p = list.peers.find(x => x.node_id === waiting);
    assert(p?.tier === 'contact' && p.public_key === waitingKeys.publicKey && p.origin?.kind === 'recorded' && p.origin.source === 'package-grant', `registered: ${JSON.stringify(p)}`);
    assert(!list.pending_registrations.some(x => x.node_id === waiting), 'no longer pending');
});

await test('Naming a seller that does not answer is refused, not left waiting: it is not a sale', async () => {
    const seller = `aimeat-test-001-sellerdown${ts}`;
    const r = await R.json(`/v1/package-sellers/${seller}`, {
        method: 'PUT', headers: auth(opsToken),
        body: JSON.stringify({ node: { url: `http://127.0.0.1:${await freePort()}`, public_key: (await generateKeyPair()).publicKey } }),
    });
    assert(r.status === 503 && r.body.error?.code === 'PEER_UNREACHABLE', `expected 503 PEER_UNREACHABLE: ${r.status} ${JSON.stringify(r.body)}`);
    const list = await peerList();
    assert(!list.peers.some(p => p.node_id === seller) && !list.pending_registrations.some(p => p.node_id === seller), 'nothing was written');
});

console.log('\nPhase 5 — The operator releases a node id');

await test('Removing the peer frees its node id for a registration under another key', async () => {
    const del = await R.json(`/v1/federation/peers/${squat.nodeId}?emergency=true`, { method: 'DELETE', headers: auth(opsToken) });
    assert(del.status === 200 && del.body.data.deleted === true, `delete: ${del.status} ${JSON.stringify(del.body)}`);
    assert(!(await peerList()).peers.some(p => p.node_id === squat.nodeId), 'the peer is gone');
    // The real node, with its own key at its own address.
    const real = await startStub(squat.nodeId); stubs.push(real);
    const r = await grant(real.nodeId, { url: real.url, public_key: real.keys.publicKey });
    assert(r.status === 200 && r.body.data.peer_registered === true, `the real node registers: ${r.status} ${JSON.stringify(r.body)}`);
    const p = (await peerList()).peers.find(x => x.node_id === real.nodeId);
    assert(p?.public_key === real.keys.publicKey && p.url === real.url, `under the real key and address: ${JSON.stringify(p)}`);
});

await test('Removing a node id that is only a waiting registration deletes the registration', async () => {
    const id = `aimeat-test-001-neverup${ts}`;
    const g = await grant(id, { url: `http://127.0.0.1:${await freePort()}`, public_key: (await generateKeyPair()).publicKey });
    assert(g.status === 200 && g.body.data.peer_pending === true, `pending: ${g.status} ${JSON.stringify(g.body)}`);
    const del = await R.json(`/v1/federation/peers/${id}`, { method: 'DELETE', headers: auth(opsToken) });
    assert(del.status === 200 && del.body.data.pending_deleted === true, `delete: ${del.status} ${JSON.stringify(del.body)}`);
    assert(!(await peerList()).pending_registrations.some(p => p.node_id === id), 'the registration is gone');
    const again = await grant(id, { url: `http://127.0.0.1:${await freePort()}`, public_key: (await generateKeyPair()).publicKey });
    assert(again.status === 200 && again.body.data.peer_pending === true, `a grant under another key is taken now: ${again.status} ${JSON.stringify(again.body)}`);
});

console.log('\nPhase 6 — The operator hears of a failed card check and of a held node id');

const incidents = async () => {
    const r = await R.json('/v1/admin/security/incidents', { headers: auth(opsToken) });
    assert(r.status === 200, `incidents: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data.incidents as any[]).filter(i => i.type === 'federation_peer');
};
const introduce = async (nodeId: string, url: string, keys: { publicKey: string; privateKey: string }) => {
    const timestamp = new Date().toISOString();
    return R.json('/v1/federation/peer/introduce', {
        method: 'POST',
        body: JSON.stringify({ node_id: nodeId, node_url: url, public_key: keys.publicKey, role: 'contributor', timestamp,
            signature: await sign(keys.privateKey, `${nodeId}${url}${timestamp}`) }),
    });
};

await test('A card that answered as another node is on the Security page once, however often it is tried', async () => {
    const claimed = `aimeat-test-001-claimed${ts}`;
    const first = (await incidents()).filter(i => i.code === 'PEER_PROOF_FAILED' && String(i.detail).includes(claimed));
    assert(first.length === 1, `one incident from Phase 2: ${JSON.stringify(await incidents())}`);
    const other = stubs.find(x => x.nodeId === `aimeat-test-001-other${ts}`)!;
    const again = await grant(claimed, { url: other.url, public_key: other.keys.publicKey });
    assert(again.status === 409, `refused again: ${again.status}`);
    const after = (await incidents()).filter(i => i.code === 'PEER_PROOF_FAILED' && String(i.detail).includes(claimed));
    assert(after.length === 1, `still one: ${after.length}`);
});

await test('A node introducing itself under an id held by another key is refused, and the operator is told how to free it', async () => {
    const heldId = squat.nodeId;   // held since Phase 5 by the real node's key
    const r = await introduce(heldId, 'http://127.0.0.1:9', await generateKeyPair());
    assert(r.status === 409, `refused: ${r.status} ${JSON.stringify(r.body)}`);
    const held = (await incidents()).find(i => i.code === 'PEER_ID_HELD' && String(i.detail).includes(heldId));
    assert(!!held && String(held.detail).includes('emergency=true') && held.source === 'introduce', `the incident names the release: ${JSON.stringify(held)}`);
});

console.log('\nPhase 7 — The federation routes the sweep found');

/** A member peer added and activated by the operator, served by a stub that answers its card. */
async function memberPeer(tag: string): Promise<Stub> {
    const stub = await startStub(`aimeat-test-001-${tag}${ts}`); stubs.push(stub);
    const add = await R.json('/v1/federation/peers', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ node_id: stub.nodeId, url: stub.url, public_key: stub.keys.publicKey }) });
    assert(add.status === 201, `add ${tag}: ${add.status} ${JSON.stringify(add.body)}`);
    const act = await R.json(`/v1/federation/peers/${stub.nodeId}`, { method: 'PUT', headers: auth(opsToken), body: JSON.stringify({ status: 'active' }) });
    assert(act.status === 200, `activate ${tag}: ${act.status} ${JSON.stringify(act.body)}`);
    return stub;
}
const peerOf = async (nodeId: string) => (await peerList()).peers.find(p => p.node_id === nodeId);
const until = async (ok: () => Promise<boolean>, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ok()) return true; await new Promise(r => setTimeout(r, 150)); }
    return ok();
};

let leaving: Stub;
await test('An introduction that becomes a pending request leaves a leaving peer in place', async () => {
    leaving = await memberPeer('leaving');
    const off = await R.json(`/v1/federation/peers/${leaving.nodeId}`, { method: 'DELETE', headers: auth(opsToken) });
    assert(off.status === 200 && off.body.data.status === 'depeering', `de-peer: ${off.status} ${JSON.stringify(off.body)}`);
    const r = await introduce(leaving.nodeId, 'http://127.0.0.1:9', await generateKeyPair());
    assert(r.status === 202 && r.body.data.status === 'pending', `pending: ${r.status} ${JSON.stringify(r.body)}`);
    const p = await peerOf(leaving.nodeId);
    assert(p?.status === 'depeering' && p.public_key === leaving.keys.publicKey, `the peer is still there, under its key: ${JSON.stringify(p)}`);
});

await test('With open join on, a newcomer cannot replace a peer held under another key', async () => {
    R.config.federationOpenJoin = true;
    try {
        const r = await introduce(leaving.nodeId, 'http://127.0.0.1:9', await generateKeyPair());
        assert(r.status === 409 && r.body.error?.code === 'PEER_KEY_MISMATCH', `refused: ${r.status} ${JSON.stringify(r.body)}`);
        const p = await peerOf(leaving.nodeId);
        assert(p?.public_key === leaving.keys.publicKey && p.tier === 'member', `unchanged: ${JSON.stringify(p)}`);
    } finally { R.config.federationOpenJoin = false; }
});

await test('A direct message to a leaving peer waits in the queue and is not sent', async () => {
    const r = await R.json('/v1/messages', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ to: `alice@${leaving.nodeId}`, body: 'not yet' }) });
    assert(r.status === 201 && r.body.data.message?.status === 'queued', `queued: ${r.status} ${JSON.stringify(r.body)}`);
    assert(leaving.messages.length === 0, `the peer received ${leaving.messages.length}`);
});

await test('A peer may deliver a message only from its own people', async () => {
    const member = await memberPeer('member');
    const deliver = async (senderGhii: string) => {
        const message = { id: randomUUID(), senderGhii, recipientGhii: `ops${ts}@${R.nodeId}`, body: 'hello', createdAt: new Date().toISOString() };
        const timestamp = new Date().toISOString();
        const signature = await sign(member.keys.privateKey, JSON.stringify({ source_node: member.nodeId, message, timestamp }));
        return R.json('/v1/federation/message', { method: 'POST', body: JSON.stringify({ source_node: member.nodeId, message, timestamp, signature }) });
    };
    const forged = await deliver(`bob@aimeat-test-001-elsewhere${ts}`);
    assert(forged.status === 403 && forged.body.error?.code === 'SENDER_NOT_OF_PEER', `another node's sender: ${forged.status} ${JSON.stringify(forged.body)}`);
    const own = await deliver(`bob@${member.nodeId}`);
    assert(own.status < 300, `its own sender: ${own.status} ${JSON.stringify(own.body)}`);
});

await test('A join whose target claims an existing peer\'s id changes nothing about that peer', async () => {
    const existing = await memberPeer('existing');
    const impostor = await startStub(existing.nodeId); stubs.push(impostor);   // says it is `existing`, with its own key
    const r = await R.json('/v1/admin/federation/join', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ genesis_url: impostor.url }) });
    assert(r.status === 200, `join: ${r.status} ${JSON.stringify(r.body)}`);
    await new Promise(res => setTimeout(res, 1500));
    const p = await peerOf(existing.nodeId);
    assert(p?.url === existing.url && p.public_key === existing.keys.publicKey, `the peer kept its address and key: ${JSON.stringify(p)}`);
});

await test('A join whose key exchange answers as another node saves no peer', async () => {
    const target = await startStub(`aimeat-test-001-jointarget${ts}`); stubs.push(target);
    const somebodyElse = `aimeat-test-001-somebodyelse${ts}`;
    target.behave.exchangeAs = somebodyElse;
    const r = await R.json('/v1/admin/federation/join', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ genesis_url: target.url }) });
    assert(r.status === 200, `join: ${r.status} ${JSON.stringify(r.body)}`);
    await new Promise(res => setTimeout(res, 1500));
    assert(!(await peerOf(target.nodeId)), 'no peer was saved');
    assert(!(await peerOf(somebodyElse)), 'and none under the id the answer named');
    target.behave.exchangeAs = undefined;
    const ok = await R.json('/v1/admin/federation/join', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ genesis_url: target.url }) });
    assert(ok.status === 200, `join again: ${ok.status}`);
    assert(await until(async () => (await peerOf(target.nodeId))?.public_key === target.keys.publicKey), 'an honest exchange saves the peer with its key');
});

await test('While a join waits for approval, a key exchange in the target\'s name is taken only with the key its card publishes', async () => {
    const target = await startStub(`aimeat-test-001-joinwait${ts}`); stubs.push(target);
    target.behave.introduceStatus = 'pending';
    const r = await R.json('/v1/admin/federation/join', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ genesis_url: target.url }) });
    assert(r.status === 200, `join: ${r.status} ${JSON.stringify(r.body)}`);
    const exchange = (key: string) => R.json('/v1/federation/key-exchange', {
        method: 'POST', body: JSON.stringify({ node_id: target.nodeId, node_url: 'http://127.0.0.1:9', node_public_key: key, timestamp: new Date().toISOString() }),
    });
    const intruder = await exchange((await generateKeyPair()).publicKey);
    assert(intruder.status === 403 && intruder.body.error?.code === 'KEY_NOT_PROVEN', `another key: ${intruder.status} ${JSON.stringify(intruder.body)}`);
    assert(!(await peerOf(target.nodeId)), 'no peer was admitted');
    const real = await exchange(target.keys.publicKey);
    assert(real.status === 200, `the target's own key: ${real.status} ${JSON.stringify(real.body)}`);
    const p = await peerOf(target.nodeId);
    assert(p?.public_key === target.keys.publicKey && p.url === target.url, `admitted at the approved address with its key: ${JSON.stringify(p)}`);
});

console.log('\nCleanup');
for (const s of stubs) await closeStub(s);
try { R?.server.closeAllConnections?.(); R?.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
