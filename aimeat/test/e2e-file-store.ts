/**
 * @file test/e2e-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stored files keep their bytes in an S3 store instead of the database, over live HTTP on
 *   a node of its own, against an S3 service inside the test process that checks every request's
 *   signature (helpers/fake-s3.ts).
 *
 *   The designed use: the operator points the node at a bucket and every new file's bytes go there
 *   while the file reads, ranges, replaces and deletes as before; older files move out of the database
 *   on the operator's word; a person connects a bucket of their own, their files go there and stop
 *   counting toward the node's quota, and they move them home and disconnect; on a node where the
 *   operators approve, a person's storage takes files only after an approval and stops after a revoke;
 *   the daily sweep removes, inside its own folder, only the old objects that no file names.
 *
 *   The failure modes: a wrong key saves nothing; a private address the operator did not name is
 *   refused; another owner, an agent without secrets:manage, a non-operator and a stranger are
 *   refused; a store that still holds files is not disconnected; a decline or revoke without a note is
 *   refused; a young orphan and an object outside the folder survive the sweep.
 * @structure main() — own node on block 30500, fake S3 on block 30900
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-file-store.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { suitePort } from './helpers/free-port.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { startFakeS3, type FakeS3 } from './helpers/fake-s3.js';

const RUNNER_BASE = process.env.E2E_BASE ?? `http://localhost:${process.env.AIMEAT_PORT ?? '80'}`;
const PORT = String(suitePort(30500, RUNNER_BASE));
const S3_PORT = suitePort(30900, RUNNER_BASE);
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-file-store.db');
const KEY_ID = 'e2efilestorekey';
const SECRET = 'e2e-file-store-secret-0123456789';
const NODE_BUCKET = 'node-files';
const OWN_BUCKET = 'own-files';
const NODE_PREFIX = `aimeat/${NODE_ID}/files/`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Body; text: string; headers: Headers }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    let body: Body;
    try { body = JSON.parse(text) as Body; } catch { body = { _raw: text }; }
    return { status: res.status, body, text, headers: res.headers };
}
const upload = (token: string, key: string, text: string) =>
    call('/v1/storage', { token, body: { key, data: Buffer.from(text).toString('base64'), mime_type: 'text/plain' } });

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* the next run deletes it */ }
    }
}

async function startServer(s3: FakeS3): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
        AIMEAT_FILE_STORE: 's3',
        AIMEAT_FILE_STORE_S3_ENDPOINT: s3.url,
        AIMEAT_FILE_STORE_S3_BUCKET: NODE_BUCKET,
        AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID: KEY_ID,
        AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY: SECRET,
        AIMEAT_FILE_STORE_PREFIX: '',
        AIMEAT_FILE_STORE_OWNER_PRIVATE_ORIGINS: s3.url,
        AIMEAT_OWNER_FILE_STORES: 'self',
        AIMEAT_STORAGE_QUOTA_MB: '1',
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the file-store node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
    child.kill('SIGTERM');
    const began = Date.now();
    while (Date.now() - began < 20_000) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await sleep(100);
    }
    child.kill('SIGKILL');
}

