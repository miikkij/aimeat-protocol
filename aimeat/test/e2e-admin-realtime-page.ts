/**
 * @file e2e-admin-realtime-page.ts
 * @description E2E for the one read the Realtime page is folded from, and for the answer it could
 *   not get before: GET /v1/admin/realtime.
 *
 *   THE SWITCH IS AN ANSWER NOW. The route refused with 503 when realtime was off. The dashboard
 *   stores a rejected read as null, so a site with the feature switched off drew exactly what a
 *   quiet one draws — three zeros — and an operator could not tell them apart. The last phase boots
 *   a second node of its own with AIMEAT_REALTIME_ENABLED=false and holds the route to answering
 *   200 with enabled:false.
 *
 *   THE DOCUMENT COUNT IS PER ROOM. The page this replaces read `yjs_documents` off the response.
 *   Nothing has ever sent that key, so the figure was zero on every node in every state; the
 *   assertion below says the key is absent and the documents are in `rooms[].yjs_docs`.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-realtime-page

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
// A message built into a passing assert is still evaluated, so this has to survive `undefined`.
const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 300));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function call(base: string, path: string, opts: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const json = (path: string, opts: RequestInit = {}) => call(BASE, path, opts);

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function ownerToken(base: string, nodeId: string, name: string): Promise<string> {
    const reg = await call(base, '/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${short(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await call(base, '/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + nodeId + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${short(tok.body.error)}`);
    return tok.body.data.token as string;
}

console.log('\n=== AIMEAT Admin Realtime Page E2E ===\n');

const stamp = Date.now();
const opName = `rtop${stamp}`;
const otherName = `rtother${stamp}`;
const ROOM = `rt-page-probe-${stamp}`;

let opToken = '';
let otherToken = '';
let roomId = '';

await test('Setup: an operator, a second owner who is not one, and a room', async () => {
    opToken = await ownerToken(BASE, NODE_ID, opName);
    otherToken = await ownerToken(BASE, NODE_ID, otherName);

    const made = await json('/v1/realtime/rooms', {
        method: 'POST', headers: auth(opToken),
        body: JSON.stringify({ app_type: 'workspace-doc', name: ROOM, is_public: false, tags: ['probe'] }),
    });
    assert(made.status === 201, `create room: ${made.status} ${short(made.body)}`);
    roomId = made.body.data.id;
});

await test('An owner who is not an operator cannot read the overview the page is built on', async () => {
    const r = await json('/v1/admin/realtime', { headers: auth(otherToken) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('The overview says realtime is on, and carries all eight counters', async () => {
    const r = await json('/v1/admin/realtime', { headers: auth(opToken) });
    assert(r.status === 200, `status ${r.status}: ${short(r.body.error)}`);
    assert(r.body.data.enabled === true, `enabled: ${r.body.data.enabled}`);
    for (const k of ['rooms', 'peers', 'messagesIn', 'messagesOut', 'messagesRejected', 'roomsCreated', 'roomsClosed', 'peakConcurrentPeers']) {
        assert(typeof r.body.data.stats[k] === 'number', `stats.${k} is missing: the page prints all eight`);
    }
    assert(r.body.data.stats.roomsCreated >= 1, `roomsCreated should count the room just made: ${r.body.data.stats.roomsCreated}`);
});

await test('The three readings that turn a counter into a fact come with it', async () => {
    const { body } = await json('/v1/admin/realtime', { headers: auth(opToken) });
    // Without the uptime, every counter above reads as an all-time total. It is the window they cover.
    assert(typeof body.data.uptime_seconds === 'number' && body.data.uptime_seconds >= 0,
        `uptime_seconds: ${body.data.uptime_seconds}`);
    assert(typeof body.data.room_idle_timeout_ms === 'number' && body.data.room_idle_timeout_ms > 0,
        `room_idle_timeout_ms: ${body.data.room_idle_timeout_ms}`);
    assert(typeof body.data.ws_url === 'string' && /^wss?:\/\//.test(body.data.ws_url) && body.data.ws_url.endsWith('/v1/realtime/ws'),
        `ws_url should be the address a browser opens: ${body.data.ws_url}`);
});

await test('The documents are inside the room, and no node-wide list is sent', async () => {
    const { body } = await json('/v1/admin/realtime', { headers: auth(opToken) });
    assert(!('yjs_documents' in body.data),
        'the page that came before summed `yjs_documents`, which nothing sends; it must stay absent rather than appear empty');
    const room = body.data.rooms.find((r: any) => r.id === roomId);
    assert(!!room, `the room just made is not in the overview: ${short(body.data.rooms?.map((r: any) => r.name))}`);
    assert(Array.isArray(room.yjs_docs), 'a room reports its own documents');
    assert(room.peer_count === 0 && Array.isArray(room.peers), `a room nobody has joined has no peers: ${room.peer_count}`);
    for (const field of ['id', 'name', 'app_type', 'created_by', 'is_public', 'max_peers', 'tags', 'created_at', 'last_activity_at']) {
        assert(field in room, `a room has no ${field}: the page prints it`);
    }
    assert(body.data.total === body.data.rooms.length, 'total disagrees with the list');
});

await test('Closing the room takes it out of the overview and counts it closed', async () => {
    const before = await json('/v1/admin/realtime', { headers: auth(opToken) });
    const closedBefore = before.body.data.stats.roomsClosed;

    const gone = await json(`/v1/realtime/rooms/${roomId}`, { method: 'DELETE', headers: auth(opToken) });
    assert(gone.status === 200, `close room: ${gone.status} ${short(gone.body)}`);

    const after = await json('/v1/admin/realtime', { headers: auth(opToken) });
    assert(!after.body.data.rooms.some((r: any) => r.id === roomId), 'the closed room is still listed');
    assert(after.body.data.stats.roomsClosed === closedBefore + 1,
        `roomsClosed should move: ${closedBefore} → ${after.body.data.stats.roomsClosed}`);
});

// ─── Switched off: a node of its own, so nothing here touches the suite's database ───
await test('With realtime switched off the overview answers 200 and says so', async () => {
    process.env.AIMEAT_REALTIME_ENABLED = 'false';
    process.env.AIMEAT_STORAGE = 'memory';
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_SQLITE_PATH = ':memory:';
    delete process.env.DATABASE_URL;

    const { loadConfig } = await import('../src/config.js');
    const { createServer } = await import('../src/server.js');
    const { config } = loadConfig({});
    assert(config.realtimeEnabled === false, 'the second node should have realtime off');

    const { app } = await createServer(config);
    // Port 0: the operating system hands out one that is free, so this can never take a port some
    // other session claimed.
    const server: Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const offBase = `http://localhost:${(server.address() as AddressInfo).port}`;

    try {
        const token = await ownerToken(offBase, config.nodeId, `rtoff${stamp}`);
        const r = await call(offBase, '/v1/admin/realtime', { headers: auth(token) });
        assert(r.status === 200, `a read of a switched-off feature is still an answer: got ${r.status}`);
        assert(r.body.data.enabled === false, `enabled: ${r.body.data.enabled}`);
        assert(r.body.data.stats === null, `stats should be null rather than eight zeros: ${short(r.body.data.stats)}`);
        assert(Array.isArray(r.body.data.rooms) && r.body.data.rooms.length === 0, 'no rooms');
        assert(r.body.data.total === 0, `total: ${r.body.data.total}`);

        // The writes keep refusing: refusing to ACT is not the same as refusing to SAY.
        const made = await call(offBase, '/v1/realtime/rooms', {
            method: 'POST', headers: auth(token),
            body: JSON.stringify({ app_type: 'chat', name: 'should-not-open' }),
        });
        assert(made.status === 503, `creating a room with realtime off must still be 503, got ${made.status}`);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        delete process.env.AIMEAT_REALTIME_ENABLED;
    }
});

await test('Cleanup: the two owners this suite made are gone', async () => {
    for (const [name, token] of [[opName, opToken], [otherName, otherToken]] as const) {
        const r = await json(`/v1/owners/${name}`, { method: 'DELETE', headers: auth(token) });
        assert(r.status === 200 || r.status === 204, `delete ${name}: ${r.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
// Explicit, and not `if (failed)`: the switched-off phase boots a node of its own, and a node keeps
// timers running. Leaving the exit to an empty event loop leaves the suite hanging on a green run.
process.exit(failed > 0 ? 1 : 0);
