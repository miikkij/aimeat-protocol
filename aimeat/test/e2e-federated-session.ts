/**
 * @file test/e2e-federated-session.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A visitor signing in on THIS node with an account that lives somewhere else, and the
 *   three memory doors that exist only for such a session: POST /v1/memory/pull, /v1/memory/push-home
 *   and /v1/memory/list-home.
 *
 *   WHY THIS SUITE EXISTS. No suite had ever held a federated session. Those three doors open only
 *   for a JWT carrying `federated:true` plus `homeNode` and `homeUrl`, and exactly one thing in the
 *   node mints one: the federated branch of POST /v1/ghii/login, which is reached by signing in as
 *   `name@some-other-node-id`. That branch needs an ACTIVE peer whose node id equals the suffix, and
 *   it POSTs to that peer's /v1/federation/auth/verify and verifies the reply's Ed25519 signature
 *   against the key this node has pinned for it. So every existing suite stopped at the refusals:
 *   `NOT_FEDERATED` from a home session was the whole of the coverage, and the bodies of all three
 *   doors — the pulled record, the pushed replica, the signed inventory request — had never run.
 *
 *   This suite serves the home node itself: a node:http server on loopback registered as an active
 *   peer through the real operator routes, holding an Ed25519 key pair, answering the verify door
 *   with a SIGNED attestation and the three memory doors the federated session drives. The runner
 *   pins AIMEAT_ALLOW_PRIVATE_EGRESS=true, so loopback passes validateOutboundUrl and what arrives
 *   at the far end is what this node actually built.
 *
 *   THREE THINGS IT PINS RATHER THAN ASSERTS, each one today's behaviour and each one named where
 *   it is asserted, because the suite is not allowed to change src/:
 *     1. push-home sends an UNSIGNED replicate body, and this codebase's own receiving door
 *        (src/routes/federation-sync/messaging.ts:82) answers 401 to a body with no signature. So
 *        push-home cannot work against a real AIMEAT home node.
 *     2. The federated mint hands out roles:['owner'] (register-login.ts:495), and requireScope lets
 *        an owner role past every scope check. The scope list the receiving node's policy picked —
 *        the point of federationDefaultScopes — is therefore decorative on the HTTP doors: a
 *        memory:read session writes memory.
 *     3. `verified` is declared in the attestation type and never read (register-login.ts:435 tests
 *        only `ghii`), so a signed attestation saying verified:false signs the visitor in.
 *
 * @structure Phase 1 setup (operator owner, the fake home node, an empty peer table) · 2 the two
 *   FEDERATION_UNREACHABLE branches and peer activation · 3 the federated login and its JWT claims ·
 *   4 pull · 5 push-home · 6 list-home and its signed body · 7 the doors' refusals (input, missing
 *   record, home node 500, home node unreachable, NOT_HOME, unauthenticated, the operator door, the
 *   scope pin) · 8 the login refusals (unknown suffix, unsigned, wrongly signed, no ghii, home node
 *   500, the verified:false pin, per-peer scopes) · 9 cleanup.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-federated-session
 * @version-history
 *   v1.1.0 — 2026-09-13 — A visitor's records are keyed by their HOME GHII, so the dead-peer session
 *     and the live-peer session are two identities rather than one shared local namespace. The
 *     push-home assertion in the unreachable-home test changes from the proxy error to 404: that
 *     door now answers "not yours" before it dials. Pin 2 below is also gone — a federated session
 *     no longer resolves to the local account that shares its name (utils/gaii.ts).
 *   v1.0.0 — 2026-09-08 — Written for the federated half of src/routes/memory/federation.ts and the
 *     federated branch of src/routes/ghii/register-login.ts, neither of which had ever executed.
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
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function newKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return {
        publicKey: Buffer.from(pub).toString('base64'),
        privateKey: Buffer.from(priv).toString('base64'),
    };
}

/** The JWT payload, read rather than trusted: this suite's subject is what the mint put in it. */
function claims(token: string): Record<string, any> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// ─── The home node, not a mock ────────────────────────────────────────────────
//
// Four doors, which is all the federated login and the three session routes ever call. `verifyMode`
// and `doorMode` switch what the far end answers, so a refusal is a real status over a real socket,
// and every request is recorded so the suite can hold the OUTBOUND body to what the code claims to
// send rather than to what it says about itself.

type VerifyMode = 'ok' | 'unsigned' | 'wrong_key' | 'no_ghii' | 'broken' | 'unverified' | 'redirect';
type DoorMode = 'ok' | 'fail' | 'empty' | 'refuse_replica';

