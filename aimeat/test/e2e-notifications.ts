/**
 * @file e2e-notifications.ts
 * @description E2E for the notification inbox WRITE surface (POST /v1/notifications): an owner (or
 *   a scoped app/agent) notifies their OWN owner — the record lands in the bell inbox with a
 *   deep link. Covers: create → list, link/title/type validation, the scope gate (an agent token
 *   without notifications:send gets 403), mark-read, the inline-actions security invariant (a
 *   client-supplied actions field is rejected), and the DM reply action end-to-end.
 * @version-history
 *   v1.4.0 — 2026-09-25 — A notification's buttons are the node's own (tests 24–30). No principal
 *     writes a `notif.` record on any memory door (the agent writing as its owner, the owner, an app
 *     grant), a record planted straight into storage is served without its off-node buttons, and the
 *     node's own join request, invitation and workspace access request still carry buttons that run.
 *   v1.3.0 — 2026-08-30 — The Notifications page in the poster face: rows carry source and group,
 *     the settings record (defaults, normalisation, owner only), a muted group drops before the
 *     write, the senders read, localized words on a message, the devices list (tests 15–20).
 *   v1.0.0 — 2026-07-02 — Initial: self-notify create/validate/scope-gate/read flow.
 *   v1.1.0 — 2026-07-18 — Inline actions: reject client-supplied actions (403/400 invariant) +
 *     a delivered DM carries a reply action whose params drive a working POST /v1/messages reply.
 *   v1.2.0 — 2026-07-21 — Reading a thread dismisses its bell notifications (happy path) + the delete
 *     is owner-scoped (B reading its copy leaves A's notification for the same conversation intact).
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
import { createHash, randomBytes } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { serverSqlitePath, serverDbUrl } from './helpers/server-db.js';
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

// ── Reading a thread dismisses its header-bell notifications (a seen message stops nagging). ──
await test('12. Reading the conversation clears B\'s bell notifications for that thread', async () => {
    const linkDelivered = `/v1/profile#inbox/${convId}`;
    const linkRequest = `/v1/profile#inbox/req:${convId}`;
    const forConv = (list: any) => (list.body.data.notifications || []).filter((n: any) => n.link === linkDelivered || n.link === linkRequest);
    const before = await json('/v1/notifications', { headers: auth(B.token) });
    assert(forConv(before).length > 0, 'B has bell notification(s) deep-linking to the conversation before reading');
    const read = await json(`/v1/messages/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST', headers: auth(B.token) });
    assert(read.status === 200, `read ${read.status}: ${JSON.stringify(read.body.error)}`);
    const after = await json('/v1/notifications', { headers: auth(B.token) });
    assert(forConv(after).length === 0, `the thread's bell notifications are gone after reading (still ${forConv(after).length})`);
});

await test('13. Dismiss is owner-scoped: A\'s own notification for the same thread is untouched', async () => {
    // A received B's reply (test 11) → A holds its OWN bell notification for this conversation. B reading
    // its copy must not touch A's inbox (owner-scoped delete).
    const link = `/v1/profile#inbox/${convId}`;
    const aList = await json('/v1/notifications', { headers: auth(A.token) });
    const aStill = (aList.body.data.notifications || []).some((n: any) => n.link === link);
    assert(aStill, 'A still has its notification for the thread (B reading did not touch A\'s inbox)');
});

// ── Regression: recent notifications must show even past the old 500-row global window ──
// The bell used to fetch `listAllMemory({prefix:'notif.', limit:500})` — the node's OLDEST
// 500 notification keys across ALL owners — then filter to the caller. Once >500 existed,
// every recent notification fell outside the window and the bell silently froze. This seeds
// one owner past that threshold and asserts their newest notification is still returned.
await test('14. REGRESSION: the newest notification is returned even with >500 total', async () => {
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


// -- The Notifications page in the poster face (2026-08-30): sources, settings, mute, senders, devices --

await test('15. Every row says who sent it and which group it is in; ?unread=1&limit=1 narrows', async () => {
    const r = await json('/v1/notifications?unread=1&limit=1', { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    const list = r.body.data.notifications || [];
    assert(list.length === 1, `limit honoured, got ${list.length}`);
    assert(typeof r.body.data.total === 'number', 'total reported');
    assert(list[0].source && typeof list[0].source.kind === 'string' && typeof list[0].group === 'string', `source and group present: ${JSON.stringify(list[0].source)} ${list[0].group}`);
    const all = (await json('/v1/notifications?limit=200', { headers: auth(A.token) })).body.data.notifications || [];
    const mine = all.find((x: any) => x.title === 'Report ready');
    assert(mine && mine.source.kind === 'owner' && mine.group === 'other', `an owner-created row is sourced to the owner: ${JSON.stringify([mine?.source, mine?.group])}`);
});

await test('16. Settings: defaults when nothing was written; PUT keeps what was sent and drops the rest; not for an agent', async () => {
    const d = await json('/v1/notifications/settings', { headers: auth(A.token) });
    assert(d.status === 200 && d.body.data.settings.throttleMinutes === 10 && d.body.data.settings.quiet === null, `defaults: ${JSON.stringify(d.body.data.settings)}`);
    const put = await json('/v1/notifications/settings', {
        method: 'PUT', headers: auth(A.token),
        body: JSON.stringify({ settings: { groups: { workflows: { push: false } }, senders: { 'app:x/y.html': { muted: true } }, quiet: { start: '22:00', end: '07:00', tz: 'Europe/Helsinki', breakthrough: ['messages', 'bogus'] }, throttleMinutes: 999, emailDigest: { enabled: true, afterHours: 8 }, lastDigestAt: '2020-01-01T00:00:00Z', evil: 1 } }),
    });
    assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body.error)}`);
    const s = put.body.data.settings;
    assert(s.groups.workflows.push === false && s.senders['app:x/y.html'].muted === true, 'decisions kept');
    assert(s.quiet.tz === 'Europe/Helsinki' && s.quiet.breakthrough.length === 1 && s.quiet.breakthrough[0] === 'messages', `quiet normalised: ${JSON.stringify(s.quiet)}`);
    assert(s.throttleMinutes === 120 && s.emailDigest.enabled === true && s.lastDigestAt === null && s.evil === undefined, `clamped and cleaned: ${JSON.stringify(s)}`);
    const anon = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
    const denied = await json('/v1/notifications/settings', { method: 'PUT', headers: auth(anon.body.data.token), body: JSON.stringify({ settings: {} }) });
    assert(denied.status === 403 || denied.status === 401, `an agent cannot write the owner's settings: ${denied.status}`);
});

await test('17. A muted group drops the notification before it is written', async () => {
    const before = (await json('/v1/notifications', { headers: auth(A.token) })).body.data.total;
    const mute = await json('/v1/notifications/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ settings: { groups: { other: { muted: true } } } }) });
    assert(mute.status === 200, `mute ${mute.status}`);
    const r = await json('/v1/notifications', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'you will not see this' }) });
    assert(r.status === 201 && r.body.data.muted === true, `created but muted: ${JSON.stringify(r.body.data)}`);
    const after = (await json('/v1/notifications', { headers: auth(A.token) })).body.data.total;
    assert(after === before, `nothing stored: ${before} → ${after}`);
    const unmute = await json('/v1/notifications/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ settings: {} }) });
    assert(unmute.status === 200, 'unmute');
    const r2 = await json('/v1/notifications', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'seen again' }) });
    assert(r2.status === 201 && r2.body.data.muted === false, 'delivered again');
});

await test('18. Senders: the six groups with counts, and nobody else for an owner with no apps or agents', async () => {
    const r = await json('/v1/notifications/senders', { headers: auth(A.token) });
    assert(r.status === 200, `senders ${r.status}: ${JSON.stringify(r.body.error)}`);
    const { groups, senders } = r.body.data;
    assert(Array.isArray(groups) && groups.length === 6, `six groups: ${groups?.length}`);
    const other = groups.find((g: any) => g.group === 'other');
    assert(other && other.count >= 1 && other.prefs.push === true, `owner's own notifications counted under "other": ${JSON.stringify(other)}`);
    assert(Array.isArray(senders) && senders.length === 0, `no app, agent or extension has notified A: ${JSON.stringify(senders)}`);
});

await test('19. A delivered message carries the words to say it in the reader\'s language, and is the node\'s own', async () => {
    const r = await json('/v1/notifications', { headers: auth(B.token) });
    assert(r.status === 200, `B list ${r.status}`);
    const n = (r.body.data.notifications || []).find((x: any) => x.type === 'direct_message' || x.type === 'direct_message_request');
    assert(!!n, 'B has a message notification');
    assert(n.i18n && (n.i18n.key === 'direct_message' || n.i18n.key === 'direct_message_request') && n.i18n.vars.who, `i18n key and vars: ${JSON.stringify(n.i18n)}`);
    assert(n.source.kind === 'aimeat' && n.group === 'messages', `source and group: ${JSON.stringify([n.source, n.group])}`);
});

await test('20. Devices: the owner\'s push subscriptions list is theirs and empty here', async () => {
    const r = await json('/v1/push/subscriptions', { headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.total === 0 && Array.isArray(r.body.data.subscriptions), `devices: ${r.status} ${JSON.stringify(r.body.data)}`);
    const anon = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
    const denied = await json('/v1/push/subscriptions', { headers: auth(anon.body.data.token) });
    assert(denied.status === 403, `push:manage is needed: ${denied.status}`);
});


// -- The Email page in the poster face (2026-08-30): the emails that are the owner's to switch off,
//    the mail log, the chat prompt --

await test('21. Settings carry the email choices: workflowEnd defaults on, nudge stays undecided until decided', async () => {
    const d = await json('/v1/notifications/settings', { headers: auth(A.token) });
    assert(d.status === 200 && d.body.data.settings.email.workflowEnd === true && d.body.data.settings.email.nudge === undefined, `defaults: ${JSON.stringify(d.body.data.settings.email)}`);
    const put = await json('/v1/notifications/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ settings: { email: { workflowEnd: false, nudge: true, bogus: 1 } } }) });
    assert(put.status === 200, `put ${put.status}`);
    const e = put.body.data.settings.email;
    assert(e.workflowEnd === false && e.nudge === true && e.bogus === undefined, `kept and cleaned: ${JSON.stringify(e)}`);
    const back = await json('/v1/notifications/settings', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ settings: { email: { workflowEnd: true } } }) });
    assert(back.body.data.settings.email.nudge === undefined, 'nudge undecided again when left out');
});

await test('22. The mail log is the owner\'s own, empty on a node that sends no mail; an agent gets nothing', async () => {
    const r = await json('/v1/notifications/mail', { headers: auth(A.token) });
    assert(r.status === 200 && Array.isArray(r.body.data.entries) && r.body.data.total === r.body.data.entries.length, `mail log: ${r.status} ${JSON.stringify(r.body.data)}`);
    const anon = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
    const denied = await json('/v1/notifications/mail', { headers: auth(anon.body.data.token) });
    assert(denied.status === 403 || denied.status === 401, `owner only: ${denied.status}`);
});

await test('23. The email chat prompt is served with the owner\'s name', async () => {
    const r = await json('/v1/templates/email-mcp', { headers: auth(A.token) });
    assert(r.status === 200 && r.body.data.prompt.includes(A.name) && r.body.data.prompt.includes('aimeat_mail_send'), `template ${r.status}`);
});


// -- A notification's buttons are the node's own (2026-09-25). The owner's browser runs an `api`
//    button with the owner's session: the bell, the Notifications page and a push click. So only the
//    node writes a notification record, and it serves a button only when it points at its own API. --

const STEAL = { id: 'steal', label: 'Open', kind: 'api', method: 'POST', endpoint: 'https://evil.example/steal' };
const planted = (tag: string, actions: unknown[]) => ({
    id: `planted-${tag}-${Date.now()}`, type: 'custom', title: `Planted ${tag}`, body: '', link: '', read: false,
    createdAt: new Date().toISOString(), actions,
});
const plantedTitles = async (token: string) => ((await json('/v1/notifications?limit=200', { headers: auth(token) })).body.data.notifications || [])
    .filter((n: any) => typeof n.title === 'string' && n.title.startsWith('Planted '))
    .map((n: any) => n.title as string);

let agentName = '', agentToken = '', appToken = '';

await test('24. Setup: an agent of A that may write into A\'s namespace, and an app A granted memory:write', async () => {
    agentName = `notifbot${Date.now() % 100000}`;
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: agentName, owner: A.name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
    });
    assert(ag.status === 201, `register agent ${ag.status}: ${JSON.stringify(ag.body.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const p = await json(`/v1/agents/${agentName}/scopes`, {
        method: 'PATCH', headers: auth(A.token),
        body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:write-as-owner'] }),
    });
    assert(p.status === 200, `grant write-as-owner ${p.status}: ${JSON.stringify(p.body.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;

    const filename = `notif-probe-${Date.now() % 100000}.html`;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ filename, content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>').toString('base64'), name: 'Notif Probe', description: 'probe', category: 'utility' }),
    });
    assert(pub.status === 201, `publish app ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirect = 'http://localhost:9911/callback';
    const q = new URLSearchParams({ app: `${A.name}/${filename}`, response_type: 'code', scope: 'memory:read memory:write', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const loc = (await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' })).headers.get('location') ?? '';
    const rid = decodeURIComponent(/req=([^&]+)/.exec(loc)?.[1] ?? '');
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ request_id: rid }) });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const at = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
    assert(at.body.ok === true, `app token: ${JSON.stringify(at.body.error)}`);
    appToken = at.body.data.access_token;
});

await test('25. SECURITY: an agent writing as its owner cannot plant a notification, with a button to another site or to an owner door', async () => {
    const ownerDoor = { id: 'fix', label: 'Fix now', kind: 'api', method: 'PATCH', endpoint: `/v1/agents/${agentName}/scopes`, body: { scopes: ['*'] } };
    for (const [tag, action] of [['steal', STEAL], ['ownerdoor', ownerDoor]] as const) {
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ key: `notif.${new Date().toISOString()}.${tag}`, value: planted(tag, [action]), visibility: 'private', owner_scope: true }),
        });
        assert(w.status === 403 && w.body.error?.code === 'RESERVED_KEY', `${tag}: expected 403 RESERVED_KEY, got ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
    }
});

await test('26. SECURITY: the owner, and an app the owner granted, cannot write one either, on any memory door', async () => {
    const key = () => `notif.${new Date().toISOString()}.${randomBytes(4).toString('hex')}`;
    for (const [who, token] of [['owner', A.token], ['app', appToken]] as const) {
        const post = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: key(), value: planted(`${who}post`, [STEAL]), visibility: 'private' }) });
        assert(post.status === 403 && post.body.error?.code === 'RESERVED_KEY', `${who} POST: ${post.status} ${JSON.stringify(post.body.error ?? post.body.data)}`);
        const k = key();
        const patch = await json(`/v1/memory/${encodeURIComponent(k)}`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ patch: planted(`${who}patch`, [STEAL]) }) });
        assert(patch.status === 403 && patch.body.error?.code === 'RESERVED_KEY', `${who} PATCH: ${patch.status} ${JSON.stringify(patch.body.error ?? patch.body.data)}`);
        const bulk = await json('/v1/memory/bulk', { method: 'POST', headers: auth(token), body: JSON.stringify({ entries: [{ key: key(), value: planted(`${who}bulk`, [STEAL]) }] }) });
        assert(bulk.status === 200 && bulk.body.data.created === 0 && bulk.body.data.failed.length === 1,
            `${who} bulk: ${bulk.status} ${JSON.stringify(bulk.body.data ?? bulk.body.error)}`);
        const imp = await json('/v1/memory/import', { method: 'POST', headers: auth(token), body: JSON.stringify({ entries: [{ key: key(), value: planted(`${who}import`, [STEAL]) }] }) });
        assert(imp.status === 200 && imp.body.data.created === 0 && imp.body.data.failed.length === 1,
            `${who} import: ${imp.status} ${JSON.stringify(imp.body.data ?? imp.body.error)}`);
    }
    // Nothing any of them tried reached the owner's inbox.
    assert((await plantedTitles(A.token)).length === 0, `planted notifications were served: ${JSON.stringify(await plantedTitles(A.token))}`);
});

// A record that was written before the doors refused it, or by some path this suite does not know
// about, still never hands the page a button that sends the session elsewhere. Planted straight into
// the node's own database, the way an older record already sits there.
await test('27. SECURITY: a record planted straight into storage is served without its off-node buttons', async () => {
    const provider = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
    if (provider !== 'sqlite' && provider !== 'postgres-kysely') { console.log(`     (skipped: the ${provider} backend lives inside the server)`); return; }
    const storage: Storage = await createStorage({ provider, sqlitePath: serverSqlitePath(), dbUrl: serverDbUrl() });
    const now = new Date().toISOString();
    const value = planted('instorage', [
        STEAL,
        { id: 'protocol', label: 'x', kind: 'api', method: 'POST', endpoint: '//evil.example/x' },
        { id: 'backslash', label: 'x', kind: 'api', method: 'POST', endpoint: '/\\evil.example/x' },
        { id: 'page', label: 'x', kind: 'api', method: 'POST', endpoint: '/spa.html' },
        { id: 'escape', label: 'x', kind: 'api', method: 'POST', endpoint: '/v1/../spa.html' },
        // The bell runs any button that is not a reply or a link as an api button.
        { id: 'unknown', label: 'x', kind: 'webhook', method: 'POST', endpoint: 'https://evil.example/x' },
        { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: '/v1/organisms/org-x/join-requests/jr-x/review', body: { decision: 'approved' } },
        { id: 'view', label: 'View', kind: 'navigate', link: '/v1/profile#organisms' },
    ]);
    try {
        await storage.setMemory({
            key: `notif.${now}.instorag`, ownerGaii: ghiiOf(A.name), value, visibility: 'private', tags: ['notif'],
            ttlHours: 24, version: 1, createdAt: now, updatedAt: now,
        });
    } finally { await storage.close?.(); }
    const list = await json('/v1/notifications?limit=200', { headers: auth(A.token) });
    const n = (list.body.data.notifications || []).find((x: any) => x.id === value.id);
    assert(!!n, 'the planted record is still listed; only its buttons are judged');
    const ids = (n.actions || []).map((a: any) => a.id);
    assert(JSON.stringify(ids) === JSON.stringify(['approve', 'view']), `served buttons: ${JSON.stringify(ids)}`);
    // Clear it so nothing below counts it.
    await json('/v1/notifications', { method: 'DELETE', headers: auth(A.token), body: JSON.stringify({ ids: [value.id] }) });
});

// The node's own buttons are what the rule is for. Each is served, and runs the way the bell runs it:
// the endpoint, the method and the body as served, with the clicker's own session.
const runAs = (token: string, a: any) => json(a.endpoint, { method: a.method || 'POST', headers: auth(token), body: a.body ? JSON.stringify(a.body) : undefined });
const newestOfType = async (token: string, type: string, endpointHas: string) => ((await json('/v1/notifications?limit=200', { headers: auth(token) })).body.data.notifications || [])
    .find((n: any) => n.type === type && (n.actions || []).some((a: any) => typeof a.endpoint === 'string' && a.endpoint.includes(endpointHas)));

await test('28. The node\'s own buttons still arrive and work: a join request, approved from the notification', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Notif Join Org', description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    const orgId = o.body.data.organism.id as string;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ message: 'let me in' }) });
    assert(j.status === 202, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
    const n = await newestOfType(A.token, 'organism_join_request', `/v1/organisms/${orgId}/`);
    assert(!!n, 'A has the join request with its buttons');
    assert(n.actions.map((a: any) => a.id).join(',') === 'approve,reject', `buttons: ${JSON.stringify(n.actions.map((a: any) => a.id))}`);
    const r = await runAs(A.token, n.actions.find((a: any) => a.id === 'approve'));
    assert(r.status === 200, `approve from the notification: ${r.status} ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === B.name && x.status === 'active'), 'B is an active member');
});

await test('29. ...an invitation, accepted from the notification', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Notif Invite Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`);
    const orgId = o.body.data.organism.id as string;
    const inv = await json(`/v1/organisms/${orgId}/invitations`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ invitee: B.name }) });
    assert(inv.status === 201, `invite ${inv.status}: ${JSON.stringify(inv.body.error)}`);
    const n = await newestOfType(B.token, 'organism_invitation', `/v1/organisms/${orgId}/`);
    assert(!!n, 'B has the invitation with its buttons');
    assert(n.actions.map((a: any) => a.id).join(',') === 'accept,decline', `buttons: ${JSON.stringify(n.actions.map((a: any) => a.id))}`);
    const r = await runAs(B.token, n.actions.find((a: any) => a.id === 'accept'));
    assert(r.status === 200 && r.body.data.status === 'joined', `accept from the notification: ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('30. ...a workspace access request, approved from the notification', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Notif Access Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`);
    const orgId = o.body.data.organism.id as string;
    const ws = 'ws-notif';
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: ws, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.w.${ws}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
    // An open organism takes B in at once: 201 with the membership, where approval would be a 202.
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(j.status === 201 && j.body.data.status === 'joined', `join ${j.status}: ${JSON.stringify(j.body.error ?? j.body.data)}`);
    const req = await json(`/v1/organisms/${orgId}/workspace-access`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ ws, message: 'let me in' }) });
    assert(req.status === 201, `request ${req.status}: ${JSON.stringify(req.body.error)}`);
    const n = await newestOfType(A.token, 'workspace_access_request', `/v1/organisms/${orgId}/`);
    assert(!!n, 'A has the access request with its buttons');
    assert(n.actions.map((a: any) => a.id).join(',') === 'approve,deny', `buttons: ${JSON.stringify(n.actions.map((a: any) => a.id))}`);
    const r = await runAs(A.token, n.actions.find((a: any) => a.id === 'approve'));
    assert(r.status === 200 && r.body.data.status === 'approved', `approve from the notification: ${r.status} ${JSON.stringify(r.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
