/**
 * @file e2e-projects.ts
 * @description E2E for Phase 3 "project core" — an organism + a manifest at
 *   organism.{id}.meta.manifest, object shapes registered organism-scoped (compiled from the
 *   project CSM bundle), records written through the GENERIC memory API, and the one new
 *   GET /v1/organisms/:id/workspace read. Proves: manifest-format validation (422/200), the
 *   apply path, schema-gated object writes (422), the workspace aggregation, membership +
 *   consent access (403 paths), and GENERICITY — a second `kind:'research-study'` manifest
 *   with different object types reads through the SAME engine.
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Initial Phase 3 project-core suite.
 */
// Run: cd aimeat && pnpm exec node --import tsx test/run-e2e-ci.ts --test=projects

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) {
      await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 300);
      continue;
    }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
  const signature = await signMsg(privKey, message);
  const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature } : { owner: ownerOrGaii, timestamp, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function registerOwnerAndAgent(prefix: string) {
  const ownerName = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const o = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(o.status === 201, `owner ${o.status}: ${JSON.stringify(o.body)}`);
  const ownerToken = await getToken(ownerName, o.body.data.private_key, false);
  const a = await json('/v1/agents', {
    method: 'POST', headers: bearer(ownerToken),
    body: JSON.stringify({ name: 'projbot', owner: ownerName, capabilities: ['memory'] }),
  });
  assert(a.status === 201, `agent ${a.status}: ${JSON.stringify(a.body)}`);
  const agentGaii = a.body.data.agent.gaii;
  const agentToken = await getToken(agentGaii, a.body.data.private_key, true);
  return { ownerName, ownerToken, agentGaii, agentToken };
}

/** Grant `organism.{id}.**` → `organism.{id}` under a session (agent for write-consent, owner GHII for cross-member read). */
async function grantWorkspaceConsent(token: string, orgId: string) {
  const { status, body } = await json('/v1/consent', {
    method: 'POST', headers: bearer(token),
    body: JSON.stringify({
      data_pattern: `organism.${orgId}.**`,
      recipient: `organism.${orgId}`,
      purpose: 'project workspace',
      scope: 'private',
    }),
  });
  assert(status === 201, `consent ${status}: ${JSON.stringify(body)}`);
}

/** Register an organism-scoped schema for a namespace (mirrors applying a bundle CSM). */
async function registerObjectSchema(token: string, orgId: string, namespace: string, schema: Record<string, unknown>) {
  const key = `organism.${orgId}.${namespace}`;
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}/schema`, {
    method: 'PUT', headers: bearer(token),
    body: JSON.stringify({ schema, apply_to: 'prefix', schema_mode: 'strict' }),
  });
  assert(status === 200, `schema(${namespace}) ${status}: ${JSON.stringify(body)}`);
}

async function writeMemory(token: string, key: string, value: unknown, visibility = 'private') {
  return json('/v1/memory', {
    method: 'POST', headers: bearer(token),
    body: JSON.stringify({ key, value, visibility }),
  });
}

// ── Project bundle object schemas (compiled equivalents of docs/csm-bundles/project/*.csm.yaml) ──
const GOAL_SCHEMA = {
  type: 'object', required: ['id', 'title', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['open', 'met', 'dropped'] },
    definitionOfDone: { type: 'array', items: { type: 'string' } }, gateId: { type: 'string' },
  },
};
const PLAN_SCHEMA = {
  type: 'object', required: ['id', 'approach', 'version', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, approach: { type: 'string', minLength: 1 },
    version: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['proposed', 'approved', 'superseded'] },
    steps: { type: 'array', items: { type: 'string' } }, gateId: { type: 'string' },
  },
};
const DELIVERABLE_SCHEMA = {
  type: 'object', required: ['id', 'title', 'status'], properties: {
    id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['proposed', 'in_progress', 'delivered', 'accepted', 'rejected'] },
    description: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  },
};
const DECISION_SCHEMA = {
  type: 'object', required: ['ts', 'kind', 'by', 'summary'], properties: {
    ts: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['decision', 'plan-change', 'deliverable', 'rating'] },
    by: { type: 'string', minLength: 1 }, summary: { type: 'string', minLength: 1 },
  },
};
const RESOURCE_SCHEMA = {
  type: 'object', required: ['id', 'kind', 'label', 'origin', 'pointer', 'visibility'], properties: {
    id: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['doc', 'code', 'asset', 'knowledge', 'link'] },
    label: { type: 'string', minLength: 1 }, origin: { type: 'string', enum: ['local', 'referenced', 'link'] },
    pointer: { type: 'string', minLength: 1 }, visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'] },
  },
};

function projectManifest(orgId: string): Record<string, unknown> {
  return {
    manifestVersion: '1.0', id: orgId, name: 'Brain Test Project', kind: 'project', language: 'en',
    summary: 'A personal project brain.', status: 'active',
    entry: { readme: `organism.${orgId}.meta.readme`, loadHint: 'readme -> goal -> plan', primaryGoal: 'g1' },
    objectTypes: [
      { name: 'goal', schemaRef: 'schema:project/goal@1', namespace: 'meta.goals', cardinality: 'many', backing: 'memory', writeRole: 'owner' },
      { name: 'plan', schemaRef: 'schema:project/plan@1', namespace: 'meta.plans', cardinality: 'many', backing: 'memory', writeRole: 'owner' },
      { name: 'task', schemaRef: 'schema:project/task@1', namespace: '(tasks)', cardinality: 'many', backing: 'tasks', writeRole: 'member' },
      { name: 'deliverable', schemaRef: 'schema:project/deliverable@1', namespace: 'shared.deliverables', cardinality: 'many', backing: 'memory', writeRole: 'member' },
      { name: 'decision', schemaRef: 'schema:project/decision@1', namespace: 'meta.decisions', cardinality: 'many', backing: 'memory', writeRole: 'member', append: true },
      { name: 'resource', schemaRef: 'schema:project/resource@1', namespace: 'shared.resources', cardinality: 'many', backing: 'memory', writeRole: 'member' },
    ],
    flow: { stages: [{ id: 'g', type: 'goal', ref: 'meta.goals.g1' }], gates: [], branches: [] },
    sharing: { publicEntries: [`organism.${orgId}.meta.readme`], sharingGroups: [] },
    policy: { agentAutonomy: 'L3', alwaysGate: ['external-release'], budget: { dailyMorsels: null }, synthesis: null },
  };
}

console.log('\n=== AIMEAT Project Core (Phase 3) E2E ===\n');

// ─── State ───
let u1: Awaited<ReturnType<typeof registerOwnerAndAgent>>;
let u2: Awaited<ReturnType<typeof registerOwnerAndAgent>>;
let orgId = '';
let rsOrgId = '';

// ─── Setup ───
console.log('Setup — owners + agents');
await test('Register creator + member owners and their agents', async () => {
  u1 = await registerOwnerAndAgent('projcreator');
  u2 = await registerOwnerAndAgent('projmember');
});

await test('Create a project organism (type:project)', async () => {
  const { status, body } = await json('/v1/organisms', {
    method: 'POST', headers: bearer(u1.ownerToken),
    body: JSON.stringify({ name: 'Project Brain', description: 'M1 personal project brain', type: 'project', join_policy: 'open', visibility: 'public' }),
  });
  assert(status === 201, `create org ${status}: ${JSON.stringify(body)}`);
  orgId = body.data.organism.id;
  assert(body.data.organism.type === 'project', `type ${body.data.organism.type}`);
});

await test('Creator agent holds an organism.{id} workspace consent grant', async () => {
  await grantWorkspaceConsent(u1.agentToken, orgId);          // agent-owned → enables creator's workspace WRITES
  await grantWorkspaceConsent(u1.ownerToken, orgId);          // GHII-owned → enables fellow-member READS of creator's records
});

// ─── Manifest-format validation ───
console.log('\nManifest-format schema (global organism.*.meta.manifest)');

await test('Invalid manifest write → 422', async () => {
  const { status, body } = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.manifest`,
    { manifestVersion: '1.0', id: orgId, name: 'X', kind: 'project', status: 'BOGUS', objectTypes: [] });
  assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'SCHEMA_VALIDATION_FAILED', `code ${body.error?.code}`);
});