let verifyMode: VerifyMode = 'ok';
let doorMode: DoorMode = 'ok';

const verifyBodies: Record<string, any>[] = [];
const listBodies: Record<string, any>[] = [];
const replicateBodies: Record<string, any>[] = [];
const memoryPaths: string[] = [];

const HOME_VALUE = { note: 'written on the home node', n: 7 };
const HOME_TAGS = ['home-tag', 'shared'];

/** The url of the peer nothing answers at. Registered ACTIVE, so only the socket refuses. */
const DEAD_URL = 'http://127.0.0.1:1';

const stamp = Date.now().toString(36);
const ownerName = `fedses${stamp}`;
const visitor = 'visitor';
const homeNodeId = `aimeat-fake-home-${stamp}`;
const deadNodeId = `aimeat-dead-home-${stamp}`;
const PULL_KEY = 'home.note';
const NO_VALUE_KEY = 'home.valueless';

let ownerToken = '';
let fedToken = '';
let deadFedToken = '';
let homeUrl = '';
let homeKeys = { publicKey: '', privateKey: '' };
let strangerKeys = { publicKey: '', privateKey: '' };
let home: Server | null = null;

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', c => { raw += c.toString(); });
        req.on('end', () => resolve(raw));
    });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/**
 * The attestation, signed the way register-login.ts:472-476 verifies it: the reply object with the
 * `signature` field removed, re-serialised in ITS OWN key order. `Object.entries` preserves the
 * insertion order of the parsed JSON, so the bytes signed here are the bytes the node rebuilds only
 * as long as `signature` goes on last.
 */
async function attestationFor(mode: VerifyMode): Promise<Record<string, unknown>> {
    const redirect = mode === 'redirect';
    const payload = {
        verified: mode !== 'unverified',
        ghii: `${visitor}@${homeNodeId}`,
        display_name: 'Visitor from the fake home node',
        home_node: redirect ? deadNodeId : homeNodeId,
        home_url: redirect ? DEAD_URL : homeUrl,
        scopes: ['memory:read'],
    };
    if (mode === 'unsigned') return payload;
    const key = mode === 'wrong_key' ? strangerKeys.privateKey : homeKeys.privateKey;
    return { ...payload, signature: await signMsg(key, JSON.stringify(payload)) };
}

function startHomeNode(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            const path = req.url ?? '';

            if (req.method === 'POST' && path === '/v1/federation/auth/verify') {
                const raw = await readBody(req);
                try { verifyBodies.push(JSON.parse(raw)); } catch { verifyBodies.push({ _unparsed: raw }); }
                if (verifyMode === 'broken') {
                    send(res, 500, { ok: false, error: { code: 'HOME_NODE_BROKEN', message: 'the home node fell over' } });
                    return;
                }
                if (verifyMode === 'no_ghii') {
                    send(res, 200, { ok: true, data: { verified: true, display_name: 'nameless' } });
                    return;
                }
                send(res, 200, { ok: true, data: await attestationFor(verifyMode) });
                return;
            }

            if (req.method === 'POST' && path === '/v1/federation/memory/list') {
                const raw = await readBody(req);
                try { listBodies.push(JSON.parse(raw)); } catch { listBodies.push({ _unparsed: raw }); }
                if (doorMode === 'fail') { send(res, 500, { ok: false, error: { code: 'HOME_NODE_BROKEN' } }); return; }
                send(res, 200, {
                    ok: true,
                    data: {
                        entries: [
                            { key: PULL_KEY, visibility: 'private', version: 5 },
                            { key: 'home.other', visibility: 'public', version: 1 },
                        ],
                        total: 2,
                    },
                });
                return;
            }

            if (req.method === 'POST' && path === '/v1/federation/replicate') {
                const raw = await readBody(req);
                try { replicateBodies.push(JSON.parse(raw)); } catch { replicateBodies.push({ _unparsed: raw }); }
                if (doorMode === 'fail') { send(res, 500, { ok: false, error: { code: 'HOME_NODE_BROKEN' } }); return; }
                if (doorMode === 'refuse_replica') {
                    // Word for word what src/routes/federation-sync/messaging.ts:82-86 answers a body
                    // that carries no signature, which is every body push-home sends. See the header.
                    send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing signature on replication request' } });
                    return;
                }
                send(res, 200, { ok: true, data: { replicated: true } });
                return;
            }

            if (req.method === 'GET' && path.startsWith('/v1/memory/')) {
                memoryPaths.push(path);
                if (doorMode === 'fail') { send(res, 500, { ok: false, error: { code: 'HOME_NODE_BROKEN' } }); return; }
                if (doorMode === 'empty' || path.endsWith(encodeURIComponent(NO_VALUE_KEY))) {
                    send(res, 200, { ok: true, data: { tags: [] } });
                    return;
                }
                send(res, 200, { ok: true, data: { value: HOME_VALUE, tags: HOME_TAGS } });
                return;
            }

            send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: path } });
        })();
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as AddressInfo).port;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}

