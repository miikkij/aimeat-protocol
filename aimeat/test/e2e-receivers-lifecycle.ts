/**
 * @file e2e-receivers-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for what happens to a receiver, and to an outside party, when the people and
 *   principals around it change (secaudit2026nov08 round 14). Owners A and B, an operator.
 *     Operator start: a receiver the owner paused, then the operator stopped, is paused again after the
 *       operator's start (403 PAUSED until the owner resumes); one waiting for the operator waits again;
 *       an active one stopped and started is active again (the designed use).
 *     Deactivation: B's receiver key answers 403 ACCOUNT_DISABLED to a write, a read and a delete while
 *       B is deactivated, and writes again after the operator reactivates B. B's outside party key and
 *       party token answer 403 ACCOUNT_DISABLED the same way and read again after reactivation.
 *     Maker removed: an agent and an ecosystem app that made a receiver are deleted; the delete answer
 *       names the receiver (receivers_kept), the owner gets one notice, and the receiver keeps writing
 *       (developer ruling 3, 2026-11-08). An agent that made none answers count 0 and sends no notice.
 *     Key holder removed: an agent that changed the key of a receiver the owner made is deleted; the
 *       answer names the receiver, the owner gets one notice of its own kind, the list view names the
 *       agent in `key_holders`, and the receiver keeps writing.
 *     Erasure: the rows an erased account's receiver wrote into another owner's row space name the
 *       erasure's pseudonym, and a later account of the name with a receiver of the same name lists
 *       none of them; before the erasure the receiver reads its own row (the designed use).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=receivers-lifecycle
 * @version-history
 *   v1.1.0 — 2026-11-08 — Key holder removed and Erasure (secaudit2026nov08b round 15:
 *     rotated-key-holder-not-surfaced, receiver-principal-not-pseudonymised).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14: start-drops-owner-pause,
 *     owner-deactivation-not-asked, maker-lifecycle-not-surfaced, older item O3).
 */
import { registerOwner, setupOperator, ownerToken } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
interface CallOpts { token?: string; auth?: string; body?: unknown; method?: string }
async function call(path: string, opts: CallOpts = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.auth ?? (opts.token ? `Bearer ${opts.token}` : undefined);
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(authorization ? { Authorization: authorization } : {}),
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code;
const stamp = Date.now() % 10_000_000;

console.log('\n=== AIMEAT receivers lifecycle E2E ===\n');
let A = { name: '', token: '', ghii: '' }, B = { name: '', token: '', ghii: '', password: '' }, OP = { name: '', token: '' };

const send = (owner: string, name: string, key: string, body: unknown, method = 'POST') =>
    call(`/v1/receive/${owner}/${name}`, { token: key, method, ...(method === 'GET' || method === 'DELETE' ? {} : { body }) });
async function make(token: string, body: Body): Promise<{ receiver: Body; key: string }> {
    const r = await call('/v1/receivers', { token, body });
    assert(r.status === 201, `create ${body.name}: ${show(r)}`);
    return { receiver: r.body.data.receiver, key: r.body.data.key };
}
async function memoryVersion(token: string, key: string): Promise<number | null> {
    const r = await call(`/v1/memory/${encodeURIComponent(key)}`, { token });
    if (r.status === 404 || r.body?.data?.exists === false) return null;
    assert(r.status === 200, `read ${key}: ${show(r)}`);
    return r.body.data.version as number;
}
async function setMode(value: string): Promise<void> {
    const r = await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'visibility.receivers_mode', value }] } });
    assert(r.status === 200 && !(r.body.data?.errors ?? []).length, `receivers_mode ${value}: ${show(r)}`);
}
const notices = async (token: string): Promise<Body[]> => ((await call('/v1/notifications', { token })).body?.data?.notifications ?? []) as Body[];

await test('Setup: owners A and B and an operator', async () => {
    const a = await registerOwner(BASE, `rlca${stamp}`);
    const b = await registerOwner(BASE, `rlcb${stamp}`);
    const op = await setupOperator(BASE, ADMIN_PW, `rlcop${stamp}`);
    A = { name: a.name, token: a.token, ghii: a.ghii };
    B = { name: b.name, token: b.token, ghii: b.ghii, password: b.password };
    OP = { name: op.name, token: op.token };
});

