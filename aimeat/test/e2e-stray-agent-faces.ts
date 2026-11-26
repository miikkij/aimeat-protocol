/**
 * @file e2e-stray-agent-faces.ts
 * @description The start step that names the copies of an app's agent face in the memory of accounts
 *   that do not own the app (services/app/stray-agent-faces.ts), proven across three real boots of
 *   one database.
 *
 *   WHY IT OWNS ITS SERVER. The step runs when the node starts and records that it ran, so the only
 *   honest test is a node that is stopped, given the data, and started again. It follows the runner's
 *   backend: Postgres when the env file names it, a temporary SQLite file otherwise.
 *
 *   THE THREE BOOTS.
 *   1. A fresh node: the step runs and finds nothing, and the Security page holds no incident of its
 *      kind. While it is stopped, alice publishes shop.html and blog.html; alice and her agent hold
 *      the face of shop.html, bob and carol hold a public copy of it, dave a public copy of blog.html's,
 *      and bob a face of ghost.html, which no app has. All of it is written straight into the database,
 *      as the library wrote it for each signed-in visitor, and the step's record is removed so the next
 *      start meets the database as a deploy does.
 *   2. The start that carries the step: ONE incident with one entry per app (face:shop.html with 2
 *      copies, face:blog.html with 1), and every record is where it was.
 *   3. The next start: still one incident. A person who is not an operator is refused the incident
 *      routes; an action the entry does not offer is refused; the operator deletes shop.html's copies
 *      and keeps blog.html's, and the last decision resolves the incident; a second decision is
 *      refused. Bob's and carol's copies are in their bins, and alice's face, her agent's, dave's kept
 *      copy and bob's ghost.html face are where they were.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-stray-agent-faces
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-stray-agent-faces
 * @version-history
 *   v1.0.0 -- 2026-11-26 -- Initial (owner ruling 2026-11-26).
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
import { assert, expectRefusal, finish, json as harnessJson, test } from './helpers/harness.js';
import { STRAY_AGENT_FACES_KEY } from '../src/services/app/stray-agent-faces.js';

const PORT = process.env.E2E_STRAY_FACES_PORT ?? '28591';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const INCIDENT_TYPE = 'stray_agent_faces';

/** A request to this suite's own node, never the runner's. */
const json = (path: string, opts: RequestInit = {}) => harnessJson(`${BASE}${path}`, opts);

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-strayfaces-'));
const DB_PATH = join(dbDir, 'strayfaces.db');
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
    return waitForServer(child, BASE, { label: 'the stray-agent-faces node' });
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
    console.log('\n=== Copies of an app\'s agent face in visitors\' memory, named once at start ===');
    console.log(`  backend: ${PG_URL ? 'postgres-kysely (the runner\'s database)' : `sqlite (${DB_PATH})`}\n`);
    const stamp = Date.now() % 1_000_000;
    const opName = `sfop${stamp}`;
    const [alice, bob, carol, dave] = ['alice', 'bob', 'carol', 'dave'].map(n => `${n}${stamp}`);
    const ghii = (n: string) => `${n}@${NODE_ID}`;
    const ALICE_AGENT = `claude#${alice}@${NODE_ID}`;
    const SHOP = 'shop.html', BLOG = 'blog.html', GHOST = 'ghost.html';
    const face = (f: string) => `apps.${f}.agentface`;

    console.log('Phase 1: a fresh node');
    let server = await startServer();
    let token = '';
    await test('1a. the operator and four people are set up, and a node with no stray copy gets no incident', async () => {
        const reg = await json('/v1/admin/setup/register', {
            method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: opName, password: OWNER_PASSWORD }),
        });
        assert(reg.status === 200 && reg.body.owner?.roles?.includes('operator'), `operator ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
        for (const n of [alice, bob, carol, dave]) await registerOwner(BASE, n);
        token = await operatorToken(opName);
        assert((await stepIncidents(token)).length === 0, 'a node with no stray copy opened an incident');
    });
    await stopServer(server);

    await test('1b. while stopped: alice\'s two apps, the faces the library wrote for each visitor, and the step\'s record removed', async () => {
        await withStorage(async (s) => {
            const now = new Date().toISOString();
            for (const filename of [SHOP, BLOG]) {
                await s.createApp({
                    ownerGaii: ghii(alice), ownerName: alice, filename, versionNumber: 1,
                    manifest: { name: filename.replace('.html', ''), description: 'd', version: '1.0.0', author: alice, category: 'tool', tags: [] } as never,
                    mimeType: 'text/html', size: 4, data: Buffer.from('<p/>'), createdAt: now,
                });
            }
            const put = (owner: string, filename: string, text: string) => s.setMemory({
                key: face(filename), ownerGaii: owner, value: text, visibility: 'public',
                tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
            await put(ghii(alice), SHOP, '# Shop, by its owner');
            await put(ALICE_AGENT, SHOP, '# Shop, by the owner\'s agent');
            await put(ghii(bob), SHOP, '# Shop, as bob\'s session wrote it');
            await put(ghii(carol), SHOP, '# Shop, as carol\'s session wrote it');
            await put(ghii(dave), BLOG, '# Blog, as dave\'s session wrote it');
            await put(ghii(bob), GHOST, '# A face of an app nobody has here');
            await s.deleteMemory(`system@${NODE_ID}`, STRAY_AGENT_FACES_KEY);
        });
    });

    console.log('\nPhase 2: the start that carries the step');
    server = await startServer();
    token = await operatorToken(opName);
    await test('2a. the Security page holds ONE incident with one entry per app and the count of its copies', async () => {
        const found = await stepIncidents(token);
        assert(found.length === 1, `incidents of the step: ${found.length}`);
        const byId = new Map<string, any>((found[0].entries ?? []).map((e: any) => [e.id, e]));
        assert(byId.size === 2, `entries: ${JSON.stringify(found[0].entries)}`);
        const shop = byId.get(`face:${SHOP}`), blog = byId.get(`face:${BLOG}`);
        assert(shop?.params?.copies === 2 && shop.params.app === `${alice}/${SHOP}` && shop.action === 'delete' && shop.status === 'open', `shop entry: ${JSON.stringify(shop)}`);
        assert(blog?.params?.copies === 1 && blog.kind === 'agent_face_copies' && blog.where === face(BLOG), `blog entry: ${JSON.stringify(blog)}`);
        const detail = String(found[0].detail ?? '');
        assert(detail.includes(ghii(bob)) && detail.includes(ghii(carol)) && detail.includes(ghii(dave)), `the detail names the holders: ${detail.slice(0, 400)}`);
        assert(!detail.includes(ALICE_AGENT) && !detail.includes(GHOST), `the detail names the owner's agent or the ghost face: ${detail.slice(0, 400)}`);
    });
    await test('2c. a person who is not an operator is refused the Security page, and reads no incident', async () => {
        const person = await registerOwner(BASE, `sfx${stamp}`);
        const r = await json('/v1/admin/security/incidents', { headers: { Authorization: `Bearer ${person.token}` } });
        expectRefusal(r, 403, 'ACCESS_DENIED');
        assert(!JSON.stringify(r.body).includes(ghii(bob)), 'the refusal carries the incident');
    });
    await stopServer(server);

    await test('2b. nothing was deleted or changed', async () => {
        await withStorage(async (s) => {
            for (const [owner, f] of [[ghii(alice), SHOP], [ALICE_AGENT, SHOP], [ghii(bob), SHOP], [ghii(carol), SHOP], [ghii(dave), BLOG], [ghii(bob), GHOST]]) {
                const rec = await s.getMemory(owner, face(f));
                assert(rec?.visibility === 'public', `${owner} ${face(f)} is ${rec ? rec.visibility : 'gone'}`);
            }
        });
    });

    console.log('\nPhase 3: the next start');
    server = await startServer();
    token = await operatorToken(opName);
    await test('3a. the next start opens no second incident', async () => {
        const n = (await stepIncidents(token)).length;
        assert(n === 1, `expected the one incident after a second start, found ${n}`);
    });

    const decide = (id: string, name: string, resolution: string, bearer = token) => json(`/v1/admin/security/incidents/${encodeURIComponent(id)}/resolve`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ name, resolution }),
    });
    const [inc] = await stepIncidents(token);
    const incidentId = String(inc?.id ?? '');
    await test('3b. a person who is not an operator cannot decide an entry: 403', async () => {
        const person = await registerOwner(BASE, `sfy${stamp}`);
        const r = await decide(incidentId, `face:${SHOP}`, 'delete', person.token);
        expectRefusal(r, 403, 'ACCESS_DENIED');
    });
    await test('3c. an action the entry does not offer is refused: 400 INVALID_INPUT', async () => {
        expectRefusal(await decide(incidentId, `face:${SHOP}`, 'clear'), 400, 'INVALID_INPUT');
    });
    await test('3d. the operator deletes shop.html\'s copies and keeps blog.html\'s; the last decision resolves the incident', async () => {
        const del = await decide(incidentId, `face:${SHOP}`, 'delete');
        assert(del.status === 200 && del.body.data.incident_status === 'open' && /^2 copies were moved to the bin/.test(String(del.body.data.entry_done)),
            `delete: ${del.status} ${JSON.stringify(del.body)}`);
        const keep = await decide(incidentId, `face:${BLOG}`, 'keep');
        assert(keep.status === 200 && keep.body.data.incident_status === 'resolved', `keep: ${keep.status} ${JSON.stringify(keep.body)}`);
        const [after] = await stepIncidents(token);
        const statuses = Object.fromEntries((after.entries as any[]).map(e => [e.id, e.status]));
        assert(after.status === 'resolved' && statuses[`face:${SHOP}`] === 'done' && statuses[`face:${BLOG}`] === 'kept', `after: ${after.status} ${JSON.stringify(statuses)}`);
    });
    await test('3e. an entry decided once is not decided again: 409 CONFLICT', async () => {
        expectRefusal(await decide(incidentId, `face:${SHOP}`, 'delete'), 409, 'CONFLICT');
    });
    await stopServer(server);

    await test('3f. bob\'s and carol\'s copies are in their bins; the owner\'s face, her agent\'s, the kept copy and the ghost face stay', async () => {
        await withStorage(async (s) => {
            for (const owner of [ghii(bob), ghii(carol)]) {
                assert(!(await s.getMemory(owner, face(SHOP))), `${owner}'s copy of the shop face stays`);
                const bin = await s.listDeletedMemory(owner);
                assert(bin.some(r => r.key === face(SHOP)), `${owner}'s copy is not in the bin`);
            }
            for (const [owner, f] of [[ghii(alice), SHOP], [ALICE_AGENT, SHOP], [ghii(dave), BLOG], [ghii(bob), GHOST]]) {
                assert(!!(await s.getMemory(owner, face(f))), `${owner} ${face(f)} is gone`);
            }
        });
    });
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
    finish();
})().catch(async (err) => {
    console.error('stray-agent-faces: the suite stopped:', err);
    process.exit(1);
});
