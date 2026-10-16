/**
 * @file e2e-recorded-events.ts
 * @description E2E for events that used to leave no trace (QA audit W23: S1-02, E2-03, E2-04, E2-07).
 *   Each case makes the event happen against a real server and then finds its trace where an operator
 *   or the person reads it:
 *     - a refused credential on a route that answers 401 itself (the admin password, the access-token
 *       exchange) is in the refusal log (GET /v1/admin/auth-refusals);
 *     - an ownership refusal written inside a route handler (403) is in the refusal log, with the
 *       principal that was refused;
 *     - a refusal the auth middleware already wrote is in the log once, not twice;
 *     - a password change is on the person's account record (GET /v1/account/events);
 *     - an operator's setting change is a usage row naming the operator and the paths
 *       (GET /v1/admin/usage/calls), and never the value;
 *     - the operator role given and taken, and an account turned off and on, are on the person's record.
 * @version-history
 *   2026-10-16 — Initial (QA audit S1-02, E2-03, E2-04, E2-07).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-recorded-events

import { registerOwner, ownerSignIn } from './helpers/owner-login.js';

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== AIMEAT Recorded Events E2E ===\n');

const stamp = Date.now();
let op!: Awaited<ReturnType<typeof registerOwner>>;
let bee!: Awaited<ReturnType<typeof registerOwner>>;
let cee!: Awaited<ReturnType<typeof registerOwner>>;

/** The refusal log lines for one path, newest first, read as the operator. */
async function refusalsAt(path: string): Promise<Array<Record<string, any>>> {
    const r = await json('/v1/admin/auth-refusals?limit=500', { headers: auth(op.token) });
    assert(r.status === 200, `auth-refusals read ${r.status}`);
    return (r.body.data.items as Array<Record<string, any>>).filter((l) => l.path === path);
}

/** The account events of one owner, read with their own token. */
async function kindsOf(token: string): Promise<Array<{ kind: string; data: Record<string, string> }>> {
    const r = await json('/v1/account/events', { headers: auth(token) });
    assert(r.status === 200, `account events read ${r.status}`);
    return r.body.data.events as Array<{ kind: string; data: Record<string, string> }>;
}

await test('Setup: the first owner is the operator; two more owners', async () => {
    op = await registerOwner(BASE, `recop${stamp}`);
    bee = await registerOwner(BASE, `recbee${stamp}`);
    cee = await registerOwner(BASE, `reccee${stamp}`);
    const s = await json('/v1/admin/auth-refusals?limit=1', { headers: auth(op.token) });
    assert(s.status === 200 && s.body.data.enabled === true, `the first owner reads the refusal log (${s.status})`);
});

// ── Refusals answered inside a route (S1-02) ────────────────────────────────────────────────────

