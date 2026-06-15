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
 *     (g) B5 ORGANISM ROUTING: a recipe with an organism stamps the materialised task with it (in the
 *         `automation` metadata, the prompt/description, and a scope entry); a null-organism recipe
 *         leaves the task with no organism;
 *     (h) B6 EMAIL/REPORT ON COMPLETION: with email:true, driving the task to DONE (owner start→complete)
 *         writes an in-app `automation.reports.*` record for the owner; with email:false it writes none.
 *     (f) DELETE → GET null.
 *   The deposit is simulated by the OWNER writing the memory key (owner namespace = owner@node, which
 *   the trigger resolves to the same bare owner the recipe is keyed by). A fully-connected GEAI is NOT
 *   required to exercise the trigger — the recipe is owner-scoped and fires on any matching owner write.
 *   B6 NOTE: the actual SMTP email needs live SMTP + an owner notification email; without SMTP the node
 *   logs "email skipped (not configured)" and only writes the in-app report — which is what (h) asserts.
 * @version-history
 *   v1.0.0 — 2026-06-15 — Initial creation (B4 recipe CRUD + the data-published → agent-task trigger).
 *   v1.1.0 — 2026-06-15 — Add B5 (organism routing) + B6 (email/in-app report on completion) coverage.
 *   v1.2.0 — 2026-06-15 — Add B7/B8 (advisory outbox drain + approval gate + deliver-advisory) coverage:
 *     (i) requireApproval=false drains+attempts delivery (offline-retry leaves the outbox key);
 *     requireApproval=true moves the advisory to pending (payload survives), approve returns 202
 *     offline-retry + stays pending with no tunnel, reject drops it. Live tunnel needed for a 200
 *     `delivery: delivered` + the immediate-delivery happy path (documented inline).
 *   v1.3.0 — 2026-06-15 — The hello manifest now carries automation.schedulable[].produces_key
 *     ('feedback.stats', the deposit KEY PREFIX) alongside produces ('feedback-stats@1', a schema ref);
 *     added a test asserting a PUT with NO trigger derives the default keyGlob from produces_key
 *     (so the recipe actually fires on the app's deposit key).
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
        // `produces` is a SCHEMA ref (NOT a deposit key); `produces_key` is the deposit KEY PREFIX.
        // The node's defaultKeyGlob must prefer produces_key so the trigger glob actually matches.
        automation: { schedulable: [{ id: 'publish-stats', produces: 'feedback-stats@1', produces_key: 'feedback.stats', cadences: ['weekly'] }] },
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

await test('PUT with NO trigger → default keyGlob derives from automation produces_key', async () => {
  // Omit trigger entirely: the node must derive the default glob from the app's automation hint,
  // preferring produces_key ('feedback.stats') over produces ('feedback-stats@1', a schema ref).
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], enabled: true }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.recipe.trigger.keyGlob === 'feedback.stats.*',
    `default keyGlob must come from produces_key, got: ${body.data.recipe.trigger.keyGlob}`);
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

// ─── (g) B5: organism routing — the materialised task carries the organism ───
console.log('\n(g) B5: the materialised task carries the recipe organism (metadata + prompt + scope)');

// Fetch the raw task records (the list returns the stored AgentTaskRecord, incl. `automation`).
async function listTasks(): Promise<any[]> {
  const { body } = await json(`/v1/agents/${AGENT}/tasks?per_page=200`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  return (body.data?.tasks ?? []) as any[];
}
function newestMatchingTask(tasks: any[]): any | undefined {
  return tasks
    .filter(t => /^Process feedbackdesk data:/.test(t.title ?? ''))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0];
}

