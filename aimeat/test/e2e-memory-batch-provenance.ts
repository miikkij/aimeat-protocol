/**
 * @file e2e-memory-batch-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Real HTTP batch writes and backup restores preserve provenance and per-item guards.
 * @version-history 1.0.0 2026-09-27 Added without changing existing E2E expectations.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${String(error)}`); }
}
async function json(path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  // Runtime assertions below validate the HTTP contract at this untyped JSON boundary.
  return { status: response.status, body: await response.json() as Record<string, any> };
}
async function login(identity: string, privateKey: string, isAgent = false): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = identity + (isAgent ? '' : NODE) + timestamp;
  const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKey, 'base64'))).toString('base64');
  const result = await json('/v1/auth/token', undefined, { ...(isAgent ? { gaii: identity } : { owner: identity }), timestamp, signature });
  assert.equal(result.status, 200);
  return result.body.data.token;
}
const owner = `batchprov${Date.now()}`;
const registered = await json('/v1/ghii', undefined, { username: owner, display_name: owner, password: 'BatchProvenance1234' });
assert.equal(registered.status, 201);
const ownerToken = await login(owner, registered.body.data.private_key);
const agent = await json('/v1/agents', ownerToken, { owner, name: 'writer', capabilities: ['memory'], scopes: ['memory:read', 'memory:write', 'memory:delete'] });
assert.equal(agent.status, 201);
const gaii = agent.body.data.agent.gaii as string;
const token = await login(gaii, agent.body.data.private_key, true);
const read = (key: string) => json(`/v1/memory/${encodeURIComponent(key)}`, token);
const value = { text: 'The original content' };
let provenanceId = '';

try {
  await test('a read-only agent cannot import or bulk-write, and no value lands', async () => {
    const reader = await json('/v1/agents', ownerToken, {
      owner, name: 'reader', capabilities: ['memory'], scopes: ['memory:read'],
    });
    assert.equal(reader.status, 201);
    const readerToken = await login(reader.body.data.agent.gaii, reader.body.data.private_key, true);
    for (const path of ['/v1/memory/bulk', '/v1/memory/import']) {
      const refused = await json(path, readerToken, { entries: [{ key: 'batch.denied', value }] });
      assert(refused.status === 403, 'memory:read cannot authorize a batch write');
    }
    assert.equal((await json('/v1/memory/batch.denied', readerToken)).status, 404);
  });
  await test('single-write control carries a provenance record', async () => {
    assert.equal((await json('/v1/memory', token, { key: 'batch.source', value })).status, 201);
    const source = await read('batch.source');
    assert.equal(source.status, 200);
    provenanceId = source.body.meta?.provenance?.id;
    assert.ok(provenanceId);
  });
  await test('bulk stamps each accepted write, with no write for a protected entry', async () => {
    const result = await json('/v1/memory/bulk', token, { entries: [
      { key: 'batch.created', value }, { key: '__redirect__', value: { to: 'elsewhere' } },
    ] });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.created, 1);
    const saved = await read('batch.created');
    assert.deepEqual(saved.body.data.value, value);
    assert.ok(saved.body.meta?.provenance?.id, 'batch content has provenance');
    assert.equal((await read('__redirect__')).status, 404);
  });
  await test('export carries the source provenance handle', async () => {
    assert.ok(provenanceId, 'positive control produced a source handle');
    const result = await json('/v1/memory/export?prefix=batch.source', token);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.entries[0].ai_provenance_id, provenanceId);
  });
  await test('restore keeps verified source provenance instead of assigning the importer as creator', async () => {
    assert.ok(provenanceId, 'positive control produced a source handle');
    const result = await json('/v1/memory/import', token, {
      mode: 'overwrite', entries: [{ key: 'batch.restored', value, ai_provenance_id: provenanceId }],
    });
    assert.equal(result.status, 200);
    const saved = await read('batch.restored');
    assert.equal(saved.body.meta?.provenance?.id, provenanceId);
    assert.deepEqual(saved.body.data.value, value);
  });
  await test('restore cannot use a source handle for different content', async () => {
    await json('/v1/memory/import', token, { entries: [
      { key: 'batch.changed', value: { different: true }, ai_provenance_id: provenanceId },
    ] });
    const saved = await read('batch.changed');
    assert.equal(saved.status, 200);
    assert.ok(!saved.body.meta?.provenance?.id, 'unknown source remains unknown');
  });
  await test('one broken storage reference fails without cancelling a valid restored entry', async () => {
    const result = await json('/v1/memory/import', token, { entries: [
      { key: 'batch.badref', value: { _type: 'storage_ref', storage_key: 'missing-file' } },
      { key: 'batch.valid', value: { restored: true } },
    ] });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.created, 1);
    assert.equal(result.body.data.failed.length, 1);
    assert.equal((await read('batch.badref')).status, 404);
    assert.equal((await read('batch.valid')).status, 200);
  });
  await test('another account cannot publish the source provenance by importing its handle', async () => {
    const name = `batchother${Date.now()}`;
    const registration = await json('/v1/ghii', undefined, { username: name, display_name: name, password: 'BatchProvenance1234' });
    assert.equal(registration.status, 201);
    const otherToken = await login(name, registration.body.data.private_key);
    try {
      const result = await json('/v1/memory/import', otherToken, { entries: [
        { key: 'batch.foreign', value, visibility: 'public', ai_provenance_id: provenanceId },
      ] });
      assert.equal(result.status, 200);
      const saved = await json('/v1/memory/batch.foreign', otherToken);
      assert.equal(saved.status, 200);
      assert.ok(!saved.body.meta?.provenance?.id);
    } finally {
      assert.equal((await json(`/v1/owners/${name}`, otherToken, undefined, 'DELETE')).status, 200);
    }
  });
  await test('restore cannot create new records inside an archived organism', async () => {
    const created = await json('/v1/organisms', ownerToken, {
      name: 'Batch archive test', description: 'Isolated test', type: 'project',
      join_policy: 'approval_required', visibility: 'private',
    });
    assert.equal(created.status, 201);
    const id = created.body.data.organism.id as string;
    const key = `organism.${id}.audit.restored`;
    const archived = await json(`/v1/organisms/${id}/archive`, ownerToken, { level: 'organism' });
    assert.equal(archived.status, 200);
    const single = await json('/v1/memory', ownerToken, { key, value });
    assert.equal(single.body.error?.code, 'ARCHIVED', 'the ordinary write confirms the archive guard');
    const result = await json('/v1/memory/import', ownerToken, { entries: [{ key, value }] });
    assert.equal(result.body.data.created, 0);
    assert.equal(result.body.data.failed.length, 1);
    assert.match(result.body.data.failed[0].reason, /ARCHIVED/);
    assert.equal((await json(`/v1/memory/${encodeURIComponent(key)}`, ownerToken)).status, 404);
  });
} finally {
  await test('cleanup removes the test owner', async () => {
    assert.equal((await json(`/v1/owners/${owner}`, ownerToken, undefined, 'DELETE')).status, 200);
  });
}
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exitCode = failed ? 1 : 0;
