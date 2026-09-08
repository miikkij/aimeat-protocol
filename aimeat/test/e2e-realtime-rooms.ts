/**
 * @file test/e2e-realtime-rooms.ts
 * @description The realtime room subsystem, end to end: the ten HTTP routes under
 *   /v1/realtime (plus /v1/admin/realtime) and the WebSocket at /v1/realtime/ws.
 *
 *   WHY THIS EXISTS. Nothing in test/ had ever opened ws://.../v1/realtime/ws or called a single
 *   /v1/realtime route. src/services/realtime-manager.ts is 750 lines and 23 of its 28 members were
 *   never executed by the whole E2E sweep; src/routes/realtime.ts ran at a fifth of its lines. Every
 *   message type, every error code and every refusal below was reachable in production and asserted
 *   by nobody, which is also how two dead members (getRoomCount, loadYjsSnapshot) survived in a file
 *   nobody could tell was half-unused.
 *
 *   WHAT AN ASSERTION IS HERE. A socket message is proven on a SECOND socket wherever the server
 *   claims to relay it: a presence update, a signal, a broadcast, a Yjs update, a chat line, a
 *   rename. Asserting that the sender's own send() did not throw would prove the client library.
 *
 * @structure Phase 1 rooms REST · 2 upgrade refusals · 3 the socket protocol (join, presence,
 *   signal, broadcast, yjs, chat, history, rename, leave, the four error codes) · 4 close and
 *   auto-delete · 5 echat (the anonymous door, its flag, its per-IP limit, the room-name rule) ·
 *   6 room limit · 7 federated discovery against a real loopback peer · 8 the federation relay ·
 *   9 the idle reaper.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-realtime-rooms
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. First suite in the repo to open a realtime socket.
 */
import { WebSocket } from 'ws';
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const WS_BASE = BASE.replace(/^http/, 'ws').replace(/\/+$/, '');
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

function sleep(ms: number) {
    return new Promise<void>(resolve => { setTimeout(resolve, ms); });
}

// ─── Owner helpers (the first owner registered on a fresh node is the operator) ───

async function setupOwner(label: string): Promise<{ name: string; token: string }> {
    const name = `rt${label}${Date.now().toString(36)}`;
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    if (reg.status !== 201) throw new Error(`register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(
        new TextEncoder().encode(name + NODE_ID + timestamp),
        Buffer.from(reg.body.data.private_key, 'base64'),
    )).toString('base64');
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: sig }),
    });
    if (tok.body?.ok !== true) throw new Error(`token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token };
}

function rolesOf(token: string): string[] {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).roles ?? [];
}

// ─── The socket client ───
//
// One flat JSON object per frame (src/services/realtime-types.ts). No handshake beyond the upgrade,
// no subscribe, no ping: what the server sends first is `joined`.

const openSockets: Sock[] = [];

class Sock {
    private ws: WebSocket;
    /** Frames that arrived with nobody waiting for them. waitFor() drains this first. */
    private pending: any[] = [];
    private waiters: Array<{ match: (m: any) => boolean; resolve: (m: any) => void }> = [];

    private constructor(ws: WebSocket) {
        this.ws = ws;
        ws.on('message', (data) => {
            let msg: any;
            try { msg = JSON.parse(data.toString('utf-8')); } catch { return; }
            const idx = this.waiters.findIndex(w => w.match(msg));
            if (idx >= 0) {
                const [w] = this.waiters.splice(idx, 1);
                w.resolve(msg);
                return;
            }
            this.pending.push(msg);
        });
    }

