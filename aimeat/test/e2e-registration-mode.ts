/**
 * @file e2e-registration-mode.ts
 * @description E2E for AIMEAT_REGISTRATION_MODE (open|invite|closed). Flips the mode at runtime
 *   through the operator config door and proves each account-creating door answers the mode:
 *   closed refuses everything (and a refused invitation is NOT consumed), invite refuses the
 *   direct doors while a member-minted invitation still creates the account, open restores all.
 *   Also: the config door itself is operator-only, and GET / discovery reports the current mode.
 * @version-history
 *   v1.0.0 -- 2026-08-18 -- Initial: the whole mode matrix over live HTTP.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=registration-mode

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokenFrom = (url: string) => new URL(url).searchParams.get('token') || '';

async function registerAndToken(name: string): Promise<{ token: string; status: number; body: any }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    if (reg.status !== 201) return { token: '', status: reg.status, body: reg.body };
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { token: tok.body.data.token, status: reg.status, body: reg.body };
}

async function setMode(opToken: string, mode: string): Promise<{ status: number; body: any }> {
    return json('/v1/admin/config', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ changes: [{ path: 'registration.mode', value: mode }] }) });
}

console.log('\n=== AIMEAT Registration-Mode E2E ===\n');

const opName = `rmop${Date.now()}`;
const WS = 'ws-rm1';
let opToken = '';
let orgId = '';
let inviteToken = '';
let invitedUserToken = '';
const invitedUsername = `rminv${Date.now()}`;

await test('Setup (open mode): first owner registers, becomes operator, mints an email invite', async () => {
    const op = await registerAndToken(opName);
    assert(op.status === 201, `register: ${op.status}`);
    opToken = op.token;

    const o = await json('/v1/organisms', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ name: 'Mode Org', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `organism: ${o.status}`);
    orgId = o.body.data.organism.id;
    await json('/v1/memory', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: opName }] }, visibility: 'private' }) });
    const manifest = { manifestVersion: '1.0', id: orgId, name: 'Mode Org', kind: 'project', status: 'active', objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.note', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
    await json('/v1/memory', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });

    const inv = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(opToken), body: JSON.stringify({ email: `${invitedUsername}@example.com`, orgRole: 'member', workspaces: [{ ws: WS, role: 'contributor' }] }) });
    assert(inv.status === 201 || inv.status === 200, `invite mint: ${inv.status}: ${JSON.stringify(inv.body.error)}`);
    inviteToken = tokenFrom(inv.body.data.accept_url);
    assert(inviteToken.length > 0, 'accept_url carries a token');
});

await test('Discovery reports open, and switching mode is operator-only work that succeeds', async () => {
    const disc = await json('/?format=json');
    assert(disc.body?.for_ai_assistants?.decision_tree?.register_and_start?.registration_mode === 'open'
        || JSON.stringify(disc.body).includes('"registration_mode":"open"'), 'discovery shows open');
    const r = await setMode(opToken, 'closed');
    assert(r.status === 200, `set closed: ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('CLOSED: every account-creating door answers 403 REGISTRATION_CLOSED', async () => {
    const owners = await registerAndToken(`rmc1${Date.now()}`);
    assert(owners.status === 403 && owners.body.error?.code === 'REGISTRATION_CLOSED', `/v1/owners: ${owners.status} ${owners.body.error?.code}`);

    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `rmc2${Date.now()}`, display_name: 'x', password: 'ClosedDoor123' }) });
    assert(ghii.status === 403 && ghii.body.error?.code === 'REGISTRATION_CLOSED', `/v1/ghii: ${ghii.status} ${ghii.body.error?.code}`);

    const web = await json('/v1/ghii/register-web', { method: 'POST', body: JSON.stringify({ username: `rmc3${Date.now()}`, display_name: 'x' }) });
    assert(web.status === 403 && web.body.error?.code === 'REGISTRATION_CLOSED', `register-web: ${web.status} ${web.body.error?.code}`);

    const selfServe = await json('/v1/registration-invites', { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com', agent: { model: 'test-model' } }) });
    assert(selfServe.status === 403 && selfServe.body.error?.code === 'REGISTRATION_CLOSED', `registration-invites: ${selfServe.status} ${selfServe.body.error?.code}`);
});

await test('CLOSED: redeeming a valid invitation is refused AND the invite is not consumed', async () => {
    const accept = await json(`/v1/invitations/${inviteToken}/accept`, { method: 'POST', body: JSON.stringify({ username: invitedUsername, password: 'InviteJoin123' }) });
    assert(accept.status === 403 && accept.body.error?.code === 'REGISTRATION_CLOSED', `accept: ${accept.status} ${accept.body.error?.code}`);
    const still = await json(`/v1/invitations/${inviteToken}`);
    assert(still.status === 200, `refused invite must stay redeemable, got ${still.status}`);
});

await test('INVITE: direct doors stay refused', async () => {
    const r = await setMode(opToken, 'invite');
    assert(r.status === 200, `set invite: ${r.status}`);

    const owners = await registerAndToken(`rmi1${Date.now()}`);
    assert(owners.status === 403 && owners.body.error?.code === 'REGISTRATION_CLOSED', `/v1/owners: ${owners.status}`);
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `rmi2${Date.now()}`, display_name: 'x', password: 'InviteMode123' }) });
    assert(ghii.status === 403, `/v1/ghii: ${ghii.status}`);
    const selfServe = await json('/v1/registration-invites', { method: 'POST', body: JSON.stringify({ email: 'nobody2@example.com', agent: { model: 'test-model' } }) });
    assert(selfServe.status === 403, `registration-invites: ${selfServe.status}`);
});

await test('INVITE: the member-minted invitation still creates the account', async () => {
    const accept = await json(`/v1/invitations/${inviteToken}/accept`, { method: 'POST', body: JSON.stringify({ username: invitedUsername, password: 'InviteJoin123', display_name: 'Invited' }) });
    assert(accept.status === 200, `accept: ${accept.status}: ${JSON.stringify(accept.body.error)}`);
    assert(accept.body.data.created_account === true, 'a new account was created through the invitation');
    invitedUserToken = accept.body.data.token;
    assert(typeof invitedUserToken === 'string' && invitedUserToken.length > 0, 'invited user got a session');
});

await test('The config door is operator-only: the invited member cannot reopen registration', async () => {
    const r = await setMode(invitedUserToken, 'open');
    assert(r.status === 403, `non-operator mode change expected 403, got ${r.status}`);
    const anon = await json('/v1/admin/config', { method: 'PUT', body: JSON.stringify({ changes: [{ path: 'registration.mode', value: 'open' }] }) });
    assert(anon.status === 401, `anonymous mode change expected 401, got ${anon.status}`);
});

await test('OPEN again: direct registration works and discovery reports it', async () => {
    const r = await setMode(opToken, 'open');
    assert(r.status === 200, `set open: ${r.status}`);
    const back = await registerAndToken(`rmo1${Date.now()}`);
    assert(back.status === 201, `/v1/owners after reopen: ${back.status}`);
    const disc = await json('/?format=json');
    assert(JSON.stringify(disc.body).includes('"registration_mode":"open"'), 'discovery shows open again');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
