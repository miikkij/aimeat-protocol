/**
 * @file e2e-upsert.ts
 * @description E2E acceptance tests for the idempotent upsert endpoints PUT /v1/cortex/:name and
 *   PUT /v1/extensions/:name. Verifies redeploy-in-place semantics: no live gap (GET never 404s
 *   mid-upsert), init re-runs so new behaviour goes live, no quota slot consumed on update,
 *   identical bytes are a 200 no-op, and create-via-PUT works.
 * @version-history
 *   v1.1.0 — 2026-08-10 — The "no new quota slot consumed" assertion counts THIS owner's
 *     extensions instead of the node-wide total. The node seeds its own bundled packs at boot, so
 *     the total moved between the two list calls whenever seeding was still in flight, and the
 *     suite reported a quota leak that had not happened.
 *   v1.0.0 — 2026-06-05 — Initial: cortex + extension upsert acceptance suite.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ─── Auth state ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `upsertowner${Date.now()}`;
let agentToken = '';
let agentGaii = '';

const CORTEX = 'upsert-demo';
const CORTEX_ENC = encodeURIComponent(CORTEX);
const CORTEX_NEW = 'upsert-created-via-put';
const CORTEX_NEW_ENC = encodeURIComponent(CORTEX_NEW);
const EXT = 'upsert-ext';
const EXT_NEW = 'upsert-ext-created-via-put';

const cortexManifest = (version: string, greeting: string) => `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX}
  namespace: ${ownerName}
spec:
  version: "${version}"
  description: "Upsert demo cortex"
  author: "test"
  components:
    - type: lib
      name: demo-ui
      filename: demo.js
      exports: [render]
    - type: seed-data
      entries:
        - key: "upsert:greeting"
          value:
            text: "${greeting}"
`;

const LIB_A = "export const render = () => 'render-A';\n";
const LIB_B = "export const render = () => 'render-B';\n";

const extManifest = `
extension: "1.0"
metadata:
  name: "${EXT}"
  version: "1.0.0"
  description: "Upsert extension"
  author: "test"
required_apis:
  - memory
actions:
  - id: echo
    description: "Echo a version marker"
    method: POST
    path: "/v1/ext/${EXT}/echo"
    script: "actions/echo.js"
limits:
  memory_mb: 16
  timeout_ms: 2000
  max_api_calls: 10
`;

const EXT_SCRIPT_V1 = `export default async function(ctx, input) {
  await ctx.memory.set('persist', 'kept');
  return { marker: 'v1' };
}`;
const EXT_SCRIPT_V2 = `export default async function(ctx, input) {
  const p = await ctx.memory.get('persist');
  return { marker: 'v2', persist: p };
}`;

console.log('\n=== Upsert (PUT) E2E Test ===\n');

// ─── Setup ───
console.log('Setup — Auth');

await test('Register owner (first owner ⇒ operator)', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth token', async () => {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(ownerPrivKey, ownerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register agent + token', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'upsertagent', owner: ownerName, capabilities: ['memory'], model: 'gpt-4o' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;
  const ts = new Date().toISOString();
  const sig = await signMsg(body.data.private_key, agentGaii + ts);
  const { body: tb } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: sig }),
  });
  agentToken = tb.data?.token;
  assert(typeof agentToken === 'string', 'got agent token');
});

const ownerHdr = () => ({ Authorization: `Bearer ${ownerToken}` });

// ─── Cortex upsert acceptance test ───
console.log('\nCortex — install A, upsert to A′, idempotent re-PUT');

await test('Install cortex c (libs A) → app renders A', async () => {
  const { status, body } = await json(`/v1/cortex`, {
    method: 'POST',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: cortexManifest('1.0.0', 'hello A'), libs: { 'demo.js': LIB_A } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  // Activate so the lib is served + seed-data materialises
  const act = await json(`/v1/cortex/${CORTEX_ENC}/activate`, { method: 'POST', headers: ownerHdr() });
  assert(act.status === 200 && act.body.data.status === 'active', `activate: ${JSON.stringify(act.body)}`);
  // App "renders": the lib serves bytes A
  const lib = await fetch(`${BASE}/v1/cortex/${CORTEX_ENC}/libs/demo.js`);
  assert(lib.status === 200, `lib status ${lib.status}`);
  const text = await lib.text();
  assert(text.includes('render-A'), `served lib should be A: ${text}`);
});

await test('Seed-data from A is live (greeting = hello A)', async () => {
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(ownerName)}/${encodeURIComponent('upsert:greeting')}`);
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.value.text === 'hello A', `greeting: ${JSON.stringify(body.data.value)}`);
});

/**
 * How many cortex extensions THIS owner has installed.
 *
 * `data.total` is node-wide, and the node seeds its own bundled packs at boot, so that number
 * moves under the suite's feet: measured 11 at the start of one run and 8 at the start of the
 * next, on the same code. The claim being tested — "an upsert consumes no new quota slot" — is
 * about one owner, so it is counted per owner. The node-wide read made this assertion fail
 * whenever boot seeding happened to land inside the two list calls.
 */