    static open(query: string, timeoutMs = 8000): Promise<Sock> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${WS_BASE}/v1/realtime/ws?${query}`);
            const timer = setTimeout(() => { ws.terminate(); reject(new Error('socket open timed out')); }, timeoutMs);
            ws.once('open', () => {
                clearTimeout(timer);
                const s = new Sock(ws);
                openSockets.push(s);
                resolve(s);
            });
            ws.once('error', (err) => { clearTimeout(timer); reject(err); });
        });
    }

    waitFor(type: string, extra?: (m: any) => boolean, timeoutMs = 4000): Promise<any> {
        const match = (m: any) => m.type === type && (!extra || extra(m));
        const idx = this.pending.findIndex(match);
        if (idx >= 0) return Promise.resolve(this.pending.splice(idx, 1)[0]);
        return new Promise((resolve, reject) => {
            const entry = { match, resolve };
            this.waiters.push(entry);
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== entry);
                reject(new Error(`no "${type}" within ${timeoutMs}ms (saw: ${this.pending.map(m => m.type).join(', ') || 'nothing'})`));
            }, timeoutMs);
            const done = entry.resolve;
            entry.resolve = (m: any) => { clearTimeout(timer); done(m); };
        });
    }

    /** Prove a frame does NOT arrive. Used where a disconnect must actually stop the traffic. */
    async expectNone(type: string, windowMs = 900): Promise<void> {
        await sleep(windowMs);
        const found = this.pending.find(m => m.type === type);
        if (found) throw new Error(`unexpected "${type}": ${JSON.stringify(found).slice(0, 160)}`);
    }

    send(obj: unknown): void { this.ws.send(JSON.stringify(obj)); }
    sendRaw(raw: string): void { this.ws.send(raw); }
    get isClosed(): boolean { return this.ws.readyState > 1; }

    waitClosed(timeoutMs = 4000): Promise<void> {
        if (this.isClosed) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('socket stayed open')), timeoutMs);
            this.ws.once('close', () => { clearTimeout(timer); resolve(); });
        });
    }

    close(): void { try { this.ws.close(); } catch { /* already gone */ } }
}

/**
 * The refusals on the upgrade are raw HTTP status lines written to the socket, so they are read with
 * an HTTP client rather than a WebSocket client: `ws` turns them into an error string, and on a
 * destroyed socket sometimes into ECONNRESET instead.
 */
function upgradeStatus(query: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(`${BASE}/v1/realtime/ws?${query}`, {
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                'Sec-WebSocket-Version': '13',
            },
        });
        const timer = setTimeout(() => { req.destroy(); reject(new Error('upgrade timed out')); }, 8000);
        req.on('response', res => { clearTimeout(timer); res.resume(); resolve(res.statusCode ?? 0); });
        req.on('upgrade', (res, socket) => { clearTimeout(timer); socket.destroy(); resolve(res.statusCode ?? 101); });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.end();
    });
}

// ─── State ───

let ownerA = { name: '', token: '' };
let ownerB = { name: '', token: '' };
let publicRoomId = '';
let privateRoomId = '';
let chatRoomId = '';
let fakePeer: Server | null = null;

const authA = () => ({ Authorization: `Bearer ${ownerA.token}` });
const authB = () => ({ Authorization: `Bearer ${ownerB.token}` });

async function createRoom(body: Record<string, unknown>, headers = authA()) {
    return json('/v1/realtime/rooms', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function setConfig(path: string, value: unknown) {
    const r = await json('/v1/admin/config', {
        method: 'PUT',
        headers: authA(),
        body: JSON.stringify({ changes: [{ path, value }] }),
    });
    if (r.body?.ok !== true) throw new Error(`config ${path}: ${JSON.stringify(r.body)}`);
}

console.log('\n=== AIMEAT Realtime Rooms E2E Test ===\n');

// ─── Phase 0: Setup ───
console.log('Phase 0 — Setup');

await test('two owners, the first of them the operator', async () => {
    ownerA = await setupOwner('a');
    ownerB = await setupOwner('b');
    assert(rolesOf(ownerA.token).includes('operator'), `owner A must be the bootstrap operator: ${JSON.stringify(rolesOf(ownerA.token))}`);
    assert(!rolesOf(ownerB.token).includes('operator'), `owner B must not be an operator: ${JSON.stringify(rolesOf(ownerB.token))}`);
});

// ─── Phase 1: The room routes ───
console.log('\nPhase 1 — Rooms REST');

await test('POST /v1/realtime/rooms — creates a room and hands back its socket URL', async () => {
    const { status, body } = await createRoom({ app_type: 'whiteboard', name: 'rt-public', tags: ['demo', 'rt-suite'] });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    publicRoomId = body.data.id;
    assert(typeof publicRoomId === 'string' && publicRoomId.length > 0, 'room id');
    assert(body.data.app_type === 'whiteboard', `app_type: ${body.data.app_type}`);
    assert(body.data.created_by === ownerA.name, `created_by should be the owner's sub: ${body.data.created_by}`);
    assert(body.data.is_public === true, 'public by default');
    assert(body.data.peer_count === 0, `peer_count: ${body.data.peer_count}`);
    assert(body.data.max_peers === 20, `max_peers falls back to the node ceiling: ${body.data.max_peers}`);
    assert(body.data.ws_url === `/v1/realtime/ws?room=${publicRoomId}`, `ws_url: ${body.data.ws_url}`);
});

await test('POST /v1/realtime/rooms — max_peers is clamped to the node ceiling, never raised by the caller', async () => {
    const { body } = await createRoom({ app_type: 'whiteboard', name: 'rt-greedy', max_peers: 9999 });
    assert(body.data.max_peers === 20, `caller asked for 9999 and got ${body.data.max_peers}`);
    const del = await json(`/v1/realtime/rooms/${body.data.id}`, { method: 'DELETE', headers: authA() });
    assert(del.status === 200, `cleanup delete: ${del.status}`);
});

await test('POST /v1/realtime/rooms — a private room is created but not listed', async () => {
    const { status, body } = await createRoom({ app_type: 'notes', name: 'rt-private', is_public: false });
    assert(status === 201, `status ${status}`);
    privateRoomId = body.data.id;
    assert(body.data.is_public === false, 'is_public false');
    const list = await json('/v1/realtime/rooms');
    const ids = list.body.data.rooms.map((r: any) => r.id);
    assert(!ids.includes(privateRoomId), 'a private room must not appear in the public listing');
    assert(ids.includes(publicRoomId), 'the public room must appear in the public listing');
});

await test('POST /v1/realtime/rooms — app_type and name are both required', async () => {
    const noType = await createRoom({ name: 'x' });
    assert(noType.status === 400, `missing app_type: ${noType.status}`);
    assert(noType.body.error?.code === 'INVALID_INPUT', `code: ${noType.body.error?.code}`);
    const noName = await createRoom({ app_type: 'x' });
    assert(noName.status === 400, `missing name: ${noName.status}`);
});

await test('POST /v1/realtime/rooms — refused without a credential (anonymous mode is on)', async () => {
    const { status } = await json('/v1/realtime/rooms', {
        method: 'POST',
        body: JSON.stringify({ app_type: 'whiteboard', name: 'rt-nobody' }),
    });
    assert(status === 401, `unauthenticated create must be 401, got ${status}`);
});

