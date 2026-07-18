/**
 * @file e2e-invitations.ts
 * @description E2E for EMAIL invitations (invite people not yet on the node). Covers: creating an
 *   invite (organism role + a workspace at contributor), the public GET details, a NEW user
 *   registering + joining via the token in one step, the applied membership + workspace read, the
 *   single-use guard, cancel-then-rejected, an already-logged-in user accepting, and the failure
 *   modes (non-admin invite, invalid email, bogus token, taken username).
 *   Also covers PROVISIONED-CODE invitations ("keys"): mint provisions a verified, joined account
 *   whose emailed code is its password (C1–C2), activation is derived from first login and blocks
 *   cancel (C3), the per-inviter quota caps a plain member at 3 (C4), cancelling an un-activated key
 *   deletes the account + frees a slot (C5), input validation (C6), and non-members are refused (C7).
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 *   v1.1.0 — 2026-07-05 — Add provisioned-code invitation ("key") coverage (C1–C7).
 *   v1.2.0 — 2026-07-07 — Cover first-login durable credentials (C2 + C2b): the response issues a
 *     dash-free, validator-clean password once, rotating away the bootstrap code (TARGET-011).
 *   v1.3.0 — 2026-07-18 — Recipient-binding on a signed-in accept (invite-hijack fix): matched verified
 *     email → 200 (10), different verified email → 403 EMAIL_MISMATCH + invite stays pending (10b), no
 *     verified email → 403 (10c), GET `viewer` verdict (10d). Part C return_url: allowlisted target
 *     round-trips (10e), non-allowlisted target is dropped to the default redirect (10f).
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

// ── Recipient binding: a signed-in session may accept ONLY if its verified email == the invited
//    address (invite-hijack guard). Registering via an invite records the invited email as verified,
//    so we mint verified-email accounts by accepting a first invite, then test the accept-as-self path. ──

/** Invite `email`, register a fresh account via the token, and return its session token + verified email. */
async function registerVerified(email: string): Promise<{ name: string; token: string; email: string }> {
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email, orgRole: 'member' }) });
    const tk = tokenFrom(c.body.data.accept_url);
    const name = `ver${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const acc = await json(`/v1/invitations/${tk}/accept`, { method: 'POST', body: JSON.stringify({ username: name, password: 'VerPass1234' }) });
    assert(acc.status === 200 && typeof acc.body.data.token === 'string', `registerVerified accept ${acc.status}: ${JSON.stringify(acc.body.error)}`);
    return { name, token: acc.body.data.token, email };
}

let V: { name: string; token: string; email: string };
await test('10. Logged-in account whose verified email MATCHES accepts as self (200)', async () => {
    const matchEmail = `match.${Date.now()}@example.com`;
    V = await registerVerified(matchEmail); // verified email = matchEmail, already a member
    // A second invite to the SAME email — the matched, signed-in account may absorb it.
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: matchEmail, orgRole: 'member' }) });
    const t = tokenFrom(c.body.data.accept_url);
    const acc = await json(`/v1/invitations/${t}/accept`, { method: 'POST', headers: auth(V.token), body: '{}' });
    assert(acc.status === 200 && acc.body.data.status === 'joined', `matched authed accept ${acc.status}: ${JSON.stringify(acc.body.error)}`);
    assert(acc.body.data.created_account === false, 'did not create a new account');
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === V.name), 'V is a member');
});

await test('10b. Logged-in account with a DIFFERENT verified email → 403 EMAIL_MISMATCH (invite stays pending)', async () => {
    const otherEmail = `other.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: otherEmail, orgRole: 'member' }) });
    const t = tokenFrom(c.body.data.accept_url);
    const acc = await json(`/v1/invitations/${t}/accept`, { method: 'POST', headers: auth(V.token), body: '{}' }); // V's verified email ≠ otherEmail
    assert(acc.status === 403, `expected 403, got ${acc.status}`);
    assert(acc.body.error?.code === 'EMAIL_MISMATCH', `expected EMAIL_MISMATCH, got ${acc.body.error?.code}`);
    // NOT consumed — the right party can still use it.
    const get = await json(`/v1/invitations/${t}`);
    assert(get.status === 200, `invite should still be pending, got ${get.status}`);
});

