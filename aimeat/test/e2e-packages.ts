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
 *   - Phase 8: Template Moderation Lifecycle
 * @version-history
 *   v1.6.0 — 2026-08-23 — Bundled crew-defs across the package door (TARGET-070): a valid declaration
 *     arrives on the installed app's manifest, and a malformed one fails the install out loud instead
 *     of installing an app whose agents are quietly absent. Both cases were seen failing against the
 *     registrar before the fix. Note for the next reader: a red run immediately after another run is
 *     suspect — the previous server had not exited here, and the suite talked to stale code and stale
 *     data, which reads exactly like a regression (pitfalls §18).
 *   v1.5.0 — 2026-08-16 — E2E quality, packages:678: the migration test read only the migration's own
 *     answer about itself, so a migration that announced every component and registered none would
 *     pass it. A new case reads the four components back through the status route, which recomputes
 *     each hash live from native storage, and reads the migrated CSM back by name through a second
 *     door. The replace and install_new branches were covered nowhere in the tree.
 *   v1.4.0 — 2026-08-10 — The extension components in the fixture carry a real manifest. They were a
 *     bare JS snippet, which only installed because the package registrar defaulted every missing
 *     field; that registrar now uses the same builder as POST /v1/extensions.
 *   v1.0.0 — 2026-03-15 — initial test suite
 *   v1.1.0 — 2026-03-15 — add dry_run tests, fix YAML export assertion, fix draft install assertion
 *   v1.2.0 — 2026-03-15 — add config validation tests (component count limit, package size limit)
 *   v1.3.0 — 2026-03-20 — update export/import tests for ZIP format, add moderation lifecycle tests
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-packages.ts
// Requires: server running on port 40251

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';
import YAML from 'yaml';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

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

/** Helper: build a valid ZIP buffer from a manifest and component files */
async function buildTestZip(manifest: Record<string, unknown>, components: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.append(YAML.stringify(manifest), { name: 'manifest.yaml' });
    for (const c of components) {
      archive.append(c.content, { name: c.name });
    }
    archive.finalize();
  });
}

/** Helper: upload a ZIP buffer via multipart/form-data */
async function uploadZip(path: string, zipBuf: Buffer, token: string): Promise<{ status: number; body: any }> {
  const boundary = '----FormBoundary' + Date.now();
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.zip"\r\nContent-Type: application/zip\r\n\r\n`));
  parts.push(zipBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${token}`,
    },
    body,
  });
  const ct = res.headers.get('content-type') ?? '';
  const parsed = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body: parsed };
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
let exportedZipBuffer: Buffer | null = null;
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

await test('Create package (POST /v1/packages)', async () => {
  const { status, body } = await json('/v1/packages', {
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
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension', content: "{\"manifest\":\"metadata:\\n  name: pkg-ext-helper\\n  version: 1.0.0\\n  description: Helper extension used by the packages E2E fixture\\n  author: e2e\\nactions:\\n  - id: helper\\n    method: POST\\n    path: /helper\\n    script: helper\",\"scripts\":{\"helper\":\"export default async function(ctx, input){ return { v: '1.0.0' }; }\"}}", dependencies: ['csm-main'] },
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
  const { status } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ components: [{ id: 'x', type: 'csm', content: '{}' }] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Validation: missing components returns 400', async () => {
  const { status } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ name: 'no-comps' }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Validation: empty components array returns 400', async () => {
  const { status } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ name: 'empty-comps', components: [] }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Duplicate package name returns 409', async () => {
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

await test('List packages (GET /v1/packages) — default filters show published+public only', async () => {
  // Our package is draft, so it should NOT appear in the default listing
  const { status, body } = await json('/v1/packages');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.packages), 'Expected packages array');
  const found = body.data.packages.find((p: any) => p.packageGroupId === groupId);
  assert(!found, 'Draft package should not appear in default public listing');
});

await test('List packages with status=draft shows our package', async () => {
  const { status, body } = await json(`/v1/packages?status=draft&author=${ownerName}`);
  assert(status === 200, `Expected 200, got ${status}`);
  const found = body.data.packages.find((p: any) => p.packageGroupId === groupId);
  assert(found, 'Draft package should appear when filtering by status=draft + author');
});

await test('Import package via ZIP upload (POST /v1/packages/import)', async () => {
  const manifest = {
    'aimeat-package': '1.0',
    name: 'imported-pack',
    author: ownerName,
    description: 'An imported package',
    category: 'theme',
    tags: ['imported'],
    version: '1.0.0',
    changelog: 'Initial import',
    components: [
      { id: 'theme-main', type: 'csm', label: 'Theme CSM', file: 'components/theme-main.yaml', dependencies: [] },
    ],
  };
  const components = [
    { name: 'components/theme-main.yaml', content: '{"theme":true}' },
  ];
  const zipBuf = await buildTestZip(manifest, components);
  const { status, body } = await uploadZip('/v1/packages/import', zipBuf, ownerToken);
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.name === 'imported-pack', 'Name mismatch');
  // Publish the imported package so it can be installed in later tests
  const importedVersion = body.data?.version;
  const importedGroupEnc = encodeURIComponent(`imported-pack::${ownerName}`);
  await json(`/v1/packages/${importedGroupEnc}/versions/${importedVersion}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ status: 'published' }),
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 2: Versioning
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 2 — Versioning');