await test('Valid manifest write → 200/201', async () => {
  const { status, body } = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.manifest`, projectManifest(orgId));
  assert(status === 200 || status === 201, `expected 2xx, got ${status}: ${JSON.stringify(body)}`);
});

await test('Readme write (markdown, no schema) → 2xx', async () => {
  const { status } = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.readme`, '# Project Brain\nHello.');
  assert(status === 200 || status === 201, `readme ${status}`);
});

// ─── Apply template object schemas ───
console.log('\nApply template — register organism-scoped object schemas');

await test('Register the 5 project object schemas (organism-scoped)', async () => {
  await registerObjectSchema(u1.ownerToken, orgId, 'meta.goals', GOAL_SCHEMA);
  await registerObjectSchema(u1.ownerToken, orgId, 'meta.plans', PLAN_SCHEMA);
  await registerObjectSchema(u1.ownerToken, orgId, 'shared.deliverables', DELIVERABLE_SCHEMA);
  await registerObjectSchema(u1.ownerToken, orgId, 'meta.decisions', DECISION_SCHEMA);
  await registerObjectSchema(u1.ownerToken, orgId, 'shared.resources', RESOURCE_SCHEMA);
});

await test('Bundle CSMs seeded globally are fetchable', async () => {
  const { status, body } = await json('/v1/csm/project-goal');
  assert(status === 200, `csm/project-goal ${status}`);
  assert(body.data.csm.json_schema_key === 'csm.project-goal', `schema key ${body.data.csm?.json_schema_key}`);
});

