/**
 * @file test/e2e-backup-restore.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node backup of docs/operations/backup-and-restore.md, taken and restored end to end
 *   on the runner's backend (QA audit P6-06).
 *
 *   WHY IT OWNS ITS NODE. A restore destroys the database it restores into, so the suite starts a node
 *   of its own: a temporary SQLite file, or a PostgreSQL database of its own beside the runner's. The
 *   node has its own key file (AIMEAT_NODE_KEY_PATH) and a fixed AIMEAT_ENCRYPTION_KEY, which are the
 *   other two parts of a node the guide says to keep with the database.
 *
 *   WHAT IT PROVES, on each backend:
 *     1. Data of three kinds is written: a memory record, a stored file (whose bytes live in the
 *        database) and a sealed secret (a seller's Stripe key, encrypted with the node's key).
 *     2. The documented backup is taken while the node runs: SQLite's online backup (the guide's
 *        `.backup`, through better-sqlite3's backup API), or `pg_dump --format=custom`.
 *     3. A record written after the backup, and a delete of the first record, happen on the old node.
 *     4. The database is destroyed and the key file removed; the backup and the key file are put back
 *        (SQLite: the file; PostgreSQL: `pg_restore --no-owner` into a new database).
 *     5. The node starts on it with the same key file and the same secrets: health is healthy, the
 *        owner signs in, a session token issued BEFORE the backup still works (the node's identity is
 *        the same), the first record reads as written, the later record is absent, the file's bytes
 *        are equal, and the sealed secret opens to the original with the node's key.
 *   SQLite also runs the stopped-node form (copy the .db, -wal and -shm files) once.
 *
 *   PostgreSQL needs pg_dump and pg_restore: on PATH, or in the folder PG_BIN names. Without them the
 *   PostgreSQL half is reported as SKIPPED (a line the runner counts as skipped, never as passed).
 *   CI's runner image carries the PostgreSQL 16 client, which matches the postgres:16 service.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-backup-restore
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-backup-restore
 * @version-history
 *   2026-10-16 — Initial (QA audit P6-06).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { suitePort } from './helpers/free-port.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { openPspSecret } from '../src/commerce/psp-secrets.js';

const RUNNER_BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const PORT = String(suitePort(31400, RUNNER_BASE));
const BASE = `http://localhost:${PORT}`;
// A node id of its own. Under the runner's id the node would adopt the machine's pre-2026-09-03 shared
// key file (~/.aimeat/node-key.json) when that file names the same id, and write no key file at
// AIMEAT_NODE_KEY_PATH, so the key file this suite backs up would not exist (auth/node-keys.ts).
const NODE_ID = 'aimeat-bkp-001-test';
const ENCRYPTION_KEY = randomBytes(32).toString('hex');
const OWNER = `bkp${Date.now() % 100000}`;
const PASSWORD = 'Backup123456';
const STRIPE_KEY = `sk_test_backup_${randomBytes(6).toString('hex')}`;
const FILE_BYTES = randomBytes(4096);

let passed = 0, failed = 0, skipped = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function skip(name: string, why: string) { skipped++; console.log(`  ⏭ SKIPPED: ${name} — ${why}`); }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const dir = mkdtempSync(join(tmpdir(), 'aimeat-backup-'));
const KEY_PATH = join(dir, 'node-key.json');
const BACKEND = process.env.AIMEAT_DB === 'postgres-kysely' ? 'postgres-kysely' : 'sqlite';

// ── the node ──

interface Db { kind: 'sqlite'; path: string }
interface PgDb { kind: 'postgres-kysely'; url: string }
type Target = Db | PgDb;

async function startNode(db: Target): Promise<ChildProcess> {
    const target = db.kind === 'sqlite'
        ? { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: db.path, dbUrl: '', external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: db.url, external: false };
    const env: Record<string, string | undefined> = {
        ...process.env, ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true',
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_ENCRYPTION_KEY: ENCRYPTION_KEY,
        AIMEAT_NODE_KEY_PATH: KEY_PATH,
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const dbArgs = db.kind === 'sqlite' ? ['--db', 'sqlite', '--db-path', db.path] : ['--db', 'postgres-kysely', '--db-url', db.url];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: `the backup node (${db.kind})` });
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

// ── what the node holds before the backup ──

interface Before { token: string; ghii: string }

async function writeBefore(): Promise<Before> {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: OWNER, display_name: 'Backup', password: PASSWORD }) });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
    assert(tok.status === 200, `sign-in ${tok.status}`);
    const token = tok.body.data.token as string;
    const w = await json('/v1/memory', { method: 'POST', headers: bearer(token), body: JSON.stringify({ key: 'ops.restore-probe', value: { note: 'written before the backup' }, visibility: 'private' }) });
    assert(w.status === 201, `record ${w.status}`);
    const f = await json('/v1/storage', { method: 'POST', headers: bearer(token), body: JSON.stringify({ key: 'ops/restore-probe.bin', data: FILE_BYTES.toString('base64'), content_type: 'application/octet-stream', visibility: 'private' }) });
    assert(f.status === 200 || f.status === 201, `file ${f.status}: ${JSON.stringify(f.body?.error)}`);
    const s = await json('/v1/commerce/payout/stripe', { method: 'PUT', headers: bearer(token), body: JSON.stringify({ secret_key: STRIPE_KEY }) });
    assert(s.status === 200, `sealed secret ${s.status}: ${JSON.stringify(s.body?.error)}`);
    return { token, ghii: `${OWNER}@${NODE_ID}` };
}

async function changeAfter(token: string): Promise<void> {
    const w = await json('/v1/memory', { method: 'POST', headers: bearer(token), body: JSON.stringify({ key: 'ops.after-backup', value: { note: 'written after the backup' }, visibility: 'private' }) });
    assert(w.status === 201, `later record ${w.status}`);
    const d = await json('/v1/memory/ops.restore-probe', { method: 'DELETE', headers: bearer(token) });
    assert(d.status === 200, `delete ${d.status}`);
    const gone = await json('/v1/memory/ops.restore-probe', { headers: bearer(token) });
    assert(gone.status === 404, `deleted record still reads: ${gone.status}`);
}

async function proveRestored(before: Before, db: Target): Promise<void> {
    const health = await json('/v1/health');
    const h = health.body?.data ?? health.body;
    assert(health.status === 200 && h?.status !== 'unhealthy' && h?.subsystems?.storage?.healthy !== false,
        `health: ${health.status} ${JSON.stringify({ status: h?.status, storage: h?.subsystems?.storage })}`);
    // Issued before the backup and signed with the node's key: it works only if the identity came back.
    const me = await json('/v1/ghii/me', { headers: bearer(before.token) });
    assert(me.status === 200, `a session issued before the backup: ${me.status} ${JSON.stringify(me.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
    assert(tok.status === 200, `sign-in after restore: ${tok.status}`);
    const token = tok.body.data.token as string;
    const rec = await json('/v1/memory/ops.restore-probe', { headers: bearer(token) });
    assert(rec.status === 200 && rec.body.data?.value?.note === 'written before the backup', `the record: ${rec.status} ${JSON.stringify(rec.body.data?.value)}`);
    const later = await json('/v1/memory/ops.after-backup', { headers: bearer(token) });
    assert(later.status === 404, `a record written after the backup came back: ${later.status}`);
    const file = await fetch(`${BASE}/v1/storage/ops/restore-probe.bin`, { headers: bearer(token) });
    assert(file.status === 200, `the file: ${file.status}`);
    assert(Buffer.from(await file.arrayBuffer()).equals(FILE_BYTES), 'the file bytes differ');
    const pay = await json('/v1/commerce/payout', { headers: bearer(token) });
    assert(pay.body.data?.stripe?.configured === true, `the payout setting: ${JSON.stringify(pay.body.data?.stripe)}`);
    // The sealed secret opens with the node's key to exactly what was stored.
    const storage = db.kind === 'sqlite'
        ? await createStorage({ provider: 'sqlite', sqlitePath: db.path })
        : await createStorage({ provider: 'postgres-kysely', dbUrl: db.url });
    try {
        const psp = await storage.getMemory(before.ghii, 'commerce.psp');
        const opened = openPspSecret({ encryptionKey: ENCRYPTION_KEY, totpSecretEncryptionKey: null }, (psp?.value as { secretKey?: unknown } | undefined)?.secretKey);
        assert(opened === STRIPE_KEY, 'the sealed Stripe key does not open to what was stored');
    } finally { await (storage as unknown as { close?: () => unknown }).close?.(); }
    // The roles came back with the accounts: an account made after the restore is not the operator.
    const late = `late${Date.now() % 100000}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: late, display_name: 'Late', password: PASSWORD }) });
    assert(reg.status === 201, `a new account after the restore: ${reg.status}`);
    const lt = (await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: late, password: PASSWORD }) })).body.data.token as string;
    const dash = await json('/v1/admin/dashboard', { headers: bearer(lt) });
    assert(dash.status === 403, `a new account after the restore reached the operator's dashboard: ${dash.status}`);
}

console.log(`\n=== AIMEAT Node Backup and Restore E2E (${BACKEND}) ===\n`);

// ── SQLite ──

async function sqliteRun(): Promise<void> {
    const live = join(dir, 'node.db');
    const online = join(dir, 'online-backup.db');
    const keyCopy = join(dir, 'node-key.backup.json');
    let node: ChildProcess | null = null;
    let before!: Before;
    try {
        await test('SQLite: the node starts and holds a record, a file and a sealed secret', async () => {
            node = await startNode({ kind: 'sqlite', path: live });
            before = await writeBefore();
        });
        await test('SQLite: the online backup is taken while the node runs, with the key file', async () => {
            const src = new Database(live, { readonly: true, fileMustExist: true });
            try { await src.backup(online); } finally { src.close(); }
            copyFileSync(KEY_PATH, keyCopy);
            assert(existsSync(online), 'no backup file');
        });
        await test('SQLite: after the backup, one record is written and the first one deleted', async () => {
            await changeAfter(before.token);
        });
        await test('SQLite: the database and the key file are destroyed, the backup and the key put back, and the node starts on them', async () => {
            await stopNode(node!); node = null;
            for (const s of ['', '-wal', '-shm']) if (existsSync(live + s)) rmSync(live + s);
            rmSync(KEY_PATH);
            copyFileSync(online, live);
            copyFileSync(keyCopy, KEY_PATH);
            node = await startNode({ kind: 'sqlite', path: live });
        });
        await test('SQLite: the restored node is the same node with the data of the moment of the backup', async () => {
            await proveRestored(before, { kind: 'sqlite', path: live });
        });
        // The stopped-node form the guide also gives: the three files copied while the node is down.
        await test('SQLite: the stopped-node copy of the .db, -wal and -shm files restores too', async () => {
            const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
            const t = tok.body.data.token as string;
            const w = await json('/v1/memory', { method: 'POST', headers: bearer(t), body: JSON.stringify({ key: 'ops.second-probe', value: { n: 2 }, visibility: 'private' }) });
            assert(w.status === 201, `second record ${w.status}`);
            await stopNode(node!); node = null;
            const copies: string[] = [];
            for (const s of ['', '-wal', '-shm']) if (existsSync(live + s)) { copyFileSync(live + s, join(dir, `stopped${s}`)); copies.push(s); }
            for (const s of ['', '-wal', '-shm']) if (existsSync(live + s)) rmSync(live + s);
            for (const s of copies) copyFileSync(join(dir, `stopped${s}`), live + s);
            node = await startNode({ kind: 'sqlite', path: live });
            const t2 = (await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: OWNER, password: PASSWORD }) })).body.data.token as string;
            const r = await json('/v1/memory/ops.second-probe', { headers: bearer(t2) });
            assert(r.status === 200 && r.body.data?.value?.n === 2, `the second record: ${r.status}`);
        });
    } finally {
        if (node) await stopNode(node);
    }
}

// ── PostgreSQL ──

function pgTool(name: string): string | null {
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    const dirs = [process.env.PG_BIN, ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean) as string[];
    for (const d of dirs) if (existsSync(join(d, exe))) return join(d, exe);
    return null;
}

/** A libpq URL: the node's DATABASE_URL carries `?schema=public`, which pg_dump refuses. */
function libpqUrl(url: string): string { return url.split('?')[0]; }

