/**
 * @file package-repository.test.ts
 * @description API-level tests for the PackageRepository through HTTP endpoints.
 *   Exercises package CRUD, versioning, metadata updates, archiving, uniqueness
 *   constraints, and listing filters via the /v1/packages routes.
 * @usage
 *   cd aimeat && pnpm exec tsx test/unit/package-repository.test.ts
 *   Requires: server running on port 40251
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial test suite
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  \u2705 ${name}`); }
  catch (err: any) { failed++; console.error(`  \u274C ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── State ───────────────────────────────────────────────────────────

let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `pkgrepo${Date.now()}`;

const pkgName = `repo-test-pkg-${Date.now()}`;
let groupId = '';
let encodedGroupId = '';
let firstVersion = '';
let secondVersion = '';

console.log('\n=== Package Repository Unit Tests ===\n');

// ─── Setup: Register owner ──────────────────────────────────────────

console.log('Setup — Register owner');

await test('Register test owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth — sign + token', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);

  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 1: Create a package via POST /v1/packages
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Package CRUD');

await test('Create package (POST /v1/packages)', async () => {
  const { status, body } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      description: 'A repository test package',
      category: 'utility',
      tags: ['repo-test', 'unit'],
      visibility: 'public',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM', content: '{"fields":[]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper', content: 'function helper(){}', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.id, 'Missing id');
  assert(body.data?.packageGroupId, 'Missing packageGroupId');
  assert(body.data?.status === 'draft', `Expected status=draft, got ${body.data?.status}`);
  assert(body.data?.name === pkgName, `Expected name=${pkgName}, got ${body.data?.name}`);
  assert(body.data?.author === ownerName, `Expected author=${ownerName}, got ${body.data?.author}`);
  assert(body.data?.components?.length === 2, `Expected 2 components, got ${body.data?.components?.length}`);

  firstVersion = body.data.version;
  groupId = body.data.packageGroupId;
  encodedGroupId = encodeURIComponent(groupId);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Verify getPackage returns correct data (GET /v1/packages/:groupId)
// ═══════════════════════════════════════════════════════════════════════

await test('Publish first version', async () => {
  const { status, body } = await json(
    `/v1/packages/${encodedGroupId}/versions/${firstVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'published' }),
    },
  );
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.status === 'published', `Expected published, got ${body.data?.status}`);
});

await test('Get package returns correct data (GET /v1/packages/:groupId)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packageGroupId === groupId, `groupId mismatch: ${body.data?.packageGroupId}`);
  assert(body.data?.version === firstVersion, `version mismatch: ${body.data?.version}`);
  assert(body.data?.name === pkgName, `name mismatch: ${body.data?.name}`);
  assert(body.data?.description === 'A repository test package', `description mismatch`);
  assert(body.data?.category === 'utility', `category mismatch`);
  assert(Array.isArray(body.data?.tags) && body.data.tags.includes('repo-test'), 'tags mismatch');
  assert(body.data?.components?.length === 2, `Expected 2 components, got ${body.data?.components?.length}`);
  // Verify component content hashes exist
  for (const comp of body.data.components) {
    assert(typeof comp.contentHash === 'string' && comp.contentHash.length > 0, `Missing contentHash for ${comp.id}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: Create a second version
// ═══════════════════════════════════════════════════════════════════════

await test('Create second version (POST /v1/packages/:groupId/versions)', async () => {
  // Wait to ensure different version timestamp
  await new Promise(r => setTimeout(r, 1100));

  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      changelog: 'Added new field',
      status: 'published',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM v2', content: '{"fields":["name"]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper v2', content: 'function helper(){ return true; }', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  secondVersion = body.data.version;
  assert(secondVersion !== firstVersion, `Versions should differ: ${secondVersion} vs ${firstVersion}`);
  assert(body.data?.changelog === 'Added new field', 'Changelog mismatch');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 4: List versions — verify count and order
// ═══════════════════════════════════════════════════════════════════════

await test('List versions (GET /v1/packages/:groupId/versions) — verify count and order', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.versions?.length >= 2, `Expected >= 2 versions, got ${body.data?.versions?.length}`);

  // Verify both versions exist
  const versions = body.data.versions.map((v: any) => v.version);
  assert(versions.includes(firstVersion), `Should contain first version ${firstVersion}`);
  assert(versions.includes(secondVersion), `Should contain second version ${secondVersion}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 5: Update metadata (PATCH /v1/packages/:groupId)
// ═══════════════════════════════════════════════════════════════════════

await test('Update group metadata (PATCH /v1/packages/:groupId)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({
      description: 'Updated description',
      tags: ['repo-test', 'unit', 'updated'],
    }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.description === 'Updated description', `Description not updated: ${body.data?.description}`);
  assert(body.data?.tags?.includes('updated'), 'Tags not updated');
});

await test('Verify metadata propagated to all versions', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.description === 'Updated description', 'Description not propagated to first version');
  assert(body.data?.tags?.includes('updated'), 'Tags not propagated to first version');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 6: Archive a version (DELETE /v1/packages/:groupId/versions/:version)
// ═══════════════════════════════════════════════════════════════════════

await test('Archive first version (DELETE /v1/packages/:groupId/versions/:version)', async () => {
  const { status, body } = await json(
    `/v1/packages/${encodedGroupId}/versions/${firstVersion}`,
    {
      method: 'DELETE',
      headers: authed(ownerToken),
    },
  );
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.archived === true, 'Expected archived=true');
});

await test('Archived version status is archived', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.status === 'archived', `Expected archived status, got ${body.data?.status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 7: UNIQUE constraint — same name + author should fail with 409
// ═══════════════════════════════════════════════════════════════════════

await test('UNIQUE constraint: same package name for same author returns 409', async () => {
  const { status } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  assert(status === 409, `Expected 409, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 8: Listing with filters — ?author=, ?status=, ?category=
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Listing Filters');

await test('Filter by author', async () => {
  const { status, body } = await json(`/v1/packages?author=${ownerName}&status=published`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.packages), 'Expected packages array');
  // Our package should appear (second version is published)
  const found = body.data.packages.find((p: any) => p.packageGroupId === groupId);
  assert(found, 'Package should appear with author filter');
  // All results should be by this author
  for (const p of body.data.packages) {
    assert(p.author === ownerName, `Unexpected author: ${p.author}`);
  }
});

await test('Filter by status=draft shows no published packages', async () => {
  const { status, body } = await json(`/v1/packages?author=${ownerName}&status=draft`);
  assert(status === 200, `Expected 200, got ${status}`);
  // None of the results should be published
  for (const p of body.data.packages) {
    assert(p.status !== 'published', `Found published package in draft filter: ${p.name}`);
  }
});

await test('Filter by category=utility', async () => {
  const { status, body } = await json(`/v1/packages?category=utility&status=published`);
  assert(status === 200, `Expected 200, got ${status}`);
  for (const p of body.data.packages) {
    assert(p.category === 'utility', `Unexpected category: ${p.category}`);
  }
});

await test('Filter by non-existent category returns empty', async () => {
  const { status, body } = await json('/v1/packages?category=nonexistent-cat-xyz');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packages?.length === 0, `Expected 0 packages, got ${body.data?.packages?.length}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Cleanup: cascade delete owner
// ═══════════════════════════════════════════════════════════════════════

console.log('\nCleanup');

await test('Cascade delete owner', async () => {
  const { status } = await json(`/v1/owners/${ownerName}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
});

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n=== Package Repository: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
