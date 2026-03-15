/**
 * @file e2e-packages.ts
 * @description E2E tests for the Packages, Templates & Instances system.
 *   Covers package CRUD, versioning, export/import, instance lifecycle,
 *   migration workflows, template gallery, reviews, discussions, and auth checks.
 * @structure
 *   - Phase 1: Package CRUD
 *   - Phase 2: Versioning
 *   - Phase 3: Package Metadata
 *   - Phase 4: Instance Lifecycle
 *   - Phase 5: Migration
 *   - Phase 6: Template Gallery
 *   - Phase 7: Auth & Validation
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial test suite
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-packages.ts
// Requires: server running on port 40251

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
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

/** Helper: make authed request with a given token */
function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── State ───────────────────────────────────────────────────────────

let ownerToken = '';
let ownerPrivKey = '';
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `pkgtest${Date.now()}`;
const agentName = 'pkgagent';

// Second owner for auth tests (Phase 7)
let owner2Token = '';
let owner2PrivKey = '';
const owner2Name = `pkgtest2${Date.now()}`;

// IDs captured during tests
const pkgName = 'test-widget-pack';
let groupId = ''; // {name}::{author}
let encodedGroupId = '';
let firstVersionId = '';
let firstVersion = '';
let secondVersionId = '';
let secondVersion = '';
let instanceId = '';
let listingId = '';
let reviewId = '';
let discussionId = '';

console.log('\n=== Packages, Templates & Instances E2E Tests ===\n');

// ─── Setup: Register owner + agent ──────────────────────────────────

console.log('Setup — Register owner + agent');

await test('Register test owner (first = operator)', async () => {
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

await test('Register test agent', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: agentName,
      owner: ownerName,
      capabilities: ['memory'],
      model: 'test-model',
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;
  agentPrivKey = body.data.private_key;
  assert(typeof agentPrivKey === 'string', 'got agent private key');
});

await test('Agent auth — sign + token', async () => {
  const timestamp = new Date().toISOString();
  const message = agentGaii + timestamp;
  const signature = await signMsg(agentPrivKey, message);

  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
  });
  assert(body.ok === true, `agent token ok: ${JSON.stringify(body.error)}`);
  agentToken = body.data?.token;
  assert(typeof agentToken === 'string', 'got agent token');
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 1: Package CRUD
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 1 — Package CRUD');

await test('Create package (POST /v1/bundles)', async () => {
  const { status, body } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      description: 'A test widget package',
      category: 'utility',
      tags: ['test', 'widget'],
      visibility: 'public',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM', content: '{"fields":[]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension', content: 'function helper(){}', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.id, 'Missing id');
  assert(body.data?.packageGroupId, 'Missing packageGroupId');
  assert(body.data?.status === 'draft', `Expected status=draft, got ${body.data?.status}`);

  firstVersionId = body.data.id;
  firstVersion = body.data.version;
  groupId = body.data.packageGroupId;
  encodedGroupId = encodeURIComponent(groupId);
});

await test('Validation: missing name returns 400', async () => {
  const { status } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ components: [{ id: 'x', type: 'csm', content: '{}' }] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Validation: missing components returns 400', async () => {
  const { status } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ name: 'no-comps' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Validation: empty components array returns 400', async () => {
  const { status } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ name: 'empty-comps', components: [] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Duplicate package name returns 409', async () => {
  const { status } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  assert(status === 409, `Expected 409, got ${status}`);
});

await test('List packages (GET /v1/bundles) — default filters show published+public only', async () => {
  // Our package is draft, so it should NOT appear in the default listing
  const { status, body } = await json('/v1/bundles');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.packages), 'Expected packages array');
  const found = body.data.packages.find((p: any) => p.packageGroupId === groupId);
  assert(!found, 'Draft package should not appear in default public listing');
});

await test('List packages with status=draft shows our package', async () => {
  const { status, body } = await json(`/v1/bundles?status=draft&author=${ownerName}`);
  assert(status === 200, `Expected 200, got ${status}`);
  const found = body.data.packages.find((p: any) => p.packageGroupId === groupId);
  assert(found, 'Draft package should appear when filtering by status=draft + author');
});

