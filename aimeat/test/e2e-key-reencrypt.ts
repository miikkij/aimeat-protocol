/**
 * @file test/e2e-key-reencrypt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Replacing the data key on a running node, end to end over REST and MCP (codebase
 *   analysis 2026-11-03, decision 4a of 2026-11-05; docs/operations/key-rotation.md). One node of the
 *   suite's own, on the run's backend, started three times over one database:
 *     1. with AIMEAT_ENCRYPTION_KEY alone: the status names one key, starting the job is refused with
 *        ONE_DATA_KEY and writes nothing, and a person who is not the operator is refused; a vault
 *        secret is stored;
 *     2. with AIMEAT_ENCRYPTION_KEY_1 added and AIMEAT_ENCRYPTION_KEY_CURRENT=1: the status names both
 *        keys over REST and over MCP, the job runs to the end, moves the vault secret and the node
 *        key's database copy to key 1, finds nothing unreadable, and says the old key may go;
 *     3. with AIMEAT_ENCRYPTION_KEY removed: the node starts on key 1 alone, the node key's database
 *        copy opens with it, and the vault secret opens with it.
 *   The stored rows are read from the node's database to see which key sealed them.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-key-reencrypt
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { createStorage } from '../src/storage/storage-factory.js';
import { decrypt, getEncryptionKey } from '../src/services/encryption.js';
import { nodeKeyRowSealedWith } from '../src/storage/node-key-at-rest.js';

const PORT = 29620;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = 'aimeat-key-reencrypt-001';
const ADMIN_PW = 'KeyRingAdminPw-2026!';
const A = randomBytes(32).toString('hex');
const B = randomBytes(32).toString('hex');
const KEY_FILE = join(mkdtempSync(join(tmpdir(), 'aimeat-key-reencrypt-')), 'node-key.json');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.log(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const db = await ownNodeDb('key-reencrypt-e2e');
let log = '';

async function start(keys: { first: string; second?: string; current?: '0' | '1' }): Promise<ChildProcess> {
    const child = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env, ...db.env,
            AIMEAT_PORT: String(PORT), AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_LOG_LEVEL: 'info',
            AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
            // The data key alone seals the node key's database copy, so a key change reaches it too.
            AIMEAT_KEY_PASSPHRASE: '', AIMEAT_NODE_KEY_PATH: KEY_FILE, AIMEAT_TOTP_ENCRYPTION_KEY: '',
            AIMEAT_ENCRYPTION_KEY: keys.first, AIMEAT_ENCRYPTION_KEY_1: keys.second ?? '', AIMEAT_ENCRYPTION_KEY_CURRENT: keys.current ?? '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (c: Buffer) => { log += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { log += c.toString(); });
    return waitForServer(child, BASE, { label: 'the key re-encrypt node' });
}
async function stop(child: ChildProcess): Promise<void> {
    child.kill('SIGTERM');
    for (let i = 0; i < 150 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await sleep(300);
}

/** The node's database, opened beside the node, to see which key sealed what. */
async function stored(): Promise<{ secret: string; nodeKey: { publicKey: string; raw: string } }> {
    const s = await createStorage(db.provider === 'sqlite' ? { provider: 'sqlite', sqlitePath: db.sqlitePath } : { provider: 'postgres-kysely', dbUrl: db.dbUrl });
    try {
        const secrets = await s.listSealedColumn('secret.ciphertext', { limit: 100 });
        const secret = secrets.find(r => r.id[1] === 'API_TOKEN');
        const [row] = await s.listSealedColumn('node-key.private-key', { limit: 10 });
        return { secret: String(secret?.value ?? ''), nodeKey: { publicKey: row.id[0], raw: String(row.value) } };
    } finally {
        await (s as unknown as { close(): Promise<void> | void }).close();
    }
}

console.log('\n=== REPLACING THE DATA KEY ===\n');

let node = await start({ first: A });
let operator: Awaited<ReturnType<typeof registerOwner>>;
let alice: Awaited<ReturnType<typeof registerOwner>>;

