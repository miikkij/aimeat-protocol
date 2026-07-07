/**
 * @file e2e-login-attach-email.ts
 * @description E2E for recovering a legacy/unverified account during sign-in. Self-spawns a server with
 *   AIMEAT_EMAIL_CONFIRMATION_REQUIRED=true (the shared test server keeps it OFF so every other suite can
 *   log in without email) and exercises: the login gate returning email_required/has_email details, the
 *   no-auth POST /v1/ghii/login/attach-email endpoint (password re-verification, validation, email
 *   uniqueness, federation rejection), and its wiring into POST /v1/ghii/verify-email. The final
 *   "correct code → verificationLevel 1 → login succeeds" leg needs the plaintext code, which is only
 *   delivered over SMTP (absent here), so it is covered by the unchanged verify-email path + the wrong-code
 *   assertion below.
 * @version-history
 *   v1.0.0 — 2026-07-08 — Initial suite for /v1/ghii/login/attach-email + login email-gate details
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

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

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        // The whole point of this suite: the operator requires a verified email to log in.
        AIMEAT_EMAIL_CONFIRMATION_REQUIRED: 'true',
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

async function main() {
    const server = await startServer();
    try {
        const legacy = `legacy${Date.now() % 1000000}`;      // no-email account (the fatalii case)
        const password = 'LegacyPass123';
        const emailOwner = `hasmail${Date.now() % 1000000}`;  // holds a taken email
        const takenEmail = `taken-${Date.now()}@example.com`;
        let verificationId = '';

        console.log('\n=== Login → attach-email recovery E2E (email gate ON) ===\n');

        console.log('Setup — register a no-email (legacy-style) account + an email-holding account');
        await test('register no-email account WITH a password (POST /v1/ghii)', async () => {
            // POST /v1/ghii sets a password but no email → exactly the legacy pre-email-mandate account.
            // (register-web creates passwordless accounts, so it can't stand in for this case.)
            const { status, body } = await json('/v1/ghii', {
                method: 'POST', body: JSON.stringify({ username: legacy, display_name: 'Legacy User', password }),
            });
            assert(status === 201, `status ${status}: ${JSON.stringify(body.error)}`);
        });
        await test('register an account that already owns an email (register-web)', async () => {
            const { status } = await json('/v1/ghii/register-web', {
                method: 'POST', body: JSON.stringify({ username: emailOwner, display_name: 'Has Mail', email: takenEmail }),
            });
            assert(status === 201, `status ${status}`);
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
