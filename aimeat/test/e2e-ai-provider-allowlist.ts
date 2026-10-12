/**
 * @file e2e-ai-provider-allowlist.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT_AI_PROVIDER_ALLOWLIST, on the two doors that decide where a decrypted AI key
 *   may be sent. .env.example says what the setting is for in as many words: restrict WHERE a
 *   decrypted AI key goes, so a poisoned baseUrl cannot carry it out. Every completion, image and
 *   transcription path asked that question through prepareAiCall. Two doors did not.
 *
 *   GET /v1/openrouter/models is the model picker's own door, and it sends the key in an
 *   Authorization header exactly as a completion does. PUT /v1/openrouter/settings stored the
 *   address without consulting the list at all, so a person could save a provider the node would
 *   then refuse to use, and find out later somewhere else.
 *
 *   Both are no-ops where no allowlist is configured, which is the default and what aimeat.io runs,
 *   so this suite spawns a node WITH one. That is the whole reason it owns a port: the setting is
 *   read from the environment at boot and cannot be changed per request.
 *
 *   No call leaves the machine. The allowed host is localhost and the port behind it is closed, so
 *   "got past the gate" is proved by a connection failure rather than by reaching a real provider.
 * @usage cd aimeat && pnpm exec node --import tsx test/run-e2e-ci.ts --test=e2e-ai-provider-allowlist
 * @version-history
 *   v1.1.0 -- 2026-10-12 -- Node 4.0.0 removes /v1/openrouter/settings and /models (the 4.0.0 sweep).
 *     The write half saves through PUT /v1/ai/providers/:id, which asks the same allowlist, and
 *     "wrote nothing" reads GET /v1/ai/providers (it had passed on 4.0.0 only because the legacy read
 *     answered 410). The read half adds the provider test (POST /v1/ai/providers/custom/test, a call
 *     to the predated row's address) on both releases, and keeps the legacy model picker's answer on
 *     3.x and its 410 GONE on 4.0.0.
 *   v1.0.0 — 2026-09-13 — Initial, with the two doors it covers.
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN } from '../src/config-ai-models.js';

// 40420 is this suite's own port and 40421 is the closed one it points the allowed host at;
// check:suite-ports holds both. 40322/40323 were the first choice and belong to
// e2e-federation-settlements-sync, which that gate said out loud before this suite ever ran.
const PORT = process.env.E2E_AI_PROVIDER_ALLOWLIST_PORT ?? '40420';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'AllowlistTest1234';

/** The one host this node's operator permits. Everything else must be refused at both doors. */
const ALLOWED_HOST = 'localhost';
/** Allowed by the list, and nothing listens there, so reaching it proves only that the gate passed. */
const ALLOWED_URL = 'http://localhost:40421/v1';
/** A perfectly ordinary provider address that this node's operator has not permitted. */
const OUTSIDE_URL = 'https://api.openai.com/v1';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-allowlist-'));
const DB_PATH = join(dbDir, 'ai-allowlist.db');

async function startServer(): Promise<ChildProcess> {
    const target = { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        // The point of this suite. Empty is the default everywhere else, and an empty list allows
        // every host, so without this line there is nothing here to prove.
        AIMEAT_AI_PROVIDER_ALLOWLIST: ALLOWED_HOST,
        AIMEAT_RL_OPENROUTER: '1000',
        AIMEAT_RL_GLOBAL: '10000',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the allowlisted AI node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
}

/** The owner's own provider the write door is tried with. */
const OWN_PROVIDER = 'allow-own';

/** Save a provider of the owner's own at `baseUrl` (PUT /v1/ai/providers/:id), with a key to protect. */
async function saveProvider(token: string, baseUrl: string) {
    return json(`/v1/ai/providers/${OWN_PROVIDER}`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({ title: 'Own provider', type: 'openai-compatible', baseUrl, auth: { type: 'key' }, capabilities: { text: { enabled: true, model: 'stub/model' } } }),
    });
}

/** Write the settings row straight to memory, which is how a row predating the allowlist exists. */
async function storeSettings(token: string, baseUrl: string) {
    return json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({
            key: 'openrouter.settings', visibility: 'private',
            value: { provider: 'custom', baseUrl, model: 'stub/model' },
        }),
    });
}

