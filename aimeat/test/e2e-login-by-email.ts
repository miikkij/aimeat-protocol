/**
 * @file e2e-login-by-email.ts
 * @description E2E for signing in with the account's verified email instead of its handle. People
 *   remember the address they signed up with; the handle they picked once, less so. The email only
 *   SELECTS the account — the password is still the only thing that authenticates.
 *
 *   The verified-email account is provisioned through the organism code-invite flow, which is the
 *   one e2e-safe way to bind a VERIFIED address without SMTP (same technique as
 *   e2e-login-attach-email). Failure modes covered: an unverified address must not resolve, a wrong
 *   password against a valid address fails like any wrong password, an unknown address answers the
 *   same 401 (no enumeration), a full GHII is still read as a GHII, and an email whose domain looks
 *   like a node (`someone@gmail.com`) must never dial federation.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-login-by-email
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 1000000;
const invitee = `lbe${stamp}`;
const inviteeEmail = `lbe${stamp}@example.test`;
const INVITE_CODE = 'SuperSecret99';
const PASSWORD = 'Sekretissimo9';
/** The durable password the node issues on a code account's FIRST sign-in (the bootstrap code is
 *  rotated away then, by design — see services/key-credentials.ts). Everything after phase 0 uses it. */
let livePassword = INVITE_CODE;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const login = (username: string, password: string) =>
    json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password }) });

console.log('\n=== Login-by-email E2E Tests ===\n');
console.log('Phase 0: an account whose email is VERIFIED');

await test('Provision the account through an organism code-invite', async () => {
    const inviterName = `lbeinv${stamp}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: inviterName, display_name: 'Inviter', password: 'InviteP123x' }),
    });
    assert(reg.status === 201, `inviter reg ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: inviterName, timestamp: ts, signature: await sign(reg.body.data.private_key, inviterName + NODE_ID + ts) }),
    });
    const token = tok.body.data.token as string;
    const org = await json('/v1/organisms', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `LBE Org ${stamp}`, type: 'project', join_policy: 'invite_only', visibility: 'public' }),
    });
    assert(org.status === 201, `org ${org.status}: ${JSON.stringify(org.body.error)}`);
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteeEmail, username: invitee, code: INVITE_CODE, display_name: 'Has Mail' }),
    });
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
});

await test('The handle + its code signs in, and hands back the durable password', async () => {
    const r = await login(invitee, INVITE_CODE);
    assert(r.status === 200, `handle login ${r.status}: ${JSON.stringify(r.body.error)}`);
    const issued = r.body.data?.key_credentials?.password;
    assert(typeof issued === 'string' && issued.length > 0,
        `first sign-in must issue a durable password: ${JSON.stringify(r.body.data?.key_credentials)}`);
    livePassword = issued;
    const again = await login(invitee, livePassword);
    assert(again.status === 200, `the issued password must keep working: ${again.status}`);
});

console.log('\nPhase 1: the email as the identifier');

await test('The VERIFIED email signs in and resolves to that account', async () => {
    const r = await login(inviteeEmail, livePassword);
    assert(r.status === 200, `email login ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.ghii?.ghii === `${invitee}@${NODE_ID}`,
        `the email must resolve to ${invitee}, got ${JSON.stringify(r.body.data?.ghii)}`);
});

await test('Case and surrounding whitespace do not matter', async () => {
    const r = await login(`  ${inviteeEmail.toUpperCase()}  `, livePassword);
    assert(r.status === 200, `mixed-case email login ${r.status}: ${JSON.stringify(r.body.error)}`);
});

console.log('\nPhase 2: the failure modes');

await test('An UNVERIFIED address does not resolve to its account', async () => {
    // Registration records an address but does not verify it. Until the code is confirmed, that
    // address must select nothing — otherwise claiming an address would reach the account.
    const other = `lbeun${stamp}`;
    const otherEmail = `lbeun${stamp}@example.test`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: other, display_name: other, password: PASSWORD, email: otherEmail }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const byHandle = await login(other, PASSWORD);
    assert(byHandle.status === 200, `the handle must still work: ${byHandle.status}`);
    const byEmail = await login(otherEmail, PASSWORD);
    assert(byEmail.status === 401, `an unverified address must not sign in; got ${byEmail.status}`);
});

await test('A verified email with the WRONG password is refused', async () => {
    const r = await login(inviteeEmail, 'not-the-password');
    assert(r.status === 401, `wrong password must be 401; got ${r.status}`);
});

await test('An address matching NO account answers the same 401 (no enumeration)', async () => {
    const r = await login(`nobody${stamp}@example.test`, PASSWORD);
    assert(r.status === 401, `unknown address must be 401; got ${r.status}`);
    assert(/invalid username or password/i.test(r.body.error?.message ?? ''),
        `the message must not reveal that the address is unknown: ${JSON.stringify(r.body.error)}`);
});

await test('A full local GHII is still read as a GHII, not as an email', async () => {
    const r = await login(`${invitee}@${NODE_ID}`, livePassword);
    assert(r.status === 200, `local GHII login ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('An email whose domain looks like a node never dials federation', async () => {
    // `someone@gmail.com` must resolve as an address (and fail 401), never route to a node called
    // "gmail.com" — the exact confusion the identifier parser exists to prevent.
    const r = await login('someone@gmail.com', PASSWORD);
    assert(r.status === 401, `an email must not route to federation; got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(!/FEDERATION/i.test(r.body.error?.code ?? ''),
        `an email must not produce a federation error: ${JSON.stringify(r.body.error)}`);
});

console.log(`\n=== Login-by-email: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