// ─── Object writes (schema-gated, via generic memory API) ───
console.log('\nObject writes via POST /v1/memory (schema-gated)');

await test('Valid goal → 2xx', async () => {
  const { status, body } = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.goals.g1`,
    { id: 'g1', title: 'Combat MVP', status: 'open', definitionOfDone: ['playable demo'] });
  assert(status === 200 || status === 201, `goal ${status}: ${JSON.stringify(body)}`);
});

await test('Schema-violating goal → 422', async () => {
  const { status, body } = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.goals.g2`,
    { id: 'g2', title: 'Bad', status: 'not-a-status' });
  assert(status === 422, `expected 422, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'SCHEMA_VALIDATION_FAILED', `code ${body.error?.code}`);
});

// ─── Workspace read ───
console.log('\nGET /v1/organisms/:id/workspace');

await test('Creator reads workspace → manifest + objects + decisions/resources/todos', async () => {
  const { status, body } = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert(status === 200, `workspace ${status}: ${JSON.stringify(body)}`);
  const d = body.data;
  assert(d.manifest?.id === orgId, `manifest.id ${d.manifest?.id}`);
  assert(d.readme === '# Project Brain\nHello.', `readme ${JSON.stringify(d.readme)}`);
  assert(Array.isArray(d.objects?.goal) && d.objects.goal.length >= 1, `objects.goal ${JSON.stringify(d.objects?.goal)}`);
  assert(d.objects.goal[0].id === 'g1', `goal id ${d.objects.goal[0]?.id}`);
  assert(Array.isArray(d.decisions) && Array.isArray(d.resources) && Array.isArray(d.todos), 'decisions/resources/todos arrays present');
});

// ─── Access control ───
console.log('\nAccess control (membership + role + consent)');

await test('Non-member reads workspace → 403', async () => {
  const { status } = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u2.ownerToken) });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('Non-member meta write → 403', async () => {
  const { status } = await writeMemory(u2.ownerToken, `organism.${orgId}.meta.goals.x`, { id: 'x', title: 'nope', status: 'open' });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('Member 2 joins the organism', async () => {
  const { status, body } = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: bearer(u2.ownerToken), body: JSON.stringify({}) });
  assert(status === 201, `join ${status}: ${JSON.stringify(body)}`);
  await grantWorkspaceConsent(u2.agentToken, orgId);  // member's agent grant → enables their shared writes
});

await test('Member (non-admin) meta write → 403', async () => {
  const { status, body } = await writeMemory(u2.ownerToken, `organism.${orgId}.meta.goals.m`, { id: 'm', title: 'member goal', status: 'open' });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('Member shared deliverable write → 2xx', async () => {
  const { status, body } = await writeMemory(u2.ownerToken, `organism.${orgId}.shared.deliverables.d1`,
    { id: 'd1', title: 'Sprite pack', status: 'delivered', acceptanceCriteria: ['16 frames'] });
  assert(status === 200 || status === 201, `deliverable ${status}: ${JSON.stringify(body)}`);
});

await test('Member reads workspace → 200 (sees manifest via org consent + own deliverable)', async () => {
  const { status, body } = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u2.ownerToken) });
  assert(status === 200, `workspace ${status}: ${JSON.stringify(body)}`);
  assert(body.data.manifest?.id === orgId, `member should read manifest via org consent; got ${JSON.stringify(body.data.manifest)}`);
  assert(Array.isArray(body.data.objects?.deliverable) && body.data.objects.deliverable.some((x: any) => x.id === 'd1'), 'member sees own deliverable');
});

// ─── Genericity: a different kind on the same engine ───
console.log('\nGenericity — a research-study manifest, same engine, zero core change');

await test('Create a second organism + research-study manifest', async () => {
  const c = await json('/v1/organisms', {
    method: 'POST', headers: bearer(u1.ownerToken),
    body: JSON.stringify({ name: 'Climate Study', type: 'project', join_policy: 'open', visibility: 'public' }),
  });
  assert(c.status === 201, `org2 ${c.status}: ${JSON.stringify(c.body)}`);
  rsOrgId = c.body.data.organism.id;
  await grantWorkspaceConsent(u1.agentToken, rsOrgId);

  // Different object vocabulary — hypothesis + finding (no goal/plan/deliverable anywhere).
  await registerObjectSchema(u1.ownerToken, rsOrgId, 'shared.hypotheses', {
    type: 'object', required: ['id', 'statement', 'status'], properties: {
      id: { type: 'string', minLength: 1 }, statement: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['proposed', 'testing', 'supported', 'refuted'] },
    },
  });

  const m = await writeMemory(u1.ownerToken, `organism.${rsOrgId}.meta.manifest`, {
    manifestVersion: '1.0', id: rsOrgId, name: 'Ilmastodata-tutkimus', kind: 'research-study', language: 'en',
    summary: 'Nordic climate-data co-analysis.', status: 'active',
    objectTypes: [
      { name: 'hypothesis', schemaRef: 'schema:study/hypothesis@1', namespace: 'shared.hypotheses', cardinality: 'many', backing: 'memory', writeRole: 'member' },
      { name: 'finding', schemaRef: 'schema:study/finding@1', namespace: 'shared.findings', cardinality: 'many', backing: 'memory', writeRole: 'member' },
    ],
    flow: { stages: [{ id: 'h', type: 'hypothesis' }], gates: [], branches: [] },
  });
  assert(m.status === 200 || m.status === 201, `research manifest ${m.status}: ${JSON.stringify(m.body)}`);
});

await test('Write a hypothesis instance → 2xx', async () => {
  const { status, body } = await writeMemory(u1.ownerToken, `organism.${rsOrgId}.shared.hypotheses.h1`,
    { id: 'h1', statement: 'Warming accelerates in the north', status: 'testing' });
  assert(status === 200 || status === 201, `hypothesis ${status}: ${JSON.stringify(body)}`);
});

await test('Workspace reads the research-study identically (objects.hypothesis)', async () => {
  const { status, body } = await json(`/v1/organisms/${rsOrgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert(status === 200, `workspace ${status}: ${JSON.stringify(body)}`);
  assert(body.data.manifest?.kind === 'research-study', `kind ${body.data.manifest?.kind}`);
  assert(Array.isArray(body.data.objects?.hypothesis) && body.data.objects.hypothesis.some((x: any) => x.id === 'h1'),
    `objects.hypothesis ${JSON.stringify(body.data.objects?.hypothesis)}`);
  // Proof of genericity: no project-only types leak in.
  assert(body.data.objects.goal === undefined, 'no project goal type in a research-study workspace');
});

// ─── Versioning: draft → publish → .version.N + .latest ───
console.log('\nVersioning — draft / publish / history');

const publish = (token: string, ns: string, instance: string) =>
  json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ namespace: ns, id: instance }) });