await test('Re-enable the recipe WITH an organism → matching write stamps the task with it', async () => {
  const upd = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' },
      organism: 'support-ops', email: false, enabled: true,
    }),
  });
  assert(upd.status === 200, `re-enable status ${upd.status}: ${JSON.stringify(upd.body)}`);

  const before = newestMatchingTask(await listTasks());
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: 'feedback.stats.monthly', value: { resolved: 7 }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}`);

  let task: any;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    task = newestMatchingTask(await listTasks());
    if (task && (!before || task.id !== before.id)) break;
  }
  assert(!!task && (!before || task.id !== before.id), 'a new task was materialised');
  // (1) metadata: the task carries the recipe provenance + organism + toggles
  assert(!!task.automation, `task should carry automation metadata: ${JSON.stringify(task.automation)}`);
  assert(task.automation.organism === 'support-ops', `automation.organism: ${task.automation?.organism}`);
  assert(task.automation.app === APP, `automation.app: ${task.automation?.app}`);
  assert(task.automation.email === false, `automation.email: ${task.automation?.email}`);
  assert(typeof task.automation.recipeId === 'string' && task.automation.recipeId.length > 0, 'automation.recipeId set');
  // (2) prompt: the description tells the agent WHERE to write
  assert(/support-ops/.test(task.description ?? ''), `description should name the organism: ${task.description}`);
  // (3) scope: an organism scope entry is present
  const orgScope = (task.scope ?? []).find((s: any) => s.name === 'organism');
  assert(!!orgScope && orgScope.value === 'support-ops', `organism scope entry: ${JSON.stringify(orgScope)}`);
});

await test('Recipe with NULL organism → the task carries no organism', async () => {
  const upd = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' }, organism: null, email: false, enabled: true }),
  });
  assert(upd.status === 200, `status ${upd.status}`);

  const before = newestMatchingTask(await listTasks());
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: 'feedback.stats.noorg', value: { x: 1 }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}`);

  let task: any;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    task = newestMatchingTask(await listTasks());
    if (task && (!before || task.id !== before.id)) break;
  }
  assert(!!task && (!before || task.id !== before.id), 'a new task was materialised');
  assert(!task.automation?.organism, `no organism expected: ${task.automation?.organism}`);
  assert(!/Write your report and any/.test(task.description ?? ''), 'description must not include the organism routing line');
});

// ─── (h) B6: email/in-app report on completion ───
console.log('\n(h) B6: completing an automation task with email:true writes an in-app report record');

// Read the owner's automation report records (the SMTP-free observable; email itself needs SMTP).
async function listReports(): Promise<any[]> {
  const { body } = await json('/v1/memory?prefix=automation.reports.', { headers: { Authorization: `Bearer ${ownerToken}` } });
  return (body.data?.items ?? []) as any[];
}

// Drive one automation task to completion (owner starts queued→active, then completes active→done).
async function materialiseAndComplete(emailFlag: boolean, key: string): Promise<{ taskId: string }> {
  const upd = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' }, organism: 'support-ops', email: emailFlag, enabled: true }),
  });
  assert(upd.status === 200, `recipe set status ${upd.status}`);

  const before = newestMatchingTask(await listTasks());
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key, value: { ok: true }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `write status ${w.status}`);

  let task: any;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    task = newestMatchingTask(await listTasks());
    if (task && (!before || task.id !== before.id)) break;
  }
  assert(!!task && (!before || task.id !== before.id), 'a new task was materialised');

  // queued → active
  const start = await json(`/v1/agents/${AGENT}/tasks/${task.id}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(start.status === 200, `start status ${start.status}: ${JSON.stringify(start.body)}`);
  // active → done (fires B6)
  const done = await json(`/v1/agents/${AGENT}/tasks/${task.id}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ message: 'Analysis done: 7 tickets, CSAT steady.' }),
  });
  assert(done.status === 200, `complete status ${done.status}: ${JSON.stringify(done.body)}`);
  return { taskId: task.id };
}

await test('email:true → completing the task writes an automation report record for the owner', async () => {
  const before = (await listReports()).length;
  const { taskId } = await materialiseAndComplete(true, 'feedback.stats.report1');
  // B6 runs fire-and-forget after the complete response; poll the in-app reports.
  let reports: any[] = [];
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    reports = await listReports();
    if (reports.length > before) break;
  }
  assert(reports.length > before, `expected a new automation report, before=${before} after=${reports.length}`);
  const mine = reports.find(r => (r.value?.taskId ?? r.taskId) === taskId);
  assert(!!mine, `the report for task ${taskId} should exist: ${JSON.stringify(reports.map(r => r.key))}`);
  const v = mine.value ?? mine;
  assert(v.app === APP, `report.app: ${v.app}`);
  assert(v.type === 'automation-report', `report.type: ${v.type}`);
  assert((v.message ?? '').includes('Analysis done'), `report carries the completion message: ${v.message}`);
  // NOTE: the EMAIL itself needs live SMTP + an owner notification email; without SMTP the node logs
  // "email skipped (not configured)" and only the in-app record is written. This test asserts the
  // SMTP-free observable (the report record). The actual email send is covered only with SMTP.
});

