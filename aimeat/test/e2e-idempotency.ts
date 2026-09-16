/**
 * @file test/e2e-idempotency.ts
 * @description Same-key writes through the full node, verified in persistent storage on both backends.
 * @version-history v1.0.0 -- 2026-09-16 -- Complements deterministic slow-handler unit coverage.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as ed from '@noble/ed25519';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `idem-${Date.now()}`;
let token = '';
let passed = 0, failed = 0;
ed.hashes.sha512 = (message: Uint8Array) => new Uint8Array(createHash('sha512').update(message).digest());

async function json(path: string, method = 'GET', body?: unknown, key?: string, authToken = token) {
    const response = await fetch(BASE + path, {
        method, headers: { 'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            ...(key ? { 'Idempotency-Key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
}
async function test(name: string, run: () => Promise<void>) {
    try { await run(); passed++; console.log(`  PASS ${name}`); }
    catch (error) { failed++; console.error(`  FAIL ${name}: ${(error as Error).message}`); }
}

await test('register and authenticate an isolated owner', async () => {
    const registered = await json('/v1/owners', 'POST', { name: owner, public_key: 'placeholder' });
    assert.equal(registered.status, 201);
    const timestamp = new Date().toISOString();
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + timestamp),
        Buffer.from(registered.body.data.private_key, 'base64'))).toString('base64');
    const login = await json('/v1/auth/token', 'POST', { owner, timestamp, signature });
    assert.equal(login.body.ok, true);
    token = login.body.data.token;
});

const replayKey = randomUUID();
await test('five concurrent keyed POSTs create exactly one stored version', async () => {
    const requests = await Promise.all(Array.from({ length: 5 }, () => json('/v1/memory', 'POST',
        { key: 'one-write', value: 'original', visibility: 'private' }, replayKey)));
    assert.ok(requests.some(result => result.status === 201));
    for (const result of requests) {
        if (result.status === 409) assert.equal(result.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
        else { assert.equal(result.status, 201); assert.equal(result.body.data.version, 1); }
    }
    const stored = await json('/v1/memory/one-write');
    assert.equal(stored.body.data.version, 1);
    assert.equal(stored.body.data.value, 'original');
});

await test('a replay returns the first answer without another stored version', async () => {
    const replay = await json('/v1/memory', 'POST', { key: 'one-write', value: 'must not land' }, replayKey);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.data.version, 1);
    assert.equal((await json('/v1/memory/one-write')).body.data.value, 'original');
});

await test('a fresh key allows a deliberate second write', async () => {
    const updated = await json('/v1/memory', 'POST', { key: 'one-write', value: 'changed' }, randomUUID());
    assert.equal(updated.body.ok, true);
    const stored = await json('/v1/memory/one-write');
    assert.equal(stored.body.data.version, 2);
    assert.equal(stored.body.data.value, 'changed');
});

await test('an invalid key fails before the write and carries an error envelope', async () => {
    const refused = await json('/v1/memory', 'POST', { key: 'invalid-key', value: 'must not land' }, 'bad-key');
    assert.equal(refused.status, 400);
    assert.equal(refused.body.ok, false);
    assert.equal(refused.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal((await json('/v1/memory/invalid-key')).status, 404);
});

await test('another owner cannot replay the first owner response or write into its namespace', async () => {
    const other = `${owner}-b`;
    const registered = await json('/v1/owners', 'POST', { name: other, public_key: 'placeholder' });
    assert.equal(registered.status, 201);
    const timestamp = new Date().toISOString();
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(other + NODE_ID + timestamp),
        Buffer.from(registered.body.data.private_key, 'base64'))).toString('base64');
    const login = await json('/v1/auth/token', 'POST', { owner: other, timestamp, signature });
    const otherToken = login.body.data.token;
    try {
        const refused = await json('/v1/memory', 'POST',
            { key: 'one-write', value: 'intrusion', agent: `${owner}@${NODE_ID}` }, replayKey, otherToken);
        assert(refused.status === 403, `another owner must be refused: ${JSON.stringify(refused)}`);
        const own = await json('/v1/memory', 'POST', { key: 'one-write', value: 'other owner' }, randomUUID(), otherToken);
        assert.equal(own.status, 201);
        assert.equal((await json('/v1/memory/one-write')).body.data.value, 'changed');
    } finally {
        assert.equal((await json(`/v1/owners/${other}`, 'DELETE', undefined, undefined, otherToken)).body.ok, true);
    }
});

await test('a read-only agent cannot reuse the owner key to bypass its write scope', async () => {
    const created = await json('/v1/agents', 'POST', { name: 'idem-reader', owner, capabilities: ['memory'], model: 'test' });
    assert.equal(created.status, 201);
    const scoped = await json('/v1/agents/idem-reader/scopes', 'PATCH', { scopes: ['memory:read'] });
    assert.equal(scoped.status, 200);
    const gaii = created.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + timestamp),
        Buffer.from(created.body.data.private_key, 'base64'))).toString('base64');
    const login = await json('/v1/auth/token', 'POST', { gaii, timestamp, signature });
    const refused = await json('/v1/memory', 'POST', { key: 'one-write', value: 'intrusion' }, replayKey, login.body.data.token);
    assert(refused.status === 403, `read-only agent must be refused: ${JSON.stringify(refused)}`);
    assert.equal((await json('/v1/memory/one-write')).body.data.value, 'changed');
});

await test('cleanup owner and its stored records', async () => {
    assert.equal((await json(`/v1/owners/${owner}`, 'DELETE')).body.ok, true);
});
console.log(`\n=== Idempotency E2E Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