await test('10c. Logged-in account with NO verified email → 403 (invite not consumed)', async () => {
    const noVerEmail = `nover.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: noVerEmail, orgRole: 'member' }) });
    const t = tokenFrom(c.body.data.accept_url);
    const acc = await json(`/v1/invitations/${t}/accept`, { method: 'POST', headers: auth(B.token), body: '{}' }); // B (POST /v1/ghii) has no verified email
    assert(acc.status === 403 && acc.body.error?.code === 'EMAIL_MISMATCH', `expected 403 EMAIL_MISMATCH, got ${acc.status} ${acc.body.error?.code}`);
    const get = await json(`/v1/invitations/${t}`);
    assert(get.status === 200, `invite should still be pending, got ${get.status}`);
});

await test('10d. GET details carries a per-session viewer verdict (match true / mismatch false)', async () => {
    const vEmail = `viewer.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: V.email, orgRole: 'member' }) });
    const tMatch = tokenFrom(c.body.data.accept_url);
    const gMatch = await json(`/v1/invitations/${tMatch}`, { headers: auth(V.token) });
    assert(gMatch.body.data.viewer?.email_matches === true && gMatch.body.data.viewer?.has_verified_email === true, `viewer should match: ${JSON.stringify(gMatch.body.data.viewer)}`);
    assert(gMatch.body.data.viewer?.owner === V.name, 'viewer.owner is the session owner');
    // A different invited email → the same session is a mismatch; an anon GET returns no viewer.
    const c2 = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: vEmail, orgRole: 'member' }) });
    const tMiss = tokenFrom(c2.body.data.accept_url);
    const gMiss = await json(`/v1/invitations/${tMiss}`, { headers: auth(V.token) });
    assert(gMiss.body.data.viewer?.email_matches === false, 'viewer should be a mismatch for a different email');
    const gAnon = await json(`/v1/invitations/${tMiss}`);
    assert(gAnon.status === 200 && !gAnon.body.data.viewer, 'anon GET carries no viewer verdict');
});

await test('10e. Part C — an allowlisted return_url round-trips to the accept redirect', async () => {
    const rEmail = `ret.${Date.now()}@example.com`;
    const ret = 'https://experience-center.apps.localhost/'; // app-origin subdomain — allowlisted on a localhost node
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: rEmail, orgRole: 'member', return_url: ret }) });
    assert(c.status === 201, `invite ${c.status}: ${JSON.stringify(c.body.error)}`);
    const t = tokenFrom(c.body.data.accept_url);
    const uname = `retu${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const acc = await json(`/v1/invitations/${t}/accept`, { method: 'POST', body: JSON.stringify({ username: uname, password: 'RetPass1234' }) });
    assert(acc.status === 200, `accept ${acc.status}: ${JSON.stringify(acc.body.error)}`);
    assert(acc.body.data.redirect === ret, `redirect should be the return target, got ${acc.body.data.redirect}`);
});

await test('10f. Part C — a non-allowlisted return_url is dropped (no open redirect)', async () => {
    const eEmail = `evil.${Date.now()}@example.com`;
    const c = await json(`/v1/organisms/${orgId}/invitations/email`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: eEmail, orgRole: 'member', return_url: 'https://evil.example.com/phish' }) });
    assert(c.status === 201, `invite ${c.status}: ${JSON.stringify(c.body.error)}`);
    const t = tokenFrom(c.body.data.accept_url);
    const uname = `evilu${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const acc = await json(`/v1/invitations/${t}/accept`, { method: 'POST', body: JSON.stringify({ username: uname, password: 'EvilPass1234' }) });
    assert(acc.status === 200, `accept ${acc.status}: ${JSON.stringify(acc.body.error)}`);
    assert(acc.body.data.redirect === '/v1/profile#organisms', `non-allowlisted target must fall back to the default, got ${acc.body.data.redirect}`);
});

