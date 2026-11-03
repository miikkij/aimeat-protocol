/**
 * @file test/e2e-file-store-direct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A large file goes from the client straight into the node's S3 store and back, over live
 *   HTTP on a node of its own, against an S3 service inside the test process that checks every
 *   signature, presigned ones included (helpers/fake-s3.ts).
 *
 *   The designed use: an owner asks for a direct upload, PUTs a file larger than the node's per-file
 *   ceiling to the store address it got, completes it, and the file is theirs, read back byte for byte;
 *   a file of 64 MB or more is downloaded by a redirect to a signed store address, which answers a
 *   range as well; an agent gets the same direct upload through aimeat_storage_upload.
 *
 *   The failure modes: a complete before the PUT is refused and can be repeated; a token completes
 *   once; the same file through the node is refused by the per-file ceiling; a store address edited to
 *   name another object is refused by the store; an empty upload is refused and its object removed;
 *   another owner gets no redirect to a private file.
 * @structure main() — own node on block 30500, fake S3 on block 30900 (shared with e2e-file-store)
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-file-store-direct.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 *   v1.0.1 — 2026-11-03 — The download after the 65 MB PUT opens a new connection once on ECONNRESET,
 *     as the complete already did: a pooled connection past the node's keep-alive window was reset.
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { suitePort } from './helpers/free-port.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { startFakeS3, type FakeS3 } from './helpers/fake-s3.js';

const RUNNER_BASE = process.env.E2E_BASE ?? `http://localhost:${process.env.AIMEAT_PORT ?? '80'}`;
// The blocks of e2e-file-store: a lane runs its suites one after another and adds its own digits.
const PORT = String(suitePort(30500, RUNNER_BASE));
const S3_PORT = suitePort(30900, RUNNER_BASE);
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-file-store-direct.db');
const KEY_ID = 'e2edirectkey';
const SECRET = 'e2e-direct-secret-0123456789abcd';
const BUCKET = 'node-files';
const MB = 1024 * 1024;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message ?? err.cause})` : ''}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string>; redirect?: RequestRedirect } = {}): Promise<{ status: number; body: Body; headers: Headers }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
        method, redirect: opts.redirect ?? 'follow',
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    let body: Body;
    try { body = JSON.parse(text) as Body; } catch { body = { _raw: text }; }
    return { status: res.status, body, headers: res.headers };
}
const mintDirect = (token: string, key: string, mime = 'application/octet-stream') =>
    call('/v1/storage', { token, body: { key, mode: 'presigned', direct: true, mime_type: mime } });
const putTo = (url: string, headers: Record<string, string>, bytes: Buffer) =>
    fetch(url, { method: 'PUT', headers, body: bytes });

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
        AIMEAT_FILE_STORE_S3_BUCKET: BUCKET,
        AIMEAT_FILE_STORE_S3_ACCESS_KEY_ID: KEY_ID,
        AIMEAT_FILE_STORE_S3_SECRET_ACCESS_KEY: SECRET,
        AIMEAT_FILE_STORE_PREFIX: '',
        // A file through the node may be 1 MB; one kept in the store, up to the large-file setting.
        AIMEAT_STORAGE_MAX_FILE_SIZE_MB: '1',
        AIMEAT_STORAGE_QUOTA_MB: '500',
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });    return waitForServer(child, BASE, { label: 'the direct-transfer node' });
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
    const s3 = await startFakeS3({ port: S3_PORT, buckets: [BUCKET], accessKeyId: KEY_ID, secretAccessKey: SECRET });
    const server = await startServer(s3);
    const stamp = Date.now() % 100000;
    let A!: Awaited<ReturnType<typeof registerOwner>>;
    let B!: Awaited<ReturnType<typeof registerOwner>>;
    const holding = (bytes: Buffer) => s3.objects(BUCKET).filter(k => s3.get(BUCKET, k)?.body.equals(bytes));
    const three = randomBytes(3 * MB);
    let first!: Body;
    try {
        console.log('\n=== Large files straight to the store and back ===\n');

        await test('setup: the operator and two owners', async () => {
            await registerOwner(BASE, `dsop${stamp}`);
            A = await registerOwner(BASE, `dsa${stamp}`);
            B = await registerOwner(BASE, `dsb${stamp}`);
        });

        await test('a direct upload is answered with an address in the store, its headers and a complete address', async () => {
            const r = await mintDirect(A.token, 'big/three.bin');
            assert(r.status === 200, `mint: ${r.status} ${JSON.stringify(r.body)}`);
            first = r.body.data;
            assert(first.direct === true, `direct: ${JSON.stringify(first)}`);
            assert(String(first.upload_url).startsWith(s3.url) && String(first.upload_url).includes('X-Amz-Signature='), `the address is the store's, presigned: ${first.upload_url}`);
            assert(String(first.complete_url).startsWith(`${BASE}/v1/upload/`) && String(first.complete_url).endsWith('/complete'), `complete_url: ${first.complete_url}`);
            assert(first.upload_headers?.['content-type'] === 'application/octet-stream', `upload_headers: ${JSON.stringify(first.upload_headers)}`);
            assert(first.max_size_bytes > 1 * MB, `the large-file ceiling, not the per-file one: ${first.max_size_bytes}`);
        });

        await test('complete before the PUT is refused, and does not use the token up', async () => {
            const r = await call(first.complete_url, { method: 'POST' });
            assert(r.status === 409 && r.body.error === 'OBJECT_NOT_UPLOADED', `${r.status} ${JSON.stringify(r.body)}`);
        });

        await test('an address edited to name another object is refused by the store', async () => {
            const res = await putTo(String(first.upload_url).replace(/\/([^/?]+)\?/, '/other-object?'), first.upload_headers, Buffer.from('x'));
            assert(res.status === 403, `the store answered ${res.status}`);
        });

        await test('a file three times the per-file ceiling goes to the store and is completed as the owner\'s file', async () => {
            const put = await putTo(first.upload_url, first.upload_headers, three);
            assert(put.status === 200, `PUT to the store: ${put.status}`);
            const done = await call(first.complete_url, { method: 'POST' });
            assert(done.status === 200 && done.body.success === true, `complete: ${done.status} ${JSON.stringify(done.body)}`);
            assert(done.body.size === three.length && done.body.key === 'big/three.bin', `answer: ${JSON.stringify(done.body)}`);
            assert(String(done.body.store).startsWith('node:'), `kept in the node store: ${done.body.store}`);
            assert(holding(three).length === 1, 'the bucket holds the bytes once');
        });

        await test('the file reads back byte for byte through the node (under the redirect size)', async () => {
            const res = await fetch(`${BASE}/v1/storage/${encodeURIComponent('big/three.bin')}`, { headers: { Authorization: `Bearer ${A.token}` } });
            const got = Buffer.from(await res.arrayBuffer());
            assert(res.status === 200 && got.equals(three), `${res.status}, ${got.length} bytes`);
        });

        await test('a token completes once', async () => {
            const r = await call(first.complete_url, { method: 'POST' });
            assert(r.status === 409 || r.status === 410, `${r.status} ${JSON.stringify(r.body)}`);
        });

        await test('the same file through the node is refused by the per-file ceiling', async () => {
            const r = await call('/v1/storage', { token: A.token, body: { key: 'big/through-node.bin', mode: 'presigned' } });
            assert(r.status === 200 && !r.body.data.direct, `mint: ${r.status}`);
            const put = await fetch(r.body.data.upload_url, { method: 'PUT', body: three });
            assert(put.status === 413, `PUT through the node: ${put.status}`);
        });

        const big = randomBytes(65 * MB);
        await test('a file of 64 MB or more is downloaded by a redirect to a signed store address', async () => {
            const m = await mintDirect(A.token, 'big/sixty-five.img');
            const step = <T>(label: string, p: Promise<T>) => p.catch((err) => { throw new Error(`${label}: ${err.cause?.code ?? err.message}`); });
            const put = await step('PUT of 65 MB to the store', putTo(m.body.data.upload_url, m.body.data.upload_headers, big));
            assert(put.status === 200, `PUT: ${put.status}`);
            // The 65 MB PUT outlasts the node's keep-alive window, so a pooled connection to the node
            // may be closed under the next request; a client opens a new one, as this does once for
            // the complete and for the download (postgres sweep 41698406807 reset the download).
            const onceMore = <T>(send: () => Promise<T>) => send()
                .catch((err) => err.cause?.code === 'ECONNRESET' ? send() : Promise.reject(err));
            const done = await step('complete', onceMore(() => call(m.body.data.complete_url, { method: 'POST' })));
            assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body)}`);
            const r = await step('the download from the node', onceMore(() => fetch(`${BASE}/v1/storage/${encodeURIComponent('big/sixty-five.img')}`, { headers: { Authorization: `Bearer ${A.token}` }, redirect: 'manual' })));
            const where = r.headers.get('location') ?? '';
            assert(r.status === 302 && where.startsWith(s3.url) && where.includes('X-Amz-Signature='), `${r.status} ${where.slice(0, 80)}`);
            assert((r.headers.get('cache-control') ?? '').includes('no-store'), `cache-control: ${r.headers.get('cache-control')}`);
            const got = await fetch(where);
            const bytes = Buffer.from(await got.arrayBuffer());
            assert(got.status === 200 && bytes.equals(big), `the store answered ${got.status} with ${bytes.length} bytes`);
            assert((got.headers.get('content-disposition') ?? '').includes('sixty-five.img'), `download name: ${got.headers.get('content-disposition')}`);
            const part = await fetch(where, { headers: { Range: 'bytes=100-199' } });
            const slice = Buffer.from(await part.arrayBuffer());
            assert(part.status === 206 && slice.equals(big.subarray(100, 200)), `range: ${part.status}`);
        });

        await test('another owner gets no redirect to a private file', async () => {
            const r = await fetch(`${BASE}/v1/pub/${encodeURIComponent(A.ghii)}/${encodeURIComponent('big/sixty-five.img')}`, { headers: { Authorization: `Bearer ${B.token}` }, redirect: 'manual' });
            assert(r.status === 403 || r.status === 404, `${r.status}`);
            assert(!r.headers.get('location'), 'no store address handed out');
        });

        await test('an empty upload is refused and its object removed', async () => {
            const m = await mintDirect(A.token, 'big/empty.bin');
            const put = await putTo(m.body.data.upload_url, m.body.data.upload_headers, Buffer.alloc(0));
            assert(put.status === 200, `PUT: ${put.status}`);
            const before = s3.objects(BUCKET).length;
            const done = await call(m.body.data.complete_url, { method: 'POST' });
            assert(done.status === 400 && done.body.error === 'EMPTY_BODY', `${done.status} ${JSON.stringify(done.body)}`);
            assert(s3.objects(BUCKET).length === before - 1, 'the empty object is gone');
            const listed = await call('/v1/storage/big/empty.bin', { token: A.token });
            assert(listed.status === 404, `no file: ${listed.status}`);
        });

        await test('an agent gets the same direct upload through aimeat_storage_upload', async () => {
            const agent = await makeAgent(BASE, A, ['storage:read', 'storage:write']);
            const session = await openSession(BASE, agent.token);
            const out = await callTool(session, 'aimeat_storage_upload', { key: 'agent/blob.bin', direct: true, mime_type: 'application/octet-stream' });
            const parsed = JSON.parse(out.text) as Body;
            assert(parsed.direct === true && String(parsed.upload_url).startsWith(s3.url) && parsed.complete_url, `tool answer: ${out.text.slice(0, 300)}`);
            const bytes = randomBytes(2 * MB);
            const put = await putTo(parsed.upload_url, parsed.upload_headers, bytes);
            assert(put.status === 200, `PUT: ${put.status}`);
            const done = await call(parsed.complete_url, { method: 'POST' });
            assert(done.status === 200 && done.body.size === bytes.length, `complete: ${done.status} ${JSON.stringify(done.body)}`);
            assert(done.body.ai_provenance, `the agent's file carries a provenance record: ${JSON.stringify(done.body).slice(0, 300)}`);
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
