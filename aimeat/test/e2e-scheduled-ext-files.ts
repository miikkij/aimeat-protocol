/**
 * @file test/e2e-scheduled-ext-files.ts
 * @description The scheduled extension road can produce BYTES, and they land where the address
 *   needs them: in the installer's own namespace.
 *
 *   WHAT THIS PROVES, AND WHY IT COULD NOT PASS BEFORE. `buildExtensionCtx` attaches `ctx.files`
 *   only when the road hands it one, and the scheduler handed it `notify` and `email` and nothing
 *   else. So an extension running on a clock could hold memory records and reach the internet and
 *   could not put a single byte into storage: `ctx.files` was `undefined` in the sandbox. Every
 *   capability that produces a FILE on a schedule — an export, a dataset, a rendered report — did
 *   not exist on this node, and the reason was a missing argument rather than anything about clocks.
 *
 *   THE NAMESPACE IS THE OTHER HALF. A scheduled run's `ctx.caller.gaii` is `scheduler@<node>`,
 *   which is a label for "nobody was present" and owns no storage. The bytes go to the INSTALLER's
 *   GHII instead, so a data package produced on a clock sits at the same permanent
 *   `/v1/pub/<owner>/…` address as the same package produced from the app or by an agent. Test 4 is
 *   that assertion, and it is the one that makes "the producer is interchangeable" true.
 *
 *   AND A FAILED RUN STAYS FAILED. Test 6: an action that throws produces `lastRunResult: 'error'`
 *   with the message, and no file. Nothing is written half-way and nothing reports success.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=scheduled-ext-files
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 A2).
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
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `sef${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sched', password: 'SchedFiles1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sched', password: 'SchedFiles1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Scheduled extension files E2E (TARGET-063 A2) ===\n');

const EXT = `schedfiles${Date.now()}`;
const OUT_KEY = 'rows.csv';
const CSV = 'date,hits\n2026-08-15,42\n2026-08-14,37\n';

const SCRIPTS = {
  // Deterministic production: no model, no network, no caller. Exactly the shape a data-package
  // producer has — build bytes, hand them to storage, return only the address.
  produce: `export default async function(ctx, input){
    if (!ctx.files) return { hasFiles: false };
    var b64 = input.b64;
    var out = await ctx.files.write(input.key, b64, { mime: 'text/csv', visibility: input.visibility || 'public' });
    return { hasFiles: true, wrote: out, callerGaii: ctx.caller.gaii, callerRoles: ctx.caller.roles };
  }`,
  // The failure path. A producer whose source is down must leave no version behind.
  fail: `export default async function(){
    throw new Error('SOURCE_UNAVAILABLE: the upstream register did not answer');
  }`,
  probe: `export default async function(ctx){ return { hasFiles: !!(ctx.files && ctx.files.write) }; }`,
};

const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'scheduled ctx.files e2e', author: 'e2e' },
  actions: [
    { id: 'produce', method: 'POST', path: '/produce', script: 'produce' },
    { id: 'fail', method: 'POST', path: '/fail', script: 'fail' },
    { id: 'probe', method: 'POST', path: '/probe', script: 'probe' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 8000, max_api_calls: 4 },
}, null, 2);

let owner: Awaited<ReturnType<typeof setupOwner>>;
let okScheduleId = '';
let failScheduleId = '';

await test('1. Setup: owner installs and activates the producing extension', async () => {
  owner = await setupOwner('a');
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

await test('2. Baseline: invoked by a person, the sandbox already had files', async () => {
  const r = await json(`/v1/ext/${EXT}/probe`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.hasFiles === true, 'the REST road has always had ctx.files — this is the control');
});

await test('3. An extension action can be put on a clock', async () => {
  const r = await json('/v1/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: `produce-${EXT}`, kind: 'extension', cron: '0 6 * * *',
      extension_name: EXT, action_id: 'produce',
      input: { key: OUT_KEY, b64: Buffer.from(CSV).toString('base64'), visibility: 'public' },
    }),
  });
  assert(r.status === 201 || r.status === 200, `schedule ${r.status}: ${JSON.stringify(r.body?.error)}`);
  okScheduleId = r.body.data.schedule?.id ?? r.body.data.id;
  assert(!!okScheduleId, `no schedule id in ${JSON.stringify(r.body.data)}`);
});

await test('4. THE FIX: a triggered run writes bytes into the INSTALLER\'s namespace', async () => {
  const t = await json(`/v1/schedules/${okScheduleId}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
  const sched = t.body.data.schedule;
  assert(sched.lastRunResult === 'success', `run result ${sched.lastRunResult}: ${sched.lastRunError ?? ''}`);

  // The bytes exist, under the OWNER — not scheduler@node, which owns no storage at all.
  const key = `ext/${EXT}/${OUT_KEY}`;
  const back = await json(`/v1/storage/${encodeURIComponent(key)}`, { headers: auth(owner.token) });
  assert(back.status === 200, `read back as owner ${back.status}: ${JSON.stringify(back.body?.error)}`);
  assert(back.body._raw === CSV, `content mismatch: ${JSON.stringify(back.body._raw ?? back.body).slice(0, 120)}`);
});

await test('5. …and the same bytes are at a permanent public address, no auth', async () => {
  const key = `ext/${EXT}/${OUT_KEY}`;
  const url = `/v1/pub/${encodeURIComponent(owner.gaii)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(`${BASE}${url}`);
  assert(res.status === 200, `anonymous read ${res.status}`);
  assert(await res.text() === CSV, 'the anonymous reader gets the produced bytes');
  // A1 rides along: the address a program reads a dataset from advertises range support.
  assert(res.headers.get('accept-ranges') === 'bytes', 'the produced file is range-readable');

  // The namespace assertion, stated the other way round: nothing landed under the scheduler.
  const wrong = await fetch(`${BASE}/v1/pub/${encodeURIComponent(`scheduler@${NODE_ID}`)}/${key.split('/').map(encodeURIComponent).join('/')}`);
  assert(wrong.status === 404, `scheduler@node must own nothing, got ${wrong.status}`);
});

await test('6. A failed run produces a visible error and NO version', async () => {
  const mk = await json('/v1/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: `fail-${EXT}`, kind: 'extension', cron: '0 7 * * *', extension_name: EXT, action_id: 'fail' }),
  });
  assert(mk.status === 201 || mk.status === 200, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
  failScheduleId = mk.body.data.schedule?.id ?? mk.body.data.id;

  const t = await json(`/v1/schedules/${failScheduleId}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
  const sched = t.body.data.schedule;
  assert(sched.lastRunResult === 'error', `a throwing producer must not read as success, got ${sched.lastRunResult}`);
  assert(/SOURCE_UNAVAILABLE/.test(sched.lastRunError ?? ''), `the reason must reach the owner, got: ${sched.lastRunError}`);
  assert((sched.runCount ?? 0) === 0, `a failed run must not count as a run, got ${sched.runCount}`);
});

await test('7. A scheduled write is charged to the installer, not to nobody', async () => {
  // The quota is the owner's, which is the other consequence of writing into their namespace: an
  // extension on a clock cannot fill the node for free under an identity with no account.
  const files = await json('/v1/storage', { headers: auth(owner.token) });
  assert(files.status === 200, `list ${files.status}`);
  const produced = (files.body.data.files as Array<{ key: string; size: number }>).find(f => f.key === `ext/${EXT}/${OUT_KEY}`);
  assert(!!produced, `the produced file is in the owner's own file list`);
  assert(produced!.size === CSV.length, `size ${produced!.size}`);
});

// ── What a SECOND principal gets. A scheduled producer widens two things — it reads as the
// installer with nobody present, and it writes into their namespace — so the fences worth testing
// are the ones around the artefact and around who may put an action on a clock at all.

await test('8. A stranger cannot read the private artefact a scheduled run produced', async () => {
  // Same run, private this time: the bytes belong to the installer, and a second owner holding a
  // valid token of their own is refused rather than quietly served.
  const privKey = 'private-rows.csv';
  const mk = await json('/v1/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: `private-${EXT}`, kind: 'extension', cron: '0 8 * * *',
      extension_name: EXT, action_id: 'produce',
      input: { key: privKey, b64: Buffer.from(CSV).toString('base64'), visibility: 'private' },
    }),
  });
  assert(mk.status === 201 || mk.status === 200, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
  const privScheduleId = mk.body.data.schedule?.id ?? mk.body.data.id;
  const t = await json(`/v1/schedules/${privScheduleId}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.body.data.schedule.lastRunResult === 'success', `run ${t.body.data.schedule.lastRunError ?? ''}`);

  const other = await setupOwner('b');
  const key = `ext/${EXT}/${privKey}`;
  const path = `/v1/pub/${encodeURIComponent(owner.gaii)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const denied = await json(path, { headers: auth(other.token) });
  assert(denied.status === 403, `a second owner must be refused, got ${denied.status}`);
  const anon = await json(path);
  assert(anon.status === 404, `and an anonymous reader must not even learn it exists, got ${anon.status}`);
  await json(`/v1/schedules/${privScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
});

await test('9. Putting an action on a clock needs auth at all', async () => {
  // The schedule route is what turns an extension into a standing, unmetered call, so it is the one
  // door where "no token" must not be treated as "the owner".
  const r = await json('/v1/schedules', {
    method: 'POST',
    body: JSON.stringify({ name: 'no-auth', kind: 'extension', cron: '0 9 * * *', extension_name: EXT, action_id: 'produce' }),
  });
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Cleanup', async () => {
  await json(`/v1/schedules/${okScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/schedules/${failScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(owner.token) });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