await test('GET /v1/realtime/rooms — unauthenticated listing, filtered by app_type and by tag', async () => {
    const all = await json('/v1/realtime/rooms');
    assert(all.status === 200 && all.body.ok === true, `status ${all.status}`);
    assert(typeof all.body.data.total === 'number', 'has total');
    const byType = await json('/v1/realtime/rooms?app_type=whiteboard');
    assert(byType.body.data.rooms.every((r: any) => r.app_type === 'whiteboard'), 'app_type filter leaks another type');
    assert(byType.body.data.rooms.some((r: any) => r.id === publicRoomId), 'our room survives its own filter');
    const byTag = await json('/v1/realtime/rooms?tag=rt-suite');
    assert(byTag.body.data.rooms.every((r: any) => r.tags.includes('rt-suite')), 'tag filter leaks another tag');
    const byMissing = await json('/v1/realtime/rooms?tag=rt-no-such-tag');
    assert(byMissing.body.data.total === 0, `a tag nobody used must match nothing: ${byMissing.body.data.total}`);
});

await test('GET /v1/realtime/rooms/:roomId — details, and 404 for a room that never existed', async () => {
    const { status, body } = await json(`/v1/realtime/rooms/${publicRoomId}`);
    assert(status === 200, `status ${status}`);
    assert(body.data.id === publicRoomId, 'id');
    assert(Array.isArray(body.data.peers) && body.data.peers.length === 0, 'no peers yet');
    const missing = await json('/v1/realtime/rooms/00000000-0000-4000-8000-000000000000');
    assert(missing.status === 404, `unknown room: ${missing.status}`);
    assert(missing.body.error?.code === 'NOT_FOUND', `code: ${missing.body.error?.code}`);
});

await test('GET /v1/realtime/ice-servers — served to a credential, refused without one', async () => {
    const { status, body } = await json('/v1/realtime/ice-servers', { headers: authA() });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.ice_servers) && body.data.ice_servers.length > 0, 'has ice_servers');
    const anon = await json('/v1/realtime/ice-servers');
    assert(anon.status === 401, `unauthenticated ice-servers must be 401, got ${anon.status}`);
});

await test('GET /v1/realtime/stats — operator only', async () => {
    const { status, body } = await json('/v1/realtime/stats', { headers: authA() });
    assert(status === 200, `status ${status}`);
    for (const k of ['rooms', 'peers', 'messagesIn', 'messagesOut', 'messagesRejected', 'roomsCreated', 'roomsClosed', 'peakConcurrentPeers']) {
        assert(typeof body.data[k] === 'number', `stats.${k} missing`);
    }
    assert(body.data.roomsCreated >= 3, `roomsCreated should count what this suite made: ${body.data.roomsCreated}`);
    const b = await json('/v1/realtime/stats', { headers: authB() });
    assert(b.status === 403, `a non-operator reading stats must be 403, got ${b.status}`);
});

await test('GET /v1/admin/realtime — the operator sees private rooms the public listing hides', async () => {
    const { status, body } = await json('/v1/admin/realtime', { headers: authA() });
    assert(status === 200, `status ${status}`);
    assert(typeof body.data.stats?.rooms === 'number', 'has stats');
    const ids = body.data.rooms.map((r: any) => r.id);
    assert(ids.includes(privateRoomId), 'the admin overview must list the private room');
    const priv = body.data.rooms.find((r: any) => r.id === privateRoomId);
    assert(Array.isArray(priv.yjs_docs), 'each room reports its yjs docs');
    assert(typeof priv.last_activity_at === 'string', 'each room reports last_activity_at');
    const b = await json('/v1/admin/realtime', { headers: authB() });
    assert(b.status === 403, `a non-operator on the admin overview must be 403, got ${b.status}`);
});

await test('GET /v1/realtime/federated-rooms — says so plainly when no peer is configured', async () => {
    const { status, body } = await json('/v1/realtime/federated-rooms');
    assert(status === 200, `status ${status}`);
    assert(body.data.total === 0 && body.data.rooms.length === 0, 'no rooms');
    assert(body.data.note === 'No federated peers configured', `note: ${body.data.note}`);
});

// ─── Phase 2: What the upgrade refuses ───
console.log('\nPhase 2 — Upgrade refusals');

await test('ws upgrade — no room parameter is 400', async () => {
    assert(await upgradeStatus('nick=nobody') === 400, 'expected 400 with no room');
});

await test('ws upgrade — a room that does not exist is 404', async () => {
    const status = await upgradeStatus('room=00000000-0000-4000-8000-000000000000&nick=nobody');
    assert(status === 404, `expected 404, got ${status}`);
});

await test('ws upgrade — a token that does not verify is 401, even though the room exists', async () => {
    const status = await upgradeStatus(`room=${publicRoomId}&token=not.a.jwt`);
    assert(status === 401, `expected 401, got ${status}`);
});

await test('ws upgrade — a valid owner token is accepted, in a room of its own', async () => {
    // Its own room, because a socket that joins and leaves takes the room with it: the last peer out
    // deletes it. Asserting that is the other half of this test.
    const { body } = await createRoom({ app_type: 'whiteboard', name: 'rt-probe' });
    const probeRoom = body.data.id;
    const probe = await Sock.open(`room=${probeRoom}&token=${encodeURIComponent(ownerA.token)}&nick=probe`);
    const joined = await probe.waitFor('joined');
    assert(joined.roomId === probeRoom, `roomId: ${joined.roomId}`);
    probe.close();
    let status = 200;
    for (let i = 0; i < 40 && status !== 404; i++) {
        status = (await json(`/v1/realtime/rooms/${probeRoom}`)).status;
        if (status !== 404) await sleep(50);
    }
    assert(status === 404, `the room must go with its last peer, still ${status}`);
});

// ─── Phase 3: The socket protocol ───
console.log('\nPhase 3 — The socket protocol');

let alice: Sock;
let bob: Sock;
let alicePeerId = '';
let bobPeerId = '';

