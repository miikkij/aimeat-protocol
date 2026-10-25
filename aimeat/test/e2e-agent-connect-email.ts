/**
 * @file e2e-agent-connect-email.ts
 * @description E2E for email-or-handle connect: POST /v1/agents/device-authorize accepts the `owner`
 *   value as either the account HANDLE (unchanged) or the account's VERIFIED email (case-insensitive),
 *   resolving an email to the owning handle before the RFC 8628 flow. Also asserts the one-verified-
 *   email-per-account-per-node invariant that the resolver relies on (a duplicate verified email is
 *   refused, so an email can never map to two accounts).
 * @version-history
 *   v1.0.1 — 2026-10-06 — A code key's account starts unverified (secaudit 2026-10 follow-up, A1), so
 *     the fixture marks the address verified with helpers/verified-email.ts.
 *   v1.0.0 — 2026-07-19 — Initial: email→handle resolution (found/handle/unknown/malformed) + uniqueness.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-connect-email

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

import { markEmailVerified } from './helpers/verified-email.js';
import { ownerSignIn } from './helpers/owner-login.js';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Register an owner and return a bearer token (inviter for the code-invite provisioning). */
async function setupOwner(label: string) {
    const name = `cxe${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Connect ${label.toUpperCase()}`, password: 'ConnX1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Connect ${label.toUpperCase()}`, password: 'ConnX1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'ConnX1234');
    return { name, token: tok.body.data.token as string };
}

/**
 * Provision an account WITH a verified email: a code key makes the account (its address unverified
 * since 2026-10-06), and helpers/verified-email.ts marks the address verified, because interactive
 * verification needs real mail delivery. Returns the mint's answer.
 */
async function provisionVerifiedEmailAccount(inviterToken: string, email: string, username: string): Promise<{ status: number; body: any }> {
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(inviterToken), body: JSON.stringify({ name: 'Connect Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(inviterToken),
        body: JSON.stringify({ email, username, code: 'SuperSecret99', display_name: 'Connect Target' }),
    });
    if (mint.status === 201) await markEmailVerified(username, email);
    return mint;
}

const deviceAuthorize = (owner: string) => json('/v1/agents/device-authorize', {
    method: 'POST', body: JSON.stringify({ owner, agent_name: 'assistant' }),
});
/**
 * The owner recorded on the pending request: the account whose own pending list holds it. The
 * unauthenticated consent-info endpoint names the owner only to that owner (secaudit2026oct22).
 */
let targetToken = '';
async function pendingOwnerFor(userCode: string): Promise<string> {
    if (!targetToken) targetToken = (await ownerSignIn(BASE, target, 'SuperSecret99')).body.data.token as string;
    const list = await json('/v1/agents/device-authorize/pending', { headers: auth(targetToken) });
    assert(list.status === 200, `pending list ${list.status}`);
    const mine = ((list.body.data.requests ?? []) as Array<{ user_code: string }>).some(r => r.user_code === userCode);
    return mine ? target : '(not in the target account\'s pending list)';
}

console.log('\n=== AIMEAT Agent Connect by Email E2E ===\n');

let inviter: Awaited<ReturnType<typeof setupOwner>>;
let target = '';                 // handle of the verified-email account
const email = `connectme-${Date.now()}@example.com`;

await test('Setup: inviter + a verified-email account (code-invite)', async () => {
    inviter = await setupOwner('inv');
    target = `cxtgt${Date.now()}`;
    const mint = await provisionVerifiedEmailAccount(inviter.token, email, target);
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
});