await test('email:false → completing the task writes NO automation report record', async () => {
  const before = (await listReports()).length;
  await materialiseAndComplete(false, 'feedback.stats.report2');
  await sleep(2500); // give any (incorrect) fire-and-forget write time to land
  const after = (await listReports()).length;
  assert(after === before, `email:false must not write a report: before=${before} after=${after}`);
});

// ─── (i) B7/B8: advisory outbox drain + approval gate + delivery ───
// The wisdom agent writes `support-advisory@1` payloads to eco.<app>.advisory.outbox.<id> during its
// run; the completion hook drains that outbox. We SEED the outbox (the owner writing the same key the
// agent would) and then complete an automation task to fire the drain.
//
// LIVE-TUNNEL NOTE: the harness has no connected GEAI / connect-tunnel, so deliverAdvisory() returns
// `offline-retry` for every invoke. We therefore assert the DECISION + path, not a live delivery:
//   - requireApproval=false → drain attempts delivery, gets offline-retry → the outbox key is LEFT for
//     retry (we assert it survives), and the advisory is NOT moved to pending.
//   - requireApproval=true  → drain moves the advisory to eco.<app>.advisory.pending.<id> (payload
//     survives, outbox drained) and it appears in the owner's pending list; approve returns 202
//     offline-retry and the item STAYS pending (delivery couldn't complete with no tunnel); a separate
//     reject case resolves + drops without delivery.
// A live GEAI on the tunnel is needed to fully verify a 200 `delivery: delivered` from approve and the
// immediate-delivery happy path (outbox key removed on success).
console.log('\n(i) B7/B8: advisory outbox drain + approval gate (offline-tunnel decision coverage)');

