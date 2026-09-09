/**
 * @file test/e2e-setup-and-verification.ts
 * @description The two doors a node opens with, and the doors that say who a person is.
 *
 *   src/routes/setup.ts could only ever be half tested on a shared node, because the thing it does
 *   happens once: POST /v1/setup/init refuses everything after the first owner exists. So this suite
 *   asserts the refusal on the shared node and then SPAWNS TWO NODES OF ITS OWN, each on a fresh
 *   empty SQLite file, to drive the creation itself — one for the imported-key arm, one for the
 *   generated-keypair arm, because a node can only be initialised once and the two arms are mutually
 *   exclusive.
 *
 *   src/routes/verification.ts is driven on the shared node for everything that needs no wallet
 *   (trusted issuers, the W3C credential, the MyData consent receipt) and on the spawned node for
 *   FTN, which is `AIMEAT_FTN_ENABLED` at BOOT and off on the shared one.
 *
 *   THE FOUR EUDIW DOORS CANNOT BE DRIVEN AT ALL, and this suite proves why rather than assuming it.
 *   `src/config-eudiw-guard.ts` refuses to START a node with `AIMEAT_EUDIW_ENABLED=true`, because
 *   the SD-JWT verification behind those doors has no holder binding and never reads back its own
 *   nonce, so a presented credential is replayable. Test 14 spawns a node with the flag on and
 *   asserts the boot refusal; test 15 asserts that with the flag off all four doors answer 503. The
 *   INVALID_STATE, STATE_MISMATCH and presentation_submission branches inside them are unreachable
 *   on any node this repo can build, and are left for the day the guard is deleted.
 *
 *   WHAT IS DELIBERATELY NOT DRIVEN. The real identity-provider exchanges — an actual wallet
 *   presenting a vp_token, and the FTN OIDC authorize/callback pair against tunnistautuminen.suomi.fi
 *   — are left alone. They need a credential signed by an issuer this node trusts and a live bank-ID
 *   session, neither of which a test may fabricate. What is asserted instead is every refusal on the
 *   way in and the one path that takes no proof at all: POST /v1/ghii/verify/ftn accepts any
 *   callback_token and stamps level 3, which is itself worth pinning.
 *
 *   ONE SIDE EFFECT IS MANAGED. POST /v1/setup/init writes an .env into the package root when none
 *   is there. This suite creates a placeholder first and removes it afterwards, unless the developer
 *   already had one, in which case nothing is written or touched.
 *
 * @structure
 *   - Phase 1: setup on the shared node — status, wizard, and the 403 a configured node gives
 *   - Phase 2: a spawned node, empty: every validation refusal, then the imported-key arm
 *   - Phase 3: a second spawned node: the generated-keypair arm
 *   - Phase 5: FTN on the spawned node, with the flag on
 *   - Phase 4: verification on the shared node — the EUDIW boot refusal, issuers, credential, receipt
 * @usage
 *   AIMEAT_PORT=<a free port> AIMEAT_DB_PATH=test/.test-e2e-setup-verification.db \
 *     node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-setup-and-verification
 * @version-history
 *   v1.1.0 — 2026-09-08 — Test 24 asserts that anonymous mode no longer locks a fresh node out of
 *     its own setup (fixed in src/routes/setup.ts) instead of pinning the lock.
 *   v1.0.0 — 2026-09-08 — Initial. 25 tests, 12 of them refusals, and three nodes booted of its own.
 *     Not in the guard tier: it earns that with three identical green runs alone on both backends,
 *     which it has not had time to accumulate.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { waitForServer } from './helpers/wait-for-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

/** The two nodes this suite boots itself. Neither number is written down by any other suite. */
const SETUP_PORT = process.env.E2E_SETUP_PORT ?? '40316';
const SECOND_PORT = process.env.E2E_SETUP_SECOND_PORT ?? '40320';

/** aimeat/.env, which POST /v1/setup/init writes into when nothing is there. */
const PACKAGE_ENV = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const ENV_MARKER = '# placeholder written by test/e2e-setup-and-verification.ts; removed when the suite ends\n';
/**
 * Did a real .env exist before this suite ran? A previous run that was killed mid-flight leaves the
 * placeholder behind, and reading that as "the developer has one" would strand it forever — so the
 * marker counts as ours, not theirs.
 */
