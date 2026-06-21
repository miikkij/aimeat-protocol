// Knowledge System E2E tests — Phase 1
// Run: cd aimeat && pnpm exec tsx test/e2e-knowledge.ts
// Requires: server running on port 40251

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
let agentToken = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `knowledgetest${Date.now()}`;
const agentName = 'knowledgeagent';

// ─── Package IDs captured during tests ───
let firstPackageId = '';
let linkPackageId = '';

console.log('\n=== Knowledge System E2E Tests ===\n');

// ─── Setup: Register owner + agent ───
console.log('Setup — Register owner + agent');

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

await test('Register test agent', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
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

// ─── Phase 1: Package Import ───
console.log('\nPhase 1: Package Import');

await test('Import a valid knowledge package', async () => {
  const { status, body } = await json('/v1/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      package: {
        type: 'knowledge-package',
        name: 'Test Research Package',
        version: '1.0.0',
        author: ownerName,
        content_type: 'research',
        tags: ['test', 'solar'],
        language: 'en',
        maturity: 'published',
        synthesis: { level: 'assisted', description: 'AI helped structure notes' },
        references: [{ url: 'https://example.com', title: 'Example', accessed: '2026-03-07', verified: false }],
        entries: [
          { key: 'findings', title: 'Main Findings', visibility: 'public' },
          { key: 'private-notes', title: 'Private Notes', visibility: 'private' },
        ],
        links: [],
        sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
      },
      entry_data: {
        findings: { title: 'Main Findings', summary: 'Test findings', findings: ['fact 1'] },
        'private-notes': { title: 'Private Notes', body: 'Secret stuff' },
      },
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.package_id, 'Missing package_id');
  assert(body.data?.entries_created === 2, `Expected 2 entries, got ${body.data?.entries_created}`);
  firstPackageId = body.data.package_id;
});

await test('Reject invalid package (missing required fields)', async () => {
  const { status } = await json('/v1/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ package: { name: 'incomplete' } }),
  });
  assert(status === 400, `Expected 400, got ${status}`);
});

await test('Get package manifest by ID', async () => {
  const { status, body } = await json(`/v1/knowledge/${firstPackageId}`);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.package_id === firstPackageId, 'Package ID mismatch');
  assert(body.data?.manifest?.name === 'Test Research Package', 'Manifest name mismatch');
});

// ─── Phase 1: Memory Links ───
console.log('\nPhase 1: Memory Links');

await test('Create and list memory links', async () => {
  // Create a second package to link from
  const { body: pkg2 } = await json('/v1/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      package: {
        type: 'knowledge-package', name: 'Link Source', version: '1.0.0',
        author: ownerName, content_type: 'idea', tags: ['test'],
        language: 'en', maturity: 'draft',
        synthesis: { level: 'original', description: 'User created' },
        references: [], entries: [{ key: 'content', title: 'Content', visibility: 'public' }],
        links: [], sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
      },
      entry_data: { content: { title: 'Content', description: 'Test' } },
    }),
  });

  linkPackageId = pkg2.data.package_id;

  // Create a link
  const { status: linkStatus } = await json(`/v1/knowledge/${linkPackageId}/link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      target: `packages/${firstPackageId}/manifest`,
      relation: 'related-to',
      description: 'Test link between packages',
    }),
  });
  assert(linkStatus === 201, `Expected 201 for link, got ${linkStatus}`);

  // List links
  const { status: listStatus, body: listBody } = await json(`/v1/knowledge/${linkPackageId}/links`);
  assert(listStatus === 200, `Expected 200 for list, got ${listStatus}`);
  assert(listBody.data.count >= 1, `Expected at least 1 link, got ${listBody.data.count}`);
});

await test('Reject link with invalid relation', async () => {
  const { status } = await json(`/v1/knowledge/${linkPackageId}/link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      target: 'some/target',
      relation: 'invalid-relation',
      description: 'Should fail',
    }),
  });
  assert(status === 400, `Expected 400 for invalid relation, got ${status}`);
});

await test('Delete a link', async () => {
  const { status } = await json(`/v1/knowledge/${linkPackageId}/link`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ target: `packages/${firstPackageId}/manifest` }),
  });
  assert(status === 200, `Expected 200 for delete link, got ${status}`);

  // Verify link is gone
  const { body: listBody } = await json(`/v1/knowledge/${linkPackageId}/links`);
  assert(listBody.data.count === 0, `Expected 0 links after delete, got ${listBody.data.count}`);
});

// ─── Phase 1: Prompt Templates ───
console.log('\nPhase 1: Prompt Templates');

