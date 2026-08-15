/**
 * @file test/e2e-workflow-extension-step.ts
 * @description A workflow can call one of its owner's own extension actions — server-side, in the
 *   sandbox, with no agent online and no model in the path.
 *
 *   WHAT THIS CLOSES. A workflow step could reach an AGENT (a task the agent must be online to pick
 *   up), a HUMAN (park and ask) and ANOTHER NODE'S APP (a GEAI over the tunnel). It could not reach
 *   the deterministic capability sitting on the same node, even though an HTTP caller, an MCP client
 *   and a cron already could. A pipeline whose fetch-and-normalise half lives in an extension had to
 *   route it through an agent that did nothing but relay — which needs the agent to be online and
 *   puts a model in the path of work that has no judgement in it.
 *
 *   THE THREE THINGS THAT MAKE IT SAFE, one test each:
 *     - Test 4: it produces, and the bytes land under the OWNER — the same permanent address a
 *       scheduled run or an agent would write to.
 *     - Test 5: a script that returns WITHOUT delivering what the success_signal names is RED. The
 *       sandbox returning is not the same as the step succeeding, and conflating the two is the
 *       covering fallback this target exists to remove.
 *     - Tests 6 and 7: a stranger's extension is refused at SAVE, and a step with no success_signal
 *       is refused at save too — the second because such a step would green on any return at all.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workflow-extension-step
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 A3).
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `wfx${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'WfExt', password: 'WfExtStep1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await sleep(1500);
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'WfExt', password: 'WfExtStep1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Workflow extension step E2E (TARGET-063 A3) ===\n');

const EXT = `wfext${Date.now()}`;
/** Where the ENGINE lands the action's return value — the owner's namespace, so a signal can read it. */
const RESULT_KEY = 'pkg.produce.result';
/** Where the extension writes for ITSELF: `ext:{name}`, which owner-scope reads never reach. */
const OUT_MEMORY_KEY = 'pkg.rows';
const CSV = 'date,hits\n2026-08-15,42\n';

const SCRIPTS = {
  // Deterministic production. Writes BOTH a memory record (which the success_signal reads) and a
  // stored file (which is the actual artefact) — the two halves a data package needs.
  produce: `export default async function(ctx, input){
    if (!ctx.files) throw new Error('ctx.files unavailable on this road');
    var out = await ctx.files.write(input.key, input.b64, { mime: 'text/csv', visibility: 'public' });
    await ctx.memory.set('${OUT_MEMORY_KEY}', { note: 'this lands in ext: and the workflow CANNOT see it' });
    return { rows: 1, window: input.window, wrote: out.key, owner: out.owner, callerGaii: ctx.caller.gaii, callerRoles: ctx.caller.roles };
  }`,
  // Returns cleanly and produces NOTHING. The step must go red on its success_signal, not green on
  // the mere fact that the sandbox came back.
  emptyhanded: `export default async function(){ return { looksFine: true }; }`,
  // Throws the way a producer whose source is down throws.
  boom: `export default async function(){ throw new Error('SOURCE_UNAVAILABLE: the upstream register did not answer'); }`,
  // Calls ctx.files.write with an ABSENT key. The host bridge stringifies every argument, so the
  // guest's `undefined` arrives as the four characters "undefined" — see test 6b.
  sloppy: `export default async function(ctx, input){ var out = await ctx.files.write(input.key, input.b64, { mime: 'text/csv' }); return { wrote: out.key }; }`,
  probe: `export default async function(ctx){ return { gaii: ctx.caller.gaii, roles: ctx.caller.roles, hasFiles: !!ctx.files, hasWallet: !!(ctx.wallet && ctx.wallet.consume) }; }`,
};

