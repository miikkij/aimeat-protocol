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
 *   v1.5.1 -- 2026-10-21 -- 23d: the app that made a kept schedule runs it now with its own token, as
 *     the fire runs it; its edit still asks ext:invoke, and run now on a schedule the list does not
 *     keep is still refused.
 *   v1.5.0 -- 2026-10-21 -- Tests 23b to 23d (capability-loss review of the ext:invoke fix): an agent
 *     refused at the fire gets the owner's one-press Allow and then runs; an app's schedule from before
 *     2026-10-05 runs as the account while a revoked grant's stops; an app schedule kept by the
 *     once-only step runs while a grant narrowed after the step stops. The suite exits explicitly.
 *   v1.4.0 -- 2026-10-20 -- Tests 24 to 26: the presigned ZIP route records who wrote the code, so an
 *     agent's ZIP redeploy falls under the owner's 'installer' narrowing (secaudit 2026-10,
 *     handleExtensionUpload:installedByPrincipal-not-stamped) and the owner's own ZIP records the
 *     owner; a ZIP URL kept by a deleted agent is refused with the code unchanged (secaudit 2026-10,
 *     PUT-v1-upload:no-live-principal-recheck).
 *   v1.3.0 -- 2026-10-20 -- Tests 19 to 23 (secaudit 2026-10, SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke):
 *     a task:write-only agent is refused creating, editing and running an extension schedule on REST
 *     and MCP; with ext:invoke it may; a maker the owner narrows or deletes no longer runs the action.
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
import { deflateRawSync, crc32 } from 'node:zlib';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { EXTENSION_SCHEDULE_KEEP_KEY, keepAppExtensionSchedulesOnce } from '../src/services/schedule-extension-keep.js';
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

// ── WHO MAY PUT AN EXTENSION ACTION ON A CLOCK, AND WHO THE FIRE RUNS AS ─────────────────────────
//
// secaudit 2026-10, SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke. POST /v1/ext/:ext/:action
// asks ext:invoke. The schedule route asked only task:write, so an agent the owner had kept from
// running extension actions ran any of them, with input it chose, by creating a schedule and
// triggering it. Create, edit and run-now now ask ext:invoke of anyone but the owner in person, and
// the fire asks the maker again (services/schedule-actor.ts), so a maker the owner narrows or deletes
// afterwards no longer runs the action. Test 4 above is the owner's own schedule, which is unchanged.

const makerInput = (key: string) => ({ key, b64: Buffer.from(`made for ${key}`).toString('base64'), visibility: 'private' });
const ownerFile = (key: string) => json(`/v1/storage/${encodeURIComponent(`ext/${EXT}/${key}`)}`, { headers: auth(owner.token) });
const extSchedule = (key: string, name: string) => JSON.stringify({
  kind: 'extension', cron: '0 0 1 1 *', display_name: name, extension_name: EXT, action_id: 'produce', input: makerInput(key),
});
let taskOnly: McpAgent;
let invoker: McpAgent;
let invokerScheduleId = '';
const makerScheduleIds: string[] = [];

