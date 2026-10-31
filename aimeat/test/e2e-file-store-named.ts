/**
 * @file test/e2e-file-store-named.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Several file stores, one default each, and a writer who names the store a file goes to,
 *   over live HTTP on a node of its own, against an S3 service inside the test process that checks
 *   every request's signature (helpers/fake-s3.ts). The one-store behaviour is e2e-file-store.ts.
 *
 *   The designed use: an operator adds a named node store (tested before it is kept, the key never
 *   returned), opens it to everyone and makes it the default; a person names a store for a file on
 *   every upload road (inline, presigned, chunked, MCP) and the file list says where each file is; a
 *   person keeps two stores of their own, picks the default and chooses either; files move between
 *   stores and a store is removed once empty; the operator moves the environment's files into a named
 *   store; the sweep of one store keeps the objects a sibling store of the same bucket names.
 *
 *   The failure modes: a non-operator cannot add a node store or name one not open to everyone; a
 *   reserved name, a wrong key, an unknown store and a malformed choice are refused and save nothing;
 *   another person's store cannot be named; a store holding files is not removed.
 * @structure main() — own node on block 30600, fake S3 on block 30900 (e2e-file-store.ts uses it too;
 *   suites of one lane run one after another)
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-file-store-named.ts
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
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
const PORT = String(suitePort(30600, RUNNER_BASE));
const S3_PORT = suitePort(30900, RUNNER_BASE);
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-file-store-named.db');
const KEY_ID = 'e2enamedstorekey';
const SECRET = 'e2e-named-store-secret-0123456789';
const NODE_BUCKET = 'node-files';
const ARCHIVE_BUCKET = 'archive-files';
const OWN_BUCKET = 'own-files';
const NODE_PREFIX = `aimeat/${NODE_ID}/files/`;
const ARCHIVE_PREFIX = `aimeat/${NODE_ID}/stores/archive/`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Body; text: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    let body: Body;
    try { body = JSON.parse(text) as Body; } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
}
const upload = (token: string, key: string, text: string, store?: string) =>
    call('/v1/storage', { token, body: { key, data: Buffer.from(text).toString('base64'), mime_type: 'text/plain', ...(store ? { store } : {}) } });
const readText = async (token: string, key: string) => {
    const r = await fetch(`${BASE}/v1/storage/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, text: await r.text() };
};

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
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the named file-store node' });
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
    const s3 = await startFakeS3({ port: S3_PORT, buckets: [NODE_BUCKET, ARCHIVE_BUCKET, OWN_BUCKET], accessKeyId: KEY_ID, secretAccessKey: SECRET });
    const server = await startServer(s3);
    const stamp = Date.now() % 100000;
    let op!: Awaited<ReturnType<typeof registerOwner>>;
    let A!: Awaited<ReturnType<typeof registerOwner>>;
    let B!: Awaited<ReturnType<typeof registerOwner>>;
    const archive = { kind: 's3', endpoint: s3.url, bucket: ARCHIVE_BUCKET, access_key_id: KEY_ID, secret_access_key: SECRET };
    const own = { kind: 's3', endpoint: s3.url, bucket: OWN_BUCKET, access_key_id: KEY_ID, secret_access_key: SECRET };
    const setNodeStore = (name: string, body: Body, token = op.token) => call(`/v1/admin/file-store/stores/${name}`, { token, method: 'PUT', body });
    // The node also stores a text derivative of a text file (content classification), so an object is
    // found by its bytes, not by counting.
    const holding = (bucket: string, body: string) => s3.objects(bucket).filter(k => s3.get(bucket, k)?.body.toString() === body);
    try {
        console.log('\n=== Several file stores, and the writer chooses ===\n');

        await test('setup: the operator and two owners', async () => {
            op = await registerOwner(BASE, `nsop${stamp}`);
            A = await registerOwner(BASE, `nsa${stamp}`);
            B = await registerOwner(BASE, `nsb${stamp}`);
            assert((await call('/v1/admin/file-store', { token: op.token })).status === 200, 'the first owner is the operator');
        });

        await test('the operator adds a named node store: tested first, its key never returned', async () => {
            const add = await setNodeStore('archive', archive);
            assert(add.status === 201 && add.body.data.outcome === 'added' && add.body.data.test.ok === true, `${add.status} ${JSON.stringify(add.body)}`);
            assert(add.body.data.store.store === 'node:archive' && add.body.data.store.selectable === false && add.body.data.store.prefix === ARCHIVE_PREFIX, JSON.stringify(add.body.data.store));
            const st = await call('/v1/admin/file-store', { token: op.token });
            assert(st.body.data.stores.length === 1 && st.body.data.default_store === null && st.body.data.new_files_go_to === 'node:s3', JSON.stringify(st.body.data));
            assert(!st.text.includes(SECRET) && !add.text.includes(SECRET), 'the key came back');
            const t = await call('/v1/admin/file-store/test', { token: op.token, body: { name: 'archive' } });
            assert(t.status === 200 && t.body.data.ok === true, JSON.stringify(t.body));
        });

        await test('FAILURE: a non-operator adds nothing; a reserved name, a wrong key and an unknown store save nothing', async () => {
            const notOperator = await call('/v1/admin/file-store/stores/mine', { token: A.token, method: 'PUT', body: archive });
            assert(notOperator.status === 403, `a non-operator added a node store: ${notOperator.status}`);
            assert((await call('/v1/admin/file-store/stores/archive', { token: A.token, method: 'DELETE' })).status === 403, 'a non-operator removed a node store');
            const reserved = await setNodeStore('s3', archive);
            assert(reserved.status === 400 && reserved.body.error?.code === 'INVALID_INPUT', `reserved name ${reserved.status}`);
            const wrong = await setNodeStore('broken', { ...archive, secret_access_key: 'not-the-secret' });
            assert(wrong.status === 422 && wrong.body.error?.code === 'STORE_TEST_FAILED', `${wrong.status} ${JSON.stringify(wrong.body.error)}`);
            const optionsOnly = await setNodeStore('nothere', { selectable: true });
            assert(optionsOnly.status === 400, `options of an unknown store ${optionsOnly.status}`);
            const st = await call('/v1/admin/file-store', { token: op.token });
            assert(st.body.data.stores.map((s: Body) => s.name).join(',') === 'archive', JSON.stringify(st.body.data.stores));
        });

        await test('FAILURE: a person cannot name a node store not open to everyone, an unknown store or a malformed choice; the operator can', async () => {
            const closed = await upload(A.token, 'a/closed.txt', 'not for archive', 'node:archive');
            assert(closed.status === 403 && closed.body.error?.code === 'STORE_NOT_SELECTABLE', `${closed.status} ${JSON.stringify(closed.body.error)}`);
            assert(holding(ARCHIVE_BUCKET, 'not for archive').length === 0 && (await readText(A.token, 'a/closed.txt')).status === 404, 'a refused file was stored');
            const unknown = await upload(A.token, 'a/x.txt', 'x', 'node:nowhere');
            assert(unknown.status === 404 && unknown.body.error?.code === 'UNKNOWN_STORE', `${unknown.status}`);
            const malformed = await upload(A.token, 'a/y.txt', 'y', 'archive');
            assert(malformed.status === 400 && malformed.body.error?.code === 'INVALID_INPUT', `${malformed.status}`);
            const env = await upload(A.token, 'a/z.txt', 'z', 'node:s3');
            assert(env.status === 403, `a person named the environment's store: ${env.status}`);
            const byOp = await upload(op.token, 'op/one.txt', 'the operator chose archive', 'node:archive');
            assert(byOp.status === 201 && byOp.body.data.store === 'node:archive', `${byOp.status} ${JSON.stringify(byOp.body)}`);
            assert(holding(ARCHIVE_BUCKET, 'the operator chose archive').every(k => k.startsWith(ARCHIVE_PREFIX)) && holding(ARCHIVE_BUCKET, 'the operator chose archive').length === 1, s3.objects(ARCHIVE_BUCKET).join(', '));
        });

        await test('a store open to everyone is named on every upload road, and the file list says where each file is', async () => {
            const open = await setNodeStore('archive', { selectable: true });
            assert(open.status === 200 && open.body.data.outcome === 'updated' && open.body.data.store.selectable === true, JSON.stringify(open.body));
            const inline = await upload(A.token, 'a/inline.txt', 'inline to archive', 'node:archive');
            assert(inline.status === 201 && inline.body.data.store === 'node:archive', `${inline.status} ${JSON.stringify(inline.body.error)}`);
            assert(holding(ARCHIVE_BUCKET, 'inline to archive').length === 1, 'the inline file is not in the archive bucket');

            const mint = await call('/v1/storage', { token: A.token, body: { key: 'a/presigned.txt', mime_type: 'text/plain', mode: 'presigned', store: 'node:archive' } });
            assert(mint.status === 200 && mint.body.data.upload_url, `${mint.status} ${JSON.stringify(mint.body)}`);
            const put = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'presigned to archive' });
            const putBody = await put.json() as Body;
            assert(put.status === 200 && putBody.store === 'node:archive', `${put.status} ${JSON.stringify(putBody)}`);
            assert(holding(ARCHIVE_BUCKET, 'presigned to archive').length === 1, 'the presigned file is not in the archive bucket');

            const init = await call('/v1/storage/upload/init', { token: A.token, body: { key: 'a/chunked.txt', mime_type: 'text/plain', chunk_size: 1024, total_chunks: 1, store: 'node:archive' } });
            assert(init.status === 201, `init ${init.status} ${JSON.stringify(init.body)}`);
            const id = init.body.data.upload_id;
            const chunk = await fetch(`${BASE}/v1/storage/upload/${id}/0`, { method: 'PUT', headers: { Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/octet-stream' }, body: 'chunked to archive' });
            assert(chunk.status === 200, `chunk ${chunk.status}`);
            const done = await call(`/v1/storage/upload/${id}/complete`, { token: A.token, body: {} });
            assert(done.status === 201 || done.status === 200, `complete ${done.status} ${JSON.stringify(done.body)}`);
            assert(holding(ARCHIVE_BUCKET, 'chunked to archive').length === 1, 'the chunked file is not in the archive bucket');
            const badInit = await call('/v1/storage/upload/init', { token: B.token, body: { key: 'b/c.txt', mime_type: 'text/plain', chunk_size: 1024, total_chunks: 1, store: 'own:none' } });
            assert(badInit.status === 404 && badInit.body.error?.code === 'UNKNOWN_STORE', `chunked init with an unknown store ${badInit.status}`);

            const plain = await upload(A.token, 'a/plain.txt', 'no store named');
            assert(plain.status === 201 && plain.body.data.store === 'node:s3', `${plain.status} ${JSON.stringify(plain.body.data)}`);
            const list = await call('/v1/storage', { token: A.token });
            const where = Object.fromEntries((list.body.data.files as Body[]).map(f => [f.key, f.store]));
            assert(where['a/inline.txt'] === 'node:archive' && where['a/presigned.txt'] === 'node:archive' && where['a/chunked.txt'] === 'node:archive' && where['a/plain.txt'] === 'node:s3', JSON.stringify(where));
        });

        await test('the operator makes a named store the default, and stops it being one', async () => {
            const def = await setNodeStore('archive', { make_default: true });
            assert(def.status === 200 && def.body.data.store.default === true, JSON.stringify(def.body));
            const up = await upload(B.token, 'b/default.txt', 'to the default');
            assert(up.status === 201 && up.body.data.store === 'node:archive', `${up.status} ${JSON.stringify(up.body.data)}`);
            const st = await call('/v1/admin/file-store', { token: op.token });
            assert(st.body.data.default_store === 'node:archive' && st.body.data.new_files_go_to === 'node:archive', JSON.stringify(st.body.data));
            const undo = await setNodeStore('archive', { make_default: false });
            assert(undo.status === 200 && undo.body.data.store.default === false, JSON.stringify(undo.body));
            const after = await upload(B.token, 'b/after.txt', 'back to the environment');
            assert(after.body.data.store === 'node:s3', JSON.stringify(after.body.data));
        });

        await test('a person keeps two stores of their own, picks the default and chooses either', async () => {
            const photos = await call('/v1/file-store', { token: A.token, method: 'PUT', body: { ...own, name: 'photos' } });
            assert(photos.status === 200 && photos.body.data.view.default_store === 'own:photos', JSON.stringify(photos.body));
            const docs = await call('/v1/file-store', { token: A.token, method: 'PUT', body: { ...own, name: 'docs' } });
            assert(docs.status === 200 && docs.body.data.view.default_store === 'own:photos' && docs.body.data.view.stores.length === 2, JSON.stringify(docs.body.data.view));
            const pick = await call('/v1/file-store', { token: A.token, method: 'PUT', body: { name: 'docs', make_default: true } });
            assert(pick.status === 200 && pick.body.data.outcome === 'updated' && pick.body.data.view.default_store === 'own:docs', JSON.stringify(pick.body));
            const toDefault = await upload(A.token, 'a/doc.txt', 'into docs');
            assert(toDefault.body.data.store === 'own:docs', JSON.stringify(toDefault.body.data));
            assert(holding(OWN_BUCKET, 'into docs').every(k => k.startsWith(`aimeat/${A.name}@${NODE_ID}/docs/`)) && holding(OWN_BUCKET, 'into docs').length === 1, s3.objects(OWN_BUCKET).join(', '));
            const chosen = await upload(A.token, 'a/photo.txt', 'into photos', 'own:photos');
            assert(chosen.body.data.store === 'own:photos', JSON.stringify(chosen.body.data));
            assert(holding(OWN_BUCKET, 'into photos').every(k => k.startsWith(`aimeat/${A.name}@${NODE_ID}/photos/`)), s3.objects(OWN_BUCKET).join(', '));
            const view = await call('/v1/file-store', { token: A.token });
            const choices = (view.body.data.choices as Body[]).map(c => c.store).sort().join(',');
            assert(choices === 'node:archive,own:docs,own:photos', choices);
            assert(view.body.data.stores.find((s: Body) => s.name === 'photos').files.count === 1, JSON.stringify(view.body.data.stores));
            const several = await call('/v1/file-store', { token: A.token, method: 'PUT', body: own });
            assert(several.status === 400, `a nameless connect with several stores ${several.status}`);
            const other = await upload(B.token, 'b/x.txt', 'not B\'s store', 'own:photos');
            assert(other.status === 404 && other.body.error?.code === 'UNKNOWN_STORE', `another person's store was named: ${other.status}`);
        });

        await test('files move between stores, and a store is removed only once empty', async () => {
            const mv = await call('/v1/file-store/move', { token: A.token, body: { to: 'node:archive', from: 'own:photos' } });
            assert(mv.status === 200 && mv.body.data.moved === 1 && mv.body.data.remaining === 0, JSON.stringify(mv.body));
            assert((await readText(A.token, 'a/photo.txt')).text === 'into photos', 'the moved file does not read');
            assert((await call('/v1/file-store?name=photos', { token: A.token, method: 'DELETE' })).status === 200, 'remove the empty photos');
            const blocked = await call('/v1/file-store?name=docs', { token: A.token, method: 'DELETE' });
            assert(blocked.status === 409 && blocked.body.error?.code === 'FILES_IN_STORE', `remove with files ${blocked.status}`);
            const home = await call('/v1/file-store/move', { token: A.token, body: { to: 'home' } });
            assert(home.status === 200 && home.body.data.remaining === 0 && home.body.data.to === 'node:s3', JSON.stringify(home.body));
            const off = await call('/v1/file-store?name=docs', { token: A.token, method: 'DELETE' });
            assert(off.status === 200, `remove docs ${off.status}`);
            const view = await call('/v1/file-store', { token: A.token });
            assert(view.body.data.stores.length === 0 && view.body.data.default_store === null && view.body.data.new_files_go_to === 'node:s3', JSON.stringify(view.body.data));
        });

        await test('the operator moves the environment\'s files into a named store, and removes a store once it is empty', async () => {
            const before = await call('/v1/admin/file-store', { token: op.token });
            const inEnv = (before.body.data.files.by_place as Body[]).find(p => p.store === 'node:s3')?.count ?? 0;
            assert(inEnv > 0, 'nothing in the environment store to move');
            const mv = await call('/v1/admin/file-store/move', { token: op.token, body: { from: 'node:s3', to: 'node:archive', limit: 500 } });
            assert(mv.status === 200 && mv.body.data.moved === inEnv && mv.body.data.remaining === 0, JSON.stringify(mv.body));
            assert((await readText(A.token, 'a/plain.txt')).text === 'no store named', 'a moved file does not read');
            const fromOwn = await call('/v1/admin/file-store/move', { token: op.token, body: { from: `owner:${A.name}@${NODE_ID}` } });
            assert(fromOwn.status === 400, `the operator moved out of a person's store: ${fromOwn.status}`);
            const blocked = await call('/v1/admin/file-store/stores/archive', { token: op.token, method: 'DELETE' });
            assert(blocked.status === 409 && blocked.body.error?.code === 'FILES_IN_STORE', `remove with files ${blocked.status}`);
            const back = await call('/v1/admin/file-store/move', { token: op.token, body: { from: 'node:archive', to: 'node:s3', limit: 500 } });
            assert(back.status === 200 && back.body.data.remaining === 0, JSON.stringify(back.body));
            const gone = await call('/v1/admin/file-store/stores/archive', { token: op.token, method: 'DELETE' });
            assert(gone.status === 200 && gone.body.data.removed === true, `${gone.status}`);
            assert((await readText(A.token, 'a/inline.txt')).text === 'inline to archive', 'a file moved back does not read');
        });

        await test('the sweep of one store keeps the objects a sibling store of the same bucket names', async () => {
            // A named store inside the environment's own folder of the same bucket: the environment's
            // sweep lists its objects, and no row names them under node:s3.
            const twinPrefix = `${NODE_PREFIX}twin/`;
            const twin = await setNodeStore('twin', { kind: 's3', endpoint: s3.url, bucket: NODE_BUCKET, access_key_id: KEY_ID, secret_access_key: SECRET, prefix: twinPrefix, selectable: true });
            assert(twin.status === 201, `${twin.status} ${JSON.stringify(twin.body)}`);
            const up = await upload(A.token, 'a/twin.txt', 'kept by the sibling', 'node:twin');
            assert(up.status === 201 && up.body.data.store === 'node:twin', JSON.stringify(up.body.data));
            s3.plant(NODE_BUCKET, `${twinPrefix}orphan-old`, 'left behind', 3);
            for (const k of s3.objects(NODE_BUCKET)) if (k !== `${twinPrefix}orphan-old`) s3.backdate(NODE_BUCKET, k, 5);
            const named = s3.objects(NODE_BUCKET).filter(k => k !== `${twinPrefix}orphan-old`);
            const tr = await call('/v1/admin/scheduler/jobs/core:file-store-sweep/trigger', { token: op.token, body: {} });
            assert(tr.status === 200 && tr.body.data?.triggered === true, `trigger ${tr.status} ${JSON.stringify(tr.body.error)}`);
            for (let i = 0; i < 50 && s3.objects(NODE_BUCKET).includes(`${twinPrefix}orphan-old`); i++) await sleep(200);
            const left = s3.objects(NODE_BUCKET);
            assert(!left.includes(`${twinPrefix}orphan-old`), 'the old orphan stayed');
            for (const k of named) assert(left.includes(k), `a named object was removed: ${k}`);
            assert((await readText(A.token, 'a/twin.txt')).text === 'kept by the sibling', 'the sibling store\'s file does not read');
        });

        await test('over MCP: an agent sees the choices and names a store; the operator\'s agent changes and removes one', async () => {
            const agent = await makeAgent(BASE, B, ['storage:read', 'storage:write']);
            const s = await openSession(BASE, agent.token);
            const view = await callTool(s, 'aimeat_file_store_get', {});
            assert(!view.isError && view.text.includes('"store": "node:twin"'), view.text.slice(0, 400));
            const up = await callTool(s, 'aimeat_storage_upload', { key: 'b/mcp.txt', data_base64: Buffer.from('named over MCP').toString('base64'), mime_type: 'text/plain', store: 'node:twin' });
            assert(!up.isError && up.text.includes('"store": "node:twin"'), up.text.slice(0, 400));
            const refused = await callTool(s, 'aimeat_storage_upload', { key: 'b/mcp2.txt', data_base64: Buffer.from('x').toString('base64'), store: 'node:nowhere' });
            assert(refused.isError && refused.text.includes('UNKNOWN_STORE'), refused.text.slice(0, 300));
            const opAgent = await makeAgent(BASE, op, ['operator:admin', 'storage:read', 'storage:write']);
            const o = await openSession(BASE, opAgent.token);
            const close = await callTool(o, 'aimeat_admin_file_store_set', { name: 'twin', selectable: false });
            assert(!close.isError && close.text.includes('"selectable": false'), close.text.slice(0, 300));
            const nowRefused = await callTool(s, 'aimeat_storage_upload', { key: 'b/mcp3.txt', data_base64: Buffer.from('x').toString('base64'), store: 'node:twin' });
            assert(nowRefused.isError && nowRefused.text.includes('STORE_NOT_SELECTABLE'), nowRefused.text.slice(0, 300));
            const notEmpty = await callTool(o, 'aimeat_admin_file_store_remove', { name: 'twin' });
            assert(notEmpty.isError && notEmpty.text.includes('FILES_IN_STORE'), notEmpty.text.slice(0, 300));
            const mv = await callTool(o, 'aimeat_admin_file_store_move', { from: 'node:twin', to: 'node:s3', limit: 100 });
            assert(!mv.isError && mv.text.includes('"remaining": 0'), mv.text.slice(0, 300));
            const rm = await callTool(o, 'aimeat_admin_file_store_remove', { name: 'twin' });
            assert(!rm.isError && rm.text.includes('"removed": true'), rm.text.slice(0, 300));
            const ownAgent = await makeAgent(BASE, A, ['storage:read']);
            const denied = await callTool(await openSession(BASE, ownAgent.token), 'aimeat_admin_file_store_set', { name: 'x', selectable: true });
            assert(denied.isError, 'an owner\'s agent changed a node store');
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