// ── The operator's start keeps the owner's pause ─────────────────────────────

await test('Operator start, designed use: an active receiver stopped and started is active again and writes', async () => {
    const { key } = await make(A.token, { name: 'plain', target: { key: 'rlc.plain' } });
    assert((await call(`/v1/admin/receivers/${A.name}/plain/stop`, { token: OP.token, body: { reason: 'checking it' } })).status === 200, 'stop');
    const start = await call(`/v1/admin/receivers/${A.name}/plain/start`, { token: OP.token, body: {} });
    assert(start.status === 200 && start.body.data.receiver.state === 'active', `start: ${show(start)}`);
    assert((await send(A.name, 'plain', key, { v: 1 })).status === 201, 'writes after the start');
});

await test('Operator start: a receiver the owner paused stays paused (403 PAUSED, nothing written) until the owner resumes it', async () => {
    const { key } = await make(A.token, { name: 'held', target: { key: 'rlc.held' } });
    assert((await call('/v1/receivers/held/pause', { token: A.token, body: {} })).status === 200, 'the owner pauses');
    assert((await call(`/v1/admin/receivers/${A.name}/held/stop`, { token: OP.token, body: { reason: 'too many writes' } })).status === 200, 'the operator stops');
    const start = await call(`/v1/admin/receivers/${A.name}/held/start`, { token: OP.token, body: {} });
    assert(start.status === 200 && start.body.data.receiver.state === 'paused', `the operator's start keeps the pause: ${show(start)}`);
    const w = await send(A.name, 'held', key, { leaked: true });
    assert(w.status === 403 && codeOf(w) === 'PAUSED', `a write after the operator's start: ${show(w)}`);
    assert((await memoryVersion(A.token, 'rlc.held')) === null, 'nothing written');
    assert((await call('/v1/receivers/held/resume', { token: A.token, body: {} })).status === 200, 'the owner resumes');
    assert((await send(A.name, 'held', key, { ok: true })).status === 201, 'writes after the owner resumes');
});

await test('Operator start: a receiver waiting for the operator, stopped and started, waits again until the operator approves it', async () => {
    await setMode('operator');
    try {
        const { key } = await make(A.token, { name: 'queued', target: { key: 'rlc.queued' } });
        assert((await call(`/v1/admin/receivers/${A.name}/queued/stop`, { token: OP.token, body: { reason: 'look later' } })).status === 200, 'stop');
        const start = await call(`/v1/admin/receivers/${A.name}/queued/start`, { token: OP.token, body: {} });
        assert(start.status === 200 && start.body.data.receiver.state === 'awaiting_operator', `start: ${show(start)}`);
        const w = await send(A.name, 'queued', key, { early: true });
        assert(w.status === 403 && codeOf(w) === 'NOT_APPROVED', `a write before the approval: ${show(w)}`);
        const d = await call(`/v1/admin/receivers/${A.name}/queued/decide`, { token: OP.token, body: { decision: 'approve' } });
        assert(d.status === 200 && d.body.data.receiver.state === 'active', `approve: ${show(d)}`);
        assert((await send(A.name, 'queued', key, { approved: true })).status === 201, 'writes after the approval');
    } finally { await setMode('auto'); }
});

// ── A deactivated account ────────────────────────────────────────────────────

