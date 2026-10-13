/**
 * @file e2e-rest-scope-keep-working.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent that worked on a 3.x node keeps working when the same node starts as 4.0.x
 *   (services/rest-scope-keep-working-migration.ts; ruling decision-4-0-x-olemassa-olevat-agentit-
 *   saavat-rest-porttien-uudet-san). Proven across three real boots of one database.
 *
 *   WHY IT OWNS ITS SERVER. The step runs at start, only on a node at 4.0.0 or later, and records that
 *   it ran, so the only honest test is one database started as 3.27.0 and then as 4.0.0
 *   (AIMEAT_TEST_SOFTWARE_VERSION, src/utils/version.ts testVersionOverride). It follows the runner's
 *   backend: Postgres when the env file names it, a temporary SQLite file otherwise. On Postgres the
 *   runner's own node started on the same database as 4.0.0 and recorded the step over an empty
 *   database, so that record is removed before the 3.x boot: a 3.x node never writes it.
 *
 *   THE THREE BOOTS.
 *   1. As 3.27.0: an owner and an agent holding memory:read and memory:write, without ext:invoke and
 *      agent:write. It reaches GET /v1/extensions/:name/instances (ext:invoke) and
 *      DELETE /v1/chat-instances/:id (agent:write) with the Deprecation headers.
 *   2. As 4.0.0: the same agent holds both words, keeps what it held, and reaches both routes with a
 *      fresh token; the owner's feed says so in one line. An agent made now does not get the words and
 *      is refused with 403 SCOPE_DENIED. The owner takes ext:invoke away from the old agent.
 *   3. As 4.0.0 again: the word the owner took away stays away, the new agent still lacks the words,
 *      and the Security page holds one incident about the step.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-rest-scope-keep-working
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-rest-scope-keep-working
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_REST_SCOPE_KEEP_WORKING_PORT ?? '40477';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const SYSTEM = `system@${NODE_ID}`;
/** Where the node records that the step ran (services/rest-scope-keep-working-migration.ts). Written
 *  out rather than imported, so the suite runs on code without the step and fails there on the
 *  assertions, and a rename there fails 2f here rather than passing hollow. */
const REST_SCOPE_KEEP_WORKING_KEY = 'migrations.rest-scope-gates-4-0-x.keep-working';
const OLD_RELEASE = '3.27.0';
const NEW_RELEASE = '4.0.0';
/** The two words this suite reads; the rest of the list is proven by test/unit/rest-scope-keep-working.test.ts. */
const BEFORE = ['memory:read', 'memory:write'];

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

// ── the node, three times ──

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-keepworking-'));
const DB_PATH = join(dbDir, 'keepworking.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(release: string): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        AIMEAT_TEST_SOFTWARE_VERSION: release,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    const ready = await waitForServer(child, BASE, { label: `the keep-working node as ${release}` });
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

/** The node's own data while it is stopped. */
async function withStorage<T>(fn: (s: Awaited<ReturnType<typeof createStorage>>) => Promise<T>): Promise<T> {
    const storage = PG_URL
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL })
        : await createStorage({ provider: 'sqlite', sqlitePath: DB_PATH });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

// ── the people and their agents ──

interface Agent { name: string; gaii: string; key: string }

async function agentToken(a: Agent): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii: a.gaii, timestamp: ts, signature: await signMsg(a.key, a.gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${a.gaii}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function createAgent(ownerName: string, token: string, name: string, scopes: string[]): Promise<Agent> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ name, owner: ownerName, display_name: name, capabilities: [], scopes }),
    });
    assert(r.status === 201, `create agent ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
    return { name, gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
}

async function scopesOf(token: string, ownerName: string, agent: string): Promise<string[]> {
    const r = await json(`/v1/agents?owner=${encodeURIComponent(ownerName)}`, { headers: auth(token) });
    assert(r.status === 200, `agent list ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = (r.body.data?.agents ?? r.body.data ?? []) as any[];
    const row = list.find(a => a.name === agent);
    assert(!!row, `agent ${agent} is not in ${ownerName}'s list`);
    return (row.default_scopes ?? row.scopes ?? row.defaultScopes ?? []) as string[];
}

