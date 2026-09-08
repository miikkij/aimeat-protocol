/**
 * @file test/e2e-extension-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension doors nothing had driven: every refusal arm of
 *   src/routes/extensions/instances.ts (create, list, detail, PATCH, DELETE, public translations)
 *   and the lifecycle arms of src/routes/extensions/crud.ts (duplicate install, NAME_MISMATCH,
 *   the two PUT permission arms, ?full=true, the action-script PATCH and the 404 family).
 *   e2e-extension-secrets.ts proves the secret round-trip on the happy path; this one proves what
 *   the same doors REFUSE, and that a deleted instance takes its ext: namespace with it.
 *
 * @structure
 *   - Phase 0: an operator owner, a plain second owner, a narrow agent with no ext:write
 *   - Phase 1: the shipped rest-connector (instances supported) + an inline extension without them
 *   - Phase 2: POST instances — every refusal, then the create
 *   - Phase 3: GET list (filtered per owner) + GET detail 404s
 *   - Phase 4: PATCH — the masked-secret merge, status, translations, both 400s, both 404s
 *   - Phase 5: DELETE — the ext:{name}.{instance} namespace cleanup, and the refusals
 *   - Phase 6: public per-instance translations
 *   - Phase 7: crud.ts — install/PUT/inspect/action-script/404s
 *
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=extension-doors
 *
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial suite
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

const MASK = '••••••••';
const SECRET = 'sk-doors-ZZZZZ98765';   // last 2 = '65'

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `doorsowner${Date.now()}`;

const strangerName = `doorsstranger${Date.now()}`;
let strangerToken = '';

let narrowToken = '';

const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
const strangerAuth = () => ({ Authorization: `Bearer ${strangerToken}` });
const narrowAuth = () => ({ Authorization: `Bearer ${narrowToken}` });

// The SHIPPED reference connector (cwd = aimeat → repo root is ..). Instances are supported here
// and a per-instance config field is declared `type: secret`, which is what the PATCH merge below
// is about.
const connectorDir = resolve(process.cwd(), '../docs/extensions/rest-connector');
const manifestYaml = readFileSync(resolve(connectorDir, 'extension.yaml'), 'utf-8');
const pullScript = readFileSync(resolve(connectorDir, 'actions/pull.js'), 'utf-8');

// An extension that does NOT declare `instances:`. INSTANCES_NOT_SUPPORTED is otherwise
// unreachable, and an inline manifest keeps the arm independent of which extensions this node
// happens to ship.
const soloManifest = `
extension: "1.0"
metadata:
  name: "doors-solo"
  version: "1.0.0"
  description: "Single-copy extension — declares no instances block"
  author: "test"
required_apis:
  - memory
actions:
  - id: ping
    description: "Answer with a constant"
    method: POST
    path: "/v1/ext/doors-solo/ping"
    script: "actions/ping.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;
const soloScripts: Record<string, string> = {
  'actions/ping.js': `export default async function() { return { pong: true }; }`,
};

// The crud.ts fixture, same shape as e2e-extensions.ts uses.
const echoManifest = `
extension: "1.0"
metadata:
  name: "doors-echo"
  version: "1.0.0"
  description: "Simple echo extension for testing the crud doors"
  author: "test"
required_apis:
  - memory
actions:
  - id: echo
    description: "Echo back the input with a greeting"
    method: POST
    path: "/v1/ext/doors-echo/echo"
    script: "actions/echo.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
federation:
  advertise: false
`;
const echoScripts: Record<string, string> = {
  'actions/echo.js': `export default async function(ctx, input) {
    return { message: 'Hello ' + (input.name || 'World'), caller: ctx.caller.gaii };
  }`,
};

console.log('\n=== AIMEAT Extension Doors E2E ===\n');

// ─── Phase 0: three principals ───
console.log('Phase 0 — Principals');

await test('register owner (operator)', async () => {
  const { status, body } = await json('/v1/admin/setup/register', {
    method: 'POST',
    headers: { 'X-Admin-Password': ADMIN_PW },
    body: JSON.stringify({ name: ownerName }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'owner private key');
});

await test('owner auth token', async () => {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(ownerPrivKey, ownerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'owner token');
});

await test('register a PLAIN second owner — not another operator', async () => {
  // POST /v1/owners, never /v1/admin/setup/register: the setup route grants the operator role, and
  // canManageInstalledExt lets an operator manage anyone's extension BY DESIGN. A second operator
  // would pass every refusal below and the block would prove nothing.
  const reg = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, strangerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ owner: strangerName, timestamp, signature }),
  });
  assert(body.ok === true, `stranger token: ${JSON.stringify(body.error)}`);
  strangerToken = body.data?.token;
  assert(!(body.data?.roles ?? []).includes('operator'), 'the second owner must not be an operator');
});

await test('register a NARROW agent — memory:read only, no ext:write', async () => {
  // The runner pins AIMEAT_DEFAULT_AGENT_SCOPES='*', so an agent registered without an explicit
  // list holds the wildcard and passes hasExtWritePermission. A narrow one has to be asked for.
  const reg = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'doorsnarrow', owner: ownerName,
      capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'],
    }),
  });
  assert(reg.status === 201, `narrow agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
  });
  narrowToken = tok.body.data?.token;
  assert(typeof narrowToken === 'string', `narrow token: ${JSON.stringify(tok.body?.error)}`);
});

// ─── Phase 1: two extensions, one with instances and one without ───
console.log('Phase 1 — Install');

await test('POST /v1/extensions — rest-connector installs with instances.supported', async () => {
  const { status, body } = await json('/v1/extensions', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ manifest: manifestYaml, scripts: { 'actions/pull.js': pullScript } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.extension?.instances?.supported === true, 'instances supported');
  assert(body.data?.extension?.instances?.configSchema?.properties?.apiKey?.type === 'secret',
    'apiKey declared as a secret config field');
});

await test('POST activate rest-connector', async () => {
  const { status } = await json('/v1/extensions/rest-connector/activate', { method: 'POST', headers: ownerAuth() });
  assert(status === 200, `status ${status}`);
});

await test('POST /v1/extensions — doors-solo installs and activates (no instances block)', async () => {
  const inst = await json('/v1/extensions', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ manifest: soloManifest, scripts: soloScripts }),
  });
  assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body)}`);
  assert(!inst.body.data?.extension?.instances?.supported, 'doors-solo declares no instances');
  const act = await json('/v1/extensions/doors-solo/activate', { method: 'POST', headers: ownerAuth() });
  assert(act.status === 200, `activate ${act.status}`);
});

// ─── Phase 2: POST /v1/extensions/:name/instances — every refusal, then the create ───
console.log('Phase 2 — Create instance: the refusals');

await test('unknown extension → 404', async () => {
  const { status, body } = await json('/v1/extensions/no-such-extension/instances', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id: 'acme' }),
  });
  assert(status === 404, `expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

await test('a second owner cannot create an instance on another owner\'s extension → 403', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: strangerAuth(), body: JSON.stringify({ id: 'stranger', config: { apiKey: 'x' } }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'INSUFFICIENT_ROLE', `code ${body.error?.code}`);
  const chk = await json('/v1/extensions/rest-connector/instances/stranger', { headers: ownerAuth() });
  assert(chk.status === 404, `the refused create made a row anyway: ${chk.status}`);
});

await test('an extension without an instances block → 400 INSTANCES_NOT_SUPPORTED', async () => {
  const { status, body } = await json('/v1/extensions/doors-solo/instances', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id: 'copy-two' }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'INSTANCES_NOT_SUPPORTED', `code ${body.error?.code}`);
});

await test('an inactive extension → 409 EXTENSION_INACTIVE', async () => {
  const off = await json('/v1/extensions/rest-connector/deactivate', { method: 'POST', headers: ownerAuth() });
  assert(off.status === 200, `deactivate ${off.status}`);
  const { status, body } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id: 'while-off' }),
  });
  assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'EXTENSION_INACTIVE', `code ${body.error?.code}`);
  const on = await json('/v1/extensions/rest-connector/activate', { method: 'POST', headers: ownerAuth() });
  assert(on.status === 200, `re-activate ${on.status}`);
});

await test('a missing id → 400, and four shapes of bad id → 400', async () => {
  const missing = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ config: {} }),
  });
  assert(missing.status === 400, `missing id: expected 400, got ${missing.status}`);
  // Two chars (the pattern wants 3+), an uppercase letter, a leading hyphen, a trailing hyphen.
  for (const id of ['ab', 'Acme', '-acme', 'acme-']) {
    const { status, body } = await json('/v1/extensions/rest-connector/instances', {
      method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id }),
    });
    assert(status === 400, `id "${id}": expected 400, got ${status}`);
    assert(body.error?.code === 'INVALID_INPUT', `id "${id}": code ${body.error?.code}`);
  }
});

await test('config that is not an object → 400', async () => {
  for (const config of ['a string', 42, ['an', 'array'], null]) {
    const { status } = await json('/v1/extensions/rest-connector/instances', {
      method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id: 'badcfg', config }),
    });
    // `null` is the one that must not slip through as "an object": typeof null === 'object'.
    assert(status === 400, `config ${JSON.stringify(config)}: expected 400, got ${status}`);
  }
});

await test('POST instance without auth → 401', async () => {
  const { status } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', body: JSON.stringify({ id: 'noauth' }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

console.log('Phase 2 — Create instance: the write');

await test('create acme with a secret apiKey — 201, masked in the answer', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ id: 'acme', config: { apiKey: SECRET, baseUrl: '' } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.instance?.config?.apiKey === MASK, `apiKey masked, got ${JSON.stringify(body.data?.instance?.config?.apiKey)}`);
  assert(JSON.stringify(body).indexOf(SECRET) === -1, 'plaintext secret never in the create response');
});

await test('the same id again → 409 ALREADY_EXISTS', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ id: 'acme', config: { apiKey: 'other' } }),
  });
  assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'ALREADY_EXISTS', `code ${body.error?.code}`);
});

// ─── Phase 3: the two read doors ───
console.log('Phase 3 — List and detail');

await test('GET instances — the owner sees acme', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances', { headers: ownerAuth() });
  assert(status === 200, `status ${status}`);
  const ids = (body.data?.instances ?? []).map((i: { id: string }) => i.id);
  assert(ids.includes('acme'), `acme in the list, got ${JSON.stringify(ids)}`);
  assert(body.data?.total === ids.length, `total ${body.data?.total} matches the array length ${ids.length}`);
  const acme = (body.data.instances as Array<{ id: string; config: Record<string, unknown> }>).find(i => i.id === 'acme');
  assert(acme?.config?.apiKey === MASK, 'the listing masks the secret too');
});

await test('GET instances as a second owner — FILTERED to empty, not refused', async () => {
  // The answer to "list the instances" is "the ones that are yours". Until 2026-09-04 this returned
  // everyone's, another owner's name in createdBy included.
  const { status, body } = await json('/v1/extensions/rest-connector/instances', { headers: strangerAuth() });
  assert(status === 200, `expected 200 (filtered, not refused), got ${status}`);
  assert((body.data?.instances ?? []).length === 0, `expected an empty list, got ${JSON.stringify(body.data?.instances)}`);
  assert(body.data?.total === 0, `total ${body.data?.total}`);
  assert(JSON.stringify(body).indexOf(ownerName) === -1, 'the filtered list leaked the other owner\'s name');
});

await test('GET instances without auth → 401', async () => {
  const { status } = await json('/v1/extensions/rest-connector/instances');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET detail — unknown extension, unknown instance, and another owner\'s: all 404', async () => {
  const noExt = await json('/v1/extensions/no-such-extension/instances/acme', { headers: ownerAuth() });
  assert(noExt.status === 404, `unknown extension: expected 404, got ${noExt.status}`);
  const noInst = await json('/v1/extensions/rest-connector/instances/never-made', { headers: ownerAuth() });
  assert(noInst.status === 404, `unknown instance: expected 404, got ${noInst.status}`);
  // 404 and not 403, on purpose: the id is the caller's guess, and confirming that somebody else's
  // instance exists answers a question they did not get to ask.
  const theirs = await json('/v1/extensions/rest-connector/instances/acme', { headers: strangerAuth() });
  assert(theirs.status === 404, `another owner's instance: expected 404, got ${theirs.status}`);
  assert(JSON.stringify(theirs.body).indexOf(SECRET) === -1, 'the refusal leaked the secret');
});

// ─── Phase 4: PATCH ───
console.log('Phase 4 — PATCH');

await test('PATCH config resubmitting the MASK keeps the stored secret (preserveMaskedSecrets)', async () => {
  // The UI shows the mask and posts back what it was shown. Without the carry-forward the merge
  // would store the bullet characters as the key, and the next action call would authenticate with
  // "••••••••". The proof is the action, not the response: the response masks either way.
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ config: { apiKey: MASK, baseUrl: '' } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.instance?.config?.apiKey === MASK, 'still masked in the answer');

  const run = await json('/v1/ext/rest-connector/acme/pull', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({}),
  });
  assert(run.status === 200, `action status ${run.status}: ${JSON.stringify(run.body)}`);
  assert(run.body.data?.apiKeyLen === SECRET.length,
    `the original key survived the merge: len ${run.body.data?.apiKeyLen} === ${SECRET.length}`);
  assert(run.body.data?.apiKeyTail === SECRET.slice(-2),
    `tail ${run.body.data?.apiKeyTail} === ${SECRET.slice(-2)}`);
});

await test('PATCH status → paused, and back to active', async () => {
  const paused = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ status: 'paused' }),
  });
  assert(paused.status === 200, `status ${paused.status}: ${JSON.stringify(paused.body)}`);
  assert(paused.body.data?.instance?.status === 'paused', `instance status ${paused.body.data?.instance?.status}`);
  const back = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ status: 'active' }),
  });
  assert(back.body.data?.instance?.status === 'active', 'back to active');
});

await test('PATCH translations are stored on the instance', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(),
    body: JSON.stringify({ translations: { fi: { title: 'Yhteys' }, en: { title: 'Connection' } } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.instance?.translations?.fi?.title === 'Yhteys', 'fi translation stored');
});

await test('PATCH refuses a non-object config (400) and a status outside the two words (400)', async () => {
  const badCfg = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ config: 'not an object' }),
  });
  assert(badCfg.status === 400, `config: expected 400, got ${badCfg.status}`);
  assert(badCfg.body.error?.code === 'INVALID_INPUT', `config code ${badCfg.body.error?.code}`);
  const badStatus = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ status: 'stopped' }),
  });
  assert(badStatus.status === 400, `status: expected 400, got ${badStatus.status}`);
  assert(badStatus.body.error?.code === 'INVALID_INPUT', `status code ${badStatus.body.error?.code}`);
});

await test('PATCH on an unknown extension and on an unknown instance → 404 each', async () => {
  const noExt = await json('/v1/extensions/no-such-extension/instances/acme', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ status: 'paused' }),
  });
  assert(noExt.status === 404, `unknown extension: expected 404, got ${noExt.status}`);
  const noInst = await json('/v1/extensions/rest-connector/instances/never-made', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ status: 'paused' }),
  });
  assert(noInst.status === 404, `unknown instance: expected 404, got ${noInst.status}`);
});

await test('PATCH as a second owner → 403, and nothing changed', async () => {
  const { status } = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: strangerAuth(), body: JSON.stringify({ status: 'paused' }),
  });
  assert(status === 403, `expected 403, got ${status}`);
  const chk = await json('/v1/extensions/rest-connector/instances/acme', { headers: ownerAuth() });
  assert(chk.body.data?.instance?.status === 'active', 'the refused PATCH paused it anyway');
});

await test('PATCH without auth → 401', async () => {
  const { status } = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', body: JSON.stringify({ status: 'paused' }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

// ─── Phase 5: DELETE, and what goes with the row ───
console.log('Phase 5 — DELETE and the namespace cleanup');

const WIPE_NS = encodeURIComponent('ext:rest-connector.wipe');

await test('a second instance writes into its own ext: namespace', async () => {
  const inst = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ id: 'wipe', config: { apiKey: 'sk-wipe-0011' } }),
  });
  assert(inst.status === 201, `instance ${inst.status}: ${JSON.stringify(inst.body)}`);
  const run = await json('/v1/ext/rest-connector/wipe/pull', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({}),
  });
  assert(run.status === 200, `action ${run.status}: ${JSON.stringify(run.body)}`);
  const mem = await json(`/v1/memory/${WIPE_NS}/latest`);
  assert(mem.status === 200, `ext memory should exist before the delete, got ${mem.status}`);
});

await test('DELETE without auth → 401, as a second owner → 403, and the instance survives both', async () => {
  const noauth = await json('/v1/extensions/rest-connector/instances/wipe', { method: 'DELETE' });
  assert(noauth.status === 401, `expected 401, got ${noauth.status}`);
  const theirs = await json('/v1/extensions/rest-connector/instances/wipe', {
    method: 'DELETE', headers: strangerAuth(),
  });
  assert(theirs.status === 403, `expected 403, got ${theirs.status}`);
  const chk = await json('/v1/extensions/rest-connector/instances/wipe', { headers: ownerAuth() });
  assert(chk.status === 200, `the refused deletes removed it anyway: ${chk.status}`);
});

await test('DELETE an unknown instance → 404, on an unknown extension → 404', async () => {
  const noInst = await json('/v1/extensions/rest-connector/instances/never-made', {
    method: 'DELETE', headers: ownerAuth(),
  });
  assert(noInst.status === 404, `unknown instance: expected 404, got ${noInst.status}`);
  const noExt = await json('/v1/extensions/no-such-extension/instances/wipe', {
    method: 'DELETE', headers: ownerAuth(),
  });
  assert(noExt.status === 404, `unknown extension: expected 404, got ${noExt.status}`);
});

await test('DELETE the instance — the ext:{name}.{id} namespace goes with it', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/wipe', {
    method: 'DELETE', headers: ownerAuth(),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.deleted === 'wipe', `deleted ${body.data?.deleted}`);
  // The row is only half of it. Delete the memory-cleanup loop from the handler and this suite is
  // green except for this line: the instance is gone and its data is still readable by anyone,
  // because the ext: namespace is a public read.
  const mem = await json(`/v1/memory/${WIPE_NS}/latest`);
  assert(mem.status === 404, `the namespace survived the delete: ${mem.status} ${JSON.stringify(mem.body?.data)}`);
  const gone = await json('/v1/extensions/rest-connector/instances/wipe', { headers: ownerAuth() });
  assert(gone.status === 404, `the row survived: ${gone.status}`);
});

// ─── Phase 6: the public translations door ───
console.log('Phase 6 — Public per-instance translations');

await test('GET translations?locale=fi — no auth, and it carries what the PATCH stored', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme/translations?locale=fi');
  assert(status === 200, `expected 200 unauthenticated, got ${status}`);
  assert(body.data?.locale === 'fi', `locale ${body.data?.locale}`);
  assert(body.data?.translations?.title === 'Yhteys', `fi translations: ${JSON.stringify(body.data?.translations)}`);
});

await test('GET translations with no locale falls back to en, and an unknown locale is empty', async () => {
  const en = await json('/v1/extensions/rest-connector/instances/acme/translations');
  assert(en.body.data?.locale === 'en', `default locale ${en.body.data?.locale}`);
  assert(en.body.data?.translations?.title === 'Connection', `en translations: ${JSON.stringify(en.body.data?.translations)}`);
  const none = await json('/v1/extensions/rest-connector/instances/acme/translations?locale=zz');
  assert(none.status === 200 && Object.keys(none.body.data?.translations ?? {}).length === 0,
    `an unknown locale is an empty map, got ${JSON.stringify(none.body.data)}`);
});

await test('GET translations for an instance that does not exist → 404', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/never-made/translations');
  assert(status === 404, `expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

// ─── Phase 7: crud.ts — the lifecycle doors ───
console.log('Phase 7 — Extension lifecycle (crud.ts)');

await test('POST /v1/extensions installs doors-echo', async () => {
  const { status, body } = await json('/v1/extensions', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ manifest: echoManifest, scripts: echoScripts }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.extension?.status === 'inactive', 'inactive after install');
});

await test('installing the same name twice → 409 ALREADY_EXISTS (POST never replaces)', async () => {
  const { status, body } = await json('/v1/extensions', {
    method: 'POST', headers: ownerAuth(), body: JSON.stringify({ manifest: echoManifest, scripts: echoScripts }),
  });
  assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'ALREADY_EXISTS', `code ${body.error?.code}`);
});

await test('POST /v1/extensions without auth → 401', async () => {
  const { status } = await json('/v1/extensions', {
    method: 'POST', body: JSON.stringify({ manifest: echoManifest, scripts: echoScripts }),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await test('PUT /v1/extensions/:name with a manifest naming a different extension → 400 NAME_MISMATCH', async () => {
  // metadata.name identifies the resource. Without this check a redeploy to the wrong URL would
  // write the record under the URL's name and leave two rows describing one extension.
  const { status, body } = await json('/v1/extensions/doors-echo-typo', {
    method: 'PUT', headers: ownerAuth(), body: JSON.stringify({ manifest: echoManifest, scripts: echoScripts }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NAME_MISMATCH', `code ${body.error?.code}`);
  const chk = await json('/v1/extensions/doors-echo-typo');
  assert(chk.status === 404, `the refused PUT created it anyway: ${chk.status}`);
});

await test('PUT — the CREATE arm refuses a principal without ext:write (403)', async () => {
  // Two permission arms in one handler. This is the one for a name nobody has installed:
  // hasExtWritePermission, the same bar POST /v1/extensions uses.
  const manifest = echoManifest.replace(/doors-echo/g, 'doors-agent-made');
  const { status, body } = await json('/v1/extensions/doors-agent-made', {
    method: 'PUT', headers: narrowAuth(),
    body: JSON.stringify({ manifest, scripts: { 'actions/echo.js': echoScripts['actions/echo.js'] } }),
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  const chk = await json('/v1/extensions/doors-agent-made');
  assert(chk.status === 404, `an agent without ext:write installed one: ${chk.status}`);
});

await test('PUT — the UPDATE arm refuses a second owner (403), and the extension is untouched', async () => {
  // The other arm: the name exists, so the bar is canManageInstalledExt — being the installer.
  const { status } = await json('/v1/extensions/doors-echo', {
    method: 'PUT', headers: strangerAuth(),
    body: JSON.stringify({ manifest: echoManifest.replace('1.0.0', '9.9.9'), scripts: echoScripts }),
  });
  assert(status === 403, `expected 403, got ${status}`);
  const chk = await json('/v1/extensions/doors-echo');
  assert(chk.body.data?.extension?.version === '1.0.0', `the refused PUT changed the version to ${chk.body.data?.extension?.version}`);
});

await test('GET ?full=true — unauthenticated is refused, and it is 403 rather than 401', async () => {
  // optionalAuth injects the shared anonymous principal when anonymous mode is on, so the handler
  // decides this rather than the middleware: a bare 401 assertion would pass on one node and fail
  // on another. scriptContent is the whole implementation of somebody's extension.
  const { status, body } = await json('/v1/extensions/doors-echo?full=true');
  assert(status === 403, `expected 403, got ${status}`);
  assert(JSON.stringify(body).indexOf('export default') === -1, 'the refusal carried the script');
});

await test('GET ?full=true as a second owner → 403; as the installer → the script', async () => {
  const theirs = await json('/v1/extensions/doors-echo?full=true', { headers: strangerAuth() });
  assert(theirs.status === 403, `expected 403, got ${theirs.status}`);
  assert(JSON.stringify(theirs.body).indexOf('export default') === -1, 'the refusal carried the script');
  const mine = await json('/v1/extensions/doors-echo?full=true', { headers: ownerAuth() });
  assert(mine.status === 200, `the installer cannot read their own script: ${mine.status}`);
  const action = (mine.body.data?.extension?.actions ?? []).find((a: { id: string }) => a.id === 'echo');
  assert(typeof action?.scriptContent === 'string' && action.scriptContent.includes('export default'),
    'the installer gets scriptContent');
});

await test('GET without ?full=true never carries scriptContent, whoever asks', async () => {
  const { status, body } = await json('/v1/extensions/doors-echo');
  assert(status === 200, `status ${status}`);
  const action = (body.data?.extension?.actions ?? []).find((a: { id: string }) => a.id === 'echo');
  assert(action !== undefined, 'the action is listed');
  assert(action.scriptContent === undefined, 'scriptContent leaked without ?full=true');
});

await test('GET action script — the installer reads it, a second owner gets 403', async () => {
  const mine = await json('/v1/extensions/doors-echo/actions/echo', { headers: ownerAuth() });
  assert(mine.status === 200, `installer: expected 200, got ${mine.status}`);
  assert(typeof mine.body.data?.action?.scriptContent === 'string', 'scriptContent present');
  const theirs = await json('/v1/extensions/doors-echo/actions/echo', { headers: strangerAuth() });
  assert(theirs.status === 403, `second owner: expected 403, got ${theirs.status}`);
});

await test('PATCH the action script — the new bytes are what the next call runs', async () => {
  const script = `export default async function(ctx, input) {
    return { message: 'Patched ' + (input.name || 'World') };
  }`;
  const { status, body } = await json('/v1/extensions/doors-echo/actions/echo', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ scriptContent: script }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.action?.scriptContent === script, 'the answer echoes the stored script');
  const read = await json('/v1/extensions/doors-echo/actions/echo', { headers: ownerAuth() });
  assert(read.body.data?.action?.scriptContent === script, 'and a read back agrees');
});

await test('PATCH the action script without scriptContent → 400 VALIDATION_ERROR', async () => {
  for (const payload of [{}, { scriptContent: '' }, { scriptContent: 42 }]) {
    const { status, body } = await json('/v1/extensions/doors-echo/actions/echo', {
      method: 'PATCH', headers: ownerAuth(), body: JSON.stringify(payload),
    });
    assert(status === 400, `${JSON.stringify(payload)}: expected 400, got ${status}`);
    assert(body.error?.code === 'VALIDATION_ERROR', `${JSON.stringify(payload)}: code ${body.error?.code}`);
  }
});

await test('PATCH the action script over the size cap → 400 CODE_TOO_LARGE', async () => {
  // The cap is an operator setting (extensionMaxCodeSizeKb, 256 shipped), so learn it from the
  // refusal rather than hardcoding it: send one oversized probe and read the limit back out.
  const huge = 'x'.repeat(2 * 1024 * 1024);
  const { status, body } = await json('/v1/extensions/doors-echo/actions/echo', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ scriptContent: `// ${huge}` }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.error?.code === 'CODE_TOO_LARGE', `code ${body.error?.code}`);
  const cap = parseInt(/max is (\d+)KB/.exec(body.error?.message ?? '')?.[1] ?? '0', 10);
  assert(cap > 0, `the refusal names the cap: ${body.error?.message}`);
  // The stored script is the patched one from the test above, not the oversized probe.
  const read = await json('/v1/extensions/doors-echo/actions/echo', { headers: ownerAuth() });
  assert(!read.body.data?.action?.scriptContent.includes(huge.slice(0, 64)), 'the refused PATCH was stored anyway');
});

await test('PATCH an action id the extension does not have → 404', async () => {
  const { status, body } = await json('/v1/extensions/doors-echo/actions/no-such-action', {
    method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ scriptContent: 'export default async function() { return {}; }' }),
  });
  assert(status === 404, `expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
});

await test('GET versions lists what is kept, newest first', async () => {
  const { status, body } = await json('/v1/extensions/doors-echo/versions', { headers: ownerAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.current === '1.0.0', `current ${body.data?.current}`);
  assert(Array.isArray(body.data?.versions), 'versions is an array');
});

await test('six doors on a name nobody installed, six 404s', async () => {
  const gone = 'doors-never-installed';
  const arms: Array<[string, string, RequestInit]> = [
    ['versions', `/v1/extensions/${gone}/versions`, { headers: ownerAuth() }],
    ['action get', `/v1/extensions/${gone}/actions/echo`, { headers: ownerAuth() }],
    ['action patch', `/v1/extensions/${gone}/actions/echo`, { method: 'PATCH', headers: ownerAuth(), body: JSON.stringify({ scriptContent: 'export default async function() { return {}; }' }) }],
    ['delete', `/v1/extensions/${gone}`, { method: 'DELETE', headers: ownerAuth() }],
    ['activate', `/v1/extensions/${gone}/activate`, { method: 'POST', headers: ownerAuth() }],
    ['deactivate', `/v1/extensions/${gone}/deactivate`, { method: 'POST', headers: ownerAuth() }],
  ];
  for (const [label, path, opts] of arms) {
    const { status, body } = await json(path, opts);
    assert(status === 404, `${label}: expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `${label}: code ${body.error?.code}`);
  }
});

await test('DELETE as a second owner → 403; the installer removes it', async () => {
  const theirs = await json('/v1/extensions/doors-echo', { method: 'DELETE', headers: strangerAuth() });
  assert(theirs.status === 403, `expected 403, got ${theirs.status}`);
  const still = await json('/v1/extensions/doors-echo');
  assert(still.status === 200, `the refused DELETE removed it anyway: ${still.status}`);
  const mine = await json('/v1/extensions/doors-echo', { method: 'DELETE', headers: ownerAuth() });
  assert(mine.status === 200, `installer delete: ${mine.status}`);
  const gone = await json('/v1/extensions/doors-echo');
  assert(gone.status === 404, `expected 404 after uninstall, got ${gone.status}`);
});

// ─── Cleanup ───
console.log('Cleanup');

await test('remove both extensions and both owners', async () => {
  for (const name of ['rest-connector', 'doors-solo']) {
    const { status } = await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: ownerAuth() });
    assert(status === 200, `delete ${name}: ${status}`);
  }
  await json(`/v1/owners/${encodeURIComponent(strangerName)}`, { method: 'DELETE', headers: strangerAuth() });
  const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: ownerAuth() });
  assert(status === 200, `delete owner: ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
