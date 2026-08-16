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
//
// @version-history
//   v1.1.0 — 2026-08-17 — E2E quality, extension-secrets :124 and :144. The at-rest check returned
//     early on any backend but sqlite, so on the production one it executed zero assertions and still
//     counted as passed; it now reads the row on either backend and FAILS where it cannot. It also
//     asserts the secret is not stored base64 or hex encoded, and that the same secret stored twice
//     produces different bytes, which is what separates encryption from encoding without decrypting.
//     And the suite had exactly one principal, registered through the admin-setup door that grants
//     the operator role, so canManageExtensionAs short-circuited on that role every time and the
//     installer arm never ran: a second, ordinary owner is now refused PATCH and DELETE on somebody
//     else's instance, with the instance read back to prove it did not move.

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

/**
 * The stored bytes, on whichever backend is under test.
 *
 * This used to return early when the backend was not sqlite, so on postgres-kysely — the production
 * one — the test logged a skip, executed zero assertions and still counted as passed. A backend with
 * no reader now FAILS: an untestable claim about secrets at rest is not a passing one.
 */
async function storedInstanceConfig(instanceId: string): Promise<string> {
  const dbType = process.env.AIMEAT_STORAGE ?? process.env.AIMEAT_DB ?? 'memory';
  if (dbType === 'sqlite') {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = resolve(process.cwd(), process.env.AIMEAT_SQLITE_PATH || process.env.AIMEAT_DB_PATH || 'test/.test-e2e.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT config FROM extension_instances WHERE extensionName = ? AND id = ?')
        .get('rest-connector', instanceId) as { config: string } | undefined;
      assert(!!row, `instance row present for ${instanceId}`);
      return row!.config;
    } finally { db.close(); }
  }
  if (dbType === 'postgres-kysely') {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const r = await client.query(
        // The user-facing id is instanceId here; "id" is a synthetic primary key. The sqlite table
        // keys the instance on its own id column, which is why the two arms differ.
        'SELECT "config" FROM "ExtensionInstance" WHERE "extensionName" = $1 AND "instanceId" = $2',
        ['rest-connector', instanceId]);
      assert(r.rows.length === 1, `instance row present for ${instanceId}`);
      const cfg = r.rows[0].config;
      return typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
    } finally { await client.end(); }
  }
  throw new Error(`no raw reader for backend "${dbType}" — a secret-at-rest claim cannot be skipped into a pass`);
}

await test('ciphertext at rest (raw read of the database under test) — stored as {encrypted}, not plaintext', async () => {
  const raw = await storedInstanceConfig('acme');
  assert(raw.indexOf(SECRET) === -1, 'raw stored config must NOT contain plaintext secret');
  // Every trivial encoding of the same secret, because "not the literal string" is a low bar and the
  // thing that would sail past it is exactly a reversible encoding standing in for encryption.
  assert(raw.indexOf(Buffer.from(SECRET).toString('base64')) === -1, 'the secret must not be stored base64-encoded');
  assert(raw.indexOf(Buffer.from(SECRET).toString('hex')) === -1, 'the secret must not be stored hex-encoded');
  const parsed = JSON.parse(raw);
  assert(parsed.apiKey && typeof parsed.apiKey.encrypted === 'string', 'apiKey stored as {encrypted}');
  assert(parsed.apiKey.encrypted.split(':').length === 3, 'ciphertext is iv:tag:ct (AES-256-GCM)');
});

await test('…and the SAME secret stored twice yields different ciphertext (the IV is not fixed)', async () => {
  // A reversible encoding produces identical bytes for identical input, so this is the assertion the
  // shape check cannot make: it separates encryption from encoding without decrypting anything.
  const second = await json('/v1/extensions/rest-connector/instances', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ id: 'acme-iv', config: { apiKey: SECRET, baseUrl: '' } }),
  });
  assert(second.status === 201, `create the second instance: ${second.status}: ${JSON.stringify(second.body)}`);
  const a = JSON.parse(await storedInstanceConfig('acme')).apiKey.encrypted as string;
  const b = JSON.parse(await storedInstanceConfig('acme-iv')).apiKey.encrypted as string;
  assert(a !== b, 'the same secret encrypted twice must not produce the same bytes');
  assert(a.split(':')[0] !== b.split(':')[0], 'the IV must differ between the two');
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

/**
 * A SECOND PRINCIPAL, WHICH THIS SUITE HAS NEVER HAD. Everything above runs as one account registered
 * through /v1/admin/setup/register, and that door grants ['owner','operator'] unconditionally.
 * canManageExtensionAs short-circuits on the operator role BEFORE it compares the installer, so the
 * installer arm — the one that decides whether a stranger may re-point or delete somebody else's
 * extension instance — has never executed anywhere in the tree.
 *
 * What is behind it: an instance config carries the encrypted secret, and the sandbox decrypts it
 * into whatever baseUrl the config names. Re-pointing another owner's instance at an attacker's host
 * hands them that key on the next action run.
 */
const strangerName = `extstranger${Date.now()}`;
let strangerToken = '';

await test('a second owner exists, holding no operator role', async () => {
  const reg = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `register: ${reg.status}: ${JSON.stringify(reg.body)}`);
  const ts = new Date().toISOString();
  const sig = await signMsg(reg.body.data.private_key, strangerName + NODE_ID + ts);
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: strangerName, timestamp: ts, signature: sig }),
  });
  strangerToken = tok.body.data?.token;
  assert(typeof strangerToken === 'string' && strangerToken.length > 0, 'stranger token');
  // The premise. Without it this whole block would silently become a second operator probe.
  const claims = JSON.parse(Buffer.from(strangerToken.split('.')[1], 'base64url').toString());
  assert(!claims.roles.includes('operator'), `the second owner must not be an operator: ${JSON.stringify(claims.roles)}`);
});

await test('a stranger cannot re-point or delete somebody else\'s extension instance', async () => {
  const asStranger = { Authorization: `Bearer ${strangerToken}` };

  const repoint = await json('/v1/extensions/rest-connector/instances/acme', {
    method: 'PATCH', headers: asStranger,
    body: JSON.stringify({ config: { baseUrl: 'http://attacker.invalid' } }),
  });
  assert(repoint.status === 403, `PATCH expected 403, got ${repoint.status}: ${JSON.stringify(repoint.body.error)}`);

  const removed = await json('/v1/extensions/rest-connector/instances/acme', { method: 'DELETE', headers: asStranger });
  assert(removed.status === 403, `DELETE expected 403, got ${removed.status}: ${JSON.stringify(removed.body.error)}`);

  // Proven by state, not only by status: the instance is still there and still points where its
  // installer put it.
  const readBack = await json('/v1/extensions/rest-connector/instances/acme', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(readBack.status === 200, `the instance must survive: ${readBack.status}`);
  assert((readBack.body.data?.instance?.config?.baseUrl ?? '') !== 'http://attacker.invalid',
    `the refused PATCH moved the instance to ${readBack.body.data?.instance?.config?.baseUrl}`);
  // …and the secret is still masked to its own installer, i.e. nothing was rewritten underneath.
  assert(readBack.body.data?.instance?.config?.apiKey === MASK, 'the secret is still stored and masked');
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