/** The step runs beside the boot, not before it answers: wait until the agent's list shows it. */
async function waitForWords(token: string, ownerName: string, agent: string, words: string[]): Promise<string[]> {
    const began = Date.now();
    let held: string[] = [];
    while (Date.now() - began < 20_000) {
        held = await scopesOf(token, ownerName, agent);
        if (words.every(w => held.includes(w))) return held;
        await new Promise(r => setTimeout(r, 250));
    }
    return held;
}

async function keptEvents(token: string): Promise<any[]> {
    const r = await json('/v1/account/events?limit=500', { headers: auth(token) });
    assert(r.status === 200, `events ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.events as any[]).filter(e => e.kind === 'scope_words_kept');
}

const deprecated = (r: Reply) => r.headers.get('deprecation') === 'true' && r.headers.get('x-aimeat-removed-in') === '4.0.0';

/** The two probes: each passes the gate and then answers 404 for a thing that does not exist. */
const probes: Array<{ word: string; call: (token: string) => Promise<Reply> }> = [
    { word: 'ext:invoke', call: (t) => json('/v1/extensions/no-such-extension/instances', { headers: auth(t) }) },
    { word: 'agent:write', call: (t) => json('/v1/chat-instances/no-such-instance', { method: 'DELETE', headers: auth(t) }) },
];

(async () => {
    const suiteBegan = new Date().toISOString();
    console.log('\n=== Existing agents keep working from 3.x to 4.0.x ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);

    // On Postgres the runner's node, started as this package's 4.0.0, ran the step over the empty
    // database and recorded it. A node that ran 3.x before this release has no such record.
    if (PG_URL) await withStorage(s => s.deleteMemory(SYSTEM, REST_SCOPE_KEEP_WORKING_KEY));

    let server = await startServer(OLD_RELEASE);
    const stamp = Date.now() % 1_000_000;
    const owner = await registerOwner(BASE, `keepwork${stamp}`);
    let token = owner.token;
    let veteran!: Agent;
    let newcomer!: Agent;

    console.log(`Phase 1: the node as ${OLD_RELEASE}`);

    await test('1a. an agent without ext:invoke and agent:write', async () => {
        veteran = await createAgent(owner.name, token, 'veteran', BEFORE);
        const held = await scopesOf(token, owner.name, 'veteran');
        assert(!held.includes('ext:invoke') && !held.includes('agent:write'), `veteran holds [${held.join(', ')}]`);
    });

    await test('1b. on 3.x it reaches both routes, with the Deprecation headers', async () => {
        const t = await agentToken(veteran);
        for (const p of probes) {
            const r = await p.call(t);
            assert(r.status === 404 && deprecated(r), `${p.word}: ${r.status} ${r.headers.get('deprecation')} ${JSON.stringify(r.body?.error)}`);
        }
    });

    await stopServer(server);

    await test('1c. a 3.x node does not run the step', async () => {
        const marker = await withStorage(s => s.getMemory(SYSTEM, REST_SCOPE_KEEP_WORKING_KEY));
        assert(marker === null, `a 3.x boot wrote ${JSON.stringify(marker?.value)}`);
    });

    console.log(`\nPhase 2: the same database as ${NEW_RELEASE}`);
    server = await startServer(NEW_RELEASE);
    token = await ownerToken(BASE, owner.name);

    await test('2a. the agent holds both words and keeps every word it held', async () => {
        const held = await waitForWords(token, owner.name, 'veteran', probes.map(p => p.word));
        for (const w of [...BEFORE, ...probes.map(p => p.word)]) assert(held.includes(w), `veteran holds [${held.join(', ')}], not ${w}`);
    });

    await test('2b. with a fresh token it reaches both routes on 4.0.0, without the Deprecation headers', async () => {
        const t = await agentToken(veteran);
        for (const p of probes) {
            const r = await p.call(t);
            assert(r.status === 404 && r.body?.error?.code === 'NOT_FOUND' && !deprecated(r), `${p.word}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
    });

    await test('2c. the owner\'s feed has one line naming the agent and the words', async () => {
        const events = await keptEvents(token);
        assert(events.length === 1, `expected one scope_words_kept event, found ${events.length}`);
        assert(String(events[0].data?.names).split(', ').includes('veteran'), `names: ${events[0].data?.names}`);
        for (const p of probes) assert(String(events[0].data?.words).includes(p.word), `words: ${events[0].data?.words}`);
        assert(events[0].link === '/v1/profile?tab=agents', `link: ${events[0].link}`);
    });

    await test('2d. an agent made after the step does not get the words, and is refused on 4.0.0', async () => {
        newcomer = await createAgent(owner.name, token, 'newcomer', BEFORE);
        const held = await scopesOf(token, owner.name, 'newcomer');
        for (const p of probes) assert(!held.includes(p.word), `newcomer holds [${held.join(', ')}]`);
        const t = await agentToken(newcomer);
        for (const p of probes) {
            const r = await p.call(t);
            assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `${p.word}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
    });

    await test('2e. the owner takes ext:invoke away from the old agent, and it is refused', async () => {
        const narrowed = (await scopesOf(token, owner.name, 'veteran')).filter(w => w !== 'ext:invoke');
        const r = await json('/v1/agents/veteran/scopes', { method: 'PATCH', headers: auth(token), body: JSON.stringify({ scopes: narrowed }) });
        assert(r.status === 200, `narrow ${r.status}: ${JSON.stringify(r.body.error)}`);
        const refused = await probes[0].call(await agentToken(veteran));
        assert(refused.status === 403 && refused.body?.error?.code === 'SCOPE_DENIED', `after narrowing: ${refused.status}`);
    });

    await stopServer(server);

    await test('2f. the node recorded that the step ran', async () => {
        const marker = await withStorage(s => s.getMemory(SYSTEM, REST_SCOPE_KEEP_WORKING_KEY));
        const v = marker?.value as { at?: unknown; agents?: unknown } | undefined;
        assert(typeof v?.at === 'string' && Array.isArray(v?.agents) && (v.agents as unknown[]).length >= 1,
            `the record under ${SYSTEM} ${REST_SCOPE_KEEP_WORKING_KEY} reads ${JSON.stringify(marker?.value ?? null)}`);
    });

    console.log(`\nPhase 3: ${NEW_RELEASE} again`);
    server = await startServer(NEW_RELEASE);
    token = await ownerToken(BASE, owner.name);
    // Give the boot's steps the time phase 2 needed before reading what they did not do.
    await new Promise(r => setTimeout(r, 3000));

    await test('3a. the word the owner took away stays away', async () => {
        const held = await scopesOf(token, owner.name, 'veteran');
        assert(!held.includes('ext:invoke') && held.includes('agent:write'), `veteran holds [${held.join(', ')}]`);
    });

    await test('3b. the agent made after the step still lacks the words', async () => {
        const held = await scopesOf(token, owner.name, 'newcomer');
        for (const p of probes) assert(!held.includes(p.word), `newcomer holds [${held.join(', ')}]`);
    });

    await test('3c. the feed still has the one line', async () => {
        const events = await keptEvents(token);
        assert(events.length === 1, `found ${events.length} scope_words_kept events`);
    });

    await stopServer(server);

    await test('3d. the Security page holds one incident about the step, naming the words', async () => {
        // Only this suite's: the runner empties the database between suites but not before the first,
        // and on Postgres its own node starts on that database before this suite does.
        const incidents = await withStorage(async (s) => (await s.listAllMemory({ prefix: 'security.incident.', limit: 1000 })).items
            .map(r => r.value as { type?: string; detail?: string; createdAt?: string })
            .filter(v => v?.type === 'scope_words_kept' && String(v.createdAt) >= suiteBegan));
        assert(incidents.length === 1, `found ${incidents.length} scope_words_kept incidents`);
        assert(String(incidents[0].detail).includes('ext:invoke'), `detail: ${incidents[0].detail}`);
    });

    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('SUITE CRASHED:', err);
    process.exit(1);
});