await test('Retrieve human prompt template', async () => {
  const { status, body } = await json('/v1/templates/knowledge-packager-human', {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  // May be 404 if not seeded — acceptable for standalone test runs
  assert(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
  if (status === 200) {
    assert(typeof body.data.prompt === 'string', 'Expected prompt to be a string');
    assert(body.data.ghii, 'Expected ghii in response');
  }
});

await test('Retrieve agent prompt template', async () => {
  const { status, body } = await json('/v1/templates/knowledge-packager-agent', {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
  if (status === 200) {
    assert(typeof body.data.prompt === 'string', 'Expected prompt to be a string');
    assert(body.data.gaii, 'Expected gaii in response');
  }
});

// ─── Phase 3: Discovery and Sharing ───
console.log('\nPhase 3: Discovery and Sharing');

let discoverablePackageId = '';

await test('Import a public package for discovery', async () => {
  const { status, body } = await json('/v1/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      package: {
        type: 'knowledge-package',
        name: 'Discoverable Package',
        version: '1.0.0',
        author: ownerName,
        content_type: 'research',
        tags: ['discovery-test'],
        language: 'en',
        maturity: 'published',
        synthesis: { level: 'original', description: 'Test' },
        references: [],
        entries: [{ key: 'data', title: 'Test Data', visibility: 'public' }],
        links: [],
        sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
      },
      entry_data: { data: { title: 'Test Data', summary: 'Discoverable content' } },
    }),
  });
  assert(status === 201, `Expected 201, got ${status}`);
  discoverablePackageId = body.data.package_id;
});

await test('Discover packages via catalogue', async () => {
  const { status, body } = await json('/v1/catalogue/knowledge?tags=discovery-test');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.packages?.length >= 1, 'Expected at least 1 package');
});

await test('Export a package', async () => {
  const { status, body } = await json(`/v1/knowledge/${discoverablePackageId}/export?format=json`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.aimeat_knowledge_package === true, 'Expected aimeat_knowledge_package flag');
  assert(body.exported_from?.package_id === discoverablePackageId, 'Expected correct package_id in export');
});

await test('Clone a package', async () => {
  const { status, body } = await json(`/v1/knowledge/${discoverablePackageId}/clone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ target_prefix: 'my-clone' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.cloned_package_id, 'Expected cloned_package_id');
  assert(body.data?.entries_cloned >= 1, 'Expected at least 1 cloned entry');
});

// ─── Phase 4: Quality and Moderation ───
console.log('\nPhase 4: Quality and Moderation');

await test('Get package reputation signals', async () => {
  const { status, body } = await json(`/v1/knowledge/${discoverablePackageId}/reputation`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.clone_count !== undefined, 'Expected clone_count');
  assert(body.data?.flag_count !== undefined, 'Expected flag_count');
});

await test('Operator can list packages for review', async () => {
  const { status, body } = await json('/v1/admin/knowledge', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(Array.isArray(body.data?.packages), 'Expected packages array');
});

await test('Operator can review a package', async () => {
  const { status, body } = await json(`/v1/admin/knowledge/${discoverablePackageId}/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      reason: 'routine_review',
      action: 'approve',
    }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review_id, 'Expected review_id');
});

await test('Package owner can see operator reviews', async () => {
  const { status, body } = await json(`/v1/knowledge/${discoverablePackageId}/reviews`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.count >= 1, 'Expected at least 1 review');
  assert(body.data?.reviews[0]?.action === 'approve', 'Expected approve action');
});

// ─── Phase 5: Organism-Member Consent Resolution (Fix 2) ───
// A consent grant with recipient "organism.{id}" must resolve for an ACTIVE member of
// that organism, and only for members. Uses a dot-keyed pattern (analysis.*) — the
// canonical consent pattern form that findMatchingConsents/consentMatchPattern supports.
console.log('\nPhase 5: Organism-Member Consent Resolution');

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
  const signature = await signMsg(privKey, message);
  const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature } : { owner: ownerOrGaii, timestamp, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  return body.data?.token;
}

async function makeOwnerAgent(name: string): Promise<{ owner: string; ownerToken: string; agentGaii: string; agentToken: string }> {
  const { body: oBody } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  const oToken = await getToken(name, oBody.data.private_key, false);
  const { body: aBody } = await json('/v1/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${oToken}` },
    body: JSON.stringify({ name: 'orgagent', owner: name, capabilities: ['memory'], model: 'test-model' }),
  });
  const gaii = aBody.data.agent.gaii;
  const aToken = await getToken(gaii, aBody.data.private_key, true);
  return { owner: name, ownerToken: oToken, agentGaii: gaii, agentToken: aToken };
}