await test('join — the first peer is told it is alone, the second is told about the first', async () => {
    alice = await Sock.open(`room=${publicRoomId}&nick=alice`);
    const aJoined = await alice.waitFor('joined');
    alicePeerId = aJoined.peerId;
    assert(aJoined.roomId === publicRoomId, `roomId: ${aJoined.roomId}`);
    assert(Array.isArray(aJoined.peers) && aJoined.peers.length === 0, `alice should see no peers: ${JSON.stringify(aJoined.peers)}`);

    bob = await Sock.open(`room=${publicRoomId}&nick=bob`);
    const bJoined = await bob.waitFor('joined');
    bobPeerId = bJoined.peerId;
    assert(bJoined.peers.length === 1 && bJoined.peers[0].peerId === alicePeerId,
        `bob should see alice: ${JSON.stringify(bJoined.peers)}`);

    const peerJoined = await alice.waitFor('peer-joined');
    assert(peerJoined.peerId === bobPeerId && peerJoined.nick === 'bob', `peer-joined: ${JSON.stringify(peerJoined)}`);
    const participant = await alice.waitFor('participant', m => m.action === 'join');
    assert(participant.name === 'bob' && participant.count === 2, `participant join: ${JSON.stringify(participant)}`);
});

await test('room-meta — every joiner gets the room identity it needs for key derivation', async () => {
    const meta = await bob.waitFor('room-meta');
    assert(meta.room === 'rt-public', `room name: ${meta.room}`);
    assert(meta.roomId === publicRoomId, `roomId: ${meta.roomId}`);
    assert(meta.nodeId === NODE_ID, `nodeId: ${meta.nodeId}`);
    assert(typeof meta.createdAt === 'number', 'createdAt is a timestamp');
    assert(meta.participants.includes('alice') && meta.participants.includes('bob'),
        `participants: ${JSON.stringify(meta.participants)}`);
});

await test('GET /v1/realtime/rooms/:roomId — the two live peers show up over HTTP', async () => {
    const { body } = await json(`/v1/realtime/rooms/${publicRoomId}`);
    assert(body.data.peer_count === 2, `peer_count: ${body.data.peer_count}`);
    const nicks = body.data.peers.map((p: any) => p.nick).sort();
    assert(JSON.stringify(nicks) === '["alice","bob"]', `peers: ${JSON.stringify(nicks)}`);
});

await test('presence — the state alice sets reaches bob', async () => {
    alice.send({ type: 'presence', state: { cursor: { x: 12, y: 34 }, colour: 'teal' } });
    const got = await bob.waitFor('peer-presence');
    assert(got.peerId === alicePeerId, `from: ${got.peerId}`);
    assert(got.state?.colour === 'teal' && got.state?.cursor?.x === 12, `state: ${JSON.stringify(got.state)}`);
});

await test('signal — a directed frame reaches only the peer it names', async () => {
    alice.send({ type: 'signal', to: bobPeerId, payload: { sdp: 'offer-1' } });
    const got = await bob.waitFor('signal');
    assert(got.from === alicePeerId, `from: ${got.from}`);
    assert((got.payload as any).sdp === 'offer-1', `payload: ${JSON.stringify(got.payload)}`);
    // A signal addressed to a peer id nobody holds is dropped, not echoed back to the sender.
    alice.send({ type: 'signal', to: 'no-such-peer', payload: { sdp: 'offer-2' } });
    await alice.expectNone('signal');
});

await test('broadcast — reaches the other peer and not the sender', async () => {
    bob.send({ type: 'broadcast', payload: { move: 'e4' } });
    const got = await alice.waitFor('broadcast');
    assert(got.from === bobPeerId, `from: ${got.from}`);
    assert((got.payload as any).move === 'e4', `payload: ${JSON.stringify(got.payload)}`);
    await bob.expectNone('broadcast');
});

await test('yjs-sync — an update is relayed, kept, and replayed to a late joiner from __server__', async () => {
    const update = Buffer.from('yjs-update-bytes').toString('base64');
    alice.send({ type: 'yjs-sync', docId: 'doc-1', update });
    const relayed = await bob.waitFor('yjs-sync');
    assert(relayed.from === alicePeerId && relayed.docId === 'doc-1', `relayed: ${JSON.stringify(relayed)}`);
    assert(relayed.update === update, 'the update travels unchanged');

    const carol = await Sock.open(`room=${publicRoomId}&nick=carol`);
    const carolJoined = await carol.waitFor('joined');
    carol.send({ type: 'yjs-sync', docId: 'doc-1', requestState: true });
    const snapshot = await carol.waitFor('yjs-sync');
    assert(snapshot.from === '__server__', `a replayed snapshot comes from the server: ${snapshot.from}`);
    assert(snapshot.update === update, 'the stored snapshot is the last update');

    // A doc nobody has written has no snapshot, and the request is answered with silence.
    carol.send({ type: 'yjs-sync', docId: 'doc-unknown', requestState: true });
    await carol.expectNone('yjs-sync');
    carol.close();
    await alice.waitFor('peer-left', m => m.peerId === carolJoined.peerId);
});

await test('GET /v1/admin/realtime — the stored Yjs doc is visible to the operator', async () => {
    const { body } = await json('/v1/admin/realtime', { headers: authA() });
    const room = body.data.rooms.find((r: any) => r.id === publicRoomId);
    const doc = room.yjs_docs.find((d: any) => d.doc_id === 'doc-1');
    assert(doc !== undefined, `doc-1 missing from ${JSON.stringify(room.yjs_docs)}`);
    assert(doc.snapshot_size > 0, `snapshot_size: ${doc.snapshot_size}`);
});

