/**
 * @file test/e2e-setup-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time setup code of the first-owner setup (src/services/setup-code.ts), on two
 *   nodes of its own started as `aimeat start` starts them.
 *
 *   WHY. Until 2026-10-16 POST /v1/setup/init created the first owner, with the operator role, for
 *   any caller while the node had no owner, so whoever reached a fresh node with a public address
 *   first became its operator. Decision (Jouni, 2026-10-16): a node whose base URL is not loopback
 *   prints a one-time code in its start log, and the setup refuses without it; a loopback node needs
 *   none.
 *
 *   WHAT IT ASSERTS. On a node with a public base URL on the public profile, started with the log at
 *   warn level: the status says the code is needed; the start log carries the code and the wizard's
 *   address; a setup without the code is refused (SETUP_CODE_REQUIRED) and creates nothing; a wrong
 *   code is refused (SETUP_CODE_INVALID); the right code creates the operator once; the same code a
 *   second time is refused. On a node with a loopback base URL: no code in the log, and the setup
 *   works without one.
 *
 *   It runs its own two nodes, on the run's backend (test/helpers/own-node-db.ts), on ports 40533
 *   (public base URL) and 40534 (loopback base URL).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-setup-code
 * @version-history
 *   2026-10-16 — Initial (Jouni, 2026-10-16: first-owner setup needs a one-time code on a public node).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';

const PUBLIC_PORT = 40533;
const LOOPBACK_PORT = 40534;
const STAMP = Date.now().toString(36).slice(-6);
const PASSWORD = `Setup-Code-${STAMP}-Pw!`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300);

interface OwnNode { base: string; child: ChildProcess | null; log: string }

async function startNode(port: number, baseUrl: string, extra: Record<string, string>): Promise<OwnNode> {
    const db = await ownNodeDb(String(port));
    // Nothing from the runner's relaxed pins reaches this node: every AIMEAT_* variable is dropped
    // first, and only what a deployment sets is given back.
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(port),
        AIMEAT_BASE_URL: baseUrl,
        AIMEAT_NODE_ID: `aimeat-test-001-setupcode${port}${STAMP}`,
        AIMEAT_ADMIN_PASSWORD: `Setup-Admin-${STAMP}-Pw!`,
        AIMEAT_KEY_PASSPHRASE: `setup-code-node-key-${STAMP}`,
        AIMEAT_SMTP_HOST: '',
        ...extra,
    });
    const node: OwnNode = { base: `http://127.0.0.1:${port}`, child: null, log: '' };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', (d: Buffer) => { node.log += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { node.log += d.toString(); });
    node.child = child;
    await waitForServer(child, node.base, { label: `the setup-code node on ${port}` });
    // The banner is printed in the listen callback, which can trail the first answer by a moment.
    for (let i = 0; i < 50 && !node.log.includes('Admin Setup:') && !node.log.includes('Setup code:'); i++) {
        await new Promise(r => setTimeout(r, 100));
    }
    return node;
}

async function stopNode(node: OwnNode | null): Promise<void> {
    const child = node?.child;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 10_000))]);
}

async function json(node: OwnNode, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${node.base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}

const init = (node: OwnNode, username: string, setupCode?: string) => json(node, '/v1/setup/init', {
    method: 'POST',
    body: JSON.stringify({ locale: 'en', owner: { username, password: PASSWORD }, ...(setupCode !== undefined ? { setupCode } : {}) }),
});

let pub: OwnNode | null = null;
let loop: OwnNode | null = null;

// POST /v1/setup/init writes an .env into the package root when none is there. A placeholder is
// written first and removed afterwards, unless the developer already had one, which is not touched
// (the way e2e-setup-and-verification manages it).
const PACKAGE_ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const ENV_MARKER = '# placeholder written by test/e2e-setup-code.ts; removed when the suite ends\n';
const HAD_ENV = existsSync(PACKAGE_ENV) && readFileSync(PACKAGE_ENV, 'utf-8') !== ENV_MARKER;

console.log('\n=== The one-time setup code of the first-owner setup ===\n');

try {
    if (!HAD_ENV) writeFileSync(PACKAGE_ENV, ENV_MARKER, 'utf-8');
    console.log('A node with a public base URL');
    pub = await startNode(PUBLIC_PORT, 'https://setupcode.example', { AIMEAT_SECURITY_PROFILE: 'public', AIMEAT_LOG_LEVEL: 'warn' });
    const node = pub;
    const code = /Setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(node.log)?.[1] ?? '';

    await test('the status says the node needs setup and the setup code', async () => {
        const r = await json(node, '/v1/setup/status');
        assert(r.status === 200, `status ${r.status} ${short(r.body)}`);
        assert(r.body.data.needsSetup === true && r.body.data.setupCodeRequired === true, `status: ${short(r.body.data)}`);
    });

    await test('the start log carries the code, at warn level, with the wizard\'s address', async () => {
        assert(code, `no "Setup code:" line in the start log:\n${node.log.split(/\r?\n/).slice(-25).join('\n')}`);
        assert(node.log.includes('https://setupcode.example/v1/setup/wizard'), 'the line does not say where to enter the code');
    });

    await test('a setup without the code is refused, and creates no owner', async () => {
        const r = await init(node, `nocode${STAMP}`);
        assert(r.status === 403, `expected 403, got ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'SETUP_CODE_REQUIRED', `code: ${r.body.error?.code}`);
        assert(/start log/.test(r.body.error?.message ?? ''), `the refusal does not say where the code is: ${r.body.error?.message}`);
        const s = await json(node, '/v1/setup/status');
        assert(s.body.data.needsSetup === true, 'an owner was created without the code');
    });

    await test('a wrong code is refused', async () => {
        const wrong = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
        const r = await init(node, `wrongcode${STAMP}`, wrong);
        assert(r.status === 403, `expected 403, got ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'SETUP_CODE_INVALID', `code: ${r.body.error?.code}`);
    });

    await test('the right code creates the first owner, as the operator', async () => {
        const r = await init(node, `firstowner${STAMP}`, code.toLowerCase());
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body)}`);
        assert(r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
        assert(typeof r.body.data.token === 'string' && r.body.data.token.length > 20, 'no session token');
    });

    await test('the same code a second time is refused, and the status no longer asks for it', async () => {
        const r = await init(node, `secondowner${STAMP}`, code);
        assert(r.status === 403, `expected 403, got ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'ALREADY_CONFIGURED', `code: ${r.body.error?.code}`);
        const s = await json(node, '/v1/setup/status');
        assert(s.body.data.needsSetup === false && s.body.data.setupCodeRequired === false, `status: ${short(s.body.data)}`);
    });
    await stopNode(pub);
    pub = null;

    console.log('\nA node with a loopback base URL');
    loop = await startNode(LOOPBACK_PORT, `http://127.0.0.1:${LOOPBACK_PORT}`, { AIMEAT_LOG_LEVEL: 'warn' });
    const local = loop;

    await test('a loopback node prints no code and its status does not ask for one', async () => {
        assert(!local.log.includes('Setup code:'), 'a loopback node printed a setup code');
        const s = await json(local, '/v1/setup/status');
        assert(s.body.data.needsSetup === true && s.body.data.setupCodeRequired === false, `status: ${short(s.body.data)}`);
    });

    await test('a loopback node creates the first owner without a code', async () => {
        const r = await init(local, `localowner${STAMP}`);
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body)}`);
        assert(r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
    });
} finally {
    await stopNode(pub);
    await stopNode(loop);
    if (!HAD_ENV && existsSync(PACKAGE_ENV)) unlinkSync(PACKAGE_ENV);
}

console.log(`\nSetup code E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) process.exit(1);
