/**
 * @file e2e-auth-tarpit.ts
 * @description The two door defences, against a real server: every refusal reaches the log with
 *   enough to investigate and nothing that could be replayed, and repeated guessing gets slower and
 *   then refused.
 *
 *   Runs its own server so the tarpit can be turned down to hundreds of milliseconds. The shipped
 *   numbers are four seconds a step to a thirty-second ceiling, which is the right cost for an
 *   attacker and the wrong length for a test.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
// Run: cd aimeat && pnpm exec node --import tsx test/e2e-auth-tarpit.ts

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.E2E_TARPIT_PORT ?? '40275';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = './test/.test-auth-tarpit.db';

const logDir = mkdtempSync(join(tmpdir(), 'aimeat-tarpit-'));
const LOG = join(logDir, 'auth-failures.log');

// Turned down so the suite runs in seconds: one free refusal, 300 ms a step, refuse after four.
const FREE = 1, STEP_MS = 300, BLOCK_AFTER = 4;

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
    return { status: res.status, body, headers: res.headers };
}
/** Time one call, so "slower" is a measured number rather than an impression. */
async function timed(path: string, opts: RequestInit = {}) {
    const t0 = Date.now();
    const r = await json(path, opts);
    return { ...r, ms: Date.now() - t0 };
}
const logLines = () => existsSync(LOG)
    ? readFileSync(LOG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        // eslint-disable-next-line aimeat/no-silent-catch -- a database file that is not there is the state this wants
        try { if (existsSync(f)) unlinkSync(f); } catch { /* already gone */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_AUTH_LOG_PATH: LOG,
        AIMEAT_LOGIN_TARPIT_ENABLED: 'true',
        AIMEAT_LOGIN_TARPIT_FREE: String(FREE),
        AIMEAT_LOGIN_TARPIT_STEP_MS: String(STEP_MS),
        AIMEAT_LOGIN_TARPIT_MAX_DELAY_MS: '1200',
        AIMEAT_LOGIN_TARPIT_BLOCK_AFTER: String(BLOCK_AFTER),
        AIMEAT_LOGIN_TARPIT_WINDOW_MS: '900000',
        // Generous, so what is being measured is the tarpit and not the rate limiter in front of it.
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_LOGIN_RATE_LIMIT_MAX: '500',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => { /* drained */ });
    child.stderr?.on('data', () => { /* drained */ });
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        // eslint-disable-next-line aimeat/no-silent-catch -- not listening yet is the normal state for the first second
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGKILL');
    throw new Error('Server failed to start');
}

const stamp = Date.now();
const USER = `tarpit${stamp}`;
const PASSWORD = 'TarpitPw#2026';

