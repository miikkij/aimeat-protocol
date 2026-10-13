/**
 * @file e2e-app-scope-allowance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A published app that worked on a 3.x node keeps working when the same node starts as
 *   4.0.x, with no change to its code (services/app-scope-allowance.ts; ruling
 *   decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san, apps too). Proven across three
 *   real boots of one database, as e2e-rest-scope-keep-working does for agents.
 *
 *   THE THREE BOOTS.
 *   1. As 3.27.0: an app with no aimeat-scopes whose code calls an extension action
 *      (`session.fetch('/v1/ext/kwprobe/run')`), and its owner's grant with the default four words.
 *      The call passes the gate with the Deprecation headers (then 404: no such extension).
 *   2. As 4.0.0: after a refresh the same grant holds ext:invoke and the call passes; a new sign-in asks
 *      for the word too; the owner reads the kept words and the feed line. An app published now with the
 *      same code keeps nothing: its publish answer warns, and its grant is refused 403 SCOPE_DENIED. The
 *      owner removes ext:invoke from the old app, and its grant is refused.
 *   3. As 4.0.0 again: the removed word stays removed, and the next sign-in does not ask for it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-scope-allowance
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-app-scope-allowance
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { createStorage } from '../src/storage/storage-factory.js';

const PORT = process.env.E2E_APP_SCOPE_ALLOWANCE_PORT ?? '40478';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const SYSTEM = `system@${NODE_ID}`;
/** The step's records (services/rest-scope-keep-working-migration.ts), written out so this suite runs
 *  on code without the step and fails there on its assertions. */
const STEP_KEYS = ['migrations.rest-scope-gates-4-0-x.keep-working', 'migrations.rest-scope-gates-4-0-x.app-allowance'];
const REDIRECT = 'http://localhost:9911/callback';
const DEFAULTS = 'memory:read memory:write storage:read storage:write';
const OLD_RELEASE = '3.27.0';
const NEW_RELEASE = '4.0.0';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Reply { status: number; body: any; headers: Headers }
async function json(path: string, opts: RequestInit = {}): Promise<Reply> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const deprecated = (r: Reply) => r.headers.get('deprecation') === 'true' && r.headers.get('x-aimeat-removed-in') === '4.0.0';

// ── the node, three times ──

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-appallow-'));
const DB_PATH = join(dbDir, 'appallow.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(release: string): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const env: Record<string, string | undefined> = {
        ...process.env, ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_TEST_SOFTWARE_VERSION: release,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    const ready = await waitForServer(child, BASE, { label: `the app allowance node as ${release}` });
    const build = await json('/v1/build');
    assert(build.body?.version === release, `the node runs ${build.body?.version}, not ${release}: the boot proves nothing`);
    return ready;
}

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
    const began = Date.now();
    while (Date.now() - began < 30_000) {
        try { await fetch(`${BASE}/v1/spec`); } catch { return; }
        await new Promise(r => setTimeout(r, 150));
    }
}

async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const storage = PG_URL
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL })
        : await createStorage({ provider: 'sqlite', sqlitePath: DB_PATH });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

// ── the apps and their grants ──

/** An app that signs in with the SDK, declares no aimeat-scopes, and calls an extension action. */
const APP_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="aimeat-app" content="APP">'
    + '<script src="/v1/libs/aimeat-auth.js"></script></head><body><script>'
    + "async function run(session) { return session.fetch('/v1/ext/kwprobe/run', { method: 'POST', body: '{}' }); }"
    + '</script></body></html>';

async function publish(token: string, filename: string): Promise<Reply> {
    const content = Buffer.from(APP_HTML.replace('APP', filename), 'utf8').toString('base64');
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, content, name: filename.replace('.html', ''), description: 'An app that calls an extension action.', category: 'utility' }),
    });
}

