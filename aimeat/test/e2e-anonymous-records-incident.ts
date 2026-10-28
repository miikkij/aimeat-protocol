/**
 * @file e2e-anonymous-records-incident.ts
 * @description The start step that names what the shared anonymous agent wrote outside its namespace
 *   (services/anonymous-principal-records.ts), proven across three real boots of one database.
 *
 *   WHY IT OWNS ITS SERVER. The step runs when the node starts and records that it ran, so the only
 *   honest test is a node that is stopped, given the data, and started again. It follows the runner's
 *   backend: Postgres when the env file names it, a temporary SQLite file otherwise.
 *
 *   THE THREE BOOTS.
 *   1. A fresh node: the step runs and finds nothing, and the Security page holds no incident of its
 *      kind. While it is stopped, the shared anonymous agent gets a webhook, tags and capabilities, the
 *      anonymous account a skill manifest and a data package pointer, all written straight into the
 *      database as an older node let the minted token write them, and the step's record is removed so
 *      the next start meets the database as a deploy does.
 *   2. The start that carries the step: ONE incident, with one entry per record (five), and every
 *      record is where it was, unchanged.
 *   3. The next start: still one incident. The operator then acts on it: the incident lists one entry
 *      per record with its action; a person who is not an operator is refused; the operator clears
 *      the webhook, the tags and the capabilities, deletes the data package and keeps the skill, and
 *      the last decision resolves the incident; a second decision is refused.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-anonymous-records-incident
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-anonymous-records-incident
 * @version-history
 *   v1.1.0 -- 2026-10-25 -- Phase 3 decides the entries: clear, delete, keep, the refusals, and the
 *     incident resolving with its last entry (secaudit2026oct22, developer decision 2026-10-25).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22; developer ruling 2026-10-25).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { ownerSignIn, registerOwner, OWNER_PASSWORD } from './helpers/owner-login.js';
import { ANONYMOUS_PRINCIPAL_RECORDS_KEY } from '../src/services/anonymous-principal-records.js';

const PORT = process.env.E2E_ANON_RECORDS_PORT ?? '28458';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const ANON_GAII = `shared#anonymous@${NODE_ID}`;
const ANON_GHII = `anonymous@${NODE_ID}`;
const INCIDENT_TYPE = 'anonymous_principal_records';

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

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-anonrec-'));
const DB_PATH = join(dbDir, 'anonrec.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the anonymous-records node' });
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

type AnyStorage = Awaited<ReturnType<typeof createStorage>>;

/** The node's own data while it is stopped. */
async function withStorage<T>(fn: (s: AnyStorage) => Promise<T>): Promise<T> {
    const storage = PG_URL
        ? await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL })
        : await createStorage({ provider: 'sqlite', sqlitePath: DB_PATH });
    try { return await fn(storage); }
    finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
}