await test('chat — echoed to the sender as well, cached, and replayed to whoever joins next', async () => {
    alice.send({ type: 'chat', payload: 'hello room' });
    const onBob = await bob.waitFor('chat');
    const onAlice = await alice.waitFor('chat');
    assert(onBob.sender === 'alice' && onBob.payload === 'hello room', `bob's copy: ${JSON.stringify(onBob)}`);
    assert(onBob.room === 'rt-public', `room name on the chat frame: ${onBob.room}`);
    assert(typeof onBob.ts === 'number', 'chat carries a timestamp');
    assert(onAlice.sender === 'alice', 'the sender gets its own line back as confirmation');

    const dave = await Sock.open(`room=${publicRoomId}&nick=dave`);
    const daveJoined = await dave.waitFor('joined');
    const history = await dave.waitFor('history');
    assert(history.room === 'rt-public', `history room: ${history.room}`);
    assert(history.messages.some((m: any) => m.payload === 'hello room' && m.sender === 'alice'),
        `history: ${JSON.stringify(history.messages)}`);
    dave.close();
    await bob.waitFor('peer-left', m => m.peerId === daveJoined.peerId);
});

await test('set-name — the rename reaches the room, carrying the old name', async () => {
    alice.send({ type: 'set-name', name: 'alice-renamed' });
    const onBob = await bob.waitFor('participant', m => m.action === 'rename');
    assert(onBob.name === 'alice-renamed', `new name: ${onBob.name}`);
    assert(onBob.message === 'alice', `the old name travels for the client to display: ${onBob.message}`);
    assert(onBob.peerId === alicePeerId, `peerId: ${onBob.peerId}`);
    // The rename is broadcast to everyone, the renamer included.
    const onAlice = await alice.waitFor('participant', m => m.action === 'rename');
    assert(onAlice.name === 'alice-renamed', 'the renamer sees its own rename');
});

await test('leave — a peer that says goodbye is removed and announced', async () => {
    const eve = await Sock.open(`room=${publicRoomId}&nick=eve`);
    const joined = await eve.waitFor('joined');
    await bob.waitFor('peer-joined', m => m.peerId === joined.peerId);
    eve.send({ type: 'leave' });
    const left = await bob.waitFor('peer-left', m => m.peerId === joined.peerId);
    assert(left.peerId === joined.peerId, `peer-left: ${JSON.stringify(left)}`);
    const participant = await bob.waitFor('participant', m => m.action === 'leave' && m.name === 'eve');
    assert(participant.name === 'eve', `participant leave: ${JSON.stringify(participant)}`);
    await eve.waitClosed();
});

await test('error MESSAGE_TOO_LARGE — a frame over the size ceiling is refused, not truncated', async () => {
    const fat = JSON.stringify({ type: 'broadcast', payload: 'x'.repeat(17000) });
    assert(fat.length > 16384, `the test frame must exceed the ceiling: ${fat.length}`);
    alice.sendRaw(fat);
    const err = await alice.waitFor('error');
    assert(err.code === 'MESSAGE_TOO_LARGE', `code: ${err.code}`);
    await bob.expectNone('broadcast');
});

await test('error INVALID_MESSAGE — a frame that is not JSON is answered, not dropped', async () => {
    alice.sendRaw('this is not json');
    const err = await alice.waitFor('error');
    assert(err.code === 'INVALID_MESSAGE', `code: ${err.code}`);
});

await test('error RATE_LIMITED — the 51st frame in a second is refused and counted', async () => {
    const before = await json('/v1/realtime/stats', { headers: authA() });
    const flood = await Sock.open(`room=${publicRoomId}&nick=flood`);
    const floodJoined = await flood.waitFor('joined');
    for (let i = 0; i < 70; i++) flood.send({ type: 'broadcast', payload: i });
    const err = await flood.waitFor('error');
    assert(err.code === 'RATE_LIMITED', `code: ${err.code}`);
    const after = await json('/v1/realtime/stats', { headers: authA() });
    assert(after.body.data.messagesRejected > before.body.data.messagesRejected,
        `messagesRejected did not move: ${before.body.data.messagesRejected} → ${after.body.data.messagesRejected}`);
    assert(after.body.data.messagesIn > before.body.data.messagesIn, 'messagesIn did not move');
    assert(after.body.data.peakConcurrentPeers >= 3, `peakConcurrentPeers: ${after.body.data.peakConcurrentPeers}`);
    flood.close();
    await bob.waitFor('peer-left', m => m.peerId === floodJoined.peerId);
});

await test('error ROOM_FULL — the ceiling is enforced on the join, not on the create', async () => {
    const { body } = await createRoom({ app_type: 'duel', name: 'rt-full', max_peers: 1 });
    const smallRoom = body.data.id;
    assert(body.data.max_peers === 1, `max_peers: ${body.data.max_peers}`);
    const first = await Sock.open(`room=${smallRoom}&nick=one`);
    await first.waitFor('joined');
    const second = await Sock.open(`room=${smallRoom}&nick=two`);
    const err = await second.waitFor('error');
    assert(err.code === 'ROOM_FULL', `code: ${err.code}`);
    second.close();

    // …and the room deletes itself when its last peer goes.
    first.close();
    for (let i = 0; i < 40 && (await json(`/v1/realtime/rooms/${smallRoom}`)).status !== 404; i++) await sleep(50);
    const gone = await json(`/v1/realtime/rooms/${smallRoom}`);
    assert(gone.status === 404, `an emptied room must delete itself, got ${gone.status}`);
});