/** Sign in as the visitor whose account lives on the fake home node. */
function federatedLogin(suffix: string) {
    return json('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: `${visitor}@${suffix}`, password: 'the-home-node-decides' }),
    });
}

async function cleanup(): Promise<void> {
    if (home) { await new Promise<void>(r => home!.close(() => r())); home = null; }
}

console.log('\n=== A federated session: signing in from another node, and the three doors it opens ===\n');

async function run() {
    // ─── Phase 1: Setup ───
    console.log('Phase 1 — Setup');

    await test('POST /v1/owners — register the operator who runs this node', async () => {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        const timestamp = new Date().toISOString();
        const signature = await signMsg(body.data.private_key, ownerName + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerName, timestamp, signature }),
        });
        assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
        ownerToken = tok.body.data.token;
        const roles = claims(ownerToken).roles ?? [];
        assert(roles.includes('operator'),
            `the peer routes are operator-only and this owner is not one (${JSON.stringify(roles)}); `
            + 'this suite needs to be the first owner on a freshly deleted database');
    });

    await test('a home node answers on loopback, holding its own Ed25519 key pair', async () => {
        homeKeys = await newKeyPair();
        strangerKeys = await newKeyPair();
        const started = await startHomeNode();
        home = started.server;
        homeUrl = started.url;
        const probe = await fetch(`${homeUrl}/v1/nothing`);
        assert(probe.status === 404, `the fake home node must be up and answering, got ${probe.status}`);
        assert(homeKeys.publicKey !== strangerKeys.publicKey, 'the two key pairs must differ');
    });

    // ─── Phase 2: What a federated login needs before it can happen ───
    console.log('Phase 2 — The peer route to the home node');

    await test('this node starts with no peers at all', async () => {
        const { status, body } = await json('/v1/federation/peers', {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.total === 0,
            `the next assertion distinguishes "no peers configured" from "no active route", so the `
            + `table has to start empty; it holds ${body.data.total}`);
    });

    await test('a federated login with no peers configured is refused before anything is dialled', async () => {
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_UNREACHABLE', `code: ${body.error?.code}`);
        assert(String(body.error?.message).includes('No federation peers configured'),
            `this is the peers-empty branch, not the no-route one: ${body.error?.message}`);
        assert(verifyBodies.length === 0, `nothing may be dialled, got ${verifyBodies.length} request(s) at the home node`);
    });

    await test('POST /v1/federation/peers — the home node is registered, and starts pending', async () => {
        const { status, body } = await json('/v1/federation/peers', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ node_id: homeNodeId, url: homeUrl, public_key: homeKeys.publicKey }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.peer.status === 'pending', `a fresh peer must be pending: ${body.data.peer.status}`);
    });

    await test('a peer that is registered but NOT active is no route home either', async () => {
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_UNREACHABLE', `code: ${body.error?.code}`);
        assert(String(body.error?.message).includes('No active peer route'),
            `a pending peer must fail on the route, not on the table: ${body.error?.message}`);
        assert(verifyBodies.length === 0, `still nothing dialled, got ${verifyBodies.length}`);
    });

    await test('PUT /v1/federation/peers/:nodeId — activate the home node, and a dead peer beside it', async () => {
        const act = await json(`/v1/federation/peers/${homeNodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ status: 'active' }),
        });
        assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body)}`);
        assert(act.body.data.status === 'active', `status: ${act.body.data.status}`);

        const reg = await json('/v1/federation/peers', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ node_id: deadNodeId, url: DEAD_URL, public_key: strangerKeys.publicKey }),
        });
        assert(reg.status === 201, `dead peer register: ${reg.status} ${JSON.stringify(reg.body)}`);
        const deadAct = await json(`/v1/federation/peers/${deadNodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ status: 'active' }),
        });
        assert(deadAct.status === 200, `dead peer activate: ${deadAct.status}`);
    });

    // ─── Phase 3: The federated login ───
    console.log('Phase 3 — The federated login');

    await test('POST /v1/ghii/login — a visitor whose account lives on the home node is signed in', async () => {
        verifyMode = 'ok';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.federated === true, `federated: ${body.data.federated}`);
        assert(body.data.home_node === homeNodeId, `home_node: ${body.data.home_node}`);
        assert(body.data.home_url === homeUrl, `home_url: ${body.data.home_url}`);
        assert(body.data.ghii.ghii === `${visitor}@${homeNodeId}`, `ghii: ${JSON.stringify(body.data.ghii)}`);
        assert(body.data.ghii.display_name === 'Visitor from the fake home node',
            `the home node's display name must survive: ${body.data.ghii.display_name}`);
        assert(body.data.owner.name === visitor, `owner: ${JSON.stringify(body.data.owner)}`);
        assert(typeof body.data.token === 'string' && body.data.token.length > 0, 'no token');
        fedToken = body.data.token;
    });

    await test('…and the request that arrived at the home node is the one the node claims to send', async () => {
        assert(verifyBodies.length === 1, `the verify door should have been called exactly once, got ${verifyBodies.length}`);
        const sent = verifyBodies[0];
        assert(sent.username === visitor, `username must be the LOCAL name, not the whole GHII: ${JSON.stringify(sent.username)}`);
        assert(sent.password === 'the-home-node-decides', 'the password is forwarded to the home node, which is the only party that can judge it');
        assert(sent.requesting_node === NODE_ID, `requesting_node: ${JSON.stringify(sent.requesting_node)}`);
        assert(typeof sent.timestamp === 'string' && sent.timestamp.length > 0, `timestamp: ${JSON.stringify(sent.timestamp)}`);
    });

    await test('the minted JWT is a federated session, scoped by THIS node and capped at an hour', async () => {
        const c = claims(fedToken);
        assert(c.federated === true, `federated: ${JSON.stringify(c.federated)}`);
        assert(c.homeNode === homeNodeId, `homeNode: ${c.homeNode}`);
        assert(c.homeUrl === homeUrl, `homeUrl: ${c.homeUrl}`);
        assert(c.sub === visitor && c.owner === visitor, `sub/owner: ${c.sub}/${c.owner}`);
        assert(c.node === NODE_ID, `the session belongs to the node that minted it: ${c.node}`);
        // The RECEIVING node decides what a visitor may do. The home node asked for ['memory:read']
        // in its attestation and is not consulted: with no per-peer list, config.federationDefaultScopes
        // wins, which is memory:read,catalogue:read on this node.
        assert(Array.isArray(c.scopes) && c.scopes.join(',') === 'memory:read,catalogue:read',
            `scopes must come from this node's policy, got ${JSON.stringify(c.scopes)}`);
        assert(c.exp - c.iat <= 3600 && c.exp - c.iat > 0, `a federated session is capped at an hour: ${c.exp - c.iat}s`);
        assert(JSON.stringify(c.roles) === '["owner"]', `roles: ${JSON.stringify(c.roles)}`);
    });

    // ─── Phase 4: pull ───
    console.log('Phase 4 — pull');

    await test('POST /v1/memory/pull — the record is fetched from home and lands here', async () => {
        doorMode = 'ok';
        const { status, body } = await json('/v1/memory/pull', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.pulled === true, `pulled: ${body.data.pulled}`);
        assert(body.data.key === PULL_KEY, `key: ${body.data.key}`);
        assert(body.data.source_node === homeNodeId, `source_node: ${body.data.source_node}`);
        const asked = memoryPaths[memoryPaths.length - 1];
        assert(asked === `/v1/memory/${encodeURIComponent(`${visitor}@${homeNodeId}`)}/${encodeURIComponent(PULL_KEY)}`,
            `the home node must be asked for the visitor's HOME GHII, got ${asked}`);
    });

    await test('…and the visitor reads it back here, tagged with where it came from', async () => {
        const { status, body } = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(status === 200, `the pulled key must be readable, got ${status}: ${JSON.stringify(body)}`);
        // Field by field, not by serialised text: Postgres stores jsonb with its keys reordered.
        assert(body.data.value?.n === HOME_VALUE.n && body.data.value?.note === HOME_VALUE.note
            && Object.keys(body.data.value).length === 2, `value: ${JSON.stringify(body.data.value)}`);
        assert(body.data.visibility === 'private', `a pulled record is private: ${body.data.visibility}`);
        assert(body.data.tags.includes(`pulled-from:${homeNodeId}`),
            `tags must record the source, got ${JSON.stringify(body.data.tags)}`);
        for (const t of HOME_TAGS) {
            assert(body.data.tags.includes(t), `the home node's own tag "${t}" must survive: ${JSON.stringify(body.data.tags)}`);
        }
        assert(body.data.version === 1, `first pull is version 1: ${body.data.version}`);
    });

    await test('a second pull bumps the version and does not duplicate the source tag', async () => {
        const { status } = await json('/v1/memory/pull', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(status === 200, `second pull ${status}`);
        const read = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(read.body.data.version === 2, `second pull must be version 2, got ${read.body.data.version}`);
        const tagCount = read.body.data.tags.filter((t: string) => t === `pulled-from:${homeNodeId}`).length;
        assert(tagCount === 1, `the pulled-from tag must be deduplicated, got ${tagCount} copies`);
    });

    // ─── Phase 5: push-home ───
    console.log('Phase 5 — push-home');

    await test('POST /v1/memory/push-home — the local record is sent to the home node', async () => {
        doorMode = 'ok';
        const { status, body } = await json('/v1/memory/push-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.pushed === true, `pushed: ${body.data.pushed}`);
        assert(body.data.key === PULL_KEY, `key: ${body.data.key}`);
        assert(body.data.target_node === homeNodeId, `target_node: ${body.data.target_node}`);
    });

    await test('…and the replicate body that arrived carries the whole record, addressed home', async () => {
        assert(replicateBodies.length === 1, `the replicate door should have been called once, got ${replicateBodies.length}`);
        const sent = replicateBodies[0];
        assert(sent.source_node === NODE_ID, `source_node: ${JSON.stringify(sent.source_node)}`);
        assert(sent.gaii === `${visitor}@${homeNodeId}`,
            `the replica is addressed to the visitor's HOME identity, got ${JSON.stringify(sent.gaii)}`);
        assert(sent.key === PULL_KEY, `key: ${JSON.stringify(sent.key)}`);
        assert(sent.value?.n === HOME_VALUE.n && sent.value?.note === HOME_VALUE.note, `value: ${JSON.stringify(sent.value)}`);
        assert(sent.visibility === 'private', `visibility: ${JSON.stringify(sent.visibility)}`);
        assert(sent.version === 2, `the local version travels with it: ${JSON.stringify(sent.version)}`);
        assert(typeof sent.timestamp === 'string' && sent.timestamp.length > 0, `timestamp: ${JSON.stringify(sent.timestamp)}`);
        assert(Array.isArray(sent.tags) && sent.tags.includes(`pulled-from:${homeNodeId}`), `tags: ${JSON.stringify(sent.tags)}`);
    });

    await test('push-home signs the replicate payload with this node\'s key, over the fields the real door verifies', async () => {
        // Asserted as a hole first, 2026-09-08: the payload went out with no signature field, while
        // this codebase's own receiving door (federation-sync/messaging.ts, P1-11) answers 401
        // "Missing signature on replication request" to exactly that, so push-home could never land
        // on a real node. Fixed in memory/federation.ts v1.2.0, signing the same seven fields
        // services/memory-replication.ts signs.
        const sent = replicateBodies[0];
        assert(typeof sent.signature === 'string' && sent.signature.length > 0,
            `push-home must sign what it sends, got ${JSON.stringify(sent.signature)}`);
        const wk = await json('/.well-known/aimeat');
        const nodePublicKey = wk.body.data.public_key as string;
        const signed = JSON.stringify({
            source_node: sent.source_node, gaii: sent.gaii, key: sent.key, value: sent.value,
            visibility: sent.visibility, version: sent.version, timestamp: sent.timestamp,
        });
        const ok = await ed.verifyAsync(
            Buffer.from(sent.signature as string, 'base64'),
            Buffer.from(signed),
            Buffer.from(nodePublicKey, 'base64'),
        );
        assert(ok === true, 'the signature must verify against the node key at /.well-known/aimeat over the seven fields the receiving door checks');
    });

    await test('…and what the real receiving door would answer is relayed as a failed push', async () => {
        doorMode = 'refuse_replica';
        const { status, body } = await json('/v1/memory/push-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(status === 401, `the home node's status is passed through, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_PUSH_FAILED', `code: ${body.error?.code}`);
        assert(String(body.error?.message).includes('Missing signature'),
            `the home node's own words must reach the caller: ${body.error?.message}`);
        doorMode = 'ok';
    });

    // ─── Phase 6: list-home ───
    console.log('Phase 6 — list-home');

    await test('POST /v1/memory/list-home — the home node\'s inventory comes back', async () => {
        const { status, body } = await json('/v1/memory/list-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({}),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.total === 2, `total: ${body.data.total}`);
        assert(Array.isArray(body.data.entries) && body.data.entries.length === 2, `entries: ${JSON.stringify(body.data.entries)}`);
        assert(body.data.entries[0].key === PULL_KEY, `first key: ${body.data.entries[0]?.key}`);
        assert(body.data.source_node === homeNodeId, `source_node: ${body.data.source_node}`);
    });

    await test('…and that inventory request is SIGNED and names this node (audit H-15)', async () => {
        assert(listBodies.length === 1, `the list door should have been called once, got ${listBodies.length}`);
        const sent = listBodies[0];
        assert(sent.requesting_node === NODE_ID, `requesting_node: ${JSON.stringify(sent.requesting_node)}`);
        assert(sent.gaii === `${visitor}@${homeNodeId}`,
            `the request must name the visitor's HOME GHII, got ${JSON.stringify(sent.gaii)}`);
        assert(typeof sent.timestamp === 'string' && sent.timestamp.length > 0, `timestamp: ${JSON.stringify(sent.timestamp)}`);
        assert(typeof sent.signature === 'string' && sent.signature.length > 0,
            'the inventory request must carry this node\'s signature — the requesting_node field alone proves '
            + `nothing, because the federation directory publishes every node id. Got ${JSON.stringify(sent.signature)}`);
        // And it verifies against the key this node publishes, which is what a receiving node has to
        // do with it. A signature nobody can check is a field, not a proof.
        const wk = await json('/.well-known/aimeat');
        const nodePublicKey = wk.body.data.public_key as string;
        assert(typeof nodePublicKey === 'string' && nodePublicKey.length > 0, 'this node publishes no key');
        const signedBytes = new TextEncoder().encode(JSON.stringify({
            requesting_node: sent.requesting_node, gaii: sent.gaii, timestamp: sent.timestamp,
        }));
        const ok = await ed.verifyAsync(
            Buffer.from(sent.signature as string, 'base64'),
            signedBytes,
            Buffer.from(nodePublicKey, 'base64'),
        );
        assert(ok === true, 'the signature must verify against the node key published at /.well-known/aimeat, '
            + 'over the three fields WITHOUT the signature, in that order');
    });

    // ─── Phase 7: What the three doors refuse ───
    console.log('Phase 7 — The doors\' refusals');

    await test('pull and push-home both need a key', async () => {
        for (const path of ['/v1/memory/pull', '/v1/memory/push-home']) {
            const { status, body } = await json(path, {
                method: 'POST',
                headers: { Authorization: `Bearer ${fedToken}` },
                body: JSON.stringify({}),
            });
            assert(status === 400, `${path} without a key: ${status} ${JSON.stringify(body)}`);
            assert(body.error?.code === 'INVALID_INPUT', `${path} code: ${body.error?.code}`);
        }
    });

    await test('push-home refuses a key that does not exist here, before it dials home', async () => {
        const before = replicateBodies.length;
        const { status, body } = await json('/v1/memory/push-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: `nothing.local.${stamp}` }),
        });
        assert(status === 404, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
        assert(String(body.error?.message).includes('not found locally'), `message: ${body.error?.message}`);
        assert(replicateBodies.length === before, 'the refusal must come BEFORE the outbound call');
    });

    await test('a 200 from home carrying no value is a NOT_FOUND, not a write of undefined', async () => {
        const { status, body } = await json('/v1/memory/pull', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: NO_VALUE_KEY }),
        });
        assert(status === 404, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
        const local = await json(`/v1/memory/${encodeURIComponent(NO_VALUE_KEY)}`, {
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(local.status === 404, `nothing may be written for a valueless answer, got ${local.status}`);
    });

    await test('a home node answering 500 is a failed pull, push and list — each named for its door', async () => {
        doorMode = 'fail';
        const pull = await json('/v1/memory/pull', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(pull.status === 500, `pull ${pull.status}: ${JSON.stringify(pull.body)}`);
        assert(pull.body.error?.code === 'FEDERATION_PULL_FAILED', `pull code: ${pull.body.error?.code}`);

        const push = await json('/v1/memory/push-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(push.status === 500, `push ${push.status}: ${JSON.stringify(push.body)}`);
        assert(push.body.error?.code === 'FEDERATION_PUSH_FAILED', `push code: ${push.body.error?.code}`);

        const list = await json('/v1/memory/list-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({}),
        });
        assert(list.status === 500, `list ${list.status}: ${JSON.stringify(list.body)}`);
        assert(list.body.error?.code === 'FEDERATION_LIST_FAILED', `list code: ${list.body.error?.code}`);

        const read = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(read.body.data.version === 2, `a failed pull must not touch the local record, got version ${read.body.data.version}`);
        doorMode = 'ok';
    });

    await test('a home node nothing answers at is a proxy error on all three doors', async () => {
        // The token for this one names the DEAD peer as home, and it gets there honestly: the home
        // node's attestation says `home_node`, and register-login.ts:498 takes that word for it. The
        // url is then resolved through the peer table, so what is dialled is a registered ACTIVE
        // peer with nothing listening — the network catch, not the SSRF guard, which the message
        // ("Failed to reach" rather than "Cannot reach") is what distinguishes.
        verifyMode = 'redirect';
        const login = await federatedLogin(homeNodeId);
        assert(login.status === 200, `redirect login ${login.status}: ${JSON.stringify(login.body)}`);
        deadFedToken = login.body.data.token;
        assert(claims(deadFedToken).homeNode === deadNodeId,
            `the attestation names its own home node and is believed: ${claims(deadFedToken).homeNode}`);
        verifyMode = 'ok';

        const pull = await json('/v1/memory/pull', {
            method: 'POST',
            headers: { Authorization: `Bearer ${deadFedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(pull.status === 502, `pull ${pull.status}: ${JSON.stringify(pull.body)}`);
        assert(pull.body.error?.code === 'FEDERATION_PROXY_ERROR', `pull code: ${pull.body.error?.code}`);
        assert(String(pull.body.error?.message).startsWith('Failed to reach'),
            `the network catch, not the url guard: ${pull.body.error?.message}`);

        // push-home never reaches the socket for THIS session, and the reason is the point: the
        // record was pulled by the visitor whose home is `homeNodeId`, and this session's home is
        // `deadNodeId`. Two home nodes are two accounts even when the local part of the name is the
        // same, so the key is not this identity's to push. It answers 404 before it dials.
        //
        // Until 2026-09-13 both sessions resolved to `visitor@<this node>` and shared one namespace,
        // so this door found the other visitor's record and failed on the dead socket instead. That
        // shared bucket was the defect (utils/gaii.ts resolveIdentity, test/e2e-federated-namesake.ts);
        // the proxy path for push-home is covered by Phase 5, where the record IS the pusher's.
        const push = await json('/v1/memory/push-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${deadFedToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(push.status === 404, `push ${push.status}: ${JSON.stringify(push.body)}`);
        assert(push.body.error?.code === 'NOT_FOUND', `push code: ${push.body.error?.code}`);

        const list = await json('/v1/memory/list-home', {
            method: 'POST',
            headers: { Authorization: `Bearer ${deadFedToken}` },
            body: JSON.stringify({}),
        });
        assert(list.status === 502, `list ${list.status}: ${JSON.stringify(list.body)}`);
        assert(list.body.error?.code === 'FEDERATION_PROXY_ERROR', `list code: ${list.body.error?.code}`);
    });

    await test('the two home-user doors refuse a federated session', async () => {
        // The mirror of NOT_FEDERATED: list-remote and pull-remote browse a PEER on behalf of
        // somebody whose account is here, and a visitor is not that person.
        const list = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ peer_node_id: homeNodeId }),
        });
        assert(list.status === 400, `list-remote ${list.status}: ${JSON.stringify(list.body)}`);
        assert(list.body.error?.code === 'NOT_HOME', `list-remote code: ${list.body.error?.code}`);

        const pull = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ peer_node_id: homeNodeId, key: PULL_KEY }),
        });
        assert(pull.status === 400, `pull-remote ${pull.status}: ${JSON.stringify(pull.body)}`);
        assert(pull.body.error?.code === 'NOT_HOME', `pull-remote code: ${pull.body.error?.code}`);
    });

    await test('all three doors require a credential', async () => {
        for (const path of ['/v1/memory/pull', '/v1/memory/push-home', '/v1/memory/list-home']) {
            const { status } = await json(path, { method: 'POST', body: JSON.stringify({ key: PULL_KEY }) });
            assert(status === 401, `${path} unauthenticated: ${status}`);
        }
    });

    await test('a federated session is refused the operator doors', async () => {
        const { status, body } = await json('/v1/federation/peers', {
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(status === 403, `a visitor must not read the peer table, got ${status}: ${JSON.stringify(body)}`);
        assert(String(body.error?.message).includes('Federated sessions'), `message: ${body.error?.message}`);
    });

    await test('the visitor\'s scope list is enforced: memory:read does not write', async () => {
        // Asserted as a hole first, 2026-09-08: the mint hands the session roles:['owner'], and
        // requireScope (auth/middleware.ts) and services/memory-write.ts both waved an owner role
        // past every scope check, so a visitor holding memory:read and catalogue:read wrote memory
        // into a namespace on this node. Invariant 15: a permission word is enforced on every door or
        // it does not exist. Both gates now exclude a federated session from the owner bypass.
        const key = `visitor.write.${stamp}`;
        const { status, body } = await json('/v1/memory', {
            method: 'POST',
            headers: { Authorization: `Bearer ${fedToken}` },
            body: JSON.stringify({ key, value: { written_by: 'a memory:read session' } }),
        });
        assert(status === 403, `a memory:read session must not write, got ${status}: ${JSON.stringify(body)}`);
        const read = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${fedToken}` } });
        assert(read.status === 404, `and nothing landed: ${read.status}`);
        await json(`/v1/memory/${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${fedToken}` },
        });
    });

    // ─── Phase 8: What the login refuses ───
    console.log('Phase 8 — Login refusals');

    await test('a node id nothing is peered with is unreachable', async () => {
        const { status, body } = await federatedLogin(`aimeat-nobody-${stamp}`);
        assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_UNREACHABLE', `code: ${body.error?.code}`);
        assert(String(body.error?.message).includes('No active peer route'), `message: ${body.error?.message}`);
    });

    await test('an UNSIGNED attestation is refused, and says which end has to act', async () => {
        verifyMode = 'unsigned';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 401, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'ATTESTATION_UNSIGNED', `code: ${body.error?.code}`);
        verifyMode = 'ok';
    });

    await test('an attestation signed by the WRONG key is refused', async () => {
        verifyMode = 'wrong_key';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 401, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'INVALID_ATTESTATION',
            `a well-formed signature by a key this node has not pinned must not sign anybody in: ${body.error?.code}`);
        verifyMode = 'ok';
    });

    await test('an attestation naming nobody is a bad gateway, not a sign-in', async () => {
        verifyMode = 'no_ghii';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 502, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_AUTH_FAILED', `code: ${body.error?.code}`);
        verifyMode = 'ok';
    });

    await test('a home node that answers 500 refuses the sign-in and relays its words', async () => {
        verifyMode = 'broken';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 401, `a non-403 from home is a 401 here, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'HOME_NODE_BROKEN', `the home node's own code is relayed: ${body.error?.code}`);
        verifyMode = 'ok';
    });

    await test('a signed attestation saying verified:false is a refusal, not a session', async () => {
        // Asserted as a hole first, 2026-09-08: register-login.ts read the attestation for `ghii`
        // and nothing else, so a home node's properly signed "no, that password is wrong" minted a
        // session. Fixed in register-login.ts v1.7.0: the signature says who answered, `verified`
        // says what they answered, and both have to hold.
        verifyMode = 'unverified';
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 401, `verified:false must refuse, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_AUTH_FAILED', `code: ${JSON.stringify(body.error)}`);
        verifyMode = 'ok';
    });

    await test('a per-peer scope list overrides the node default', async () => {
        const put = await json(`/v1/federation/peers/${homeNodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ federation_auth_scopes: ['catalogue:read'] }),
        });
        assert(put.status === 200, `set the peer's scopes: ${put.status} ${JSON.stringify(put.body)}`);
        const { status, body } = await federatedLogin(homeNodeId);
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        const c = claims(body.data.token);
        assert(JSON.stringify(c.scopes) === '["catalogue:read"]',
            `the peer's own list wins over federationDefaultScopes, got ${JSON.stringify(c.scopes)}`);
    });

    // ─── Phase 9: Cleanup ───
    console.log('Phase 9 — Cleanup');

    await test('the visitor\'s record, the peers and the owner are removed', async () => {
        // The visitor holds memory:read and catalogue:read, so it cannot delete what it pulled: the
        // scope list is enforced now (2026-09-08). The record goes with the visitor's namespace when
        // the runner cleans the database; the peers and this suite's owner are removed here.
        const delRecord = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${fedToken}` },
        });
        assert(delRecord.status === 403, `a memory:read visitor cannot delete: ${delRecord.status} ${JSON.stringify(delRecord.body)}`);
        for (const id of [homeNodeId, deadNodeId]) {
            const del = await json(`/v1/federation/peers/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${ownerToken}` },
            });
            assert(del.status === 200, `delete peer ${id}: ${del.status} ${JSON.stringify(del.body)}`);
        }
        const owner = await json(`/v1/owners/${ownerName}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(owner.body.ok === true, `delete owner: ${JSON.stringify(owner.body.error)}`);
    });

    await cleanup();
    console.log(`\nFederated session E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
    console.error('Suite crashed:', err);
    await cleanup();
    process.exit(1);
});