async function main() {
    const server = await startServer();
    console.log('\n=== AIMEAT door defences (refusal log + credential tarpit) E2E ===\n');
    try {
        await test('Setup: an operator, and a plain account whose password can be guessed at', async () => {
            // The first account on a fresh node IS the operator, so a plain owner needs one ahead of it
            // or "refused for lack of authority" cannot be tested at all.
            const op = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `op${stamp}`, display_name: 'op', password: PASSWORD }) });
            assert(op.status === 201, `operator ${op.status}: ${JSON.stringify(op.body.error)}`);
            const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: USER, display_name: USER, password: PASSWORD }) });
            assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body.error)}`);
        });

        // ── The log ──

        await test('1. An unauthenticated call on a protected door lands in the log', async () => {
            const before = logLines().length;
            const r = await json('/v1/contacts');
            assert(r.status === 401, `expected 401, got ${r.status}`);
            const rows = logLines();
            assert(rows.length > before, 'a line was written');
            const row = rows[rows.length - 1];
            assert(row.status === 401 && row.code === 'AUTH_REQUIRED', `shape: ${JSON.stringify(row)}`);
            assert(row.path === '/v1/contacts' && row.method === 'GET', `door: ${JSON.stringify(row)}`);
            assert(row.credential === 'none', `no credential was presented: ${row.credential}`);
            assert(typeof row.ip === 'string', 'an address is recorded');
        });

        await test('2. A presented token is digested, never written', async () => {
            const token = 'eyJhbGciOiJFZERTQSJ9.NOTAREALTOKEN-butlongenough.sig';
            const r = await json('/v1/contacts', { headers: { Authorization: `Bearer ${token}` } });
            assert(r.status === 401, `expected 401, got ${r.status}`);
            const raw = readFileSync(LOG, 'utf-8');
            assert(!raw.includes('NOTAREALTOKEN-butlongenough'), 'the token must not appear anywhere in the file');
            const row = logLines().pop();
            assert(row.credential === 'bearer-jwt', `credential kind: ${row.credential}`);
            assert(typeof row.credential_digest === 'string' && row.credential_digest.length === 12,
                `a 12-char digest identifies it without being it: ${row.credential_digest}`);
        });

        await test('3. A REAL principal refused for lack of authority is named in the log', async () => {
            const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASSWORD }) });
            assert(login.status === 200, `login ${login.status}: ${JSON.stringify(login.body.error)}`);
            const owner = login.body.data.token as string;
            // A PLAIN owner session reaching an operator-only door: authenticated, and not allowed.
            const r = await json('/v1/admin/stats', { headers: { Authorization: `Bearer ${owner}` } });
            assert(r.status === 403, `expected 403, got ${r.status}`);
            const row = logLines().pop();
            assert(row.status === 403, `status: ${row.status}`);
            assert(!!row.principal, `a 403 names who was refused: ${JSON.stringify(row)}`);
            assert(String(row.principal.owner) === USER, `principal: ${JSON.stringify(row.principal)}`);
            assert(!!row.reason, 'the reason travels with the refusal');
        });

        // ── The tarpit ──

        await test('4. The free refusals really are free, so a mistyped password is not punished', async () => {
            // FREE=1 here: the first wrong password is answered at full speed.
            const r = await timed('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: 'wrong-1' }) });
            assert(r.status === 401, `expected 401, got ${r.status}`);
            assert(r.ms < STEP_MS, `the first wrong password must not be delayed, took ${r.ms}ms`);
        });

        await test('5. The guess after the free ones waits, and each one after that waits longer', async () => {
            const second = await timed('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: 'wrong-2' }) });
            assert(second.status === 401, `expected 401, got ${second.status}`);
            assert(second.ms >= STEP_MS, `the guess after the free one waits a step, took ${second.ms}ms`);
            const third = await timed('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: 'wrong-3' }) });
            assert(third.status === 401, `expected 401, got ${third.status}`);
            assert(third.ms >= second.ms + STEP_MS - 60, `the delay grows: ${second.ms}ms then ${third.ms}ms`);
        });

        await test('6. Past the threshold the door refuses CHEAPLY instead of holding the connection', async () => {
            // BLOCK_AFTER counts FAILURES, so the refusal lands on the attempt after the last one
            // that was allowed to guess. Three have failed by here; the fourth still guesses (and
            // waits), and the fifth is turned away without the node looking at anything.
            const fourth = await timed('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: 'wrong-4' }) });
            assert(fourth.status === 401, `the fourth guess still guesses, got ${fourth.status}`);
            const r = await timed('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: USER, password: 'wrong-5' }) });
            assert(r.status === 429, `expected 429, got ${r.status}`);
            assert(r.body.error?.code === 'TOO_MANY_ATTEMPTS', `code: ${r.body.error?.code}`);
            assert(!!r.headers.get('retry-after'), 'a Retry-After tells them when, rather than leaving them to hammer');
            // The whole point of the ceiling: no socket is held once it refuses.
            assert(r.ms < STEP_MS, `a refusal must be cheap for us, took ${r.ms}ms`);
            // The wall itself is in the log: a file that shows the guesses and not where they
            // stopped understates the campaign by the part worth seeing.
            assert(logLines().some(l => l.code === 'ATTEMPTS_REFUSED'),
                'hitting the wall is recorded too');
        });

        await test('7. The name that was TRIED is in the log, which is what makes a campaign readable', async () => {
            const rows = logLines().filter(r => r.code === 'CREDENTIAL_REFUSED');
            assert(rows.length >= 3, `the wrong-password attempts are recorded: ${rows.length}`);
            assert(rows.some(r => String(r.reason).includes(USER)),
                `the account being guessed at is named: ${JSON.stringify(rows.map(r => r.reason))}`);
        });

        await test('8. Every refusal above is in the log, and none of them carries a secret', async () => {
            const logins = logLines().filter(r => r.path === '/v1/ghii/login');
            assert(logins.length >= 3, `the wrong-password attempts are recorded: ${logins.length}`);
            const raw = readFileSync(LOG, 'utf-8');
            for (const secret of [PASSWORD, 'wrong-1', 'wrong-2', 'wrong-3', 'wrong-4', 'wrong-5']) {
                assert(!raw.includes(secret), `the log must never contain a password (${secret})`);
            }
        });
    } finally {
        server.kill('SIGKILL');
        cleanupDb();
        rmSync(logDir, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) process.exit(1);
}

await main();
