/**
 * @file e2e-workflows-human.ts
 * @description E2E for human-in-the-loop workflow steps (the `human-input` step action). Covers:
 *   save-time validation (retry rejected, on_timeout=default needs a valid default_option), the
 *   blueprint rendering the human node (answer key in writes), a full-live run parking on
 *   waiting-human (pending-inputs roster + answer validation + 409 double-answer), the approve path
 *   (downstream dispatches), the decline path (downstream input-red via a json_field gate → run
 *   partial), and a sandbox run writing the answer under the wf-test prefix. Timeout policies are
 *   unit-covered (test/unit/workflow-human-input.test.ts — the 60s sweep isn't black-box-able). Run:
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflows-human
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4: the gate step declares `reviews_key`, and a new test
 *     proves that answering it stamps the REVIEWED content with humanInvolvement
 *     'editorial-control' naming the reviewer — the only upgrade path the engine has.
 *   v1.0.0 — 2026-07-16 — Initial human-input coverage (happy + decline + sandbox + validation).
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

async function getToken(owner: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const message = owner + NODE_ID + timestamp;
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privKey, 'base64'))).toString('base64');
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature: sig }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const ownerName = `hwfowner${Date.now()}`;
const agentName = 'hwf-bot';
let auth: Record<string, string> = {};

async function writeMem(key: string, value: string) {
  const { status, body } = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key, value, visibility: 'private' }) });
  assert(status === 200 || status === 201, `writeMem ${key}: ${status} ${JSON.stringify(body)}`);
}

// draft (agent step): produces plan.draft. ship (agent step): gated on the human decision.
const DRAFT_OFFER = {
  id: 'draft', title: 'Draft', ask: 'produce the draft plan',
  deliverable: { format: 'document', location: { key: 'plan.draft' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'plan.draft', op: 'nonempty' },
};
const SHIP_OFFER = {
  id: 'ship', title: 'Ship', ask: 'ship the approved plan',
  deliverable: { format: 'document', location: { key: 'plan.shipped' } },
  required_to_function: { kind: 'deterministic', key: 'plan.draft', op: 'nonempty' },
  success_signal: { kind: 'deterministic', key: 'plan.shipped', op: 'nonempty' },
};

const HUMAN_STEP = {
  id: 'gate', after: ['draft'], description: { en_US: 'Owner approval gate' },
  required_to_function: 'none',
  action: {
    kind: 'human-input',
    question: {
      header: 'Approval',
      prompt: 'Ship the plan for run {run}?',
      options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
    },
    answer_to_key: 'gate.decision',
    // TARGET-058: the question puts plan.draft in front of the person, so answering it IS a step
    // where the substance is read and can be rejected — the one thing that upgrades a provenance
    // record's humanInvolvement to 'editorial-control'.
    reviews_key: 'plan.draft',
  },
};

// draft → gate (human) → ship, where ship's input gate reads the human decision.
const WORKFLOW = {
  title: { en_US: 'Gated pipeline' }, description: { en_US: 'draft → human gate → ship' },
  trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
  steps: [
    { id: 'draft', agent: agentName, offer: 'draft', description: { en_US: 'Draft' }, required_to_function: 'none', timeout_min: 10 },
    HUMAN_STEP,
    {
      id: 'ship', agent: agentName, offer: 'ship', after: ['gate'], description: { en_US: 'Ship' }, timeout_min: 10,
      required_to_function: {
        all: [
          { kind: 'deterministic', key: 'plan.draft', op: 'nonempty' },
          { kind: 'deterministic', key: 'gate.decision', op: 'json_field', path: 'pick', equals: 'approve' },
        ],
      },
    },
  ],
};

/** Start a full run and drive `draft` to green; returns the runId with `gate` waiting-human. */
async function startAndReachGate(mode: 'full', target?: 'sandbox'): Promise<string> {
  const { status, body } = await json('/v1/workflows/gated/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode, target }) });
  assert(status === 200, `run start ${status}: ${JSON.stringify(body)}`);
  const runId = body.data.runId;

  const { body: r0 } = await json(`/v1/workflows/gated/runs/${runId}`, { headers: auth });
  const draftTask = r0.data.steps.draft.taskIds?.[0];
  assert(typeof draftTask === 'string', 'draft dispatched a task');
  const prefix = r0.data.keyPrefix ?? '';
  await writeMem(`${prefix}plan.draft`, 'the draft plan');
  const c = await json(`/v1/agents/${agentName}/tasks/${draftTask}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
  assert(c.status === 200, `complete draft ${c.status}: ${JSON.stringify(c.body)}`);
  await sleep(700); // onTaskTerminal is fire-and-forget after the response
  return runId;
}

async function run() {
  console.log('\n=== AIMEAT Workflows Human-Input E2E ===\n');

  await test('Register owner + agent + offers', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `owner ${status}: ${JSON.stringify(body)}`);
    auth = { Authorization: `Bearer ${await getToken(ownerName, body.data.private_key)}` };
    const a = await json('/v1/agents', { method: 'POST', headers: auth, body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }) });
    assert(a.status === 201, `agent ${a.status}: ${JSON.stringify(a.body)}`);
    const o = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth, body: JSON.stringify({ offers: [DRAFT_OFFER, SHIP_OFFER] }) });
    assert(o.status === 200, `offers ${o.status}: ${JSON.stringify(o.body)}`);
    await writeMem('config.enabled', 'yes');
  });

  // ── save-time validation ──
  await test('PUT rejects retry on a human-input step', async () => {
    const bad = { ...WORKFLOW, steps: [{ ...HUMAN_STEP, after: undefined, retry: { max: 1, backoff_min: 1 } }] };
    const { status, body } = await json('/v1/workflows/bad-retry', { method: 'PUT', headers: auth, body: JSON.stringify(bad) });
    assert(status === 400, `expected 400, got ${status}`);
    assert(JSON.stringify(body.error?.details?.errors ?? []).includes('cannot declare retry'), `expected retry error, got ${JSON.stringify(body.error)}`);
  });

  await test('PUT rejects on_timeout=default with an unknown default_option', async () => {
    const badStep = { ...HUMAN_STEP, after: undefined, action: { ...HUMAN_STEP.action, on_timeout: 'default', default_option: 'nope' } };
    const { status, body } = await json('/v1/workflows/bad-default', { method: 'PUT', headers: auth, body: JSON.stringify({ ...WORKFLOW, steps: [badStep] }) });
    assert(status === 400, `expected 400, got ${status}`);
    assert(JSON.stringify(body.error?.details?.errors ?? []).includes('not one of question.options'), `expected default_option error, got ${JSON.stringify(body.error)}`);
  });

  await test('PUT accepts the gated workflow; blueprint shows the human node writing the answer key', async () => {
    const put = await json('/v1/workflows/gated', { method: 'PUT', headers: auth, body: JSON.stringify(WORKFLOW) });
    assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body)}`);
    const { status, body } = await json('/v1/workflows/gated/blueprint', { headers: auth });
    assert(status === 200, `blueprint ${status}: ${JSON.stringify(body)}`);
    const gate = body.data.nodes.find((n: any) => n.stepId === 'gate');
    assert(!!gate, 'blueprint has the gate node');
    assert(gate.offerId === 'human-input', `gate node labeled human-input, got "${gate.offerId}"`);
    assert(gate.writes.includes('gate.decision'), `gate writes the answer key, got ${JSON.stringify(gate.writes)}`);
  });

  // ── approve path ──
  let approveRunId = '';
  await test('full-live: run parks on waiting-human after draft greens', async () => {
    await json('/v1/memory/plan.draft', { method: 'DELETE', headers: auth });
    await json('/v1/memory/plan.shipped', { method: 'DELETE', headers: auth });
    await json('/v1/memory/gate.decision', { method: 'DELETE', headers: auth });
    approveRunId = await startAndReachGate('full');
    const { body: r } = await json(`/v1/workflows/gated/runs/${approveRunId}`, { headers: auth });
    assert(r.data.steps.draft.state === 'green', `draft green, got ${r.data.steps.draft.state}`);
    assert(r.data.steps.gate.state === 'waiting-human', `gate waiting-human, got ${r.data.steps.gate.state}`);
    assert(r.data.status === 'waiting-step', `run waiting-step, got ${r.data.status}`);
    assert(r.data.steps.gate.human?.question?.prompt?.includes(approveRunId), 'question prompt has {run} templated');
  });

  await test('GET pending-inputs lists the parked question', async () => {
    const { status, body } = await json('/v1/workflows/pending-inputs', { headers: auth });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const hit = body.data.inputs.find((i: any) => i.runId === approveRunId && i.stepId === 'gate');
    assert(!!hit, `pending-inputs has the gate, got ${JSON.stringify(body.data.inputs)}`);
    assert(Array.isArray(hit.question.options) && hit.question.options.length === 2, 'question options present');
    assert(typeof hit.deadline === 'string', 'deadline present');
  });

  await test('answer validation: unknown option 400, valid answer advances to ship', async () => {
    const bad = await json(`/v1/workflows/gated/runs/${approveRunId}/steps/gate/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ picks: ['nope'] }) });
    assert(bad.status === 400, `expected 400 for unknown option, got ${bad.status}`);

    const ok = await json(`/v1/workflows/gated/runs/${approveRunId}/steps/gate/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ picks: ['approve'] }) });
    assert(ok.status === 200, `answer ${ok.status}: ${JSON.stringify(ok.body)}`);
    await sleep(300);

    const { body: r } = await json(`/v1/workflows/gated/runs/${approveRunId}`, { headers: auth });
    assert(r.data.steps.gate.state === 'green', `gate green, got ${r.data.steps.gate.state}`);
    assert(r.data.steps.gate.human?.answer?.pick === 'approve', `answer pinned, got ${JSON.stringify(r.data.steps.gate.human?.answer)}`);
    const shipTask = r.data.steps.ship.taskIds?.[0];
    assert(typeof shipTask === 'string', `ship dispatched after approval (state: ${r.data.steps.ship.state})`);

    // The answer landed in owner memory (downstream-gate readable).
    const mem = await json('/v1/memory/gate.decision', { headers: auth });
    assert(mem.status === 200 && mem.body.data?.value?.pick === 'approve', `gate.decision written, got ${JSON.stringify(mem.body.data?.value)}`);

    // Finish the run.
    await writeMem('plan.shipped', 'shipped');
    await json(`/v1/agents/${agentName}/tasks/${shipTask}/complete`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'done' }) });
    await sleep(700);
    const { body: r2 } = await json(`/v1/workflows/gated/runs/${approveRunId}`, { headers: auth });
    assert(r2.data.status === 'done', `run done, got ${r2.data.status}`);
  });

  // ── TARGET-058: the ONE step that may upgrade humanInvolvement, proven end to end ──
  await test('a human-input step naming reviews_key stamps the reviewed content editorial-control', async () => {
    const mem = await json('/v1/memory/plan.draft', { headers: auth });
    assert(mem.status === 200, `plan.draft read ${mem.status}`);
    const provId = mem.body.data?.ai_provenance_id;
    assert(!!provId, 'the reviewed content carries no provenance record after a substantive review');

    const rec = mem.body.meta?.provenance?.record;
    assert(!!rec, `no record served with the item: ${JSON.stringify(mem.body.meta)}`);
    assert(rec.humanInvolvement === 'editorial-control',
      `humanInvolvement ${rec.humanInvolvement} — a step that reviews substance must upgrade it`);
    // Who read it, and where. A claim of editorial control that cannot name the reviewer is worth
    // nothing, and that is what the notes carry.
    assert(String(rec.notes ?? '').includes(ownerName), `notes name no reviewer: ${rec.notes}`);
    assert(String(rec.notes ?? '').includes('gate'), `notes name no step: ${rec.notes}`);
    assert(String(rec.generator?.pipeline ?? '').includes('gated'), `pipeline ${rec.generator?.pipeline}`);
    // The node asserted this; it did not stand and watch a model produce the bytes.
    assert(rec.attestation?.stampedBy === 'node' && rec.attestation?.observed === false,
      'an inference must never be recorded as an observation');
    // And with a person in editorial control, no Article 50(4) label is owed.
    assert(rec.disclosure?.required === false,
      `a reviewed item owes no label, got required=${rec.disclosure?.required}`);
  });

  await test('answering an already-resolved step is a 409', async () => {
    const { status, body } = await json(`/v1/workflows/gated/runs/${approveRunId}/steps/gate/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ picks: ['approve'] }) });
    assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'WORKFLOW_STEP_NOT_WAITING', `expected WORKFLOW_STEP_NOT_WAITING, got ${body.error?.code}`);
  });

  // ── decline path ──
  await test('decline: reject answer greens the gate but ships goes input-red → run partial', async () => {
    await json('/v1/memory/plan.draft', { method: 'DELETE', headers: auth });
    await json('/v1/memory/plan.shipped', { method: 'DELETE', headers: auth });
    await json('/v1/memory/gate.decision', { method: 'DELETE', headers: auth });
    const runId = await startAndReachGate('full');

    const ok = await json(`/v1/workflows/gated/runs/${runId}/steps/gate/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ picks: ['reject'] }) });
    assert(ok.status === 200, `answer ${ok.status}: ${JSON.stringify(ok.body)}`);
    await sleep(300);

    const { body: r } = await json(`/v1/workflows/gated/runs/${runId}`, { headers: auth });
    assert(r.data.steps.gate.state === 'green', `gate green (any answer counts), got ${r.data.steps.gate.state}`);
    assert(r.data.steps.ship.state === 'input-red', `ship input-red on decline, got ${r.data.steps.ship.state}`);
    assert(r.data.status === 'partial', `run partial, got ${r.data.status}`);
  });

  // ── sandbox isolation ──
  await test('sandbox run writes the answer under the wf-test prefix (prod key untouched)', async () => {
    await json('/v1/memory/gate.decision', { method: 'DELETE', headers: auth });
    const runId = await startAndReachGate('full', 'sandbox');

    const { body: r0 } = await json(`/v1/workflows/gated/runs/${runId}`, { headers: auth });
    assert(r0.data.steps.gate.state === 'waiting-human', `gate waiting-human in sandbox, got ${r0.data.steps.gate.state}`);

    const ok = await json(`/v1/workflows/gated/runs/${runId}/steps/gate/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ picks: ['approve'] }) });
    assert(ok.status === 200, `answer ${ok.status}: ${JSON.stringify(ok.body)}`);
    await sleep(300);

    const prod = await json('/v1/memory/gate.decision', { headers: auth });
    assert(prod.status === 404, `prod gate.decision untouched (404), got ${prod.status}`);
    const sandboxed = await json(`/v1/memory/wf-test.${runId}.gate.decision`, { headers: auth });
    assert(sandboxed.status === 200 && sandboxed.body.data?.value?.pick === 'approve', `sandbox answer written, got ${sandboxed.status}`);

    // Clean up: cancel the parked sandbox run so it doesn't linger in the active index.
    await json(`/v1/workflows/gated/runs/${runId}/cancel`, { method: 'POST', headers: auth });
  });

  // A18 (E2E test-quality audit). The test above proves the upgrade HAPPENS. It answers as the
  // owner, so it never asks who is allowed to cause it — and the guard's own comment says "a person
  // reads the substance". Nothing enforced the person: the agent whose draft is parked can call
  // aimeat_workflow_answer on its own step, and the node stamped that content 'editorial-control'
  // with the note "reviewed by hwf-reviewer#…", flipping the public disclosure label from "no human
  // editorial review" to the reviewed wording with nobody having read the bytes. The agent must
  // still be able to ANSWER — that is the agent-first design — it just must not become editorial
  // control. Against the pre-fix source this fails: humanInvolvement comes back editorial-control.
  await test('an agent may answer a review step, but does not become editorial control', async () => {
    const reviewerName = 'hwf-reviewer';
    const reg = await json('/v1/agents', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: reviewerName, owner: ownerName, capabilities: ['memory'], scopes: ['workflow:write', 'memory:read'] }),
    });
    assert(reg.status === 201, `reviewer agent ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `reviewer token: ${JSON.stringify(tok.body.error)}`);
    const agentAuth = { Authorization: `Bearer ${tok.body.data.token}` };

    // A fresh run parked at the same gate. writeMem rewrites plan.draft, so its provenance starts
    // over — whatever this assertion sees was set by THIS run.
    const runId = await startAndReachGate('full');
    const ans = await json(`/v1/workflows/gated/runs/${runId}/steps/gate/answer`, {
      method: 'POST', headers: agentAuth, body: JSON.stringify({ picks: ['approve'] }),
    });
    assert(ans.status === 200, `an agent must still be able to answer, got ${ans.status}: ${JSON.stringify(ans.body).slice(0, 200)}`);
    await sleep(700);

    const mem = await json('/v1/memory/plan.draft', { headers: auth });
    assert(mem.status === 200, `plan.draft read ${mem.status}`);
    const rec = mem.body.meta?.provenance?.record;
    assert(rec?.humanInvolvement !== 'editorial-control',
      `an agent's answer claimed human editorial control: ${JSON.stringify({ humanInvolvement: rec?.humanInvolvement, notes: rec?.notes })}`);
    assert(!String(rec?.notes ?? '').includes(reviewerName),
      `the agent was recorded as the reviewer: ${rec?.notes}`);
    // The label a reader sees must still say a person has not reviewed this.
    if (rec) {
      assert(rec.disclosure?.required !== false || rec.humanInvolvement !== 'editorial-control',
        'an unreviewed item must not be excused from its disclosure label');
    }

    // The step itself resolved and the run advanced — the gate costs the agent nothing.
    const { body: after } = await json(`/v1/workflows/gated/runs/${runId}`, { headers: auth });
    assert(after.data.steps.gate.state === 'green',
      `the agent's answer must green the step, got ${after.data.steps.gate.state}`);
  });

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
