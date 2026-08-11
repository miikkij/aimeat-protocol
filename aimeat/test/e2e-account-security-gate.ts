/**
 * @file e2e-account-security-gate.ts
 * @description The doors that decide who can sign in as the person, probed with every principal
 *   that carries their account name: an owner session, an agent JWT, an app-grant token, a second
 *   owner, and an agent the owner deliberately granted `account:security`.
 *
 *   Why a suite of its own. Until the August 2026 audit not one authenticated route under /v1/ghii
 *   carried a role gate, and every handler reads req.auth.owner — which holds the HUMAN's account
 *   name on an agent JWT, a GEAI token and an app-grant token alike. Three chains were reachable
 *   end to end: set the first password on an OAuth account and sign in as them; repoint the recovery
 *   address at a mailbox you control, confirm it, and have the reset rail mail you a code; or arm
 *   TOTP with a secret the person never sees, which they then cannot remove because removing it
 *   needs a code from that secret.
 *
 *   Every assertion here is about the 403, so a green run means the doors are shut and the owner's
 *   own path through them still opens.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-account-security-gate
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit, H-1/H-7 step 7b).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 1000000;
const ownerA = `acctsec${stamp}`;
const ownerB = `acctsecb${stamp}`;
const PASSWORD = 'AcctSecTest1234';
const FILENAME = 'acct-sec-demo.html';
const REDIRECT = 'http://localhost:9911/callback';

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

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Register an owner and return its owner-session JWT plus the private key. Retries the shared
 *  server's registration rate limit, the way every other suite does. */
async function registerOwner(username: string): Promise<{ token: string; privateKey: string }> {
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privateKey = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: username, timestamp: ts, signature: await signMsg(privateKey, username + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token ${username}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string, privateKey };
}