async function adminQuery(baseUrl: string, sql: string): Promise<void> {
    const u = new URL(baseUrl); u.pathname = '/postgres'; u.search = '';
    const client = new pg.Client({ connectionString: u.toString(), statement_timeout: 60_000 });
    await client.connect();
    try { await client.query(sql); } finally { await client.end(); }
}

async function pgRun(): Promise<void> {
    const runnerUrl = process.env.DATABASE_URL ?? '';
    const pgDump = pgTool('pg_dump');
    const pgRestore = pgTool('pg_restore');
    if (!runnerUrl || !pgDump || !pgRestore) {
        skip('PostgreSQL: pg_dump and pg_restore round trip', !runnerUrl ? 'DATABASE_URL is not set' : 'pg_dump and pg_restore are not on PATH (set PG_BIN to their folder)');
        return;
    }
    const baseName = new URL(runnerUrl).pathname.slice(1) || 'aimeat';
    const srcName = `${baseName}_bkp_src`;
    const dstName = `${baseName}_bkp_restored`;
    const urlFor = (name: string) => { const u = new URL(runnerUrl); u.pathname = `/${name}`; return u.toString(); };
    const dump = join(dir, 'node.dump');
    let node: ChildProcess | null = null;
    let before!: Before;
    try {
        await test('PostgreSQL: the node starts on a database of its own and holds a record, a file and a sealed secret', async () => {
            await adminQuery(runnerUrl, `DROP DATABASE IF EXISTS "${srcName}" WITH (FORCE)`);
            await adminQuery(runnerUrl, `DROP DATABASE IF EXISTS "${dstName}" WITH (FORCE)`);
            await adminQuery(runnerUrl, `CREATE DATABASE "${srcName}"`);
            node = await startNode({ kind: 'postgres-kysely', url: urlFor(srcName) });
            before = await writeBefore();
        });
        await test('PostgreSQL: pg_dump --format=custom takes the backup while the node runs', async () => {
            const r = spawnSync(pgDump, ['--format=custom', `--file=${dump}`, libpqUrl(urlFor(srcName))], { encoding: 'utf8' });
            assert(r.status === 0, `pg_dump exited ${r.status}: ${r.stderr}`);
            writeFileSync(join(dir, 'node-key.backup.json'), readFileSync(KEY_PATH));
        });
        await test('PostgreSQL: after the backup, one record is written and the first one deleted', async () => {
            await changeAfter(before.token);
        });
        await test('PostgreSQL: the database is dropped, pg_restore fills a new one, and the node starts on it', async () => {
            await stopNode(node!); node = null;
            await adminQuery(runnerUrl, `DROP DATABASE "${srcName}" WITH (FORCE)`);
            rmSync(KEY_PATH);
            writeFileSync(KEY_PATH, readFileSync(join(dir, 'node-key.backup.json')));
            await adminQuery(runnerUrl, `CREATE DATABASE "${dstName}"`);
            const r = spawnSync(pgRestore, ['--no-owner', `--dbname=${libpqUrl(urlFor(dstName))}`, dump], { encoding: 'utf8' });
            assert(r.status === 0, `pg_restore exited ${r.status}: ${r.stderr}`);
            node = await startNode({ kind: 'postgres-kysely', url: urlFor(dstName) });
        });
        await test('PostgreSQL: the restored node is the same node with the data of the moment of the backup', async () => {
            await proveRestored(before, { kind: 'postgres-kysely', url: urlFor(dstName) });
        });
    } finally {
        if (node) await stopNode(node);
        await adminQuery(runnerUrl, `DROP DATABASE IF EXISTS "${srcName}" WITH (FORCE)`).catch(() => undefined);
        await adminQuery(runnerUrl, `DROP DATABASE IF EXISTS "${dstName}" WITH (FORCE)`).catch(() => undefined);
    }
}

try {
    if (BACKEND === 'sqlite') await sqliteRun(); else await pgRun();
} finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* the suite's own temporary folder */ }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
process.exit(failed > 0 ? 1 : 0);
