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
 *
 *   THE READER IS NOT THE NAMESPACE, AND THE OWNER DECIDES WHO IT IS. Tests 10 to 18. The default is
 *   the owner's own reach, which is what every node already does, so test 11 is the regression guard
 *   that this deploy stops no working extension. The rest prove the control is real: the setting
 *   names the agent that wrote the code (12), an agent cannot write it (13), the owner's narrowing
 *   refuses the unattended read and says where to undo it (14), publishing new code does not reset it
 *   (16), and the owner can widen it back (17).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=scheduled-ext-files
 * @version-history
 *   v1.2.0 -- 2026-10-20 -- Tests 11 to 18 follow the owner's per-extension choice: the default keeps
 *     today's behaviour, and the narrowing is the owner's to set (Jouni, 2026-10-20).
 *   v1.1.0 -- 2026-10-20 -- Tests 10 to 13: the read authority of an unattended run (secaudit
 *     2026-10, extension-system-run:files-read-as-owner-ghii).
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

import { ownerSignIn } from './helpers/owner-login.js';
async function setupOwner(label: string) {
  const name = `sef${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sched', password: 'SchedFiles1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sched', password: 'SchedFiles1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, 'SchedFiles1234');
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

// ── WHOSE AUTHORITY AN UNATTENDED RUN READS WITH ──────────────────────────────────────────────
//
// Tests 4 and 7 above fix the NAMESPACE: a produced file lands in the owner's storage, because an
// address has to be permanent. The reader is a second question, and nothing asserted it until
// 2026-10-20. ctx.files was handed the owner's GHII as its accessor, and authorizeRead admits every
// private file of the account it names, so an agent holding only ext:write and ext:invoke installed
// an extension, put its action on the unattended road, and read back what the action had found in
// the owner's private files — a read the same agent is refused through the attended invoke and
// through GET /v1/pub (secaudit 2026-10, extension-system-run:files-read-as-owner-ghii).
//
// THE OWNER DECIDES, AND THE DEFAULT IS THE OLD BEHAVIOUR. An owner's agent acts for that owner, and
// ext:write is the owner's own grant of the reach, so closing the read by default would stop working
// extensions on nodes whose owners never asked for the narrower rule (Jouni, 2026-10-20). What
// changed instead is that the reach is visible and the owner can turn it down per extension.
//
// So test 11 is the one that matters most here: it proves the deploy breaks nothing. Tests 12 to 18
// prove the control is real — that the person can actually set it, that an agent cannot, that a
// refusal says where to change it, and that publishing new code does not quietly reset it.

const SECRET_KEY = 'vault/secret.txt';
const SECRET_TEXT = 'nine byte';            // 9 bytes, as the finding's evidence had it
const AGENT_EXT = `agentread${Date.now()}`;
const OWNER_EXT = `ownerread${Date.now()}`;

const PROBE_SCRIPTS = {
  // Reads the owner's private file and keeps the outcome, so the result survives the run and can
  // be asked for afterwards. A refusal is caught, so the run itself is a success and the only
  // thing under test is WHAT the action learned.
  probe: `export default async function(ctx, input){
    var out;
    try {
      var got = await ctx.files.read(input.ref);
      out = got ? { ok: true, size: got.size, head: got.base64.slice(0, 16) } : { ok: true, size: null };
    } catch (e) { out = { ok: false, message: String(e && e.message || e) }; }
    await ctx.memory.set('probe', out);
    return out;
  }`,
  report: `export default async function(ctx){ return { probe: await ctx.memory.get('probe') }; }`,
  peek: `export default async function(ctx, input){
    try { var got = await ctx.files.read(input.ref); return { ok: true, size: got && got.size }; }
    catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  }`,
};

const probeManifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'unattended read authority e2e', author: 'e2e' },
  actions: [
    { id: 'probe', method: 'POST', path: '/probe', script: 'probe' },
    { id: 'report', method: 'POST', path: '/report', script: 'report' },
    { id: 'peek', method: 'POST', path: '/peek', script: 'peek' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 8000, max_api_calls: 4 },
}, null, 2);

let reader: Awaited<ReturnType<typeof setupOwner>>;
let agent: { name: string; gaii: string; token: string };
let secretRef = '';

/** One unattended run of `probe` on `extName`, through a schedule the owner makes and fires. */
async function runProbeUnattended(extName: string): Promise<void> {
  const mk = await json('/v1/schedules', {
    method: 'POST', headers: auth(reader.token),
    body: JSON.stringify({
      name: `probe-${extName}`, kind: 'extension', cron: '0 5 * * *',
      extension_name: extName, action_id: 'probe', input: { ref: secretRef },
    }),
  });
  assert(mk.status === 201, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
  const id = mk.body.data.schedule?.id ?? mk.body.data.id;
  const t = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth(reader.token), body: '{}' });
  assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
  assert(t.body.data.schedule.lastRunResult === 'success',
    `the run itself must complete, got ${t.body.data.schedule.lastRunResult}: ${t.body.data.schedule.lastRunError ?? ''}`);
  await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth(reader.token) });
}

await test('10. Setup: an owner with a private file, and an agent of theirs holding only ext:write and ext:invoke', async () => {
  reader = await setupOwner('c');
  secretRef = `${reader.gaii}/${SECRET_KEY}`;
  const put = await json('/v1/storage', {
    method: 'POST', headers: auth(reader.token),
    body: JSON.stringify({ key: SECRET_KEY, data: Buffer.from(SECRET_TEXT).toString('base64'), mime_type: 'text/plain', visibility: 'private' }),
  });
  assert(put.status === 201, `storage ${put.status}: ${JSON.stringify(put.body?.error)}`);

  const reg = await json('/v1/agents', {
    method: 'POST', headers: auth(reader.token),
    body: JSON.stringify({ name: 'extinstaller', owner: reader.name, capabilities: ['memory'], scopes: ['ext:write', 'ext:invoke'] }),
  });
  assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const priv = reg.body.data.private_key as string;
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(priv, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
  assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body?.error)}`);
  agent = { name: 'extinstaller', gaii, token: tok.body.data.token as string };

  // The baseline the whole finding rests on: this agent cannot read the file by asking for it.
  const direct = await json(`/v1/pub/${encodeURIComponent(reader.gaii)}/${SECRET_KEY.split('/').map(encodeURIComponent).join('/')}`, { headers: auth(agent.token) });
  assert(direct.status !== 200, `the agent must not read the owner's private file directly, got ${direct.status}`);
});

