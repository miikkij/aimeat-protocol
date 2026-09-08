/**
 * @file test/e2e-memory-federation-remote.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two federated memory routes a HOME user drives, end to end against a peer that
 *   really answers: POST /v1/memory/list-remote and POST /v1/memory/pull-remote.
 *
 *   WHY THIS SUITE EXISTS. src/routes/memory/federation.ts was 20 % covered. Every existing suite
 *   stopped at the refusals, because the happy path needs a second node, and standing a whole AIMEAT
 *   node up to answer two requests is more than the statement is worth. So this suite serves the peer
 *   itself: a node:http server on loopback that answers POST /v1/federation/memory/list and
 *   GET /v1/memory/{gaii}/{key}, registered as an ACTIVE peer through the real operator routes. The
 *   runner pins AIMEAT_ALLOW_PRIVATE_EGRESS=true, so loopback passes validateOutboundUrl and the
 *   request that arrives is the request the node actually built.
 *
 *   That is what lets two things be asserted that nothing asserted before. First, the H-15 signature:
 *   the body this node POSTs to a peer's memory-list door carries `signature` and names this node as
 *   `requesting_node`, so the fake peer can hold it to that instead of trusting the field. Second,
 *   the write pull-remote performs: the record lands in the caller's own namespace with the
 *   `pulled-from:{peer}` tag, which is read back through GET /v1/memory/:key rather than inferred
 *   from the 200.
 *
 *   The refusals are driven from the same fake peer by switching what it answers, so a 500 from the
 *   far end is a real 500 over a real socket.
 *
 * @structure Phase 1 setup (owner, operator check, fake peer) · 2 peer registration and the
 *   not-yet-active refusal · 3 list-remote happy path + the signed body · 4 pull-remote happy path,
 *   the local write and the second pull's version bump · 5 refusals (unknown peer, peer 500, no
 *   value, missing input, unreachable peer, unauthenticated) · 6 the federated-session doors
 *   (pull, push-home, list-home) refusing a home token · 7 cleanup.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-memory-federation-remote
 * @version-history
 *   v1.0.0 — 2026-09-08 — Written to cover the two home-user federation routes and their refusals.
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

// ─── The peer, not a mock ─────────────────────────────────────────────────────
//
// Two doors, which is all the two routes under test ever call. `peerMode` switches what the far end
// answers so a refusal is a real status over a real socket, and every request is recorded so the
// suite can hold the OUTBOUND body to what the signing code claims to send.

type PeerMode = 'ok' | 'fail' | 'empty';
let peerMode: PeerMode = 'ok';
const listBodies: Record<string, unknown>[] = [];
const memoryPaths: string[] = [];

const REMOTE_VALUE = { note: 'written on the peer', n: 42 };
const REMOTE_TAGS = ['remote-tag', 'shared'];

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', c => { raw += c.toString(); });
        req.on('end', () => resolve(raw));
    });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(text);
}

function startFakePeer(): Promise<{ server: Server; url: string }> {
    const server = createServer((req, res) => {
        void (async () => {
            const path = req.url ?? '';
            if (req.method === 'POST' && path === '/v1/federation/memory/list') {
                const raw = await readBody(req);
                try { listBodies.push(JSON.parse(raw)); } catch { listBodies.push({ _unparsed: raw }); }
                if (peerMode === 'fail') { send(res, 500, { ok: false, error: { code: 'PEER_BROKEN' } }); return; }
                send(res, 200, {
                    ok: true,
                    data: {
                        entries: [
                            { key: 'peer.note', visibility: 'private', version: 3 },
                            { key: 'peer.other', visibility: 'public', version: 1 },
                        ],
                        total: 2,
                    },
                });
                return;
            }
            if (req.method === 'GET' && path.startsWith('/v1/memory/')) {
                memoryPaths.push(path);
                if (peerMode === 'fail') { send(res, 500, { ok: false, error: { code: 'PEER_BROKEN' } }); return; }
                if (peerMode === 'empty') { send(res, 200, { ok: true, data: { tags: [] } }); return; }
                send(res, 200, { ok: true, data: { value: REMOTE_VALUE, tags: REMOTE_TAGS } });
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

// ─── State ───
const stamp = Date.now().toString(36);
const ownerName = `fedrem${stamp}`;
const peerNodeId = `aimeat-fake-peer-${stamp}`;
const deadPeerNodeId = `aimeat-dead-peer-${stamp}`;
const PULL_KEY = 'peer.note';
let ownerToken = '';
let ownerGhii = '';
let peer: { server: Server; url: string } | null = null;

async function cleanup(): Promise<void> {
    if (peer) { await new Promise<void>(r => peer!.server.close(() => r())); peer = null; }
}

console.log('\n=== Memory federation: the two routes a HOME user drives against a real peer ===\n');

async function run() {
    // ─── Phase 1: Setup ───
    console.log('Phase 1 — Setup');

    await test('POST /v1/owners — register the home owner', async () => {
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
        ownerGhii = `${ownerName}@${NODE_ID}`;
        const roles = JSON.parse(Buffer.from(ownerToken.split('.')[1], 'base64url').toString()).roles ?? [];
        assert(roles.includes('operator'),
            `the peer routes are operator-only and this owner is not one (${JSON.stringify(roles)}); `
            + 'this suite needs to be the first owner on a freshly deleted database');
    });

    await test('a peer node answers on loopback', async () => {
        peer = await startFakePeer();
        const probe = await fetch(`${peer.url}/v1/nothing`);
        assert(probe.status === 404, `the fake peer must be up and answering, got ${probe.status}`);
    });

    // ─── Phase 2: Registration, and the peer that is not active yet ───
    console.log('Phase 2 — Peer registration');

    await test('POST /v1/federation/peers — the peer starts pending', async () => {
        const { status, body } = await json('/v1/federation/peers', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ node_id: peerNodeId, url: peer!.url, public_key: 'ZmFrZS1wZWVyLWtleQ==' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.peer.status === 'pending', `a fresh peer must be pending: ${body.data.peer.status}`);
    });

    await test('list-remote refuses a peer that is registered but NOT active', async () => {
        const { status, body } = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId }),
        });
        assert(status === 404, `a pending peer must not be listed against, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'PEER_NOT_FOUND', `code: ${body.error?.code}`);
        assert(listBodies.length === 0, `the refusal must come BEFORE the outbound call, got ${listBodies.length} request(s) at the peer`);
    });

    await test('PUT /v1/federation/peers/:nodeId — activate it', async () => {
        const { status, body } = await json(`/v1/federation/peers/${peerNodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ status: 'active' }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.status === 'active', `status: ${body.data.status}`);
    });

    // ─── Phase 3: list-remote ───
    console.log('Phase 3 — list-remote');

    await test('POST /v1/memory/list-remote — the peer\'s inventory comes back', async () => {
        peerMode = 'ok';
        const { status, body } = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.total === 2, `total: ${body.data.total}`);
        assert(Array.isArray(body.data.entries) && body.data.entries.length === 2, `entries: ${JSON.stringify(body.data.entries)}`);
        assert(body.data.entries[0].key === 'peer.note', `first key: ${body.data.entries[0]?.key}`);
        assert(body.data.source_node === peerNodeId, `source_node: ${body.data.source_node}`);
    });

    await test('…and the body that arrived at the peer is SIGNED and names this node (audit H-15)', async () => {
        assert(listBodies.length === 1, `the peer should have been called exactly once, got ${listBodies.length}`);
        const sent = listBodies[0];
        assert(sent.requesting_node === NODE_ID, `requesting_node: ${JSON.stringify(sent.requesting_node)}`);
        assert(sent.gaii === ownerGhii, `the request must name the caller's own GHII, got ${JSON.stringify(sent.gaii)}`);
        assert(typeof sent.timestamp === 'string' && sent.timestamp.length > 0, `timestamp: ${JSON.stringify(sent.timestamp)}`);
        assert(typeof sent.signature === 'string' && sent.signature.length > 0,
            'the inventory request must carry this node\'s signature — the requesting_node field alone proves '
            + `nothing, because the federation directory publishes every node id. Got ${JSON.stringify(sent.signature)}`);
    });

    // ─── Phase 4: pull-remote ───
    console.log('Phase 4 — pull-remote');

    await test('POST /v1/memory/pull-remote — the key is fetched from the peer', async () => {
        peerMode = 'ok';
        const { status, body } = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId, key: PULL_KEY }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.pulled === true, `pulled: ${body.data.pulled}`);
        assert(body.data.key === PULL_KEY, `key: ${body.data.key}`);
        assert(body.data.source_node === peerNodeId, `source_node: ${body.data.source_node}`);
        const asked = memoryPaths[memoryPaths.length - 1];
        assert(asked === `/v1/memory/${encodeURIComponent(ownerGhii)}/${encodeURIComponent(PULL_KEY)}`,
            `the peer must be asked for the caller's own GHII and key, got ${asked}`);
    });

    await test('…and the record really landed locally, tagged with where it came from', async () => {
        const { status, body } = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(status === 200, `the pulled key must be readable locally, got ${status}: ${JSON.stringify(body)}`);
        // Field by field, not by serialised text: Postgres stores jsonb with its keys reordered
        // (shortest first), so the same record reads back as {"n":42,"note":…} there and as it was
        // written on SQLite. Measured on the first postgres sweep this suite ran in, 2026-09-08.
        assert(body.data.value?.n === REMOTE_VALUE.n && body.data.value?.note === REMOTE_VALUE.note
            && Object.keys(body.data.value).length === 2,
            `value: ${JSON.stringify(body.data.value)}`);
        assert(body.data.visibility === 'private', `a pulled record is private: ${body.data.visibility}`);
        assert(body.data.tags.includes(`pulled-from:${peerNodeId}`),
            `tags must record the source, got ${JSON.stringify(body.data.tags)}`);
        for (const t of REMOTE_TAGS) {
            assert(body.data.tags.includes(t), `the peer's own tag "${t}" must survive: ${JSON.stringify(body.data.tags)}`);
        }
        assert(body.data.version === 1, `first pull is version 1: ${body.data.version}`);
    });

    await test('pulling the same key again bumps the version instead of duplicating it', async () => {
        const { status } = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId, key: PULL_KEY }),
        });
        assert(status === 200, `second pull ${status}`);
        const read = await json(`/v1/memory/${encodeURIComponent(PULL_KEY)}`, {
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(read.body.data.version === 2, `second pull must be version 2, got ${read.body.data.version}`);
        const tagCount = read.body.data.tags.filter((t: string) => t === `pulled-from:${peerNodeId}`).length;
        assert(tagCount === 1, `the pulled-from tag must be deduplicated, got ${tagCount} copies`);
    });

    // ─── Phase 5: Refusals ───
    console.log('Phase 5 — Refusals');

    await test('an unknown peer id is refused by both routes', async () => {
        const unknown = `aimeat-nobody-${stamp}`;
        const list = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: unknown }),
        });
        assert(list.status === 404, `list-remote ${list.status}`);
        assert(list.body.error?.code === 'PEER_NOT_FOUND', `list-remote code: ${list.body.error?.code}`);
        const pull = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: unknown, key: PULL_KEY }),
        });
        assert(pull.status === 404, `pull-remote ${pull.status}`);
        assert(pull.body.error?.code === 'PEER_NOT_FOUND', `pull-remote code: ${pull.body.error?.code}`);
    });

    await test('a peer that answers 500 is reported as a failed pull, not as an empty one', async () => {
        peerMode = 'fail';
        const { status, body } = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId, key: 'peer.other' }),
        });
        assert(status === 500, `the peer's status is passed through, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_PULL_FAILED', `code: ${body.error?.code}`);
        const local = await json('/v1/memory/peer.other', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(local.status === 404, `a failed pull must write nothing, got ${local.status}`);
    });

    await test('…and the same 500 on the list door', async () => {
        peerMode = 'fail';
        const { status, body } = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId }),
        });
        assert(status === 500, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'FEDERATION_LIST_FAILED', `code: ${body.error?.code}`);
    });

    await test('a 200 from the peer carrying no value is a NOT_FOUND, not a write of undefined', async () => {
        peerMode = 'empty';
        const { status, body } = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId, key: 'peer.missing' }),
        });
        assert(status === 404, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
        const local = await json('/v1/memory/peer.missing', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(local.status === 404, `nothing may be written for a valueless answer, got ${local.status}`);
        peerMode = 'ok';
    });

    await test('missing peer_node_id and missing key are both refused before anything is reached', async () => {
        const noPeer = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ key: PULL_KEY }),
        });
        assert(noPeer.status === 400 && noPeer.body.error?.code === 'INVALID_INPUT',
            `pull-remote without a peer: ${noPeer.status} ${noPeer.body.error?.code}`);
        const noKey = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: peerNodeId }),
        });
        assert(noKey.status === 400 && noKey.body.error?.code === 'INVALID_INPUT',
            `pull-remote without a key: ${noKey.status} ${noKey.body.error?.code}`);
        const noPeerList = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({}),
        });
        assert(noPeerList.status === 400 && noPeerList.body.error?.code === 'INVALID_INPUT',
            `list-remote without a peer: ${noPeerList.status} ${noPeerList.body.error?.code}`);
    });

    await test('an ACTIVE peer nothing answers at is a proxy error on both routes', async () => {
        const reg = await json('/v1/federation/peers', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ node_id: deadPeerNodeId, url: 'http://127.0.0.1:1', public_key: 'ZGVhZC1wZWVyLWtleQ==' }),
        });
        assert(reg.status === 201, `dead peer register ${reg.status}: ${JSON.stringify(reg.body)}`);
        const act = await json(`/v1/federation/peers/${deadPeerNodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ status: 'active' }),
        });
        assert(act.status === 200, `dead peer activate ${act.status}`);

        const list = await json('/v1/memory/list-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: deadPeerNodeId }),
        });
        assert(list.status === 502, `list-remote against a dead peer ${list.status}: ${JSON.stringify(list.body)}`);
        assert(list.body.error?.code === 'FEDERATION_PROXY_ERROR', `list code: ${list.body.error?.code}`);

        const pull = await json('/v1/memory/pull-remote', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ peer_node_id: deadPeerNodeId, key: PULL_KEY }),
        });
        assert(pull.status === 502, `pull-remote against a dead peer ${pull.status}: ${JSON.stringify(pull.body)}`);
        assert(pull.body.error?.code === 'FEDERATION_PROXY_ERROR', `pull code: ${pull.body.error?.code}`);
    });

    await test('both routes require a credential', async () => {
        const list = await json('/v1/memory/list-remote', {
            method: 'POST',
            body: JSON.stringify({ peer_node_id: peerNodeId }),
        });
        assert(list.status === 401, `list-remote unauthenticated: ${list.status}`);
        const pull = await json('/v1/memory/pull-remote', {
            method: 'POST',
            body: JSON.stringify({ peer_node_id: peerNodeId, key: PULL_KEY }),
        });
        assert(pull.status === 401, `pull-remote unauthenticated: ${pull.status}`);
    });

    // ─── Phase 6: The other three doors, from the wrong side ───
    console.log('Phase 6 — The federated-session doors');

    await test('pull, push-home and list-home all refuse a HOME session', async () => {
        // The mirror image of the two routes above: these three exist only for a session this node
        // issued no token for. federation-mesh.ts asserts it for pull and push-home; list-home was
        // the one nothing held, and it is the door that would hand a peer's whole inventory over.
        for (const path of ['/v1/memory/pull', '/v1/memory/push-home', '/v1/memory/list-home']) {
            const { status, body } = await json(path, {
                method: 'POST',
                headers: { Authorization: `Bearer ${ownerToken}` },
                body: JSON.stringify({ key: PULL_KEY }),
            });
            assert(status === 400, `${path} must refuse a home session, got ${status}: ${JSON.stringify(body)}`);
            assert(body.error?.code === 'NOT_FEDERATED', `${path} code: ${body.error?.code}`);
        }
    });

    await test('…and they refuse an anonymous caller before they get that far', async () => {
        for (const path of ['/v1/memory/pull', '/v1/memory/push-home', '/v1/memory/list-home']) {
            const { status } = await json(path, { method: 'POST', body: JSON.stringify({ key: PULL_KEY }) });
            assert(status === 401, `${path} unauthenticated: ${status}`);
        }
    });

    // ─── Phase 7: Cleanup ───
    console.log('Phase 7 — Cleanup');

    await test('the peers and the owner are removed', async () => {
        for (const id of [peerNodeId, deadPeerNodeId]) {
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
    console.log(`\nMemory federation remote E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
    console.error('Suite crashed:', err);
    await cleanup();
    process.exit(1);
});
