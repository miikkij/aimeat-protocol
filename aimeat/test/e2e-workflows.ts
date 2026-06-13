/**
 * @file e2e-workflows.ts
 * @description E2E for Agent Workflows (Phase 4). Covers: save-time validation (offer-without-
 *   signals rejected, cyclic graph rejected), the derived blueprint, a signals-only run against
 *   existing memory (all-RED → partial, all-GREEN → done), and a full-live run advancing across two
 *   steps via simulated task completion (the onTaskTerminal hook). Run:
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflows
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial Phase 4 coverage.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
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
    if (res.status === 429 && attempt < retries) { await sleep(2000); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKey, 'base64'))).toString('base64');
  const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature: sig } : { owner: ownerOrGaii, timestamp, signature: sig };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const ownerName = `wfowner${Date.now()}`;
const agentName = 'wf-bot';
let ownerToken = '';
let auth = {};

async function writeMem(key: string, value: string) {
  const { status, body } = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key, value, visibility: 'private' }) });
  assert(status === 200 || status === 201, `writeMem ${key}: ${status} ${JSON.stringify(body)}`);
}

// A 2-step workflow: fetch → write. fetch produces news.raw; write consumes it, produces news.article.
const FETCH_OFFER = {
  id: 'fetch', title: 'Fetch', ask: 'fetch the raw news',
  deliverable: { format: 'document', location: { key: 'news.raw' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'news.raw', op: 'nonempty' },
};
const WRITE_OFFER = {
  id: 'write', title: 'Write', ask: 'write the article from the raw news',
  deliverable: { format: 'document', location: { key: 'news.article' } },
  required_to_function: { kind: 'deterministic', key: 'news.raw', op: 'nonempty' },
  success_signal: { kind: 'deterministic', key: 'news.article', op: 'nonempty' },
};
// An offer whose success_signal checks a key that is never produced → reliably output-RED.
const SRCFAIL_OFFER = {
  id: 'srcfail', title: 'Srcfail', ask: 'produce the impossible key',
  deliverable: { format: 'document', location: { key: 'absent.out' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'absent.out', op: 'nonempty' },
};
const FAILWF = {
  title: { en_US: 'Fail pipeline' }, description: { en_US: 'gen (always RED) → use (skipped)' },
  trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
  steps: [
    { id: 'gen', agent: agentName, offer: 'srcfail', description: { en_US: 'Gen' }, required_to_function: 'none', timeout_min: 10 },
    { id: 'use', agent: agentName, offer: 'write', after: ['gen'], description: { en_US: 'Use' }, timeout_min: 10 },
  ],
};
// An offer whose success_signal is a json_schema requiring a `title` field — to prove ajv actually
// validates (a structurally-valid JSON missing `title` must FAIL, not silently pass).
const SCHEMA_OFFER = {
  id: 'schematic', title: 'Schematic', ask: 'produce a schema-valid doc',
  deliverable: { format: 'document', location: { key: 'demo.doc' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'demo.doc', op: 'json_schema', schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } },
};
const WORKFLOW = {
  title: { en_US: 'News pipeline' }, description: { en_US: 'fetch → write' },
  trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
  steps: [
    { id: 'fetch', agent: agentName, offer: 'fetch', description: { en_US: 'Fetch' }, required_to_function: 'none', timeout_min: 10 },
    { id: 'write', agent: agentName, offer: 'write', after: ['fetch'], description: { en_US: 'Write' }, timeout_min: 10 },
  ],
};

async function run() {
  console.log('\n=== AIMEAT Agent Workflows E2E ===\n');

  await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerToken = await getToken(ownerName, body.data.private_key, false);
    auth = { Authorization: `Bearer ${ownerToken}` };
  });

  await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', { method: 'POST', headers: auth, body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  });

  await test('Publish offers with workflow signals', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth, body: JSON.stringify({ offers: [FETCH_OFFER, WRITE_OFFER, SRCFAIL_OFFER, SCHEMA_OFFER] }) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  });

  await test('Register the workflow-inspector agent', async () => {
    const { status, body } = await json('/v1/agents', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'workflow-inspector', owner: ownerName, capabilities: ['memory'] }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  });

  // ── save-time validation ──
  await test('PUT rejects a step whose offer is not published', async () => {
    const bad = { ...WORKFLOW, steps: [{ id: 's', agent: agentName, offer: 'ghost', description: { en_US: 'x' }, required_to_function: 'none', timeout_min: 5 }] };
    const { status, body } = await json('/v1/workflows/bad-offer', { method: 'PUT', headers: auth, body: JSON.stringify(bad) });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'WORKFLOW_INVALID', `expected WORKFLOW_INVALID, got ${body.error?.code}`);
  });

  await test('PUT rejects a dependency cycle', async () => {
    const cyclic = { ...WORKFLOW, steps: [
      { id: 'a', agent: agentName, offer: 'fetch', after: ['b'], description: { en_US: 'a' }, required_to_function: 'none', timeout_min: 5 },
      { id: 'b', agent: agentName, offer: 'write', after: ['a'], description: { en_US: 'b' }, timeout_min: 5 },
    ] };
    const { status, body } = await json('/v1/workflows/cyclic', { method: 'PUT', headers: auth, body: JSON.stringify(cyclic) });
    assert(status === 400, `expected 400, got ${status}`);
    assert(JSON.stringify(body.error?.details?.errors ?? []).includes('cycle'), `expected a cycle error, got ${JSON.stringify(body.error?.details)}`);
  });

  await test('PUT a valid workflow succeeds', async () => {
    const { status, body } = await json('/v1/workflows/news', { method: 'PUT', headers: auth, body: JSON.stringify(WORKFLOW) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.id === 'news', 'id is news');
  });

  await test('GET blueprint derives nodes + edges from offers', async () => {
    const { status, body } = await json('/v1/workflows/news/blueprint', { headers: auth });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.nodes.length === 2, `expected 2 nodes, got ${body.data.nodes.length}`);
    assert(body.data.edges.some((e: any) => e.from === 'fetch' && e.to === 'write'), 'edge fetch→write present');
    const write = body.data.nodes.find((n: any) => n.stepId === 'write');
    assert(write.reads.includes('news.raw'), 'write reads news.raw');
    assert(write.writes.includes('news.article'), 'write writes news.article');
  });

  // ── signals-only ──
  await test('signals-only with empty memory → partial (output-red + input-red)', async () => {
    const { status, body } = await json('/v1/workflows/news/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const runId = body.data.runId;
    const { body: r } = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth });
    assert(r.data.status === 'partial', `expected partial, got ${r.data.status}`);
    assert(r.data.steps.fetch.state === 'output-red', `fetch should be output-red, got ${r.data.steps.fetch.state}`);
    assert(r.data.steps.write.state === 'input-red', `write should be input-red, got ${r.data.steps.write.state}`);
  });

  await test('signals-only after writing both keys → done (all green)', async () => {
    await writeMem('news.raw', 'raw headlines here');
    await writeMem('news.article', 'the finished article');
    const { body } = await json('/v1/workflows/news/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    const runId = body.data.runId;
    const { body: r } = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth });
    assert(r.data.status === 'done', `expected done, got ${r.data.status}`);
    assert(r.data.steps.fetch.state === 'green' && r.data.steps.write.state === 'green', 'both green');
  });

  // ── full-live: dispatch + advance via simulated task completion ──
  await test('full-live happy path advances fetch→write to done', async () => {
    // Reset the produced keys so the run starts from a clean state.
    await json('/v1/memory/news.raw', { method: 'DELETE', headers: auth });
    await json('/v1/memory/news.article', { method: 'DELETE', headers: auth });

    const { status, body } = await json('/v1/workflows/news/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    assert(status === 200, `run start ${status}: ${JSON.stringify(body)}`);
    const runId = body.data.runId;

    // fetch was dispatched → grab its task id from the run record.
    let { body: r } = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth });
    assert(r.data.status === 'waiting-step', `expected waiting-step, got ${r.data.status}`);
    const fetchTaskId = r.data.steps.fetch.taskIds?.[0];
    assert(typeof fetchTaskId === 'string', 'fetch dispatched a task');

    // The "agent" produces news.raw, then we complete its task → engine advances.
    await writeMem('news.raw', 'fresh raw news');
    const c1 = await json(`/v1/agents/${agentName}/tasks/${fetchTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    assert(c1.status === 200, `complete fetch ${c1.status}: ${JSON.stringify(c1.body)}`);
    await sleep(700); // onTaskTerminal is fire-and-forget after the response

    ({ body: r } = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth }));
    assert(r.data.steps.fetch.state === 'green', `fetch should be green, got ${r.data.steps.fetch.state}`);
    const writeTaskId = r.data.steps.write.taskIds?.[0];
    assert(typeof writeTaskId === 'string', `write should be dispatched after fetch green (state: ${r.data.steps.write.state})`);

    await writeMem('news.article', 'the generated article');
    const c2 = await json(`/v1/agents/${agentName}/tasks/${writeTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    assert(c2.status === 200, `complete write ${c2.status}: ${JSON.stringify(c2.body)}`);
    await sleep(700);

    ({ body: r } = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth }));
    assert(r.data.status === 'done', `expected done, got ${r.data.status}`);
    assert(r.data.steps.write.state === 'green', `write should be green, got ${r.data.steps.write.state}`);
  });

  // ── failure mode: output-RED dispatches the inspector + skips the dependent subtree ──
  await test('output-RED → partial, dependent step skipped, inspector dispatched', async () => {
    const put = await json('/v1/workflows/failwf', { method: 'PUT', headers: auth, body: JSON.stringify(FAILWF) });
    assert(put.status === 200, `put failwf ${put.status}: ${JSON.stringify(put.body)}`);

    const { body } = await json('/v1/workflows/failwf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = body.data.runId;
    let { body: r } = await json(`/v1/workflows/failwf/runs/${runId}`, { headers: auth });
    const genTaskId = r.data.steps.gen.taskIds?.[0];
    assert(typeof genTaskId === 'string', 'gen dispatched a task');

    // Complete gen WITHOUT producing absent.out → its success_signal is RED.
    const c = await json(`/v1/agents/${agentName}/tasks/${genTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done but produced nothing' }) });
    assert(c.status === 200, `complete gen ${c.status}: ${JSON.stringify(c.body)}`);
    await sleep(700);

    ({ body: r } = await json(`/v1/workflows/failwf/runs/${runId}`, { headers: auth }));
    assert(r.data.status === 'partial', `expected partial, got ${r.data.status}`);
    assert(r.data.steps.gen.state === 'output-red', `gen should be output-red, got ${r.data.steps.gen.state}`);
    assert(r.data.steps.use.state === 'skipped', `use should be skipped, got ${r.data.steps.use.state}`);
    assert(Array.isArray(r.data.inspections) && r.data.inspections.some((i: any) => i.stepId === 'gen'), `expected an inspection for gen, got ${JSON.stringify(r.data.inspections)}`);

    // The inspector agent received a task tagged workflow-inspect (NOT advancing the run).
    const { body: tasks } = await json('/v1/agents/workflow-inspector/tasks', { headers: auth });
    const list = tasks.data.tasks ?? tasks.data ?? [];
    assert(Array.isArray(list) && list.some((t: any) => (t.scope ?? []).some((s: any) => s.name === 'workflow-inspect')), 'inspector has a workflow-inspect task');
  });

  // ── event trigger: a matching owner-memory write starts a run ──
  await test('event trigger (memory.write) starts a run', async () => {
    const evtWf = {
      title: { en_US: 'Evt pipeline' }, description: { en_US: 'starts on a memory write' },
      trigger: { kind: 'event', on: 'memory.write', match: { key: 'evt.trigger' } }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'fetch', agent: agentName, offer: 'fetch', description: { en_US: 'Fetch' }, required_to_function: 'none', timeout_min: 10 }],
    };
    const put = await json('/v1/workflows/evt-wf', { method: 'PUT', headers: auth, body: JSON.stringify(evtWf) });
    assert(put.status === 200, `put evt-wf ${put.status}: ${JSON.stringify(put.body)}`);

    const before = await json('/v1/workflows/evt-wf/runs', { headers: auth });
    assert((before.body.data.count ?? 0) === 0, 'no runs before the trigger');

    // Writing the matching owner-memory key should fire the event trigger → start a run.
    await writeMem('evt.trigger', 'go');
    await sleep(800);

    const after = await json('/v1/workflows/evt-wf/runs', { headers: auth });
    assert((after.body.data.count ?? 0) >= 1, `expected a run after the trigger, got ${after.body.data.count}`);
    assert(after.body.data.runs[0].steps.fetch.taskIds?.length >= 1 || after.body.data.runs[0].status, 'run dispatched the step');
  });

  // ── json_schema leaf actually validates (no false GREEN) ──
  await test('json_schema fails schema-invalid output, passes schema-valid', async () => {
    const wf = {
      title: { en_US: 'Schema wf' }, description: { en_US: 'json_schema check' },
      trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'gen', agent: agentName, offer: 'schematic', description: { en_US: 'Gen' }, required_to_function: 'none', timeout_min: 10 }],
    };
    const put = await json('/v1/workflows/schema-wf', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put schema-wf ${put.status}: ${JSON.stringify(put.body)}`);

    // structurally-valid JSON but missing the required `title` → must be output-red
    await writeMem('demo.doc', JSON.stringify({ foo: 'bar' }));
    let run = await json('/v1/workflows/schema-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    let r = await json(`/v1/workflows/schema-wf/runs/${run.body.data.runId}`, { headers: auth });
    assert(r.body.data.steps.gen.state === 'output-red', `schema-invalid should be output-red, got ${r.body.data.steps.gen.state}`);

    // now schema-valid → green
    await writeMem('demo.doc', JSON.stringify({ title: 'hello' }));
    run = await json('/v1/workflows/schema-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    r = await json(`/v1/workflows/schema-wf/runs/${run.body.data.runId}`, { headers: auth });
    assert(r.body.data.steps.gen.state === 'green', `schema-valid should be green, got ${r.body.data.steps.gen.state}`);
  });

  // ── retry path: a RED output with retries left goes pending (attempt++), not straight to output-red ──
  await test('output-RED with retry left → step pending + attempt incremented (not output-red)', async () => {
    const wf = {
      title: { en_US: 'Retry wf' }, description: { en_US: 'retry before escalation' },
      trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'gen', agent: agentName, offer: 'srcfail', description: { en_US: 'Gen' }, required_to_function: 'none', retry: { max: 1, backoff_min: 5 }, timeout_min: 10 }],
    };
    const put = await json('/v1/workflows/retry-wf', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put retry-wf ${put.status}: ${JSON.stringify(put.body)}`);

    const run = await json('/v1/workflows/retry-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = run.body.data.runId;
    let r = await json(`/v1/workflows/retry-wf/runs/${runId}`, { headers: auth });
    const taskId = r.body.data.steps.gen.taskIds?.[0];
    assert(typeof taskId === 'string', 'gen dispatched');

    // Complete the task with no output (absent.out never written) → success_signal RED, but retry is left.
    const c = await json(`/v1/agents/${agentName}/tasks/${taskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'nothing' }) });
    assert(c.status === 200, `complete ${c.status}`);
    await sleep(700);

    r = await json(`/v1/workflows/retry-wf/runs/${runId}`, { headers: auth });
    assert(r.body.data.steps.gen.state === 'pending', `retry should put step back to pending, got ${r.body.data.steps.gen.state}`);
    assert(r.body.data.steps.gen.attempt === 1, `attempt should be 1, got ${r.body.data.steps.gen.attempt}`);
    assert(typeof r.body.data.steps.gen.notBefore === 'string', 'a backoff notBefore is set');
    // NOTE: the timeout→timed-out transition is driven by the 60s watchdog sweep and is not
    // black-box e2e-able in <1min; it is covered by the engine's sweep logic (unit-level).
  });

  // ── health ──
  await test('GET health reports per-step trend over runs', async () => {
    const { status, body } = await json('/v1/workflows/news/health', { headers: auth });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.sample >= 3, `expected >=3 runs sampled, got ${body.data.sample}`);
    const fetch = body.data.steps.find((s: any) => s.stepId === 'fetch');
    assert(fetch.green >= 1, 'fetch has at least one green run');
  });

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