await test('Publish first version (PATCH status to published)', async () => {
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

await test('Get latest published (GET /v1/packages/:groupId)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packageGroupId === groupId, 'groupId mismatch');
  assert(body.data?.version === firstVersion, `version mismatch: expected ${firstVersion}, got ${body.data?.version}`);
  assert(body.data?.status === 'published', 'Expected published status');
});

await test('Publish new version (POST /v1/packages/:groupId/versions)', async () => {
  // Wait 1s to ensure different version timestamp
  await new Promise(r => setTimeout(r, 1100));

  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      changelog: 'Added new component',
      status: 'draft',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM v2', content: '{"fields":["name"]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension v2', content: "{\"manifest\":\"metadata:\\n  name: pkg-ext-helper\\n  version: 2.0.0\\n  description: Helper extension used by the packages E2E fixture\\n  author: e2e\\nactions:\\n  - id: helper\\n    method: POST\\n    path: /helper\\n    script: helper\",\"scripts\":{\"helper\":\"export default async function(ctx, input){ return { v: '2.0.0' }; }\"}}", dependencies: ['csm-main'] },
        { id: 'app-ui', type: 'app', label: 'UI App', content: '<div>hello</div>', dependencies: ['csm-main'] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  secondVersionId = body.data.id;
  secondVersion = body.data.version;
  assert(secondVersion !== firstVersion, `New version should differ: ${secondVersion} vs ${firstVersion}`);
});

await test('List all versions (GET /v1/packages/:groupId/versions)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.versions?.length >= 2, `Expected >= 2 versions, got ${body.data?.versions?.length}`);
});

await test('Get specific version (GET /v1/packages/:groupId/versions/:version)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.version === firstVersion, 'Version mismatch');
  assert(body.data?.components?.length === 2, `Expected 2 components in v1, got ${body.data?.components?.length}`);
});

await test('Publish second version', async () => {
  const { status, body } = await json(
    `/v1/packages/${encodedGroupId}/versions/${secondVersion}`,
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
  const { status, body } = await json(`/v1/packages/${encodedGroupId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.version === secondVersion, `Expected ${secondVersion}, got ${body.data?.version}`);
  assert(body.data?.components?.length === 3, `Expected 3 components in v2, got ${body.data?.components?.length}`);
});

await test('Export package as ZIP (GET /v1/packages/:groupId/export)', async () => {
  const res = await fetch(`${BASE}/v1/packages/${encodedGroupId}/export`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  assert(ct.includes('application/zip'), `Expected application/zip, got ${ct}`);
  const disp = res.headers.get('content-disposition') ?? '';
  assert(disp.includes('.zip'), `Expected zip in Content-Disposition, got ${disp}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Check ZIP magic bytes (PK\x03\x04)
  assert(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04,
    `Expected ZIP magic bytes, got ${buf.subarray(0, 4).toString('hex')}`);
  assert(buf.length > 100, `ZIP should have content, got ${buf.length} bytes`);
  // Store for import test
  exportedZipBuffer = buf;
});

await test('Archive first version (DELETE /v1/packages/:groupId/versions/:version)', async () => {
  const { status, body } = await json(
    `/v1/packages/${encodedGroupId}/versions/${firstVersion}`,
    { method: 'DELETE', headers: authed(ownerToken) },
  );
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.archived === true, 'Expected archived=true');
});

await test('Archived version status is archived', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions/${firstVersion}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.status === 'archived', `Expected archived, got ${body.data?.status}`);
});

