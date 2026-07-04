/**
 * @file e2e-invitations.ts
 * @description E2E for EMAIL invitations (invite people not yet on the node). Covers: creating an
 *   invite (organism role + a workspace at contributor), the public GET details, a NEW user
 *   registering + joining via the token in one step, the applied membership + workspace read, the
 *   single-use guard, cancel-then-rejected, an already-logged-in user accepting, and the failure
 *   modes (non-admin invite, invalid email, bogus token, taken username).
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=invitations

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
    const name = `inv${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Invite', password: 'InvPass1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokenFrom = (url: string) => new URL(url).searchParams.get('token') || '';

console.log('\n=== AIMEAT Email Invitations E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>; // creator/admin
let B: Awaited<ReturnType<typeof setupOwner>>; // existing user (accepts via session)
let orgId = '';
const WS = 'ws-inv1';
const email1 = `alice.${Date.now()}@example.com`;
let token1 = '';
let newUserToken = '';
const newUsername = `invnew${Date.now()}`;

await test('Setup owners A (creator) + B (existing)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

await test('A creates an organism + a workspace (registry + manifest)', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Hero Play', description: 'project', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
});

await test('1. A invites an external email (member + WS as contributor)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: email1, orgRole: 'member', workspaces: [{ ws: WS, role: 'contributor' }], message: 'welcome aboard' }) });
    assert(r.status === 201, `invite ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.invitation.email === email1, 'invitation echoes the email');
    assert(typeof r.body.data.accept_url === 'string', 'returns an accept_url');
    token1 = tokenFrom(r.body.data.accept_url);
    assert(token1.length > 0, 'accept_url carries a token');
});

await test('2. A lists pending email invites (contains the email, no token)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/email`, { headers: auth(A.token) });
    assert(r.status === 200, `list ${r.status}`);
    const inv = (r.body.data.invitations || []).find((i: any) => i.email === email1);
    assert(!!inv, 'pending invite listed');
    assert(inv.token_hash === undefined && inv.tokenHash === undefined, 'token hash never leaked');
});

await test('3. Public GET returns invite details (registered:false, workspace named)', async () => {
    const r = await json(`/v1/invitations/${token1}`); // no auth
    assert(r.status === 200, `get ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data.invitation;
    assert(d.email === email1, 'shows invited email');
    assert(d.registered === false, 'email not yet registered');
    assert(d.organism && d.organism.id === orgId, 'shows organism');
    assert((d.workspaces || []).some((w: any) => w.ws === WS && w.name === 'Coordination' && w.role === 'contributor'), 'shows workspace grant + name');
});

await test('4. A NEW user registers + joins in one accept', async () => {
    const r = await json(`/v1/invitations/${token1}/accept`, { method: 'POST', body: JSON.stringify({ username: newUsername, password: 'NewJoin1234', display_name: 'New Joiner' }) });
    assert(r.status === 200, `accept ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.status === 'joined', 'joined');
    assert(r.body.data.created_account === true, 'created a new account');
    assert((r.body.data.workspaces || []).includes(WS), 'workspace grant applied');
    assert(typeof r.body.data.token === 'string', 'returns a session token');
    newUserToken = r.body.data.token;
});

await test('5. The new user is an active member of the organism', async () => {
    const r = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert(r.status === 200, `members ${r.status}`);
    const m = (r.body.data.members || []).find((x: any) => x.ghii === newUsername);
    assert(m && m.status === 'active' && m.role === 'member', `new user is an active member (got ${JSON.stringify(m)})`);
});

await test('6. The new user can READ the workspace (contributor grant works)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(newUserToken) });
    assert(r.status === 200, `read ${r.status}`);
    assert(r.body.data.manifest && r.body.data.manifest.name === 'Coordination', 'manifest readable after joining with a grant');
});

await test('7. The invite is single-use (re-accept → 410)', async () => {
    const r = await json(`/v1/invitations/${token1}/accept`, { method: 'POST', body: JSON.stringify({ username: `dupe${Date.now()}`, password: 'Dupe1234x' }) });
    assert(r.status === 410, `expected 410, got ${r.status}`);
});

await test('8. Accepted invite no longer appears in the pending list', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/email`, { headers: auth(A.token) });
    assert(!(r.body.data.invitations || []).some((i: any) => i.email === email1), 'accepted invite is gone from pending');
});

await test('9. Cancel invalidates an invite before use', async () => {
    const email2 = `bob.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: email2 }) });
    assert(c.status === 201, `invite ${c.status}`);
    const t2 = tokenFrom(c.body.data.accept_url);
    const invId = c.body.data.invitation.id;
    const cancel = await json(`/v1/organisms/${orgId}/invitations/email/${invId}/cancel`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(cancel.status === 200 && cancel.body.data.status === 'cancelled', `cancel ${cancel.status}`);
    const get = await json(`/v1/invitations/${t2}`);
    assert(get.status === 404, `cancelled GET expected 404, got ${get.status}`);
    const acc = await json(`/v1/invitations/${t2}/accept`, { method: 'POST', body: JSON.stringify({ username: `x${Date.now()}`, password: 'Xxxx1234y' }) });
    assert(acc.status === 404, `cancelled accept expected 404, got ${acc.status}`);
});

await test('10. An already-logged-in user can accept as their account', async () => {
    const email4 = `carol.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: email4, orgRole: 'member' }) });
    const t4 = tokenFrom(c.body.data.accept_url);
    const acc = await json(`/v1/invitations/${t4}/accept`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(acc.status === 200 && acc.body.data.status === 'joined', `authed accept ${acc.status}: ${JSON.stringify(acc.body.error)}`);
    assert(acc.body.data.created_account === false, 'did not create a new account');
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === B.name), 'B is now a member');
});

await test('11. Non-admin cannot invite (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ email: `d${Date.now()}@example.com` }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('12. Invalid email is rejected (400)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: 'not-an-email' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('13. Bogus token GET → 404', async () => {
    const r = await json('/v1/invitations/deadbeefdeadbeef');
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('14. A taken username on accept → 409 (invite not consumed)', async () => {
    const email5 = `erin.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: email5 }) });
    const t5 = tokenFrom(c.body.data.accept_url);
    const acc = await json(`/v1/invitations/${t5}/accept`, { method: 'POST', body: JSON.stringify({ username: A.name, password: 'Taken1234z' }) });
    assert(acc.status === 409, `expected 409, got ${acc.status}`);
    // The invite must still be usable (not consumed by a failed accept).
    const get = await json(`/v1/invitations/${t5}`);
    assert(get.status === 200, `invite should still be pending, got ${get.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: auth(B.token) });
    await json(`/v1/owners/${newUsername}`, { method: 'DELETE', headers: auth(newUserToken) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