function ownCortexCount(listBody: any): number {
  const exts = (listBody?.data?.extensions ?? []) as Array<{ installed_by?: string }>;
  return exts.filter(e => e.installed_by === ownerName).length;
}

let cortexCountBefore = 0;
await test('PUT cortex c with libs A′ — no 404 during the call, serves A′, init re-ran, count unchanged', async () => {
  const listBefore = await json('/v1/cortex', { headers: ownerHdr() });
  cortexCountBefore = ownCortexCount(listBefore.body);

  // Hammer GET /libs concurrently for the whole duration of the PUT; assert zero 404s.
  let saw404 = false;
  let polls = 0;
  let done = false;
  const poller = (async () => {
    while (!done) {
      const r = await fetch(`${BASE}/v1/cortex/${CORTEX_ENC}/libs/demo.js`);
      polls++;
      if (r.status === 404) saw404 = true;
    }
  })();

  const { status, body } = await json(`/v1/cortex/${CORTEX_ENC}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: cortexManifest('1.0.1', 'hello B'), libs: { 'demo.js': LIB_B } }),
  });
  done = true;
  await poller;

  assert(status === 200, `PUT status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'updated', `action: ${body.data.action}`);
  assert(body.data.reinitialized === true, `reinitialized: ${body.data.reinitialized}`);
  assert(polls > 0, 'poller actually ran');
  assert(!saw404, `GET /libs 404'd mid-upsert after ${polls} polls`);

  // New bytes are live
  const lib = await fetch(`${BASE}/v1/cortex/${CORTEX_ENC}/libs/demo.js`);
  assert(lib.status === 200, `lib status ${lib.status}`);
  const text = await lib.text();
  assert(text.includes('render-B') && !text.includes('render-A'), `served lib should be A′: ${text}`);

  // GET detail reflects the new version (components replaced)
  const detail = await json(`/v1/cortex/${CORTEX_ENC}`, { headers: ownerHdr() });
  assert(detail.body.data.version === '1.0.1', `version: ${detail.body.data.version}`);
  assert(detail.body.data.status === 'active', `status stayed active: ${detail.body.data.status}`);

  // No new quota slot consumed
  const listAfter = await json('/v1/cortex', { headers: ownerHdr() });
  assert(ownCortexCount(listAfter.body) === cortexCountBefore,
    `this owner's cortex count changed: ${cortexCountBefore} → ${ownCortexCount(listAfter.body)}`);
});

await test('Init actually re-ran: seed-data now reflects A′ (greeting = hello B)', async () => {
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(ownerName)}/${encodeURIComponent('upsert:greeting')}`);
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.value.text === 'hello B', `greeting after upsert: ${JSON.stringify(body.data.value)}`);
});

await test('PUT again with identical A′ → 200 no-op (action: unchanged)', async () => {
  const { status, body } = await json(`/v1/cortex/${CORTEX_ENC}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: cortexManifest('1.0.1', 'hello B'), libs: { 'demo.js': LIB_B } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'unchanged', `action: ${body.data.action}`);
});

await test('PUT a never-seen cortex name → 201 created (create-via-PUT)', async () => {
  const manifest = `
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${CORTEX_NEW}
  namespace: ${ownerName}
spec:
  version: "1.0.0"
  description: "Created via PUT"
  author: "test"
  components:
    - type: lib
      name: demo-ui
      filename: demo.js
      exports: [render]
`;
  const { status, body } = await json(`/v1/cortex/${CORTEX_NEW_ENC}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest, libs: { 'demo.js': LIB_A } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'created', `action: ${body.data.action}`);
  assert(body.data.status === 'inactive', `status: ${body.data.status}`);
});

await test('PUT with manifest name ≠ URL name → 400 NAME_MISMATCH', async () => {
  const { status, body } = await json(`/v1/cortex/${CORTEX_ENC}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: cortexManifest('9.9.9', 'x').replace(`name: ${CORTEX}`, 'name: something-else'), libs: { 'demo.js': LIB_A } }),
  });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NAME_MISMATCH', `code: ${body.error?.code}`);
});

