/**
 * @file e2e-admin-owners-page.ts
 * @description E2E for the one read the Owners page makes, and the field set its whole face is
 *   folded from. GET /v1/admin/owners is the page's only door: the three figures, the five filter
 *   chips, the operator section and every chip on a row are counted in the browser from that one
 *   answer. So this asserts the SHAPE — name, display_name, roles, agents, created_at, disabled_at,
 *   managed_by on every row — and then that the two lifecycle writes move the two fields the page
 *   reads: deactivation stamps disabled_at, and the role grant puts "operator" into roles.
 *
 *   The refusals the page draws around (a self-revoke, the last operator, deactivating yourself)
 *   are the node's own and are proved in test/e2e-admin-doors-2.ts; they are not repeated here.
 *   What is new is that a trimmed response would take the page's figures with it silently.
 * @version-history
 *   v1.0.0 -- 2026-09-12 -- Initial (the Owners page in the poster face).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-owners-page

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

async function owners(token: string): Promise<any[]> {
    const r = await json('/v1/admin/owners', { headers: auth(token) });
    assert(r.status === 200, `owners ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data.owners;
}
const row = (list: any[], name: string) => list.find(o => o.name === name);

console.log('\n=== AIMEAT Admin Owners Page E2E ===\n');

const stamp = Date.now();
const opName = `ownop${stamp}`;
const plainName = `ownplain${stamp}`;
const offName = `ownoff${stamp}`;
let opToken = '';
let plainToken = '';

await test('Setup: the first owner holds the role, a later one does not', async () => {
    opToken = await registerAndToken(opName);
    plainToken = await registerAndToken(plainName);
    await registerAndToken(offName);
    const list = await owners(opToken);
    assert(row(list, opName).roles.includes('operator'), 'the first owner is not an operator');
    assert(!row(list, plainName).roles.includes('operator'), 'a later owner holds the role');
});

await test('An owner who is not an operator cannot read the list the page is built from', async () => {
    const r = await json('/v1/admin/owners', { headers: auth(plainToken) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('A stranger is turned away before the role is even looked at', async () => {
    // 401, not 403: requireAuth() answers first, and a caller with no credential has no role to
    // refuse. The owner who HAS a credential and not the role gets the 403 above.
    const r = await json('/v1/admin/owners');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Every row carries the seven fields the page folds its figures from', async () => {
    const list = await owners(opToken);
    assert(list.length >= 3, `expected at least the three owners, got ${list.length}`);
    for (const o of list) {
        for (const field of ['name', 'display_name', 'roles', 'agents', 'created_at', 'disabled_at', 'managed_by']) {
            assert(field in o, `${o.name} has no ${field}: the page counts on it`);
        }
        assert(Array.isArray(o.roles), `${o.name}.roles is not a list`);
        assert(Array.isArray(o.agents), `${o.name}.agents is not a list: "with an agent" is counted from its length`);
        assert(typeof o.created_at === 'string' && !Number.isNaN(Date.parse(o.created_at)),
            `${o.name}.created_at is not a date: the list is read oldest first and "joined in 7 days" is counted from it`);
    }
});

await test('An account nothing acts in carries an empty agent list, not a missing one', async () => {
    const list = await owners(opToken);
    assert(row(list, plainName).agents.length === 0, 'a fresh owner should carry no agents');
    assert(row(list, plainName).disabled_at === null, 'a fresh owner should carry no deactivation stamp');
    assert(row(list, plainName).managed_by === null, 'a fresh owner should be managed by nobody');
});

await test('Deactivating stamps disabled_at, which is the row chip and the fifth filter', async () => {
    const r = await json(`/v1/admin/owners/${offName}/disable`, { method: 'POST', headers: auth(opToken) });
    assert(r.status === 200, `disable ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = await owners(opToken);
    const o = row(list, offName);
    assert(typeof o.disabled_at === 'string' && !Number.isNaN(Date.parse(o.disabled_at)),
        `disabled_at did not become a date: ${JSON.stringify(o.disabled_at)}`);
    assert(o.roles.includes('owner'), 'a deactivated account should keep its ordinary role');
});

await test('Reactivating clears the stamp, and the row is ordinary again', async () => {
    const r = await json(`/v1/admin/owners/${offName}/enable`, { method: 'POST', headers: auth(opToken) });
    assert(r.status === 200, `enable ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(row(await owners(opToken), offName).disabled_at === null, 'the deactivation stamp survived reactivation');
});

await test('Granting the role puts "operator" in roles, which is the chip and the first figure', async () => {
    const before = (await owners(opToken)).filter(o => o.roles.includes('operator')).length;
    const r = await json('/v1/admin/roles/grant', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ owner: plainName, role: 'operator' }) });
    assert(r.status === 200, `grant ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = await owners(opToken);
    assert(row(list, plainName).roles.includes('operator'), 'the granted role is not on the row');
    assert(list.filter(o => o.roles.includes('operator')).length === before + 1, 'the operator count did not move by one');
});

await test('Revoking takes it off again, and the account keeps everything else', async () => {
    const r = await json('/v1/admin/roles/revoke', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ owner: plainName, role: 'operator' }) });
    assert(r.status === 200, `revoke ${r.status}: ${JSON.stringify(r.body.error)}`);
    const o = row(await owners(opToken), plainName);
    assert(!o.roles.includes('operator'), 'the role survived the revoke');
    assert(o.roles.includes('owner'), 'the ordinary role went with it');
    assert(o.disabled_at === null, 'revoking a role deactivated the account');
});

await test('The list is orderable by registration: the later owner registered later', async () => {
    const list = await owners(opToken);
    const first = Date.parse(row(list, opName).created_at);
    const later = Date.parse(row(list, offName).created_at);
    assert(later >= first, `the third owner registered before the first: ${later} < ${first}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