let bKey = '', partyKey = '', partyToken = '';
await test('Deactivation, designed use: B\'s receiver writes and B\'s party reads before the deactivation', async () => {
    ({ key: bKey } = await make(B.token, { name: 'bsensor', target: { key: 'rlc.bsensor' }, verbs: ['read', 'delete'] }));
    assert((await send(B.name, 'bsensor', bKey, { v: 1 })).status === 201, 'B\'s receiver writes');
    const p = await call('/v1/parties', { token: B.token, body: { name: 'bparty', kind: 'program' } });
    assert(p.status === 201, `B's party: ${show(p)}`);
    partyKey = p.body.data.key;
    const me = await call('/v1/parties/me', { auth: `Basic ${Buffer.from(`${B.name}/bparty:${partyKey}`).toString('base64')}` });
    assert(me.status === 200, `the party reads /v1/parties/me: ${show(me)}`);
    const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${B.name}/bparty`, client_secret: partyKey } });
    assert(tok.status === 200 && typeof tok.body.access_token === 'string', `party token: ${show(tok)}`);
    partyToken = tok.body.access_token;
    assert((await call('/v1/parties/me', { token: partyToken })).status === 200, 'the party token reads');
});

await test('Deactivation: while B is deactivated, B\'s receiver key is 403 ACCOUNT_DISABLED for a write, a read and a delete', async () => {
    const off = await call(`/v1/admin/owners/${B.name}/disable`, { token: OP.token, body: {} });
    assert(off.status === 200 && off.body.data.disabled === true, `disable: ${show(off)}`);
    for (const method of ['POST', 'GET', 'DELETE']) {
        const r = await send(B.name, 'bsensor', bKey, { v: 2 }, method);
        assert(r.status === 403 && codeOf(r) === 'ACCOUNT_DISABLED', `${method} while deactivated: ${show(r)}`);
        assert(/deactivated/.test(r.body.error.message) && /reactivates/.test(r.body.error.message), `the refusal names the deactivation: ${show(r)}`);
    }
});

await test('Deactivation: while B is deactivated, B\'s party key and party token are 403 ACCOUNT_DISABLED', async () => {
    const basic = await call('/v1/parties/me', { auth: `Basic ${Buffer.from(`${B.name}/bparty:${partyKey}`).toString('base64')}` });
    assert(basic.status === 403 && codeOf(basic) === 'ACCOUNT_DISABLED', `key: ${show(basic)}`);
    const tok = await call('/v1/parties/me', { token: partyToken });
    assert(tok.status === 403 && codeOf(tok) === 'ACCOUNT_DISABLED', `token: ${show(tok)}`);
    const mint = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${B.name}/bparty`, client_secret: partyKey } });
    assert(mint.status !== 200 && mint.body.access_token === undefined, `no new party token: ${show(mint)}`);
});

await test('Deactivation: after the operator reactivates B, the receiver writes again, the record is as it was, and the party reads again', async () => {
    const on = await call(`/v1/admin/owners/${B.name}/enable`, { token: OP.token, body: {} });
    assert(on.status === 200 && on.body.data.disabled === false, `enable: ${show(on)}`);
    B.token = await ownerToken(BASE, B.name, B.password);
    assert((await memoryVersion(B.token, 'rlc.bsensor')) === 1, 'nothing was written or deleted while B was deactivated');
    assert((await send(B.name, 'bsensor', bKey, { v: 3 })).status === 200, 'the receiver writes again');
    const me = await call('/v1/parties/me', { auth: `Basic ${Buffer.from(`${B.name}/bparty:${partyKey}`).toString('base64')}` });
    assert(me.status === 200, `the party reads again: ${show(me)}`);
    assert((await call('/v1/parties/me', { token: partyToken })).status === 200, 'the party token reads again');
});

// ── The maker of a receiver is removed (developer ruling 3, 2026-11-08) ──────

await test('Maker removed, designed use: deleting an agent that made no receiver answers receivers_kept 0 and sends no receiver notice', async () => {
    const ag = await makeAgent(BASE, A, ['memory:read'], `rlcnone${stamp % 1000}`);
    const d = await call(`/v1/agents/${ag.name}`, { token: A.token, method: 'DELETE' });
    assert(d.status === 200 && d.body.data.deleted === true, `delete: ${show(d)}`);
    assert(d.body.data.receivers_kept?.count === 0, `receivers_kept: ${show(d)}`);
    assert(!(await notices(A.token)).some(n => n.i18n?.key === 'receivers_kept_after_maker' && n.i18n?.vars?.maker === ag.name), 'no receiver notice');
});