async function main() {
    console.log('\n=== AI provider allowlist E2E ===\n');
    const server = await startServer();
    // Node 4.0.0 removes the legacy model picker (GET /v1/openrouter/models): it answers 410 GONE.
    const legacyGone = await removedOn(BASE, AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN);
    let token = '';

    try {
        console.log('Phase 0: Setup');

        await test('an owner on a node whose operator permits one provider host', async () => {
            const name = `allowlist${Date.now() % 1000000}`;
            const reg = await json('/v1/ghii', {
                method: 'POST',
                body: JSON.stringify({ username: name, display_name: name, password: PASSWORD }),
            });
            assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
            const tok = await ownerSignIn(BASE, name, PASSWORD);
            assert(tok.body.ok === true, `owner token: ${JSON.stringify(tok.body.error)}`);
            token = tok.body.data.token as string;
        });

        console.log('\nPhase 1: The write door refuses an address this node will not use');

        await test('saving a provider outside the allowlist is refused, and the refusal names the host', async () => {
            const r = await saveProvider(token, OUTSIDE_URL);
            assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
            assert(r.body.error?.code === 'PROVIDER_NOT_ALLOWED', `expected PROVIDER_NOT_ALLOWED, got ${r.body.error?.code}`);
            assert(String(r.body.error?.message).includes('api.openai.com'),
                `the message should name the host that was refused: ${r.body.error?.message}`);
        });

        await test('the refusal wrote nothing: no provider record was created', async () => {
            // Refuse before you write. A 403 that had already stored the address would leave the
            // node holding a provider it declines to use, which is the defect on the read door.
            const r = await json('/v1/ai/providers', { headers: auth(token) });
            assert(r.status === 200, `providers ${r.status} ${JSON.stringify(r.body?.error)}`);
            const saved = (r.body.data.providers as any[]).find(p => p.id === OWN_PROVIDER);
            assert(!saved, `the refused address was stored anyway: ${JSON.stringify(saved)}`);
        });

        await test('saving a provider inside the allowlist still works', async () => {
            const r = await saveProvider(token, ALLOWED_URL);
            assert(r.status === 200 || r.status === 201, `expected the save to succeed, got ${r.status} ${JSON.stringify(r.body)}`);
        });

        console.log('\nPhase 2: The read door refuses to send the key to a host the list excludes');

        await test('a settings row that predates the allowlist does not get the key sent to it: the provider test is refused, and so is the legacy model picker (410 GONE on 4.0.0)', async () => {
            // The write door only guards new writes. This row is what an existing account looks
            // like on the day an operator adds the setting, and it is why the read door needs its
            // own test rather than trusting the one on the way in.
            const w = await storeSettings(token, OUTSIDE_URL);
            assert(w.status === 200 || w.status === 201, `storing the row directly: ${w.status} ${JSON.stringify(w.body)}`);

            // The row becomes the owner's provider `custom` on the first read (provider-store.ts),
            // and a test of it is a call to its address: refused before anything is sent.
            const t = await json('/v1/ai/providers/custom/test', { method: 'POST', headers: auth(token), body: JSON.stringify({ capability: 'text' }) });
            assert(t.status === 403, `provider test: expected 403, got ${t.status} ${JSON.stringify(t.body)}`);
            assert(t.body.error?.code === 'PROVIDER_NOT_ALLOWED', `provider test: expected PROVIDER_NOT_ALLOWED, got ${t.body.error?.code}`);

            const r = await json('/v1/openrouter/models', { headers: auth(token) });
            if (legacyGone) {
                assert(r.status === 410 && r.body.error?.code === 'GONE', `the model picker's legacy route: expected 410 GONE on 4.0.0, got ${r.status} ${JSON.stringify(r.body?.error)}`);
                return;
            }
            assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
            assert(r.body.error?.code === 'PROVIDER_NOT_ALLOWED', `expected PROVIDER_NOT_ALLOWED, got ${r.body.error?.code}`);
        });

        await test('an allowed host gets past the gate, and fails on its own merits instead, on the provider test and on the legacy model picker (410 GONE on 4.0.0)', async () => {
            // Nothing listens on 40421, so the only thing this proves is that the allowlist let the
            // call through: a connection failure is a different answer from a refusal, and telling
            // the two apart is the whole assertion.
            const w = await storeSettings(token, ALLOWED_URL);
            assert(w.status === 200 || w.status === 201, `storing the allowed row: ${w.status}`);

            const t = await json('/v1/ai/providers/custom/test', { method: 'POST', headers: auth(token), body: JSON.stringify({ capability: 'text' }) });
            assert(t.body.error?.code !== 'PROVIDER_NOT_ALLOWED',
                `provider test: an allowed host was refused by the allowlist: ${JSON.stringify(t.body.error)}`);
            assert(t.status !== 403 && t.status !== 200, `provider test: an allowed host with nothing listening answered ${t.status}: ${JSON.stringify(t.body)}`);

            const r = await json('/v1/openrouter/models', { headers: auth(token) });
            if (legacyGone) {
                assert(r.status === 410 && r.body.error?.code === 'GONE', `the model picker's legacy route: expected 410 GONE on 4.0.0, got ${r.status} ${JSON.stringify(r.body?.error)}`);
                return;
            }
            assert(r.body.error?.code !== 'PROVIDER_NOT_ALLOWED',
                `an allowed host was refused by the allowlist: ${JSON.stringify(r.body.error)}`);
            assert(r.status !== 403, `an allowed host answered 403: ${JSON.stringify(r.body)}`);
        });

        console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    } finally {
        await stopServer(server);
        try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS keeps the handle a moment on Windows */ }
    }

    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