await test('Import package via POST /v1/bundles/import', async () => {
  const { status, body } = await json('/v1/bundles/import', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: 'imported-pack',
      description: 'An imported package',
      category: 'theme',
      tags: ['imported'],
      visibility: 'public',
      status: 'published',
      changelog: 'Initial import',
      components: [
        { id: 'theme-main', type: 'csm', label: 'Theme CSM', content: '{"theme":true}' },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.name === 'imported-pack', 'Name mismatch');
  assert(body.data?.status === 'published', 'Imported package should be published');
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Versioning
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 2 — Versioning');

await test('Publish first version (PATCH status to published)', async () => {
  const { status, body } = await json(
    `/v1/bundles/${encodedGroupId}/versions/${firstVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'published' }),
    },
  );
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.status === 'published', `Expected published, got ${body.data?.status}`);
});

await test('Get latest published (GET /v1/bundles/:groupId)', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packageGroupId === groupId, 'groupId mismatch');
  assert(body.data?.version === firstVersion, `version mismatch: expected ${firstVersion}, got ${body.data?.version}`);
  assert(body.data?.status === 'published', 'Expected published status');
});

await test('Publish new version (POST /v1/bundles/:groupId/versions)', async () => {
  // Wait 1s to ensure different version timestamp
  await new Promise(r => setTimeout(r, 1100));

  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      changelog: 'Added new component',
      status: 'draft',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM v2', content: '{"fields":["name"]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension v2', content: 'function helper(){ return true; }', dependencies: ['csm-main'] },
        { id: 'app-ui', type: 'app', label: 'UI App', content: '<div>hello</div>', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  secondVersionId = body.data.id;
  secondVersion = body.data.version;
  assert(secondVersion !== firstVersion, `New version should differ: ${secondVersion} vs ${firstVersion}`);
});

await test('List all versions (GET /v1/bundles/:groupId/versions)', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/versions`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.versions?.length >= 2, `Expected >= 2 versions, got ${body.data?.versions?.length}`);
});

await test('Get specific version (GET /v1/bundles/:groupId/versions/:version)', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.version === firstVersion, 'Version mismatch');
  assert(body.data?.components?.length === 2, `Expected 2 components in v1, got ${body.data?.components?.length}`);
});

await test('Publish second version', async () => {
  const { status, body } = await json(
    `/v1/bundles/${encodedGroupId}/versions/${secondVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'published' }),
    },
  );
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.status === 'published', 'Expected published');
});

await test('Latest now points to second version', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.version === secondVersion, `Expected ${secondVersion}, got ${body.data?.version}`);
  assert(body.data?.components?.length === 3, `Expected 3 components in v2, got ${body.data?.components?.length}`);
});

await test('Export package (GET /v1/bundles/:groupId/export)', async () => {
  const { status, body, headers } = await json(`/v1/bundles/${encodedGroupId}/export`);
  assert(status === 200, `Expected 200, got ${status}`);
  const ct = headers.get('content-type') ?? '';
  assert(ct.includes('text/yaml'), `Expected text/yaml, got ${ct}`);
  // Body is JSON stringified in text/yaml — parse it
  const parsed = typeof body === 'object' && body._raw ? JSON.parse(body._raw) : body;
  assert(parsed.packageGroupId === groupId, 'Export groupId mismatch');
});

await test('Archive first version (DELETE /v1/bundles/:groupId/versions/:version)', async () => {
  const { status, body } = await json(
    `/v1/bundles/${encodedGroupId}/versions/${firstVersion}`,
    { method: 'DELETE', headers: authed(ownerToken) },
  );
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.archived === true, 'Expected archived=true');
});

await test('Archived version status is archived', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.status === 'archived', `Expected archived, got ${body.data?.status}`);
});

await test('Invalid status returns 400', async () => {
  const { status } = await json(
    `/v1/bundles/${encodedGroupId}/versions/${secondVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'banana' }),
    },
  );
  assert(status === 400, `Expected 400, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: Package Metadata
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 3 — Package Metadata');

await test('Update group metadata (PATCH /v1/bundles/:groupId)', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({
      description: 'Updated description',
      tags: ['updated', 'widget', 'v2'],
      visibility: 'public',
    }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.description === 'Updated description', 'Description not updated');
  assert(body.data?.tags?.includes('updated'), 'Tags not updated');
});

await test('Metadata change applies to all versions', async () => {
  // Check v2 (the non-archived one)
  const { body } = await json(`/v1/bundles/${encodedGroupId}/versions/${secondVersion}`);
  assert(body.data?.description === 'Updated description', 'v2 description not updated');
});

await test('Invalid visibility returns 400', async () => {
  const { status } = await json(`/v1/bundles/${encodedGroupId}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ visibility: 'secret' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 4: Instance Lifecycle
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 4 — Instance Lifecycle');

await test('Install package (POST /v1/bundles/:groupId/install)', async () => {
  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'My Widget Instance' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.id, 'Missing instance id');
  assert(body.data?.packageGroupId === groupId, 'groupId mismatch');
  assert(body.data?.packageVersion === secondVersion, `version mismatch: expected ${secondVersion}`);
  assert(body.data?.label === 'My Widget Instance', 'Label mismatch');
  assert(body.data?.status === 'active', 'Expected active status');
  assert(Array.isArray(body.data?.installedComponents), 'Missing installedComponents');
  assert(body.data?.installedComponents.length === 3, `Expected 3 installed components, got ${body.data?.installedComponents.length}`);
  instanceId = body.data.id;
});

await test('Cannot install draft package', async () => {
  // Create a draft-only package to test against
  const { body: draftPkg } = await json('/v1/bundles', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: 'draft-only-pkg',
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  const draftGroupId = encodeURIComponent(draftPkg.data.packageGroupId);
  const { status } = await json(`/v1/bundles/${draftGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({}),
  });
  // 404 is correct: getLatestPublished returns null for draft-only packages
  assert(status === 404 || status === 400, `Expected 404 or 400 for draft install, got ${status}`);
});

await test('List instances (GET /v1/instances)', async () => {
  const { status, body } = await json('/v1/instances', {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.instances?.length >= 1, 'Expected at least 1 instance');
  const found = body.data.instances.find((i: any) => i.id === instanceId);
  assert(found, 'Created instance not in list');
});

await test('List instances with filter (packageGroupId)', async () => {
  const { status, body } = await json(`/v1/instances?packageGroupId=${encodeURIComponent(groupId)}`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.instances?.length >= 1, 'Expected at least 1 filtered instance');
});

await test('Get instance (GET /v1/instances/:id)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.id === instanceId, 'Instance id mismatch');
  assert(body.data?.label === 'My Widget Instance', 'Label mismatch');
});

await test('Component status (GET /v1/instances/:id/status)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/status`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.components), 'Expected components array');
  assert(body.data.components.length === 3, `Expected 3 components, got ${body.data.components.length}`);
  // None should be customized yet
  const customized = body.data.components.filter((c: any) => c.customized);
  assert(customized.length === 0, 'No components should be customized yet');
});

await test('Delete instance (DELETE /v1/instances/:id)', async () => {
  // Create a throwaway instance to delete
  const { body: inst } = await json(`/v1/bundles/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'To be deleted' }),
  });
  const delId = inst.data.id;

  const { status, body } = await json(`/v1/instances/${delId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.removed === true, 'Expected removed=true');

  // Verify it's gone
  const { status: getStatus } = await json(`/v1/instances/${delId}`, {
    headers: authed(ownerToken),
  });
  assert(getStatus === 404, `Expected 404 after delete, got ${getStatus}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 5: Migration
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 5 — Migration');

// Create a v3 with changed and new components for migration testing
let thirdVersion = '';

await test('Create v3 with changed components', async () => {
  await new Promise(r => setTimeout(r, 1100));

  const { status, body } = await json(`/v1/bundles/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      changelog: 'Breaking change in csm-main, new component added',
      status: 'published',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM v3', content: '{"fields":["name","email","phone"]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension v3', content: 'function helper(){ return {v:3}; }', dependencies: ['csm-main'] },
        { id: 'app-ui', type: 'app', label: 'UI App v3', content: '<div>hello v3</div>', dependencies: ['csm-main'] },
        { id: 'cortex-ai', type: 'cortex', label: 'AI Cortex', content: 'cortex config here', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  thirdVersion = body.data.version;
});

await test('Check for updates (GET /v1/instances/:id/check-update)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/check-update`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.updateAvailable === true, 'Expected updateAvailable=true');
  assert(body.data?.currentVersion === secondVersion, `currentVersion mismatch: ${body.data?.currentVersion}`);
  assert(body.data?.latestVersion === thirdVersion, `latestVersion mismatch: ${body.data?.latestVersion}`);
  assert(Array.isArray(body.data?.componentDiffs), 'Expected componentDiffs array');

  // csm-main and ext-helper and app-ui should show updated (content changed)
  const updated = body.data.componentDiffs.filter((d: any) => d.status === 'updated');
  assert(updated.length >= 2, `Expected at least 2 updated components, got ${updated.length}`);

  // cortex-ai should show as new
  const newComps = body.data.componentDiffs.filter((d: any) => d.status === 'new');
  assert(newComps.length === 1, `Expected 1 new component, got ${newComps.length}`);
  assert(newComps[0].componentId === 'cortex-ai', 'New component should be cortex-ai');
});

await test('Generate migration prompt (POST /v1/instances/:id/migration-prompt)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/migration-prompt`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ components: ['csm-main', 'ext-helper'] }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(typeof body.data?.analyzePrompt === 'string', 'Expected analyzePrompt string');
  assert(typeof body.data?.migratePrompt === 'string', 'Expected migratePrompt string');
  assert(body.data.analyzePrompt.includes('csm-main'), 'analyzePrompt should mention csm-main');
  assert(body.data.migratePrompt.includes('ext-helper'), 'migratePrompt should mention ext-helper');
});

await test('Migration prompt with empty components returns 400', async () => {
  const { status } = await json(`/v1/instances/${instanceId}/migration-prompt`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ components: [] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Apply migration (POST /v1/instances/:id/apply-migration)', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/apply-migration`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      targetVersion: thirdVersion,
      components: [
        { componentId: 'csm-main', action: 'replace' },
        { componentId: 'ext-helper', action: 'skip' },
        { componentId: 'app-ui', action: 'custom', content: '<div>custom merged content</div>' },
        { componentId: 'cortex-ai', action: 'install_new' },
      ],
    }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.migrated === true, 'Expected migrated=true');
  assert(body.data?.updatedComponents?.includes('csm-main'), 'csm-main should be updated');
  assert(body.data?.skippedComponents?.includes('ext-helper'), 'ext-helper should be skipped');
  assert(body.data?.updatedComponents?.includes('app-ui'), 'app-ui should be updated (custom)');
  assert(body.data?.newComponents?.includes('cortex-ai'), 'cortex-ai should be new');
  assert(body.data?.newVersion === thirdVersion, `newVersion mismatch: ${body.data?.newVersion}`);
});

await test('Instance now at v3 — check-update shows no update', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/check-update`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.updateAvailable === false, 'Expected no update available after migration');
});

await test('Apply migration with missing targetVersion returns 400', async () => {
  const { status } = await json(`/v1/instances/${instanceId}/apply-migration`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ components: [{ componentId: 'csm-main', action: 'replace' }] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Apply migration with invalid action returns 400', async () => {
  const { status } = await json(`/v1/instances/${instanceId}/apply-migration`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      targetVersion: thirdVersion,
      components: [{ componentId: 'csm-main', action: 'explode' }],
    }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 6: Template Gallery
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 6 — Template Gallery');

await test('Create template listing (POST /v1/templates)', async () => {
  const { status, body } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      packageGroupId: groupId,
      title: 'Awesome Widget Template',
      description: 'A wonderful template for widgets',
      screenshots: ['https://example.com/shot1.png'],
      category: 'utility',
      tags: ['widget', 'awesome'],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.id, 'Missing listing id');
  assert(body.data.listing.title === 'Awesome Widget Template', 'Title mismatch');
  assert(body.data.listing.installCount === 0, 'Initial installCount should be 0');
  assert(body.data.listing.rating === 0, 'Initial rating should be 0');
  listingId = body.data.listing.id;
});

await test('Validation: missing title returns 400', async () => {
  const { status } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      packageGroupId: groupId,
      description: 'no title',
    }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Validation: missing packageGroupId returns 400', async () => {
  const { status } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      title: 'No package',
      description: 'missing',
    }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Duplicate listing returns 409', async () => {
  const { status } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      packageGroupId: groupId,
      title: 'Another listing for same package',
      description: 'Duplicate',
    }),
  });
  assert(status === 409, `Expected 409, got ${status}`);
});

await test('List gallery (GET /v1/templates) — no auth required', async () => {
  const { status, body } = await json('/v1/templates');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.templates), 'Expected templates array');
  assert(typeof body.data?.total === 'number', 'Expected total count');
});

await test('Gallery search filter', async () => {
  const { status, body } = await json('/v1/templates?search=Awesome');
  assert(status === 200, `Expected 200, got ${status}`);
  const found = body.data.templates.find((t: any) => t.id === listingId);
  assert(found, 'Should find listing by search term');
});

await test('Gallery category filter', async () => {
  const { status, body } = await json('/v1/templates?category=utility');
  assert(status === 200, `Expected 200, got ${status}`);
  const found = body.data.templates.find((t: any) => t.id === listingId);
  assert(found, 'Should find listing by category');
});

await test('Get single listing (GET /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.listing?.id === listingId, 'Listing id mismatch');
  assert(Array.isArray(body.data?.reviews), 'Expected reviews array');
  assert(Array.isArray(body.data?.discussions), 'Expected discussions array');
});

await test('Update listing (PATCH /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({
      title: 'Updated Widget Template',
      tags: ['widget', 'awesome', 'updated'],
    }),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.listing?.title === 'Updated Widget Template', 'Title not updated');
  assert(body.data?.listing?.tags?.includes('updated'), 'Tags not updated');
});

await test('Add review (POST /v1/templates/:id/review)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 4, comment: 'Great template!' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review?.rating === 4, 'Rating mismatch');
  assert(body.data?.review?.comment === 'Great template!', 'Comment mismatch');
  reviewId = body.data.review.id;
});

await test('Update review (same author, POST again)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 5, comment: 'Even better now!' }),
  });
  // Update returns 200, not 201
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review?.rating === 5, 'Updated rating mismatch');
});

await test('Review validation: invalid rating returns 400', async () => {
  const { status } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 6, comment: 'Too high' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Review validation: missing comment returns 400', async () => {
  const { status } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 3 }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('List reviews (GET /v1/templates/:id/reviews)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/reviews`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.reviews?.length >= 1, 'Expected at least 1 review');
  assert(typeof body.data?.total === 'number', 'Expected total count');
});