await test('Maker removed: deleting the agent that made a receiver names it in the answer and a notice, and the receiver keeps writing', async () => {
    const ag = await makeAgent(BASE, A, ['receivers:manage'], `rlcmk${stamp % 1000}`);
    const m = await call('/v1/receivers', { token: ag.token, body: { name: 'byagent', target: { key: 'rlc.byagent' } } });
    assert(m.status === 201 && typeof m.body.data.key === 'string', `the agent makes a receiver: ${show(m)}`);
    const key = m.body.data.key as string;
    const d = await call(`/v1/agents/${ag.name}`, { token: A.token, method: 'DELETE' });
    assert(d.status === 200 && d.body.data.deleted === true, `delete: ${show(d)}`);
    const kept = d.body.data.receivers_kept;
    assert(kept?.count === 1 && kept.receivers?.[0]?.name === 'byagent', `the answer names the receiver: ${show(d)}`);
    const n = (await notices(A.token)).filter(x => x.i18n?.key === 'receivers_kept_after_maker' && x.i18n?.vars?.maker === ag.name);
    assert(n.length === 1 && String(n[0]!.i18n.vars.count) === '1', `one notice: ${JSON.stringify(n)}`);
    assert(String(n[0]!.link ?? '').includes('tab=receivers'), `the notice opens the Receivers page: ${JSON.stringify(n[0])}`);
    assert((await send(A.name, 'byagent', key, { after: true })).status === 201, 'the receiver keeps writing after its maker is gone');
});

await test('Maker removed: removing the ecosystem app that made a receiver names it in the answer and a notice, and the receiver keeps writing', async () => {
    const app = `rlceco${stamp % 10000}`;
    const hello = await call('/v1/ecosystem-apps/hello', { body: { owner: A.name, app, display_name: 'Receiver maker', public_key: `e2e-rlc-key-${stamp}`, scopes: ['receivers:manage'] } });
    assert(hello.status === 200, `hello: ${show(hello)}`);
    const ok = await call(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, { token: A.token, body: { action: 'approve', scopes: ['receivers:manage'] } });
    assert(ok.status === 200, `approve: ${show(ok)}`);
    const tok = await call('/v1/ecosystem-apps/token', { body: { device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } });
    assert(tok.status === 200 && tok.body.access_token, `eco token: ${show(tok)}`);
    const m = await call('/v1/receivers', { token: tok.body.access_token, body: { name: 'byeco', target: { key: 'rlc.byeco' } } });
    assert(m.status === 201 && typeof m.body.data.key === 'string', `the app makes a receiver: ${show(m)}`);
    const key = m.body.data.key as string;
    const d = await call(`/v1/ecosystem-apps/${app}`, { token: A.token, method: 'DELETE' });
    assert(d.status === 200 && d.body.data.deleted === true, `remove: ${show(d)}`);
    const kept = d.body.data.receivers_kept;
    assert(kept?.count === 1 && kept.receivers?.[0]?.name === 'byeco', `the answer names the receiver: ${show(d)}`);
    const n = (await notices(A.token)).filter(x => x.i18n?.key === 'receivers_kept_after_maker' && x.i18n?.vars?.maker === app);
    assert(n.length === 1 && String(n[0]!.i18n.vars.count) === '1', `one notice: ${JSON.stringify(n)}`);
    assert((await send(A.name, 'byeco', key, { after: true })).status === 201, 'the receiver keeps writing after its maker is gone');
});

// ── The principal that holds a receiver's key is removed (secaudit2026nov08b round 15) ──────

await test('Key holder removed: deleting an agent that changed the key of a receiver the owner made names it in the answer and a notice, and the receiver keeps writing', async () => {
    await make(A.token, { name: 'rotated', target: { key: 'rlc.rotated' } });
    const ag = await makeAgent(BASE, A, ['receivers:manage'], `rlcrot${stamp % 1000}`);
    const rot = await call('/v1/receivers/rotated/rotate', { token: ag.token, body: { overlap_minutes: 0 } });
    assert(rot.status === 200 && typeof rot.body.data.key === 'string', `the agent changes the key: ${show(rot)}`);
    const key = rot.body.data.key as string;
    const d = await call(`/v1/agents/${ag.name}`, { token: A.token, method: 'DELETE' });
    assert(d.status === 200 && d.body.data.deleted === true, `delete: ${show(d)}`);
    const kept = d.body.data.receivers_kept;
    assert(kept?.count === 1 && kept.receivers?.[0]?.name === 'rotated', `the answer names the receiver whose key the agent holds: ${show(d)}`);
    const n = (await notices(A.token)).filter(x => x.i18n?.key === 'receivers_key_kept_after_holder' && x.i18n?.vars?.maker === ag.name);
    assert(n.length === 1 && String(n[0]!.i18n.vars.count) === '1', `one notice: ${JSON.stringify(n)}`);
    assert(!(await notices(A.token)).some(x => x.i18n?.key === 'receivers_kept_after_maker' && x.i18n?.vars?.maker === ag.name), 'no "made" notice for a receiver it did not make');
    assert((await send(A.name, 'rotated', key, { after: true })).status === 201, 'the receiver keeps writing after the key holder is gone');
});