const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'workflow extension step e2e', author: 'e2e' },
  actions: [
    { id: 'produce', method: 'POST', path: '/produce', script: 'produce' },
    { id: 'emptyhanded', method: 'POST', path: '/emptyhanded', script: 'emptyhanded' },
    { id: 'boom', method: 'POST', path: '/boom', script: 'boom' },
    { id: 'sloppy', method: 'POST', path: '/sloppy', script: 'sloppy' },
    { id: 'probe', method: 'POST', path: '/probe', script: 'probe' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 8000, max_api_calls: 4 },
}, null, 2);

let owner: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;

/** Poll a run until it leaves the running/waiting states, or give up. */
async function settle(wfId: string, runId: string, token: string, tries = 40): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: auth(token) });
    const run = body.data?.run ?? body.data;
    if (run && !['running', 'waiting-step'].includes(run.status)) return run;
    await sleep(250);
  }
  const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: auth(token) });
  return body.data?.run ?? body.data;
}

await test('1. Setup: owner installs the producing extension; a stranger installs their own', async () => {
  owner = await setupOwner('own');
  stranger = await setupOwner('str');
  for (const who of [owner, stranger]) {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ manifest: manifest(who === owner ? EXT : `${EXT}s`), scripts: SCRIPTS }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${who === owner ? EXT : `${EXT}s`}/activate`, { method: 'POST', headers: auth(who.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
  }
});

await test('2. A workflow with an extension step SAVES', async () => {
  const def = {
    title: { en_US: 'Deterministic producer' }, description: { en_US: 'extension step only' },
    trigger: { kind: 'manual' }, vars: [{ name: 'window', type: 'string', description: { en_US: 'window' }, default: '7d' }],
    on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce the package' },
      required_to_function: 'none',
      // The gate asserts the SHAPE of the result, not merely that something arrived: `rows` must be
      // at least 1. A producer that came back with an empty result is red.
      success_signal: { kind: 'deterministic', key: RESULT_KEY, op: 'json_field', path: 'rows', min: 1 },
      action: {
        kind: 'extension', extension: EXT, action: 'produce',
        input: { key: 'rows.csv', b64: Buffer.from(CSV).toString('base64'), window: '{window}' },
        result_to_key: RESULT_KEY,
      },
    }],
  };
  const r = await json('/v1/workflows/prod-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(r.status === 200 || r.status === 201, `save ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.errors)}`);
});

await test('3. …and needs no agent to be online (no agent exists on this owner at all)', async () => {
  const agents = await json('/v1/agents', { headers: auth(owner.token) });
  const list = agents.body?.data?.agents ?? [];
  assert(list.length === 0, `this owner has ${list.length} agents — the point is that the step runs with none`);
});

await test('4. THE FIX: the run executes the extension server-side and goes green', async () => {
  const r = await json('/v1/workflows/prod-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  assert(r.status === 200 || r.status === 202, `run ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const runId = r.body.data.run?.runId ?? r.body.data.runId;
  const run = await settle('prod-wf', runId, owner.token);
  assert(run.steps.produce.state === 'green', `step state ${run.steps.produce.state} (${JSON.stringify(run.steps.produce.outputObserved ?? {})})`);
  assert(run.status === 'done', `run status ${run.status}`);

  // The artefact is a real file under the OWNER — the same address a scheduled run would use.
  const key = `ext/${EXT}/rows.csv`;
  const back = await json(`/v1/storage/${encodeURIComponent(key)}`, { headers: auth(owner.token) });
  assert(back.status === 200, `read back ${back.status}: ${JSON.stringify(back.body?.error)}`);
  assert(back.body._raw === CSV, 'the produced bytes');

  // The engine landed the action's RETURN VALUE in the owner's namespace, which is what the signal
  // read. Its contents also answer the two remaining questions.
  const res = await json(`/v1/memory/${encodeURIComponent(RESULT_KEY)}`, { headers: auth(owner.token) });
  assert(res.status === 200, `result key ${res.status}: ${JSON.stringify(res.body?.error)}`);
  const v = res.body.data.value;
  assert(v.window === '7d', `input {window} must arrive templated, got ${JSON.stringify(v.window)}`);
  assert(v.owner === owner.gaii, `files landed under the owner, got ${v.owner}`);
  assert(v.callerGaii === owner.gaii, `the sandbox's caller is the run's owner, got ${v.callerGaii}`);
  assert(Array.isArray(v.callerRoles) && v.callerRoles.includes('operator'), `roles say nobody is present, got ${JSON.stringify(v.callerRoles)}`);
});