await test('19. A task:write-only agent is refused putting an extension action on a clock (REST and MCP)', async () => {
  taskOnly = await makeAgent(BASE, owner, ['task:write', 'workflow:read', 'workflow:write']);
  // The control the finding rests on: the direct endpoint refuses this agent.
  const direct = await json(`/v1/ext/${EXT}/produce`, { method: 'POST', headers: auth(taskOnly.token), body: JSON.stringify(makerInput('v52-direct.csv')) });
  assert(direct.status === 403, `the direct invoke must refuse a task:write-only agent, got ${direct.status}`);

  const rest = await json('/v1/schedules', { method: 'POST', headers: auth(taskOnly.token), body: extSchedule('v52-rest.csv', 'v52-rest') });
  assert(rest.status === 403 && rest.body.error?.code === 'SCOPE_DENIED', `REST create: ${rest.status} ${JSON.stringify(rest.body?.error)}`);
  assert(/ext:invoke/.test(rest.body.error?.message ?? ''), `the refusal names the permission: ${rest.body.error?.message}`);

  const s = await openSession(BASE, taskOnly.token);
  const mcp = await callTool(s, 'aimeat_schedule_create', {
    kind: 'extension', cron: '0 0 1 1 *', display_name: 'v52-mcp', extension_name: EXT, action_id: 'produce', input: makerInput('v52-mcp.csv'),
  });
  // The tool itself refuses (its own word is task:write, which the agent holds), so the answer is the
  // schedule gate's sentence and not the registration filter's.
  assert(mcp.isError && /Creating a "extension" schedule requires the "ext:invoke" scope/.test(mcp.text),
    `MCP create must be refused naming ext:invoke: ${mcp.text.slice(0, 200)}`);

  const list = await json('/v1/schedules', { headers: auth(owner.token) });
  const names = (list.body.data.managed as any[]).map(m => m.displayName);
  assert(!names.includes('v52-rest') && !names.includes('v52-mcp'), `a refused create was stored: ${JSON.stringify(names)}`);
});

await test('20. Control: the same agent with ext:invoke creates and runs it, and the bytes land in the owner\'s storage', async () => {
  invoker = await makeAgent(BASE, owner, ['task:write', 'workflow:read', 'workflow:write', 'ext:invoke']);
  const mk = await json('/v1/schedules', { method: 'POST', headers: auth(invoker.token), body: extSchedule('v52-ok.csv', 'v52-ok') });
  assert(mk.status === 201, `create with ext:invoke: ${mk.status} ${JSON.stringify(mk.body?.error)}`);
  invokerScheduleId = mk.body.data.schedule.id;
  makerScheduleIds.push(invokerScheduleId);
  const t = await json(`/v1/schedules/${invokerScheduleId}/trigger`, { method: 'POST', headers: auth(invoker.token), body: '{}' });
  assert(t.status === 200, `trigger with ext:invoke: ${t.status} ${JSON.stringify(t.body?.error)}`);
  assert(t.body.data.schedule.lastRunResult === 'success', `run: ${t.body.data.schedule.lastRunResult} ${t.body.data.schedule.lastRunError ?? ''}`);
  const back = await ownerFile('v52-ok.csv');
  assert(back.status === 200, `the produced file is the owner's: ${back.status}`);
});

await test('21. The task:write-only agent is refused editing and running that schedule (REST and MCP)', async () => {
  const edit = await json(`/v1/schedules/${invokerScheduleId}`, {
    method: 'PATCH', headers: auth(taskOnly.token), body: JSON.stringify({ input: makerInput('v52-edited.csv') }),
  });
  assert(edit.status === 403 && edit.body.error?.code === 'SCOPE_DENIED', `edit: ${edit.status} ${JSON.stringify(edit.body?.error)}`);
  const run = await json(`/v1/schedules/${invokerScheduleId}/trigger`, { method: 'POST', headers: auth(taskOnly.token), body: '{}' });
  assert(run.status === 403 && run.body.error?.code === 'SCOPE_DENIED', `REST trigger: ${run.status} ${JSON.stringify(run.body?.error)}`);
  const s = await openSession(BASE, taskOnly.token);
  const mcp = await callTool(s, 'aimeat_schedule_trigger', { schedule_id: invokerScheduleId });
  assert(mcp.isError && /Running a "extension" schedule requires the "ext:invoke" scope/.test(mcp.text),
    `MCP trigger must be refused naming ext:invoke: ${mcp.text.slice(0, 200)}`);

  const got = await json(`/v1/schedules/${invokerScheduleId}`, { headers: auth(owner.token) });
  assert(!JSON.stringify(got.body.data.schedule.input ?? {}).includes('v52-edited'), 'the refused edit was stored');
  assert((got.body.data.schedule.runCount ?? 0) === 1, `a refused run ran: runCount ${got.body.data.schedule.runCount}`);
});