await test('Invalid status returns 400', async () => {
  const { status } = await json(
    `/v1/packages/${encodedGroupId}/versions/${secondVersion}`,
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

await test('Update group metadata (PATCH /v1/packages/:groupId)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}`, {
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
  const { body } = await json(`/v1/packages/${encodedGroupId}/versions/${secondVersion}`);
  assert(body.data?.description === 'Updated description', 'v2 description not updated');
});

await test('Invalid visibility returns 400', async () => {
  const { status } = await json(`/v1/packages/${encodedGroupId}`, {
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

await test('Dry run install (POST /v1/packages/:groupId/install with dry_run=true)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'Dry Run Test', dry_run: true }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.dry_run === true, 'Expected dry_run=true in response');
  assert(body.data?.packageGroupId === groupId, 'groupId mismatch');
  assert(body.data?.componentCount === 3, `Expected 3 components, got ${body.data?.componentCount}`);
  assert(Array.isArray(body.data?.installOrder), 'Expected installOrder array');
  assert(Array.isArray(body.data?.components), 'Expected components array');
  // Verify no instance was actually created
  const { body: listBody } = await json('/v1/instances', { headers: authed(ownerToken) });
  const instances = listBody.data?.instances ?? [];
  const dryRunInstance = instances.find((i: any) => i.label === 'Dry Run Test');
  assert(!dryRunInstance, 'Dry run should not create an actual instance');
});

await test('Install package (POST /v1/packages/:groupId/install)', async () => {
  const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'My Widget Instance' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.id, 'Missing instance id');
  assert(body.data?.packageGroupId === groupId, 'groupId mismatch');
  assert(body.data?.packageVersion === secondVersion, `version mismatch: expected ${secondVersion}`);
  assert(body.data?.label === 'My Widget Instance', 'Label mismatch');
  assert(body.data?.status === 'installed', 'Expected installed status');
  assert(Array.isArray(body.data?.installedComponents), 'Missing installedComponents');
  assert(body.data?.installedComponents.length === 3, `Expected 3 installed components, got ${body.data?.installedComponents.length}`);
  instanceId = body.data.id;
});

await test('An app component gets a filename that an app origin recognises', async () => {
  // An installed app's filename IS the component id with the install prefix on it, and TWO other
  // gates decide "is this an app" by looking for .html on that filename: the publish-time subdomain
  // provisioning (app-publish.ts) and the app-host path form (subdomains.ts). A package that names
  // its component `app-admin` therefore installs an app that skips both, and its owner meets a 404
  // on the address a listing handed them. Appending is idempotent, so a package that already writes
  // `app-shop.html` is untouched.
  const { body: created } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: 'app-suffix-probe',
      description: 'Two app components, one named with the suffix and one without',
      visibility: 'public',
      components: [
        { id: 'app-bare', type: 'app', label: 'Bare', content: '<!DOCTYPE html><title>bare</title>', dependencies: [] },
        { id: 'app-suffixed.html', type: 'app', label: 'Suffixed', content: '<!DOCTYPE html><title>suffixed</title>', dependencies: [] },
      ],
    }),
  });
  const probeGroup = encodeURIComponent(created.data.packageGroupId as string);
  await json(`/v1/packages/${probeGroup}/versions/${created.data.version}`, {
    method: 'PATCH', headers: authed(ownerToken), body: JSON.stringify({ status: 'published' }),
  });

  const { status, body } = await json(`/v1/packages/${probeGroup}/install`, {
    method: 'POST', headers: authed(ownerToken), body: JSON.stringify({ label: 'Suffix probe' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);

  const comps = body.data.installedComponents as Array<{ componentId: string; registeredAs: string }>;
  const bareApp = comps.find(c => c.componentId === 'app-bare')!;
  const suffixed = comps.find(c => c.componentId === 'app-suffixed.html')!;
  assert(bareApp.registeredAs.endsWith('.html'),
    `a bare app component id must still install as an .html filename: ${bareApp.registeredAs}`);
  assert(!suffixed.registeredAs.endsWith('.html.html'),
    `appending must be idempotent, got ${suffixed.registeredAs}`);
  assert(suffixed.registeredAs.endsWith('-app-suffixed.html'),
    `an id that already carries the suffix must pass through unchanged: ${suffixed.registeredAs}`);

  // The component id itself does not move: dependencies and migration prompts address components
  // by id, and renaming them here would break both.
  assert(bareApp.componentId === 'app-bare', 'the component id must stay as the package wrote it');

  // The suffix is a filename detail and must not leak into what a person reads: the catalogue shows
  // the component's own label.
  const { body: appsBody } = await json('/v1/apps', { headers: authed(ownerToken) });
  const row = (appsBody.data as { apps: Array<{ filename: string; manifest: { name: string } }> }).apps
    .find(a => a.filename === bareApp.registeredAs);
  assert(!!row, `the installed app is not in the catalogue: ${bareApp.registeredAs}`);
  assert(row!.manifest.name === 'Bare', `expected the label as the display name, got ${row!.manifest.name}`);

  // And it is really served under the new filename, which is the whole point of appending it.
  const served = await fetch(`${BASE}/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(bareApp.registeredAs)}`);
  assert(served.status === 200, `Expected 200 serving the installed app, got ${served.status}`);
});

await test('Cannot install draft package', async () => {
  // Create a draft-only package to test against
  const { body: draftPkg } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: 'draft-only-pkg',
      components: [{ id: 'x', type: 'csm', content: '{}' }],
    }),
  });
  const draftGroupId = encodeURIComponent(draftPkg.data.packageGroupId);
  const { status } = await json(`/v1/packages/${draftGroupId}/install`, {
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

await test('Delete instance with removeComponents (DELETE /v1/instances/:id)', async () => {
  // Install the imported-pack (a different package) to get a throwaway instance
  const importedGroupId = encodeURIComponent(`imported-pack::${ownerName}`);
  const { status: instStatus, body: inst } = await json(`/v1/packages/${importedGroupId}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: 'To be deleted' }),
  });
  assert(instStatus === 201, `Install for delete test failed: ${instStatus} — ${JSON.stringify(inst)}`);
  const delId = inst.data.id;

  const { status, body } = await json(`/v1/instances/${delId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
    body: JSON.stringify({ removeComponents: true }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.removed === true, 'Expected removed=true');
  assert(typeof body.data?.componentsRemoved === 'number', 'Expected componentsRemoved count');

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

  const { status, body } = await json(`/v1/packages/${encodedGroupId}/versions`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      changelog: 'Breaking change in csm-main, new component added',
      status: 'published',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM v3', content: '{"fields":["name","email","phone"]}', dependencies: [] },
        { id: 'ext-helper', type: 'extension', label: 'Helper Extension v3', content: "{\"manifest\":\"metadata:\\n  name: pkg-ext-helper\\n  version: 3.0.0\\n  description: Helper extension used by the packages E2E fixture\\n  author: e2e\\nactions:\\n  - id: helper\\n    method: POST\\n    path: /helper\\n    script: helper\",\"scripts\":{\"helper\":\"export default async function(ctx, input){ return { v: '3.0.0' }; }\"}}", dependencies: ['csm-main'] },
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

/**
 * The migration test above reads only the migration's own answer about itself: which components it
 * says it updated, skipped or added, and the version it says the instance is on. Nothing looks at
 * native storage afterwards, so a migration that announced everything and registered nothing would
 * pass every one of those assertions. The `replace` and `install_new` branches are covered nowhere
 * else in the tree.
 *
 * The status route computes each component's hash live from storage and calls it 'missing' when the
 * content is not there, so it is the honest second reading. currentHash === originalHash is what
 * says the v3 bytes are the ones registered: the migration wrote originalHash as the v3 package's
 * own contentHash, and the route recomputes from what storage actually holds.
 */
await test('Migrated components really exist in native storage', async () => {
  const { status, body } = await json(`/v1/instances/${instanceId}/status`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  const components = body.data?.components as any[];
  assert(Array.isArray(components), 'Expected components array');
  // Three before the migration (asserted above), four after: install_new added cortex-ai.
  assert(components.length === 4, `Expected 4 components after migration, got ${components.length}`);
  const byId = (id: string) => components.find(c => c.componentId === id);

  // replace: the v3 bytes are in storage, not merely announced.
  const csm = byId('csm-main');
  assert(!!csm, 'csm-main must be in the status list');
  assert(csm.status === 'active', `csm-main must be readable from storage, got status=${csm.status}`);
  assert(csm.currentHash === csm.originalHash,
    `csm-main must hold the v3 bytes the migration recorded: currentHash=${csm.currentHash} originalHash=${csm.originalHash}`);
  assert(csm.customized === false, `csm-main is not customized, got ${csm.customized}`);

  // install_new: the component the migration added.
  const cortex = byId('cortex-ai');
  assert(!!cortex, 'cortex-ai must be in the status list');
  assert(cortex.status === 'active', `cortex-ai must be readable from storage, got status=${cortex.status}`);
  assert(cortex.customized === false, `cortex-ai is not customized, got ${cortex.customized}`);

  // custom: the body-supplied bytes are what is stored, so it reads as customized against the
  // target's hash. That difference is the point of the branch.
  const app = byId('app-ui');
  assert(!!app, 'app-ui must be in the status list');
  assert(app.status === 'active', `app-ui must be readable from storage, got status=${app.status}`);
  assert(app.customized === true, `app-ui carries the custom content, so it must read customized, got ${app.customized}`);

  // skip: nothing moved. Also the control that this route says 'active' for a live component, so a
  // 'missing' above is the migration's doing and not the route's.
  const ext = byId('ext-helper');
  assert(!!ext, 'ext-helper must be in the status list');
  assert(ext.status === 'active', `ext-helper was skipped and must be untouched, got status=${ext.status}`);
  assert(ext.customized === false, `ext-helper is not customized, got ${ext.customized}`);

  // A second, independent door onto the same fact: the CSM read back by name. v2 defined one field,
  // v3 defines three, which separates 're-registered with the new bytes' from 'the old row survived'.
  const read = await json(`/v1/csm/${encodeURIComponent(csm.registeredAs)}`, { headers: authed(ownerToken) });
  assert(read.status === 200, `GET /v1/csm/${csm.registeredAs}: expected 200, got ${read.status}`);
  const fields = read.body.data?.csm?.definition?.fields;
  assert(JSON.stringify(fields) === JSON.stringify(['name', 'email', 'phone']),
    `the registered definition must be v3's, got ${JSON.stringify(fields)}`);
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
  const { status } = await json(`/v1/packages/${encodedGroupId}/versions`, {
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
  const { status } = await json(`/v1/packages/${encodedGroupId}`, {
    method: 'PATCH',
    headers: authed(owner2Token),
    body: JSON.stringify({ description: 'Hijacked!' }),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Second owner cannot archive first owner versions', async () => {
  const { status } = await json(
    `/v1/packages/${encodedGroupId}/versions/${secondVersion}`,
    { method: 'DELETE', headers: authed(owner2Token) },
  );
  assert(status === 403, `Expected 403, got ${status}`);
});

// A21 (E2E test-quality audit). Every other door in this phase has its cross-owner denial; install
// had none, and install is the one that WRITES. The suite's own package is public, so the question
// was never asked of a private one: `published` is not `public`, and a groupId is "{name}::{author}",
// so owner B who knows or guesses the name could install owner A's private package and get its app,
// cortex and extension source registered under B's identity — while GET, versions and export all
// answered B 404. Against the pre-fix source this test fails with 201.
await test('Second owner cannot install first owner PRIVATE package', async () => {
  const privName = 'private-pack-a21';
  const { status: created, body: privPkg } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: privName,
      description: 'Owner A private package',
      category: 'utility',
      visibility: 'private',
      components: [{ id: 'csm-main', type: 'csm', label: 'Main', content: '{"fields":[]}', dependencies: [] }],
    }),
  });
  assert(created === 201, `private package create expected 201, got ${created}: ${JSON.stringify(privPkg).slice(0, 200)}`);
  const privGroupEnc = encodeURIComponent(privPkg.data.packageGroupId);

  const { status: published } = await json(`/v1/packages/${privGroupEnc}/versions/${privPkg.data.version}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ status: 'published' }),
  });
  assert(published === 200, `publishing the private package expected 200, got ${published}`);

  // The read doors already refuse B. Pinned here so the install assertion below is measured against
  // a door that is known to be closed rather than against an assumption.
  const { status: read } = await json(`/v1/packages/${privGroupEnc}`, { headers: authed(owner2Token) });
  assert(read === 404, `owner B reading A's private package expected 404, got ${read}`);

  const { status: installed, body: instBody } = await json(`/v1/packages/${privGroupEnc}/install`, {
    method: 'POST',
    headers: authed(owner2Token),
    body: JSON.stringify({}),
  });
  assert(installed === 404, `owner B installing A's private package expected 404, got ${installed}: ${JSON.stringify(instBody).slice(0, 200)}`);

  // And nothing landed under B: the refusal has to happen before any component is registered.
  const { body: bInstances } = await json('/v1/instances', { headers: authed(owner2Token) });
  const leaked = (bInstances.data?.instances ?? []).find((i: any) => String(i.packageGroupId ?? '').startsWith(privName));
  assert(!leaked, `A's private package was installed as an instance under owner B: ${JSON.stringify(leaked ?? null).slice(0, 200)}`);

  // A can still install their own private package — the gate must not cost the author anything.
  const { status: ownInstall } = await json(`/v1/packages/${privGroupEnc}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ dry_run: true }),
  });
  assert(ownInstall === 200, `the author's own install expected 200, got ${ownInstall}`);
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
  const { status } = await json('/v1/packages', {
    method: 'POST',
    body: JSON.stringify({ name: 'no-auth', components: [{ id: 'x', type: 'csm', content: '{}' }] }),
  });
  assert(status === 401, `Expected 401, got ${status}`);
});

await test('Unauthenticated install returns 401', async () => {
  const { status } = await json(`/v1/packages/${encodedGroupId}/install`, {
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
  const { status } = await json(`/v1/packages/${fakeGroup}`);
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

await test('rejects package with too many components (config limit)', async () => {
  // Default max is 20 components
  const manyComponents = Array.from({ length: 21 }, (_, i) => ({
    id: `comp-${i}`,
    type: 'memory',
    label: `Component ${i}`,
    content: JSON.stringify({ entries: [{ key: `k${i}`, value: `v${i}` }] }),
    dependencies: [],
  }));
  const { status } = await json('/v1/packages', {
    method: 'POST',
    headers: { ...authed(ownerToken) },
    body: JSON.stringify({
      name: 'too-many-comps',
      description: 'Test max components',
      components: manyComponents,
    }),
  });
  assert(status === 413, `Expected 413, got ${status}`);
});

await test('rejects oversized package (body parser limit)', async () => {
  // Express body parser limit is 15MB; sending >15MB triggers 413 from Express
  const bigContent = 'x'.repeat(16 * 1024 * 1024);
  try {
    const res = await fetch(`${BASE}/v1/packages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authed(ownerToken),
      },
      body: JSON.stringify({
        name: 'too-big-pack',
        description: 'Test size limit',
        components: [{
          id: 'big-comp',
          type: 'memory',
          label: 'Big',
          content: bigContent,
          dependencies: [],
        }],
      }),
    });
    assert(res.status === 413, `Expected 413, got ${res.status}`);
  } catch (e: any) {
    // fetch may throw on connection reset for oversized payloads — that's acceptable
    assert(e.message.includes('fetch') || e.message.includes('socket') || e.message.includes('reset'),
      `Unexpected error: ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 8: Template Moderation Lifecycle
// ═══════════════════════════════════════════════════════════════════════

console.log('\nPhase 8 — Template Moderation');

let modListingId = '';

await test('Propose package as template (POST /v1/packages/:groupId/propose)', async () => {
  // Create a dedicated package for moderation tests
  const { status, body } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: 'mod-test-pack',
      description: 'Package for moderation testing',
      category: 'test',
      tags: ['moderation'],
      status: 'published',
      components: [
        { id: 'mod-csm', type: 'csm', label: 'Mod CSM', content: '{"mod":true}', dependencies: [] },
      ],
    }),
  });
  assert(status === 201, `Expected 201 for mod test pack, got ${status}: ${JSON.stringify(body)}`);
  // Publish it
  const modGroupId = body.data.packageGroupId;
  const modEnc = encodeURIComponent(modGroupId);
  const ver = body.data.version;
  await json(`/v1/packages/${modEnc}/versions/${ver}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ status: 'published' }),
  });

  // Propose
  const { status: propStatus, body: propBody } = await json(`/v1/packages/${modEnc}/propose`, {
    method: 'POST',
    headers: authed(ownerToken),
  });
  assert(propStatus === 201 || propStatus === 200, `Expected 200/201, got ${propStatus}: ${JSON.stringify(propBody)}`);
  modListingId = propBody.data?.listingId;
  assert(modListingId, 'Should return listingId');
  assert(propBody.data?.status === 'pending_review', `Expected pending_review, got ${propBody.data?.status}`);
});

await test('List pending templates (GET /v1/templates/pending)', async () => {
  const { status, body } = await json('/v1/templates/pending', {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  const pending = body.data?.templates ?? [];
  const found = pending.find((t: any) => t.id === modListingId);
  assert(found, 'Moderation listing should appear in pending queue');
});

await test('Non-operator cannot list pending (403)', async () => {
  const { status } = await json('/v1/templates/pending', {
    headers: authed(owner2Token),
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Review template details (GET /v1/templates/:id/review)', async () => {
  const { status, body } = await json(`/v1/templates/${modListingId}/review`, {
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.listing, 'Should include listing');
  assert(body.data?.manifest, 'Should include manifest');
  assert(body.data?.components, 'Should include components');
});

await test('Reject template with reason (POST /v1/templates/:id/reject)', async () => {
  const { status, body } = await json(`/v1/templates/${modListingId}/reject`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ reason: 'Needs better documentation' }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.status === 'rejected', 'Should be rejected');
  assert(body.data?.listing?.rejectionReason === 'Needs better documentation', 'Reason mismatch');
});

await test('Reject without reason returns 400', async () => {
  // First re-propose
  const modGroupId = `mod-test-pack::${ownerName}`;
  const modEnc = encodeURIComponent(modGroupId);
  const { status: propStatus } = await json(`/v1/packages/${modEnc}/propose`, {
    method: 'POST',
    headers: authed(ownerToken),
  });
  assert(propStatus === 200 || propStatus === 201, `Re-propose failed: ${propStatus}`);

  const { status } = await json(`/v1/templates/${modListingId}/reject`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({}),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Approve template (POST /v1/templates/:id/approve)', async () => {
  const { status, body } = await json(`/v1/templates/${modListingId}/approve`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ comment: 'Looks great!' }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.status === 'listed', 'Should be listed after approval');
});

await test('Approved template appears in gallery (GET /v1/templates)', async () => {
  const { status, body } = await json('/v1/templates');
  assert(status === 200, `Expected 200, got ${status}`);
  const found = (body.data?.templates ?? []).find((t: any) => t.id === modListingId);
  assert(found, 'Approved template should appear in gallery');
  assert(found.status === 'listed', 'Should have listed status');
});

await test('Suspend template (POST /v1/templates/:id/suspend)', async () => {
  const { status, body } = await json(`/v1/templates/${modListingId}/suspend`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ reason: 'Policy violation' }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.status === 'suspended', 'Should be suspended');
});

await test('Suspended template not in gallery', async () => {
  const { status, body } = await json('/v1/templates');
  assert(status === 200, `Expected 200, got ${status}`);
  const found = (body.data?.templates ?? []).find((t: any) => t.id === modListingId);
  assert(!found, 'Suspended template should NOT appear in gallery');
});

// Clean up moderation test listing
await json(`/v1/templates/${modListingId}`, {
  method: 'DELETE',
  headers: authed(ownerToken),
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

// Read the tab BEFORE the cleanup below deletes these owners. It used to run after, and passed
// only because a deleted owner's token still authenticated on one of the two backends: the
// Postgres cascade clears the Session table with the owner and the SQLite one does not. A test
// about the packages tab should not be the thing that discovers that.
await test('Packages tab overview composite folds the 3 local reads (Phase 4 DbService)', async () => {
  const { body } = await json('/v1/packages/tab', { headers: authed(ownerToken) });
  assert(body.ok === true, `packages/tab: ${JSON.stringify(body.error)}`);
  const d = body.data;
  assert(Array.isArray(d.instances?.instances), 'instances is an array');
  assert(Array.isArray(d.packages?.packages), 'packages is an array');
  assert(Array.isArray(d.templates?.templates), 'templates is an array');
  // The instances section matches the standalone endpoint (both owner-scoped, installed).
  const { body: inst } = await json('/v1/instances?status=installed', { headers: authed(ownerToken) });
  assert(d.instances.total === inst.data.total, `overview instances (${d.instances.total}) == /v1/instances (${inst.data.total})`);
});

// ─── Bundled crew-defs survive a package install (TARGET-070) ───────
//
// The registrar builds an installed app's manifest by hand and had no `cortex` key, so a package
// whose app shipped crew-defs installed an app with none, in silence. Bundling itself was never
// broken — NOSTE ships two crews in production through the PUBLISH door. Only the PACKAGE door
// dropped them. These two cases pin both halves: a valid declaration arrives, and a malformed one
// is refused out loud rather than installed empty.

const CREWS_APP_HTML = (crews: unknown) => '<!DOCTYPE html><html><head><title>Shop</title>'
  + `<script type="application/json" id="aimeat-crews">${JSON.stringify(crews)}</script>`
  + '</head><body><div>shop</div></body></html>';

const VALID_CREW = {
  agent_name: 'shopkeeper',
  readme_md: '# Shopkeeper\n\nAsks what you sell and writes it down.',
  process: 'sequential',
  agents: [{
    role: 'Interviewer',
    goal: 'Find out what this person actually sells.',
    backstory: 'You ask short questions and you wait.',
    allow_delegation: false,
  }],
  tasks: [{
    id: 'interview',
    description: 'Interview the owner about what they sell. Their own words: {{ctx.prompt}}',
    expected_output: 'What the person actually said, with anything unanswered marked as not established.',
    agent: 'Interviewer',
  }],
};

/** Create → publish → install one single-app package, and return the install response. */
async function installAppOnlyPackage(name: string, appHtml: string) {
  const { body: created } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name,
      description: 'Crew-def carrier fixture',
      components: [{ id: 'app-shop', type: 'app', label: 'Shop', content: appHtml, dependencies: [] }],
    }),
  });
  const gid = encodeURIComponent(created.data.packageGroupId);
  await json(`/v1/packages/${gid}/versions/${created.data.version}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({ status: 'published' }),
  });
  return json(`/v1/packages/${gid}/install`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ label: `${name} instance` }),
  });
}

await test('Bundled crew-defs survive a package install', async () => {
  const { status, body } = await installAppOnlyPackage(
    `crews-ok-${Date.now()}`,
    CREWS_APP_HTML([VALID_CREW]),
  );
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  const registeredAs = body.data?.installedComponents?.[0]?.registeredAs;
  assert(typeof registeredAs === 'string', 'Missing registeredAs for the app component');

  // `GET /v1/apps/:owner/:filename` serves the app's HTML; the manifest is on the catalogue row,
  // and the owner's own row is the unredacted one.
  const { status: listStatus, body: list } = await json('/v1/apps', { headers: authed(ownerToken) });
  assert(listStatus === 200, `Expected 200 listing apps, got ${listStatus}`);
  const row = (list.data?.apps ?? []).find((a: any) => a.filename === registeredAs);
  assert(row, `Installed app ${registeredAs} not in the catalogue listing`);
  const agents = row.manifest?.cortex?.agents;
  assert(Array.isArray(agents), `Installed app carries no cortex.agents: ${JSON.stringify(row.manifest)}`);
  assert(agents.length === 1, `Expected 1 bundled crew, got ${agents.length}`);
  assert(agents[0].agent_name === 'shopkeeper', `Expected shopkeeper, got ${agents[0].agent_name}`);
});

await test('An app declaring a malformed crew-def is refused, not installed empty', async () => {
  // Missing `tasks` entirely — the publish door refuses this shape, and so must the package door.
  const broken = { agent_name: 'shopkeeper', agents: [{ role: 'Interviewer', goal: 'Ask.' }] };
  const { status, body } = await installAppOnlyPackage(
    `crews-bad-${Date.now()}`,
    CREWS_APP_HTML([broken]),
  );
  assert(status === 500, `Expected the install to fail, got ${status}: ${JSON.stringify(body)}`);
  assert(
    String(body.error?.message ?? '').includes('crew-defs'),
    `Expected the reason to name the crew-defs, got: ${JSON.stringify(body.error)}`,
  );
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


// (Owner-only requireRole('owner') gating is proven in the access-tokens suite — same middleware.)

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