await test('Add discussion (POST /v1/templates/:id/discussion)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussion`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ message: 'How do I customize the main CSM?' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.discussion?.message === 'How do I customize the main CSM?', 'Message mismatch');
  discussionId = body.data.discussion.id;
});

await test('Add threaded reply to discussion', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussion`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ message: 'You can edit the fields array!', parentId: discussionId }),
  });
  assert(status === 201, `Expected 201, got ${status}`);
  assert(body.data?.discussion?.parentId === discussionId, 'parentId mismatch');
});

await test('Discussion validation: empty message returns 400', async () => {
  const { status } = await json(`/v1/templates/${listingId}/discussion`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ message: '' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('List discussions (GET /v1/templates/:id/discussions)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussions`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.discussions?.length >= 2, 'Expected at least 2 discussions (parent + reply)');
});

await test('Toggle featured — operator only (PATCH /v1/templates/:id/featured)', async () => {
  // First owner is operator
  const { status, body } = await json(`/v1/templates/${listingId}/featured`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ featured: true }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.featured === true, 'Expected featured=true');
});

await test('Featured filter works in gallery', async () => {
  const { status, body } = await json('/v1/templates?featured=true');
  assert(status === 200, `Expected 200, got ${status}`);
  const found = body.data.templates.find((t: any) => t.id === listingId);
  assert(found, 'Featured listing should appear with featured=true filter');
});