await test('22. After the owner narrows the maker to drop ext:invoke, a fire does not run the action', async () => {
  await json(`/v1/storage/${encodeURIComponent(`ext/${EXT}/v52-ok.csv`)}`, { method: 'DELETE', headers: auth(owner.token) });
  assert((await ownerFile('v52-ok.csv')).status === 404, 'the file from test 20 is gone before the fire');
  const narrow = await json(`/v1/agents/${invoker.name}/scopes`, {
    method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ scopes: ['task:write', 'workflow:read', 'workflow:write'] }),
  });
  assert(narrow.status === 200, `owner narrows: ${narrow.status} ${JSON.stringify(narrow.body?.error)}`);

  // The owner in person runs it: the owner may, and the fire still asks the maker.
  const t = await json(`/v1/schedules/${invokerScheduleId}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `owner trigger: ${t.status} ${JSON.stringify(t.body?.error)}`);
  assert(t.body.data.schedule.lastRunResult === 'error', `a narrowed maker's schedule ran: ${t.body.data.schedule.lastRunResult}`);
  assert(/ext:invoke/.test(t.body.data.schedule.lastRunError ?? ''), `the run log names the permission: ${t.body.data.schedule.lastRunError}`);
  assert((await ownerFile('v52-ok.csv')).status === 404, 'the refused fire wrote the file');
});

await test('23. After the owner deletes the maker, a fire does not run the action', async () => {
  const gone = await makeAgent(BASE, owner, ['task:write', 'workflow:read', 'ext:invoke']);
  const mk = await json('/v1/schedules', { method: 'POST', headers: auth(gone.token), body: extSchedule('v52-gone.csv', 'v52-gone') });
  assert(mk.status === 201, `create: ${mk.status} ${JSON.stringify(mk.body?.error)}`);
  const id = mk.body.data.schedule.id as string;
  makerScheduleIds.push(id);
  const del = await json(`/v1/agents/${gone.name}`, { method: 'DELETE', headers: auth(owner.token) });
  assert(del.status === 200, `owner deletes the maker: ${del.status} ${JSON.stringify(del.body?.error)}`);

  const t = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `owner trigger: ${t.status} ${JSON.stringify(t.body?.error)}`);
  assert(t.body.data.schedule.lastRunResult === 'error', `a deleted maker's schedule ran: ${t.body.data.schedule.lastRunResult}`);
  assert(/no longer connected/.test(t.body.data.schedule.lastRunError ?? ''), `the run log names the maker as gone: ${t.body.data.schedule.lastRunError}`);
  assert((await ownerFile('v52-gone.csv')).status === 404, 'the refused fire wrote the file');
  // A deleted maker is not something to allow: the plain sentence, with no Allow address.
  assert(!/\/v1\/allow\?/.test(t.body.data.schedule.lastRunError ?? ''), `a deleted maker was offered Allow: ${t.body.data.schedule.lastRunError}`);
});

// ── WHAT WORKED KEEPS WORKING (capability-loss review, 2026-10-21) ─────────────────────────────
//
// The fix closes the way in; it may not take away a use that already ran. Three uses are kept, each
// beside the refusal that keeps the hole closed:
//   23b  an agent refused for a missing word: the owner is asked with one press, and after Allow it runs;
//   23c  an app's schedule from before 2026-10-05 (no grant recorded) runs as the account, as it did;
//        one that names its grant stops when the grant is revoked;
//   23d  an app's schedule made before the kind asked ext:invoke, from a grant without the word, runs
//        after the once-only keep step; a grant the owner narrowed after that step stops.
// Nothing reachable over HTTP writes a schedule in its pre-2026-10-05 shape or a grant record, so
// these tests write them into the node's own database from here, on whichever backend the runner pinned.

