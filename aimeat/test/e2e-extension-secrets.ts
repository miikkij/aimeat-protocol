// E2E test — Extension secret config (Secretary P5 / S-C, §18)
//
// Verifies the reference `rest-connector` extension (docs/extensions/rest-connector):
//  - a per-instance `type: secret` config field round-trips ENCRYPTED (ciphertext at rest,
//    never plaintext; masked in API responses);
//  - a live action call decrypts the secret inside the sandbox and populates ext: memory;
//  - a scheduled (cron) sync does the same with the instance's decrypted secret;
//  - the SSRF guard rejects internal hosts when the action fetches.
//
// Run via the CI runner: cd aimeat && pnpm exec node --env-file=.env.test.sqlite \
//   --import tsx test/run-e2e-ci.ts --test=extension-secrets

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

const MASK = '••••••••';
const SECRET = 'sk-acme-ABCDE12345';   // last 2 = '45', length 18
const BETA_SECRET = 'sk-beta-key-7777'; // last 2 = '77'

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
const ownerName = `secowner${Date.now()}`;

// Load the SHIPPED reference connector from disk (cwd = aimeat → repo root is ..).
const connectorDir = resolve(process.cwd(), '../docs/extensions/rest-connector');
const manifestYaml = readFileSync(resolve(connectorDir, 'extension.yaml'), 'utf-8');
const pullScript = readFileSync(resolve(connectorDir, 'actions/pull.js'), 'utf-8');

console.log('\n=== AIMEAT Extension Secret Config E2E (S-C) ===\n');

// ─── Phase 0: Setup ───
console.log('Phase 0 — Setup');

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

// ─── Phase 1: Install + activate the reference connector ───
console.log('Phase 1 — Install reference connector');

await test('POST /v1/extensions — install rest-connector (from shipped files)', async () => {
  const { status, body } = await json('/v1/extensions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest: manifestYaml, scripts: { 'actions/pull.js': pullScript } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.extension?.name === 'rest-connector', 'name');
  assert(body.data?.extension?.instances?.supported === true, 'instances supported');
  const props = body.data?.extension?.instances?.configSchema?.properties;
  assert(props?.apiKey?.type === 'secret', 'apiKey declared as secret in configSchema');
});

await test('POST activate', async () => {
  const { status } = await json('/v1/extensions/rest-connector/activate', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
});

// ─── Phase 2: Create an instance with a secret — encrypted round-trip ───
console.log('Phase 2 — Secret round-trips encrypted + masked');

await test('POST instance — create acme with secret apiKey; response is MASKED', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ id: 'acme', config: { apiKey: SECRET, baseUrl: '' } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const cfg = body.data?.instance?.config ?? {};
  assert(cfg.apiKey === MASK, `apiKey masked in create response, got ${JSON.stringify(cfg.apiKey)}`);
  assert(JSON.stringify(body).indexOf(SECRET) === -1, 'plaintext secret never in create response');
});

await test('GET instance — apiKey masked, plaintext never returned', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
  assert(body.data?.instance?.config?.apiKey === MASK, 'apiKey masked on GET');
  assert(JSON.stringify(body).indexOf(SECRET) === -1, 'plaintext secret never in GET response');
});

await test('ciphertext at rest (SQLite raw-read) — stored as {encrypted}, not plaintext', async () => {
  const dbType = process.env.AIMEAT_DB ?? 'memory';
  if (dbType !== 'sqlite') { console.log('    (skip: backend is not sqlite)'); return; }
  let Database: any;
  try { Database = (await import('better-sqlite3')).default; }
  catch { console.log('    (skip: better-sqlite3 unavailable)'); return; }
  const dbPath = resolve(process.cwd(), process.env.AIMEAT_DB_PATH ?? 'test/.test-e2e.db');
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT config FROM extension_instances WHERE extensionName = ? AND id = ?')
      .get('rest-connector', 'acme') as { config: string } | undefined;
    assert(!!row, 'instance row present');
    assert(row!.config.indexOf(SECRET) === -1, 'raw stored config must NOT contain plaintext secret');
    const parsed = JSON.parse(row!.config);
    assert(parsed.apiKey && typeof parsed.apiKey.encrypted === 'string', 'apiKey stored as {encrypted}');
    assert(parsed.apiKey.encrypted.split(':').length === 3, 'ciphertext is iv:tag:ct (AES-256-GCM)');
  } finally { db.close(); }
});

// ─── Phase 3: Action decrypts the secret + populates ext: memory ───
console.log('Phase 3 — Action decrypts secret + writes ext: memory');

await test('POST action pull — secret decrypted to plaintext string inside the sandbox', async () => {
  const { status, body } = await json('/v1/ext/rest-connector/acme/pull', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({}),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const r = body.data ?? {};
  assert(r.apiKeyType === 'string', `decrypted to a string, got ${r.apiKeyType}`);
  assert(r.apiKeyConfigured === true, 'apiKeyConfigured');
  assert(r.apiKeyLen === SECRET.length, `apiKeyLen ${r.apiKeyLen} === ${SECRET.length}`);
  assert(r.apiKeyTail === SECRET.slice(-2), `apiKeyTail ${r.apiKeyTail} === ${SECRET.slice(-2)}`);
  assert(r.fetched === null, 'no fetch when no url/baseUrl');
});

await test('GET ext: memory — action populated latest', async () => {
  const ns = encodeURIComponent('ext:rest-connector.acme');
  const { status, body } = await json(`/v1/memory/${ns}/latest`);
  assert(status === 200, `status ${status}`);
  assert(body.data?.value?.apiKeyTail === SECRET.slice(-2), 'ext memory carries the synced summary');
  assert(JSON.stringify(body).indexOf(SECRET) === -1, 'ext memory never contains the plaintext secret');
});

// ─── Phase 4: SSRF guard (failure mode) ───
console.log('Phase 4 — SSRF guard rejects internal hosts');

await test('POST action pull with internal url — rejected by SSRF guard', async () => {
  const { status, body } = await json('/v1/ext/rest-connector/acme/pull', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
  });
  assert(status >= 400, `expected error status, got ${status}`);
  assert(body.ok === false, 'ok false');
  const msg = JSON.stringify(body).toLowerCase();
  assert(msg.includes('block') || msg.includes('ssrf') || msg.includes('not allowed') || msg.includes('internal'),
    `error mentions the block: ${JSON.stringify(body.error)}`);
});

