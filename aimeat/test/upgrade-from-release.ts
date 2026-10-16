/**
 * @file test/upgrade-from-release.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The upgrade a self-hosted node and every desktop install takes: the CURRENT code starts
 *   on a database that the PUBLISHED release (the previous tag) created and wrote (QA audit P6-05).
 *
 *   WHY IT EXISTS. Every E2E suite starts from a database the current code created, and the suite that
 *   proves "3.27.0 then 4.0.0" runs the current code twice with a version flag. So a column added to the
 *   SQLite CREATE block without its ALTER, an index placed before the ALTER, or a PostgreSQL migration
 *   that fails over rows passes every test and stops an upgraded node at start. That pair has broken real
 *   SQLite upgrades twice (docs/pitfalls.md, "no such column").
 *
 *   WHAT IT DOES, on the backend AIMEAT_DB names (sqlite or postgres-kysely):
 *     1. Takes the release tag (UPGRADE_FROM_TAG, else the newest v*.*.* tag reachable from HEAD), puts
 *        that tree in a temporary folder with `git archive`, and installs its aimeat/ there
 *        (`pnpm install --frozen-lockfile`). UPGRADE_OLD_DIR points at a prepared copy instead.
 *     2. Starts THAT release on a new database, and writes through its own API: an owner with a
 *        password (the operator), a memory record, a stored file, an agent and an organism.
 *     3. Stops it and starts the CURRENT code on the same database. The node starts, reports the
 *        current version, the owner signs in with the same password and is still the operator, and the
 *        record, the file's bytes, the agent and the organism read back.
 *     4. Starts the current code on a fresh database and compares the schemas: every table, column and
 *        index the fresh database has, the upgraded one has too.
 *
 *   It is not in the E2E sweep's list because step 1 installs a second dependency tree. The nightly
 *   workflow runs it on both backends (.github/workflows/e2e-full.yml, job upgrade-from-release).
 * @usage cd aimeat && pnpm test:upgrade                        (SQLite)
 *   cd aimeat && AIMEAT_DB=postgres-kysely DATABASE_URL=postgresql://… pnpm test:upgrade
 * @version-history
 *   2026-10-16 — Initial (QA audit P6-05).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';
import { waitForServer } from './helpers/wait-for-server.js';

const PORT = process.env.UPGRADE_PORT ?? '31790';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-upgrade-001-test';
const BACKEND = process.env.AIMEAT_DB === 'postgres-kysely' ? 'postgres-kysely' : 'sqlite';
const REPO = resolve(process.cwd(), '..');
const CURRENT = process.cwd();
const OWNER = `upg${Date.now() % 100000}`;
const PASSWORD = 'Upgrade123456';
const FILE_BYTES = randomBytes(2048);
const ENCRYPTION_KEY = randomBytes(32).toString('hex');

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
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
function sh(cmd: string, args: string[], cwd: string): string {
    // pnpm is a .cmd file on Windows, which only a shell starts; everything else runs without one.
    const viaShell = process.platform === 'win32' && cmd === 'pnpm';
    const r = viaShell
        ? spawnSync([cmd, ...args].join(' '), { cwd, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 })
        : spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').slice(-2000)}`);
    return r.stdout.trim();
}

const work = mkdtempSync(join(tmpdir(), 'aimeat-upgrade-'));
const KEY_PATH = join(work, 'node-key.json');

// ── the database ──

type Target = { kind: 'sqlite'; path: string } | { kind: 'postgres-kysely'; url: string };
const runnerUrl = process.env.DATABASE_URL ?? '';
function pgUrlFor(name: string): string { const u = new URL(runnerUrl); u.pathname = `/${name}`; return u.toString(); }
async function adminQuery(sql: string): Promise<void> {
    const u = new URL(runnerUrl); u.pathname = '/postgres'; u.search = '';
    const c = new pg.Client({ connectionString: u.toString(), statement_timeout: 60_000 });
    await c.connect();
    try { await c.query(sql); } finally { await c.end(); }
}
async function freshTarget(label: string): Promise<Target> {
    if (BACKEND === 'sqlite') return { kind: 'sqlite', path: join(work, `${label}.db`) };
    const base = new URL(runnerUrl).pathname.slice(1) || 'aimeat';
    const name = `${base}_upg_${label}`;
    await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await adminQuery(`CREATE DATABASE "${name}"`);
    return { kind: 'postgres-kysely', url: pgUrlFor(name) };
}

// ── a node, from either tree ──

async function startNode(tree: string, db: Target, label: string): Promise<ChildProcess> {
    const dbArgs = db.kind === 'sqlite' ? ['--db', 'sqlite', '--db-path', db.path] : ['--db', 'postgres-kysely', '--db-url', db.url];
    const env: Record<string, string | undefined> = {
        ...process.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID, AIMEAT_NODE_TYPE: 'full',
        AIMEAT_STORAGE: db.kind, AIMEAT_SQLITE_PATH: db.kind === 'sqlite' ? db.path : '', DATABASE_URL: db.kind === 'postgres-kysely' ? db.url : '',
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_LOG_LEVEL: 'error',
        AIMEAT_ENCRYPTION_KEY: ENCRYPTION_KEY, AIMEAT_NODE_KEY_PATH: KEY_PATH,
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    // A release override in the caller's environment would make both boots report one version; the
    // version checks below refuse that rather than pass.
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', ...dbArgs], { cwd: tree, env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    return waitForServer(child, BASE, { label, budgetMs: Number(process.env.AIMEAT_E2E_BOOT_MS ?? 300_000) });
}
async function stopNode(child: ChildProcess): Promise<void> {
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

// ── the schema, as a set of names ──

async function schemaOf(db: Target): Promise<Set<string>> {
    const out = new Set<string>();
    if (db.kind === 'sqlite') {
        const d = new Database(db.path, { readonly: true });
        try {
            const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
            for (const { name } of tables) {
                out.add(`table ${name}`);
                for (const c of d.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]) out.add(`column ${name}.${c.name}`);
            }
            for (const i of d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]) out.add(`index ${i.name}`);
        } finally { d.close(); }
        return out;
    }
    const c = new pg.Client({ connectionString: db.url.split('?')[0], statement_timeout: 60_000 });
    await c.connect();
    try {
        for (const r of (await c.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'")).rows) {
            out.add(`table ${r.table_name}`);
            out.add(`column ${r.table_name}.${r.column_name} ${r.data_type}`);
        }
        for (const r of (await c.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows) out.add(`index ${r.indexname}`);
    } finally { await c.end(); }
    return out;
}

// ── the run ──

console.log(`\n=== AIMEAT upgrade from the published release (${BACKEND}) ===\n`);

let release = process.env.UPGRADE_FROM_TAG ?? '';
let oldTree = process.env.UPGRADE_OLD_DIR ?? '';
let node: ChildProcess | null = null;
let upgraded!: Target;
let ownerToken = '';
let agentGaii = '';
let orgId = '';
let oldVersion = '';

try {
    await test('The published release is unpacked and installed beside this tree', async () => {
        if (!release) release = sh('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', 'HEAD'], REPO);
        assert(/^v\d+\.\d+\.\d+$/.test(release), `not a release tag: ${release}`);
        if (!oldTree) {
            const root = join(work, 'release');
            mkdirSync(root, { recursive: true });
            const archive = join(work, 'release.tar');
            // The whole tree, not aimeat/ alone: the node reads files beside it (openapi.yaml, docs/).
            sh('git', ['archive', '--format=tar', `--output=${archive}`, release], REPO);
            // Relative paths: GNU tar on Windows reads "C:\…" as a remote host name.
            sh('tar', ['-xf', 'release.tar', '-C', 'release'], work);
            oldTree = join(root, 'aimeat');
            sh('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], oldTree);
        }
        assert(existsSync(join(oldTree, 'src', 'index.ts')), `no release tree at ${oldTree}`);
        console.log(`     release ${release} at ${oldTree}`);
    });

    await test(`The release starts on a new database and writes through its own API`, async () => {
        // Without the release tree there is nothing to upgrade from, and starting "it" would start this tree.
        assert(!!oldTree && existsSync(join(oldTree, 'src', 'index.ts')) && resolve(oldTree) !== resolve(CURRENT), 'no release tree to start');
        upgraded = await freshTarget('upgraded');
        node = await startNode(oldTree, upgraded, `release ${release}`);
        oldVersion = (await json('/v1/build')).body?.version ?? '';
        assert(`v${oldVersion}` === release, `the old node reports ${oldVersion}, not ${release}`);
        const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Upgrade', password: PASSWORD }) });
        assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
        const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
        assert(tok.status === 200, `sign-in ${tok.status}`);
        ownerToken = tok.body.data.token;
        const w = await json('/v1/memory', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ key: 'upgrade.probe', value: { written_by: release, n: 42 }, visibility: 'private', tags: ['upgrade'] }) });
        assert(w.status === 201, `record ${w.status}`);
        const f = await json('/v1/storage', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ key: 'upgrade/probe.bin', data: FILE_BYTES.toString('base64'), content_type: 'application/octet-stream', visibility: 'private' }) });
        assert(f.status === 200 || f.status === 201, `file ${f.status}: ${JSON.stringify(f.body?.error)}`);
        const a = await json('/v1/agents', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ name: 'upgradebot', owner: OWNER, capabilities: ['memory'] }) });
        assert(a.status === 201, `agent ${a.status}: ${JSON.stringify(a.body?.error)}`);
        agentGaii = a.body.data.agent.gaii;
        const o = await json('/v1/organisms', { method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ name: 'Upgrade Org', type: 'project', join_policy: 'invite', visibility: 'private' }) });
        assert(o.status === 201, `organism ${o.status}: ${JSON.stringify(o.body?.error)}`);
        orgId = o.body.data.organism.id;
    });

    await test('The current code starts on the database the release wrote', async () => {
        assert(!!oldVersion, 'the release never ran, so there is no database it wrote');
        if (node) { await stopNode(node); node = null; }
        node = await startNode(CURRENT, upgraded, 'the current code on the release database');
        const v = (await json('/v1/build')).body?.version;
        assert(v && v !== oldVersion, `the upgraded node reports ${v}, the same as the release ${oldVersion}: nothing was upgraded`);
    });

    await test('The owner signs in with the same password and is still the operator', async () => {
        const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
        assert(tok.status === 200, `sign-in ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
        ownerToken = tok.body.data.token;
        const roles = JSON.parse(Buffer.from(ownerToken.split('.')[1], 'base64url').toString()).roles ?? [];
        assert(roles.includes('operator'), `roles after the upgrade: ${JSON.stringify(roles)}`);
    });

    await test('The record, the file, the agent and the organism read back', async () => {
        const r = await json('/v1/memory/upgrade.probe', { headers: bearer(ownerToken) });
        assert(r.status === 200 && r.body.data?.value?.n === 42 && r.body.data?.value?.written_by === release, `record: ${r.status} ${JSON.stringify(r.body.data?.value)}`);
        const f = await fetch(`${BASE}/v1/storage/upgrade/probe.bin`, { headers: bearer(ownerToken) });
        assert(f.status === 200 && Buffer.from(await f.arrayBuffer()).equals(FILE_BYTES), `file: ${f.status}`);
        const a = await json('/v1/agents', { headers: bearer(ownerToken) });
        const agents = (a.body.data?.agents ?? a.body.data ?? []) as Array<{ gaii: string }>;
        assert(agents.some(x => x.gaii === agentGaii), `agent ${agentGaii} is not listed: ${JSON.stringify(agents.map(x => x.gaii))}`);
        const o = await json(`/v1/organisms/${orgId}`, { headers: bearer(ownerToken) });
        assert(o.status === 200, `organism: ${o.status}`);
    });

    await test('The upgraded schema holds every table, column and index a fresh database has', async () => {
        if (node) { await stopNode(node); node = null; }
        const fresh = await freshTarget('fresh');
        node = await startNode(CURRENT, fresh, 'the current code on a fresh database');
        await stopNode(node); node = null;
        const want = await schemaOf(fresh);
        const have = await schemaOf(upgraded);
        const missing = [...want].filter(x => !have.has(x)).sort();
        assert(missing.length === 0, `the upgraded database lacks ${missing.length}: ${missing.slice(0, 30).join('; ')}`);
    });
} finally {
    if (node) await stopNode(node);
    if (BACKEND === 'postgres-kysely' && runnerUrl) {
        const base = new URL(runnerUrl).pathname.slice(1) || 'aimeat';
        for (const l of ['upgraded', 'fresh']) await adminQuery(`DROP DATABASE IF EXISTS "${base}_upg_${l}" WITH (FORCE)`).catch(() => undefined);
    }
    if (!process.env.UPGRADE_KEEP) { try { rmSync(work, { recursive: true, force: true }); } catch { /* the run's own temporary folder */ } }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
