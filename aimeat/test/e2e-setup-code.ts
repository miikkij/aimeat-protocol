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
 *   second time is refused. On a second such node, the first account made by registration: POST
 *   /v1/ghii, POST /v1/ghii/register-web and POST /v1/owners refuse it without the code, a wrong code
 *   is refused, with the code it is the operator, and a second registration needs no code. On a third
 *   whose first owner was written without the operator role (as a directory sync makes one): the
 *   start log still carries a code, that owner signs in as a plain owner without it, a registration
 *   that would self-heal to operator is refused without the code and is the operator with it, and a
 *   later one is a plain owner. On a node with a loopback base URL: the log carries a code and says it
 *   is for other machines; a request from this machine's own network address is asked for it and its
 *   first account and setup are refused without it; and the first registration from loopback works
 *   without one.
 *
 *   On a loopback node with the connector tunnel on and owners but no operator: a sign-in a remote
 *   agent forwards through the tunnel answers but does not make its owner the operator, a registration
 *   it forwards is asked for the code, and a sign-in on the node's own machine still does.
 *
 *   It runs its own five nodes, on the run's backend (test/helpers/own-node-db.ts), on ports 40533
 *   (public, setup), 40535 (public, registration), 40536 (public, no operator), 40534 (loopback) and
 *   40537 (loopback, tunnel on, no operator).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-setup-code
 * @version-history
 *   2026-10-27 — A node on 40537: a sign-in or registration forwarded through the connector tunnel is
 *     not the node's own machine for the setup code (secaudit2026oct26).
 *   2026-10-27 — On the loopback node a request that carries a forwarding header (a same-host tunnel or
 *     proxy) is asked for the code (secaudit2026oct26, loopback-socket-behind-local-proxy).
 *   2026-10-23 — The loopback node prints a code, and a request from this machine's network address is
 *     asked for it (secaudit2026oct22; Jouni, 2026-10-23).
 *   2026-10-16 — The password carries a fixed digit: a letters-only STAMP failed the password rule.
 *   2026-10-16 — A node on 40536 with an owner but no operator: the code is printed, sign-in and
 *     registration self-heal need it (Jouni, 2026-10-16).
 *   2026-10-16 — A third node on 40535: the registration routes refuse the first account without the code
 *     and make it the operator with it; the loopback node's first account is registered (Jouni, 2026-10-16).
 *   2026-10-16 — Initial (Jouni, 2026-10-16: first-owner setup needs a one-time code on a public node).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, type OwnNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { tokenRoles } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { TunnelClient } from './helpers/tunnel-harness.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { hashPassword } from '../src/services/password.js';

const PUBLIC_PORT = 40533;
const LOOPBACK_PORT = 40534;
const REGISTER_PORT = 40535;
const NO_OPERATOR_PORT = 40536;
const TUNNEL_PORT = 40537;
const STAMP = Date.now().toString(36).slice(-6);
// A fixed digit: STAMP is base36 and is sometimes letters only, and the password rule asks for a number.
const PASSWORD = `Setup-Code-${STAMP}-Pw7!`;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);

interface OwnNode { base: string; child: ChildProcess | null; log: string }