const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
let backend: Storage | null = null;
async function openBackend(): Promise<Storage> {
  if (backend) return backend;
  const dbUrl = serverDbUrl();
  const sqlitePath = pinnedSqlitePath();
  assert((provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl),
    `backend "${provider}" is not reachable from this process`);
  backend = await createStorage({ provider, sqlitePath, dbUrl });
  return backend;
}
/** A live app grant of `owner`, written as the grant route would leave it. */
async function grantOf(storage: Storage, scopes: string[]): Promise<string> {
  const grantId = `appgrant-e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  // One grant per (owner, app), so each grant names an app of its own.
  await storage.createAppGrant({
    grantId, app: `${owner.name}/${grantId}.html`, appName: 'Keep', appOrigin: BASE, owner: owner.name, gaii: owner.gaii,
    scopes, refreshTokenHash: null, createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false,
  });
  return grantId;
}
/** An extension schedule the owner makes, for the database edit that gives it another maker. */
async function ownerExtSchedule(key: string, name: string): Promise<string> {
  const mk = await json('/v1/schedules', { method: 'POST', headers: auth(owner.token), body: extSchedule(key, name) });
  assert(mk.status === 201, `owner create: ${mk.status} ${JSON.stringify(mk.body?.error)}`);
  makerScheduleIds.push(mk.body.data.schedule.id);
  return mk.body.data.schedule.id as string;
}
const fire = async (id: string) => {
  const t = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `owner trigger: ${t.status} ${JSON.stringify(t.body?.error)}`);
  return t.body.data.schedule as { lastRunResult: string; lastRunError?: string };
};

await test('23b. KEPT: the owner of a refused agent is asked with one press, and after Allow the schedule runs again', async () => {
  // Test 22 left the narrowed maker's schedule refused. The run log says where to allow it…
  const got = await json(`/v1/schedules/${invokerScheduleId}`, { headers: auth(owner.token) });
  const said: string = got.body.data.schedule.lastRunError ?? '';
  assert(said.includes(`/v1/allow?agent=${invoker.name}&need=ext%3Ainvoke`), `the run log carries the one-press address: ${said}`);
  // …and the bell holds the question with its Allow button (services/permission-ask-notice.ts).
  let ask: any;
  for (let i = 0; i < 50 && !ask; i++) {
    const n = await json('/v1/notifications', { headers: auth(owner.token) });
    ask = (n.body?.data?.notifications ?? []).find((x: any) => x.type === 'agent_permission_ask'
      && x.actions?.some((a: any) => a.endpoint === `/v1/agents/${encodeURIComponent(invoker.name)}/allow`));
    if (!ask) await new Promise(r => setTimeout(r, 100));
  }
  assert(!!ask, 'no Allow notice for the refused agent in the bell');
  const allow = ask.actions.find((a: any) => a.endpoint?.endsWith('/allow'));
  assert(JSON.stringify(allow.body?.scopes) === '["ext:invoke"]', `the Allow button gives exactly ext:invoke: ${JSON.stringify(allow.body)}`);
  const pressed = await json(allow.endpoint, { method: 'POST', headers: auth(owner.token), body: JSON.stringify(allow.body) });
  assert(pressed.status === 200, `Allow: ${pressed.status} ${JSON.stringify(pressed.body?.error)}`);

  const ran = await fire(invokerScheduleId);
  assert(ran.lastRunResult === 'success', `after Allow it runs again: ${ran.lastRunResult} ${ran.lastRunError ?? ''}`);
  assert((await ownerFile('v52-ok.csv')).status === 200, 'and writes its file');
});

await test('23c. KEPT: an app\'s schedule from before 2026-10-05 runs as the account; a revoked grant\'s schedule stops', async () => {
  const storage = await openBackend();
  const oldId = await ownerExtSchedule('v52-oldapp.csv', 'v52-oldapp');
  // The pre-2026-10-05 shape: the owner's identity as the maker, marked as not the owner in person, no grant.
  await storage.updateScheduledJob(oldId, { createdByAgent: true });
  const old = await fire(oldId);
  assert(old.lastRunResult === 'success', `an old app schedule must keep firing: ${old.lastRunResult} ${old.lastRunError ?? ''}`);
  assert((await ownerFile('v52-oldapp.csv')).status === 200, 'and write its file');

  // The hole stays closed: a schedule that names its grant stops when the owner revokes the grant.
  const grantId = await grantOf(storage, ['task:write', 'workflow:write', 'ext:invoke']);
  const appId = await ownerExtSchedule('v52-revoked.csv', 'v52-revoked');
  await storage.updateScheduledJob(appId, { createdByAgent: true, createdByApp: grantId });
  assert((await fire(appId)).lastRunResult === 'success', 'control: a live grant holding ext:invoke runs');
  await json(`/v1/storage/${encodeURIComponent(`ext/${EXT}/v52-revoked.csv`)}`, { method: 'DELETE', headers: auth(owner.token) });
  await storage.updateAppGrant(grantId, { revoked: true });
  const revoked = await fire(appId);
  assert(revoked.lastRunResult === 'error', `a revoked grant's schedule ran: ${revoked.lastRunResult}`);
  assert(/no longer holds your permission/.test(revoked.lastRunError ?? ''), `the reason: ${revoked.lastRunError}`);
  assert((await ownerFile('v52-revoked.csv')).status === 404, 'the refused fire wrote the file');
});

