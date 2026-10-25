/**
 * @file test/e2e-realtime-signed-in-only.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node set to signed-in content access, the realtime WebSocket upgrade admits the
 *   principals the REST content-access gate admits: the node's own accounts. A verified credential
 *   that is not a node account, here an anonymous session minted while the node was open, is refused
 *   401 SIGN_IN_REQUIRED (secaudit2026oct22, realtime-upgrade-signed-in-only-gate-bypass). An owner
 *   still joins by header and by ticket on the closed node, and on the open node the anonymous session
 *   joins as before.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-realtime-signed-in-only
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

/** The status of an upgrade and the code in X-AIMEAT-Error, read with an HTTP client (see e2e-realtime-rooms). */
function upgradeAnswer(query: string, headers: Record<string, string> = {}): Promise<{ status: number; code: string }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(`${BASE}/v1/realtime/ws?${query}`, {
            headers: {
                Connection: 'Upgrade', Upgrade: 'websocket',
                'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13',
                ...headers,
            },
        });
        const timer = setTimeout(() => { req.destroy(); reject(new Error('upgrade timed out')); }, 8000);
        req.on('response', res => { clearTimeout(timer); res.resume(); resolve({ status: res.statusCode ?? 0, code: String(res.headers['x-aimeat-error'] ?? '') }); });
        req.on('upgrade', (res, socket) => { clearTimeout(timer); socket.destroy(); resolve({ status: res.statusCode ?? 101, code: '' }); });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.end();
    });
}

console.log('\n=== The realtime upgrade on a node set to signed-in content access (secaudit2026oct22) ===\n');

const op = await registerOwner(BASE, `rtsio${Date.now().toString(36)}`);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const setAccess = (value: string) => json('/v1/admin/config', {
    method: 'PUT', headers: bearer(op.token), body: JSON.stringify({ changes: [{ path: 'visibility.content_access', value }] }),
});
let roomId = '';
let anonToken = '';
let holder: WebSocket | null = null;

await test('Setup: a room, and an anonymous session minted while the node is open', async () => {
    const room = await json('/v1/realtime/rooms', { method: 'POST', headers: bearer(op.token), body: JSON.stringify({ app_type: 'whiteboard', name: 'rt-signed-in-only' }) });
    assert(room.status === 201, `room: ${room.status} ${JSON.stringify(room.body)}`);
    roomId = room.body.data.room?.id ?? room.body.data.id;
    assert(roomId, `room id in ${JSON.stringify(room.body.data)}`);
    // The owner stays in the room for the whole suite: a room is deleted when its last peer leaves.
    holder = new WebSocket(`${BASE.replace(/^http/, 'ws')}/v1/realtime/ws?room=${roomId}&nick=holder`, { headers: bearer(op.token) });
    await new Promise<void>((resolve, reject) => { holder!.once('open', () => resolve()); holder!.once('error', reject); });
    const anon = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(anon.status === 200, `anonymous session (the suite needs anonymous mode on): ${anon.status} ${JSON.stringify(anon.body)}`);
    anonToken = anon.body.data.token;
    assert(anonToken, 'anonymous token');
});

await test('On the open node the anonymous session joins the room', async () => {
    const r = await upgradeAnswer(`room=${roomId}&nick=visitor`, bearer(anonToken));
    assert(r.status === 101, `expected 101, got ${r.status} ${r.code}`);
});

await test('FAILURE: a second owner, who is not the operator, cannot change the content access setting', async () => {
    const other = await registerOwner(BASE, `rtsix${Date.now().toString(36)}`);
    const r = await json('/v1/admin/config', {
        method: 'PUT', headers: bearer(other.token), body: JSON.stringify({ changes: [{ path: 'visibility.content_access', value: 'signed-in' }] }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await test('Setup: the node is set to signed-in content access', async () => {
    const r = await setAccess('signed-in');
    assert(r.status === 200, `content access: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await test('FAILURE: the anonymous session is refused 401 SIGN_IN_REQUIRED on the closed node', async () => {
    const r = await upgradeAnswer(`room=${roomId}&nick=visitor`, bearer(anonToken));
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(r.code === 'SIGN_IN_REQUIRED', `code: ${r.code}`);
});

await test('FAILURE: an upgrade with no credential is refused on the closed node', async () => {
    const r = await upgradeAnswer(`room=${roomId}&nick=nobody`);
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('The owner joins by header on the closed node', async () => {
    const r = await upgradeAnswer(`room=${roomId}&nick=owner`, bearer(op.token));
    assert(r.status === 101, `expected 101, got ${r.status} ${r.code}`);
});

await test('The owner joins by ticket on the closed node', async () => {
    const t = await json('/v1/ws/ticket', { method: 'POST', headers: bearer(op.token), body: JSON.stringify({ socket: 'realtime' }) });
    assert(t.status === 200, `ticket: ${t.status} ${JSON.stringify(t.body)}`);
    const r = await upgradeAnswer(`room=${roomId}&nick=owner2&ticket=${encodeURIComponent(t.body.data.ticket)}`);
    assert(r.status === 101, `expected 101, got ${r.status} ${r.code}`);
});

await test('Teardown: the node is open again, and the anonymous session joins as before', async () => {
    const r = await setAccess('open');
    assert(r.status === 200, `content access: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const again = await upgradeAnswer(`room=${roomId}&nick=visitor`, bearer(anonToken));
    assert(again.status === 101, `expected 101, got ${again.status} ${again.code}`);
});

holder?.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