await test('A wrong admin password is in the refusal log', async () => {
    const r = await json('/v1/admin/seed-examples', { method: 'POST', headers: { 'x-admin-password': 'not-the-password' } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
    await sleep(50);
    const lines = await refusalsAt('/v1/admin/seed-examples');
    assert(lines.length >= 1, 'no refusal-log line for the admin password route');
    assert(lines[0].status === 401 && lines[0].code === 'UNAUTHORIZED', `line: ${JSON.stringify(lines[0])}`);
    assert(!JSON.stringify(lines).includes('not-the-password'), 'the password tried must never be written');
});

await test('A refused access token at the exchange is in the refusal log, with a digest and never the token', async () => {
    const fake = `pat-${'x'.repeat(40)}`;
    const r = await json('/v1/auth/token/exchange', { method: 'POST', headers: auth(fake) });
    assert(r.status === 401, `expected 401, got ${r.status}`);
    await sleep(50);
    const lines = await refusalsAt('/v1/auth/token/exchange');
    assert(lines.length >= 1, 'no refusal-log line for the token exchange');
    assert(lines[0].code === 'INVALID_TOKEN', `code ${lines[0].code}`);
    assert(lines[0].credential === 'pat' && /^[0-9a-f]{12}$/.test(lines[0].credential_digest), `credential ${lines[0].credential}/${lines[0].credential_digest}`);
    assert(!JSON.stringify(lines).includes(fake), 'the token itself must never be written');
});

// ── An ownership refusal inside a handler (E2-07, Core AUTHZ-17) ────────────────────────────────

await test('An ownership refusal written in a route handler is in the refusal log with the refused principal', async () => {
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(op.token), body: JSON.stringify({ name: `Rec Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(org.status === 201 || org.status === 200, `organism create ${org.status}`);
    const id = org.body.data?.organism?.id ?? org.body.data?.id;
    assert(typeof id === 'string', `no organism id in ${JSON.stringify(org.body.data).slice(0, 200)}`);
    const put = await json(`/v1/organisms/${id}`, { method: 'PUT', headers: auth(bee.token), body: JSON.stringify({ description: 'not mine' }) });
    assert(put.status === 403, `another owner's update expected 403, got ${put.status}`);
    await sleep(50);
    const lines = await refusalsAt(`/v1/organisms/${id}`);
    assert(lines.length === 1, `expected one line for the refused update, got ${lines.length}`);
    assert(lines[0].status === 403 && lines[0].code === 'ACCESS_DENIED', `line: ${JSON.stringify(lines[0])}`);
    assert(lines[0].principal?.sub === bee.name, `principal ${JSON.stringify(lines[0].principal)}`);
});

await test('A refusal the auth middleware wrote is in the log once', async () => {
    const before = (await refusalsAt('/v1/admin/security/incidents')).length;
    const r = await json('/v1/admin/security/incidents', { headers: auth(bee.token) });
    assert(r.status === 403, `non-operator expected 403, got ${r.status}`);
    await sleep(50);
    const after = (await refusalsAt('/v1/admin/security/incidents')).length;
    assert(after === before + 1, `expected exactly one new line, got ${after - before}`);
});

// ── A password change (E2-03) ───────────────────────────────────────────────────────────────────

await test('A password change is on the account record', async () => {
    const r = await json('/v1/ghii/password/change', {
        method: 'POST', headers: auth(bee.token),
        body: JSON.stringify({ current_password: bee.password, new_password: 'RecordedPw#2026x' }),
    });
    assert(r.status === 200, `password change ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    const fresh = await ownerSignIn(BASE, bee.name, 'RecordedPw#2026x');
    assert(fresh.status === 200, `sign-in with the new password ${fresh.status}`);
    bee.token = fresh.body.data.token;
    await sleep(100);
    const row = (await kindsOf(bee.token)).find((e) => e.kind === 'password_changed');
    assert(!!row, 'no password_changed event');
    assert(row!.data.how === 'changed', `how ${row!.data.how}`);
});

// ── An operator's setting change (E2-04) ────────────────────────────────────────────────────────

await test('A setting change is a usage row naming the operator and the path, not the value', async () => {
    const r = await json('/v1/admin/config', {
        method: 'PUT', headers: auth(op.token),
        body: JSON.stringify({ changes: [{ path: 'morsel_policy.welcome_bonus', value: 4242 }] }),
    });
    assert(r.status === 200, `config change ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    const calls = await json('/v1/admin/usage/calls?surface=operator&limit=200', { headers: auth(op.token) });
    assert(calls.status === 200, `usage calls ${calls.status}`);
    const row = (calls.body.data.calls as any[]).find((c) => c.coordinate === 'config.set');
    assert(!!row, 'no config.set usage row');
    assert(row.actorGaii === `${op.name}@${NODE_ID}`, `actor ${row.actorGaii}`);
    assert(String(row.meta?.paths ?? '').includes('morsel_policy.welcome_bonus'), `meta ${JSON.stringify(row.meta)}`);
    assert(!JSON.stringify(row).includes('4242'), 'the value must not be recorded');
});

// ── The operator role and an account turned off and on (S1-02, E2-04) ───────────────────────────

await test('The operator role given and taken is on the person\'s record', async () => {
    const g = await json('/v1/admin/roles/grant', { method: 'POST', headers: auth(op.token), body: JSON.stringify({ owner: bee.name, role: 'operator' }) });
    assert(g.status === 200, `grant ${g.status} ${JSON.stringify(g.body.error ?? '')}`);
    const v = await json('/v1/admin/roles/revoke', { method: 'POST', headers: auth(op.token), body: JSON.stringify({ owner: bee.name, role: 'operator' }) });
    assert(v.status === 200, `revoke ${v.status} ${JSON.stringify(v.body.error ?? '')}`);
    await sleep(100);
    const acts = (await kindsOf(bee.token)).filter((e) => e.kind === 'operator_acted' && e.data.area === 'role');
    const actions = acts.map((e) => e.data.action);
    assert(actions.includes('grant') && actions.includes('revoke'), `role events: ${actions.join(', ') || '(none)'}`);
    assert(acts.every((e) => e.data.operator === `${op.name}@${NODE_ID}`), 'the operator is named on the event');
});

await test('An account turned off and on keeps both on its record', async () => {
    const off = await json(`/v1/admin/owners/${cee.name}/disable`, { method: 'POST', headers: auth(op.token) });
    assert(off.status === 200, `disable ${off.status} ${JSON.stringify(off.body.error ?? '')}`);
    const on = await json(`/v1/admin/owners/${cee.name}/enable`, { method: 'POST', headers: auth(op.token) });
    assert(on.status === 200, `enable ${on.status} ${JSON.stringify(on.body.error ?? '')}`);
    const fresh = await ownerSignIn(BASE, cee.name, cee.password);
    assert(fresh.status === 200, `sign-in after enable ${fresh.status}`);
    await sleep(100);
    const actions = (await kindsOf(fresh.body.data.token)).filter((e) => e.kind === 'operator_acted' && e.data.area === 'account').map((e) => e.data.action);
    assert(actions.includes('disable') && actions.includes('enable'), `account events: ${actions.join(', ') || '(none)'}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