/** What the probe left behind, collected through an attended call on the same extension. */
async function probeOutcome(extName: string, token: string): Promise<{ ok: boolean; message?: string; size?: number; head?: string }> {
  const got = await json(`/v1/ext/${extName}/report`, { method: 'POST', headers: auth(token), body: '{}' });
  assert(got.status === 200, `report ${got.status}: ${JSON.stringify(got.body?.error)}`);
  const probe = got.body.data.probe as { ok: boolean; message?: string; size?: number; head?: string } | null;
  assert(!!probe, 'the unattended run must have left its outcome behind');
  return probe!;
}

/** GET the setting as the owner. */
async function readerSetting(extName: string, token: string) {
  const r = await json(`/v1/extensions/${extName}/unattended-reader`, { headers: auth(token) });
  assert(r.status === 200, `unattended-reader ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return r.body.data as {
    authority: string; is_default: boolean; installed_by_kind: string;
    installed_by_principal?: string; narrowing_is_inert: boolean; changed_at_url: string;
  };
}

/** PATCH the setting, as whoever the token names. Returns the raw response so a refusal is testable. */
const setAuthority = (extName: string, token: string, authority: string) =>
  json(`/v1/extensions/${extName}/unattended-reader`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ authority }),
  });

await test('11. THE DEPLOY BREAKS NOTHING: by default an agent-installed extension still reads the owner\'s file unattended', async () => {
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ manifest: probeManifest(AGENT_EXT), scripts: PROBE_SCRIPTS }) });
  assert(inst.status === 201, `agent install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${AGENT_EXT}/activate`, { method: 'POST', headers: auth(agent.token) });
  assert(act.status === 200, `agent activate ${act.status}: ${JSON.stringify(act.body?.error)}`);

  await runProbeUnattended(AGENT_EXT);

  // THIS IS THE REGRESSION GUARD. An owner who never touched the setting must see no change at all,
  // or a deploy turns every working extension into an error nobody asked for (Jouni, 2026-10-20).
  const probe = await probeOutcome(AGENT_EXT, agent.token);
  assert(probe.ok === true, `the default must keep reading, got ${JSON.stringify(probe)}`);
  assert(probe.size === SECRET_TEXT.length, `and get the real bytes, got size ${probe.size}`);
});

await test('12. The setting says what is in force and WHO wrote the code, so the reach is not invisible', async () => {
  const view = await readerSetting(AGENT_EXT, reader.token);
  assert(view.authority === 'owner', `the default in force is the owner's reach, got ${view.authority}`);
  assert(view.is_default === true, 'and it reports that nobody has chosen it yet');
  assert(view.installed_by_kind === 'agent', `the installer is an agent, got ${view.installed_by_kind}`);
  assert(view.installed_by_principal === agent.gaii, `named exactly, got ${view.installed_by_principal}`);
  assert(view.narrowing_is_inert === false, 'and narrowing would really change something here');
  assert(typeof view.changed_at_url === 'string' && view.changed_at_url.length > 0,
    'the answer carries where the person changes it, because an agent reading this cannot');
});