/** Create an agent under ownerA with the given scopes and return ITS session JWT. */
async function agentToken(name: string, scopes: string[]): Promise<string> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerAToken),
        body: JSON.stringify({ name, owner: ownerA, display_name: name, capabilities: [], scopes }),
    });
    assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.body)}`);
    const gaii = created.body.data.agent.gaii as string;
    const key = created.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

let ownerAToken = '';
let ownerBToken = '';
let plainAgentToken = '';
let grantedAgentToken = '';
let appToken = '';

/** One door, described the way a person would say it. */
interface Door { what: string; method: string; path: string; body?: unknown }

/** Every door this gate closes, apart from the two destructive ones, which run last. */
const DOORS: Door[] = [
    { what: 'set the password', method: 'POST', path: '/v1/ghii/password/change', body: { current_password: PASSWORD, new_password: 'TakenOver9876' } },
    { what: 'repoint the recovery address', method: 'POST', path: '/v1/ghii/email/verify', body: { email: 'attacker@example.com' } },
    { what: 'confirm the recovery address', method: 'POST', path: '/v1/ghii/email/confirm', body: { code: '000000' } },
    { what: 'arm a second factor', method: 'POST', path: '/v1/ghii/totp/setup', body: {} },
    { what: 'activate a second factor', method: 'POST', path: '/v1/ghii/totp/verify', body: { code: '000000' } },
    { what: 'remove the second factor', method: 'DELETE', path: '/v1/ghii/totp', body: { code: '000000' } },
    { what: 'replace the backup codes', method: 'POST', path: '/v1/ghii/totp/backup-codes', body: { code: '000000' } },
    { what: 'decide which web origins may read the account', method: 'PUT', path: '/v1/ghii/cors', body: { allowed_origins: null } },
    { what: 'stamp a wallet identity onto the person', method: 'POST', path: '/v1/ghii/verify/eudiw', body: { vp_token: 'x' } },
    { what: 'stamp a bank identity onto the person', method: 'POST', path: '/v1/ghii/verify/ftn', body: { callback_token: 'x' } },
    { what: 'export everything the account holds', method: 'GET', path: `/v1/owners/${ownerA}/export` },
];

async function call(door: Door, token: string) {
    return json(door.path, {
        method: door.method,
        headers: auth(token),
        ...(door.body !== undefined ? { body: JSON.stringify(door.body) } : {}),
    });
}

async function main() {
    console.log('\n=== Account security gate (H-1 / H-7) E2E ===\n');
    console.log('Phase 0: Setup');

    await test('two owners, an agent with full access, and an agent with account:security', async () => {
        const a = await registerOwner(ownerA);
        ownerAToken = a.token;
        const b = await registerOwner(ownerB);
        ownerBToken = b.token;
        // Full access, which is what most agents hold. The point of the assertions below is that
        // '*' does not reach these doors.
        plainAgentToken = await agentToken('plainbot', ['*']);
        grantedAgentToken = await agentToken('securitybot', ['memory:read', 'account:security']);
    });

    await test('an app-grant token for the same owner', async () => {
        const pub = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerAToken),
            body: JSON.stringify({
                filename: FILENAME, content: b64('<!DOCTYPE html><html><body>gate</body></html>'),
                name: 'Gate Demo', description: 'account security gate demo app', category: 'utility',
            }),
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);

        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const q = new URLSearchParams({
            app: `${ownerA}/${FILENAME}`, response_type: 'code', scope: 'memory:read',
            redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
        assert(!!m, `expected a consent redirect, got ${res.status} ${res.headers.get('location')}`);
        const con = await json('/v1/app-grants/authorize-consent', {
            method: 'POST', headers: auth(ownerAToken),
            body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }),
        });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
        appToken = tok.body.data.access_token as string;
    });

    console.log('\nPhase 1: A machine principal of the same owner is refused at every door');

    for (const door of DOORS) {
        await test(`agent JWT cannot ${door.what}`, async () => {
            const r = await call(door, plainAgentToken);
            assert(r.status === 403, `${door.method} ${door.path}: expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
            assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);
        });

        await test(`app-grant token cannot ${door.what}`, async () => {
            const r = await call(door, appToken);
            assert(r.status === 403, `${door.method} ${door.path}: expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        });
    }

    console.log('\nPhase 2: The account holder still gets through');

    for (const door of DOORS) {
        await test(`the owner can reach "${door.what}"`, async () => {
            const r = await call(door, ownerAToken);
            // What each door answers depends on the account's state and the node's feature flags —
            // a 400 for a wrong TOTP code and a 503 for a disabled wallet integration are both the
            // handler running. The gate is what is under test, so the assertion is that the request
            // got past it.
            assert(r.status !== 403, `${door.method} ${door.path}: owner was refused with ${JSON.stringify(r.body)}`);
        });
    }

    console.log('\nPhase 3: The permission the owner can grant on purpose');

    await test('an agent granted account:security may set the CORS origins', async () => {
        const r = await json('/v1/ghii/cors', {
            method: 'PUT', headers: auth(grantedAgentToken), body: JSON.stringify({ allowed_origins: null }),
        });
        assert(r.status === 200, `expected 200 for the granted agent, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('full access alone does NOT carry it — the wildcard agent is still refused', async () => {
        const r = await json('/v1/ghii/cors', {
            method: 'PUT', headers: auth(plainAgentToken), body: JSON.stringify({ allowed_origins: null }),
        });
        assert(r.status === 403, `expected 403 for the '*' agent, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 4: Cross-owner, and the two destructive doors');

    await test('a different owner cannot export this account', async () => {
        const r = await json(`/v1/owners/${ownerA}/export`, { headers: auth(ownerBToken) });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('a different owner cannot delete this account', async () => {
        const r = await json(`/v1/owners/${ownerA}`, { method: 'DELETE', headers: auth(ownerBToken) });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('agent JWT and app-grant token cannot delete the identity record', async () => {
        const a = await json('/v1/ghii', { method: 'DELETE', headers: auth(plainAgentToken) });
        assert(a.status === 403, `agent: expected 403, got ${a.status} ${JSON.stringify(a.body)}`);
        const b = await json('/v1/ghii', { method: 'DELETE', headers: auth(appToken) });
        assert(b.status === 403, `app: expected 403, got ${b.status} ${JSON.stringify(b.body)}`);
    });

    await test('agent JWT and app-grant token cannot erase the owner account', async () => {
        const a = await json(`/v1/owners/${ownerA}`, { method: 'DELETE', headers: auth(plainAgentToken) });
        assert(a.status === 403, `agent: expected 403, got ${a.status} ${JSON.stringify(a.body)}`);
        const b = await json(`/v1/owners/${ownerA}`, { method: 'DELETE', headers: auth(appToken) });
        assert(b.status === 403, `app: expected 403, got ${b.status} ${JSON.stringify(b.body)}`);
    });

    await test('the owner can delete their own identity record', async () => {
        const r = await json('/v1/ghii', { method: 'DELETE', headers: auth(ownerAToken) });
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('the owner can erase their own account (cleanup)', async () => {
        const r = await json(`/v1/owners/${ownerA}`, { method: 'DELETE', headers: auth(ownerAToken) });
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        const gone = await json(`/v1/owners/${ownerB}`, { method: 'DELETE', headers: auth(ownerBToken) });
        assert(gone.status === 200, `second owner cleanup: ${gone.status}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
