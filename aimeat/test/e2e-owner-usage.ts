/**
 * @file e2e-owner-usage.ts
 * @description E2E for GET /v1/owner/usage — the cached owner usage/quota summary that backs the
 *   profile Home usage card. Covers: response shape (memory/storage/micro-memory quota + counts +
 *   morsels), auth requirement, and the 60s in-memory cache (two reads return the same cached_at).
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial.
 */
// Run: cd aimeat && pnpm exec tsx test/e2e-owner-usage.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40261', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;
if (!process.env.E2E_BASE) {
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => { const s = app.listen(TEST_PORT, () => resolve(s)); });
    console.log(`Test server started on port ${TEST_PORT}`);
}

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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const ownerName = `usageowner${Date.now()}`;
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';
let ownerToken = '', ownerPrivKey = '', agentGaii = '';

console.log('\n=== Owner Usage E2E Tests ===\n');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: ownerName }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.private_key;
});

await test('Owner token', async () => {
    const { body } = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.token;
});

await test('Register an agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'usage-agent', owner: ownerName, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'], model: 'test' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
});

await test('Write a couple memory keys (owner)', async () => {
    for (const k of ['usage.a', 'usage.b']) {
        const { status } = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key: k, value: { n: 1 }, visibility: 'private' }) });
        assert(status === 201 || status === 200, `write ${k} status ${status}`);
    }
});

await test('GET /v1/owner/usage requires auth', async () => {
    const { status } = await json('/v1/owner/usage');
    assert(status === 401, `expected 401, got ${status}`);
});

let firstCachedAt = '';
await test('GET /v1/owner/usage returns the full summary shape', async () => {
    const { status, body } = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    assert(d.owner === ownerName, 'owner echoed');
    assert(typeof d.memory.used_keys === 'number' && d.memory.used_keys >= 2, `memory.used_keys >= 2, got ${d.memory.used_keys}`);
    assert(typeof d.memory.max_bytes === 'number' && d.memory.max_bytes > 0, 'memory.max_bytes set');
    assert(typeof d.memory.percent === 'number', 'memory.percent present');
    assert(typeof d.storage.used_files === 'number', 'storage.used_files present');
    assert(typeof d.micro_memory.used_sets === 'number', 'micro_memory.used_sets present');
    assert(d.counts.agents >= 1, `counts.agents >= 1, got ${d.counts.agents}`);
    assert(typeof d.counts.apps.max === 'number', 'counts.apps.max present');
    assert(typeof d.counts.extensions.max === 'number', 'counts.extensions.max present');
    assert(typeof d.counts.services.max === 'number', 'counts.services.max present');
    assert(typeof d.morsels.balance === 'number', 'morsels.balance present');
    assert(d.ttl_seconds === 60, `ttl_seconds 60, got ${d.ttl_seconds}`);
    assert(typeof d.cached_at === 'string' && d.cached_at.length > 0, 'cached_at present');
    firstCachedAt = d.cached_at;
});

await test('Second read within TTL is served from cache (same cached_at)', async () => {
    const { body } = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data?.cached_at === firstCachedAt, `cached_at should match (cache hit): ${body.data?.cached_at} vs ${firstCachedAt}`);
});

await test('Cleanup owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `delete owner status ${status}`);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Owner Usage E2E: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);
if (server) server.close();
process.exit(failed > 0 ? 1 : 0);