await test('13. The AGENT cannot change it: an agent widening its own extension would undo the setting', async () => {
  const r = await setAuthority(AGENT_EXT, agent.token, 'installer');
  assert(r.status === 403, `the agent must be refused the write, got ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
  // And the refusal changed nothing.
  const view = await readerSetting(AGENT_EXT, reader.token);
  assert(view.authority === 'owner', `the setting must be untouched, got ${view.authority}`);
});

await test('14. The owner narrows it, and the same unattended run is now refused the private file', async () => {
  const set = await setAuthority(AGENT_EXT, reader.token, 'installer');
  assert(set.status === 200, `the owner's write ${set.status}: ${JSON.stringify(set.body?.error)}`);
  assert(set.body.data.authority === 'installer', `and it takes, got ${set.body.data.authority}`);
  assert(set.body.data.is_default === false, 'and is no longer the untouched default');

  await runProbeUnattended(AGENT_EXT);

  const probe = await probeOutcome(AGENT_EXT, agent.token);
  assert(probe.ok === false, `now the run must be refused the file, got ${JSON.stringify(probe)}`);
  assert(probe.size === undefined, `no size reaches the agent, got ${probe.size}`);
  assert(probe.head === undefined, `and no content, got ${probe.head}`);
  // A NARROWING MUST NOT READ AS A FAULT. The message names the owner's own setting and where to
  // change it, or nobody can tell this from a real permission problem (Jouni, 2026-10-20).
  assert(/denied|not permitted|consent|classified/i.test(probe.message ?? ''), `it must say it was refused, got: ${probe.message}`);
  assert(/installer/i.test(probe.message ?? ''), `and name the setting, got: ${probe.message}`);
  assert(/extensions/i.test(probe.message ?? ''), `and where to change it, got: ${probe.message}`);
});

await test('15. The attended invoke was refused for that agent all along, narrowed or not', async () => {
  const r = await json(`/v1/ext/${AGENT_EXT}/peek`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ ref: secretRef }) });
  assert(r.status === 200, `peek ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.ok === false, `the attended read must be refused, got ${JSON.stringify(r.body.data)}`);
});

await test('16. Publishing new code does not reset the owner\'s choice', async () => {
  // The failure this prevents: an agent clears a setting it may not write, by redeploying its own
  // extension. extension-upsert.ts leaves the column out of the update for exactly this reason.
  // PUT is the upsert-in-place route (routes/extensions/crud.ts); POST refuses an existing name.
  const again = await json(`/v1/extensions/${AGENT_EXT}`, {
    method: 'PUT', headers: auth(agent.token),
    body: JSON.stringify({ manifest: probeManifest(AGENT_EXT), scripts: PROBE_SCRIPTS }),
  });
  assert(again.status === 200 || again.status === 201, `redeploy ${again.status}: ${JSON.stringify(again.body?.error)}`);
  const view = await readerSetting(AGENT_EXT, reader.token);
  assert(view.authority === 'installer', `the narrowing must survive a redeploy, got ${view.authority}`);
});

await test('17. The owner widens it back, and the run reads the file again', async () => {
  const set = await setAuthority(AGENT_EXT, reader.token, 'owner');
  assert(set.status === 200, `the owner's write ${set.status}: ${JSON.stringify(set.body?.error)}`);

  await runProbeUnattended(AGENT_EXT);

  const probe = await probeOutcome(AGENT_EXT, agent.token);
  assert(probe.ok === true, `the owner may undo their own narrowing, got ${JSON.stringify(probe)}`);
  assert(probe.size === SECRET_TEXT.length, `and the bytes come back, got size ${probe.size}`);
});

await test('18. An extension the owner wrote in person reads the file whichever setting they choose', async () => {
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ manifest: probeManifest(OWNER_EXT), scripts: PROBE_SCRIPTS }) });
  assert(inst.status === 201, `owner install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${OWNER_EXT}/activate`, { method: 'POST', headers: auth(reader.token) });
  assert(act.status === 200, `owner activate ${act.status}: ${JSON.stringify(act.body?.error)}`);

  // The page says so rather than offering a control that does nothing: narrowing to "the principal
  // that wrote the code" narrows to the account holder, which is no narrowing at all.
  const before = await readerSetting(OWNER_EXT, reader.token);
  assert(before.installed_by_kind === 'self', `the owner wrote it, got ${before.installed_by_kind}`);
  assert(before.narrowing_is_inert === true, 'and the setting is reported as inert for it');
  assert(before.installed_by_principal === undefined, 'with no agent name to show');

  const set = await setAuthority(OWNER_EXT, reader.token, 'installer');
  assert(set.status === 200, `the write is still accepted ${set.status}: ${JSON.stringify(set.body?.error)}`);

  await runProbeUnattended(OWNER_EXT);

  const probe = await probeOutcome(OWNER_EXT, reader.token);
  assert(probe.ok === true, `it must still read the file, got ${JSON.stringify(probe)}`);
  assert(probe.size === SECRET_TEXT.length, `and get the real bytes, got size ${probe.size}`);
});

await test('Cleanup', async () => {
  await json(`/v1/schedules/${okScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/schedules/${failScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${AGENT_EXT}`, { method: 'DELETE', headers: auth(reader.token) });
  await json(`/v1/extensions/${OWNER_EXT}`, { method: 'DELETE', headers: auth(reader.token) });
  await json(`/v1/storage/${encodeURIComponent(SECRET_KEY)}`, { method: 'DELETE', headers: auth(reader.token) });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
