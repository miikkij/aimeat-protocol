/**
 * @file e2e-notifications.ts
 * @description E2E for the notification inbox WRITE surface (POST /v1/notifications): an owner (or
 *   a scoped app/agent) notifies their OWN owner — the record lands in the bell inbox with a
 *   deep link. Covers: create → list, link/title/type validation, the scope gate (an agent token
 *   without notifications:send gets 403), and mark-read.
 * @version-history
 *   v1.0.0 — 2026-07-02 — Initial: self-notify create/validate/scope-gate/read flow.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=notifications

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `notif${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Notif E2E', password: 'Notif1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Notifications (self-notify) E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;

await test('Setup owner A', async () => { A = await setupOwner('a'); });

await test('1. Owner creates a notification with a deep link', async () => {
    const r = await json('/v1/notifications', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ title: 'Report ready', body: 'Q2 numbers are in.', link: '/v1/profile#inbox/conv-123', type: 'report' }),
    });
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.created === true, 'created flag');
    assert(r.body.data.link === '/v1/profile#inbox/conv-123', `echoes link, got ${r.body.data.link}`);
});

await test('2. The notification shows up in the bell inbox (unread, with link + type)', async () => {
    const r = await json('/v1/notifications', { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    const n = (r.body.data.notifications || []).find((x: any) => x.title === 'Report ready');
    assert(!!n, 'notification listed');
    assert(n.link === '/v1/profile#inbox/conv-123', 'link stored');
    assert(n.type === 'report', 'type stored');
    assert(n.read === false, 'starts unread');
    assert(r.body.data.unread >= 1, 'unread count reflects it');
});

await test('3. Validation: missing title → 400', async () => {
    const r = await json('/v1/notifications', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ body: 'no title' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('4. Validation: absolute-URL link → 400 (same-node paths only)', async () => {
    const r = await json('/v1/notifications', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'x', link: 'https://evil.example/phish' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    const r2 = await json('/v1/notifications', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'x', link: '//evil.example/phish' }) });
    assert(r2.status === 400, `expected 400 for protocol-relative, got ${r2.status}`);
});

await test('5. Agent token WITHOUT notifications:send scope → 403', async () => {
    const anon = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
    assert(anon.status === 200, `anonymous token ${anon.status} (AIMEAT_ANONYMOUS_MODE must be on in the test env)`);
    const r = await json('/v1/notifications', { method: 'POST', headers: auth(anon.body.data.token), body: JSON.stringify({ title: 'sneaky' }) });
    assert(r.status === 403, `expected 403 SCOPE_DENIED, got ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('6. Unauthenticated → 401', async () => {
    const r = await json('/v1/notifications', { method: 'POST', body: JSON.stringify({ title: 'nope' }) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('7. Mark all read clears the unread count', async () => {
    const r = await json('/v1/notifications/read', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ all: true }) });
    assert(r.status === 200 && r.body.data.marked >= 1, `read ${r.status}, marked ${r.body?.data?.marked}`);
    const list = await json('/v1/notifications', { headers: auth(A.token) });
    assert(list.body.data.unread === 0, `unread should be 0, got ${list.body.data.unread}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