await test('Featured validation: non-boolean returns 400', async () => {
  const { status } = await json(`/v1/templates/${listingId}/featured`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ featured: 'yes' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 7: Auth & Validation
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 7 — Auth & Validation');

// Register second owner
await test('Register second owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  owner2PrivKey = body.data.private_key;
});

await test('Second owner auth', async () => {
  const timestamp = new Date().toISOString();
  const message = owner2Name + NODE_ID + timestamp;
  const signature = await signMsg(owner2PrivKey, message);

  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: owner2Name, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  owner2Token = body.data?.token;
});

await test('Second owner cannot publish version to first owner package', async () => {
  const { status } = await json(`/v1/bundles/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(owner2Token),
    body: JSON.stringify({
      changelog: 'Unauthorized version',
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot update first owner package metadata', async () => {
  const { status } = await json(`/v1/bundles/${encodedGroupId}`, {
    method: 'PATCH',
    headers: authed(owner2Token),
    body: JSON.stringify({ description: 'Hijacked!' }),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot archive first owner versions', async () => {
  const { status } = await json(
    `/v1/bundles/${encodedGroupId}/versions/${secondVersion}`,
    { method: 'DELETE', headers: authed(owner2Token) },
  );
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot view first owner instances', async () => {
  const { status } = await json(`/v1/instances/${instanceId}`, {
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot delete first owner instances', async () => {
  const { status } = await json(`/v1/instances/${instanceId}`, {
    method: 'DELETE',
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot check updates on first owner instance', async () => {
  const { status } = await json(`/v1/instances/${instanceId}/check-update`, {
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot view component status of first owner instance', async () => {
  const { status } = await json(`/v1/instances/${instanceId}/status`, {
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot toggle featured (not operator)', async () => {
  const { status } = await json(`/v1/templates/${listingId}/featured`, {
    method: 'PATCH',
    headers: authed(owner2Token),
    body: JSON.stringify({ featured: false }),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot update first owner template listing', async () => {
  const { status } = await json(`/v1/templates/${listingId}`, {
    method: 'PATCH',
    headers: authed(owner2Token),
    body: JSON.stringify({ title: 'Hijacked Title' }),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot delete first owner template listing', async () => {
  const { status } = await json(`/v1/templates/${listingId}`, {
    method: 'DELETE',
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Unauthenticated create package returns 401', async () => {
  const { status } = await json('/v1/bundles', {
    method: 'POST',
    body: JSON.stringify({ name: 'no-auth', components: [{ id: 'x', type: 'csm', content: '{}' }] }),
  });
  assert(status === 401, `Expected 401, got ${status}`);
});

await test('Unauthenticated install returns 401', async () => {
  const { status } = await json(`/v1/bundles/${encodedGroupId}/install`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(status === 401, `Expected 401, got ${status}`);
});

await test('Unauthenticated list instances returns 401', async () => {
  const { status } = await json('/v1/instances');
  assert(status === 401, `Expected 401, got ${status}`);
});

await test('Non-existent package returns 404', async () => {
  const fakeGroup = encodeURIComponent('nonexistent::nobody');
  const { status } = await json(`/v1/bundles/${fakeGroup}`);
  assert(status === 404, `Expected 404, got ${status}`);
});

await test('Non-existent instance returns 404', async () => {
  const { status } = await json('/v1/instances/00000000-0000-0000-0000-000000000000', {
    headers: authed(ownerToken),
  });
  assert(status === 404, `Expected 404, got ${status}`);
});

await test('Non-existent template returns 404', async () => {
  const { status } = await json('/v1/templates/00000000-0000-0000-0000-000000000000');
  assert(status === 404, `Expected 404, got ${status}`);
});

// ─── Delete template listing before cleanup ─────────────────────────

await test('Delete template listing (DELETE /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.deleted === true, 'Expected deleted=true');

  // Verify it's gone
  const { status: getStatus } = await json(`/v1/templates/${listingId}`);
  assert(getStatus === 404, `Expected 404 after delete, got ${getStatus}`);
});

// ─── Cleanup ────────────────────────────────────────────────────────

console.log('\nCleanup');

await json(`/v1/owners/${owner2Name}?cascade=true`, {
  method: 'DELETE',
  headers: authed(owner2Token),
});

await json(`/v1/owners/${ownerName}?cascade=true`, {
  method: 'DELETE',
  headers: authed(ownerToken),
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