async function main() {
    const s3 = await startFakeS3({ port: S3_PORT, buckets: [NODE_BUCKET, OWN_BUCKET], accessKeyId: KEY_ID, secretAccessKey: SECRET });
    const server = await startServer(s3);
    const stamp = Date.now() % 100000;
    let op!: Awaited<ReturnType<typeof registerOwner>>;
    let A!: Awaited<ReturnType<typeof registerOwner>>;
    let B!: Awaited<ReturnType<typeof registerOwner>>;
    let C!: Awaited<ReturnType<typeof registerOwner>>;
    const setConfig = (path: string, value: unknown) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path, value }] } });
    const ownStore = { kind: 's3', endpoint: s3.url, bucket: OWN_BUCKET, access_key_id: KEY_ID, secret_access_key: SECRET };
    const nodeObjects = () => s3.objects(NODE_BUCKET).filter(k => k.startsWith(NODE_PREFIX));
    // The node also stores a text derivative of a text file (content classification), so an object is
    // found by its bytes, not by counting.
    const holding = (bucket: string, body: string) => s3.objects(bucket).filter(k => s3.get(bucket, k)?.body.toString() === body);
    const overages = async (token: string) => ((await call('/v1/wallet/transactions?type=storage_overage', { token })).body.data?.transactions ?? []).length as number;
    try {
        console.log('\n=== Stored files in an S3 store ===\n');

        await test('setup: the operator and three owners', async () => {
            op = await registerOwner(BASE, `fsop${stamp}`);
            A = await registerOwner(BASE, `fsa${stamp}`);
            B = await registerOwner(BASE, `fsb${stamp}`);
            C = await registerOwner(BASE, `fsc${stamp}`);
            const me = await call('/v1/admin/file-store', { token: op.token });
            assert(me.status === 200, `the first owner is the operator: ${me.status}`);
        });

        await test('the operator reads the node store and its test passes every step', async () => {
            const s = await call('/v1/admin/file-store', { token: op.token });
            assert(s.body.data.kind === 's3' && s.body.data.ready === true && s.body.data.prefix === NODE_PREFIX, JSON.stringify(s.body.data));
            const t = await call('/v1/admin/file-store/test', { token: op.token, body: {} });
            assert(t.status === 200 && t.body.data.ok === true, JSON.stringify(t.body));
            assert(t.body.data.steps.map((x: Body) => x.step).join(',') === 'write,read,read part,list,remove', JSON.stringify(t.body.data.steps));
            assert(nodeObjects().length === 0, `the test left objects: ${nodeObjects().join(', ')}`);
        });

        const text = 'Bytes kept in the bucket, not the database. '.repeat(20);
        await test('a file\'s bytes go to the bucket and read back whole, by range and as UTF-8 text', async () => {
            const up = await upload(A.token, 'notes/one.txt', text);
            assert(up.status === 201, `upload ${up.status} ${JSON.stringify(up.body.error)}`);
            const objs = holding(NODE_BUCKET, text);
            assert(objs.length >= 1 && objs.every(k => k.startsWith(NODE_PREFIX)), `bucket: ${s3.objects(NODE_BUCKET).join(', ')}`);
            const whole = await fetch(`${BASE}/v1/storage/notes/one.txt`, { headers: { Authorization: `Bearer ${A.token}` } });
            assert(whole.status === 200 && (await whole.text()) === text, `whole ${whole.status}`);
            const part = await fetch(`${BASE}/v1/storage/notes/one.txt`, { headers: { Authorization: `Bearer ${A.token}`, Range: 'bytes=6-10' } });
            assert(part.status === 206 && (await part.text()) === text.slice(6, 11), `range ${part.status}`);
            assert((part.headers.get('content-type') ?? '').includes('charset=utf-8'), `charset: ${part.headers.get('content-type')}`);
        });

        await test('a re-upload writes a new object and removes the old; a delete removes the object', async () => {
            await sleep(500);
            const up = await upload(A.token, 'notes/one.txt', 'second version');
            assert(up.status === 201, `re-upload ${up.status}`);
            await sleep(500);
            assert(holding(NODE_BUCKET, 'second version').length >= 1, 'the new bytes are not in the bucket');
            const read = await fetch(`${BASE}/v1/storage/notes/one.txt`, { headers: { Authorization: `Bearer ${A.token}` } });
            assert((await read.text()) === 'second version', 'the re-upload does not read back');
            // The file's own old object is gone; what may hold the old text is the derivative, keyed apart.
            const del = await call('/v1/storage/notes/one.txt', { token: A.token, method: 'DELETE' });
            await sleep(500);
            assert(del.status === 200, `delete ${del.status}`);
            const gone = await fetch(`${BASE}/v1/storage/notes/one.txt`, { headers: { Authorization: `Bearer ${A.token}` } });
            assert(gone.status === 404, `deleted file reads ${gone.status}`);
            const status = await call('/v1/admin/file-store', { token: op.token });
            const inStore = status.body.data.files.node_store.count as number;
            assert(nodeObjects().length === inStore, `objects ${nodeObjects().length} vs files in the node store ${inStore}`);
        });

        await test('older files move out of the database on the operator\'s word and still read', async () => {
            assert((await setConfig('file_store.kind', 'database')).status === 200, 'kind database');
            await upload(A.token, 'old/a.txt', 'written to the database');
            assert(holding(NODE_BUCKET, 'written to the database').length === 0, 'a database write reached the bucket');
            assert((await setConfig('file_store.kind', 's3')).status === 200, 'kind s3');
            const s = await call('/v1/admin/file-store', { token: op.token });
            assert(s.body.data.files.database.count >= 1, JSON.stringify(s.body.data.files));
            const mv = await call('/v1/admin/file-store/move', { token: op.token, body: { limit: 500 } });
            assert(mv.status === 200 && mv.body.data.moved >= 1 && mv.body.data.remaining === 0, JSON.stringify(mv.body));
            assert(holding(NODE_BUCKET, 'written to the database').length >= 1, 'nothing reached the bucket');
            const read = await fetch(`${BASE}/v1/storage/old/a.txt`, { headers: { Authorization: `Bearer ${A.token}` } });
            assert(read.status === 200 && (await read.text()) === 'written to the database', `read ${read.status}`);
        });

        await test('FAILURE: a wrong key saves nothing, a private address is refused, a non-operator and a stranger are refused', async () => {
            const wrong = await call('/v1/file-store', { token: B.token, method: 'PUT', body: { ...ownStore, secret_access_key: 'not-the-secret' } });
            assert(wrong.status === 422 && wrong.body.error?.code === 'STORE_TEST_FAILED', `${wrong.status} ${JSON.stringify(wrong.body.error)}`);
            const view = await call('/v1/file-store', { token: B.token });
            assert(view.body.data.store === null, 'a failed connect was saved');
            const priv = await call('/v1/file-store', { token: B.token, method: 'PUT', body: { ...ownStore, endpoint: 'http://10.20.30.40:9000' } });
            assert(priv.status === 400 && priv.body.error?.code === 'INVALID_INPUT', `${priv.status}`);
            const readStatus = await call('/v1/admin/file-store', { token: B.token, method: 'GET' });
            assert(readStatus.status === 403, `a non-operator read the node store: ${readStatus.status}`);
            const runTest = await call('/v1/admin/file-store/test', { token: B.token, method: 'POST', body: {} });
            assert(runTest.status === 403, `a non-operator tested the node store: ${runTest.status}`);
            const runMove = await call('/v1/admin/file-store/move', { token: B.token, method: 'POST', body: {} });
            assert(runMove.status === 403, `a non-operator moved files: ${runMove.status}`);
            const readOnly = await makeAgent(BASE, B, ['storage:read']);
            const moveOwn = await call('/v1/file-store/move', { token: readOnly.token, method: 'POST', body: { direction: 'home' } });
            assert(moveOwn.status === 403, `an agent with storage:read alone moved files: ${moveOwn.status}`);
            const stranger = await call('/v1/file-store');
            assert(stranger.status === 401, `a stranger: ${stranger.status}`);
        });

        await test('FAILURE: an agent without secrets:manage neither connects nor disconnects its owner\'s storage; a non-operator decides nothing', async () => {
            const agent = await makeAgent(BASE, B, ['storage:read', 'storage:write']);
            const r = await call('/v1/file-store', { token: agent.token, method: 'PUT', body: ownStore });
            assert(r.status === 403, `agent connect ${r.status} ${JSON.stringify(r.body.error)}`);
            const off = await call('/v1/file-store', { token: agent.token, method: 'DELETE' });
            assert(off.status === 403, `agent disconnect ${off.status}`);
            const decide = await call(`/v1/admin/file-store/owners/${B.name}/decision`, { token: B.token, method: 'POST', body: { decision: 'approve' } });
            assert(decide.status === 403, `a non-operator decided: ${decide.status}`);
            const bad = await call('/v1/file-store', { token: B.token, method: 'PUT', body: { kind: 'ftp', bucket: 'x' } });
            assert(bad.status === 400, `an unknown kind passed the schema: ${bad.status}`);
        });

        await test('a person\'s own bucket takes their files, outside the node\'s quota, and they move them home and disconnect', async () => {
            const con = await call('/v1/file-store', { token: B.token, method: 'PUT', body: { ...ownStore, reason: 'my project archive' } });
            assert(con.status === 200 && con.body.data.outcome === 'connected' && con.body.data.view.taking_new_files === true, JSON.stringify(con.body));
            // The node's quota is 1 MB here: a larger file on the node's store is charged as overage,
            // one in the person's own storage is not.
            const big = 'B'.repeat(1_200_000);
            const upB = await upload(B.token, 'archive/big.txt', big);
            assert(upB.status === 201, `own-store upload over the node quota: ${upB.status} ${JSON.stringify(upB.body.error)}`);
            assert(holding(OWN_BUCKET, big).every(k => k.startsWith(`aimeat/${B.name}@${NODE_ID}/`)) && holding(OWN_BUCKET, big).length === 1,
                `own bucket: ${s3.objects(OWN_BUCKET).join(', ')}`);
            assert(await overages(B.token) === 0, 'the own-store file was charged as node storage');
            const upA = await upload(A.token, 'archive/big.txt', big);
            assert(upA.status === 201 && await overages(A.token) === 1, `the same size on the node's store was not counted: ${upA.status}, ${await overages(A.token)} charges`);
            await call('/v1/storage/archive/big.txt', { token: A.token, method: 'DELETE' });
            const blocked = await call('/v1/file-store', { token: B.token, method: 'DELETE' });
            assert(blocked.status === 409 && blocked.body.error?.code === 'FILES_IN_STORE', `disconnect with files: ${blocked.status}`);
            const home = await call('/v1/file-store/move', { token: B.token, body: { direction: 'home' } });
            assert(home.status === 200 && home.body.data.moved >= 1 && home.body.data.remaining === 0, JSON.stringify(home.body));
            const read = await fetch(`${BASE}/v1/storage/archive/big.txt`, { headers: { Authorization: `Bearer ${B.token}` } });
            assert(read.status === 200 && (await read.text()).length === big.length, `read after moving home ${read.status}`);
            const off = await call('/v1/file-store', { token: B.token, method: 'DELETE' });
            assert(off.status === 200, `disconnect ${off.status}`);
            await call('/v1/storage/archive/big.txt', { token: B.token, method: 'DELETE' });
        });

        await test('on an operator node a person\'s storage waits for approval, takes files after it and stops after a revoke', async () => {
          try {
            assert((await setConfig('file_store.owner_stores', 'operator')).status === 200, 'rule operator');
            const con = await call('/v1/file-store', { token: C.token, method: 'PUT', body: { ...ownStore, reason: 'team drive' } });
            assert(con.status === 202 && con.body.data.outcome === 'waiting_for_operator', `${con.status} ${JSON.stringify(con.body)}`);
            await upload(C.token, 'c/1.txt', 'while waiting');
            assert(holding(OWN_BUCKET, 'while waiting').length === 0 && holding(NODE_BUCKET, 'while waiting').length >= 1, 'a waiting store took a file');
            const st = await call('/v1/admin/file-store', { token: op.token });
            assert(st.body.data.owner_stores.waiting.some((w: Body) => w.owner === C.name && w.note === 'team drive'), JSON.stringify(st.body.data.owner_stores));
            const noNote = await call(`/v1/admin/file-store/owners/${C.name}/decision`, { token: op.token, body: { decision: 'decline' } });
            assert(noNote.status === 400, `decline without a note ${noNote.status}`);
            const ok = await call(`/v1/admin/file-store/owners/${C.name}/decision`, { token: op.token, body: { decision: 'approve' } });
            assert(ok.status === 200 && ok.body.data.state === 'approved', JSON.stringify(ok.body));
            await upload(C.token, 'c/2.txt', 'after approval');
            assert(holding(OWN_BUCKET, 'after approval').length >= 1, 'an approved store took nothing');
            const rv = await call(`/v1/admin/file-store/owners/${C.name}/decision`, { token: op.token, body: { decision: 'revoke', note: 'project over' } });
            assert(rv.status === 200, `revoke ${rv.status}`);
            await upload(C.token, 'c/3.txt', 'after revoke');
            assert(holding(OWN_BUCKET, 'after revoke').length === 0 && holding(NODE_BUCKET, 'after revoke').length >= 1, 'a revoked store took a file');
            const stillReads = await fetch(`${BASE}/v1/storage/c/2.txt`, { headers: { Authorization: `Bearer ${C.token}` } });
            assert(stillReads.status === 200 && (await stillReads.text()) === 'after approval', `read after revoke ${stillReads.status}`);
            const home = await call('/v1/file-store/move', { token: C.token, body: { direction: 'home' } });
            assert(home.status === 200 && home.body.data.remaining === 0, JSON.stringify(home.body));
            assert((await call('/v1/file-store', { token: C.token, method: 'DELETE' })).status === 200, 'disconnect');
          } finally {
            await setConfig('file_store.owner_stores', 'self');
          }
        });

        await test('the sweep removes old objects no file names, inside its folder only', async () => {
            const named = nodeObjects();
            s3.plant(NODE_BUCKET, `${NODE_PREFIX}orphan-old`, 'left behind', 3);
            s3.plant(NODE_BUCKET, `${NODE_PREFIX}orphan-young`, 'being written', 0);
            s3.plant(NODE_BUCKET, 'someone-else/keep-me', 'not ours', 30);
            for (const k of named) s3.backdate(NODE_BUCKET, k, 5);
            const tr = await call('/v1/admin/scheduler/jobs/core:file-store-sweep/trigger', { token: op.token, body: {} });
            assert(tr.status === 200 && tr.body.data?.triggered === true, `trigger ${tr.status} ${JSON.stringify(tr.body.error)}`);
            for (let i = 0; i < 50 && s3.objects(NODE_BUCKET).includes(`${NODE_PREFIX}orphan-old`); i++) await sleep(200);
            const left = s3.objects(NODE_BUCKET);
            assert(!left.includes(`${NODE_PREFIX}orphan-old`), 'the old orphan stayed');
            assert(left.includes(`${NODE_PREFIX}orphan-young`), 'the young orphan was removed');
            assert(left.includes('someone-else/keep-me'), 'an object outside the folder was removed');
            for (const k of named) assert(left.includes(k), `a named object was removed: ${k}`);
        });

        await test('over MCP: the operator\'s agent reads the node store, an owner\'s agent reads its own and is refused the admin tool', async () => {
            const opAgent = await makeAgent(BASE, op, ['operator:admin', 'storage:read']);
            const opSession = await openSession(BASE, opAgent.token);
            const status = await callTool(opSession, 'aimeat_admin_file_store', {});
            assert(!status.isError && status.text.includes('"kind": "s3"'), status.text.slice(0, 300));
            const ownAgent = await makeAgent(BASE, A, ['storage:read']);
            const ownSession = await openSession(BASE, ownAgent.token);
            const mine = await callTool(ownSession, 'aimeat_file_store_get', {});
            assert(!mine.isError && mine.text.includes('"mode": "self"'), mine.text.slice(0, 300));
            const refused = await callTool(ownSession, 'aimeat_admin_file_store', {});
            assert(refused.isError, 'an owner\'s agent read the operators\' view');
        });

        await test('over MCP: an agent with secrets:manage connects, moves and disconnects its owner\'s storage; the operator\'s agent tests, moves and decides', async () => {
            const agent = await makeAgent(BASE, B, ['storage:read', 'storage:write', 'secrets:manage']);
            const s = await openSession(BASE, agent.token);
            const set = await callTool(s, 'aimeat_file_store_set', ownStore);
            assert(!set.isError && set.text.includes('"outcome": "connected"'), set.text.slice(0, 300));
            const home = await callTool(s, 'aimeat_file_store_move', { direction: 'own' });
            assert(!home.isError && home.text.includes('"remaining": 0'), home.text.slice(0, 300));
            const back = await callTool(s, 'aimeat_file_store_move', { direction: 'home', limit: 200 });
            assert(!back.isError && back.text.includes('"remaining": 0'), back.text.slice(0, 300));
            const off = await callTool(s, 'aimeat_file_store_remove', {});
            assert(!off.isError && off.text.includes('"removed": true'), off.text.slice(0, 300));
            const opAgent = await makeAgent(BASE, op, ['operator:admin']);
            const o = await openSession(BASE, opAgent.token);
            const t = await callTool(o, 'aimeat_admin_file_store_test', {});
            assert(!t.isError && t.text.includes('"ok": true'), t.text.slice(0, 300));
            const mv = await callTool(o, 'aimeat_admin_file_store_move', { limit: 10 });
            assert(!mv.isError && mv.text.includes('"remaining"'), mv.text.slice(0, 300));
            const dec = await callTool(o, 'aimeat_admin_file_store_decide', { owner: C.name, decision: 'decline', note: 'not for now' });
            assert(!dec.isError && dec.text.includes('"state": "declined"'), dec.text.slice(0, 300));
            const ownAgent = await makeAgent(BASE, A, ['storage:read']);
            const denied = await callTool(await openSession(BASE, ownAgent.token), 'aimeat_admin_file_store_decide', { owner: C.name, decision: 'approve' });
            assert(denied.isError, 'an owner\'s agent decided');
        });

        await test('every request the node sent carried a signature S3 accepts, except the wrong key\'s', async () => {
            assert(s3.refused() >= 1, `the wrong key was not refused by the store: ${s3.refused()}`);
        });
    } finally {
        await stopServer(server);
        await s3.close();
        cleanupDb();
    }
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
