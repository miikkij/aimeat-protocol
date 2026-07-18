/**
 * @file e2e-notifications.ts
 * @description E2E for the notification inbox WRITE surface (POST /v1/notifications): an owner (or
 *   a scoped app/agent) notifies their OWN owner — the record lands in the bell inbox with a
 *   deep link. Covers: create → list, link/title/type validation, the scope gate (an agent token
 *   without notifications:send gets 403), mark-read, the inline-actions security invariant (a
 *   client-supplied actions field is rejected), and the DM reply action end-to-end.
 * @version-history
 *   v1.0.0 — 2026-07-02 — Initial: self-notify create/validate/scope-gate/read flow.
 *   v1.1.0 — 2026-07-18 — Inline actions: reject client-supplied actions (403/400 invariant) +
 *     a delivered DM carries a reply action whose params drive a working POST /v1/messages reply.
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

await test('8. SECURITY: a client-supplied actions field is rejected (400)', async () => {
    // Inline reply/api actions execute with the recipient's authority — only trusted node emit code
    // may set them. Even the owner (who bypasses scope) cannot inject one via the public route.
    const r = await json('/v1/notifications', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ title: 'sneaky', actions: [{ id: 'x', label: 'Grant me', kind: 'api', method: 'POST', endpoint: '/v1/admin/mint', body: { amount: 1000000 } }] }),
    });
    assert(r.status === 400, `expected 400 rejecting actions, got ${r.status}: ${JSON.stringify(r.body.error)}`);
});

// ── Reply-action end-to-end: a delivered DM notification carries a reply action whose params drive
// a real POST /v1/messages reply that the original sender receives. ──
const ghiiOf = (name: string) => `${name}@${NODE_ID}`;
let B: Awaited<ReturnType<typeof setupOwner>>;
let replyAction: any = null;
let convId = '';

await test('9. Setup owner B + A→B first contact (request) then accept', async () => {
    B = await setupOwner('b');
    const send1 = await json('/v1/messages', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: ghiiOf(B.name), body: 'Hi B — first contact' }) });
    assert(send1.status === 201, `first send ${send1.status}: ${JSON.stringify(send1.body.error)}`);
    const accept = await json(`/v1/messages/requests/${encodeURIComponent(ghiiOf(A.name))}/accept`, { method: 'POST', headers: auth(B.token) });
    assert(accept.status === 200, `accept ${accept.status}: ${JSON.stringify(accept.body.error)}`);
});

await test('10. A delivered DM to B carries a reply action pointing back at A', async () => {
    const send2 = await json('/v1/messages', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ to: ghiiOf(B.name), body: 'Second message — now delivered' }) });
    assert(send2.status === 201, `second send ${send2.status}`);
    const list = await json('/v1/notifications', { headers: auth(B.token) });
    const dm = (list.body.data.notifications || []).find((n: any) => n.type === 'direct_message' && Array.isArray(n.actions) && n.actions.some((a: any) => a.kind === 'reply'));
    assert(!!dm, 'B has a direct_message notification with a reply action');
    replyAction = dm.actions.find((a: any) => a.kind === 'reply');
    assert(replyAction.to === ghiiOf(A.name), `reply action targets A, got ${replyAction.to}`);
    assert(typeof replyAction.conversationId === 'string' && replyAction.conversationId.length > 0, 'reply action carries conversationId');
    convId = replyAction.conversationId;
});

await test('11. Using the reply action, B replies and A receives it', async () => {
    const reply = await json('/v1/messages', {
        method: 'POST', headers: auth(B.token),
        body: JSON.stringify({ to: replyAction.to, body: 'Reply straight from the bell', conversation_id: replyAction.conversationId, reply_to: replyAction.replyTo, subject: replyAction.subject }),
    });
    assert(reply.status === 201, `reply send ${reply.status}: ${JSON.stringify(reply.body.error)}`);
    const inbox = await json('/v1/messages/inbox', { headers: auth(A.token) });
    const seen = (inbox.body.data.messages || []).some((m: any) => (m.body || '').includes('Reply straight from the bell'));
    assert(seen, 'A sees B\'s bell reply in the inbox');
});

// ── Regression: recent notifications must show even past the old 500-row global window ──
// The bell used to fetch `listAllMemory({prefix:'notif.', limit:500})` — the node's OLDEST
// 500 notification keys across ALL owners — then filter to the caller. Once >500 existed,
// every recent notification fell outside the window and the bell silently froze. This seeds
// one owner past that threshold and asserts their newest notification is still returned.
await test('12. REGRESSION: the newest notification is returned even with >500 total', async () => {
    const C = await setupOwner('c');
    const TARGET = 520; // comfortably over the old 500-row global cap
    const chunk = 20;
    for (let i = 0; i < TARGET; i += chunk) {
        await Promise.all(
            Array.from({ length: Math.min(chunk, TARGET - i) }, (_, j) =>
                json('/v1/notifications', {
                    method: 'POST', headers: auth(C.token),
                    body: JSON.stringify({ title: `bulk-${i + j}`, type: 'bulk' }),
                }),
            ),
        );
    }
    // A distinctly-titled newest notification created LAST — it has the highest key, so the
    // old global-oldest-500 window would clip it; the per-owner fix must surface it.
    const marker = `newest-${Date.now()}`;
    const created = await json('/v1/notifications', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ title: marker, type: 'bulk' }) });
    assert(created.status === 201, `create newest ${created.status}`);
    const list = await json('/v1/notifications', { headers: auth(C.token) });
    assert(list.status === 200, `list ${list.status}`);
    const notifs = list.body.data.notifications || [];
    assert(notifs.length > 0, 'list is non-empty');
    assert(notifs[0].title === marker, `newest-first ordering surfaces the marker; got top="${notifs[0]?.title}"`);
    assert(list.body.data.unread > 500, `unread reflects all of the owner's unread (>500), got ${list.body.data.unread}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