await test('23d. KEPT: an app schedule made before the rule from a grant without ext:invoke runs after the keep step; a later narrowing stops', async () => {
  const storage = await openBackend();
  // Made under the old rule: the grant holds task:write and not ext:invoke.
  const narrowGrant = await grantOf(storage, ['task:write', 'workflow:write']);
  const keptId = await ownerExtSchedule('v52-kept.csv', 'v52-kept');
  await storage.updateScheduledJob(keptId, { createdByAgent: true, createdByApp: narrowGrant });
  // A grant that held the word when the step ran, narrowed by the owner afterwards.
  const wideGrant = await grantOf(storage, ['task:write', 'workflow:write', 'ext:invoke']);
  const laterId = await ownerExtSchedule('v52-later.csv', 'v52-later');
  await storage.updateScheduledJob(laterId, { createdByAgent: true, createdByApp: wideGrant });

  const before = await fire(keptId);
  assert(before.lastRunResult === 'error' && /ext:invoke/.test(before.lastRunError ?? ''), `without the step it is refused: ${before.lastRunResult} ${before.lastRunError ?? ''}`);

  // The node's first start with the rule, run here: the step's record is taken away and the step runs.
  await storage.deleteMemory(`system@${NODE_ID}`, EXTENSION_SCHEDULE_KEEP_KEY, `system@${NODE_ID}`);
  const step = await keepAppExtensionSchedulesOnce(storage, { nodeId: NODE_ID });
  assert(step.ran && step.ids.includes(keptId), `the step keeps the old schedule: ${JSON.stringify(step)}`);
  assert(!step.ids.includes(laterId), 'a grant holding ext:invoke needs no keeping');

  const after = await fire(keptId);
  assert(after.lastRunResult === 'success', `the kept schedule runs: ${after.lastRunResult} ${after.lastRunError ?? ''}`);
  assert((await ownerFile('v52-kept.csv')).status === 200, 'and writes its file');

  // "Run now" by the app that made the kept schedule works as its fire does; an edit by it still asks
  // ext:invoke, and so does "run now" on a schedule the list does not keep.
  const appToken = async (grantId: string): Promise<string> => {
    const raw = `e2e-refresh-${grantId}-${Date.now()}`;
    await storage.updateAppGrant(grantId, { refreshTokenHash: createHash('sha256').update(raw).digest('hex') });
    const tk = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: raw }) });
    assert(tk.status === 200 && typeof tk.body?.data?.access_token === 'string', `app token for ${grantId}: ${tk.status} ${JSON.stringify(tk.body?.error)}`);
    return tk.body.data.access_token as string;
  };
  await json(`/v1/storage/${encodeURIComponent(`ext/${EXT}/v52-kept.csv`)}`, { method: 'DELETE', headers: auth(owner.token) });
  const keptApp = await appToken(narrowGrant);
  const runNow = await json(`/v1/schedules/${keptId}/trigger`, { method: 'POST', headers: auth(keptApp), body: '{}' });
  assert(runNow.status === 200 && runNow.body.data.schedule?.lastRunResult === 'success',
    `the app runs its kept schedule now: ${runNow.status} ${JSON.stringify(runNow.body?.error ?? runNow.body?.data?.schedule?.lastRunError)}`);
  assert((await ownerFile('v52-kept.csv')).status === 200, 'and the run now writes its file');
  const edit = await json(`/v1/schedules/${keptId}`, { method: 'PATCH', headers: auth(keptApp), body: JSON.stringify({ cron: '0 0 2 1 *' }) });
  assert(edit.status === 403, `an edit by the kept app still asks ext:invoke: ${edit.status} ${JSON.stringify(edit.body?.error)}`);

  // The hole stays closed: the owner narrows the other grant after the step, and its schedule stops.
  await storage.updateAppGrant(wideGrant, { scopes: ['task:write', 'workflow:write'] });
  const later = await fire(laterId);
  assert(later.lastRunResult === 'error' && /ext:invoke/.test(later.lastRunError ?? ''), `a narrowing after the step must stop it: ${later.lastRunResult} ${later.lastRunError ?? ''}`);
  assert((await ownerFile('v52-later.csv')).status === 404, 'the refused fire wrote the file');
  const laterRunNow = await json(`/v1/schedules/${laterId}/trigger`, { method: 'POST', headers: auth(await appToken(wideGrant)), body: '{}' });
  assert(laterRunNow.status === 403 && laterRunNow.body?.error?.code === 'SCOPE_DENIED',
    `run now on a schedule the list does not keep still asks ext:invoke: ${laterRunNow.status} ${JSON.stringify(laterRunNow.body?.error)}`);
  // And the kept grant stops when it is revoked, kept or not.
  await storage.updateAppGrant(narrowGrant, { revoked: true });
  assert((await fire(keptId)).lastRunResult === 'error', 'a revoked grant\'s kept schedule ran');
});

