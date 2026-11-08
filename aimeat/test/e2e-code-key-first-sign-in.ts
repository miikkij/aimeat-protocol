/**
 * @file test/e2e-code-key-first-sign-in.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A code key's first sign-in replaces the key, whichever way the holder signs in, and a
 *   code key acts only on the account it made (secaudit2026nov08 round 14).
 *
 *   WHY. An organism owner mints a code key: the node makes an account whose password is the code, and
 *   the owner who minted it knows the code. The holder's first sign-in replaces it with a password only
 *   the holder sees. (1) That replacement ran only on a password or passkey sign-in with a login count
 *   of 0, so a holder whose first sign-in was an emailed link (or an identity provider) kept the code as
 *   a working password, and the key could no longer be cancelled
 *   (key-credentials:rotation-gated-on-login-count-not-pending-invitation). (2) The key's invitation
 *   names its account by the bare name, which is released when the account is erased, so a key whose
 *   account was erased cancelled (erased) the next account of that name, and a cancelled key replaced
 *   the password of a later account of the name at its first sign-in
 *   (routes/organisms/workspace-access.ts:code-invitation-provisionedOwner-survives-account-erasure).
 *
 *   WHAT IT PROVES. A link sign-in as the key's first sign-in goes to the sign-in details screen
 *   (`/?auth_step=key_credentials`), the code stops signing in, and that session (only it, only once)
 *   gets a new password at POST /v1/ghii/key-credentials, which signs in. A key whose account was
 *   erased does not touch the next account of the name; a cancelled key does not replace the
 *   password of a later account of the name. Kept: a key's first password sign-in still answers the
 *   new password and the code stops working; cancelling an un-used key still removes its account; the
 *   owner of another organism is refused the cancel (403).
 *
 *   Runs on the runner's node (no mail needed): the address is marked verified and the link issued
 *   behind the server's back (helpers/seed-password.ts seedSignInLink).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-code-key-first-sign-in
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { registerOwner } from './helpers/owner-login.js';
import { seedSignInLink } from './helpers/seed-password.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const STAMP = `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const login = (username: string, password: string) => json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password }) });

async function organismOf(token: string, label: string): Promise<string> {
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(token),
        body: JSON.stringify({ name: `Key ${label} ${STAMP}`, type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body?.error)}`);
    return org.body.data.organism.id as string;
}

async function mintKey(token: string, orgId: string, username: string, code: string): Promise<string> {
    const r = await json(`/v1/organisms/${orgId}/invitations/code`, { method: 'POST', headers: auth(token),
        body: JSON.stringify({ email: `${username}@example.test`, username, code, display_name: username }) });
    assert(r.status === 201, `mint ${username} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.invitation.id as string;
}

/** Open a sign-in link as a browser does: the redirect and the session's access token. */
async function openLink(username: string): Promise<{ location: string; token: string }> {
    const link = await seedSignInLink(BASE, username, `${username}@example.test`);
    const opened = await fetch(link, { redirect: 'manual' });
    const rt = /(?:^|;\s*)aimeat_rt=([^;]*)/m.exec(opened.headers.getSetCookie().join('\n'))?.[1];
    assert(opened.status === 302 && !!rt, `the link opened no session: ${opened.status} ${opened.headers.get('location')}`);
    const refreshed = await fetch(`${BASE}/v1/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `aimeat_rt=${rt}`, 'X-AIMEAT-Refresh': '1' },
    });
    const body = await refreshed.json() as { data?: { token?: string } };
    assert(refreshed.status === 200 && typeof body.data?.token === 'string', `refresh ${refreshed.status}`);
    return { location: opened.headers.get('location') ?? '', token: body.data!.token! };
}

console.log('\n=== A code key\'s first sign-in, every way in ===\n');

const alice = await registerOwner(BASE, `ckalice${STAMP}`);
const bob = await registerOwner(BASE, `ckbob${STAMP}`);
const aliceOrg = await organismOf(alice.token, 'alice');
const bobOrg = await organismOf(bob.token, 'bob');

await test('a key whose first sign-in is an emailed link stops being the password, and that session gets the new one once', async () => {
    const holder = `cklink${STAMP}`, code = 'LinkKeyCode-1234';
    await mintKey(alice.token, aliceOrg, holder, code);
    const first = await openLink(holder);
    const byCode = await login(holder, code);
    assert(byCode.status === 401, `the key still signs in after the holder's first sign-in by a link: ${byCode.status}`);
    assert(/\/\?auth_step=key_credentials$/.test(first.location), `the first sign-in goes to the sign-in details screen: ${first.location}`);
    const shown = await json('/v1/ghii/key-credentials', { method: 'POST', headers: auth(first.token), body: '{}' });
    assert(shown.status === 200 && typeof shown.body.data?.key_credentials?.password === 'string',
        `the screen gets the new details: ${shown.status} ${JSON.stringify(shown.body?.error)}`);
    assert(shown.body.data.key_credentials.username === holder, `the details name the account: ${shown.body.data.key_credentials.username}`);
    assert(shown.body.data.key_credentials.email_sent === false, 'the details are shown, not mailed');
    const again = await json('/v1/ghii/key-credentials', { method: 'POST', headers: auth(first.token), body: '{}' });
    assert(again.status === 404, `the details are given once: ${again.status}`);
    const fresh = await login(holder, shown.body.data.key_credentials.password);
    assert(fresh.status === 200 && !fresh.body.data.key_credentials, `the new password signs in: ${fresh.status} ${JSON.stringify(fresh.body?.error)}`);
});