let organismId = '';
let member = { owner: '', ownerToken: '', agentGaii: '', agentToken: '' };
let nonMember = { owner: '', ownerToken: '', agentGaii: '', agentToken: '' };
const analysisKey = 'analysis.solar';

await test('Owner-1 agent creates an open organism', async () => {
  const { status, body } = await json('/v1/organisms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ name: 'Knowledge Org', type: 'community', join_policy: 'open', visibility: 'public' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  organismId = body.data.organism.id;
  assert(typeof organismId === 'string' && organismId.length > 0, 'got organism id');
});

await test('Register member + non-member owners/agents', async () => {
  member = await makeOwnerAgent(`korgmem${Date.now()}`);
  nonMember = await makeOwnerAgent(`korgnon${Date.now()}`);
  assert(member.agentToken && nonMember.agentToken, 'both have agent tokens');
});

await test('Member joins the organism (open policy)', async () => {
  const { status, body } = await json(`/v1/organisms/${organismId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${member.agentToken}` },
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.status === 'joined', `status: ${body.data?.status}`);
});

await test('Owner-1 grants consent to the organism (analysis.*)', async () => {
  const { status, body } = await json('/v1/consent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      data_pattern: 'analysis.*',
      recipient: `organism.${organismId}`,
      purpose: 'organism knowledge sharing',
      scope: 'private',
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Owner-1 writes a private analysis.* memory', async () => {
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ key: analysisKey, value: { finding: 'solar output up 12%' }, visibility: 'private' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Active member reads owner-1 analysis.solar → 200', async () => {
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(analysisKey)}`, {
    headers: { Authorization: `Bearer ${member.agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert((body.data?.value as any)?.finding?.includes('solar'), 'got the analysis value');
});

await test('Non-member reads owner-1 analysis.solar → 403', async () => {
  const { status } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(analysisKey)}`, {
    headers: { Authorization: `Bearer ${nonMember.agentToken}` },
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

await test('Non-member read is audited as a denial; allowed member read is NOT audited', async () => {
  const { status, body } = await json('/v1/consent/audit?days=1', {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  const entries = (body.data?.entries as any[]) ?? [];
  const allowed = entries.some(e => e.memory_key === analysisKey && e.allowed === true);
  const denied = entries.some(e => e.memory_key === analysisKey && e.allowed === false);
  // Policy: only denials + consent mutations are audited (allowed reads are not).
  assert(denied, `expected a denied audit entry for ${analysisKey} (non-member)`);
  assert(!allowed, `allowed reads should NOT be audited, but found one for ${analysisKey}`);
});

// ── G13: contributed knowledge package readable by a fellow organism member ──
// The contribute flow grants `packages/{id}/*` (a SLASH-keyed pattern). Before the
// slash-aware matcher fix this never matched `packages/{id}/manifest`, so contributed
// packages were unreadable even by members. Now it resolves via organism membership.
let contributedPkgId = '';

await test('Owner-1 imports a non-catalog (owner-visibility) package', async () => {
  const { status, body } = await json('/v1/knowledge/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      package: {
        type: 'knowledge-package', name: 'Org Shared Pkg', version: '1.0.0',
        author: ownerName, content_type: 'research', tags: ['org-share'],
        language: 'en', maturity: 'published',
        synthesis: { level: 'original', description: 'member-only package' },
        references: [], entries: [{ key: 'data', title: 'Data', visibility: 'owner' }],
        links: [], sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
      },
      entry_data: { data: { title: 'Data', summary: 'org-only content' } },
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  contributedPkgId = body.data.package_id;
});

await test('Owner-1 contributes the package to the organism', async () => {
  const { status, body } = await json(`/v1/knowledge/${contributedPkgId}/contribute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ organism_id: organismId }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Fellow organism member can read the contributed package manifest → 200', async () => {
  const key = `packages/${contributedPkgId}/manifest`;
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${member.agentToken}` },
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
});

await test('Non-member cannot read the contributed package manifest → 403', async () => {
  const key = `packages/${contributedPkgId}/manifest`;
  const { status } = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${nonMember.agentToken}` },
  });
  assert(status === 403, `Expected 403, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
await json(`/v1/owners/${ownerName}?cascade=true`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${ownerToken}` },
});
if (member.owner) {
  await json(`/v1/owners/${member.owner}?cascade=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${member.ownerToken}` } });
}
if (nonMember.owner) {
  await json(`/v1/owners/${nonMember.owner}?cascade=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${nonMember.ownerToken}` } });
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