// ── THE PRESIGNED ZIP ROUTE RECORDS WHO WROTE THE CODE ────────────────────────────────────────
//
// secaudit 2026-10, handleExtensionUpload:installedByPrincipal-not-stamped. The inline install and
// redeploy routes stamp the principal that wrote the code (installedByPrincipal), and the owner's
// 'installer' narrowing reads files with that principal's reach. The presigned ZIP route did not stamp
// it: an agent's ZIP redeploy of an extension the owner wrote kept the owner as the writer, so the
// agent's new code read the owner's private files under a narrowing that should have stopped it.

/** Minimal deflated ZIP writer (as test/e2e-presigned-meta.ts), so the suite needs no dependency. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const lf = Buffer.alloc(30);
    lf.writeUInt32LE(0x04034b50, 0); lf.writeUInt16LE(20, 4); lf.writeUInt16LE(0, 6);
    lf.writeUInt16LE(8, 8); lf.writeUInt16LE(0, 10); lf.writeUInt16LE(0, 12);
    lf.writeUInt32LE(crc, 14); lf.writeUInt32LE(comp.length, 18); lf.writeUInt32LE(raw.length, 22);
    lf.writeUInt16LE(nameBuf.length, 26); lf.writeUInt16LE(0, 28);
    const local = Buffer.concat([lf, nameBuf, comp]);
    locals.push(local);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cd, nameBuf]));
    offset += local.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, end]);
}

/** The probe extension as a ZIP at `version`: manifest.yaml at the root, the scripts under scripts/. */
const probeZip = (extName: string, version: string) => makeZip({
  'manifest.yaml': probeManifest(extName).replace('"version": "1.0.0"', `"version": "${version}"`),
  ...Object.fromEntries(Object.entries(PROBE_SCRIPTS).map(([id, src]) => [`scripts/${id}`, src])),
});

/** Mint a presigned ZIP upsert as `token`; PUT `zip` to it unless the caller keeps the URL for later. */
async function zipUpsert(token: string, zip: Buffer | null): Promise<{ url: string; status: number; body: any }> {
  const m = await json('/v1/extensions', { method: 'POST', headers: auth(token), body: JSON.stringify({ mode: 'presigned', update: true }) });
  assert(m.status === 200 && typeof m.body.data?.upload_url === 'string', `mint ${m.status}: ${JSON.stringify(m.body?.error)}`);
  const url = m.body.data.upload_url as string;
  if (!zip) return { url, status: 0, body: null };
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(zip) });
  return { url, status: res.status, body: await res.json() };
}

