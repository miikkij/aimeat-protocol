/**
 * @file package-instance-repository.test.ts
 * @description API-level tests for the PackageInstanceRepository through HTTP endpoints.
 *   Exercises instance lifecycle: install, get, list with filters, component status
 *   with hash comparison, and instance deletion via the /v1/packages/:groupId/install
 *   and /v1/instances routes.
 * @usage
 *   cd aimeat && pnpm exec tsx test/unit/package-instance-repository.test.ts
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
const ownerName = `instrepo${Date.now()}`;

const pkgName = `inst-test-pkg-${Date.now()}`;
let groupId = '';
let encodedGroupId = '';
let firstVersion = '';
let instanceId = '';

console.log('\n=== Package Instance Repository Unit Tests ===\n');

// ─── Setup: Register owner + create & publish a package ──────────────

console.log('Setup — Register owner + create & publish package');

await test('Register test owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
});

await test('Owner auth', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
});

await test('Create and publish a package', async () => {
  // Create
  const { status, body } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      description: 'Package for instance tests',
      category: 'utility',
      tags: ['instance-test'],
      visibility: 'public',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM', content: '{"fields":["name","email"]}', dependencies: [] },
        { id: 'ext-logic', type: 'extension', label: 'Logic Extension', content: 'function validate(){ return true; }', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  firstVersion = body.data.version;
  groupId = body.data.packageGroupId;
  encodedGroupId = encodeURIComponent(groupId);

  // Publish
  const { status: patchStatus } = await json(
    `/v1/packages/${encodedGroupId}/versions/${firstVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'published' }),
    },
  );
  assert(patchStatus === 200, `Publish failed: ${patchStatus}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 1: Install package (POST /v1/packages/:groupId/install)
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Instance Lifecycle');

await test('Install package (POST /v1/packages/:groupId/install)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'My test instance' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.id, 'Missing instance id');
  assert(body.data?.packageGroupId === groupId, `packageGroupId mismatch: ${body.data?.packageGroupId}`);
  assert(body.data?.packageVersion === firstVersion, `version mismatch: ${body.data?.packageVersion}`);
  assert(body.data?.owner === ownerName, `owner mismatch: ${body.data?.owner}`);
  assert(body.data?.label === 'My test instance', `label mismatch: ${body.data?.label}`);
  assert(body.data?.status === 'installed', `Expected status=installed, got ${body.data?.status}`);
  assert(Array.isArray(body.data?.installedComponents), 'Missing installedComponents');
  assert(body.data.installedComponents.length === 2, `Expected 2 installed components, got ${body.data.installedComponents.length}`);

  instanceId = body.data.id;

  // Verify each installed component has required fields
  for (const ic of body.data.installedComponents) {
    assert(typeof ic.componentId === 'string', `Missing componentId`);
    assert(typeof ic.type === 'string', `Missing type for ${ic.componentId}`);
    assert(typeof ic.registeredAs === 'string', `Missing registeredAs for ${ic.componentId}`);
    assert(typeof ic.originalHash === 'string', `Missing originalHash for ${ic.componentId}`);
  }
});

await test('Install draft package should fail with 400', async () => {
  // Create a new draft package (not published)
  const draftPkgName = `draft-pkg-${Date.now()}`;
  const { body: createBody } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: draftPkgName,
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  const draftGroupId = encodeURIComponent(createBody.data.packageGroupId);

  const { status } = await json(`/v1/packages/${draftGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({}),
  });
  assert(status === 400, `Expected 400 for draft install, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Get instance (GET /v1/instances/:id) — verify all fields
// ═══════════════════════════════════════════════════════════════════════

await test('Get instance (GET /v1/instances/:id)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.id === instanceId, `id mismatch`);
  assert(body.data?.packageGroupId === groupId, `packageGroupId mismatch`);
  assert(body.data?.packageVersion === firstVersion, `packageVersion mismatch`);
  assert(body.data?.owner === ownerName, `owner mismatch`);
  assert(body.data?.label === 'My test instance', `label mismatch`);
  assert(body.data?.status === 'installed', `status mismatch`);
  assert(typeof body.data?.installedAt === 'string', 'Missing installedAt');
  assert(typeof body.data?.updatedAt === 'string', 'Missing updatedAt');
  assert(body.data?.installedComponents?.length === 2, `Expected 2 components`);
});

await test('Get non-existent instance returns 404', async () => {
  const { status } = await json('/v1/instances/non-existent-id-xyz', {
    headers: authed(ownerToken),
  });
  assert(status === 404, `Expected 404, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: List instances (GET /v1/instances) — verify filters
// ═══════════════════════════════════════════════════════════════════════

await test('List instances (GET /v1/instances)', async () => {
  const { status, body } = await json('/v1/instances', {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.instances), 'Expected instances array');
  assert(body.data.instances.length >= 1, 'Expected at least 1 instance');
  assert(typeof body.data?.total === 'number', 'Expected total count');

  // Our instance should be in the list
  const found = body.data.instances.find((i: any) => i.id === instanceId);
  assert(found, 'Our instance should be in the list');
});

await test('List instances with packageGroupId filter', async () => {
  const { status, body } = await json(`/v1/instances?packageGroupId=${encodeURIComponent(groupId)}`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data.instances.length >= 1, 'Expected at least 1 instance');
  for (const inst of body.data.instances) {
    assert(inst.packageGroupId === groupId, `Unexpected packageGroupId: ${inst.packageGroupId}`);
  }
});

await test('List instances with status=installed filter', async () => {
  const { status, body } = await json('/v1/instances?status=installed', {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  for (const inst of body.data.instances) {
    assert(inst.status === 'installed', `Unexpected status: ${inst.status}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Test 4: Get component status (GET /v1/instances/:id/status)
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Component Status');

await test('Get component status (GET /v1/instances/:id/status)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/status`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(Array.isArray(body.data?.components), 'Expected components array');
  assert(body.data.components.length === 2, `Expected 2 components, got ${body.data.components.length}`);

  for (const comp of body.data.components) {
    assert(typeof comp.componentId === 'string', 'Missing componentId');
    assert(typeof comp.type === 'string', 'Missing type');
    assert(typeof comp.registeredAs === 'string', 'Missing registeredAs');
    assert(typeof comp.status === 'string', 'Missing status');
    assert(typeof comp.originalHash === 'string', 'Missing originalHash');
    // currentHash may be null if component is missing, or a string if active
    if (comp.status === 'active') {
      assert(typeof comp.currentHash === 'string', `Missing currentHash for active component ${comp.componentId}`);
    }
  }
});

await test('Component status for non-existent instance returns 404', async () => {
  const { status } = await json('/v1/instances/non-existent-id-xyz/status', {
    headers: authed(ownerToken),
  });
  assert(status === 404, `Expected 404, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 5: Delete instance (DELETE /v1/instances/:id) — verify cleanup
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Instance Deletion');

// Install a second instance to delete (keep the first for verification)
let secondInstanceId = '';

await test('Install second instance for deletion test', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'Instance to delete' }),
  });
  assert(status === 201, `Expected 201, got ${status}`);
  secondInstanceId = body.data.id;
});

await test('Delete instance with component cleanup (DELETE /v1/instances/:id)', async () => {
  const { status, body } = await json(`/v1/instances/${secondInstanceId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
    body: JSON.stringify({ removeComponents: true }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.removed === true, 'Expected removed=true');
  assert(body.data?.id === secondInstanceId, 'Id mismatch in delete response');
  assert(typeof body.data?.componentsRemoved === 'number', 'Expected componentsRemoved count');
  assert(body.data.componentsRemoved >= 0, 'componentsRemoved should be >= 0');
});

await test('Deleted instance returns 404', async () => {
  const { status } = await json(`/v1/instances/${secondInstanceId}`, {
    headers: authed(ownerToken),
  });
  assert(status === 404, `Expected 404, got ${status}`);
});

await test('Delete first instance without component cleanup', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
    body: JSON.stringify({}),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.removed === true, 'Expected removed=true');
  // Without removeComponents, there should be no componentsRemoved field
  assert(body.data?.componentsRemoved === undefined, 'Should not have componentsRemoved without removeComponents flag');
});

await test('List instances after deletion shows fewer results', async () => {
  const { status, body } = await json(`/v1/instances?packageGroupId=${encodeURIComponent(groupId)}`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  // Both instances deleted — should be 0 for this package
  const found = body.data.instances.filter((i: any) => i.packageGroupId === groupId);
  assert(found.length === 0, `Expected 0 instances for this package, got ${found.length}`);
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

console.log(`\n=== Package Instance Repository: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