const HAD_ENV = existsSync(PACKAGE_ENV) && readFileSync(PACKAGE_ENV, 'utf-8') !== ENV_MARKER;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** A call against any of the three nodes: the shared one by default, a spawned one by base. */
async function call(base: string, path: string, opts: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, contentType: ct };
}

const json = (path: string, opts: RequestInit = {}) => call(BASE, path, opts);
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function tokenFor(base: string, name: string, privateKey: string) {
    const timestamp = new Date().toISOString();
    return call(base, '/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: await signMsg(privateKey, name + NODE_ID + timestamp) }),
    });
}

async function makeOwner(base: string, name: string): Promise<string> {
    const reg = await call(base, '/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    const tok = await tokenFor(base, name, reg.body.data.private_key);
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/**
 * A node of our own on a fresh empty database. The environment is the runner's own pin list
 * (test/run-e2e-server.ts pinnedEnv) narrowed to what a setup node needs: its own port, its own
 * SQLite file, no inherited DATABASE_URL, no third-party credentials, and the two verification
 * flags this suite turns on.
 */
async function spawnNode(port: string, extraEnv: Record<string, string> = {}): Promise<{ child: ChildProcess; base: string; dir: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-setup-'));
    const dbPath = join(dir, 'setup.db');
    const base = `http://localhost:${port}`;
    const env = {
        ...process.env,
        AIMEAT_PORT: port,
        AIMEAT_BASE_URL: base,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_NODE_TYPE: 'full',
        AIMEAT_STORAGE: 'sqlite',
        AIMEAT_SQLITE_PATH: dbPath,
        DATABASE_URL: '',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
        AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        AIMEAT_APP_ORIGIN_ENABLED: 'false', AIMEAT_APP_HOST: '',
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'false', AIMEAT_PORTFOLIO_HOST: '',
        AIMEAT_SMTP_HOST: '', AIMEAT_SMTP_USER: '', AIMEAT_SMTP_PASS: '',
        AIMEAT_GOOGLE_OAUTH_ENABLED: 'false', AIMEAT_ENTRA_OAUTH_ENABLED: 'false',
        AIMEAT_CASDOOR_OAUTH_ENABLED: 'false',
        // OFF, and it has to be: anonymous mode creates an owner named `anonymous` at boot
        // (server-bootstrap/service-init.ts:451), and setup counts owners without excluding it. The
        // runner pins it ON for every suite, so a node spawned from this process would inherit it
        // and report itself already configured. Test 24 pins that as the defect it is.
        AIMEAT_ANONYMOUS: 'false',
        ...extraEnv,
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', dbPath],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    try {
        await waitForServer(child, base, { label: `the node on port ${port}` });
    } catch (err) {
        // The helper has already killed it; wait for the handle to go before the directory does,
        // for the same reason stopNode does — Windows keeps an open SQLite file locked.
        if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
        rmSync(dir, { recursive: true, force: true });
        throw err;
    }
    return { child, base, dir };
}

async function stopNode(node: { child: ChildProcess; dir: string }) {
    node.child.kill('SIGKILL');
    // Wait for the process to be GONE before the directory goes: on Windows an open SQLite handle
    // keeps the file locked and the removal fails, and the next run then boots onto old data.
    await once(node.child, 'exit');
    rmSync(node.dir, { recursive: true, force: true });
}

const stamp = Date.now();
const OP = `setupop${stamp}`;
const PLAIN = `setupplain${stamp}`;
const SETUP_USER = `setupfirst${stamp}`;
const SECOND_USER = `setupsecond${stamp}`;
const SETUP_PASSWORD = 'SetupWizardPw#2026';

let opToken = '';
let plainToken = '';
let consentId = '';
let issuerId = '';

/** The keypair whose PUBLIC half is imported into the first spawned node. */
let importedPublic = '';
let importedPrivate = '';

console.log('\n=== AIMEAT node setup + identity verification E2E ===\n');

if (!HAD_ENV) {
    // The route only writes when nothing is there (setup.ts:237). A placeholder makes that branch a
    // no-op, so this suite cannot leave a configuration file behind on somebody's worktree.
    writeFileSync(PACKAGE_ENV, ENV_MARKER, 'utf-8');
}

try {
    // ─── Phase 1: setup on the shared node ───
    console.log('Phase 1 — setup on a node that is already configured');

    await test('Setup: an operator and a plain owner on the shared node', async () => {
        const op = await json('/v1/admin/setup/register', {
            method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: OP }),
        });
        assert(op.status === 200, `operator register ${op.status}: ${JSON.stringify(op.body)}`);
        const tok = await tokenFor(BASE, OP, op.body.private_key);
        assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body.error)}`);
        opToken = tok.body.data.token;
        plainToken = await makeOwner(BASE, PLAIN);
    });

    await test('1. GET /v1/setup/status says a node with owners needs no setup', async () => {
        const { status, body } = await json('/v1/setup/status');
        assert(status === 200, `expected 200, got ${status}`);
        assert(body.data.needsSetup === false, `needsSetup: ${body.data.needsSetup}`);
        assert(body.data.nodeId === NODE_ID, `nodeId: ${body.data.nodeId}`);
    });

    await test('2. GET /v1/setup/wizard serves the wizard page itself', async () => {
        const { status, body, contentType } = await json('/v1/setup/wizard');
        assert(status === 200, `expected 200, got ${status}`);
        assert(contentType.includes('text/html'), `content-type: ${contentType}`);
        const html = body._raw as string;
        assert(html.includes('<title>AIMEAT Setup Wizard</title>'), 'the page is the wizard');
        assert(html.includes('id="username"'), 'the account step is in it');
        // The CSP nonce is stamped into every script tag; a page served without one cannot run.
        assert(/<script nonce="[^"]+"/.test(html), 'each script tag carries a CSP nonce');
    });

    await test('3. POST /v1/setup/init on a configured node is refused', async () => {
        const { status, body } = await json('/v1/setup/init', {
            method: 'POST',
            body: JSON.stringify({ owner: { username: `late${stamp}`, password: SETUP_PASSWORD } }),
        });
        assert(status === 403, `expected 403, got ${status}`);
        assert(body.error?.code === 'ALREADY_CONFIGURED', `code: ${body.error?.code}`);
    });

    // ─── Phase 2 and 5: a node of our own, empty, with FTN on ───
    // EUDIW is NOT turned on here, and cannot be: src/config-eudiw-guard.ts refuses to start a node
    // with AIMEAT_EUDIW_ENABLED=true. Phase 6 drives that refusal and the 503 it leaves behind.
    const setupNode = await spawnNode(SETUP_PORT, { AIMEAT_FTN_ENABLED: 'true' });
    let setupOwnerToken = '';
    let setupGhii = '';

    try {
        console.log('\nPhase 2 — setup on an empty node of our own');

        await test('4. An empty node reports that it needs setting up', async () => {
            const { status, body } = await call(setupNode.base, '/v1/setup/status');
            assert(status === 200, `expected 200, got ${status}`);
            assert(body.data.needsSetup === true, `needsSetup: ${body.data.needsSetup}`);
        });

        await test('5. Every shape the first owner may not have is refused', async () => {
            const refusals: Array<[string, unknown]> = [
                ['no owner object', {}],
                ['owner is not an object', { owner: 'me' }],
                ['no username', { owner: { password: SETUP_PASSWORD } }],
                ['a username the node cannot address', { owner: { username: 'Not A Name', password: SETUP_PASSWORD } }],
                ['a reserved username', { owner: { username: 'admin', password: SETUP_PASSWORD } }],
                ['no password', { owner: { username: SETUP_USER } }],
                ['a password under eight characters', { owner: { username: SETUP_USER, password: 'short' } }],
                ['an empty imported key', { owner: { username: SETUP_USER, password: SETUP_PASSWORD, importPublicKey: '   ' } }],
                ['an imported key that is not a string', { owner: { username: SETUP_USER, password: SETUP_PASSWORD, importPublicKey: 42 } }],
            ];
            for (const [what, payload] of refusals) {
                const { status, body } = await call(setupNode.base, '/v1/setup/init', {
                    method: 'POST', body: JSON.stringify(payload),
                });
                assert(status === 400, `${what}: expected 400, got ${status} ${JSON.stringify(body.error)}`);
                assert(body.error?.code === 'INVALID_INPUT', `${what}: code ${body.error?.code}`);
            }
            // Nothing above created anything: the node is still empty.
            const after = await call(setupNode.base, '/v1/setup/status');
            assert(after.body.data.needsSetup === true, 'a refused init leaves the node uninitialised');
        });

        await test('6. The first owner is created with a key the operator brought', async () => {
            const priv = ed.utils.randomSecretKey();
            importedPrivate = Buffer.from(priv).toString('base64');
            importedPublic = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('base64');

            const { status, body } = await call(setupNode.base, '/v1/setup/init', {
                method: 'POST',
                body: JSON.stringify({
                    locale: 'en', nodeType: 'full',
                    owner: {
                        username: SETUP_USER, displayName: 'The first owner',
                        password: SETUP_PASSWORD, importPublicKey: importedPublic,
                    },
                }),
            });
            assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.owner.name === SETUP_USER, `owner: ${body.data.owner.name}`);
            assert(body.data.owner.displayName === 'The first owner', `displayName: ${body.data.owner.displayName}`);
            // The first owner of a node is its operator, and the roles come off the record.
            assert(JSON.stringify(body.data.owner.roles) === JSON.stringify(['owner', 'operator']),
                `roles: ${JSON.stringify(body.data.owner.roles)}`);
            assert(body.data.agent.name === 'app', `default agent: ${body.data.agent.name}`);
            assert(body.data.agent.gaii === `app#${SETUP_USER}@${NODE_ID}`, `agent gaii: ${body.data.agent.gaii}`);
            assert(typeof body.data.token === 'string' && body.data.token.length > 0, 'a session comes back with it');
            setupOwnerToken = body.data.token;
            setupGhii = `${SETUP_USER}@${NODE_ID}`;
        });

        await test('7. The imported key is the one the node kept, proved by signing with its half', async () => {
            // The only proof that matters: the node verifies a signature made with the private half
            // the operator never sent. A generated key would refuse this.
            const tok = await tokenFor(setupNode.base, SETUP_USER, importedPrivate);
            assert(tok.body.ok === true, `the imported key authenticates: ${JSON.stringify(tok.body.error)}`);
            assert(typeof tok.body.data.token === 'string', 'and yields a session');
        });

        await test('8. The session the wizard hands back is an OWNER session, not the new agent\'s', async () => {
            // Invariant 12: this mint used to put ['agent','owner','operator'] on a token whose sub was
            // the agent GAII. requireOwnerPrincipal is the door that tells the difference.
            const { status, body } = await call(setupNode.base, `/v1/owners/${SETUP_USER}/export`, {
                headers: authed(setupOwnerToken),
            });
            assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.owner.name === SETUP_USER, `owner: ${body.data.owner.name}`);
            assert((body.data.agents as any[]).some(a => a.gaii === `app#${SETUP_USER}@${NODE_ID}`),
                'the default agent belongs to this owner');
        });

        await test('9. A node that has just been set up refuses a second setup', async () => {
            const { status, body } = await call(setupNode.base, '/v1/setup/init', {
                method: 'POST',
                body: JSON.stringify({ owner: { username: `again${stamp}`, password: SETUP_PASSWORD } }),
            });
            assert(status === 403, `expected 403, got ${status}`);
            assert(body.error?.code === 'ALREADY_CONFIGURED', `code: ${body.error?.code}`);
            const st = await call(setupNode.base, '/v1/setup/status');
            assert(st.body.data.needsSetup === false, `needsSetup: ${st.body.data.needsSetup}`);
        });

        // ─── Phase 3: the other arm, on a second empty node ───
        console.log('\nPhase 3 — the generated-keypair arm');

        await test('10. Without an imported key the node makes its own, which nobody else holds', async () => {
            const other = await spawnNode(SECOND_PORT);
            try {
                const { status, body } = await call(other.base, '/v1/setup/init', {
                    method: 'POST',
                    body: JSON.stringify({ owner: { username: SECOND_USER, password: SETUP_PASSWORD } }),
                });
                assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
                assert(body.data.owner.name === SECOND_USER, `owner: ${body.data.owner.name}`);
                // displayName falls back to the username when none is given.
                assert(body.data.owner.displayName === SECOND_USER, `displayName: ${body.data.owner.displayName}`);
                assert(typeof body.data.token === 'string', 'a session comes back');

                // The key was generated inside the node: the pair from the OTHER node does not open it.
                const wrong = await tokenFor(other.base, SECOND_USER, importedPrivate);
                assert(wrong.body.ok !== true, `a key the node never stored must not authenticate: ${JSON.stringify(wrong.body.data)}`);

                // The password half of the account works, which is the credential the wizard set.
                const login = await call(other.base, '/v1/ghii/login', {
                    method: 'POST', body: JSON.stringify({ username: SECOND_USER, password: SETUP_PASSWORD }),
                });
                assert(login.status === 200, `the password set by the wizard signs in: ${login.status}`);
            } finally {
                await stopNode(other);
            }
        });

        // ─── Phase 5: FTN, on the node that booted with the flag on ───
        console.log('\nPhase 5 — FTN on a node that has it enabled');

        await test('11. POST /v1/ghii/verify/ftn refuses an empty body and an anonymous caller', async () => {
            const missing = await call(setupNode.base, '/v1/ghii/verify/ftn', {
                method: 'POST', headers: authed(setupOwnerToken), body: JSON.stringify({}),
            });
            assert(missing.status === 400, `no callback_token: expected 400, got ${missing.status}`);
            assert(missing.body.error?.code === 'VALIDATION_ERROR', `code: ${missing.body.error?.code}`);

            const unauth = await call(setupNode.base, '/v1/ghii/verify/ftn', {
                method: 'POST', body: JSON.stringify({ callback_token: 'anything' }),
            });
            assert(unauth.status === 401, `no credential: expected 401, got ${unauth.status}`);
        });

        await test('12. An agent acting in the person\'s name cannot stamp the person as verified', async () => {
            // requireOwnerPrincipal, not requireRole('owner'): an agent JWT carries the human's account
            // name, so the route's own `req.auth!.owner` lookup would find the right GHII and write
            // level 3 onto it on a machine's say-so.
            const agent = await call(setupNode.base, '/v1/agents', {
                method: 'POST', headers: authed(setupOwnerToken),
                body: JSON.stringify({ name: 'ftnagent', owner: SETUP_USER, capabilities: ['memory'], model: 'test-model' }),
            });
            assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body.error)}`);
            const gaii = agent.body.data.agent.gaii as string;
            const ts = new Date().toISOString();
            const tok = await call(setupNode.base, '/v1/auth/token', {
                method: 'POST',
                body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(agent.body.data.private_key, gaii + ts) }),
            });
            assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);

            const { status, body } = await call(setupNode.base, '/v1/ghii/verify/ftn', {
                method: 'POST', headers: authed(tok.body.data.token),
                body: JSON.stringify({ callback_token: 'an agent should not get to say this' }),
            });
            assert(status === 403, `expected 403, got ${status}`);
            assert(body.error?.code === 'ACCESS_DENIED', `code: ${body.error?.code}`);
        });

        await test('13. FTN takes any callback_token and stamps level 3 on the record', async () => {
            // WHAT THIS PINS: the route does not verify the token against anything. Whatever string
            // arrives, the account is marked verified at the highest level the node has. The real
            // exchange is the OIDC authorize/callback pair, which this suite deliberately leaves
            // alone; this is the manual/API path beside it, and it takes no proof.
            const before = await call(setupNode.base, `/v1/ghii/${encodeURIComponent(setupGhii)}`, {
                headers: authed(setupOwnerToken),
            });
            const levelBefore = before.body.data.verification_level ?? before.body.data.verificationLevel;
            assert(levelBefore === 0, `the account starts unverified: ${levelBefore}`);

            const { status, body } = await call(setupNode.base, '/v1/ghii/verify/ftn', {
                method: 'POST', headers: authed(setupOwnerToken),
                body: JSON.stringify({ callback_token: 'a string this node never checks' }),
            });
            assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
            assert(body.data.verificationLevel === 3, `level: ${body.data.verificationLevel}`);
            assert(body.data.ftnVerified === true, `ftnVerified: ${body.data.ftnVerified}`);
            assert(body.data.verificationMethod === 'ftn', `method: ${body.data.verificationMethod}`);
            assert(body.data.ghii === setupGhii, `ghii: ${body.data.ghii}`);

            const after = await call(setupNode.base, `/v1/ghii/${encodeURIComponent(setupGhii)}`, {
                headers: authed(setupOwnerToken),
            });
            const level = after.body.data.verification_level ?? after.body.data.verificationLevel;
            assert(level === 3, `the level is on the record, not only in the answer: ${level}`);
        });
    } finally {
        await stopNode(setupNode);
    }

    // ─── Phase 4: verification on the shared node ───
    console.log('\nPhase 4 — issuers, credentials and consent receipts');

    await test('14. A node will not start at all with EUDIW switched on', async () => {
        // src/config-eudiw-guard.ts, and the reason the four EUDIW doors below cannot be driven by
        // this suite or by anybody: the SD-JWT verification behind them has no holder binding and
        // never reads back its own nonce, so a presented credential is replayable. The flag refuses
        // at boot rather than letting an operator turn on a replayable login. THIS is what makes
        // those routes unreachable today, and it is asserted rather than assumed.
        const dir = mkdtempSync(join(tmpdir(), 'aimeat-eudiw-'));
        try {
            const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dir, 'x.db')], {
                env: {
                    ...process.env,
                    AIMEAT_PORT: SECOND_PORT, AIMEAT_BASE_URL: `http://localhost:${SECOND_PORT}`,
                    AIMEAT_NODE_ID: NODE_ID, AIMEAT_STORAGE: 'sqlite',
                    AIMEAT_SQLITE_PATH: join(dir, 'x.db'), DATABASE_URL: '',
                    AIMEAT_EUDIW_ENABLED: 'true',
                },
                stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(),
            });
            let stderr = '';
            child.stdout?.on('data', () => { /* drained */ });
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
            const [code] = await once(child, 'exit') as [number | null];
            assert(code !== 0, `the node must refuse to start, exited ${code}`);
            assert(stderr.includes('AIMEAT_EUDIW_ENABLED=true'), `the refusal names the flag: ${stderr.slice(0, 300)}`);
            assert(stderr.includes('holder binding'), `and says what is missing: ${stderr.slice(0, 300)}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    await test('15. With the flag off, every EUDIW door answers 503 and so does FTN', async () => {
        const req = await json('/v1/ghii/verify/eudiw/request', { headers: authed(opToken) });
        assert(req.status === 503, `eudiw request: expected 503, got ${req.status}`);
        assert(req.body.error?.code === 'FEATURE_DISABLED', `code: ${req.body.error?.code}`);

        const verify = await json('/v1/ghii/verify/eudiw', {
            method: 'POST', headers: authed(opToken), body: JSON.stringify({ vp_token: 'x' }),
        });
        assert(verify.status === 503, `eudiw verify: expected 503, got ${verify.status}`);

        // The callback takes no credential by design (it is a wallet redirect), so the flag is the
        // only thing in front of it.
        const callback = await json('/v1/ghii/verify/eudiw/callback', {
            method: 'POST', body: JSON.stringify({ vp_token: 'x', state: 'y' }),
        });
        assert(callback.status === 503, `eudiw callback: expected 503, got ${callback.status}`);

        const ftn = await json('/v1/ghii/verify/ftn', {
            method: 'POST', headers: authed(opToken), body: JSON.stringify({ callback_token: 'x' }),
        });
        assert(ftn.status === 503, `ftn: expected 503, got ${ftn.status}`);
    });

    await test('16. POST /v1/trusted-issuers refuses an incomplete issuer and an unknown type', async () => {
        const incomplete = await json('/v1/trusted-issuers', {
            method: 'POST', headers: authed(opToken), body: JSON.stringify({ name: 'Half an issuer' }),
        });
        assert(incomplete.status === 400, `expected 400, got ${incomplete.status}`);
        assert(String(incomplete.body.error?.message).includes('publicKey'), `message: ${incomplete.body.error?.message}`);

        const badType = await json('/v1/trusted-issuers', {
            method: 'POST', headers: authed(opToken),
            body: JSON.stringify({ name: 'Wrong kind', url: 'https://issuer.example', publicKey: '{}', type: 'passport' }),
        });
        assert(badType.status === 400, `expected 400, got ${badType.status}`);
        assert(String(badType.body.error?.message).includes('eudiw'), `message: ${badType.body.error?.message}`);
    });

    await test('17. Only an operator may add a trusted issuer', async () => {
        const denied = await json('/v1/trusted-issuers', {
            method: 'POST', headers: authed(plainToken),
            body: JSON.stringify({ name: 'Uninvited', url: 'https://issuer.example', publicKey: '{}', type: 'eudiw' }),
        });
        assert(denied.status === 403, `expected 403, got ${denied.status}`);

        const anonymous = await json('/v1/trusted-issuers', {
            method: 'POST',
            body: JSON.stringify({ name: 'Uninvited', url: 'https://issuer.example', publicKey: '{}', type: 'eudiw' }),
        });
        assert(anonymous.status === 401, `expected 401, got ${anonymous.status}`);
    });

    await test('18. An operator adds an issuer, and it comes back from the list', async () => {
        const { status, body } = await json('/v1/trusted-issuers', {
            method: 'POST', headers: authed(opToken),
            body: JSON.stringify({
                name: `E2E issuer ${stamp}`, url: `https://issuer-${stamp}.example`,
                publicKey: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'not-a-real-key' }), type: 'eudiw',
            }),
        });
        assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
        issuerId = body.data.issuer.id;
        assert(body.data.issuer.trusted === true, `trusted: ${body.data.issuer.trusted}`);
        assert(body.data.issuer.addedBy === OP, `addedBy: ${body.data.issuer.addedBy}`);

        const list = await json('/v1/trusted-issuers', { headers: authed(opToken) });
        assert(list.status === 200, `list ${list.status}`);
        assert((list.body.data.issuers as any[]).some(i => i.id === issuerId), 'the issuer is listed');
        assert(list.body.data.total === (list.body.data.issuers as any[]).length, 'the total matches the rows');

        const filtered = await json('/v1/trusted-issuers?type=ftn', { headers: authed(opToken) });
        assert((filtered.body.data.issuers as any[]).every(i => i.type === 'ftn'), 'the type filter narrows the list');
        assert(!(filtered.body.data.issuers as any[]).some(i => i.id === issuerId), 'and leaves the eudiw one out');
    });

    await test('19. GET /v1/ghii/:ghii/credential issues the person\'s own credential', async () => {
        const { status, body } = await json(`/v1/ghii/${encodeURIComponent(`${PLAIN}@${NODE_ID}`)}/credential`, {
            headers: authed(plainToken),
        });
        assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
        const cred = body.data.credential;
        assert(Array.isArray(cred.type) && cred.type.includes('VerifiableCredential'), `type: ${JSON.stringify(cred.type)}`);
        assert(cred.credentialSubject.id === `did:aimeat:${PLAIN}@${NODE_ID}`, `subject: ${cred.credentialSubject.id}`);
        assert(typeof cred.issuer === 'string' && cred.issuer.length > 0, `issuer: ${cred.issuer}`);
    });

    await test('20. ?format=jwt returns the same credential signed', async () => {
        const { status, body } = await json(`/v1/ghii/${encodeURIComponent(`${PLAIN}@${NODE_ID}`)}/credential?format=jwt`, {
            headers: authed(plainToken),
        });
        assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
        assert(body.data.format === 'vc+ld+jwt', `format: ${body.data.format}`);
        const parts = String(body.data.credential).split('.');
        assert(parts.length === 3, `a JWT has three parts, got ${parts.length}`);
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
        assert(header.alg === 'EdDSA' && header.typ === 'vc+ld+jwt', `header: ${JSON.stringify(header)}`);
    });

    await test('21. A credential is refused for an unknown person and for somebody else', async () => {
        const unknown = await json(`/v1/ghii/${encodeURIComponent(`nosuch${stamp}@${NODE_ID}`)}/credential`, {
            headers: authed(plainToken),
        });
        assert(unknown.status === 404, `expected 404, got ${unknown.status}`);
        assert(unknown.body.error?.code === 'NOT_FOUND', `code: ${unknown.body.error?.code}`);

        const someoneElse = await json(`/v1/ghii/${encodeURIComponent(`${OP}@${NODE_ID}`)}/credential`, {
            headers: authed(plainToken),
        });
        assert(someoneElse.status === 403, `expected 403, got ${someoneElse.status}`);
        assert(someoneElse.body.error?.code === 'ACCESS_DENIED', `code: ${someoneElse.body.error?.code}`);

        const anonymous = await json(`/v1/ghii/${encodeURIComponent(`${PLAIN}@${NODE_ID}`)}/credential`);
        assert(anonymous.status === 401, `expected 401, got ${anonymous.status}`);
    });

    await test('22. GET /v1/consent/:id/receipt gives the owner their MyData receipt', async () => {
        const grant = await json('/v1/consent', {
            method: 'POST', headers: authed(plainToken),
            body: JSON.stringify({
                data_pattern: 'receipts.*', recipient: `ghii:${OP}@${NODE_ID}`,
                purpose: 'so there is a consent to write a receipt for', scope: 'private',
            }),
        });
        assert(grant.status === 201, `consent ${grant.status}: ${JSON.stringify(grant.body.error)}`);
        consentId = grant.body.data.id;

        const { status, body } = await json(`/v1/consent/${consentId}/receipt`, { headers: authed(plainToken) });
        assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
        const receipt = body.data.receipt;
        assert(!!receipt, `receipt: ${JSON.stringify(body.data)}`);
        assert(JSON.stringify(receipt).includes(`${PLAIN}@${NODE_ID}`), 'the receipt names the person it belongs to');
    });

    await test('23. A receipt is refused for somebody else\'s consent and for one that does not exist', async () => {
        const someoneElse = await json(`/v1/consent/${consentId}/receipt`, { headers: authed(opToken) });
        // The operator arm is deliberate: an operator may read any receipt. A PLAIN second owner
        // may not, and that is the comparison this door exists to make.
        assert(someoneElse.status === 200, `the operator may read it: ${someoneElse.status}`);

        const third = await makeOwner(BASE, `receiptother${stamp}`);
        const denied = await json(`/v1/consent/${consentId}/receipt`, { headers: authed(third) });
        assert(denied.status === 403, `expected 403, got ${denied.status}`);
        assert(denied.body.error?.code === 'ACCESS_DENIED', `code: ${denied.body.error?.code}`);

        const missing = await json(`/v1/consent/no-such-consent-${stamp}/receipt`, { headers: authed(plainToken) });
        assert(missing.status === 404, `expected 404, got ${missing.status}`);
        assert(missing.body.error?.code === 'NOT_FOUND', `code: ${missing.body.error?.code}`);

        const anonymous = await json(`/v1/consent/${consentId}/receipt`);
        assert(anonymous.status === 401, `expected 401, got ${anonymous.status}`);
    });

    await test('24. Anonymous mode does not count as a person: a brand-new node can still be set up', async () => {
        // A node booted with AIMEAT_ANONYMOUS=true creates an owner called `anonymous` before anybody
        // arrives (server-bootstrap/service-init.ts). Until 2026-09-08 both setup doors counted it,
        // so the wizard reported "already configured" and POST /v1/setup/init refused on a node
        // that had never had a person on it. Fixed in src/routes/setup.ts the way routes/owners.ts
        // already skipped that account; this asserts the fix.
        const node = await spawnNode(SECOND_PORT, { AIMEAT_ANONYMOUS: 'true' });
        try {
            const anon = await call(node.base, '/v1/owners/anonymous');
            assert(anon.status === 200, `the system account exists: ${anon.status}`);
            const status = await call(node.base, '/v1/setup/status');
            assert(status.body.data.needsSetup === true,
                `a node with nobody on it needs setup: ${status.body.data.needsSetup}`);
            const init = await call(node.base, '/v1/setup/init', {
                method: 'POST',
                body: JSON.stringify({ owner: { username: `anonfirst${stamp}`, password: SETUP_PASSWORD } }),
            });
            assert(init.status === 201, `expected 201, got ${init.status}: ${JSON.stringify(init.body.error)}`);
            const after = await call(node.base, '/v1/setup/status');
            assert(after.body.data.needsSetup === false, `and then it is configured: ${after.body.data.needsSetup}`);
            const again = await call(node.base, '/v1/setup/init', {
                method: 'POST',
                body: JSON.stringify({ owner: { username: `anonsecond${stamp}`, password: SETUP_PASSWORD } }),
            });
            assert(again.status === 403, `a second init is refused: ${again.status}`);
            assert(again.body.error?.code === 'ALREADY_CONFIGURED', `code: ${again.body.error?.code}`);
        } finally {
            await stopNode(node);
        }
    });
} finally {
    if (!HAD_ENV && existsSync(PACKAGE_ENV)) unlinkSync(PACKAGE_ENV);
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