await test('24. An agent\'s ZIP redeploy records the agent as the code writer, and the owner\'s narrowing applies to it', async () => {
  // OWNER_EXT was written by the owner in person and set to 'installer' in test 18.
  const before = await readerSetting(OWNER_EXT, reader.token);
  assert(before.installed_by_kind === 'self' && before.authority === 'installer', `start: ${JSON.stringify(before)}`);

  const up = await zipUpsert(agent.token, probeZip(OWNER_EXT, '1.0.1'));
  assert(up.status === 200 && up.body.updated === true, `ZIP redeploy ${up.status}: ${JSON.stringify(up.body)}`);

  const view = await readerSetting(OWNER_EXT, reader.token);
  assert(view.installed_by_kind === 'agent', `the agent wrote this code, got ${view.installed_by_kind}`);
  assert(view.installed_by_principal === agent.gaii, `named exactly, got ${view.installed_by_principal}`);
  assert(view.authority === 'installer', `and the owner's choice survives the ZIP write, got ${view.authority}`);

  await runProbeUnattended(OWNER_EXT);
  const probe = await probeOutcome(OWNER_EXT, reader.token);
  assert(probe.ok === false, `the agent's code must be refused the private file, got ${JSON.stringify(probe)}`);
  assert(probe.size === undefined && probe.head === undefined, 'nothing of the file reaches it');
  assert(/installer/i.test(probe.message ?? ''), `the refusal names the setting, got: ${probe.message}`);
});

await test('25. Control: the owner\'s own ZIP redeploy records the owner, and the run reads the file again', async () => {
  const up = await zipUpsert(reader.token, probeZip(OWNER_EXT, '1.0.2'));
  assert(up.status === 200 && up.body.updated === true, `ZIP redeploy ${up.status}: ${JSON.stringify(up.body)}`);
  const view = await readerSetting(OWNER_EXT, reader.token);
  assert(view.installed_by_kind === 'self', `the owner wrote this code, got ${view.installed_by_kind}`);
  await runProbeUnattended(OWNER_EXT);
  const probe = await probeOutcome(OWNER_EXT, reader.token);
  assert(probe.ok === true && probe.size === SECRET_TEXT.length, `the owner's code reads the file, got ${JSON.stringify(probe)}`);
});

await test('26. A ZIP upload URL kept by an agent the owner deleted is refused 401, and the code stays as it was', async () => {
  const doomed = await makeAgent(BASE, reader, ['ext:write', 'ext:invoke']);
  const { url } = await zipUpsert(doomed.token, null);
  const del = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: auth(reader.token) });
  assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);

  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Uint8Array(probeZip(OWNER_EXT, '9.9.9')) });
  assert(res.status === 401, `the PUT must be refused, got ${res.status}: ${await res.text()}`);
  const ext = await json(`/v1/extensions/${OWNER_EXT}`, { headers: auth(reader.token) });
  assert(ext.status === 200, `read ${ext.status}`);
  const version = ext.body.data?.version ?? ext.body.data?.extension?.version;
  assert(version === '1.0.2', `the code must be unchanged, got version ${version}`);
});

await test('Cleanup', async () => {
  for (const id of makerScheduleIds) await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/schedules/${okScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/schedules/${failScheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${AGENT_EXT}`, { method: 'DELETE', headers: auth(reader.token) });
  await json(`/v1/extensions/${OWNER_EXT}`, { method: 'DELETE', headers: auth(reader.token) });
  await json(`/v1/storage/${encodeURIComponent(SECRET_KEY)}`, { method: 'DELETE', headers: auth(reader.token) });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
// An exit, not an end of script: the database handle tests 23c and 23d opened would hold the process open.
process.exit(failed > 0 ? 1 : 0);