await test('Draft write shows under drafts, not objects', async () => {
  const w = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.goals.gv1.draft`, { id: 'gv1', title: 'Versioned goal', status: 'open' });
  assert(w.status === 200 || w.status === 201, `draft ${w.status}: ${JSON.stringify(w.body)}`);
  const { body } = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert(Array.isArray(body.data.drafts?.goal) && body.data.drafts.goal.some((x: any) => x.id === 'gv1'), 'draft surfaced in drafts.goal');
  assert(!(body.data.objects?.goal ?? []).some((x: any) => x.id === 'gv1'), 'unpublished draft NOT in objects.goal');
});

await test('Publish (permissive) → version 1 + latest, appears in objects', async () => {
  const p = await publish(u1.ownerToken, 'meta.goals', 'gv1');
  assert(p.status === 200, `publish ${p.status}: ${JSON.stringify(p.body)}`);
  assert(p.body.data.version === 1, `version ${p.body.data.version}`);
  const { body } = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert((body.data.objects?.goal ?? []).some((x: any) => x.id === 'gv1'), 'published goal now in objects.goal');
});

await test('Edit draft + publish again → version 2; history retained', async () => {
  await writeMemory(u1.ownerToken, `organism.${orgId}.meta.goals.gv1.draft`, { id: 'gv1', title: 'Versioned goal v2', status: 'met' });
  const p = await publish(u1.ownerToken, 'meta.goals', 'gv1');
  assert(p.status === 200 && p.body.data.version === 2, `expected v2, got ${p.body.data?.version}`);
  const { body } = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.meta.goals.gv1.version.`)}`, { headers: bearer(u1.ownerToken) });
  const versionKeys = body.data.items.map((i: any) => i.key);
  assert(versionKeys.includes(`organism.${orgId}.meta.goals.gv1.version.1`), 'version.1 retained');
  assert(versionKeys.includes(`organism.${orgId}.meta.goals.gv1.version.2`), 'version.2 created');
  const latest = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.meta.goals.gv1.latest`)}`, { headers: bearer(u1.ownerToken) });
  assert(latest.body.data.value.title === 'Versioned goal v2', `latest reflects edit: ${latest.body.data.value?.title}`);
});

await test('Publishing with no draft → 404', async () => {
  const p = await publish(u1.ownerToken, 'meta.goals', 'does-not-exist');
  assert(p.status === 404, `expected 404, got ${p.status}`);
});

// ─── Publish gate (configurable via meta.config; default off) ───
console.log('\nPublish gate (opt-in via meta.config)');

await test('Turn on the publish gate in meta.config', async () => {
  const w = await writeMemory(u1.ownerToken, `organism.${orgId}.meta.config`, { gates: { publish: { enabled: true, approverRole: 'owner' } } });
  assert(w.status === 200 || w.status === 201, `config ${w.status}: ${JSON.stringify(w.body)}`);
});

let gatedApprovalId = '';
await test('Publish while gated → 202 pending (not yet published)', async () => {
  await writeMemory(u1.ownerToken, `organism.${orgId}.meta.goals.gv2.draft`, { id: 'gv2', title: 'Gated goal', status: 'open' });
  const p = await publish(u1.ownerToken, 'meta.goals', 'gv2');
  assert(p.status === 202, `expected 202, got ${p.status}: ${JSON.stringify(p.body)}`);
  assert(p.body.data.gated === true, 'gated true');
  gatedApprovalId = p.body.data.approval.id;
  const w = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert(!(w.body.data.objects?.goal ?? []).some((x: any) => x.id === 'gv2'), 'gv2 not published until approved');
});

await test('Approval inbox lists the pending publish', async () => {
  const { body } = await json(`/v1/organisms/${orgId}/approvals?status=pending`, { headers: bearer(u1.ownerToken) });
  assert(body.data.approvals.some((a: any) => a.id === gatedApprovalId && a.action === 'publish'), 'pending publish in inbox');
});

await test('Non-approver (member) cannot resolve → 403', async () => {
  const r = await json(`/v1/organisms/${orgId}/approvals/${gatedApprovalId}`, { method: 'POST', headers: bearer(u2.ownerToken), body: JSON.stringify({ decision: 'approve' }) });
  assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('Approver approves → draft is published', async () => {
  const r = await json(`/v1/organisms/${orgId}/approvals/${gatedApprovalId}`, { method: 'POST', headers: bearer(u1.ownerToken), body: JSON.stringify({ decision: 'approve' }) });
  assert(r.status === 200, `resolve ${r.status}: ${JSON.stringify(r.body)}`);
  const w = await json(`/v1/organisms/${orgId}/workspace`, { headers: bearer(u1.ownerToken) });
  assert((w.body.data.objects?.goal ?? []).some((x: any) => x.id === 'gv2'), 'gv2 published after approval');
});

// ─── Generic gate primitive (auto vs gate, via autonomy + alwaysGate floor) ───
console.log('\nGeneric approvals (autonomy + always-gate floor)');

await test('Low-risk action auto-approves (default autonomy)', async () => {
  const r = await json(`/v1/organisms/${orgId}/approvals`, { method: 'POST', headers: bearer(u1.ownerToken), body: JSON.stringify({ action: 'flow:advance', risk: 'low' }) });
  assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.gated === false && r.body.data.approval.status === 'approved', 'auto-approved');
});

await test('Always-gate action pauses even at low risk', async () => {
  // The org manifest's policy.alwaysGate is ['external-release'] — that floor gates regardless of risk.
  const r = await json(`/v1/organisms/${orgId}/approvals`, { method: 'POST', headers: bearer(u1.ownerToken), body: JSON.stringify({ action: 'external-release', risk: 'low' }) });
  assert(r.status === 201, `create ${r.status}`);
  assert(r.body.data.gated === true && r.body.data.approval.status === 'pending', 'always-gate floor held');
});

// ─── Manifest Architect prompt (the generator "good prompt") ───
console.log('\nManifest Architect prompt (managed, public)');

await test('manifest-architect prompt is seeded + fetchable', async () => {
  const { status, body } = await json('/v1/portal/prompts/manifest-architect');
  assert(status === 200, `prompt ${status}: ${JSON.stringify(body)}`);
  assert(typeof body.data.prompt === 'string' && body.data.prompt.includes('objectTypes'), 'prompt content present');
  assert(body.data.category === 'builders', `group ${body.data.category}`);
});

await test('manifest-architect appears in portal prompt packages', async () => {
  const { status, body } = await json('/v1/portal/prompts');
  assert(status === 200, `list ${status}`);
  assert(body.data.packages.some((p: any) => p.id === 'manifest-architect'), 'manifest-architect in package list');
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Delete creator (cascade)', async () => {
  const { status } = await json(`/v1/owners/${u1.ownerName}`, { method: 'DELETE', headers: bearer(u1.ownerToken) });
  assert(status === 200, `delete u1 ${status}`);
});
await test('Delete member (cascade)', async () => {
  const { status } = await json(`/v1/owners/${u2.ownerName}`, { method: 'DELETE', headers: bearer(u2.ownerToken) });
  assert(status === 200, `delete u2 ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