// ─── Phase 4: Closing a room ───
console.log('\nPhase 4 — Closing a room');

await test('DELETE /v1/realtime/rooms/:roomId — refused to a stranger, unknown room, and no credential', async () => {
    const cross = await json(`/v1/realtime/rooms/${publicRoomId}`, { method: 'DELETE', headers: authB() });
    assert(cross.status === 403, `owner B closing owner A's room must be 403, got ${cross.status}`);
    assert(cross.body.error?.code === 'FORBIDDEN', `code: ${cross.body.error?.code}`);
    const alive = await json(`/v1/realtime/rooms/${publicRoomId}`);
    assert(alive.status === 200, 'the refusal must not have closed the room anyway');

    const missing = await json('/v1/realtime/rooms/00000000-0000-4000-8000-000000000000', { method: 'DELETE', headers: authA() });
    assert(missing.status === 404, `unknown room: ${missing.status}`);
    const anon = await json(`/v1/realtime/rooms/${publicRoomId}`, { method: 'DELETE' });
    assert(anon.status === 401, `unauthenticated delete: ${anon.status}`);
});

await test('DELETE /v1/realtime/rooms/:roomId — the creator closes it and every socket is told why', async () => {
    const { status, body } = await json(`/v1/realtime/rooms/${publicRoomId}`, { method: 'DELETE', headers: authA() });
    assert(status === 200 && body.data.deleted === true, `delete: ${status} ${JSON.stringify(body)}`);
    const err = await alice.waitFor('error');
    assert(err.code === 'ROOM_CLOSED', `alice: ${err.code}`);
    const errB = await bob.waitFor('error');
    assert(errB.code === 'ROOM_CLOSED', `bob: ${errB.code}`);
    await alice.waitClosed();
    await bob.waitClosed();
    const gone = await json(`/v1/realtime/rooms/${publicRoomId}`);
    assert(gone.status === 404, `the room must be gone, got ${gone.status}`);
    const stats = await json('/v1/realtime/stats', { headers: authA() });
    assert(stats.body.data.roomsClosed >= 1, `roomsClosed: ${stats.body.data.roomsClosed}`);
});

// ─── Phase 5: echat, the anonymous door ───
//
// The per-IP limit is 10 upgrades a minute and does not reset inside this run, so the happy paths
// come first and the 429 is provoked last.
console.log('\nPhase 5 — echat');

const echatRoom = `rt-echat-${Date.now().toString(36)}`;

await test('echat — refused while the flag is off, before the rate limiter is even consulted', async () => {
    const status = await upgradeStatus(`echat=1&room=${echatRoom}`);
    assert(status === 403, `expected 403 while echat.anonymous is false, got ${status}`);
});

await test('PUT /v1/admin/config — a non-operator cannot open the anonymous door', async () => {
    const { status } = await json('/v1/admin/config', {
        method: 'PUT',
        headers: authB(),
        body: JSON.stringify({ changes: [{ path: 'echat.anonymous', value: true }] }),
    });
    assert(status === 403, `owner B flipping echat.anonymous must be 403, got ${status}`);
    const still = await upgradeStatus(`echat=1&room=${echatRoom}`);
    assert(still === 403, `the door must still be shut, got ${still}`);
});

await test('echat — with the flag on, an anonymous socket joins a room named by the URL', async () => {
    await setConfig('echat.anonymous', true);
    const one = await Sock.open(`echat=1&room=${echatRoom}`);
    const joined = await one.waitFor('joined');
    chatRoomId = joined.roomId;
    assert(typeof chatRoomId === 'string', 'joined carries the room id');
    const meta = await one.waitFor('room-meta');
    assert(meta.room === echatRoom, `the room keeps its name: ${meta.room}`);

    const two = await Sock.open(`echat=1&room=${echatRoom}`);
    await two.waitFor('joined');
    const participant = await one.waitFor('participant', m => m.action === 'join');
    assert(participant.count === 2, `count: ${participant.count}`);
    assert(participant.name.startsWith('anon-'), `an anonymous joiner gets a generated nick: ${participant.name}`);

    // The SAME name resolves to the SAME room rather than making a second one.
    const listed = await json('/v1/realtime/rooms');
    assert(!listed.body.data.rooms.some((r: any) => r.id === chatRoomId), 'an echat room is private and must not be listed');
    const detail = await json(`/v1/realtime/rooms/${chatRoomId}`);
    assert(detail.body.data.peer_count === 2, `both sockets are in one room: ${detail.body.data.peer_count}`);
    assert(detail.body.data.app_type === 'echat', `app_type: ${detail.body.data.app_type}`);
    assert(detail.body.data.created_by === 'echat-anonymous', `created_by: ${detail.body.data.created_by}`);

    two.send({ type: 'chat', payload: 'ping' });
    const got = await one.waitFor('chat');
    assert(got.payload === 'ping', `chat: ${JSON.stringify(got)}`);
    one.close();
    two.close();
});

await test('echat — a room name outside [a-zA-Z0-9-]{1,64} is refused on the upgrade', async () => {
    assert(await upgradeStatus('echat=1&room=bad_name') === 400, 'underscore must be refused');
    assert(await upgradeStatus('echat=1&room=') === 400, 'an empty name must be refused');
});

// ─── Phase 6: The room ceiling ───
console.log('\nPhase 6 — The room ceiling');

