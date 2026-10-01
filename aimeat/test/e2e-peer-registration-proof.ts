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
 *   first signed request finishes it · 5 releasing a node id · cleanup
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-peer-registration-proof
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial. Against the code before the fix, the refusals of Phase 2, the
 *     sign-in and message assertions of Phase 3 and the pending registration of Phase 4 fail.
 */
import { randomBytes } from 'node:crypto';
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
    const stub = { nodeId, keys, verify: [] as unknown[], messages: [] as unknown[] } as Partial<Stub>;
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

await test('The node\'s first signed request reads its card, registers it, and is served what it was sold', async () => {
    // The node comes up, under the key the grant named, and asks the repository what it may pull.
    const node = await startStub(waiting, { port: waitingPort, cardKey: waitingKeys.publicKey }); stubs.push(node);
    const timestamp = new Date().toISOString();
    const signature = await sign(waitingKeys.privateKey, JSON.stringify({ source_node: waiting, timestamp, purpose: 'package', group_id: '*' }));
    const r = await R.json('/v1/federation/packages', { headers: { 'x-source-node': waiting, 'x-timestamp': timestamp, 'x-signature': signature } });
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

console.log('\nCleanup');
for (const s of stubs) await closeStub(s);
try { R?.server.closeAllConnections?.(); R?.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