await test('the details wait only for the session that signed in: another session of the account gets none', async () => {
    const holder = `cklink2${STAMP}`, code = 'LinkKeyCode-5678';
    await mintKey(alice.token, aliceOrg, holder, code);
    await openLink(holder);
    const other = await openLink(holder);
    assert(!/auth_step=key_credentials/.test(other.location), `a later sign-in is not a first one: ${other.location}`);
    const shown = await json('/v1/ghii/key-credentials', { method: 'POST', headers: auth(other.token), body: '{}' });
    assert(shown.status === 404, `another session gets the details: ${shown.status}`);
});

await test('kept: a key\'s first password sign-in answers the new password, and the code stops working', async () => {
    const holder = `ckpw${STAMP}`, code = 'PwKeyCode-12345';
    await mintKey(alice.token, aliceOrg, holder, code);
    const first = await login(holder, code);
    assert(first.status === 200 && typeof first.body.data.key_credentials?.password === 'string',
        `first sign-in ${first.status}: ${JSON.stringify(first.body.data?.key_credentials ?? first.body.error)}`);
    assert((await login(holder, code)).status === 401, 'the code still signs in');
    const later = await openLink(holder);
    assert(!/auth_step=key_credentials/.test(later.location), `a link after the first sign-in is a plain sign-in: ${later.location}`);
});

await test('a key whose account was erased leaves the next account of the name alone when it is cancelled', async () => {
    const name = `ckreuse${STAMP}`;
    const oldKey = await mintKey(alice.token, aliceOrg, name, 'ReuseKeyCode-111');
    const first = await login(name, 'ReuseKeyCode-111');
    assert(first.status === 200, `first sign-in ${first.status}`);
    const del = await json(`/v1/owners/${name}`, { method: 'DELETE', headers: auth(first.body.data.token) });
    assert(del.status === 200, `self delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
    await mintKey(bob.token, bobOrg, name, 'ReuseKeyCode-222');
    await json(`/v1/organisms/${aliceOrg}/invitations/code/${oldKey}/cancel`, { method: 'POST', headers: auth(alice.token), body: '{}' });
    const bobs = await login(name, 'ReuseKeyCode-222');
    assert(bobs.status === 200, `the next account of the name was removed by the old key's cancel: ${bobs.status} ${JSON.stringify(bobs.body?.error)}`);
    assert(typeof bobs.body.data.key_credentials?.password === 'string', 'the new key\'s own first sign-in still replaces its code');
});

await test('a cancelled key does not replace the password of a later account of the name', async () => {
    const name = `ckcancel${STAMP}`;
    const key = await mintKey(alice.token, aliceOrg, name, 'CancelKeyCode-11');
    const cancel = await json(`/v1/organisms/${aliceOrg}/invitations/code/${key}/cancel`, { method: 'POST', headers: auth(alice.token), body: '{}' });
    assert(cancel.status === 200, `kept: an un-used key is cancelled and its account removed: ${cancel.status} ${JSON.stringify(cancel.body?.error)}`);
    assert((await login(name, 'CancelKeyCode-11')).status === 401, 'kept: the cancelled key\'s account is gone');
    const chosen = 'Chosen-Password-77';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: chosen }) });
    assert(reg.status === 201, `a later account of the name registers: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const first = await login(name, chosen);
    assert(first.status === 200 && !first.body.data.key_credentials,
        `the old key replaced a later account's password at its first sign-in: ${first.status} ${JSON.stringify(first.body.data?.key_credentials)}`);
    const second = await login(name, chosen);
    assert(second.status === 200, `the chosen password no longer signs in: ${second.status}`);
});

await test('the owner of another organism cannot cancel this organism\'s key, and its account stays', async () => {
    const name = `ckother${STAMP}`;
    const key = await mintKey(alice.token, aliceOrg, name, 'OtherKeyCode-123');
    const r = await json(`/v1/organisms/${aliceOrg}/invitations/code/${key}/cancel`, { method: 'POST', headers: auth(bob.token), body: '{}' });
    assert(r.status === 403, `another organism's owner cancelled the key: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const first = await login(name, 'OtherKeyCode-123');
    assert(first.status === 200, `the key's account is gone after a refused cancel: ${first.status}`);
});

await test('POST /v1/ghii/key-credentials refuses a caller with no sign-in', async () => {
    const r = await json('/v1/ghii/key-credentials', { method: 'POST', body: '{}' });
    assert(r.status === 401, `no token: ${r.status}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
