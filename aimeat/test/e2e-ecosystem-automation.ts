/**
 * @file e2e-ecosystem-automation.ts
 * @description E2E tests for ecosystem-app automation: scheduling a connected app's (GEAI)
 *   capability on a cadence (the `eco-capability` schedule kind). Covers connecting an app WITH a
 *   manifest that declares a `publish-stats` capability (hello → approve → token), asserting
 *   GET /v1/ecosystem-apps now returns the stored capabilities, creating an `eco-capability`
 *   schedule (persisted with the right type + input), and the failure modes (undeclared capability,
 *   app not connected). The actual tunnel invocation is NOT exercised here — that needs a live
 *   connected GEAI; the schedule CRUD + validation + capabilities-stored surface is the testable part.
 * @version-history
 *   v1.0.0 — 2026-06-15 — Initial creation (eco-capability scheduling).
 *   v1.1.0 — 2026-06-16 — Phase 5: hard-delete (disconnect) coverage. Deposit owner data + create a
 *     recipe, then DELETE the app and assert: the app is gone from the list (not status:revoked),
 *     the recipe + eco-capability schedule are removed, the deposited data is preserved, and a
 *     re-onboard creates a fresh record from scratch.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-automation

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After') || '5');
      await sleep(retryAfter * 1000 + 500);
      continue;
    }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

async function getOwnerToken(owner: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner, timestamp, signature }),
  });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// ─── State ───
const ownerName = `ecoauto${Date.now()}`;
let ownerToken = '';
let geai = '';
let geaiToken = '';
const APP = 'statsapp';
const CAP = 'publish-stats';
const APP_PUBKEY = Buffer.from('eco-auto-verification-key-placeholder').toString('base64');
const DEPOSITED_KEY = 'service.statsapp.feedback.stats';

console.log('\n=== AIMEAT Ecosystem-App Automation E2E Test ===\n');
console.log(`Base: ${BASE}`);
console.log(`Node: ${NODE_ID}\n`);

// ─── Setup: owner ───
console.log('Setup — Owner');

await test('Register owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await getOwnerToken(ownerName, body.data.private_key);
  assert(typeof ownerToken === 'string' && ownerToken.length > 0, 'got owner token');
});

// ─── Phase 1: connect the app WITH a manifest declaring a capability ───
console.log('\nPhase 1 — Connect app with a capability manifest');

let deviceCode = '';
let userCode = '';

await test('App says hello WITH a manifest declaring publish-stats', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName,
      app: APP,
      display_name: 'Stats App',
      public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      manifest: {
        app: APP,
        scopes: ['memory:read', 'memory:write'],
        capabilities: [
          { id: CAP, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } },
          { id: 'fetch-report' },
        ],
        automation: {
          schedulable: [{ id: CAP, produces: 'service.statsapp.weekly', cadences: ['weekly'] }],
          advisory_sink: 'service.statsapp.advisory',
        },
      },
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `hello failed: ${JSON.stringify(body.error)}`);
  // The manifest is valid, so validation should pass.
  assert(body.data.validation && body.data.validation.ok === true, `manifest should validate ok: ${JSON.stringify(body.data.validation)}`);
  deviceCode = body.data.device_code;
  userCode = body.data.user_code;
  assert(!!deviceCode && !!userCode, 'got device + user codes');
});

await test('Owner approves the connection', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${userCode}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.status === 'approved', `expected approved, got ${body.data.status}`);
  geai = body.data.geai;
  assert(geai === `eco:${APP}#${ownerName}@${NODE_ID}`, `unexpected geai: ${geai}`);
});

await test('App polls token → receives the GEAI credential', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/token', {
    method: 'POST',
    body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(typeof body.access_token === 'string' && body.access_token.length > 0, 'got GEAI access_token');
  geaiToken = body.access_token;
});

// ─── Phase 2: GET /v1/ecosystem-apps returns the stored capabilities ───
console.log('\nPhase 2 — Capabilities persisted + returned');

await test('GET /v1/ecosystem-apps returns the app capabilities (incl. publish-stats)', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const apps = body.data.ecosystem_apps as any[];
  const rec = apps.find(a => a.geai === geai);
  assert(!!rec, `ecosystem app ${geai} not listed`);
  assert(Array.isArray(rec.capabilities), `capabilities must be an array, got ${JSON.stringify(rec.capabilities)}`);
  const ids = rec.capabilities.map((c: any) => c.id);
  assert(ids.includes(CAP), `capabilities must include ${CAP}, got ${JSON.stringify(ids)}`);
  // The automation hint round-trips too.
  assert(rec.automation && Array.isArray(rec.automation.schedulable), `automation hint should be present: ${JSON.stringify(rec.automation)}`);
  assert(rec.automation.schedulable.some((s: any) => s.id === CAP), `automation.schedulable should name ${CAP}`);
});

// ─── Phase 3: schedule the capability on a cadence (happy path) ───
console.log('\nPhase 3 — Create an eco-capability schedule');

let scheduleId = '';

await test('POST /v1/schedules eco-capability → 201, persisted with type + input', async () => {
  const { status, body } = await json('/v1/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      kind: 'eco-capability',
      app: APP,
      capability_id: CAP,
      cron: '0 8 * * 1',
      display_name: 'Weekly stats publish',
      input: { window: 'last-week' },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const sched = body.data.schedule;
  assert(!!sched && !!sched.id, 'schedule created with an id');
  scheduleId = sched.id;
  assert(sched.type === 'eco-capability', `expected type eco-capability, got ${sched.type}`);
  assert(sched.cron === '0 8 * * 1', `cron mismatch: ${sched.cron}`);
  assert(sched.input?.app === APP, `input.app mismatch: ${JSON.stringify(sched.input)}`);
  assert(sched.input?.capability_id === CAP, `input.capability_id mismatch: ${JSON.stringify(sched.input)}`);
  assert(sched.input?.input?.window === 'last-week', `input.input passthrough mismatch: ${JSON.stringify(sched.input)}`);
});

await test('GET /v1/schedules → the new schedule is listed', async () => {
  const { status, body } = await json('/v1/schedules', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const all = (body.data.managed ?? []) as any[];
  const found = all.find((s: any) => s.id === scheduleId);
  assert(!!found, `schedule ${scheduleId} should be listed`);
});

await test('GET /:app/automation folds schedules + recipe + organisms + advisories', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${APP}/automation`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const d = body.data;
  // schedules — this app's eco-capability schedule present (filtered by type + input.app)
  assert(Array.isArray(d.schedules) && d.schedules.some((s: any) => s.id === scheduleId), `schedule ${scheduleId} in composite: ${JSON.stringify(d.schedules?.map((s: any) => s.id))}`);
  assert(d.schedules.every((s: any) => s.type === 'eco-capability' && s.input?.app === APP), 'composite schedules are this app\'s eco-capability jobs');
  // recipe (none set yet → null), organisms + advisories partitions present
  assert(d.recipe === null || typeof d.recipe === 'object', 'recipe is null or an object');
  assert(Array.isArray(d.organisms), 'organisms is an array');
  assert(Array.isArray(d.advisories), 'advisories is an array');
});

await test('GET /:app/automation for an unconnected app → 404', async () => {
  const { status } = await json('/v1/ecosystem-apps/never-connected-xyz/automation', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 4: failure modes ───
console.log('\nPhase 4 — Failure modes');

await test('Scheduling an undeclared capability → 400 CAPABILITY_NOT_DECLARED', async () => {
  const { status, body } = await json('/v1/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      kind: 'eco-capability',
      app: APP,
      capability_id: 'does-not-exist',
      cron: '0 8 * * 1',
      display_name: 'Bad capability',
    }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'CAPABILITY_NOT_DECLARED', `expected CAPABILITY_NOT_DECLARED, got ${body.error?.code}`);
});

await test('Scheduling for an app the owner never connected → 404 ECO_APP_NOT_FOUND', async () => {
  const { status, body } = await json('/v1/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      kind: 'eco-capability',
      app: 'neverconnected',
      capability_id: CAP,
      cron: '0 8 * * 1',
      display_name: 'Unconnected app',
    }),
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'ECO_APP_NOT_FOUND', `expected ECO_APP_NOT_FOUND, got ${body.error?.code}`);
});

await test('Missing capability_id → 400 INVALID_ECO_JOB', async () => {
  const { status, body } = await json('/v1/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      kind: 'eco-capability',
      app: APP,
      cron: '0 8 * * 1',
      display_name: 'No capability id',
    }),
  });
  assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'INVALID_ECO_JOB', `expected INVALID_ECO_JOB, got ${body.error?.code}`);
});

// ─── Phase 5: hard delete (disconnect) cleans up the binding + app-owned config, preserves data ───
console.log('\nPhase 5 — Hard delete (disconnect) + cleanup + data preservation');

await test('Deposited insight data lands in the owner Memory (preserved across delete)', async () => {
  // The app's refined output is the OWNER's data, living in the owner's GHII namespace — exactly the
  // data the disconnect must NOT touch. We write it directly so the post-delete read is unambiguous
  // (a GEAI-namespace write would be hidden once the app record is gone, even though the row survives).
  void geaiToken; // the GEAI credential is exercised elsewhere; the deposit here models owner-owned data
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ key: DEPOSITED_KEY, value: { score: 4.7, n: 120 }, visibility: 'owner' }),
  });
  assert(status === 200 || status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `deposit write failed: ${JSON.stringify(body.error)}`);
});

await test('Owner creates an automation recipe for the app', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${encodeURIComponent(APP)}/automation/recipe`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ agents: [], enabled: true }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `recipe upsert failed: ${JSON.stringify(body.error)}`);
});

await test('DELETE /v1/ecosystem-apps/:app → 200 { deleted: true }', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${encodeURIComponent(APP)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.deleted === true, `expected deleted:true, got ${JSON.stringify(body.data)}`);
  assert(body.data.geai === geai, `geai mismatch: ${body.data.geai}`);
});

// A6 (E2E test-quality audit). The suite proves the card, the recipe and the schedule are gone, and
// line 308 says out loud that the GEAI credential "is exercised elsewhere" — it is held in a variable
// and pointed at nothing. That is the hole: DELETE removed the principal ROW and revoked no
// credential, and the approve path never wrote the session row its own sessionId refers to, so
// isSessionRevoked() read the absence as permission. The app's ninety-day bearer therefore kept
// writing the owner's memory after the owner deleted it, with the card gone and DELETE answering
// 404 — no surface left to stop it. Against the pre-fix source this fails with 200 and a stored
// record.
await test('after delete, the app\'s own credential stops working', async () => {
  const read = await json('/v1/memory?limit=1', { headers: { Authorization: `Bearer ${geaiToken}` } });
  assert(read.status === 401, `the deleted app's token expected 401, got ${read.status}: ${JSON.stringify(read.body).slice(0, 200)}`);

  const key = `eco-after-delete-${Date.now()}`;
  const write = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${geaiToken}` },
    body: JSON.stringify({ key, value: 'written after the owner deleted me', visibility: 'private' }),
  });
  assert(write.status === 401, `the deleted app's token expected 401 on write, got ${write.status}`);

  // And nothing landed: a 401 that still wrote would be the worse half of the same defect.
  const check = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(check.status === 404, `the deleted app's write landed anyway (${check.status})`);
});

await test('GET /v1/ecosystem-apps no longer lists the app (gone, not status:revoked)', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const apps = body.data.ecosystem_apps as any[];
  const rec = apps.find(a => a.geai === geai || a.app === APP);
  assert(!rec, `app must be gone entirely, but found: ${JSON.stringify(rec)}`);
});

await test('The automation recipe is gone (getAutomationRecipe → null)', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${encodeURIComponent(APP)}/automation/recipe`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  // The route returns { recipe: null } for a non-existent recipe (200, not 404).
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.recipe === null, `recipe should be null after delete, got ${JSON.stringify(body.data.recipe)}`);
});

await test('The eco-capability schedule is gone', async () => {
  const { status, body } = await json('/v1/schedules', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const all = (body.data.managed ?? []) as any[];
  const found = all.find((s: any) => s.id === scheduleId);
  assert(!found, `schedule ${scheduleId} should be deleted, but it is still listed`);
});

await test('The deposited data key is PRESERVED in the owner Memory', async () => {
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(DEPOSITED_KEY)}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `expected 200 (data preserved), got ${status}: ${JSON.stringify(body)}`);
  assert(body.data.value?.score === 4.7, `deposited value should survive delete, got ${JSON.stringify(body.data.value)}`);
});

await test('Re-onboarding after delete creates a FRESH record (existing_app=false path)', async () => {
  // A brand-new hello → approve must succeed and produce the same GEAI shape from scratch.
  const hello = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName, app: APP, display_name: 'Stats App (re)', public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      manifest: { app: APP, scopes: ['memory:read', 'memory:write'], capabilities: [{ id: CAP }] },
    }),
  });
  assert(hello.body.ok === true, `re-hello failed: ${JSON.stringify(hello.body.error)}`);
  const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
  });
  assert(approve.status === 200, `re-approve status ${approve.status}: ${JSON.stringify(approve.body)}`);
  assert(approve.body.data.geai === geai, `re-onboard geai mismatch: ${approve.body.data.geai}`);
  // It now lists again as a fresh active record (no recipe/schedule carried over).
  const list = await json('/v1/ecosystem-apps', { headers: { Authorization: `Bearer ${ownerToken}` } });
  const rec = (list.body.data.ecosystem_apps as any[]).find(a => a.geai === geai);
  assert(!!rec && rec.status === 'active', `re-onboarded app should be active, got ${JSON.stringify(rec)}`);
});

// ─── Summary ───
console.log('\n' + '─'.repeat(48));
console.log(`Ecosystem-App Automation E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!\n');