try {
    operator = await registerOwner(BASE, `keyop${Date.now()}`);
    alice = await registerOwner(BASE, `alice${Date.now()}`);

    await test('1. One data key: the status names it, the job is refused and nothing is written, a person who is not the operator is refused', async () => {
        const st = await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) });
        assert(st.status === 200, `status ${st.status}: ${JSON.stringify(st.body?.error)}`);
        assert(JSON.stringify(st.body.data.ring) === JSON.stringify({ keys: [0], current: 0 }), `ring ${JSON.stringify(st.body.data.ring)}`);
        assert(st.body.data.job === null && st.body.data.old_key_removable === false, `job ${JSON.stringify(st.body.data.job)}`);
        const go = await json('/v1/admin/encryption/reencrypt', { method: 'POST', headers: auth(operator.token), body: '{}' });
        assert(go.status === 409 && go.body?.error?.code === 'ONE_DATA_KEY', `start ${go.status} ${JSON.stringify(go.body?.error)}`);
        const after = await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) });
        assert(after.body.data.job === null, 'the refused start wrote a job');
        const other = await json('/v1/admin/encryption/reencrypt', { headers: auth(alice.token) });
        assert(other.status === 403, `a person who is not the operator got ${other.status}`);
        const put = await json('/v1/secrets/API_TOKEN', { method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ value: 'tok-12345' }) });
        assert(put.status === 200, `vault ${put.status}: ${JSON.stringify(put.body?.error)}`);
    });

    await stop(node);
    const before = await stored();

    await test('2. The vault secret and the node key copy are sealed with key 0 in the forms they always had', async () => {
        assert(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(before.secret), `vault form ${before.secret.slice(0, 12)}`);
        assert(decrypt(before.secret, getEncryptionKey({ encryptionKey: A, totpSecretEncryptionKey: null })!) === 'tok-12345', 'the vault secret does not open with key 0');
        assert(nodeKeyRowSealedWith(before.nodeKey.raw, before.nodeKey.publicKey, { dataKeyHex: A }) === 'current', 'the node key copy is not sealed with key 0');
    });

    node = await start({ first: A, second: B, current: '1' });

    await test('3. Second key current: REST and MCP name both keys; the job moves everything to key 1 and says key 0 may go', async () => {
        const st = await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) });
        assert(JSON.stringify(st.body.data.ring) === JSON.stringify({ keys: [0, 1], current: 1 }), `ring ${JSON.stringify(st.body.data.ring)}`);
        // The operator's own agent holding operator:admin, as an operator's AI reaches the node.
        const agent = await makeAgent(BASE, operator, ['operator:admin']);
        const session = await openSession(BASE, agent.token, 'e2e-key-reencrypt');
        const viaMcp = await callTool(session, 'aimeat_admin_key_reencrypt', {});
        assert(!viaMcp.isError && viaMcp.data?.ring?.current === 1, `MCP status ${viaMcp.text?.slice(0, 200)}`);
        const go = await json('/v1/admin/encryption/reencrypt', { method: 'POST', headers: auth(operator.token), body: '{}' });
        assert(go.status === 202 && go.body.data.started === true, `start ${go.status} ${JSON.stringify(go.body?.error ?? go.body?.data)}`);
        let job: any = null;
        for (let i = 0; i < 120; i++) {
            job = (await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) })).body.data;
            if (job.job?.state !== 'running') break;
            await sleep(250);
        }
        assert(job.job?.state === 'done', `the job ended ${job.job?.state} ${job.job?.error ?? ''}`);
        assert(job.job.counts.unreadable === 0 && job.job.counts.conflicts === 0, `counts ${JSON.stringify(job.job.counts)}`);
        assert(job.job.counts.moved >= 2, `moved ${job.job.counts.moved}`);
        assert(job.old_key_values === 0 && job.old_key_removable === true, `removable ${job.old_key_removable} (${job.says})`);
        // A second start on MCP is a new run with nothing left to move.
        const again = await callTool(session, 'aimeat_admin_key_reencrypt', { action: 'start' });
        assert(!again.isError && again.data?.started === true, `MCP start ${again.text?.slice(0, 200)}`);
        let second: any = null;
        for (let i = 0; i < 120; i++) {
            second = (await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) })).body.data;
            if (second.job?.state !== 'running') break;
            await sleep(250);
        }
        assert(second.job?.state === 'done' && second.job.counts.moved === 0 && second.old_key_removable === true, `second run ${JSON.stringify(second.job?.counts)}`);
    });

    await stop(node);
    const moved = await stored();

    await test('4. The vault secret and the node key copy are now sealed with key 1', async () => {
        assert(moved.secret.startsWith('v3u:1:'), `vault form ${moved.secret.slice(0, 8)}`);
        assert(nodeKeyRowSealedWith(moved.nodeKey.raw, moved.nodeKey.publicKey, { dataKeyHex: B }) === 'current', 'the node key copy is not sealed with key 1');
        assert(moved.nodeKey.publicKey === before.nodeKey.publicKey, 'the node identity changed');
    });

    node = await start({ first: '', second: B, current: '1' });

    await test('5. Key 0 removed: the node starts on key 1 alone with its identity, and the vault secret opens with it', async () => {
        const st = await json('/v1/admin/encryption/reencrypt', { headers: auth(operator.token) });
        assert(st.status === 200, `status ${st.status}: ${JSON.stringify(st.body?.error)} (an old session token verifies only with the same node identity)`);
        assert(JSON.stringify(st.body.data.ring) === JSON.stringify({ keys: [1], current: 1 }), `ring ${JSON.stringify(st.body.data.ring)}`);
        assert(!/does not open with the AIMEAT_ENCRYPTION_KEY/.test(log), 'the node key copy did not open at start');
        const onlyB = getEncryptionKey({ encryptionKey: null, totpSecretEncryptionKey: null, encryptionKey1: B, encryptionKeyCurrent: 1 })!;
        assert(decrypt(moved.secret, onlyB) === 'tok-12345', 'the vault secret does not open with key 1');
        const list = await json('/v1/secrets', { headers: auth(alice.token) });
        assert(list.status === 200 && list.body.data.secrets.some((x: any) => x.name === 'API_TOKEN'), `vault list ${list.status}`);
    });
} finally {
    await stop(node);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log(log.split('\n').filter(l => /error|refus|key/i.test(l)).slice(-40).join('\n')); process.exit(1); }
process.exit(0);
