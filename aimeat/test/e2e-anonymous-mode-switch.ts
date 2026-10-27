/**
 * @file test/e2e-anonymous-mode-switch.ts
 * @description The operator switches anonymous mode off and on through the config endpoint, and the
 *   node does what the answer says, at once, with no restart (secaudit2026oct26,
 *   auth/node-auth.ts:isAnonymousMode:not-bound-to-live-config; decision 2026-10-27):
 *   - while the mode is on, the visitor's path works: POST /v1/auth/anonymous mints a token, the token
 *     writes and reads its own anonymous.* record, and a realtime room opens with no credential;
 *   - switched off, the answer is "applied" with no restart, no token is minted (403), a request with
 *     no credential gets no anonymous identity (the realtime upgrade answers 401), and a token minted
 *     before the switch stops working (401);
 *   - switched on again, the same paths work again, the earlier token included.
 *   Signed-in accounts see no change at any point.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-anonymous-mode-switch
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

/** The status of a realtime upgrade with no credential. */
function upgradeStatus(query: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(`${BASE}/v1/realtime/ws?${query}`, {
            headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' },
        });
        const timer = setTimeout(() => { req.destroy(); reject(new Error('upgrade timed out')); }, 8000);
        req.on('response', res => { clearTimeout(timer); res.resume(); resolve(res.statusCode ?? 0); });
        req.on('upgrade', (res, socket) => { clearTimeout(timer); socket.destroy(); resolve(res.statusCode ?? 101); });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.end();
    });
}

let operator = { name: '', token: '' };
let earlyToken = '';
const key = `anonymous.mode-switch-${Date.now()}`;
const asOperator = () => ({ Authorization: `Bearer ${operator.token}` });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setAnonymousMode(on: boolean) {
    return json('/v1/admin/config', { method: 'PUT', headers: asOperator(), body: JSON.stringify({ changes: [{ path: 'node.anonymous_mode', value: on }] }) });
}

/** A room of the operator's; a room deletes itself when its last peer leaves, so each probe gets its own. */
async function freshRoom(): Promise<string> {
    const room = await json('/v1/realtime/rooms', { method: 'POST', headers: asOperator(), body: JSON.stringify({ app_type: 'whiteboard', name: 'anon-switch' }) });
    assert(room.status === 201, `room: ${room.status} ${JSON.stringify(room.body)}`);
    return room.body.data.id;
}

/** What a visitor can do with the mode on: mint, write and read its own record, open a room with no credential. */
async function visitorPathWorks(token: string) {
    const w = await json('/v1/memory', { method: 'POST', headers: bearer(token), body: JSON.stringify({ key, value: { n: Date.now() }, visibility: 'private' }) });
    assert(w.status === 201 || w.status === 200, `write: ${w.status} ${JSON.stringify(w.body)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: bearer(token) });
    assert(r.status === 200, `read: ${r.status}`);
    const up = await upgradeStatus(`room=${await freshRoom()}&nick=visitor`);
    assert(up === 101, `a room opens with no credential: ${up}`);
}

console.log('\n=== AIMEAT Anonymous Mode Switch E2E ===\n');

await test('setup: the operator, and a room to open', async () => {
    const o = await registerOwner(BASE, `anonswitch${Date.now().toString(36)}`);
    operator = { name: o.name, token: o.token };
    assert(o.roles.includes('operator'), `the first owner is the operator: ${JSON.stringify(o.roles)}`);
});

await test('mode on: a visitor mints a token, writes and reads its own record, and opens a room', async () => {
    const boot = await json('/', { headers: { Accept: 'application/json' } });
    assert(boot.body?.node?.anonymous_mode === true || JSON.stringify(boot.body).includes('"anonymous_mode":true'), 'the node starts with anonymous mode on');
    const m = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(m.status === 200 && typeof m.body.data?.token === 'string', `mint: ${m.status}`);
    earlyToken = m.body.data.token;
    await visitorPathWorks(earlyToken);
});

await test('switched off: the answer is applied at once, with no restart', async () => {
    const r = await setAnonymousMode(false);
    assert(r.status === 200, `PUT: ${r.status} ${JSON.stringify(r.body)}`);
    const applied = (r.body.data?.applied ?? []) as any[];
    const row = applied.find(a => a.path === 'node.anonymous_mode');
    assert(row && row.new_value === false && row.applies !== 'restart', `applied: ${JSON.stringify(applied)}`);
});

await test('switched off: no token is minted', async () => {
    const m = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(m.status === 403, `mint after switch-off: ${m.status} ${JSON.stringify(m.body)}`);
});

await test('switched off: a request with no credential gets no anonymous identity', async () => {
    const up = await upgradeStatus(`room=${await freshRoom()}&nick=visitor`);
    assert(up === 401, `a room upgrade with no credential: ${up}`);
});

await test('switched off: a token minted before the switch stops working', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: bearer(earlyToken) });
    assert(r.status === 401, `read with the early token: ${r.status} ${JSON.stringify(r.body)}`);
    const w = await json('/v1/memory', { method: 'POST', headers: bearer(earlyToken), body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }) });
    assert(w.status === 401, `write with the early token: ${w.status}`);
});

await test('switched off: the operator and signed-in accounts see no change', async () => {
    const r = await json('/v1/memory', { method: 'POST', headers: asOperator(), body: JSON.stringify({ key: `mode-switch.owner-${Date.now()}`, value: { ok: true } }) });
    assert(r.status === 201 || r.status === 200, `owner write: ${r.status}`);
    const roomId = await freshRoom();
    const room = await json(`/v1/realtime/rooms/${roomId}`, { headers: asOperator() });
    assert(room.status === 200, `owner reads the room: ${room.status}`);
    await json(`/v1/realtime/rooms/${roomId}`, { method: 'DELETE', headers: asOperator() });
});

await test('switched on again: the visitor path works again, the earlier token included', async () => {
    const r = await setAnonymousMode(true);
    assert(r.status === 200, `PUT: ${r.status} ${JSON.stringify(r.body)}`);
    const m = await json('/v1/auth/anonymous', { method: 'POST' });
    assert(m.status === 200, `mint: ${m.status}`);
    await visitorPathWorks(m.body.data.token);
    await visitorPathWorks(earlyToken);
});

console.log(`\nAnonymous Mode Switch E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