await test('1. device-authorize with the verified EMAIL resolves to the account handle', async () => {
    const r = await deviceAuthorize(email);
    assert(r.status === 200 && r.body.ok === true, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    const owner = await pendingOwnerFor(r.body.data.user_code);
    assert(owner === target, `pending owner ${owner} !== ${target}`);
});

await test('2. Email match is CASE-INSENSITIVE', async () => {
    const r = await deviceAuthorize(email.toUpperCase());
    assert(r.status === 200 && r.body.ok === true, `authorize(upper) ${r.status}`);
    const owner = await pendingOwnerFor(r.body.data.user_code);
    assert(owner === target, `pending owner ${owner} !== ${target} (case-insensitive)`);
});

await test('3. The HANDLE still works unchanged', async () => {
    const r = await deviceAuthorize(target);
    assert(r.status === 200 && r.body.ok === true, `authorize(handle) ${r.status}`);
    const owner = await pendingOwnerFor(r.body.data.user_code);
    assert(owner === target, `pending owner ${owner} !== ${target}`);
});

await test('4. Unknown email → 404 NO_ACCOUNT (actionable)', async () => {
    const r = await deviceAuthorize(`nobody-${Date.now()}@example.com`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body.error?.code === 'NO_ACCOUNT', `code ${r.body.error?.code}`);
});

await test('5. Malformed email (has @, not valid) → 400 INVALID_EMAIL', async () => {
    const r = await deviceAuthorize('foo@bar');
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_EMAIL', `code ${r.body.error?.code}`);
});

await test('6. Invariant: a second account cannot claim the SAME verified email', async () => {
    const dupMint = await provisionVerifiedEmailAccount(inviter.token, email, `cxdup${Date.now()}`);
    assert(dupMint.status !== 201, `duplicate verified email was accepted (${dupMint.status}) — invariant broken`);
    // …and the email still resolves to the ORIGINAL account (never became ambiguous).
    const r = await deviceAuthorize(email);
    assert(r.status === 200, `authorize after dup ${r.status}: ${JSON.stringify(r.body.error)}`);
    const owner = await pendingOwnerFor(r.body.data.user_code);
    assert(owner === target, `email still resolves to original ${target}, got ${owner}`);
});

await test('7. Another person cannot make an account here through somebody else\'s organism, and a key never makes an address resolve', async () => {
    // A code key is how an account comes to hold an address without its owner typing it, so who may
    // mint one decides who can bind an address to an account (secaudit 2026-10 follow-up, A1).
    const stranger = await setupOwner('str');
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(inviter.token), body: JSON.stringify({ name: 'Connect Org 2', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const victim = `victim-${Date.now()}@example.com`;
    const refused = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ email: victim, username: `cxvic${Date.now()}`, code: 'SuperSecret99' }),
    });
    assert(refused.status === 403, `a stranger minted a key in another person's organism: ${refused.status}`);
    // The owner's own key makes the account, and the address it names still resolves to nobody.
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(inviter.token),
        body: JSON.stringify({ email: victim, username: `cxvio${Date.now()}`, code: 'SuperSecret99' }),
    });
    assert(mint.status === 201, `owner mint ${mint.status}`);
    const r = await deviceAuthorize(victim);
    assert(r.status === 404 && r.body.error?.code === 'NO_ACCOUNT', `an unverified key address resolved: ${r.status}`);
});

// secaudit2026oct22, device-authorize-email-owner-oracle: the consent-info endpoint is open (a code
// is all it asks for), so it names the account only to that account, and the email form is counted
// per network address against auth.device_authorize_email_max in 10 minutes.
await test('8. verify/info names the owner only to that owner signed in; an anonymous caller and another owner see no owner', async () => {
    const r = await deviceAuthorize(email);
    assert(r.status === 200, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    const code = r.body.data.user_code as string;
    const anon = await json(`/v1/agents/verify/info/${code}`);
    assert(anon.status === 200 && anon.body.data.agent_name === 'assistant', `verify/info ${anon.status}`);
    assert(!('owner' in anon.body.data), `an anonymous caller was told the owner: ${JSON.stringify(anon.body.data)}`);
    const other = await json(`/v1/agents/verify/info/${code}`, { headers: auth(inviter.token) });
    assert(other.status === 200 && !('owner' in other.body.data), `another owner was told the owner: ${JSON.stringify(other.body.data)}`);
    if (!targetToken) targetToken = (await ownerSignIn(BASE, target, 'SuperSecret99')).body.data.token as string;
    const own = await json(`/v1/agents/verify/info/${code}`, { headers: auth(targetToken) });
    assert(own.status === 200 && own.body.data.owner === target, `the owner signed in reads their own name: ${JSON.stringify(own.body.data)}`);
});

await test('9. the email form is limited per address (auth.device_authorize_email_max); the handle is not, and the switch turns the limit off', async () => {
    const set = (changes: Array<{ path: string; value: unknown }>) => json('/v1/admin/config', {
        method: 'PUT', headers: auth(inviter.token), body: JSON.stringify({ changes }),
    });
    const lowered = await set([{ path: 'auth.device_authorize_email_max', value: 2 }]);
    assert(lowered.status === 200, `set the limit: ${lowered.status} ${JSON.stringify(lowered.body.error)}`);
    try {
        let refused: { status: number; body: any } | null = null;
        for (let i = 0; i < 4 && !refused; i++) {
            const r = await deviceAuthorize(email);
            if (r.status === 429) refused = r;
        }
        assert(refused !== null, 'the email form was never refused past a limit of 2');
        assert(refused!.body.error?.code === 'RATE_LIMITED', `code ${refused!.body.error?.code}`);
        const msg = String(refused!.body.error?.message ?? '');
        assert(msg.includes('auth.device_authorize_email_max') && /account name/i.test(msg), `the refusal names the setting and the handle: ${msg}`);
        const handle = await deviceAuthorize(target);
        assert(handle.status === 200, `the handle is not counted: ${handle.status} ${JSON.stringify(handle.body.error)}`);
        const off = await set([{ path: 'auth.device_authorize_email_limit', value: false }]);
        assert(off.status === 200, `switch off: ${off.status} ${JSON.stringify(off.body.error)}`);
        const free = await deviceAuthorize(email);
        assert(free.status === 200, `with the limit off the email form answers: ${free.status} ${JSON.stringify(free.body.error)}`);
    } finally {
        await set([{ path: 'auth.device_authorize_email_limit', value: true }, { path: 'auth.device_authorize_email_max', value: 20 }]);
    }
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