async function operatorToken(name: string): Promise<string> {
    const tok = await ownerSignIn(BASE, name, OWNER_PASSWORD);
    assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** The incidents of this step's kind, as the operator reads them on the Security page. */
async function stepIncidents(token: string): Promise<any[]> {
    const r = await json('/v1/admin/security/incidents', { headers: { Authorization: `Bearer ${token}` } });
    assert(r.status === 200, `incidents ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.incidents as any[]).filter(i => i.type === INCIDENT_TYPE);
}

(async () => {
    console.log('\n=== What the shared anonymous agent wrote, named once at start ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);
    const stamp = Date.now() % 1_000_000;
    const opName = `anrop${stamp}`;
    const SKILL_KEY = `skills.anr${stamp}.manifest`;
    const PKG_KEY = `datapkg/anr${stamp}/latest.json`;

    console.log('Phase 1: a fresh node');
    let server = await startServer();
    let token = '';
    await test('1a. the operator is set up, and a node with none of these records gets no incident', async () => {
        const reg = await json('/v1/admin/setup/register', {
            method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: opName, password: OWNER_PASSWORD }),
        });
        assert(reg.status === 200 && reg.body.owner?.roles?.includes('operator'), `operator ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
        token = await operatorToken(opName);
        assert((await stepIncidents(token)).length === 0, 'a node with no such record opened an incident');
    });
    await stopServer(server);

    await test('1b. while stopped: the records an older node let the minted token write, and the step\'s record removed', async () => {
        await withStorage(async (s) => {
            const now = new Date().toISOString();
            if (!(await s.getAgent(ANON_GAII))) {
                await s.createOwner({ name: 'anonymous', displayName: 'Anonymous Node', publicKey: 'x', roles: ['owner'], createdAt: now } as never).catch(() => undefined);
                await s.createAgent({
                    name: 'shared', owner: 'anonymous', gaii: ANON_GAII, displayName: 'Shared Anonymous Agent', description: 'x',
                    capabilities: ['memory', 'actions', 'catalogue'], defaultScopes: [], publicKey: 'x', trustScore: 50, morselBalance: 0,
                    createdAt: now, lastSeen: now,
                } as never);
            }
            await s.updateAgent(ANON_GAII, {
                webhookUrl: 'https://hooks.example.test/anon', webhookSecret: 'x', webhookEnabled: true, webhookFailCount: 0,
                tags: ['planted-tag'], technicalCapabilities: [{ type: 'tool', name: 'planted' }] as never, domainCapabilities: ['planted'],
            } as never);
            await s.setMemory({
                key: SKILL_KEY, ownerGaii: ANON_GHII, value: { name: `anr${stamp}`, description: 'planted skill' }, visibility: 'members',
                tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
            await s.createStorageFile({
                key: PKG_KEY, ownerGaii: ANON_GHII, visibility: 'public', mimeType: 'application/json',
                size: 2, data: Buffer.from('{}'), createdAt: now,
            } as never);
            await s.deleteMemory(`system@${NODE_ID}`, ANONYMOUS_PRINCIPAL_RECORDS_KEY);
        });
    });

    console.log('\nPhase 2: the start that carries the step');
    server = await startServer();
    token = await operatorToken(opName);
    await test('2a. the Security page holds ONE incident with one entry per record', async () => {
        const found = await stepIncidents(token);
        assert(found.length === 1, `incidents of the step: ${found.length}`);
        const detail = String(found[0].detail ?? '');
        for (const part of ['hooks.example.test/anon', 'planted-tag', 'capabilities', SKILL_KEY, PKG_KEY]) {
            assert(detail.includes(part), `the incident does not name ${part}: ${detail.slice(0, 400)}`);
        }
        assert(/^5 record/.test(detail) && detail.includes('5. '), `one entry per record: ${detail.slice(0, 200)}`);
    });
    await test('2c. a person who is not an operator is refused the Security page, and reads no incident', async () => {
        const person = await registerOwner(BASE, `anrx${stamp}`);
        const r = await json('/v1/admin/security/incidents', { headers: { Authorization: `Bearer ${person.token}` } });
        assert(r.status === 403, `a non-operator read the incidents: ${r.status}`);
        assert(!JSON.stringify(r.body).includes('hooks.example.test'), 'the refusal carries the incident');
    });
    await stopServer(server);

    await test('2b. nothing was deleted or changed', async () => {
        await withStorage(async (s) => {
            const agent = await s.getAgent(ANON_GAII);
            assert(agent?.webhookUrl === 'https://hooks.example.test/anon' && (agent.tags ?? []).includes('planted-tag'), `the agent's fields changed: ${JSON.stringify({ w: agent?.webhookUrl, t: agent?.tags })}`);
            assert(!!(await s.getMemory(ANON_GHII, SKILL_KEY)), 'the skill manifest is gone');
            assert(!!(await s.getStorageFile(ANON_GHII, PKG_KEY)), 'the data package pointer is gone');
        });
    });

    console.log('\nPhase 3: the next start');
    server = await startServer();
    token = await operatorToken(opName);
    await test('3a. the next start opens no second incident', async () => {
        const n = (await stepIncidents(token)).length;
        assert(n === 1, `expected the one incident after a second start, found ${n}`);
    });

    // The operator acts on each record from the incident (services/incident-entries.ts).
    const decide = (id: string, name: string, resolution: string, bearer = token) => json(`/v1/admin/security/incidents/${encodeURIComponent(id)}/resolve`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ name, resolution }),
    });
    const skillEntry = `skill:anr${stamp}`;
    const pkgEntry = `datapackage:anr${stamp}`;
    let incidentId = '';
    await test('3b. the incident lists one open entry per record, each with its action', async () => {
        const [inc] = await stepIncidents(token);
        incidentId = inc.id;
        const byId = new Map<string, any>((inc.entries ?? []).map((e: any) => [e.id, e]));
        assert(byId.size === 5, `entries: ${JSON.stringify(inc.entries)}`);
        for (const [id, action] of [['agent_webhook', 'clear'], ['agent_tags', 'clear'], ['agent_capabilities', 'clear'], [skillEntry, 'delete'], [pkgEntry, 'delete']]) {
            assert(byId.get(id)?.action === action && byId.get(id)?.status === 'open', `entry ${id}: ${JSON.stringify(byId.get(id))}`);
        }
        assert(byId.get('agent_webhook').params?.url === 'https://hooks.example.test/anon', `the webhook entry carries its address: ${JSON.stringify(byId.get('agent_webhook'))}`);
    });
    await test('3c. a person who is not an operator cannot clear an entry: 403, nothing changes', async () => {
        const person = await registerOwner(BASE, `anry${stamp}`);
        const r = await decide(incidentId, 'agent_webhook', 'clear', person.token);
        assert(r.status === 403, `a non-operator decided an entry: ${r.status}`);
    });
    await test('3d. an action the entry does not offer is refused: 400 INVALID_INPUT', async () => {
        const r = await decide(incidentId, 'agent_webhook', 'delete');
        assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `${r.status} ${JSON.stringify(r.body.error)}`);
    });
    await test('3e. the operator clears the webhook, the tags and the capabilities, deletes the package and keeps the skill; the last decision resolves the incident', async () => {
        for (const [name, resolution] of [['agent_webhook', 'clear'], ['agent_tags', 'clear'], ['agent_capabilities', 'clear'], [pkgEntry, 'delete']]) {
            const r = await decide(incidentId, name, resolution);
            assert(r.status === 200 && typeof r.body.data.entry_done === 'string' && r.body.data.incident_status === 'open', `${name}: ${r.status} ${JSON.stringify(r.body)}`);
        }
        const last = await decide(incidentId, skillEntry, 'keep');
        assert(last.status === 200 && last.body.data.incident_status === 'resolved', `the last decision: ${last.status} ${JSON.stringify(last.body)}`);
        const [inc] = await stepIncidents(token);
        assert(inc.status === 'resolved', `the incident is ${inc.status}`);
        const statuses = Object.fromEntries((inc.entries as any[]).map(e => [e.id, e.status]));
        assert(statuses[skillEntry] === 'kept' && statuses.agent_webhook === 'done' && statuses[pkgEntry] === 'done', `entry statuses: ${JSON.stringify(statuses)}`);
    });
    await test('3f. an entry decided once is not decided again: 409', async () => {
        const r = await decide(incidentId, 'agent_webhook', 'clear');
        assert(r.status === 409 && r.body.error?.code === 'CONFLICT', `${r.status} ${JSON.stringify(r.body.error)}`);
    });
    await stopServer(server);

    await test('3g. the cleared and deleted records are gone, and the kept skill is where it was', async () => {
        await withStorage(async (s) => {
            const agent = await s.getAgent(ANON_GAII);
            assert(!agent?.webhookUrl && agent?.webhookEnabled === false, `the webhook stays: ${JSON.stringify({ w: agent?.webhookUrl, e: agent?.webhookEnabled })}`);
            assert((agent?.tags ?? []).length === 0, `the tags stay: ${JSON.stringify(agent?.tags)}`);
            assert((agent?.technicalCapabilities ?? []).length === 0 && (agent?.domainCapabilities ?? []).length === 0, 'the capabilities stay');
            assert(!(await s.getStorageFile(ANON_GHII, PKG_KEY)), 'the data package pointer stays');
            assert(!!(await s.getMemory(ANON_GHII, SKILL_KEY)), 'the kept skill manifest is gone');
        });
    });
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(async (err) => {
    console.error('anonymous-records-incident: the suite stopped:', err);
    process.exit(1);
});
