/**
 * @file e2e-ecosystem-automation-recipe.ts
 * @description E2E tests for the ecosystem-app automation recipe (feature B4): a per-(owner, app)
 *   rule that, when the connected app publishes refined data on a memory key matching the recipe's
 *   keyGlob, materialises an agent task for each configured agent. Covers:
 *     (a) PUT recipe → GET returns it;
 *     (b) PUT naming an agent that isn't the owner's → rejected (UNKNOWN_AGENT);
 *     (c) PUT for an app that isn't connected → 404 (ECO_APP_NOT_FOUND);
 *     (d) THE TRIGGER: with an enabled recipe (keyGlob feedback.stats.*, agents:[the owner's agent]),
 *         write a memory key matching the glob → an agent task is materialised for that agent;
 *     (e) a non-matching key → no task; a disabled recipe → no task;
 *     (f) DELETE → GET null.
 *   The deposit is simulated by the OWNER writing the memory key (owner namespace = owner@node, which
 *   the trigger resolves to the same bare owner the recipe is keyed by). A fully-connected GEAI is NOT
 *   required to exercise the trigger — the recipe is owner-scoped and fires on any matching owner write.
 * @version-history
 *   v1.0.0 — 2026-06-15 — Initial creation (B4 recipe CRUD + the data-published → agent-task trigger).
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-automation-recipe

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) { await sleep(Number(res.headers.get('Retry-After') || '5') * 1000 + 500); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getOwnerToken(owner: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// ─── State ───
const ownerName = `ecorecipe${Date.now()}`;
let ownerToken = '';
const APP = 'feedbackdesk';
const AGENT = 'wisdombot';
const APP_PUBKEY = Buffer.from('eco-recipe-verification-key-placeholder').toString('base64');

console.log('\n=== AIMEAT Ecosystem-App Automation Recipe (B4) E2E Test ===\n');
console.log(`Base: ${BASE}`);
console.log(`Node: ${NODE_ID}\n`);

// ─── Setup: owner + one agent + connect the app ───
console.log('Setup — Owner, agent, connected app');

await test('Register owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await getOwnerToken(ownerName, body.data.private_key);
  assert(ownerToken.length > 0, 'got owner token');
});

await test('Register an agent (wisdombot)', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: AGENT, owner: ownerName, capabilities: ['memory', 'actions'] }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.agent.gaii === `${AGENT}#${ownerName}@${NODE_ID}`, `unexpected gaii: ${body.data.agent.gaii}`);
});

let deviceCode = '';
let userCode = '';

await test('App says hello with an automation hint', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName, app: APP, display_name: 'Feedback Desk', public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      manifest: {
        app: APP, scopes: ['memory:read', 'memory:write'],
        capabilities: [{ id: 'publish-stats' }],
        automation: { schedulable: [{ id: 'publish-stats', produces: 'feedback.stats', cadences: ['weekly'] }] },
      },
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  deviceCode = body.data.device_code;
  userCode = body.data.user_code;
  assert(!!deviceCode && !!userCode, 'got codes');
});

await test('Owner approves the app', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${userCode}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.status === 'approved', `expected approved: ${JSON.stringify(body)}`);
});

await test('App polls its credential (completes the handshake)', async () => {
  const { status } = await json('/v1/ecosystem-apps/token', {
    method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }),
  });
  assert(status === 200, `token pickup status ${status}`);
});

// ─── (a) PUT recipe → GET returns it ───
console.log('\n(a) PUT recipe → GET returns it');

await test('PUT recipe → 200, persisted with the agent + glob', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      agents: [AGENT],
      trigger: { keyGlob: 'feedback.stats.*' },
      organism: 'support-ops', email: true, require_approval: false, enabled: true,
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const r = body.data.recipe;
  assert(!!r && !!r.id, 'recipe has an id');
  assert(r.app === APP, `app mismatch: ${r.app}`);
  assert(r.trigger.kind === 'data-published', `trigger.kind: ${r.trigger.kind}`);
  assert(r.trigger.keyGlob === 'feedback.stats.*', `keyGlob: ${r.trigger.keyGlob}`);
  assert(Array.isArray(r.agents) && r.agents[0] === AGENT, `agents: ${JSON.stringify(r.agents)}`);
  assert(r.organism === 'support-ops', `organism stored: ${r.organism}`);
  assert(r.email === true, `email stored: ${r.email}`);
  assert(r.enabled === true, `enabled: ${r.enabled}`);
});

await test('GET recipe → returns the stored recipe', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
  assert(body.data.recipe && body.data.recipe.app === APP, `recipe not returned: ${JSON.stringify(body.data)}`);
  assert(body.data.recipe.agents[0] === AGENT, 'agent round-trips');
});

await test('PUT again (upsert) keeps the same recipe id', async () => {
  const before = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const id1 = before.body.data.recipe.id;
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' }, enabled: true }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.recipe.id === id1, `upsert should keep id ${id1}, got ${body.data.recipe.id}`);
});

// ─── (b) Unknown agent → rejected ───
console.log('\n(b) PUT with an agent that is not the owner\'s → rejected');

await test('PUT with an unknown agent → 400 UNKNOWN_AGENT', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: ['not-my-agent'], trigger: { keyGlob: 'feedback.stats.*' }, enabled: true }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'UNKNOWN_AGENT', `expected UNKNOWN_AGENT, got ${body.error?.code}`);
});

// ─── (c) App not connected → 404 ───
console.log('\n(c) PUT for an app the owner never connected → 404');

await test('PUT for an unconnected app → 404 ECO_APP_NOT_FOUND', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/neverconnected/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'x.*' }, enabled: true }),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'ECO_APP_NOT_FOUND', `expected ECO_APP_NOT_FOUND, got ${body.error?.code}`);
});

// ─── (d) THE TRIGGER: matching write → agent task materialised ───
console.log('\n(d) Trigger: a matching memory write materialises an agent task');

async function countTasks(): Promise<{ total: number; matching: number }> {
  const { body } = await json(`/v1/agents/${AGENT}/tasks`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const tasks = (body.data?.tasks ?? []) as any[];
  const matching = tasks.filter(t => /^Process feedbackdesk data:/.test(t.title ?? ''));
  return { total: tasks.length, matching: matching.length };
}

await test('Writing feedback.stats.weekly → a task is materialised for wisdombot', async () => {
  const before = await countTasks();
  // Simulate the app's deposit: the owner writes a key matching the recipe glob.
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: 'feedback.stats.weekly', value: { resolved: 42, csat: 4.6 }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `memory write status ${w.status}: ${JSON.stringify(w.body)}`);
  // The trigger fires asynchronously after the write response; poll briefly.
  let after = before;
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    after = await countTasks();
    if (after.matching > before.matching) break;
  }
  assert(after.matching === before.matching + 1, `expected 1 new task, before=${before.matching} after=${after.matching}`);
});

// ─── (e) Non-matching key → no task; disabled recipe → no task ───
console.log('\n(e) Non-matching key + disabled recipe → no task');

await test('Writing a NON-matching key → no new task', async () => {
  const before = await countTasks();
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: 'unrelated.note', value: 'hello', visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}`);
  await sleep(1500);
  const after = await countTasks();
  assert(after.matching === before.matching, `non-matching key must not spawn a task: before=${before.matching} after=${after.matching}`);
});

await test('Disable the recipe → a matching write spawns NO task', async () => {
  const upd = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' }, enabled: false }),
  });
  assert(upd.status === 200, `disable status ${upd.status}`);
  const before = await countTasks();
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: 'feedback.stats.daily', value: { x: 1 }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}`);
  await sleep(1500);
  const after = await countTasks();
  assert(after.matching === before.matching, `disabled recipe must not spawn a task: before=${before.matching} after=${after.matching}`);
});

// ─── (f) DELETE → GET null ───
console.log('\n(f) DELETE → GET null');

await test('DELETE recipe → 200', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.deleted === true, 'deleted flag set');
});

await test('GET after delete → recipe is null', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
  assert(body.data.recipe === null, `expected null, got ${JSON.stringify(body.data.recipe)}`);
});

await test('DELETE again → 404 (idempotency surface)', async () => {
  const { status } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `expected 404, got ${status}`);
});

// ─── Summary ───
console.log('\n' + '─'.repeat(48));
console.log(`Ecosystem-App Automation Recipe E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!\n');
