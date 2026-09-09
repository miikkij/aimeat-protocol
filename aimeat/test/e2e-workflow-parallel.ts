/**
 * @file e2e-workflow-parallel.ts
 * @description E2E for the workflow overlap guard and the `parallel` opt-out. Covers: a second
 *   start of a workflow whose run is in flight answers 200 with `skipped: true` and the running
 *   run's id, and writes NO "run started" row to the account feed; a workflow saved with
 *   `parallel: true` runs twice at once with two distinct run ids; `parallel` beside `fresh` is
 *   refused at save; a signals-only check never counts as overlap; and once the in-flight run ends
 *   (cancel), the next start is a real start again. The run is held in flight by a human-input step
 *   with no dependencies, which parks the run at 'waiting-human' on the first tick, so no agent is
 *   needed. Run:
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflow-parallel
 * @version-history
 *   v1.0.0 — 2026-09-09 — Written with the skip-is-said fix and the `parallel` flag. The first two
 *     assertions fail on the old engine: the second start answered a bare runId, and the feed
 *     gained a workflow_run_started row for a run that never started.
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

async function getToken(ownerOrGaii: string, privKey: string, isAgent = false): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKey, 'base64'))).toString('base64');
  const payload = isAgent ? { gaii: ownerOrGaii, timestamp, signature: sig } : { owner: ownerOrGaii, timestamp, signature: sig };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const ownerName = `pwfowner${Date.now()}`;
const otherOwnerName = `pwfother${Date.now()}`;
let auth: Record<string, string> = {};
let otherAuth: Record<string, string> = {};
let narrowAuth: Record<string, string> = {};

// One human-input step and nothing before it: the first tick parks the run at waiting-human, and
// it stays in flight until answered or cancelled. `{case}` is the run-distinguishing var the
// parallel variant relies on; the single variant declares it too so the two definitions differ in
// exactly one field.
function definition(opts: { parallel?: boolean; fresh?: boolean }) {
  return {
    title: { en_US: 'Parked intake' }, description: { en_US: 'one human gate, held open' },
    trigger: { kind: 'manual' }, on_step_fail: 'inspect',
    vars: [{ name: 'case', type: 'string', description: { en_US: 'The case reference this run handles' }, default: 'none' }],
    steps: [{
      id: 'gate', description: { en_US: 'Approve case {case}' }, required_to_function: 'none',
      action: {
        kind: 'human-input',
        question: { header: 'Intake', prompt: 'Handle case {case}?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
        answer_to_key: 'intake.{case}.decision',
      },
    }],
    ...(opts.parallel !== undefined ? { parallel: opts.parallel } : {}),
    ...(opts.fresh !== undefined ? { fresh: opts.fresh } : {}),
  };
}

async function save(id: string, def: unknown): Promise<{ status: number; body: any }> {
  return json(`/v1/workflows/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify(def) });
}

async function start(id: string, vars: Record<string, string>): Promise<{ status: number; body: any }> {
  return json(`/v1/workflows/${id}/run`, { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full', vars }) });
}

async function startedRows(): Promise<number> {
  const { status, body } = await json('/v1/account/events?limit=200', { headers: auth });
  assert(status === 200, `events ${status}: ${JSON.stringify(body)}`);
  return (body.data.events as Array<{ kind: string }>).filter(e => e.kind === 'workflow_run_started').length;
}

async function run() {
  console.log('\n=== AIMEAT Workflow Parallel / Skip E2E ===\n');

  await test('Register owner, a second owner, and an agent without workflow:write', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `owner ${status}: ${JSON.stringify(body)}`);
    auth = { Authorization: `Bearer ${await getToken(ownerName, body.data.private_key)}` };
    const other = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherOwnerName, public_key: 'placeholder' }) });
    assert(other.status === 201, `second owner ${other.status}: ${JSON.stringify(other.body)}`);
    otherAuth = { Authorization: `Bearer ${await getToken(otherOwnerName, other.body.data.private_key)}` };
    // Scopes are baked into a token at mint time: an agent with memory:read only, so the fence on
    // the run door is proven by a principal that is otherwise this owner's own.
    const reg = await json('/v1/agents', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'pwf-narrow', owner: ownerName, capabilities: ['memory'], scopes: ['memory:read'] }),
    });
    assert(reg.status === 201, `narrow agent ${reg.status}: ${JSON.stringify(reg.body)}`);
    narrowAuth = { Authorization: `Bearer ${await getToken(reg.body.data.agent.gaii, reg.body.data.private_key, true)}` };
  });

  await test('PUT refuses parallel beside fresh, and says why', async () => {
    const { status, body } = await save('both', definition({ parallel: true, fresh: true }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
    const errors = JSON.stringify(body.error?.details?.errors ?? []);
    assert(errors.includes('parallel and fresh cannot both be set'), `expected the parallel+fresh refusal, got ${errors}`);
  });

  let firstRun = '';
  await test('default: the first start parks the run in flight', async () => {
    const s = await save('single', definition({}));
    assert(s.status === 200, `save ${s.status}: ${JSON.stringify(s.body)}`);
    const { status, body } = await start('single', { case: 'A' });
    assert(status === 200, `start ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skipped === undefined, `a first start carries no skipped flag, got ${JSON.stringify(body.data)}`);
    firstRun = body.data.runId;
    await sleep(500);
    const r = await json(`/v1/workflows/single/runs/${firstRun}`, { headers: auth });
    assert(r.status === 200, `run ${r.status}`);
    assert(r.body.data.steps.gate.state === 'waiting-human', `gate waiting-human, got ${r.body.data.steps.gate.state}`);
  });

  await test('the run door is fenced: no token → 401, an agent without workflow:write → 403, another owner sees no such workflow', async () => {
    const anon = await json('/v1/workflows/single/run', { method: 'POST', body: JSON.stringify({ mode: 'full', vars: { case: 'Z' } }) });
    assert(anon.status === 401, `anonymous start: expected 401, got ${anon.status}`);
    const narrow = await json('/v1/workflows/single/run', { method: 'POST', headers: narrowAuth, body: JSON.stringify({ mode: 'full', vars: { case: 'Z' } }) });
    assert(narrow.status === 403 && narrow.body.error?.code === 'SCOPE_DENIED',
      `agent without workflow:write: expected 403 SCOPE_DENIED, got ${narrow.status} ${JSON.stringify(narrow.body.error)}`);
    // A workflow lives in its owner's namespace. Another owner asking to run it, or to answer or
    // cancel its parked run, is told there is no such thing, and the run stays where it was.
    const foreignStart = await json('/v1/workflows/single/run', { method: 'POST', headers: otherAuth, body: JSON.stringify({ mode: 'full', vars: { case: 'Z' } }) });
    assert(foreignStart.status === 400 && JSON.stringify(foreignStart.body.error?.details?.errors ?? []).includes('not found'),
      `another owner's start: expected 400 not found, got ${foreignStart.status} ${JSON.stringify(foreignStart.body.error)}`);
    // The cancel door looks the run up in the CALLER's namespace and answers one 409 for "no such
    // run" and "already finished" alike, so another owner learns nothing about a run that is not theirs.
    const foreignCancel = await json(`/v1/workflows/single/runs/${firstRun}/cancel`, { method: 'POST', headers: otherAuth });
    assert(foreignCancel.status === 409 && foreignCancel.body.error?.code === 'RUN_NOT_CANCELLABLE',
      `another owner's cancel: expected 409 RUN_NOT_CANCELLABLE, got ${foreignCancel.status} ${JSON.stringify(foreignCancel.body.error)}`);
    const foreignAnswer = await json(`/v1/workflows/single/runs/${firstRun}/steps/gate/answer`, { method: 'POST', headers: otherAuth, body: JSON.stringify({ picks: ['yes'] }) });
    assert(foreignAnswer.status === 404, `another owner's answer: expected 404, got ${foreignAnswer.status}`);
    const r = await json(`/v1/workflows/single/runs/${firstRun}`, { headers: auth });
    assert(r.body.data.steps.gate.state === 'waiting-human', `the run is still parked after the refusals, got ${r.body.data.steps.gate.state}`);
  });

  await test('default: a second start while one is in flight answers skipped:true with THAT run\'s id', async () => {
    const before = await startedRows();
    const { status, body } = await start('single', { case: 'B' });
    assert(status === 200, `second start ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skipped === true, `expected skipped:true, got ${JSON.stringify(body.data)}`);
    assert(body.data.runId === firstRun, `expected the in-flight run id ${firstRun}, got ${body.data.runId}`);
    assert(typeof body.data.reason === 'string' && body.data.reason.includes('parallel'), `the reason names the parallel flag, got ${body.data.reason}`);
    const runs = await json('/v1/workflows/single/runs', { headers: auth });
    const live = (runs.body.data.runs as Array<{ runId: string }>).map(r => r.runId);
    assert(live.length === 1 && live[0] === firstRun, `still exactly one run, got ${JSON.stringify(live)}`);
    await sleep(300);
    const after = await startedRows();
    assert(after === before, `no workflow_run_started row for a skipped start (before ${before}, after ${after})`);
  });

  await test('default: a signals-only check is never an overlap', async () => {
    const { status, body } = await json('/v1/workflows/single/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'signals-only' }) });
    assert(status === 200, `check ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skipped === undefined, `a check is not skipped, got ${JSON.stringify(body.data)}`);
    assert(body.data.runId !== firstRun, 'a check has its own id');
  });

  await test('default: once the in-flight run is cancelled, the next start is a real start', async () => {
    const c = await json(`/v1/workflows/single/runs/${firstRun}/cancel`, { method: 'POST', headers: auth });
    assert(c.status === 200, `cancel ${c.status}: ${JSON.stringify(c.body)}`);
    await sleep(300);
    const { status, body } = await start('single', { case: 'C' });
    assert(status === 200, `start ${status}: ${JSON.stringify(body)}`);
    assert(body.data.skipped === undefined && body.data.runId !== firstRun, `a fresh run after cancel, got ${JSON.stringify(body.data)}`);
    await json(`/v1/workflows/single/runs/${body.data.runId}/cancel`, { method: 'POST', headers: auth });
  });

  await test('parallel: two starts, two live runs, two ids', async () => {
    const s = await save('many', definition({ parallel: true }));
    assert(s.status === 200, `save ${s.status}: ${JSON.stringify(s.body)}`);
    const a = await start('many', { case: 'X' });
    const b = await start('many', { case: 'Y' });
    assert(a.status === 200 && b.status === 200, `starts ${a.status}/${b.status}`);
    assert(a.body.data.skipped === undefined && b.body.data.skipped === undefined, `neither start skipped: ${JSON.stringify([a.body.data, b.body.data])}`);
    assert(a.body.data.runId !== b.body.data.runId, 'two distinct run ids');
    await sleep(600);
    for (const id of [a.body.data.runId, b.body.data.runId]) {
      const r = await json(`/v1/workflows/many/runs/${id}`, { headers: auth });
      assert(r.status === 200 && r.body.data.steps.gate.state === 'waiting-human', `run ${id} parked, got ${r.body.data?.steps?.gate?.state}`);
    }
    const runs = await json('/v1/workflows/many/runs', { headers: auth });
    assert((runs.body.data.runs as unknown[]).length === 2, `two runs listed, got ${(runs.body.data.runs as unknown[]).length}`);
    for (const id of [a.body.data.runId, b.body.data.runId]) {
      await json(`/v1/workflows/many/runs/${id}/cancel`, { method: 'POST', headers: auth });
    }
  });

  await test('parallel: each run keeps its own vars', async () => {
    const a = await start('many', { case: 'P' });
    const b = await start('many', { case: 'Q' });
    await sleep(400);
    const ra = await json(`/v1/workflows/many/runs/${a.body.data.runId}`, { headers: auth });
    const rb = await json(`/v1/workflows/many/runs/${b.body.data.runId}`, { headers: auth });
    assert(ra.body.data.vars.case === 'P' && rb.body.data.vars.case === 'Q', `vars per run, got ${ra.body.data.vars?.case}/${rb.body.data.vars?.case}`);
    for (const id of [a.body.data.runId, b.body.data.runId]) {
      await json(`/v1/workflows/many/runs/${id}/cancel`, { method: 'POST', headers: auth });
    }
  });

  await test('cleanup: delete both workflows', async () => {
    for (const id of ['single', 'many']) {
      const d = await json(`/v1/workflows/${id}`, { method: 'DELETE', headers: auth });
      assert(d.status === 200, `delete ${id}: ${d.status}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
