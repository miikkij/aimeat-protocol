/**
 * @file e2e-memory-full.ts
 * @description Comprehensive E2E tests for the Memory API — covers POST/PUT/DELETE,
 *   optimistic locking, version conflicts, prefix queries, visibility, TTL,
 *   schema validation, quota enforcement, and edge cases.
 *   This test suite catches bugs like using PUT to create new keys (should 404).
 * @version-history
 *   v1.0.0 — 2026-03-14 — Initial comprehensive memory E2E test suite
 *   v1.1.0 — 2026-05-28 — Expect missing memory reads to return 404 without auto-creating records
 *   v1.2.0 — 2026-05-31 — Add owner-session cross-agent DELETE coverage (owner can delete a key stored under their agent; truly-missing key still 404s)
 *   v1.3.0 — 2026-05-31 — Add owner-session POST agent-targeting coverage (owner can create a key under their agent's GAII via `agent`; foreign-agent target rejected)
 *   v1.4.0 — 2026-06-22 — Cover the scalable Memory tab: include=meta (value omitted + bytes),
 *     search?prefix scoping, export, import (skip/overwrite/rename), and bulk-delete by prefix.
 *   v1.5.0 — 2026-07-03 — 'members' visibility: write accepted, anonymous public-route read
 *     404s, authenticated other-owner read succeeds.
 *   v1.6.0 — 2026-07-03 — POST /v1/memory/bundle (collection ZIP export): happy path returns a real
 *     application/zip attachment containing the memory + file entries and a manifest; failure modes
 *     cover empty items (400), only-not-owned items (404), and missing auth (401).
 *   v1.7.0 — 2026-07-15 — POST /v1/memory/bulk (Phase 1 batched write): create/update/skip summary,
 *     organism-prefixed and reserved-key refusal into failed[], and 400/401 guards.
 *   v1.7.1 — 2026-07-15 — Bulk write storage_ref integrity (dangling ref → failed) — guard-parity with
 *     the single POST /v1/memory.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-memory-full.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

// ─── Boot embedded server ───
const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40251', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;

if (!process.env.E2E_BASE) {
    process.env.AIMEAT_PORT = String(TEST_PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
    }
    const { config } = loadConfig({});
    config.port = TEST_PORT;
    const { app } = await createServer(config);
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(TEST_PORT, () => resolve(s));
    });
    console.log(`Test server started on port ${TEST_PORT}`);
}

// ─── Test harness ───
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// ─── Crypto helpers ───
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `memowner${Date.now()}`;
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';

// Second agent for cross-agent visibility tests
let agent2Token = '';
let agent2PrivKey = '';
let agent2Gaii = '';

const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? '';

console.log('\n=== Memory Full E2E Tests ===\n');

// ─── Setup ───
console.log('Setup — Auth');

await test('Register owner', async () => {
    if (ADMIN_PW) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: ownerName }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
        ownerPrivKey = body.private_key;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        ownerPrivKey = body.data.private_key;
    }
});

await test('Owner auth token', async () => {
    if (ADMIN_PW) {
        const { body } = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: ownerName, private_key: ownerPrivKey }),
        });
        assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
        ownerToken = body.token;
    } else {
        const timestamp = new Date().toISOString();
        const message = ownerName + NODE_ID + timestamp;
        const signature = await signMsg(ownerPrivKey, message);
        const { body } = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerName, timestamp, signature }),
        });
        assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
        ownerToken = body.data?.token;
    }
});

await test('Register agent 1', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'mem-agent-1',
            owner: ownerName,
            capabilities: ['memory'],
            scopes: ['memory:read', 'memory:write', 'memory:delete'],
            model: 'test',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('Agent 1 auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
});

await test('Register agent 2', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'mem-agent-2',
            owner: ownerName,
            capabilities: ['memory'],
            scopes: ['memory:read', 'memory:write', 'memory:delete'],
            model: 'test',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agent2Gaii = body.data.agent.gaii;
    agent2PrivKey = body.data.private_key;
});

await test('Agent 2 auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = agent2Gaii + timestamp;
    const signature = await signMsg(agent2PrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agent2Gaii, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    agent2Token = body.data?.token;
});

const auth1 = () => ({ Authorization: `Bearer ${agentToken}` });
const auth2 = () => ({ Authorization: `Bearer ${agent2Token}` });

// ═══════════════════════════════════════════════════════
// POST — Create new memory entries
// ═══════════════════════════════════════════════════════
console.log('\n1. POST /v1/memory — Create');

await test('POST creates new key (status 201)', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.create', value: { hello: 'world' }, visibility: 'private' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.version === 1, `version should be 1, got ${body.data?.version}`);
});

await test('POST with tags and ttl_hours', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.tagged', value: 'data', visibility: 'private', tags: ['alpha', 'beta'], ttl_hours: 24 }),
    });
    assert(status === 201, `status ${status}`);
    assert(body.data?.tags?.length === 2, 'has 2 tags');
});

await test('POST upsert overwrites existing key (status 200)', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.create', value: { hello: 'updated' }, visibility: 'private' }),
    });
    assert(status === 200, `expected 200 on upsert, got ${status}`);
    assert(body.data?.version === 2, `version should be 2 after upsert, got ${body.data?.version}`);
});

await test('POST without auth returns 401', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: 'test.noauth', value: 'x', visibility: 'private' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('POST without key returns 400/422', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ value: 'no-key' }),
    });
    assert(status === 400 || status === 422, `expected 400 or 422, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// GET — Read memory entries
// ═══════════════════════════════════════════════════════
console.log('\n2. GET /v1/memory — Read');

await test('GET single key returns correct value', async () => {
    const { status, body } = await json('/v1/memory/test.create', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    assert(body.data?.value?.hello === 'updated', `value: ${JSON.stringify(body.data?.value)}`);
    assert(body.data?.version === 2, 'correct version after upsert');
});

await test('GET non-existent key returns 404', async () => {
    const { status } = await json('/v1/memory/test.does.not.exist', { headers: auth1() });
    assert(status === 404, `expected 404 for missing key, got ${status}`);
});

await test('GET non-existent key with ?soft=1 returns 200 value:null', async () => {
    const { status, body } = await json('/v1/memory/test.does.not.exist?soft=1', { headers: auth1() });
    assert(status === 200, `expected 200 for soft read, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.value === null, `value should be null: ${JSON.stringify(body.data)}`);
    assert(body.data?.exists === false, `exists should be false: ${body.data?.exists}`);
});

await test('GET list with prefix filter', async () => {
    const { status, body } = await json('/v1/memory?prefix=test.', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    const items = body.data?.items || [];
    assert(items.length >= 2, `expected >=2 items with prefix test., got ${items.length}`);
    assert(items.every((i: any) => i.key.startsWith('test.')), 'all keys start with test.');
});

await test('GET list returns version and visibility for each item', async () => {
    const { status, body } = await json('/v1/memory?prefix=test.', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    const items = body.data?.items || [];
    for (const item of items) {
        assert(typeof item.version === 'number', `item ${item.key} has no version`);
        assert(typeof item.visibility === 'string', `item ${item.key} has no visibility`);
    }
});

// ═══════════════════════════════════════════════════════
// PUT — Update with optimistic locking
// ═══════════════════════════════════════════════════════
console.log('\n3. PUT /v1/memory/:key — Update (optimistic locking)');

await test('PUT with correct version succeeds', async () => {
    // First read current version
    const { body: readBody } = await json('/v1/memory/test.create', { headers: auth1() });
    const currentVersion = readBody.data?.version;

    const { status, body } = await json('/v1/memory/test.create', {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ value: { hello: 'v3' }, version: currentVersion }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.version === currentVersion + 1, `version should be ${currentVersion + 1}`);
});

await test('PUT with wrong version returns 409 VERSION_CONFLICT', async () => {
    const { status, body } = await json('/v1/memory/test.create', {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ value: { stale: true }, version: 1 }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(body.error?.code === 'VERSION_CONFLICT', `error code: ${body.error?.code}`);
    assert(typeof body.error?.details?.current_version === 'number', 'includes current_version in details');
});

await test('PUT on non-existent key returns 404 NOT_FOUND', async () => {
    const { status, body } = await json('/v1/memory/this.key.never.existed', {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ value: 'nope', version: 0 }),
    });
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'NOT_FOUND', `error code: ${body.error?.code}`);
});

await test('PUT can update visibility', async () => {
    const { body: readBody } = await json('/v1/memory/test.create', { headers: auth1() });
    const ver = readBody.data?.version;

    const { status, body } = await json('/v1/memory/test.create', {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ visibility: 'public', version: ver }),
    });
    assert(status === 200, `status ${status}`);

    // Verify visibility changed
    const { body: verifyBody } = await json('/v1/memory/test.create', { headers: auth1() });
    assert(verifyBody.data?.visibility === 'public', `visibility: ${verifyBody.data?.visibility}`);
});

await test('PUT can update tags', async () => {
    const { body: readBody } = await json('/v1/memory/test.create', { headers: auth1() });
    const ver = readBody.data?.version;

    const { status } = await json('/v1/memory/test.create', {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ tags: ['updated', 'tags'], version: ver }),
    });
    assert(status === 200, `status ${status}`);

    const { body: verifyBody } = await json('/v1/memory/test.create', { headers: auth1() });
    assert(verifyBody.data?.tags?.includes('updated'), 'tags updated');
});

await test('PUT without auth returns 401', async () => {
    const { status } = await json('/v1/memory/test.create', {
        method: 'PUT',
        body: JSON.stringify({ value: 'no-auth', version: 1 }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// Concurrent writes — race condition test
// ═══════════════════════════════════════════════════════
console.log('\n4. Concurrent writes — race conditions');

await test('Concurrent PUTs: one wins, one gets 409', async () => {
    // Setup: create a key
    await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.race', value: 'initial', visibility: 'private' }),
    });

    const { body: readBody } = await json('/v1/memory/test.race', { headers: auth1() });
    const ver = readBody.data?.version;

    // Fire two PUTs concurrently with same version
    const [r1, r2] = await Promise.all([
        json('/v1/memory/test.race', {
            method: 'PUT',
            headers: auth1(),
            body: JSON.stringify({ value: 'writer-A', version: ver }),
        }),
        json('/v1/memory/test.race', {
            method: 'PUT',
            headers: auth1(),
            body: JSON.stringify({ value: 'writer-B', version: ver }),
        }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert(statuses.includes(200), `one should succeed (200), got ${statuses}`);
    // The other should either succeed (if sequential) or 409 (if truly concurrent)
    assert(statuses[0] === 200 || statuses[1] === 409, `expected 200+409 or 200+200, got ${statuses}`);
});

// ═══════════════════════════════════════════════════════
// DELETE — Remove memory entries
// ═══════════════════════════════════════════════════════
console.log('\n5. DELETE /v1/memory/:key');

await test('DELETE existing key returns 200', async () => {
    // Create a key to delete
    await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.deleteme', value: 'bye', visibility: 'private' }),
    });

    const { status, body } = await json('/v1/memory/test.deleteme', {
        method: 'DELETE',
        headers: auth1(),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.deleted === true, 'deleted flag');
});

await test('DELETE non-existent key returns 404', async () => {
    const { status } = await json('/v1/memory/test.already.gone', {
        method: 'DELETE',
        headers: auth1(),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('GET after DELETE returns 404', async () => {
    const { status } = await json('/v1/memory/test.deleteme', { headers: auth1() });
    assert(status === 404, `expected 404 after delete, got ${status}`);
});

// Owner sessions can delete a key stored under one of their agents, even
// though the owner's own GHII has no such key. Mirrors the PUT cross-agent
// lookup. Regression guard for the DELETE 404 bug (owner-deletes-agent-key).
const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });

await test('Owner can DELETE a key stored under their agent', async () => {
    // Agent 1 creates a private key.
    const createRes = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.owner.delete', value: 'agent-owned', visibility: 'private' }),
    });
    assert(createRes.status === 201, `setup create status ${createRes.status}`);

    // Owner session (GHII != agent GAII) deletes it.
    const { status, body } = await json('/v1/memory/test.owner.delete', {
        method: 'DELETE',
        headers: ownerAuth(),
    });
    assert(status === 200, `expected 200 owner cross-agent delete, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.deleted === true, 'deleted flag');

    // Confirm it's actually gone from the agent's namespace.
    const after = await json('/v1/memory/test.owner.delete', { headers: auth1() });
    assert(after.status === 404, `expected 404 after owner delete, got ${after.status}`);
});

await test('Owner DELETE of a truly missing key still returns 404', async () => {
    const { status } = await json('/v1/memory/test.owner.never.existed', {
        method: 'DELETE',
        headers: ownerAuth(),
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// Owner sessions can create a memory entry UNDER an agent's GAII (not the
// owner's GHII) by passing `agent`. Regression guard for owner-created agent
// memory landing under the wrong identity.
await test('Owner POST with agent= stores under the agent GAII', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: ownerAuth(),
        body: JSON.stringify({ key: 'test.owner.creates', value: { v: 1 }, visibility: 'owner', agent: agentGaii }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);

    // The agent itself must be able to read it — proves it's in the agent's namespace.
    const read = await json('/v1/memory/test.owner.creates', { headers: auth1() });
    assert(read.status === 200, `agent should read owner-created key, got ${read.status}`);
    assert(read.body.data?.value?.v === 1, `value mismatch: ${JSON.stringify(read.body.data?.value)}`);
});

await test('Owner POST with agent= belonging to another owner is rejected', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: ownerAuth(),
        body: JSON.stringify({ key: 'test.owner.forbidden', value: 'x', agent: 'someoneelse#stranger@aimeat-local-001-dev' }),
    });
    assert(status === 403, `expected 403 for foreign agent target, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// Cross-agent isolation
// ═══════════════════════════════════════════════════════
console.log('\n6. Cross-agent isolation');

await test('Agent 1 private key not visible to Agent 2', async () => {
    // Agent 1 creates private key
    await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.private.a1', value: 'secret', visibility: 'private' }),
    });

    // Agent 2 tries to read it — should not see agent 1's data.
    const { body } = await json('/v1/memory/test.private.a1', { headers: auth2() });
    const val = body.data?.value;
    assert(val !== 'secret', `agent 2 should not see agent 1 private data, got: ${JSON.stringify(val)}`);
});

await test('Agent 2 list does not include Agent 1 private keys', async () => {
    const { body } = await json('/v1/memory?prefix=test.private.', { headers: auth2() });
    const items = body.data?.items || [];
    const a1Keys = items.filter((i: any) => i.value === 'secret');
    assert(a1Keys.length === 0, `agent 2 sees ${a1Keys.length} of agent 1 private keys`);
});

// ═══════════════════════════════════════════════════════
// Search
// ═══════════════════════════════════════════════════════
console.log('\n7. Search /v1/memory/search');

await test('Search finds matching keys', async () => {
    // Create searchable entries
    await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'search.findme', value: { name: 'searchable item' }, visibility: 'private', tags: ['searchable'] }),
    });

    const { status, body } = await json('/v1/memory/search?q=findme', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data?.results), 'has results array');
    const found = body.data.results.find((r: any) => r.key === 'search.findme');
    assert(found !== undefined, 'found the searchable entry');
});

// ═══════════════════════════════════════════════════════
// Visibility levels
// ═══════════════════════════════════════════════════════
console.log('\n8. Visibility levels');

await test('POST with visibility=public', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.public', value: 'visible', visibility: 'public' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    assert(body.data?.visibility === 'public', `visibility: ${body.data?.visibility}`);
});

await test('POST with visibility=owner', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.owner', value: 'dmz', visibility: 'owner' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    assert(body.data?.visibility === 'owner', `visibility: ${body.data?.visibility}`);
});

await test('POST with invalid visibility defaults or fails', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.badvis', value: 'x', visibility: 'invalid_level' }),
    });
    // Should reject invalid visibility
    assert(status === 400 || status === 422, `expected 400/422 for invalid visibility, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// Value types
// ═══════════════════════════════════════════════════════
console.log('\n9. Value types');

await test('Value can be a string', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.string', value: 'hello', visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.string', { headers: auth1() });
    assert(body.data?.value === 'hello', `value: ${body.data?.value}`);
});

await test('Value can be a number', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.number', value: 42, visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.number', { headers: auth1() });
    assert(body.data?.value === 42, `value: ${body.data?.value}`);
});

await test('Value can be a nested object', async () => {
    const nested = { a: { b: { c: [1, 2, 3] } }, d: true };
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.nested', value: nested, visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.nested', { headers: auth1() });
    assert(body.data?.value?.a?.b?.c?.[2] === 3, `nested value: ${JSON.stringify(body.data?.value)}`);
});

await test('Value can be an array', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.array', value: [1, 'two', { three: 3 }], visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.array', { headers: auth1() });
    assert(Array.isArray(body.data?.value), 'value is array');
    assert(body.data?.value?.[1] === 'two', `array[1]: ${body.data?.value?.[1]}`);
});

await test('Value can be null', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.null', value: null, visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.null', { headers: auth1() });
    assert(body.data?.value === null, `value should be null, got: ${body.data?.value}`);
});

await test('Value can be boolean', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'test.val.bool', value: false, visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
    const { body } = await json('/v1/memory/test.val.bool', { headers: auth1() });
    assert(body.data?.value === false, `value should be false, got: ${body.data?.value}`);
});

// ═══════════════════════════════════════════════════════
// Key naming edge cases
// ═══════════════════════════════════════════════════════
console.log('\n10. Key naming');

await test('Key with dots works (hierarchical)', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'app.config.theme.colors.primary', value: '#ff0000', visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
});

await test('Key with hyphens works', async () => {
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: 'my-app-settings', value: 'ok', visibility: 'private' }),
    });
    assert(status === 201 || status === 200, `status ${status}`);
});

await test('Prefix query with deep nesting', async () => {
    const { body } = await json('/v1/memory?prefix=app.config.theme.', { headers: auth1() });
    const items = body.data?.items || [];
    assert(items.length >= 1, `expected >=1 items with prefix app.config.theme., got ${items.length}`);
});

await test('?count=true returns only the count (no items), matching the full list length', async () => {
    const { body: full } = await json('/v1/memory', { headers: auth1() });
    const fullLen = (full.data?.items || []).length;
    const { status, body } = await json('/v1/memory?count=true', { headers: auth1() });
    assert(status === 200, `count status ${status}`);
    assert(typeof body.data?.count === 'number', 'count is a number');
    assert(body.data.items === undefined, 'count mode omits items (no values transferred)');
    assert(body.data.count === fullLen, `count ${body.data.count} should equal full list length ${fullLen}`);
});

// ═══════════════════════════════════════════════════════
// PUT/POST semantics contract
// ═══════════════════════════════════════════════════════
console.log('\n11. PUT vs POST contract');

await test('POST creates new key — PUT on same key works after', async () => {
    const key = 'test.post-then-put';
    const { status: s1 } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key, value: 'created', visibility: 'private' }),
    });
    assert(s1 === 201, `POST create: ${s1}`);

    const { status: s2, body } = await json(`/v1/memory/${key}`, {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ value: 'updated', version: 1 }),
    });
    assert(s2 === 200, `PUT update: ${s2}`);
    assert(body.data?.version === 2, `version after PUT: ${body.data?.version}`);
});

await test('PUT on brand-new key returns 404 (NOT upsert)', async () => {
    const key = 'test.never-posted-' + Date.now();
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: auth1(),
        body: JSON.stringify({ value: 'should-fail', version: 0 }),
    });
    assert(status === 404, `PUT on new key should be 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('POST is idempotent on same key (upsert)', async () => {
    const key = 'test.idempotent';
    const { status: s1, body: b1 } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key, value: 'first', visibility: 'private' }),
    });
    assert(s1 === 201, `first POST: ${s1}`);
    assert(b1.data?.version === 1, 'version 1');

    const { status: s2, body: b2 } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key, value: 'second', visibility: 'private' }),
    });
    assert(s2 === 200, `second POST: ${s2}`);
    assert(b2.data?.version === 2, 'version 2');

    const { body: readBody } = await json(`/v1/memory/${key}`, { headers: auth1() });
    assert(readBody.data?.value === 'second', `value after upsert: ${readBody.data?.value}`);
});

// ═══════════════════════════════════════════════════════
// Scalable Memory tab (v2.3): meta listing, scoped search, export/import, bulk-delete
// ═══════════════════════════════════════════════════════
console.log('\n9. Scalable Memory tab — meta / search prefix / export / import / bulk-delete');

await test('include=meta omits value and reports bytes', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'meta.demo', value: { big: 'x'.repeat(50) }, visibility: 'private' }) });
    const { status, body } = await json('/v1/memory?include=meta', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    const item = (body.data?.items || []).find((i: any) => i.key === 'meta.demo');
    assert(!!item, 'meta.demo present in meta listing');
    assert(item.value === undefined, 'value omitted in meta mode');
    assert(typeof item.bytes === 'number' && item.bytes > 0, `bytes reported, got ${item.bytes}`);
});

await test('search?prefix scopes to a namespace', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'proj.one', value: { note: 'needlexyz' }, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'other.one', value: { note: 'needlexyz' }, visibility: 'private' }) });
    const { body } = await json('/v1/memory/search?q=needlexyz&prefix=proj.', { headers: auth1() });
    const keys = (body.data?.results || []).map((r: any) => r.key);
    assert(keys.includes('proj.one'), 'proj.one matched');
    assert(!keys.includes('other.one'), 'other.one excluded by prefix');
});

await test('export returns entries with full values', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'exp.a', value: { v: 1 }, visibility: 'private' }) });
    const { status, body } = await json('/v1/memory/export?prefix=exp.', { headers: auth1() });
    assert(status === 200, `status ${status}`);
    const entry = (body.data?.entries || []).find((e: any) => e.key === 'exp.a');
    assert(!!entry && entry.value?.v === 1, 'exp.a exported with value');
});

await test('import mode=skip creates new then skips existing', async () => {
    const r1 = await json('/v1/memory/import', { method: 'POST', headers: auth1(), body: JSON.stringify({ mode: 'skip', entries: [{ key: 'imp.a', value: 1 }] }) });
    assert(r1.body.data?.created === 1, `created 1, got ${JSON.stringify(r1.body.data)}`);
    const r2 = await json('/v1/memory/import', { method: 'POST', headers: auth1(), body: JSON.stringify({ mode: 'skip', entries: [{ key: 'imp.a', value: 2 }] }) });
    assert(r2.body.data?.skipped === 1, `skipped 1, got ${JSON.stringify(r2.body.data)}`);
    const read = await json('/v1/memory/imp.a', { headers: auth1() });
    assert(read.body.data?.value === 1, 'value unchanged after skip');
});

await test('import mode=overwrite replaces existing value', async () => {
    const r = await json('/v1/memory/import', { method: 'POST', headers: auth1(), body: JSON.stringify({ mode: 'overwrite', entries: [{ key: 'imp.a', value: 3 }] }) });
    assert(r.body.data?.updated === 1, `updated 1, got ${JSON.stringify(r.body.data)}`);
    const read = await json('/v1/memory/imp.a', { headers: auth1() });
    assert(read.body.data?.value === 3, 'value overwritten');
});

await test('import mode=rename keeps original and creates a new key', async () => {
    const r = await json('/v1/memory/import', { method: 'POST', headers: auth1(), body: JSON.stringify({ mode: 'rename', entries: [{ key: 'imp.a', value: 4 }] }) });
    assert(r.body.data?.created === 1, `created 1 (renamed), got ${JSON.stringify(r.body.data)}`);
    const orig = await json('/v1/memory/imp.a', { headers: auth1() });
    assert(orig.body.data?.value === 3, 'original imp.a unchanged');
    const renamed = await json('/v1/memory/imp.a-imported', { headers: auth1() });
    assert(renamed.body.data?.value === 4, 'renamed copy created');
});

await test('bulk-delete by prefix removes all matching keys', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'del.x', value: 1, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'del.y', value: 1, visibility: 'private' }) });
    const r = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth1(), body: JSON.stringify({ prefix: 'del.' }) });
    assert(r.body.data?.deleted === 2, `deleted 2, got ${JSON.stringify(r.body.data)}`);
    const list = await json('/v1/memory?prefix=del.', { headers: auth1() });
    assert((list.body.data?.items || []).length === 0, 'no del.* keys remain');
});

await test('bulk-delete requires prefix or keys', async () => {
    const { status } = await json('/v1/memory/bulk-delete', { method: 'POST', headers: auth1(), body: JSON.stringify({}) });
    assert(status === 400, `expected 400, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// 'members' visibility — readable by any authenticated node user via the
// public read route (/v1/memory/:gaii/:key); anonymous requests get 404.
// Works both with anonymous mode OFF (req.auth undefined) and ON (the
// injected shared identity carries anonymous:true and is excluded).
// ═══════════════════════════════════════════════════════
console.log('\n12. members visibility');

const memberKey = 'test.members-contact';
const owner2Name = `memowner2${Date.now()}`;
let owner2Token = '';

await test('POST accepts visibility "members"', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: auth1(),
        body: JSON.stringify({ key: memberKey, value: { email: 'members@example.com' }, visibility: 'members' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.visibility === 'members', `visibility: ${body.data?.visibility}`);
});

await test('anonymous read of a members record → 404 (no existence leak)', async () => {
    const { status } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(memberKey)}`);
    assert(status === 404, `expected 404, got ${status}`);
});

await test('register second owner + token (different account)', async () => {
    if (ADMIN_PW) {
        const { status, body } = await json('/v1/admin/setup/register', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ name: owner2Name }),
        });
        assert(status === 200, `owner2 register ${status}: ${JSON.stringify(body)}`);
        const tok = await json('/v1/admin/setup/token', {
            method: 'POST',
            headers: { 'X-Admin-Password': ADMIN_PW },
            body: JSON.stringify({ owner: owner2Name, private_key: body.private_key }),
        });
        assert(tok.body.ok === true, `owner2 token: ${JSON.stringify(tok.body.error)}`);
        owner2Token = tok.body.token;
    } else {
        const { status, body } = await json('/v1/owners', {
            method: 'POST',
            body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
        });
        assert(status === 201, `owner2 register ${status}: ${JSON.stringify(body)}`);
        const timestamp = new Date().toISOString();
        const signature = await signMsg(body.data.private_key, owner2Name + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: owner2Name, timestamp, signature }),
        });
        assert(tok.body.ok === true, `owner2 token: ${JSON.stringify(tok.body.error)}`);
        owner2Token = tok.body.data?.token;
    }
});

await test('authenticated other-owner read of a members record → 200 with value', async () => {
    const { status, body } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(memberKey)}`, {
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.value?.email === 'members@example.com', `value round-trips: ${JSON.stringify(body.data?.value)}`);
    assert(body.data?.visibility === 'members', `visibility: ${body.data?.visibility}`);
});

await test('members read stays 404 for anonymous after an authenticated read', async () => {
    const { status } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(memberKey)}`);
    assert(status === 404, `expected 404, got ${status}`);
});

await test('cleanup second owner', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(owner2Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `delete owner2 status ${status}`);
});

// ═══════════════════════════════════════════════════════
// Collection bundle — ZIP export of selected memory entries + storage files
// ═══════════════════════════════════════════════════════
console.log('\n13. POST /v1/memory/bundle — collection ZIP export');

await test('Bundle setup: a memory entry + a storage file', async () => {
    const m = await json('/v1/memory', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'bundle.note', value: { hi: 'there' }, visibility: 'private' }) });
    assert(m.status === 201, `mem ${m.status}: ${JSON.stringify(m.body)}`);
    const f = await json('/v1/memory/files', { method: 'POST', headers: auth1(), body: JSON.stringify({ key: 'bundle/report.txt', content: Buffer.from('hello bundle').toString('base64'), mime_type: 'text/plain', visibility: 'private' }) });
    assert(f.status === 201, `file ${f.status}: ${JSON.stringify(f.body)}`);
});

await test('Bundle returns a real ZIP with both entries (application/zip attachment, PK magic)', async () => {
    const res = await fetch(`${BASE}/v1/memory/bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth1() },
        body: JSON.stringify({ items: [{ kind: 'memory', key: 'bundle.note' }, { kind: 'file', key: 'bundle/report.txt' }] }),
    });
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') || '').includes('application/zip'), `content-type: ${res.headers.get('content-type')}`);
    assert((res.headers.get('content-disposition') || '').includes('attachment'), 'attachment disposition');
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.length > 0, 'empty zip');
    assert(buf[0] === 0x50 && buf[1] === 0x4B, `not a zip (magic ${buf[0]},${buf[1]})`); // 'PK'
    // ZIP entry names are stored uncompressed in the archive, so they appear verbatim in the bytes.
    assert(buf.includes(Buffer.from('memory/bundle.note.json')), 'memory entry present');
    assert(buf.includes(Buffer.from('files/bundle/report.txt')), 'file entry present');
    assert(buf.includes(Buffer.from('manifest.json')), 'manifest present');
});

await test('Bundle rejects empty items (400)', async () => {
    const { status } = await json('/v1/memory/bundle', { method: 'POST', headers: auth1(), body: JSON.stringify({ items: [] }) });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('Bundle of only not-owned items returns 404', async () => {
    const { status } = await json('/v1/memory/bundle', { method: 'POST', headers: auth1(), body: JSON.stringify({ items: [{ kind: 'memory', key: 'bundle.note', owner_gaii: 'stranger#nobody@' + NODE_ID }] }) });
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Bundle without auth returns 401', async () => {
    const { status } = await json('/v1/memory/bundle', { method: 'POST', body: JSON.stringify({ items: [{ kind: 'memory', key: 'bundle.note' }] }) });
    assert(status === 401, `expected 401, got ${status}`);
});

// ═══════════════════════════════════════════════════════
// POST /v1/memory/bulk — batched write (Phase 1 data-access redesign)
// ═══════════════════════════════════════════════════════
console.log('\n14. POST /v1/memory/bulk — batched write');

await test('Bulk write creates many entries + reports summary', async () => {
    const { status, body } = await json('/v1/memory/bulk', {
        method: 'POST', headers: auth1(),
        body: JSON.stringify({ entries: [
            { key: 'bulk.one', value: { n: 1 } },
            { key: 'bulk.two', value: { n: 2 }, visibility: 'private', tags: ['t'] },
            { key: 'bulk.three', value: { n: 3 } },
        ] }),
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data.created === 3, `expected 3 created, got ${body.data.created}`);
    // Written rows are really readable afterward.
    const read = await json('/v1/memory/bulk.two', { headers: auth1() });
    assert(read.status === 200 && read.body.data.value.n === 2, 'bulk.two persisted and reads back');
});

await test('Bulk write updates existing + skips in skip mode', async () => {
    const overwrite = await json('/v1/memory/bulk', {
        method: 'POST', headers: auth1(),
        body: JSON.stringify({ entries: [{ key: 'bulk.one', value: { n: 11 } }] }),
    });
    assert(overwrite.body.data.updated === 1, `expected 1 updated, got ${overwrite.body.data.updated}`);
    const skip = await json('/v1/memory/bulk', {
        method: 'POST', headers: auth1(),
        body: JSON.stringify({ mode: 'skip', entries: [{ key: 'bulk.one', value: { n: 999 } }, { key: 'bulk.fresh', value: { n: 4 } }] }),
    });
    assert(skip.body.data.skipped === 1 && skip.body.data.created === 1, `skip summary wrong: ${JSON.stringify(skip.body.data)}`);
    const read = await json('/v1/memory/bulk.one', { headers: auth1() });
    assert(read.body.data.value.n === 11, 'skip mode left existing value untouched');
});

await test('Bulk write refuses organism.* keys (workspace path) and reserved keys', async () => {
    const { body } = await json('/v1/memory/bulk', {
        method: 'POST', headers: auth1(),
        body: JSON.stringify({ entries: [
            { key: 'organism.o1.w.ws.x', value: { a: 1 } },
            { key: 'ok.key', value: { a: 1 } },
        ] }),
    });
    assert(body.data.created === 1, `expected 1 created, got ${body.data.created}`);
    assert(Array.isArray(body.data.failed) && body.data.failed.some((f: { key: string }) => f.key === 'organism.o1.w.ws.x'), 'organism.* key rejected into failed[]');
});

await test('Bulk write rejects missing entries (400) and no auth (401)', async () => {
    const bad = await json('/v1/memory/bulk', { method: 'POST', headers: auth1(), body: JSON.stringify({}) });
    assert(bad.status === 400, `expected 400, got ${bad.status}`);
    const noauth = await json('/v1/memory/bulk', { method: 'POST', body: JSON.stringify({ entries: [{ key: 'x', value: 1 }] }) });
    assert(noauth.status === 401, `expected 401, got ${noauth.status}`);
});

await test('Bulk write validates storage_ref integrity (dangling ref → failed, parity with single write)', async () => {
    const { body } = await json('/v1/memory/bulk', {
        method: 'POST', headers: auth1(),
        body: JSON.stringify({ entries: [
            { key: 'ref.bad', value: { _type: 'storage_ref', storage_key: 'does/not/exist.bin' } },
            { key: 'ref.ok', value: { plain: true } },
        ] }),
    });
    assert(body.data.created === 1, `expected 1 created, got ${body.data.created}`);
    assert((body.data.failed || []).some((f: { key: string; reason: string }) => f.key === 'ref.bad' && /storage file not found/.test(f.reason)), 'dangling storage_ref rejected');
});

// ═══════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════
console.log('\nCleanup');

await test('Delete test owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `delete owner status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`Memory Full E2E: ${passed} passed, ${failed} failed`);
if (failed > 0) console.log('⚠️  Some tests failed!');
console.log(`${'─'.repeat(40)}\n`);

if (server) server.close();
process.exit(failed > 0 ? 1 : 0);