async function readMemoryKey(key: string): Promise<{ status: number; value: any }> {
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  return { status, value: body.data?.value ?? body.data ?? null };
}
async function listPendingAdvisories(): Promise<any[]> {
  const { body } = await json(`/v1/ecosystem-apps/${APP}/advisories/pending`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  return (body.data?.pending ?? []) as any[];
}
function sampleAdvisory(id: string) {
  return { id, title: 'Reduce reply latency', body: 'Median first-reply is up 40%.', kind: 'recommendation', severity: 'medium', source: APP };
}
// Seed an outbox key, set the recipe's approval flag, then materialise+complete a task to fire the drain.
async function seedAndDrain(opts: { requireApproval: boolean; advisoryId: string; triggerKey: string }): Promise<void> {
  // Seed the outbox under the OWNER namespace (the same place + key the wisdom agent writes to).
  const outboxKey = `eco.${APP}.advisory.outbox.${opts.advisoryId}`;
  const seed = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: outboxKey, value: sampleAdvisory(opts.advisoryId), visibility: 'owner' }),
  });
  assert(seed.status === 200 || seed.status === 201, `seed outbox status ${seed.status}: ${JSON.stringify(seed.body)}`);

  // Configure the recipe with the desired approval flag, then materialise + complete an automation task.
  const upd = await json(`/v1/ecosystem-apps/${APP}/automation/recipe`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [AGENT], trigger: { keyGlob: 'feedback.stats.*' }, organism: null, email: false, require_approval: opts.requireApproval, enabled: true }),
  });
  assert(upd.status === 200, `recipe set status ${upd.status}: ${JSON.stringify(upd.body)}`);

  const before = newestMatchingTask(await listTasks());
  const w = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: opts.triggerKey, value: { ok: true }, visibility: 'owner' }),
  });
  assert(w.status === 200 || w.status === 201, `trigger write status ${w.status}`);

  let task: any;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    task = newestMatchingTask(await listTasks());
    if (task && (!before || task.id !== before.id)) break;
  }
  assert(!!task && (!before || task.id !== before.id), 'a new automation task was materialised');

  const start = await json(`/v1/agents/${AGENT}/tasks/${task.id}/start`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(start.status === 200, `start status ${start.status}`);
  const done = await json(`/v1/agents/${AGENT}/tasks/${task.id}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ message: 'done' }),
  });
  assert(done.status === 200, `complete status ${done.status}: ${JSON.stringify(done.body)}`);
}

await test('requireApproval=false → drain attempts delivery; with no tunnel the outbox key is LEFT for retry', async () => {
  const advisoryId = `adv-immediate-${Date.now()}`;
  await seedAndDrain({ requireApproval: false, advisoryId, triggerKey: 'feedback.stats.advimm' });
  // The drain runs fire-and-forget after /complete; give it time, then assert the outbox key survived
  // (offline → left for retry) and was NOT moved to the pending list.
  await sleep(2500);
  const outbox = await readMemoryKey(`eco.${APP}.advisory.outbox.${advisoryId}`);
  assert(outbox.status === 200, `outbox key should remain (offline-retry), got status ${outbox.status}`);
  assert(outbox.value?.id === advisoryId, `outbox advisory should survive: ${JSON.stringify(outbox.value)}`);
  const pending = await listPendingAdvisories();
  assert(!pending.some(p => p.id === advisoryId), 'no-approval advisory must NOT appear in the pending list');
});

await test('requireApproval=true → completion moves the advisory to pending (payload survives, outbox drained)', async () => {
  const advisoryId = `adv-gated-${Date.now()}`;
  await seedAndDrain({ requireApproval: true, advisoryId, triggerKey: 'feedback.stats.advgated' });
  // Poll the pending list until the drain parks it.
  let pending: any[] = [];
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    pending = await listPendingAdvisories();
    if (pending.some(p => p.id === advisoryId)) break;
  }
  const mine = pending.find(p => p.id === advisoryId);
  assert(!!mine, `gated advisory should appear in the pending list: ${JSON.stringify(pending.map(p => p.id))}`);
  assert(mine.status === 'pending', `pending status: ${mine.status}`);
  assert(mine.advisory?.title === 'Reduce reply latency', `pending advisory payload survives: ${JSON.stringify(mine.advisory)}`);
  assert(mine.app === APP, `pending app: ${mine.app}`);
  // The outbox key was drained (moved to pending).
  const outbox = await readMemoryKey(`eco.${APP}.advisory.outbox.${advisoryId}`);
  assert(outbox.status === 404, `outbox key should be drained after gating, got status ${outbox.status}`);
});

await test('Approve a gated advisory → 202 offline-retry with no tunnel; it STAYS pending (no payload loss)', async () => {
  const advisoryId = `adv-approve-${Date.now()}`;
  await seedAndDrain({ requireApproval: true, advisoryId, triggerKey: 'feedback.stats.advapprove' });
  let pending: any[] = [];
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    pending = await listPendingAdvisories();
    if (pending.some(p => p.id === advisoryId)) break;
  }
  assert(pending.some(p => p.id === advisoryId), 'advisory parked for approval');

  const appr = await json(`/v1/ecosystem-apps/${APP}/advisories/${advisoryId}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  // No connected GEAI/tunnel in the harness → delivery cannot complete → 202, stays pending for retry.
  assert(appr.status === 202, `expected 202 offline-retry (no tunnel), got ${appr.status}: ${JSON.stringify(appr.body)}`);
  assert(appr.body.data?.delivery === 'offline-retry' || appr.body.data?.delivery === 'failed', `delivery outcome: ${JSON.stringify(appr.body.data)}`);
  // It must still be pending (so a later approve, once the app is online, can deliver it).
  const after = await listPendingAdvisories();
  assert(after.some(p => p.id === advisoryId), 'a deferred-delivery advisory must remain pending for retry');
});

await test('Reject a gated advisory → 200 rejected, dropped, NO delivery', async () => {
  const advisoryId = `adv-reject-${Date.now()}`;
  await seedAndDrain({ requireApproval: true, advisoryId, triggerKey: 'feedback.stats.advreject' });
  let pending: any[] = [];
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    pending = await listPendingAdvisories();
    if (pending.some(p => p.id === advisoryId)) break;
  }
  assert(pending.some(p => p.id === advisoryId), 'advisory parked for rejection');

  const rej = await json(`/v1/ecosystem-apps/${APP}/advisories/${advisoryId}/reject`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(rej.status === 200, `reject status ${rej.status}: ${JSON.stringify(rej.body)}`);
  assert(rej.body.data?.status === 'rejected', `expected rejected: ${JSON.stringify(rej.body.data)}`);
  // Gone from the pending list + the pending memory key removed.
  const after = await listPendingAdvisories();
  assert(!after.some(p => p.id === advisoryId), 'rejected advisory must leave the pending list');
  const pk = await readMemoryKey(`eco.${APP}.advisory.pending.${advisoryId}`);
  assert(pk.status === 404, `rejected advisory pending key should be deleted, got status ${pk.status}`);
});

await test('Approve a non-existent advisory → 404', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/advisories/nope-${Date.now()}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
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