await test('the node refuses a new room past its ceiling, on both doors', async () => {
    const stats = await json('/v1/realtime/stats', { headers: authA() });
    const live = Math.max(1, stats.body.data.rooms);
    await setConfig('realtime.max_rooms', live);
    try {
        const { status, body } = await createRoom({ app_type: 'whiteboard', name: 'rt-over-limit' });
        assert(status === 429, `POST past the ceiling must be 429, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'QUOTA_EXCEEDED', `code: ${body.error?.code}`);
        const echat = await upgradeStatus(`echat=1&room=rt-echat-over-${Date.now().toString(36)}`);
        assert(echat === 503, `an echat room past the ceiling must be 503, got ${echat}`);
    } finally {
        await setConfig('realtime.max_rooms', 100);
    }
});

await test('echat — the eleventh upgrade from one address in a minute is refused', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
        last = await upgradeStatus(`echat=1&room=${echatRoom}`);
        if (last === 429) break;
    }
    assert(last === 429, `the per-IP limit never fired: last status ${last}`);
});

await test('echat — closing the flag shuts the door again', async () => {
    await setConfig('echat.anonymous', false);
    const status = await upgradeStatus(`echat=1&room=${echatRoom}`);
    assert(status === 403, `expected 403 after closing the flag, got ${status}`);
});

// ─── Phase 7: Federated discovery ───
console.log('\nPhase 7 — Federated discovery');

const peerNodeId = `rt-peer-${Date.now().toString(36)}`;
const peerQueries: string[] = [];

await test('GET /v1/realtime/federated-rooms — an active peer\'s rooms are fetched and tagged with their origin', async () => {
    fakePeer = createServer((req, res) => {
        peerQueries.push(req.url ?? '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            data: { rooms: [{ id: 'remote-room-1', app_type: 'whiteboard', name: 'over-there', peer_count: 3 }], total: 1 },
        }));
    });
    await new Promise<void>(resolve => fakePeer!.listen(0, '127.0.0.1', resolve));
    const peerUrl = `http://127.0.0.1:${(fakePeer!.address() as AddressInfo).port}`;

    const add = await json('/v1/federation/peers', {
        method: 'POST',
        headers: authA(),
        body: JSON.stringify({ node_id: peerNodeId, url: peerUrl, public_key: randomBytes(32).toString('base64') }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);
    const activate = await json(`/v1/federation/peers/${peerNodeId}`, {
        method: 'PUT',
        headers: authA(),
        body: JSON.stringify({ status: 'active' }),
    });
    assert(activate.body?.data?.status === 'active', `activate: ${JSON.stringify(activate.body)}`);

    await createRoom({ app_type: 'whiteboard', name: 'rt-local-for-federation' });
    const { status, body } = await json('/v1/realtime/federated-rooms?app_type=whiteboard');
    assert(status === 200, `status ${status}`);
    assert(body.data.note === undefined, 'the "no peers" note must be gone once a peer is active');
    assert(body.data.remote_count === 1, `remote_count: ${body.data.remote_count}`);
    assert(body.data.local_count >= 1, `local_count: ${body.data.local_count}`);
    assert(body.data.total === body.data.local_count + body.data.remote_count, 'total is local + remote');
    const remote = body.data.rooms.find((r: any) => r.id === 'remote-room-1');
    assert(remote !== undefined, `the remote room is missing: ${JSON.stringify(body.data.rooms.map((r: any) => r.id))}`);
    assert(remote.origin_node === peerUrl, `origin_node: ${remote.origin_node}`);
    const local = body.data.rooms.find((r: any) => r.name === 'rt-local-for-federation');
    assert(typeof local?.origin_node === 'string', `a local room is tagged with this node too: ${JSON.stringify(local)}`);
    assert(peerQueries.some(q => q.includes('/v1/realtime/rooms') && q.includes('app_type=whiteboard')),
        `the filter must travel to the peer: ${JSON.stringify(peerQueries)}`);
});

await test('GET /v1/realtime/federated-rooms — a peer that answers nothing costs the local list nothing', async () => {
    await new Promise<void>(resolve => { fakePeer!.close(() => resolve()); });
    fakePeer = null;
    const { status, body } = await json('/v1/realtime/federated-rooms');
    assert(status === 200, `status ${status}`);
    assert(body.data.remote_count === 0, `a dead peer must contribute nothing: ${body.data.remote_count}`);
    assert(body.data.local_count >= 1, `the local rooms must still be there: ${body.data.local_count}`);
    // Put the peer back where it cannot be reached for, so nothing else in the run tries it.
    await json(`/v1/federation/peers/${peerNodeId}`, {
        method: 'PUT', headers: authA(), body: JSON.stringify({ status: 'pending' }),
    });
});

// ─── Phase 8: The federation relay ───
console.log('\nPhase 8 — The federation relay');

let relayLocalId = '';
let relayRemoteId = '';

await test('POST /v1/realtime/relay — refused without the four fields, on an unknown room, and to a non-operator', async () => {
    const local = await createRoom({ app_type: 'whiteboard', name: 'rt-relay-local' });
    relayLocalId = local.body.data.id;
    const remote = await createRoom({ app_type: 'whiteboard', name: 'rt-relay-remote' });
    relayRemoteId = remote.body.data.id;

    const short = await json('/v1/realtime/relay', {
        method: 'POST', headers: authA(), body: JSON.stringify({ local_room_id: relayLocalId }),
    });
    assert(short.status === 400, `a partial relay request must be 400, got ${short.status}`);

    const unknown = await json('/v1/realtime/relay', {
        method: 'POST',
        headers: authA(),
        body: JSON.stringify({
            local_room_id: '00000000-0000-4000-8000-000000000000',
            remote_node_url: BASE, remote_room_id: relayRemoteId, token: ownerA.token,
        }),
    });
    assert(unknown.status === 404, `an unknown local room must be 404, got ${unknown.status}`);

    const b = await json('/v1/realtime/relay', {
        method: 'POST',
        headers: authB(),
        body: JSON.stringify({
            local_room_id: relayLocalId, remote_node_url: BASE,
            remote_room_id: relayRemoteId, token: ownerB.token,
        }),
    });
    assert(b.status === 403, `a non-operator opening a relay must be 403, got ${b.status}`);
});

await test('POST /v1/realtime/relay — a broadcast in the remote room arrives in the local one, marked as relayed', async () => {
    const listener = await Sock.open(`room=${relayLocalId}&nick=listener`);
    await listener.waitFor('joined');
    const sender = await Sock.open(`room=${relayRemoteId}&nick=sender`);
    const senderJoined = await sender.waitFor('joined');

    const { status, body } = await json('/v1/realtime/relay', {
        method: 'POST',
        headers: authA(),
        body: JSON.stringify({
            local_room_id: relayLocalId, remote_node_url: BASE,
            remote_room_id: relayRemoteId, token: ownerA.token,
        }),
    });
    assert(status === 200 && body.data.status === 'connecting', `relay: ${status} ${JSON.stringify(body)}`);

    // The relay socket joins the remote room as an ordinary peer; wait until it is there.
    let peerCount = 0;
    for (let i = 0; i < 60; i++) {
        peerCount = (await json(`/v1/realtime/rooms/${relayRemoteId}`)).body.data.peer_count;
        if (peerCount >= 2) break;
        await sleep(50);
    }
    assert(peerCount >= 2, `the relay never joined the remote room: peer_count ${peerCount}`);
    await sender.waitFor('peer-joined');

    sender.send({ type: 'broadcast', payload: { across: 'the-relay' } });
    const got = await listener.waitFor('broadcast');
    assert(got.from === `relay:${senderJoined.peerId}`, `a relayed frame is marked as such: ${got.from}`);
    assert((got.payload as any).across === 'the-relay', `payload: ${JSON.stringify(got.payload)}`);

    // A second POST for the same pair is idempotent rather than a second socket.
    const again = await json('/v1/realtime/relay', {
        method: 'POST',
        headers: authA(),
        body: JSON.stringify({
            local_room_id: relayLocalId, remote_node_url: BASE,
            remote_room_id: relayRemoteId, token: ownerA.token,
        }),
    });
    assert(again.status === 200, `re-connecting the same relay: ${again.status}`);
    const still = (await json(`/v1/realtime/rooms/${relayRemoteId}`)).body.data.peer_count;
    assert(still === peerCount, `a repeat request opened another socket: ${peerCount} → ${still}`);

    // …and the disconnect actually stops the traffic.
    const del = await json('/v1/realtime/relay', {
        method: 'DELETE',
        headers: authA(),
        body: JSON.stringify({ local_room_id: relayLocalId, remote_room_id: relayRemoteId }),
    });
    assert(del.status === 200 && del.body.data.status === 'disconnected', `disconnect: ${del.status}`);
    for (let i = 0; i < 60; i++) {
        if ((await json(`/v1/realtime/rooms/${relayRemoteId}`)).body.data.peer_count === 1) break;
        await sleep(50);
    }
    sender.send({ type: 'broadcast', payload: { across: 'nothing-now' } });
    await listener.expectNone('broadcast');

    listener.close();
    sender.close();
});

await test('DELETE /v1/realtime/relay — refused without both room ids, and to a non-operator', async () => {
    const short = await json('/v1/realtime/relay', {
        method: 'DELETE', headers: authA(), body: JSON.stringify({ local_room_id: relayLocalId }),
    });
    assert(short.status === 400, `a partial disconnect must be 400, got ${short.status}`);
    const b = await json('/v1/realtime/relay', {
        method: 'DELETE',
        headers: authB(),
        body: JSON.stringify({ local_room_id: relayLocalId, remote_room_id: relayRemoteId }),
    });
    assert(b.status === 403, `a non-operator disconnecting a relay must be 403, got ${b.status}`);
});

// ─── Phase 9: The idle reaper ───
//
// The reaper runs on a hardcoded 60-second timer, so this is the last thing the suite does and it is
// the only slow test in it. The idle window is shortened to a second for the duration.
console.log('\nPhase 9 — The idle reaper');

await test('an empty room nobody joins is reaped once it passes the idle window', async () => {
    await setConfig('realtime.room_idle_timeout_ms', 1000);
    try {
        const { body } = await createRoom({ app_type: 'whiteboard', name: 'rt-idle' });
        const idleRoom = body.data.id;
        let status = 200;
        for (let i = 0; i < 140; i++) {
            status = (await json(`/v1/realtime/rooms/${idleRoom}`)).status;
            if (status === 404) break;
            await sleep(500);
        }
        assert(status === 404, `an idle room must be reaped within one sweep of the 60s timer, still ${status}`);
    } finally {
        await setConfig('realtime.room_idle_timeout_ms', 3600000);
    }
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('cleanup — sockets closed, rooms gone, owners deleted', async () => {
    for (const s of openSockets) s.close();
    if (fakePeer) await new Promise<void>(resolve => { fakePeer!.close(() => resolve()); });
    const rooms = await json('/v1/admin/realtime', { headers: authA() });
    for (const r of rooms.body.data.rooms ?? []) {
        await json(`/v1/realtime/rooms/${r.id}`, { method: 'DELETE', headers: authA() });
    }
    for (const o of [ownerB, ownerA]) {
        await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${o.token}` } });
    }
    assert(true, 'cleanup ran');
});

// ─── Summary ───
console.log(`\nRealtime Rooms E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