await test('10g. A direct-adds B as a plain member (code-key quota tests below mint as B)', async () => {
    // Recipient binding means B (no verified email) can no longer join by accepting an email invite —
    // so make B a member the operator way (direct add), which is exactly the flow those customers use.
    const r = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ghii: B.name, role: 'member' }) });
    assert(r.status === 200 || r.status === 201, `direct-add B ${r.status}: ${JSON.stringify(r.body.error)}`);
    const m = await json(`/v1/organisms/${orgId}/members`, { headers: auth(A.token) });
    assert((m.body.data.members || []).some((x: any) => x.ghii === B.name && x.status === 'active'), 'B is now an active member');
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

// ── Provisioned-code invitations ("keys"): the emailed code IS the account password ──
const provisioned: { u: string; c: string }[] = []; // for cleanup (login + delete self)
const codeUser1 = `e2ekey1${Date.now()}`;
const codeCode1 = 'EXC91-ABCD-EFGH-JKLM';
let codeInvId1 = '';

await test('C1. A (creator) mints a code key → provisions a verified, joined account (unlimited)', async () => {
    const r = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: `key1.${Date.now()}@example.com`, username: codeUser1, code: codeCode1, display_name: 'EXC_VIP_91', locale: 'en', message: 'welcome', landing_url: 'https://m-room.apps.aimeat.io/', workspaces: [{ ws: WS, role: 'viewer' }] }) });
    assert(r.status === 201, `mint ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.invitation.type === 'code', 'invitation type is code');
    assert(r.body.data.invitation.status === 'pending', 'pending');
    assert(r.body.data.invitation.provisioned_owner === codeUser1, 'links the provisioned owner');
    codeInvId1 = r.body.data.invitation.id;
    provisioned.push({ u: codeUser1, c: codeCode1 });
});

let codeCred1: { username: string; password: string; email_sent: boolean } | null = null;
await test('C2. The code IS the password: the provisioned account logs in and reads the room', async () => {
    const lg = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: codeUser1, password: codeCode1 }) });
    assert(lg.status === 200, `login ${lg.status}: ${JSON.stringify(lg.body.error)}`); // email gate lifted at mint
    const tok = lg.body.data.token as string;
    assert(typeof tok === 'string' && tok.length > 0, 'login returns a session token');
    const read = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(tok) });
    assert(read.status === 200 && !!read.body.data.manifest, `keyholder can read the room with a viewer grant (${read.status})`);
    // TARGET-011: first sign-in issues durable credentials in the response (username + clean password).
    codeCred1 = lg.body.data.key_credentials;
    assert(!!codeCred1, 'first login returns key_credentials');
    assert(codeCred1!.username === codeUser1, `credential username is the exact login name (got ${codeCred1!.username})`);
    provisioned[0].c = codeCred1!.password; // keep cleanup working after the rotation
});

await test('C2b. First-login credential: dash-free, validator-clean; old code dies, new password logs in', async () => {
    assert(!!codeCred1, 'need credentials from C2');
    const pw = codeCred1!.password;
    assert(!pw.includes('-') && !/\s/.test(pw), `issued password has no dashes/spaces (got ${pw})`);
    assert(pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw), `issued password passes strength rules (got ${pw})`);
    assert(typeof codeCred1!.email_sent === 'boolean', 'email_sent is reported');
    // The dash-carrying bootstrap code is now dead; the issued password is the durable login.
    const old = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: codeUser1, password: codeCode1 }) });
    assert(old.status !== 200, `old code should no longer log in, got ${old.status}`);
    const fresh = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: codeUser1, password: pw }) });
    assert(fresh.status === 200, `issued password logs in, got ${fresh.status}: ${JSON.stringify(fresh.body.error)}`);
    // Idempotent: a later login does NOT re-issue credentials.
    assert(!fresh.body.data.key_credentials, 'credentials are issued once, not on every login');
});

await test('C3. After activation the key shows activated and cannot be cancelled (409)', async () => {
    const list = await json(`/v1/organisms/${orgId}/invitations/code`, { headers: auth(A.token) });
    assert(list.status === 200, `list ${list.status}`);
    const it = (list.body.data.items || []).find((x: any) => x.id === codeInvId1);
    assert(it && it.activated === true, `key is activated after login (got ${JSON.stringify(it)})`);
    const cancel = await json(`/v1/organisms/${orgId}/invitations/code/${codeInvId1}/cancel`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(cancel.status === 409, `activated cancel expected 409, got ${cancel.status}`);
});

const bMints: { u: string; c: string; id: string }[] = [];
await test('C4. Per-inviter quota: a plain member mints 3, the 4th is 429', async () => {
    for (let i = 0; i < 3; i++) {
        const u = `e2eq${i}${Date.now()}`;
        const c = `EXC8${i}-ABCD-EFGH-JKLM`;
        const r = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ email: `q${i}.${Date.now()}@example.com`, username: u, code: c }) });
        assert(r.status === 201, `member mint ${i} ${r.status}: ${JSON.stringify(r.body.error)}`);
        bMints.push({ u, c, id: r.body.data.invitation.id }); provisioned.push({ u, c });
    }
    const over = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ email: `q4.${Date.now()}@example.com`, username: `e2eq4${Date.now()}`, code: 'EXC84-ABCD-EFGH-JKLM' }) });
    assert(over.status === 429, `4th mint expected 429, got ${over.status}`);
    const list = await json(`/v1/organisms/${orgId}/invitations/code`, { headers: auth(B.token) });
    assert(list.body.data.quota.used === 3 && list.body.data.quota.limit === 3, `quota reports 3/3 (got ${JSON.stringify(list.body.data.quota)})`);
});

await test('C5. Cancelling an un-activated key deletes the account and frees a slot', async () => {
    const target = bMints[0];
    const cancel = await json(`/v1/organisms/${orgId}/invitations/code/${target.id}/cancel`, { method: 'POST', headers: auth(B.token), body: '{}' });
    assert(cancel.status === 200 && cancel.body.data.status === 'cancelled', `cancel ${cancel.status}: ${JSON.stringify(cancel.body.error)}`);
    // The provisioned account is gone (login now fails).
    const lg = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: target.u, password: target.c }) });
    assert(lg.status !== 200, `deleted account should not log in, got ${lg.status}`);
    // Slot freed → B can mint again.
    const u = `e2eq5${Date.now()}`, c = 'EXC85-ABCD-EFGH-JKLM';
    const again = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ email: `q5.${Date.now()}@example.com`, username: u, code: c }) });
    assert(again.status === 201, `mint after cancel expected 201, got ${again.status}`);
    provisioned.push({ u, c });
});

await test('C6. Mint validates: bad email → 400, short code → 400', async () => {
    const bad1 = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: 'nope', username: `e2ebad${Date.now()}`, code: 'EXC90-ABCD-EFGH-JKLM' }) });
    assert(bad1.status === 400, `bad email expected 400, got ${bad1.status}`);
    const bad2 = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: `ok.${Date.now()}@example.com`, username: `e2ebad2${Date.now()}`, code: 'short' }) });
    assert(bad2.status === 400, `short code expected 400, got ${bad2.status}`);
});

await test('C7. A non-member cannot mint a key (403)', async () => {
    const D = await setupOwner('d');
    const r = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(D.token), body: JSON.stringify({ email: `z.${Date.now()}@example.com`, username: `e2ez${Date.now()}`, code: 'EXC99-ABCD-EFGH-JKLM' }) });
    assert(r.status === 403, `non-member mint expected 403, got ${r.status}`);
    await json(`/v1/owners/${D.name}`, { method: 'DELETE', headers: auth(D.token) });
});

await test('Cleanup', async () => {
    // Delete any provisioned key accounts that still exist (login with the code, then delete self).
    for (const p of provisioned) {
        const lg = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: p.u, password: p.c }) });
        if (lg.status === 200) await json(`/v1/owners/${p.u}`, { method: 'DELETE', headers: auth(lg.body.data.token) });
    }
    await json(`/v1/owners/${A.name}`, { method: 'DELETE', headers: auth(A.token) });
    await json(`/v1/owners/${B.name}`, { method: 'DELETE', headers: auth(B.token) });
    await json(`/v1/owners/${newUsername}`, { method: 'DELETE', headers: auth(newUserToken) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