/** authorize -> consent -> token for `app`, asking for `scope`; the token payload. */
async function signIn(ownerTok: string, app: string, scope: string): Promise<any> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app, response_type: 'code', scope, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
    assert(!!rid, `authorize: ${res.status} ${res.headers.get('location')}`);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ request_id: rid }) });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200, `token: ${tok.status} ${JSON.stringify(tok.body.error)}`);
    return tok.body.data;
}

async function refresh(refreshToken: string): Promise<any> {
    const r = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }) });
    assert(r.status === 200, `refresh: ${r.status} ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

const callExt = (access: string) => json('/v1/ext/kwprobe/run', { method: 'POST', headers: auth(access), body: '{}' });

(async () => {
    const suiteBegan = new Date().toISOString();
    console.log('\n=== Published apps keep working from 3.x to 4.0.x ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);
    if (PG_URL) await withStorage(async s => { for (const k of STEP_KEYS) await s.deleteMemory(SYSTEM, k); });

    let server = await startServer(OLD_RELEASE);
    const stamp = Date.now() % 1_000_000;
    const owner = await registerOwner(BASE, `appallow${stamp}`);
    let token = owner.token;
    const OLD_APP = `${owner.name}/kw-old.html`;
    let oldGrant: any;

    console.log(`Phase 1: the node as ${OLD_RELEASE}`);

    await test('1a. an app with no aimeat-scopes that calls an extension action, and its owner signs in with the default four', async () => {
        const pub = await publish(token, 'kw-old.html');
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body.error)}`);
        oldGrant = await signIn(token, OLD_APP, DEFAULTS);
        assert(!String(oldGrant.scope).split(' ').includes('ext:invoke'), `the 3.x grant holds ${oldGrant.scope}`);
    });

    await test('1b. on 3.x the app reaches the extension action, with the Deprecation headers', async () => {
        const r = await callExt(oldGrant.access_token);
        assert(r.status === 404 && deprecated(r), `${r.status} ${r.headers.get('deprecation')} ${JSON.stringify(r.body.error)}`);
    });

    await stopServer(server);

    console.log(`\nPhase 2: the same database as ${NEW_RELEASE}`);
    server = await startServer(NEW_RELEASE);
    token = await ownerToken(BASE, owner.name);
    // The step runs beside the boot: wait until the owner can read the kept word.
    const allowance = async (app: string) => json(`/v1/apps/${encodeURIComponent(app.split('/')[0])}/${app.split('/')[1]}/scope-allowance`, { headers: auth(token) });
    for (let i = 0; i < 80; i++) {
        const r = await allowance(OLD_APP);
        if (r.status === 200 && (r.body.data.words ?? []).includes('ext:invoke')) break;
        await new Promise(res => setTimeout(res, 250));
    }

    await test('2a. the owner reads the word the app kept, and the code that needs it', async () => {
        const r = await allowance(OLD_APP);
        assert(r.status === 200, `scope-allowance: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(JSON.stringify(r.body.data.words) === '["ext:invoke"]', `words: ${JSON.stringify(r.body.data)}`);
        assert(String(r.body.data.evidence?.[0]?.evidence).includes('/v1/ext/kwprobe/run'), `evidence: ${JSON.stringify(r.body.data.evidence)}`);
    });

    await test('2b. after a refresh the same grant holds ext:invoke and reaches the action on 4.0.0', async () => {
        oldGrant = { ...oldGrant, ...(await refresh(oldGrant.refresh_token)) };
        assert(String(oldGrant.scope).split(' ').includes('ext:invoke'), `refreshed scope: ${oldGrant.scope}`);
        const r = await callExt(oldGrant.access_token);
        assert(r.status === 404 && r.body?.error?.code === 'NOT_FOUND' && !deprecated(r), `${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('2c. a new sign-in asks for the kept word beside the app\'s own', async () => {
        const again = await signIn(token, OLD_APP, DEFAULTS);
        assert(String(again.scope).split(' ').includes('ext:invoke'), `sign-in scope: ${again.scope}`);
        oldGrant = again;
    });

    await test('2d. the owner\'s feed has one line naming the app and the word', async () => {
        const r = await json('/v1/account/events?limit=500', { headers: auth(token) });
        const kept = (r.body.data.events as any[]).filter(e => e.kind === 'app_scope_words_kept');
        assert(kept.length === 1, `found ${kept.length} app_scope_words_kept events`);
        assert(String(kept[0].data?.names).includes('kw-old') && String(kept[0].data?.words) === 'ext:invoke', JSON.stringify(kept[0].data));
    });

    let newGrant: any;
    await test('2e. an app published after the step keeps nothing, and its publish answer warns about the word', async () => {
        const pub = await publish(token, 'kw-new.html');
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body.error)}`);
        const hint = ((pub.body.data.app_hints ?? []) as any[]).find(h => h.pitfall === 'undeclared-scope-words');
        assert(!!hint && String(hint.message).includes('ext:invoke'), `app_hints: ${JSON.stringify(pub.body.data.app_hints)}`);
        const r = await allowance(`${owner.name}/kw-new.html`);
        assert(r.status === 200 && (r.body.data.words ?? []).length === 0, `the new app keeps ${JSON.stringify(r.body.data)}`);
        newGrant = await signIn(token, `${owner.name}/kw-new.html`, DEFAULTS);
        const call = await callExt(newGrant.access_token);
        assert(call.status === 403 && call.body?.error?.code === 'SCOPE_DENIED', `${call.status} ${JSON.stringify(call.body.error)}`);
    });

    await test('2f. the owner removes the kept word, and the old app\'s grant is refused', async () => {
        const del = await json(`/v1/apps/${owner.name}/kw-old.html/scope-allowance?words=ext:invoke`, { method: 'DELETE', headers: auth(token) });
        assert(del.status === 200 && JSON.stringify(del.body.data.removed) === '["ext:invoke"]', `remove: ${del.status} ${JSON.stringify(del.body)}`);
        oldGrant = { ...oldGrant, ...(await refresh(oldGrant.refresh_token)) };
        assert(!String(oldGrant.scope).split(' ').includes('ext:invoke'), `after removal: ${oldGrant.scope}`);
        const r = await callExt(oldGrant.access_token);
        assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await stopServer(server);

    console.log(`\nPhase 3: ${NEW_RELEASE} again`);
    server = await startServer(NEW_RELEASE);
    token = await ownerToken(BASE, owner.name);
    await new Promise(r => setTimeout(r, 3000));

    await test('3a. the removed word stays removed, and the next sign-in does not ask for it', async () => {
        const r = await allowance(OLD_APP);
        assert(r.status === 200 && (r.body.data.words ?? []).length === 0 && JSON.stringify(r.body.data.removed) === '["ext:invoke"]',
            `allowance: ${JSON.stringify(r.body.data)}`);
        const again = await signIn(token, OLD_APP, DEFAULTS);
        assert(!String(again.scope).split(' ').includes('ext:invoke'), `sign-in scope: ${again.scope}`);
    });

    await test('3b. the feed still has the one line', async () => {
        const r = await json('/v1/account/events?limit=500', { headers: auth(token) });
        const kept = (r.body.data.events as any[]).filter(e => e.kind === 'app_scope_words_kept');
        assert(kept.length === 1, `found ${kept.length}`);
    });

    await stopServer(server);

    await test('3c. the Security page incident counts the app', async () => {
        const incidents = await withStorage(async (s) => (await s.listAllMemory({ prefix: 'security.incident.', limit: 1000 })).items
            .map(r => r.value as { type?: string; detail?: string; createdAt?: string })
            .filter(v => v?.type === 'scope_words_kept' && String(v.createdAt) >= suiteBegan));
        // At least this suite's app; a Postgres run may hold older rows.
        const apps = Number(/(\d+) published app\(s\)/.exec(String(incidents[0]?.detail))?.[1] ?? 0);
        assert(incidents.length === 1 && apps >= 1, `incidents: ${JSON.stringify(incidents.map(i => i.detail))}`);
    });

    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('SUITE CRASHED:', err);
    process.exit(1);
});
