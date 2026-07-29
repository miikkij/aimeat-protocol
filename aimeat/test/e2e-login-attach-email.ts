/**
 * @file e2e-login-attach-email.ts
 * @description E2E for recovering a legacy/unverified account during sign-in, and for registration under
 *   the email gate. Self-spawns its own server (the shared test server keeps the gate OFF). Phase 0 boots
 *   with the gate OFF and seeds accounts that PREDATE the gate (a no-email legacy account; a verified-email
 *   account via code-invite), then RESTARTS the same DB with the gate ON. It exercises: registration
 *   enforcement under the gate (no email → EMAIL_REQUIRED on both /v1/ghii and register-web; a fresh email →
 *   verification_id; a taken verified email → EMAIL_TAKEN), the login gate returning email_required/has_email
 *   details, the no-auth POST /v1/ghii/login/attach-email endpoint (password re-verification, validation,
 *   email uniqueness, federation rejection), and its wiring into POST /v1/ghii/verify-email. The final
 *   "correct code → verificationLevel 1 → login succeeds" leg needs the plaintext code, which is only
 *   delivered over SMTP (absent here), so it is covered by the unchanged verify-email path + the wrong-code
 *   assertion below.
 * @version-history
 *   v1.1.0 — 2026-07-19 — The "email already owned" 409 now requires a VERIFIED owner: emailHash is a
 *     verified-email binding (an unverified register-web email no longer reserves the address), so the
 *     taken-email account is provisioned with a verified email via the code-invite flow.
 *   v1.0.0 — 2026-07-08 — Initial suite for /v1/ghii/login/attach-email + login email-gate details
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

const PORT = process.env.E2E_ATTACH_EMAIL_PORT ?? '40268';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-attach-email.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const body = await res.json() as any;
    return { status: res.status, body };
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(gateOn: boolean, freshDb: boolean): Promise<ChildProcess> {
    if (freshDb) cleanupDb();               // first boot wipes; the restart REUSES the same DB file
    const env = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        // The whole point of this suite: the operator requires a verified email to log in / register.
        AIMEAT_EMAIL_CONFIRMATION_REQUIRED: gateOn ? 'true' : 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

async function stopServer(child: ChildProcess): Promise<void> {
    child.kill('SIGTERM');
    const start = Date.now();
    while (!child.killed && child.exitCode === null && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 500)); // let the port + DB lock release before the restart
}

async function main() {
    const legacy = `legacy${Date.now() % 1000000}`;      // no-email account (the fatalii case)
    const password = 'LegacyPass123';
    const emailOwner = `hasmail${Date.now() % 1000000}`;  // holds a taken (verified) email
    const takenEmail = `taken-${Date.now()}@example.com`;
    let verificationId = '';

    console.log('\n=== Login → attach-email recovery E2E ===\n');

    // ── Phase 0: with the gate OFF, seed accounts that PREDATE the operator turning the gate on:
    //    a no-email legacy account, and an account holding a verified email (via code-invite). ──
    console.log('Phase 0 — seed pre-gate accounts (email gate OFF)');
    let server = await startServer(false, true);
    try {
        await test('register no-email account WITH a password (POST /v1/ghii, gate off)', async () => {
            const { status, body } = await json('/v1/ghii', {
                method: 'POST', body: JSON.stringify({ username: legacy, display_name: 'Legacy User', password }),
            });
            assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
        });
        await test('provision an account with a VERIFIED email (code-invite)', async () => {
            // emailHash is a verified-email binding, so the "email taken" case below needs a VERIFIED
            // owner. The code-invite flow is the only e2e-safe way to attach a verified email (no SMTP).
            const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `inviter${Date.now() % 1000000}`, display_name: 'Inviter', password: 'InviteP123' }) });
            assert(reg.status === 201, `inviter reg ${reg.status}`);
            const inv = reg.body.data.owner.name as string;
            const ts = new Date().toISOString();
            const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: inv, timestamp: ts, signature: await sign(reg.body.data.private_key, inv + NODE_ID + ts) }) });
            const token = tok.body.data.token as string;
            const org = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'Attach Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
            assert(org.status === 201, `org ${org.status}`);
            const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: takenEmail, username: emailOwner, code: 'SuperSecret99', display_name: 'Has Mail' }),
            });
            assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
        });
    } finally {
        await stopServer(server);
    }

    // ── Restart with the gate ON (same DB): the legacy account now exists but is unverified. ──
    console.log('\nSwitching the email gate ON (restart, same DB)…');
    server = await startServer(true, false);
    try {
        console.log('\nPhase 0b — registration is now gated (no email → refused)');
        await test('register WITHOUT email under the gate → 400 EMAIL_REQUIRED (POST /v1/ghii)', async () => {
            const { status, body } = await json('/v1/ghii', {
                method: 'POST', body: JSON.stringify({ username: `noemail${Date.now() % 1000000}`, display_name: 'No Email', password }),
            });
            assert(status === 400, `expected 400, got ${status}`);
            assert(body.error?.code === 'EMAIL_REQUIRED', `code ${body.error?.code}`);
        });
        await test('register WITHOUT email under the gate → 400 EMAIL_REQUIRED (register-web)', async () => {
            const { status, body } = await json('/v1/ghii/register-web', {
                method: 'POST', body: JSON.stringify({ username: `noemailw${Date.now() % 1000000}`, display_name: 'No Email Web' }),
            });
            assert(status === 400, `expected 400, got ${status}`);
            assert(body.error?.code === 'EMAIL_REQUIRED', `code ${body.error?.code}`);
        });
        await test('register WITH a fresh email under the gate → 201 + verification_id (POST /v1/ghii)', async () => {
            const { status, body } = await json('/v1/ghii', {
                method: 'POST', body: JSON.stringify({ username: `withmail${Date.now() % 1000000}`, display_name: 'With Email', password, email: `fresh-${Date.now()}@example.com` }),
            });
            assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
            assert(typeof body.data.verification_id === 'string' && body.data.verification_id.length > 0, 'verification_id present');
        });
        await test('register WITH an already-verified email under the gate → 409 EMAIL_TAKEN', async () => {
            const { status, body } = await json('/v1/ghii', {
                method: 'POST', body: JSON.stringify({ username: `dupmail${Date.now() % 1000000}`, display_name: 'Dup', password, email: takenEmail }),
            });
            assert(status === 409, `expected 409, got ${status}`);
            assert(body.error?.code === 'EMAIL_TAKEN', `code ${body.error?.code}`);
        });

        console.log('\nPhase 1 — login is gated and tells the client an email is required');
        await test('login with correct password → 403 EMAIL_NOT_VERIFIED with details', async () => {
            const { status, body } = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: legacy, password }),
            });
            assert(status === 403, `expected 403, got ${status}`);
            assert(body.error?.code === 'EMAIL_NOT_VERIFIED', `code ${body.error?.code}`);
            assert(body.error?.details?.email_required === true, 'details.email_required should be true');
            assert(body.error?.details?.has_email === false, 'details.has_email should be false for a legacy account');
        });
        await test('login with WRONG password → generic 401 (no email hint leaked)', async () => {
            const { status, body } = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: legacy, password: 'wrong' }),
            });
            assert(status === 401, `expected 401, got ${status}`);
            assert(body.error?.code === 'AUTH_REQUIRED', `code ${body.error?.code}`);
        });

        console.log('\nPhase 2 — attach-email validates + re-verifies the password');
        await test('attach-email missing email → 400', async () => {
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: legacy, password }),
            });
            assert(status === 400, `expected 400, got ${status}`);
            assert(body.error?.code === 'INVALID_INPUT', `code ${body.error?.code}`);
        });
        await test('attach-email invalid email format → 400', async () => {
            const { status } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: legacy, password, email: 'nope' }),
            });
            assert(status === 400, `expected 400, got ${status}`);
        });
        await test('attach-email WRONG password → 401 (cannot attach to someone else\'s account)', async () => {
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: legacy, password: 'wrong', email: 'a@b.com' }),
            });
            assert(status === 401, `expected 401, got ${status}`);
            assert(body.error?.code === 'AUTH_REQUIRED', `code ${body.error?.code}`);
        });
        await test('attach-email federated username → 400 FEDERATION_UNSUPPORTED', async () => {
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: `${legacy}@some-other-node`, password, email: 'a@b.com' }),
            });
            assert(status === 400, `expected 400, got ${status}`);
            assert(body.error?.code === 'FEDERATION_UNSUPPORTED', `code ${body.error?.code}`);
        });
        await test('attach-email with an email already owned by another account → 409 EMAIL_TAKEN', async () => {
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: legacy, password, email: takenEmail }),
            });
            assert(status === 409, `expected 409, got ${status}`);
            assert(body.error?.code === 'EMAIL_TAKEN', `code ${body.error?.code}`);
        });

        await test('attach-email on an ALREADY VERIFIED account → 409, recovery handle untouched', async () => {
            // This endpoint takes NO session — only username + password. Without the
            // verificationLevel >= 1 gate a verified account's notificationEmail can be re-pointed
            // and magicLinkEnabled re-armed through it: post-compromise persistence on the recovery
            // handle. emailOwner was provisioned by code-invite (the code IS the password) with a
            // verified email, so it is the one verified account the suite holds.
            const attacker = `attacker-${Date.now()}@example.com`;
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: emailOwner, password: 'SuperSecret99', email: attacker }),
            });
            assert(status === 409, `expected 409 for an already-verified account, got ${status}: ${JSON.stringify(body.error ?? body)}`);
            assert(body.error?.code === 'ALREADY_VERIFIED', `expected ALREADY_VERIFIED, got ${body.error?.code}`);

            // The refusal was real: the recovery email still points where it did.
            const login = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: emailOwner, password: 'SuperSecret99' }),
            });
            assert(login.status === 200, `verified account should log in, got ${login.status}: ${JSON.stringify(login.body.error)}`);
            const me = await json('/v1/ghii/me', { headers: { Authorization: `Bearer ${login.body.data.token}` } });
            assert(me.status === 200, `me ${me.status}`);
            assert(me.body.data.notification_email === takenEmail,
                `the recovery email must be unchanged, got ${JSON.stringify(me.body.data.notification_email)}`);
            assert(me.body.data.verification_level >= 1,
                `the account must still be verified, got ${JSON.stringify(me.body.data.verification_level)}`);
        });

        console.log('\nPhase 3 — happy send returns a verification_id wired to verify-email');
        await test('attach-email correct password + fresh email → 200 + verification_id', async () => {
            const { status, body } = await json('/v1/ghii/login/attach-email', {
                method: 'POST', body: JSON.stringify({ username: legacy, password, email: `mine-${Date.now()}@example.com` }),
            });
            assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.ok === true, 'data.ok true');
            assert(typeof body.data.verification_id === 'string' && body.data.verification_id.length > 0, 'verification_id present');
            verificationId = body.data.verification_id;
            // email_sent reflects whether SMTP is configured — boolean either way (true when the env has SMTP).
            assert(typeof body.data.email_sent === 'boolean', 'email_sent is a boolean');
        });
        await test('login still gated until the code is confirmed → 403', async () => {
            const { status } = await json('/v1/ghii/login', {
                method: 'POST', body: JSON.stringify({ username: legacy, password }),
            });
            assert(status === 403, `expected 403, got ${status}`);
        });
        await test('verify-email with a wrong code → INVALID_CODE (record is wired, not yet verified)', async () => {
            const { status, body } = await json('/v1/ghii/verify-email', {
                method: 'POST', body: JSON.stringify({ verification_id: verificationId, code: '000000' }),
            });
            assert(status === 400, `expected 400, got ${status}`);
            assert(body.error?.code === 'INVALID_CODE', `code ${body.error?.code}`);
        });

        console.log('\n─────────────────────────────────────');
        console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    } finally {
        server.kill('SIGTERM');
        setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 3000);
        cleanupDb();
    }
    if (failed > 0) { console.log('⚠️  Some tests failed!'); process.exit(1); }
    console.log('✅ All tests passed!');
}

main().catch((e) => { console.error(e); process.exit(1); });