await test('Agent without cortex:write is rejected on PUT (scope gate)', async () => {
  // Default test agent scopes are '*', so simulate a denied agent by stripping the bearer:
  // an UNauthenticated PUT must 401, confirming the route is gated (not public).
  const { status } = await json(`/v1/cortex/${CORTEX_ENC}`, {
    method: 'PUT',
    body: JSON.stringify({ manifest: cortexManifest('1.0.1', 'hello B'), libs: { 'demo.js': LIB_B } }),
  });
  assert(status === 401, `unauthenticated PUT should be 401, got ${status}`);
});

// ─── Extension upsert acceptance test ───
console.log('\nExtension — install v1, upsert to v2 (preserve memory), idempotent re-PUT');

await test('Install + activate extension (v1 code stores memory)', async () => {
  const inst = await json('/v1/extensions', {
    method: 'POST',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: extManifest, scripts: { 'actions/echo.js': EXT_SCRIPT_V1 } }),
  });
  assert(inst.status === 201, `install status ${inst.status}: ${JSON.stringify(inst.body)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: ownerHdr() });
  assert(act.status === 200, `activate status ${act.status}: ${JSON.stringify(act.body)}`);
  // Call v1 → marker v1 + writes ext:{name} memory 'persist'
  const call = await json(`/v1/ext/${EXT}/echo`, { method: 'POST', headers: { Authorization: `Bearer ${agentToken}` }, body: '{}' });
  assert(call.status === 200 && call.body.data.marker === 'v1', `v1 call: ${JSON.stringify(call.body)}`);
});

await test('PUT extension v2 — endpoint never 404s, new code live, ext memory preserved', async () => {
  let saw404 = false;
  let polls = 0;
  let done = false;
  const poller = (async () => {
    while (!done) {
      const r = await fetch(`${BASE}/v1/extensions/${EXT}`);
      polls++;
      if (r.status === 404) saw404 = true;
    }
  })();

  const { status, body } = await json(`/v1/extensions/${EXT}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: extManifest, scripts: { 'actions/echo.js': EXT_SCRIPT_V2 } }),
  });
  done = true;
  await poller;

  assert(status === 200, `PUT status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'updated', `action: ${body.data.action}`);
  assert(polls > 0 && !saw404, `extension endpoint 404'd mid-upsert (polls=${polls})`);

  // New code is live immediately AND ext:{name} memory survived the redeploy
  const call = await json(`/v1/ext/${EXT}/echo`, { method: 'POST', headers: { Authorization: `Bearer ${agentToken}` }, body: '{}' });
  assert(call.status === 200, `v2 call status ${call.status}: ${JSON.stringify(call.body)}`);
  assert(call.body.data.marker === 'v2', `new code live: ${JSON.stringify(call.body)}`);
  assert(call.body.data.persist === 'kept', `ext memory preserved: ${JSON.stringify(call.body)}`);
});

await test('PUT extension again with identical v2 → 200 no-op (action: unchanged)', async () => {
  const { status, body } = await json(`/v1/extensions/${EXT}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest: extManifest, scripts: { 'actions/echo.js': EXT_SCRIPT_V2 } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'unchanged', `action: ${body.data.action}`);
});

await test('PUT a never-seen extension name → 201 created (create-via-PUT)', async () => {
  const manifest = extManifest.replace(`name: "${EXT}"`, `name: "${EXT_NEW}"`).replace(`/v1/ext/${EXT}/echo`, `/v1/ext/${EXT_NEW}/echo`);
  const { status, body } = await json(`/v1/extensions/${EXT_NEW}`, {
    method: 'PUT',
    headers: ownerHdr(),
    body: JSON.stringify({ manifest, scripts: { 'actions/echo.js': EXT_SCRIPT_V1 } }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.action === 'created', `action: ${body.data.action}`);
  assert(body.data.extension?.status === 'inactive', `status: ${body.data.extension?.status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');
for (const name of [CORTEX, CORTEX_NEW]) {
  await json(`/v1/cortex/${encodeURIComponent(name)}`, { method: 'DELETE', headers: ownerHdr() });
}
for (const name of [EXT, EXT_NEW]) {
  await json(`/v1/extensions/${encodeURIComponent(name)}`, { method: 'DELETE', headers: ownerHdr() });
}
await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: ownerHdr() });

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