await test('Key holder removed, designed use: the list view names who holds each receiver\'s key', async () => {
    await make(A.token, { name: 'ownheld', target: { key: 'rlc.ownheld' } });
    const ag = await makeAgent(BASE, A, ['receivers:manage'], `rlcview${stamp % 1000}`);
    assert((await call('/v1/receivers/ownheld/rotate', { token: ag.token, body: { overlap_minutes: 0 } })).status === 200, 'rotate');
    const list = await call('/v1/receivers', { token: A.token });
    const r = (list.body.data.receivers as Body[]).find(x => x.name === 'ownheld');
    assert(Array.isArray(r?.key_holders) && r!.key_holders.includes(ag.gaii), `key_holders: ${JSON.stringify(r)}`);
    assert((await call(`/v1/agents/${ag.name}`, { token: A.token, method: 'DELETE' })).status === 200, 'clean up the agent');
});

// ── An erased account's receiver rows (secaudit2026nov08b round 15) ───────────

await test('Erasure: rows an erased account\'s receiver wrote into another owner\'s row space name the erasure, and a later account of the name does not get them', async () => {
    const o = await call('/v1/organisms', { token: A.token, body: { name: `Rlc ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' } });
    assert(o.status === 201, `organism: ${show(o)}`);
    const org = o.body.data.organism.id as string;
    const w = await call(`/v1/organisms/${org}/workspaces`, { token: A.token, body: { name: 'Sensors', manifest: { objectTypes: [
        { name: 'readings', schemaRef: 'schema:readings@1', namespace: 'sensors.readings', backing: 'rows', writeRole: 'member' },
    ] } } });
    assert(w.status === 201, `workspace: ${show(w)}`);
    const ws = w.body.data.ws as string;
    const cname = `rlcc${stamp}`, rowId = `x${stamp}`;
    const joinAndMake = async (): Promise<{ token: string; key: string }> => {
        const c = await registerOwner(BASE, cname);
        const add = await call(`/v1/organisms/${org}/members`, { token: A.token, body: { ghii: c.name, role: 'member', workspaces: [{ ws, role: 'contributor' }] } });
        assert(add.status === 201, `add ${c.name}: ${show(add)}`);
        const { key } = await make(c.token, { name: 'r1', target: { organism_id: org, ws, space: 'readings' }, verbs: ['read'] });
        return { token: c.token, key };
    };
    const first = await joinAndMake();
    const wrote = await send(cname, 'r1', first.key, { rows: [{ row_id: rowId, body: { celsius: 1 } }] });
    assert(wrote.status === 201 && wrote.body.data.written === 1, `the receiver writes a row: ${show(wrote)}`);
    const own = await call(`/v1/receive/${cname}/r1`, { token: first.key });
    assert(own.status === 200 && own.body.data.rows.some((r: Body) => r.rowId === rowId), `designed use: the receiver reads its own row: ${show(own)}`);
    const erase = await call(`/v1/owners/${cname}`, { token: first.token, method: 'DELETE' });
    assert(erase.status === 200, `erase: ${show(erase)}`);
    const later = await joinAndMake();
    const listed = await call(`/v1/receive/${cname}/r1`, { token: later.key });
    assert(listed.status === 200 && Array.isArray(listed.body.data.rows), `read: ${show(listed)}`);
    assert(!listed.body.data.rows.some((r: Body) => r.rowId === rowId), `a later account's receiver lists the erased account's row: ${show(listed)}`);
    const row = await call(`/v1/organisms/${org}/workspace/rows/readings/${rowId}?ws=${ws}`, { token: A.token });
    assert(row.status === 200, `the row stays for the organism: ${show(row)}`);
    assert(!row.text.includes(`receiver:${cname}/`) && row.text.includes('erased:'), `the row names the erasure, not the name: ${show(row)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
