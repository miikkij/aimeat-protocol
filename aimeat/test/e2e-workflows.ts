/**
 * @file e2e-workflows.ts
 * @description E2E for Agent Workflows (Phase 4). Covers: save-time validation (offer-without-
 *   signals rejected, cyclic graph rejected), the derived blueprint, a signals-only run against
 *   existing memory (all-RED → partial, all-GREEN → done), and a full-live run advancing across two
 *   steps via simulated task completion (the onTaskTerminal hook). Run:
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflows
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial Phase 4 coverage.
 *   v1.1.0 — 2026-06-15 — notify_on_finish: opt-in gate + success/failure finish-notification coverage.
 *   v1.2.0 — 2026-07-05 — resume: downstream re-gates on its own required_to_function (input present →
 *     runs; input absent → input-red) instead of blanket-skip on a failed parent. (The watchdog's
 *     re-check + sliding no-progress timeout are unit-covered — not black-box-able under the 60s sweep.)
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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
// Unique key never written in the real namespace — to prove full-sandbox reads the prefixed copy.
const SBX_OFFER = {
  id: 'sbx', title: 'Sandbox', ask: 'produce sbx.out',
  deliverable: { format: 'document', location: { key: 'sbx.out' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'sbx.out', op: 'nonempty' },
};
// Offer whose success_signal spans keys produced by ANOTHER agent (owner + public visibility) —
// to prove the evaluator reads OWNER-SCOPE (owner GHII + all agents), not the owner keyspace alone.
const CROSSREAD_OFFER = {
  id: 'crossread', title: 'Crossread', ask: 'check another agent\'s output',
  deliverable: { format: 'document', location: { key: 't.crossread.done' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { all: [
    { kind: 'deterministic', key_glob: 't.crossread.out.*', op: 'count_nonempty', min: 12 },
    { kind: 'deterministic', key: 't.crossread.pub', op: 'nonempty' },
  ] },
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
    const { status, body } = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth, body: JSON.stringify({ offers: [FETCH_OFFER, WRITE_OFFER, SRCFAIL_OFFER, SCHEMA_OFFER, SBX_OFFER, CROSSREAD_OFFER] }) });
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

  // ── event trigger: ordering an offer starts a matching workflow ──
  await test('event trigger (offer.ordered) starts a run; engine dispatch does NOT re-trigger', async () => {
    const evtWf = {
      title: { en_US: 'Offer-evt' }, description: { en_US: 'starts when offer "fetch" is ordered' },
      trigger: { kind: 'event', on: 'offer.ordered', match: { offer: 'fetch' } }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'fetch', agent: agentName, offer: 'fetch', description: { en_US: 'Fetch' }, required_to_function: 'none', timeout_min: 10 }],
    };
    const put = await json('/v1/workflows/offer-evt-wf', { method: 'PUT', headers: auth, body: JSON.stringify(evtWf) });
    assert(put.status === 200, `put offer-evt-wf ${put.status}: ${JSON.stringify(put.body)}`);

    const before = await json('/v1/workflows/offer-evt-wf/runs', { headers: auth });
    assert((before.body.data.count ?? 0) === 0, 'no runs before the order');

    // Order the "fetch" offer the way the Tarjoama Ask flow does: a task tagged with an offer_id scope.
    const order = await json(`/v1/agents/${agentName}/tasks`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        title: 'fetch the news', description: 'please fetch', status: 'queued',
        scope: [{ name: 'kind', value: 'offer', type: 'text' }, { name: 'offer_id', value: 'fetch', type: 'text' }],
        rules: [], verification: { user_expects: '', technical_checks: [] },
      }),
    });
    assert(order.status === 201, `order task ${order.status}: ${JSON.stringify(order.body)}`);
    await sleep(800);

    const after = await json('/v1/workflows/offer-evt-wf/runs', { headers: auth });
    assert((after.body.data.count ?? 0) === 1, `expected exactly 1 run after the order, got ${after.body.data.count}`);
    // The run dispatched its own fetch step (a task with an `offer` scope, NOT `offer_id`) — which must
    // NOT have re-triggered a second run. count === 1 proves engine dispatch doesn't loop.
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

  // ── resume: downstream gates on its OWN required_to_function, not parent success ──
  await test('resume: a failed parent does NOT blanket-skip — a dependent whose input is present RUNS, one whose input is absent goes input-red', async () => {
    // gen (srcfail) always goes output-red. Under resume, its dependents re-gate on their OWN input:
    //   use  — input `news.raw nonempty` is MET (we write it) → must RUN (dispatched), not skipped.
    //   use2 — input `absent.forsure exists` is UNMET → must go input-red (not run, not blanket-skipped).
    const resumeWf = {
      title: { en_US: 'Resume pipeline' }, description: { en_US: 'downstream re-gates on reality' },
      trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect', resume: true,
      steps: [
        { id: 'gen', agent: agentName, offer: 'srcfail', description: { en_US: 'Gen' }, required_to_function: 'none', timeout_min: 10 },
        { id: 'use', agent: agentName, offer: 'write', after: ['gen'], description: { en_US: 'Use' }, required_to_function: { kind: 'deterministic', key: 'news.raw', op: 'nonempty' }, timeout_min: 10 },
        { id: 'use2', agent: agentName, offer: 'write', after: ['gen'], description: { en_US: 'Use2' }, required_to_function: { kind: 'deterministic', key: 'absent.forsure', op: 'exists' }, timeout_min: 10 },
      ],
    };
    const put = await json('/v1/workflows/resume-wf', { method: 'PUT', headers: auth, body: JSON.stringify(resumeWf) });
    assert(put.status === 200, `put resume-wf ${put.status}: ${JSON.stringify(put.body)}`);
    // resume flag round-trips through save.
    const def = await json('/v1/workflows/resume-wf', { headers: auth });
    assert(def.body.data.resume === true, `resume should persist as true, got ${def.body.data.resume}`);

    // use's input gate must be satisfiable when gen fails.
    await writeMem('news.raw', 'present so use can run');

    const run = await json('/v1/workflows/resume-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = run.body.data.runId;
    let r = await json(`/v1/workflows/resume-wf/runs/${runId}`, { headers: auth });
    const genTaskId = r.body.data.steps.gen.taskIds?.[0];
    assert(typeof genTaskId === 'string', 'gen dispatched');

    // Complete gen with no output → gen output-red. Under resume the dependents then re-gate.
    const c = await json(`/v1/agents/${agentName}/tasks/${genTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'produced nothing' }) });
    assert(c.status === 200, `complete gen ${c.status}: ${JSON.stringify(c.body)}`);
    await sleep(800);

    r = await json(`/v1/workflows/resume-wf/runs/${runId}`, { headers: auth });
    assert(r.body.data.steps.gen.state === 'output-red', `gen should be output-red, got ${r.body.data.steps.gen.state}`);
    assert(typeof r.body.data.steps.use.taskIds?.[0] === 'string' && r.body.data.steps.use.state === 'dispatched',
      `use (input present) should RUN despite gen failing, got ${r.body.data.steps.use.state}`);
    assert(r.body.data.steps.use2.state === 'input-red',
      `use2 (input absent) should be input-red, not skipped/run, got ${r.body.data.steps.use2.state}`);
  });

  // ── full-sandbox namespaces keys, isolated from production ──
  await test('full-sandbox reads/writes under wf-test.<runId>. (prod key untouched)', async () => {
    const wf = {
      title: { en_US: 'Sandbox wf' }, description: { en_US: 'sandbox isolation' },
      trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'gen', agent: agentName, offer: 'sbx', description: { en_US: 'Gen' }, required_to_function: 'none', timeout_min: 10 }],
    };
    const put = await json('/v1/workflows/sandbox-wf', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put sandbox-wf ${put.status}: ${JSON.stringify(put.body)}`);

    const run = await json('/v1/workflows/sandbox-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full', target: 'sandbox' }) });
    const runId = run.body.data.runId;
    assert(run.body.data.mode === 'full-sandbox', `expected full-sandbox, got ${run.body.data.mode}`);

    let r = await json(`/v1/workflows/sandbox-wf/runs/${runId}`, { headers: auth });
    const prefix = r.body.data.keyPrefix;
    assert(prefix === `wf-test.${runId}.`, `expected sandbox keyPrefix, got ${prefix}`);
    const taskId = r.body.data.steps.gen.taskIds?.[0];
    assert(typeof taskId === 'string', 'gen dispatched');

    // Cooperating agent writes ONLY the prefixed key (the real `sbx.out` stays unwritten).
    await writeMem(`${prefix}sbx.out`, 'sandbox output');
    const c = await json(`/v1/agents/${agentName}/tasks/${taskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    assert(c.status === 200, `complete ${c.status}`);
    await sleep(700);

    r = await json(`/v1/workflows/sandbox-wf/runs/${runId}`, { headers: auth });
    assert(r.body.data.steps.gen.state === 'green', `gen should be green from the prefixed key, got ${r.body.data.steps.gen.state}`);
    // Isolation: the real (unprefixed) key was never written by this run.
    const real = await json('/v1/memory/sbx.out', { headers: auth });
    assert(real.status === 404, `real sbx.out should be untouched (404), got ${real.status}`);
  });

  // ── cancel an in-flight run ──
  await test('cancel an in-flight run → cancelled + open steps skipped; re-cancel → 409', async () => {
    const start = await json('/v1/workflows/news/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = start.body.data.runId;
    let r = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth });
    assert(r.body.data.status === 'waiting-step', `expected waiting-step before cancel, got ${r.body.data.status}`);

    const c = await json(`/v1/workflows/news/runs/${runId}/cancel`, { method: 'POST', headers: auth, body: '{}' });
    assert(c.status === 200, `cancel ${c.status}: ${JSON.stringify(c.body)}`);

    r = await json(`/v1/workflows/news/runs/${runId}`, { headers: auth });
    assert(r.body.data.status === 'cancelled', `expected cancelled, got ${r.body.data.status}`);
    assert(r.body.data.steps.fetch.state === 'skipped', `dispatched fetch should be skipped, got ${r.body.data.steps.fetch.state}`);
    assert(r.body.data.steps.write.state === 'skipped', `pending write should be skipped, got ${r.body.data.steps.write.state}`);

    const again = await json(`/v1/workflows/news/runs/${runId}/cancel`, { method: 'POST', headers: auth, body: '{}' });
    assert(again.status === 409, `re-cancel a finished run should be 409, got ${again.status}`);
  });

  // ── owner-scope cross-agent read (the BLOCKER fix) ──
  await test('signal reads OWNER-SCOPE: keys written by ANOTHER agent (owner + public) → GREEN', async () => {
    // A producer agent (NOT the workflow step's agent) writes the keys into ITS OWN keyspace.
    const mk = await json('/v1/agents', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'wf-producer', owner: ownerName, capabilities: ['memory'] }) });
    assert(mk.status === 201, `create producer ${mk.status}: ${JSON.stringify(mk.body)}`);
    const prodToken = await getToken(mk.body.data.agent.gaii, mk.body.data.private_key, true);
    const phdr = { Authorization: `Bearer ${prodToken}` };
    for (let i = 1; i <= 12; i++) {
      const w = await json('/v1/memory', { method: 'POST', headers: phdr, body: JSON.stringify({ key: `t.crossread.out.${i}`, value: `v${i}`, visibility: 'owner' }) });
      assert(w.status === 200 || w.status === 201, `producer owner-write ${i}: ${w.status}`);
    }
    const wp = await json('/v1/memory', { method: 'POST', headers: phdr, body: JSON.stringify({ key: 't.crossread.pub', value: 'pub', visibility: 'public' }) });
    assert(wp.status === 200 || wp.status === 201, `producer public-write: ${wp.status}`);

    const put = await json('/v1/workflows/crossread-wf', { method: 'PUT', headers: auth, body: JSON.stringify({
      title: { en_US: 'Crossread' }, description: { en_US: 'reads another agent\'s keys' },
      trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
      steps: [{ id: 'check', agent: agentName, offer: 'crossread', required_to_function: 'none', timeout_min: 10, description: { en_US: 'Check' } }],
    }) });
    assert(put.status === 200, `put crossread-wf ${put.status}: ${JSON.stringify(put.body)}`);

    const run = await json('/v1/workflows/crossread-wf/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    const r = await json(`/v1/workflows/crossread-wf/runs/${run.body.data.runId}`, { headers: auth });
    // Before the fix this was output-red (count 0, owner-keyspace-only read). With owner-scope it's GREEN.
    assert(r.body.data.steps.check.state === 'green',
      `cross-agent owner-scope signal should be GREEN, got ${r.body.data.steps.check.state} observed=${JSON.stringify(r.body.data.steps.check.outputObserved)}`);
  });

  // ── finish notification (notify_on_finish opt-in) ──
  const finishNotifs = async () => {
    const { body } = await json('/v1/notifications', { headers: auth });
    const list = (body.data?.notifications ?? []) as Array<{ type: string; title: string; body: string }>;
    return list.filter(n => n.type === 'workflow_finished' || n.type === 'workflow_failed');
  };

  await test('runs WITHOUT notify_on_finish produced NO finish notification (gate holds)', async () => {
    // The earlier full-live `news` run + `failwf` run did NOT opt in → no finish notifications yet.
    const fn = await finishNotifs();
    assert(fn.length === 0, `expected 0 finish notifications before opt-in, got ${fn.length}: ${JSON.stringify(fn)}`);
  });

  await test('notify_on_finish: a successful full-live run drops a workflow_finished notification', async () => {
    const wf = { ...WORKFLOW, title: { en_US: 'Notify success' }, notify_on_finish: true };
    const put = await json('/v1/workflows/notify-ok', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put notify-ok ${put.status}: ${JSON.stringify(put.body)}`);

    await json('/v1/memory/news.raw', { method: 'DELETE', headers: auth });
    await json('/v1/memory/news.article', { method: 'DELETE', headers: auth });

    const run = await json('/v1/workflows/notify-ok/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = run.body.data.runId;
    let r = await json(`/v1/workflows/notify-ok/runs/${runId}`, { headers: auth });
    const fetchTaskId = r.body.data.steps.fetch.taskIds?.[0];
    await writeMem('news.raw', 'fresh raw news');
    await json(`/v1/agents/${agentName}/tasks/${fetchTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    await sleep(700);
    r = await json(`/v1/workflows/notify-ok/runs/${runId}`, { headers: auth });
    const writeTaskId = r.body.data.steps.write.taskIds?.[0];
    await writeMem('news.article', 'the generated article');
    await json(`/v1/agents/${agentName}/tasks/${writeTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    await sleep(800);

    r = await json(`/v1/workflows/notify-ok/runs/${runId}`, { headers: auth });
    assert(r.body.data.status === 'done', `expected done, got ${r.body.data.status}`);

    const fn = await finishNotifs();
    const ok = fn.find(n => n.type === 'workflow_finished' && n.title.includes('succeeded'));
    assert(!!ok, `expected a workflow_finished 'succeeded' notification, got ${JSON.stringify(fn)}`);
    assert(ok!.body.includes('fetch:') && ok!.body.includes('write:'), `notification body should carry the per-step log, got: ${ok!.body}`);
  });

  await test('notify_on_finish: a failing run drops a workflow_failed notification', async () => {
    const wf = { ...FAILWF, title: { en_US: 'Notify fail' }, notify_on_finish: true };
    const put = await json('/v1/workflows/notify-fail', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put notify-fail ${put.status}: ${JSON.stringify(put.body)}`);

    const run = await json('/v1/workflows/notify-fail/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
    const runId = run.body.data.runId;
    const r0 = await json(`/v1/workflows/notify-fail/runs/${runId}`, { headers: auth });
    const genTaskId = r0.body.data.steps.gen.taskIds?.[0];
    // Complete gen without producing absent.out → output-red → run partial.
    await json(`/v1/agents/${agentName}/tasks/${genTaskId}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'nothing' }) });
    await sleep(800);

    const r = await json(`/v1/workflows/notify-fail/runs/${runId}`, { headers: auth });
    assert(r.body.data.status === 'partial', `expected partial, got ${r.body.data.status}`);

    const fn = await finishNotifs();
    const failed = fn.find(n => n.type === 'workflow_failed' && n.title.includes('failed'));
    assert(!!failed, `expected a workflow_failed notification, got ${JSON.stringify(fn)}`);
    assert(failed!.body.includes('Failed steps: gen'), `notification body should name the failed step, got: ${failed!.body}`);
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
