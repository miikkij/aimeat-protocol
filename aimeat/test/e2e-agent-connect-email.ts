/**
 * @file e2e-agent-connect-email.ts
 * @description E2E for email-or-handle connect: POST /v1/agents/device-authorize accepts the `owner`
 *   value as either the account HANDLE (unchanged) or the account's VERIFIED email (case-insensitive),
 *   resolving an email to the owning handle before the RFC 8628 flow. Also asserts the one-verified-
 *   email-per-account-per-node invariant that the resolver relies on (a duplicate verified email is
 *   refused, so an email can never map to two accounts).
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: email→handle resolution (found/handle/unknown/malformed) + uniqueness.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-connect-email

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
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}

/**
 * Provision an account WITH a verified email via the code-invite flow — the only e2e-safe way to attach
 * a verified email (interactive verification needs real mail delivery). Returns the new account handle.
 */
async function provisionVerifiedEmailAccount(inviterToken: string, email: string, username: string): Promise<{ status: number; body: any }> {
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(inviterToken), body: JSON.stringify({ name: 'Connect Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    return json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(inviterToken),
        body: JSON.stringify({ email, username, code: 'SuperSecret99', display_name: 'Connect Target' }),
    });
}

const deviceAuthorize = (owner: string) => json('/v1/agents/device-authorize', {
    method: 'POST', body: JSON.stringify({ owner, agent_name: 'assistant' }),
});
/** The owner recorded on the pending request, read via the consent-info endpoint. */
async function pendingOwnerFor(userCode: string): Promise<string> {
    const info = await json(`/v1/agents/verify/info/${userCode}`);
    assert(info.status === 200, `verify/info ${info.status}`);
    return info.body.data.owner as string;
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

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