// ─── Phase 5: Scheduled (cron) sync decrypts the instance secret ───
console.log('Phase 5 — Scheduled sync uses the instance’s decrypted secret');

let betaScheduleId = '';

await test('create instance beta + extension schedule (instance-scoped)', async () => {
  const inst = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ id: 'beta', config: { apiKey: BETA_SECRET } }),
  });
  assert(inst.status === 201, `instance status ${inst.status}: ${JSON.stringify(inst.body)}`);

  const sched = await json('/v1/schedules', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      kind: 'extension', cron: '0 0 * * *',
      extension_name: 'rest-connector', action_id: 'pull', instance_id: 'beta',
      display_name: 'rest-connector beta sync',
    }),
  });
  assert(sched.status === 201, `schedule status ${sched.status}: ${JSON.stringify(sched.body)}`);
  betaScheduleId = sched.body?.data?.schedule?.id;
  assert(typeof betaScheduleId === 'string' && betaScheduleId.length > 0, 'schedule id');
});

await test('trigger schedule — scheduled run writes beta ext: memory with its own decrypted key', async () => {
  const trig = await json(`/v1/schedules/${betaScheduleId}/trigger`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(trig.status === 200, `trigger status ${trig.status}: ${JSON.stringify(trig.body)}`);

  const ns = encodeURIComponent('ext:rest-connector.beta');
  const { status, body } = await json(`/v1/memory/${ns}/latest`);
  assert(status === 200, `beta ext memory status ${status}`);
  assert(body.data?.value?.apiKeyType === 'string', 'scheduled run decrypted the secret');
  assert(body.data?.value?.apiKeyTail === BETA_SECRET.slice(-2),
    `scheduled run used beta's key tail ${body.data?.value?.apiKeyTail} === ${BETA_SECRET.slice(-2)}`);
});

// ─── Phase 6: Idempotent redeploy with a secret config ───
console.log('Phase 6 — Idempotent redeploy (secret IV churn does not falsely "update")');

await test('PUT identical manifest — reports unchanged despite encrypted config', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector', {
    method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ manifest: manifestYaml, scripts: { 'actions/pull.js': pullScript } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.action === 'unchanged', `expected unchanged, got ${body.data?.action}`);
});

// ─── Phase 7: Who else reaches the secret, and the extension holding it ───
//
// Everything above drives ONE owner, so it proves the secret is masked and encrypted and says
// nothing about whose eyes the mask is for. The class this asks about is not hypothetical: until
// 2026-08-10 any agent holding ext:write could uninstall ANOTHER owner's extension (5befb1ba), and
// the suites of the day were green throughout because none of them had a second principal in it.
console.log('Phase 7 — A second owner, and no owner at all');

const strangerName = `secstranger${Date.now()}`;
let strangerToken = '';

await test('register a second owner — a PLAIN one, not another operator', async () => {
  // POST /v1/owners, NOT /v1/admin/setup/register. The setup route is how the owner at the top of
  // this file was made, and its test name says "(operator)" for a reason: it grants the operator
  // role. canManageInstalledExt allows an operator to manage anyone's extension BY DESIGN, so a
  // second principal made the same way passes every gate below and reads like a cross-owner hole.
  // The first draft of this block did exactly that and reported a 200 where it expected a refusal.
  const reg = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, strangerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: strangerName, timestamp, signature }),
  });
  assert(body.ok === true, `stranger token: ${JSON.stringify(body.error)}`);
  strangerToken = body.data?.token;
  assert(!(body.data?.roles ?? []).includes('operator'), 'the second owner must not be an operator');
});

await test('an unauthenticated caller cannot read the instance', async () => {
  const { status } = await json('/v1/extensions/rest-connector/instances/acme');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('a second owner cannot read the instance, masked or otherwise', async () => {
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme', {
    headers: { Authorization: `Bearer ${strangerToken}` },
  });
  assert(status === 403 || status === 404, `expected 403 or 404, got ${status}: ${JSON.stringify(body)}`);
  // Belt and braces: whatever the status, the plaintext must not be in the body. A refusal that
  // still echoes the config would be the same defect wearing a 403.
  assert(JSON.stringify(body).indexOf(SECRET) === -1, 'plaintext secret leaked in the refusal');
});

await test('a second owner cannot delete the extension', async () => {
  const { status } = await json('/v1/extensions/rest-connector', {
    method: 'DELETE', headers: { Authorization: `Bearer ${strangerToken}` },
  });
  assert(status === 403 || status === 404, `expected 403 or 404, got ${status}`);
});

await test('POSITIVE CONTROL: the extension is still there and still the owner\'s', async () => {
  // Without this the three refusals above would pass against a node that had deleted the extension
  // in the previous test, which is the exact failure a denial-only block hides.
  const { status, body } = await json('/v1/extensions/rest-connector/instances/acme', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `owner GET ${status}`);
  assert(body.data?.instance?.config?.apiKey === MASK, 'owner still sees the masked secret');
});

// ─── Cleanup ───
console.log('Cleanup');
await test('DELETE rest-connector', async () => {
  const { status } = await json('/v1/extensions/rest-connector', {
    method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
