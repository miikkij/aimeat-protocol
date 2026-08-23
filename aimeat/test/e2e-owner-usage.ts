/**
 * @file e2e-owner-usage.ts
 * @description E2E for GET /v1/owner/usage — the cached owner usage/quota summary that backs the
 *   profile Home usage card. Covers: response shape (memory/storage quota + counts +
 *   morsels), auth requirement, the in-memory cache (two reads return the same cached_at), and that a
 *   memory write INVALIDATES the cache (next read recomputes — new cached_at + higher used_keys —
 *   before the TTL would have expired), exercising the generic cache layer's event-bus invalidation.
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial.
 *   v1.1.0 — 2026-06-22 — Add the cache-invalidation-on-write assertion (generic cache layer).
 *   v1.2.0 — 2026-08-16 — August 2026 test-quality audit (e2e-owner-usage:95): the subject is a
 *     PER-OWNER cache and the suite had exactly one owner, so nothing proved the owner was part of
 *     the key. A second owner with a deliberately different key count now reads alongside the first:
 *     each summary names its own caller and carries its own numbers, and a write by one owner leaves
 *     the other reading their own. Measured with the key changed to a constant: owner B is served
 *     owner A's summary. NOT asserted: that a write leaves the other owner's ENTRY standing —
 *     invalidation is by domain tag, so any memory write drops every owner's usage entry.
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
    assert(d.counts.agents >= 1, `counts.agents >= 1, got ${d.counts.agents}`);
    assert(typeof d.counts.apps.max === 'number', 'counts.apps.max present');
    assert(typeof d.counts.extensions.max === 'number', 'counts.extensions.max present');
    assert(typeof d.counts.services.max === 'number', 'counts.services.max present');
    assert(typeof d.morsels.balance === 'number', 'morsels.balance present');
    assert(d.ttl_seconds === 60, `ttl_seconds 60, got ${d.ttl_seconds}`);
    assert(typeof d.cached_at === 'string' && d.cached_at.length > 0, 'cached_at present');
    firstCachedAt = d.cached_at;
});

await test('The summary carries the AI allowance — the one limit a person could not see', async () => {
    // The bars on Home are memory and files; what a person may SPEND was on none of
    // them and on no other page they visit. own_key decides the shape rather than the number: an
    // owner running on their own key has no house limit at all, and a bar would invent one.
    const { body } = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const ai = body.data?.ai;
    assert(!!ai, `the summary carries an ai block, got ${JSON.stringify(Object.keys(body.data ?? {}))}`);
    assert(typeof ai.own_key === 'boolean', 'own_key says which shape applies');
    assert(typeof ai.granted_usd === 'number' && typeof ai.spent_usd === 'number',
        `granted/spent are numbers, got ${JSON.stringify(ai)}`);
    assert(ai.remaining_usd === Math.max(0, ai.granted_usd - ai.spent_usd),
        `remaining is granted minus spent, got ${JSON.stringify(ai)}`);
    assert(ai.own_key === false, 'this owner has stored no key of their own');
});

let cachedKeys = 0;
await test('Second read within TTL is served from cache (same cached_at)', async () => {
    const { body } = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data?.cached_at === firstCachedAt, `cached_at should match (cache hit): ${body.data?.cached_at} vs ${firstCachedAt}`);
    cachedKeys = body.data.memory.used_keys;
});

await test('A memory write INVALIDATES the cache before the TTL (new cached_at + higher used_keys)', async () => {
    // Write a new key — the memory route emits emitChange('memory'), which the central event-bus
    // wiring translates into a `domain:memory` tag drop, evicting this owner's cached usage entry.
    const { status } = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key: 'usage.c', value: { n: 1 }, visibility: 'private' }) });
    assert(status === 201 || status === 200, `write usage.c status ${status}`);
    // Immediately re-read (well within the 60s TTL). If the cache were NOT invalidated we'd get the
    // stale cached_at + old count; invalidation forces a recompute.
    const { body } = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data?.cached_at !== firstCachedAt, `cached_at should change after a write (invalidation): still ${body.data?.cached_at}`);
    assert(body.data?.memory.used_keys > cachedKeys, `used_keys should rise after the write: ${body.data?.memory.used_keys} vs ${cachedKeys}`);
});

// The subject of this suite is a PER-OWNER cache (`usage:${ownerName}`), and it had exactly one
// owner in it. Nothing proved the owner was part of the key: with a constant key, the first owner to
// poll fills the entry and everyone else is served that owner's memory bytes, storage bytes, resource
// counts and morsel balance for the next sixty seconds.
const otherName = `usageother${Date.now()}`;
let otherToken = '';

await test('A SECOND owner with a different amount of data', async () => {
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: otherName }),
    });
    assert(reg.status === 200, `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ owner: otherName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    otherToken = tok.body.token;
    // Deliberately a different count from owner A's, so the two summaries cannot be confused.
    for (const k of ['other.a', 'other.b', 'other.c', 'other.d', 'other.e']) {
        const { status } = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${otherToken}` },
            body: JSON.stringify({ key: k, value: { n: 1 }, visibility: 'private' }),
        });
        assert(status === 201 || status === 200, `write ${k} status ${status}`);
    }
});

await test('Each owner is served THEIR OWN summary, not the first caller\'s', async () => {
    const a = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const b = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${otherToken}` } });
    assert(a.status === 200 && b.status === 200, `status ${a.status}/${b.status}`);
    assert(a.body.data.owner === ownerName, `A's summary names A, got ${a.body.data.owner}`);
    assert(b.body.data.owner === otherName, `B's summary names B, got ${b.body.data.owner}`);
    assert(b.body.data.memory.used_keys === 5, `B has its own five keys, got ${b.body.data.memory.used_keys}`);
    assert(a.body.data.memory.used_keys !== b.body.data.memory.used_keys,
        `the two owners must not share a count: A ${a.body.data.memory.used_keys} vs B ${b.body.data.memory.used_keys}`);
    assert(b.body.data.counts.agents === 0, `B has no agents, got ${b.body.data.counts.agents}`);
});

await test('A write by one owner never turns the other owner\'s summary into theirs', async () => {
    // NOT asserted: that B's cache entry survives A's write. Invalidation is by DOMAIN tag
    // (`domain:memory`), so any owner's memory write drops every owner's usage entry — measured,
    // B's cached_at moves. What must hold across that recompute is whose numbers come back.
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'usage.d', value: { n: 1 }, visibility: 'private' }),
    });
    assert(w.status === 201 || w.status === 200, `A writes: ${w.status}`);

    const bAgain = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${otherToken}` } });
    assert(bAgain.body.data.owner === otherName, `B must still get B, got ${bAgain.body.data.owner}`);
    assert(bAgain.body.data.memory.used_keys === 5, `and B's own count, not A's: ${bAgain.body.data.memory.used_keys}`);

    const aAgain = await json('/v1/owner/usage', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(aAgain.body.data.owner === ownerName, `A still gets A: ${aAgain.body.data.owner}`);
    assert(aAgain.body.data.memory.used_keys > cachedKeys, `A's count rose after A's write: ${aAgain.body.data.memory.used_keys}`);
});

await test('Cleanup owners', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `delete owner status ${status}`);
    const other = await json(`/v1/owners/${encodeURIComponent(otherName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherToken}` } });
    assert(other.status === 200, `delete second owner status ${other.status}`);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`Owner Usage E2E: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);
if (server) server.close();
process.exit(failed > 0 ? 1 : 0);