async function startNode(port: number, baseUrl: string, extra: Record<string, string>, given?: OwnNodeDb): Promise<OwnNode> {
    // A database handed in is kept as it is (a restart); a new one is emptied first.
    const db = given ?? await ownNodeDb(String(port));
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
let reg: OwnNode | null = null;
let noop: OwnNode | null = null;
let loop: OwnNode | null = null;
let tun: OwnNode | null = null;

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

    console.log('\nA node with a public base URL, its first account made by registration');
    // The shipped registration limit is five a minute per address; this node takes seven.
    reg = await startNode(REGISTER_PORT, 'https://register.example', { AIMEAT_SECURITY_PROFILE: 'public', AIMEAT_LOG_LEVEL: 'warn', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '20' });
    const rnode = reg;
    const rcode = /Setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(rnode.log)?.[1] ?? '';
    const register = (username: string, extra: Record<string, unknown> = {}) => json(rnode, '/v1/ghii', {
        method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD, ...extra }),
    });

    await test('the first registration without the code is refused on every account-creating route, and creates nothing', async () => {
        assert(rcode, 'no "Setup code:" line in the start log');
        const ghii = await register(`regnocode${STAMP}`);
        assert(ghii.status === 403 && ghii.body.error?.code === 'SETUP_CODE_REQUIRED', `POST /v1/ghii: ${ghii.status} ${short(ghii.body.error)}`);
        const web = await json(rnode, '/v1/ghii/register-web', { method: 'POST', body: JSON.stringify({ username: `webnocode${STAMP}`, display_name: 'Web No Code', email: `web${STAMP}@example.test` }) });
        assert(web.status === 403 && web.body.error?.code === 'SETUP_CODE_REQUIRED', `POST /v1/ghii/register-web: ${web.status} ${short(web.body.error)}`);
        const owners = await json(rnode, '/v1/owners', { method: 'POST', body: JSON.stringify({ name: `ownnocode${STAMP}`, public_key: 'MCowBQYDK2VwAyEAo4y5GmJ8ehxJ6rD1u8eBuOqGQ0Vs1RO8kfxeDqhnYrM=' }) });
        assert(owners.status === 403 && owners.body.error?.code === 'SETUP_CODE_REQUIRED', `POST /v1/owners: ${owners.status} ${short(owners.body.error)}`);
        const s = await json(rnode, '/v1/setup/status');
        assert(s.body.data.needsSetup === true, 'a refused registration created an account');
    });

    await test('the first registration with a wrong code is refused', async () => {
        const wrong = (rcode[0] === 'A' ? 'B' : 'A') + rcode.slice(1);
        const r = await register(`regwrong${STAMP}`, { setupCode: wrong });
        assert(r.status === 403 && r.body.error?.code === 'SETUP_CODE_INVALID', `${r.status} ${short(r.body.error)}`);
    });

    await test('the first registration with the code is the operator, and the code is spent', async () => {
        const r = await register(`regfirst${STAMP}`, { setupCode: rcode });
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body.error)}`);
        assert(r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
        const again = await init(rnode, `regsetup${STAMP}`, rcode);
        assert(again.status === 403 && again.body.error?.code === 'ALREADY_CONFIGURED', `setup with the spent code: ${again.status} ${short(again.body.error)}`);
    });

    await test('a second registration needs no code and is not the operator', async () => {
        const r = await register(`regsecond${STAMP}`);
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body.error)}`);
        assert(!r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
    });
    await stopNode(reg);
    reg = null;

    console.log('\nA node with a public base URL whose first owner is not the operator (a directory sync)');
    // Booted once so the schema exists, then an owner WITHOUT the operator role is written straight
    // into the store, as a SCIM sync makes one, and the node is started again on the same database.
    const noOpDb = await ownNodeDb(String(NO_OPERATOR_PORT));
    const publicNoOp = { AIMEAT_SECURITY_PROFILE: 'public', AIMEAT_LOG_LEVEL: 'warn', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '20' };
    noop = await startNode(NO_OPERATOR_PORT, 'https://directory.example', publicNoOp, noOpDb);
    const noOpNodeId = `aimeat-test-001-setupcode${NO_OPERATOR_PORT}${STAMP}`;
    await stopNode(noop);
    const synced = `synced${STAMP}`;
    const store = noOpDb.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: noOpDb.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: noOpDb.sqlitePath });
    try {
        const now = new Date().toISOString();
        await store.createOwner({ name: synced, displayName: 'Synced Person', publicKey: '', roles: ['owner'], createdAt: now });
        await store.createGHII({
            username: synced, nodeId: noOpNodeId, ghii: `${synced}@${noOpNodeId}`, displayName: 'Synced Person',
            passwordHash: await hashPassword(PASSWORD), verificationLevel: 0, ownerName: synced, totpEnabled: false,
            createdAt: now, updatedAt: now,
        });
    } finally {
        await (store as unknown as { close?: () => unknown }).close?.();
    }
    noop = await startNode(NO_OPERATOR_PORT, 'https://directory.example', publicNoOp, noOpDb);
    const nnode = noop;
    const ncode = /Setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(nnode.log)?.[1] ?? '';
    const nregister = (username: string, extra: Record<string, unknown> = {}) => json(nnode, '/v1/ghii', {
        method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD, ...extra }),
    });

    await test('a node with an owner but no operator still prints a setup code at start', async () => {
        assert(ncode, `no "Setup code:" line in the start log:\n${nnode.log.split(/\r?\n/).slice(-20).join('\n')}`);
        assert(/no operator/.test(nnode.log), 'the line does not say the node has no operator');
    });

    await test('the synced owner signs in without the code and stays a plain owner', async () => {
        const r = await json(nnode, '/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: synced, password: PASSWORD }) });
        assert(r.status === 200, `sign-in ${r.status} ${short(r.body)}`);
        assert(!tokenRoles(r.body.data.token).includes('operator'), `the sign-in made the operator without the code: ${short(tokenRoles(r.body.data.token))}`);
    });

    await test('a registration that would self-heal to operator is refused without the code', async () => {
        const r = await nregister(`healnocode${STAMP}`);
        assert(r.status === 403 && r.body.error?.code === 'SETUP_CODE_REQUIRED', `${r.status} ${short(r.body)}`);
    });

    await test('with the code that registration becomes the operator', async () => {
        const r = await nregister(`healer${STAMP}`, { setupCode: ncode });
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body)}`);
        assert(r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
    });

    await test('a later registration is a plain owner, without any code', async () => {
        const r = await nregister(`healafter${STAMP}`);
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body)}`);
        assert(!r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
    });
    await stopNode(noop);
    noop = null;

    console.log('\nA node with a loopback base URL');
    loop = await startNode(LOOPBACK_PORT, `http://127.0.0.1:${LOOPBACK_PORT}`, { AIMEAT_LOG_LEVEL: 'warn' });
    const local = loop;

    const lcode = /Setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/.exec(local.log)?.[1] ?? '';

    await test('a loopback node prints a code for other machines, and its status does not ask this machine for one', async () => {
        assert(lcode, `no "Setup code:" line in the start log:\n${local.log.split(/\r?\n/).slice(-20).join('\n')}`);
        assert(local.log.includes('asked only from another machine'), 'the start log does not say the code is for other machines');
        const s = await json(local, '/v1/setup/status');
        assert(s.body.data.needsSetup === true && s.body.data.setupCodeRequired === false, `status: ${short(s.body.data)}`);
    });

    // secaudit2026oct22: a node in Docker keeps the default http://localhost base URL while compose
    // publishes its port on every address of the host, and the base URL alone waived the code, so the
    // first visitor from anywhere became the operator. The request below comes in on this machine's
    // own network address, which is not loopback, as a request from another machine or from outside a
    // container does.
    const lan = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
    const fromLan: OwnNode = { ...local, base: `http://${lan}:${LOOPBACK_PORT}` };

    await test('from another address the loopback node asks for the code, and refuses the first account without it', async () => {
        assert(lan, 'this machine has no IPv4 address other than loopback, so the request from another address cannot be made');
        const s = await json(fromLan, '/v1/setup/status');
        assert(s.body.data.setupCodeRequired === true, `status from ${lan}: ${short(s.body.data)}`);
        const r = await json(fromLan, '/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `lanowner${STAMP}`, display_name: 'LAN Owner', password: PASSWORD }) });
        assert(r.status === 403 && r.body.error?.code === 'SETUP_CODE_REQUIRED', `the first account from ${lan} without the code: ${r.status} ${short(r.body)}`);
        const i = await init(fromLan, `laninit${STAMP}`);
        assert(i.status === 403 && i.body.error?.code === 'SETUP_CODE_REQUIRED', `the setup from ${lan} without the code: ${i.status} ${short(i.body)}`);
    });

    // secaudit2026oct26: a tunnel client or a reverse proxy on the same machine hands every outside
    // request to the node on a loopback socket; it says so in a forwarding header.
    await test('a request a same-host proxy forwards is asked for the code, and its first account is refused without it', async () => {
        for (const fwd of [{ 'X-Forwarded-For': '203.0.113.9' }, { Forwarded: 'for=203.0.113.9' }, { 'X-Real-IP': '203.0.113.9' }]) {
            const s = await json(local, '/v1/setup/status', { headers: fwd });
            assert(s.body.data.setupCodeRequired === true, `status through ${Object.keys(fwd)[0]}: ${short(s.body.data)}`);
        }
        const fwd = { 'X-Forwarded-For': '203.0.113.9' };
        const r = await json(local, '/v1/ghii', { method: 'POST', headers: fwd, body: JSON.stringify({ username: `fwdowner${STAMP}`, display_name: 'Forwarded', password: PASSWORD }) });
        assert(r.status === 403 && r.body.error?.code === 'SETUP_CODE_REQUIRED', `the first account through a proxy without the code: ${r.status} ${short(r.body)}`);
        const i = await json(local, '/v1/setup/init', { method: 'POST', headers: fwd, body: JSON.stringify({ locale: 'en', owner: { username: `fwdinit${STAMP}`, password: PASSWORD } }) });
        assert(i.status === 403 && i.body.error?.code === 'SETUP_CODE_REQUIRED', `the setup through a proxy without the code: ${i.status} ${short(i.body)}`);
    });

    await test('a loopback node registers its first account without a code, as the operator', async () => {
        const r = await json(local, '/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `localowner${STAMP}`, display_name: 'Local Owner', password: PASSWORD }) });
        assert(r.status === 201, `expected 201, got ${r.status} ${short(r.body)}`);
        assert(r.body.data.owner.roles.includes('operator'), `roles: ${short(r.body.data.owner.roles)}`);
    });
    await stopNode(loop);
    loop = null;

    // secaudit2026oct26, setup-code/loopback-waiver-honours-connect-tunnel-self-fetch. The connector
    // forward tunnel replays an agent's request frame through the node's own HTTP stack on loopback,
    // so the request arrives on a loopback socket although a remote agent sent it.
    console.log('\nA loopback node with the connector tunnel on, owners and no operator');
    const tunDb = await ownNodeDb(String(TUNNEL_PORT));
    const tunEnv = { AIMEAT_LOG_LEVEL: 'warn', AIMEAT_CONNECT_TUNNEL_ENABLED: 'true', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '20' };
    tun = await startNode(TUNNEL_PORT, `http://127.0.0.1:${TUNNEL_PORT}`, tunEnv, tunDb);
    const tunNodeId = `aimeat-test-001-setupcode${TUNNEL_PORT}${STAMP}`;
    await stopNode(tun);
    const remoteName = `tunremote${STAMP}`;
    const localName = `tunlocal${STAMP}`;
    const tunStore = tunDb.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: tunDb.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: tunDb.sqlitePath });
    try {
        for (const name of [remoteName, localName]) {
            const now = new Date().toISOString();
            await tunStore.createOwner({ name, displayName: name, publicKey: '', roles: ['owner'], createdAt: now });
            await tunStore.createGHII({
                username: name, nodeId: tunNodeId, ghii: `${name}@${tunNodeId}`, displayName: name,
                passwordHash: await hashPassword(PASSWORD), verificationLevel: 0, ownerName: name, totpEnabled: false,
                createdAt: now, updatedAt: now,
            });
        }
    } finally {
        await (tunStore as unknown as { close?: () => unknown }).close?.();
    }
    tun = await startNode(TUNNEL_PORT, `http://127.0.0.1:${TUNNEL_PORT}`, tunEnv, tunDb);
    const tnode = tun;
    const tunFromLan: OwnNode = { ...tnode, base: `http://${lan}:${TUNNEL_PORT}` };
    const signIn = (node: OwnNode, username: string) => json(node, '/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: PASSWORD }) });

    await test('a sign-in a remote agent forwards through the tunnel does not make its owner the operator', async () => {
        assert(lan, 'this machine has no IPv4 address other than loopback, so the remote owner cannot sign in from another address');
        const remote = await signIn(tunFromLan, remoteName);
        assert(remote.status === 200 && !tokenRoles(remote.body.data.token).includes('operator'), `the remote owner's own sign-in: ${remote.status} ${short(tokenRoles(remote.body?.data?.token ?? ''))}`);
        const agent = await makeAgent(tunFromLan.base, { name: remoteName, token: remote.body.data.token }, ['memory:read']);
        const tunnel = await TunnelClient.connect(tunFromLan.base, agent.token);
        try {
            const forwarded = await tunnel.request('POST', '/v1/ghii/login', { body: { username: remoteName, password: PASSWORD }, timeoutMs: 30_000 });
            assert(forwarded.status === 200, `the forwarded sign-in still answers: ${forwarded.status} ${short(forwarded.body)}`);
            assert(!tokenRoles(forwarded.body.data.token).includes('operator'), `the forwarded sign-in made the remote owner the operator: ${short(tokenRoles(forwarded.body.data.token))}`);
            const reg = await tunnel.request('POST', '/v1/ghii', { body: { username: `tunreg${STAMP}`, display_name: 'Tunnel', password: PASSWORD }, timeoutMs: 30_000 });
            assert(reg.status === 403 && reg.body?.error?.code === 'SETUP_CODE_REQUIRED', `a registration forwarded through the tunnel: ${reg.status} ${short(reg.body)}`);
        } finally {
            await tunnel.close();
        }
    });

    // The node goes back to "owners and no operator" whatever the test above did, so the next one
    // stands on its own: on an unfixed node the forwarded sign-in has already made an operator.
    await stopNode(tun);
    const resetStore = tunDb.provider === 'postgres-kysely'
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: tunDb.dbUrl })
        : await createStorage({ provider: 'sqlite', sqlitePath: tunDb.sqlitePath });
    try {
        for (const name of [remoteName, localName]) await resetStore.updateOwner(name, { roles: ['owner'] });
    } finally {
        await (resetStore as unknown as { close?: () => unknown }).close?.();
    }
    tun = await startNode(TUNNEL_PORT, `http://127.0.0.1:${TUNNEL_PORT}`, tunEnv, tunDb);
    const tnodeAgain = tun;

    await test('usage: on the node\'s own machine a sign-in still makes the first owner the operator, without a code', async () => {
        const r = await signIn(tnodeAgain, localName);
        assert(r.status === 200 && tokenRoles(r.body.data.token).includes('operator'), `the local sign-in: ${r.status} ${short(tokenRoles(r.body?.data?.token ?? ''))}`);
    });
} finally {
    await stopNode(pub);
    await stopNode(reg);
    await stopNode(noop);
    await stopNode(loop);
    await stopNode(tun);
    if (!HAD_ENV && existsSync(PACKAGE_ENV)) unlinkSync(PACKAGE_ENV);
}

console.log(`\nSetup code E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) process.exit(1);