await test('4b. What the extension wrote for ITSELF stays invisible to the workflow', async () => {
  // The reason result_to_key exists. `ext:{name}` is a namespace of its own; owner scope is the
  // owner GHII plus their agents and ecosystem apps (services/owner-memory.ts). A signal aimed at
  // the ext key can only ever read nothing, so a step gated that way would be permanently red.
  const inExt = await json(`/v1/memory/${encodeURIComponent(`ext:${EXT}`)}/${encodeURIComponent(OUT_MEMORY_KEY)}`);
  assert(inExt.status === 200, `the extension DID write it, under ext: — ${inExt.status}`);
  const inOwner = await json(`/v1/memory/${encodeURIComponent(OUT_MEMORY_KEY)}`, { headers: auth(owner.token) });
  assert(inOwner.status === 404, `…and it is NOT in the owner's scope, got ${inOwner.status}`);
});

await test('5. A script that returns EMPTY-HANDED is RED, not green', async () => {
  const def = {
    title: { en_US: 'Empty-handed producer' }, description: { en_US: 'returns cleanly, delivers nothing' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce nothing' },
      required_to_function: 'none',
      // The result key IS written (the script returned `{looksFine:true}`), so a bare `nonempty`
      // gate would pass. The gate asks the question that matters instead — did it produce rows? —
      // and the answer is no.
      success_signal: { kind: 'deterministic', key: 'pkg.empty.result', op: 'json_field', path: 'rows', min: 1 },
      action: { kind: 'extension', extension: EXT, action: 'emptyhanded', result_to_key: 'pkg.empty.result' },
    }],
  };
  const put = await json('/v1/workflows/empty-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors ?? put.body?.error)}`);

  const r = await json('/v1/workflows/empty-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  const runId = r.body.data.run?.runId ?? r.body.data.runId;
  const run = await settle('empty-wf', runId, owner.token);
  assert(run.steps.produce.state === 'output-red', `expected output-red, got ${run.steps.produce.state} — the sandbox returning is NOT the step succeeding`);
  assert(run.status !== 'done', `a run whose only step is red must not report done, got ${run.status}`);
});

await test('6. A THROWN error is red, and no result is written', async () => {
  const def = {
    title: { en_US: 'Broken producer' }, description: { en_US: 'the source is down' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce' }, required_to_function: 'none',
      action: { kind: 'extension', extension: EXT, action: 'boom', result_to_key: 'pkg.throw.result' },
    }],
  };
  const put = await json('/v1/workflows/throw-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors ?? put.body?.error)}`);
  const r = await json('/v1/workflows/throw-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  const runId = r.body.data.run?.runId ?? r.body.data.runId;
  const run = await settle('throw-wf', runId, owner.token);
  assert(run.steps.produce.state === 'output-red', `expected output-red, got ${run.steps.produce.state}`);
  // A throw must leave no version behind, not a half-result.
  const res = await json(`/v1/memory/${encodeURIComponent('pkg.throw.result')}`, { headers: auth(owner.token) });
  assert(res.status === 404, `a failed run must write no result, got ${res.status}`);
});

await test('6b. FOUND WHILE TESTING: the host bridge stringifies every argument', async () => {
  // This test was written expecting a throw and got a green step. The reason is not the workflow
  // road: registerAsyncHostFn reads its arguments with vm.getString(), so a guest passing `undefined`
  // sends the four characters "undefined". `ctx.files.write(undefined, undefined)` therefore writes a
  // real file at the key "undefined" instead of refusing an absent key, and the action returns
  // successfully. Pinned here because it is the shape of a producer that quietly writes rubbish, and
  // because a future change that makes the bridge pass real types must not do it by accident.
  const r = await json(`/v1/ext/${EXT}/sloppy`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.wrote === `ext/${EXT}/undefined`, `expected a file keyed "undefined", got ${r.body.data.wrote}`);
});

await test('6c. The fence holds when the extension disappears AFTER the workflow was saved', async () => {
  // A saved workflow outlives the extension record it names. Three places refuse, and the outermost
  // one wins: startRun re-validates the definition before creating a run at all, so the run is
  // refused with the reason instead of starting and going red — nothing is written and there is no
  // half-finished run to explain. The two inner checks (validateWorkflow at save, and the shared
  // runner at execute) remain as defence in depth.
  const gone = `${EXT}gone`;
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(gone), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}`);
  await json(`/v1/extensions/${gone}/activate`, { method: 'POST', headers: auth(owner.token) });
  const def = {
    title: { en_US: 'Vanishing capability' }, description: { en_US: 'saved, then deleted' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce' }, required_to_function: 'none',
      action: { kind: 'extension', extension: gone, action: 'emptyhanded', result_to_key: 'pkg.gone.result' },
    }],
  };
  const put = await json('/v1/workflows/gone-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors)}`);
  const del = await json(`/v1/extensions/${gone}`, { method: 'DELETE', headers: auth(owner.token) });
  assert(del.status === 200, `delete ${del.status}`);

  const r = await json('/v1/workflows/gone-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  assert(r.status === 400, `expected the run to be refused up front, got ${r.status}: ${JSON.stringify(r.body?.data)}`);
  const errs = JSON.stringify(r.body?.error?.details ?? r.body?.error ?? r.body);
  assert(/not found/i.test(errs), `and to say why, got: ${errs}`);
  // Refused BEFORE any run record exists — no half-finished run for the owner to interpret.
  const runs = await json('/v1/workflows/gone-wf/runs', { headers: auth(owner.token) });
  assert((runs.body?.data?.runs ?? []).length === 0, 'a refused start leaves no run behind');
});

await test('7. A STRANGER\'S extension is refused at SAVE, not at 06:00 in a run log', async () => {
  const def = {
    title: { en_US: 'Borrowed capability' }, description: { en_US: 'points at someone else' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce' }, required_to_function: 'none',
      action: { kind: 'extension', extension: `${EXT}s`, action: 'produce', result_to_key: 'pkg.borrow.result' },
    }],
  };
  const r = await json('/v1/workflows/borrow-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body)}`);
  const errs = JSON.stringify(r.body?.error?.details ?? r.body?.data?.errors ?? r.body?.error ?? r.body);
  assert(/not found/i.test(errs), `and it must say so without confirming the extension exists, got: ${errs}`);
});

await test('8. An extension step with neither result_to_key nor success_signal is refused at save', async () => {
  // Such a step has nothing left to green on but "the script returned", which is exactly the
  // covering fallback this target removes.
  const def = {
    title: { en_US: 'Ungated producer' }, description: { en_US: 'no gate at all' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce' }, required_to_function: 'none',
      action: { kind: 'extension', extension: EXT, action: 'produce' },
    }],
  };
  const r = await json('/v1/workflows/ungated-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body)}`);
  const errs = JSON.stringify(r.body?.error?.details ?? r.body?.data?.errors ?? r.body?.error ?? r.body);
  assert(/result_to_key|success_signal/i.test(errs), `and it must name the reason, got: ${errs}`);
});

await test('9. The identity a workflow extension step runs under, vs the REST road', async () => {
  // The answer to "with what identity and grant does it run", as an assertion rather than a comment.
  const def = {
    title: { en_US: 'Identity probe' }, description: { en_US: 'who am I' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'probe', description: { en_US: 'Probe' }, required_to_function: 'none',
      action: { kind: 'extension', extension: EXT, action: 'probe', result_to_key: 'pkg.probe.result' },
    }],
  };
  const put = await json('/v1/workflows/probe-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors)}`);
  const r = await json('/v1/workflows/probe-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  const runId = r.body.data.run?.runId ?? r.body.data.runId;
  const run = await settle('probe-wf', runId, owner.token);
  assert(run.steps.probe.state === 'green', `probe state ${run.steps.probe.state}`);

  const wf = (await json(`/v1/memory/${encodeURIComponent('pkg.probe.result')}`, { headers: auth(owner.token) })).body.data.value;
  const rest = (await json(`/v1/ext/${EXT}/probe`, { method: 'POST', headers: auth(owner.token), body: '{}' })).body.data;

  // SAME on both roads: the principal is the owner, and files are available.
  assert(wf.gaii === owner.gaii && rest.gaii === owner.gaii, `caller: wf=${wf.gaii} rest=${rest.gaii}`);
  assert(wf.hasFiles === true && rest.hasFiles === true, 'both roads can write bytes');
  // DIFFERENT, and deliberately: the workflow road says nobody is at a screen, so an IAM gate
  // written for a person does not open for an unattended run…
  assert(wf.roles.includes('operator') && !wf.roles.includes('owner'), `workflow roles: ${JSON.stringify(wf.roles)}`);
  assert(rest.roles.includes('owner'), `REST roles: ${JSON.stringify(rest.roles)}`);
  // …and nobody's balance is available to spend when nobody is present.
  assert(wf.hasWallet === false, 'an unattended run gets no wallet');
  assert(rest.hasWallet === true, 'a person invoking their own extension can spend their own balance');
});

// ── What a SECOND principal gets. The stranger's-extension case (test 7) is answered with a 400 at
// save, on purpose: it is a definition that does not validate, and the wording never confirms whose
// extension it was. The two fences that answer with a status code are these.

await test('10. Saving or running a workflow with no token is 401, not "the owner"', async () => {
  // A workflow step is a standing, unmetered call on the owner's own capability. The route that
  // creates and fires one must never treat an absent principal as the owner.
  const def = {
    title: { en_US: 'No token' }, description: { en_US: 'no token' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{ id: 'produce', description: { en_US: 'p' }, required_to_function: 'none', action: { kind: 'extension', extension: EXT, action: 'probe', result_to_key: 'x' } }],
  };
  const put = await json('/v1/workflows/noauth-wf', { method: 'PUT', body: JSON.stringify(def) });
  assert(put.status === 401, `save without a token: expected 401, got ${put.status}`);
  const run = await json('/v1/workflows/prod-wf/run', { method: 'POST', body: JSON.stringify({ mode: 'full' }) });
  assert(run.status === 401, `run without a token: expected 401, got ${run.status}`);
});

await test('11. A stranger cannot read the result key the engine wrote for the owner', async () => {
  // The engine lands the action's return value in the OWNER's namespace so the owner's signals can
  // read it. That is the owner's data, and a second owner with a valid token of their own is
  // refused rather than served.
  const path = `/v1/memory/${encodeURIComponent(owner.gaii)}/${encodeURIComponent(RESULT_KEY)}`;
  const denied = await json(path, { headers: auth(stranger.token) });
  assert(denied.status === 403, `a second owner must be refused, got ${denied.status}`);
});

await test('Cleanup', async () => {
  for (const id of ['prod-wf', 'empty-wf', 'throw-wf', 'probe-wf', 'gone-wf']) {
    await json(`/v1/workflows/${id}`, { method: 'DELETE', headers: auth(owner.token) });
  }
  await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${EXT}s`, { method: 'DELETE', headers: auth(stranger.token) });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
