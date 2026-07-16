/**
 * @file e2e-admin-storage-stats.ts
 * @description E2E for the operator storage-growth telemetry (admin Database tab). Verifies the live
 *   per-table row counts (backend-specific: pg_stat on Postgres, count(*) on SQLite, collection counts on
 *   Mongo), the manual snapshot capture, that snapshots persist + list newest-first, and operator-only auth.
 * @version-history
 *   v1.1.0 -- 2026-07-16 -- Assert the memory-table composition fields (memoryVersionRows/-ArchivedRows).
 *   v1.0.0 -- 2026-07-16 -- Initial: live counts + capture + list + auth gate.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-storage-stats

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT Admin Storage-Stats E2E ===\n');

const opName = `statsop${Date.now()}`;
const nonOpName = `statsnon${Date.now()}`;
let opToken = '';
let nonOpToken = '';
const authOp = () => ({ Authorization: `Bearer ${opToken}` });

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
});

await test('GET /v1/admin/storage-stats returns live per-table counts', async () => {
    const { status, body } = await json('/v1/admin/storage-stats', { headers: authOp() });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const cur = body.data.current;
    assert(cur && typeof cur.counts === 'object', 'has current.counts');
    assert(cur.tableCount > 5, `expected several tables, got ${cur.tableCount}`);
    assert(cur.totalRows >= 0, `totalRows present, got ${cur.totalRows}`);
    // The sum of per-table counts equals the reported total.
    const sum = Object.values(cur.counts as Record<string, number>).reduce((a, b) => a + b, 0);
    assert(sum === cur.totalRows, `counts sum ${sum} === totalRows ${cur.totalRows}`);
    assert(Array.isArray(body.data.snapshots), 'snapshots is an array');
    // Memory-table composition (P3): version-history + archived row counts are reported.
    assert(typeof cur.memoryVersionRows === 'number' && cur.memoryVersionRows >= 0, `memoryVersionRows number, got ${cur.memoryVersionRows}`);
    assert(typeof cur.memoryArchivedRows === 'number' && cur.memoryArchivedRows >= 0, `memoryArchivedRows number, got ${cur.memoryArchivedRows}`);
});

await test('POST snapshot captures + persists a snapshot', async () => {
    const cap = await json('/v1/admin/storage-stats/snapshot', { method: 'POST', headers: authOp() });
    assert(cap.status === 200, `capture ${cap.status}: ${JSON.stringify(cap.body.error)}`);
    assert(cap.body.data.captured && typeof cap.body.data.captured.counts === 'object', 'captured snapshot returned');
    assert(cap.body.data.captured.totalRows > 0, `captured totalRows > 0, got ${cap.body.data.captured.totalRows}`);
});

await test('The captured snapshot appears in the list (newest-first)', async () => {
    const { body } = await json('/v1/admin/storage-stats?limit=10', { headers: authOp() });
    const snaps = body.data.snapshots as Array<{ capturedAt: string; counts: Record<string, number>; totalRows: number }>;
    assert(snaps.length >= 1, `at least one snapshot, got ${snaps.length}`);
    assert(typeof snaps[0].counts === 'object' && snaps[0].totalRows > 0, 'newest snapshot has counts + total');
    // Newest-first ordering.
    for (let i = 1; i < snaps.length; i++) assert(snaps[i - 1].capturedAt >= snaps[i].capturedAt, 'ordered newest-first');
});

await test('Non-operator is blocked (403)', async () => {
    const { status } = await json('/v1/admin/storage-stats', { headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(status === 403, `expected 403, got ${status}`);
    const cap = await json('/v1/admin/storage-stats/snapshot', { method: 'POST', headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(cap.status === 403, `capture expected 403, got ${cap.status}`);
});

await test('Unauthenticated is blocked (401)', async () => {
    const { status } = await json('/v1/admin/storage-stats');
    assert(status === 401, `expected 401, got ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
