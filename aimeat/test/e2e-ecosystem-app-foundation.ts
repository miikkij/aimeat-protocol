/**
 * @file e2e-ecosystem-app-foundation.ts
 * @description E2E tests for the ecosystem-apps foundation (GEAI principal, chunk 1). Covers the
 *   "hello integration" handshake (hello → owner approve → token pickup), the GEAI writing into its
 *   own eco: memory namespace, the owner seeing that write via owner-scope aggregation, the stored
 *   EcosystemAppRecord (status active, scopes, pinned publicKey), and failure modes (scope enforced,
 *   poll-before-approval). Also unit-asserts the gaii.ts GEAI/GAII discrimination. Additive: the
 *   agent path is unaffected (regression covered by e2e-agent-onboarding).
 * @version-history
 *   v1.4.0 — 2026-08-17 — E2E quality, ecosystem-app-foundation :195 and :203. Every approval in the file
 *     echoed the hello, so the suite was equally true of a node that grants whatever the app asked for
 *     and ignores the owner entirely — which is the opposite of what the consent screen promises.
 *     Phase 3b approves LESS than was requested and follows it through: the token carries only the
 *     granted scope, the withheld one is refused 403 at the door, the granted one still works, and the
 *     stored record says what the owner decided. And the device code, a one-shot that nothing in the
 *     corpus had ever sent twice, is now redeemed twice — after waiting out the poll interval, because
 *     a fast repeat is answered by that guard before the one-shot is reached, and the test passes
 *     against a redeemable code if you skip the wait.
 *   v1.0.0 — 2026-06-14 — Initial creation (ecosystem-apps foundation, chunk 1).
 *   v1.1.0 — 2026-06-15 — Add Phase 5 for GET /v1/ecosystem-apps/:app/data — owner lists the memory
 *     an app wrote (happy path) + 404 for an app the owner never connected.
 *   v1.2.0 — 2026-06-16 — Add Phase 6 for the app's OWN bilingual Markdown `setup:{fi,en}` guide:
 *     hello with a manifest carrying `setup` → approve → GET /v1/ecosystem-apps returns `setup`
 *     (happy path), and an app connected WITHOUT a setup guide returns `setup: null` (fallback case).
 *   v1.3.0 — 2026-06-16 — Add Phase 7 for the app's `automation.recommended_agents` (name + match_tags
 *     + bilingual why): hello with a manifest carrying recommended_agents → approve → GET returns them
 *     intact (happy path), and a recommendation entry MISSING the required `why` fails static validation.
 */

// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-app-foundation

import {
  parseGAII, isValidGAII, isGEAI, parseGEAI, isValidGEAI, buildGEAI,
  parseGaiiLoose, isSameOwner, resolveIdentity,
} from '../src/utils/gaii.js';

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
const ownerName = `ecoowner${Date.now()}`;
let ownerToken = '';
let geai = '';
let geaiToken = '';
const APP = 'zendesk';
const APP_PUBKEY = Buffer.from('eco-app-verification-key-placeholder').toString('base64');
const MEM_KEY = 'service.zendesk.refined';

console.log('\n=== AIMEAT Ecosystem-App Foundation E2E Test ===\n');
console.log(`Base: ${BASE}`);
console.log(`Node: ${NODE_ID}\n`);

// ─── Phase 0: identity unit assertions (gaii.ts) ───
console.log('Phase 0 — Identity helpers (gaii.ts)');

await test('parseGAII rejects an eco: identity', () => {
  const sample = `eco:${APP}#teppo@${NODE_ID}`;
  assert(parseGAII(sample) === null, 'parseGAII must return null for eco: strings');
  assert(isValidGAII(sample) === false, 'isValidGAII must be false for eco: strings');
});

await test('parseGEAI / isGEAI / buildGEAI round-trip', () => {
  const built = buildGEAI(APP, 'teppo', NODE_ID);
  assert(built === `eco:${APP}#teppo@${NODE_ID}`, `buildGEAI shape: ${built}`);
  assert(isGEAI(built) === true, 'isGEAI true for a GEAI');
  assert(isValidGEAI(built) === true, 'isValidGEAI true for a valid GEAI');
  const p = parseGEAI(built);
  assert(p !== null && p.app === APP && p.owner === 'teppo' && p.node === NODE_ID, `parseGEAI parts: ${JSON.stringify(p)}`);
});

await test('parseGaiiLoose / isSameOwner are GEAI-aware', () => {
  const g = `eco:${APP}#teppo@${NODE_ID}`;
  const loose = parseGaiiLoose(g);
  assert(loose.owner === 'teppo', `loose owner should be teppo, got ${loose.owner}`);
  assert(loose.agent === APP, `loose agent should be the bare app name, got ${loose.agent}`);
  assert(isSameOwner(`teppo@${NODE_ID}`, g) === true, 'isSameOwner(ghii, geai) must hold for same owner');
});

await test('resolveIdentity returns the GEAI verbatim for ecosystem-role sessions', () => {
  const sub = `eco:${APP}#teppo@${NODE_ID}`;
  const r = resolveIdentity({ sub, owner: 'teppo', roles: ['ecosystem'] }, NODE_ID);
  assert(r === sub, `ecosystem session must resolve to its sub verbatim, got ${r}`);
  // And an owner session still resolves to GHII (unchanged behavior)
  const ro = resolveIdentity({ sub: 'teppo', owner: 'teppo', roles: ['owner'] }, NODE_ID);
  assert(ro === `teppo@${NODE_ID}`, `owner session must resolve to GHII, got ${ro}`);
});

// ─── Setup: owner ───
console.log('\nSetup — Owner');

await test('Register owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await getOwnerToken(ownerName, body.data.private_key);
  assert(typeof ownerToken === 'string' && ownerToken.length > 0, 'got owner token');
});

// ─── Phase 1: hello integration handshake (happy path) ───
console.log('\nPhase 1 — Hello integration handshake');

let deviceCode = '';
let userCode = '';

await test('App says hello → pending request created', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName,
      app: APP,
      display_name: 'Zendesk',
      public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      data_areas: [{ area: 'memory', pattern: 'service.zendesk.*', rights: ['read', 'write'] }],
      bound_ref: 'zendesk-acct-12345',
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `hello failed: ${JSON.stringify(body.error)}`);
  deviceCode = body.data.device_code;
  userCode = body.data.user_code;
  assert(typeof deviceCode === 'string' && deviceCode.length > 0, 'got device_code');
  assert(typeof userCode === 'string' && userCode.length > 0, 'got user_code');
});

await test('Owner lists pending → sees the request', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/pending', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const reqs = body.data.requests as any[];
  const found = reqs.find(r => r.user_code === userCode);
  assert(!!found, `pending request ${userCode} not listed`);
  assert(found.app === APP, `app mismatch: ${found.app}`);
});

await test('Owner approves with scopes + data-areas', async () => {
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

await test('App polls token → receives the GEAI credential (once)', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/token', {
    method: 'POST',
    body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  geaiToken = body.access_token;
  assert(typeof geaiToken === 'string' && geaiToken.length > 0, 'got GEAI access_token');
  assert(body.geai === geai, `token geai mismatch: ${body.geai}`);
  assert(Array.isArray(body.scopes) && body.scopes.includes('memory:write'), 'scopes include memory:write');
});

/**
 * The device code is a one-shot. Nothing in the corpus had ever sent one twice: every eco suite polls
 * exactly once, so a code that stayed live after redemption would go unnoticed — and this endpoint is
 * unauthenticated, which makes the one-shot the only thing between a leaked device_code and a second
 * live GEAI bearer for somebody else's app.
 */
await test('The same device code cannot be redeemed twice', async () => {
  // The poll-interval guard stands in FRONT of the redemption branch and answers a fast repeat with
  // 400 slow_down, so a second poll sent immediately never reaches the one-shot at all: measured, a
  // node with the credential left redeemable passes that version of this test. The interval has to be
  // waited out for the assertion to be about what it says it is.
  const first = await json('/v1/ecosystem-apps/token', {
    method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }),
  });
  const wait = Number((first.body?.error_description ?? '').match(/Wait (\d+)/)?.[1] ?? 5) + 1;
  await new Promise(r => setTimeout(r, wait * 1000));

  const second = await json('/v1/ecosystem-apps/token', {
    method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: GRANT }),
  });
  const carried = second.body?.access_token ?? second.body?.token ?? second.body?.geai;
  assert(!carried, `a second redemption of the same device code handed out a credential: ${JSON.stringify(second.body)}`);
  assert(second.status === 400, `a second redemption should be refused, got ${second.status}: ${JSON.stringify(second.body)}`);
  assert(second.body?.error === 'expired_token',
    `the refusal must be the one-shot, not the poll interval: ${JSON.stringify(second.body)}`);
});

// ─── Phase 2: GEAI writes its own namespace; owner sees it via aggregation ───
console.log('\nPhase 2 — GEAI memory write + owner aggregation');

await test('GEAI writes a memory entry (scope-enforced, eco: namespace)', async () => {
  const { status, body } = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${geaiToken}` },
    body: JSON.stringify({ key: MEM_KEY, value: { ticket: 'resolved' }, visibility: 'private' }),
  });
  assert(status === 200 || status === 201, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `write failed: ${JSON.stringify(body.error)}`);
});

await test('GEAI reads its own entry back under the eco: namespace', async () => {
  // getMemory is keyed by the resolved identity (the GEAI's eco: sub). A 200 here means the entry
  // lives in the GEAI's OWN namespace — a different principal would 404.
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(MEM_KEY)}`, {
    headers: { Authorization: `Bearer ${geaiToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.value?.ticket === 'resolved', `value round-trip failed: ${JSON.stringify(body.data.value)}`);
});

await test('Owner sees the GEAI entry via owner-scope aggregation', async () => {
  const { status, body } = await json('/v1/memory', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const items = body.data.items as any[];
  const found = items.find(i => i.key === MEM_KEY && i.owner_gaii === geai);
  assert(!!found, `owner aggregation must include the GEAI write under ${geai}`);
});

// ─── Phase 3: stored record assertions ───
console.log('\nPhase 3 — EcosystemAppRecord');

await test('Owner lists ecosystem apps → record is active with the right grant', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const apps = body.data.ecosystem_apps as any[];
  const rec = apps.find(a => a.geai === geai);
  assert(!!rec, `ecosystem app ${geai} not listed`);
  assert(rec.status === 'active', `expected status active, got ${rec.status}`);
  assert(rec.scopes.includes('memory:write'), 'record scopes include memory:write');
  assert(rec.public_key === APP_PUBKEY, 'record pinned the app publicKey (TOFU)');
});

// ─── Phase 3b: the owner's NARROWING is the whole consent screen ───
console.log('\nPhase 3b — The owner grants less than the app asked for');

/**
 * Every approval in this file echoes the hello. So each one is consistent with a node that ignores
 * the owner's list entirely and grants whatever the app requested, which is the opposite of what the
 * consent screen promises: the app proposes, the person decides. The record assertion in Phase 3
 * cannot separate the two either, because it checks a scope that was both asked for AND granted.
 */
const NARROW_APP = 'narrowdesk';
let narrowUserCode = '';
let narrowGeaiToken = '';

await test('An app asks for read+write and the owner approves read only', async () => {
  const hello = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName, app: NARROW_APP, display_name: 'Narrowdesk', public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      data_areas: [{ area: 'memory', pattern: 'service.narrowdesk.*', rights: ['read', 'write'] }],
      bound_ref: 'narrow-acct-1',
    }),
  });
  assert(hello.status === 200, `hello ${hello.status}: ${JSON.stringify(hello.body)}`);
  narrowUserCode = hello.body.data.user_code;
  const narrowDeviceCode = hello.body.data.device_code;

  const approve = await json(`/v1/ecosystem-apps/${narrowUserCode}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read'] }),
  });
  assert(approve.status === 200, `approve ${approve.status}: ${JSON.stringify(approve.body)}`);
  assert(approve.body.data.status === 'approved', `expected approved, got ${approve.body.data.status}`);

  const token = await json('/v1/ecosystem-apps/token', {
    method: 'POST',
    body: JSON.stringify({ device_code: narrowDeviceCode, grant_type: GRANT }),
  });
  assert(token.status === 200, `token ${token.status}: ${JSON.stringify(token.body)}`);
  narrowGeaiToken = token.access_token ?? token.body.access_token;
  assert(typeof narrowGeaiToken === 'string' && narrowGeaiToken.length > 0, 'got the narrowed GEAI token');
  const scopes = (token.body.scopes ?? token.scopes) as string[];
  assert(Array.isArray(scopes) && scopes.includes('memory:read'), `the granted scope is missing: ${JSON.stringify(scopes)}`);
  assert(!scopes.includes('memory:write'), `the app was handed the scope the owner withheld: ${JSON.stringify(scopes)}`);
});

await test('…and the withheld scope is refused at the door, while the granted one works', async () => {
  const write = await json('/v1/memory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${narrowGeaiToken}` },
    body: JSON.stringify({ key: `service.${NARROW_APP}.attempt`, value: { x: 1 }, visibility: 'private' }),
  });
  assert(write.status === 403, `the withheld scope must be refused, got ${write.status}: ${JSON.stringify(write.body)}`);
  assert(write.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${write.body.error?.code}`);

  // The other half: the narrowing removed ONE scope rather than breaking the grant.
  const read = await json('/v1/memory', { headers: { Authorization: `Bearer ${narrowGeaiToken}` } });
  assert(read.status === 200, `the granted scope must still work, got ${read.status}`);
});

await test('…and the stored record says what the owner decided, not what the app asked', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(status === 200, `list ${status}`);
  const rec = (body.data.ecosystem_apps as any[]).find(a => String(a.geai).startsWith(`eco:${NARROW_APP}#`));
  assert(!!rec, `the narrowed app is not listed: ${JSON.stringify((body.data.ecosystem_apps as any[]).map(a => a.geai))}`);
  assert(rec.scopes.includes('memory:read'), `record is missing the granted scope: ${JSON.stringify(rec.scopes)}`);
  assert(!rec.scopes.includes('memory:write'), `the record kept the scope the owner withheld: ${JSON.stringify(rec.scopes)}`);
});

// ─── Phase 4: failure modes ───
console.log('\nPhase 4 — Failure modes');

// A20 (E2E test-quality audit). The scope test below proves the fence holds on the way in. Nothing
// asked whether the GEAI could change what it IS. POST /v1/auth/refresh kept an agent at ['agent']
// across a refresh for exactly this reason, and its `else` handed the OWNER's roles to every other
// principal — so one call with the GEAI's own bearer returned a token for the same sub carrying
// ['owner'] and no scopes at all, after which requireScope waves it through (owner sessions bypass
// scopes), requireRole('owner') passes, and so does requireOwnerPrincipal — the gate on the
// account's password. Against the pre-fix source this fails: the refreshed token's roles are
// ['owner'] and the delete below succeeds with it.
await test('A GEAI refresh cannot turn it into the owner', async () => {
  const r = await json('/v1/auth/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${geaiToken}` },
    body: JSON.stringify({}),
  });
  // Refusing the refresh outright is also a correct answer; what must not happen is an upgrade.
  if (r.status === 200) {
    const refreshed = r.body.data?.token;
    assert(typeof refreshed === 'string' && refreshed.length > 0, 'a 200 must carry a token');
    const claims = JSON.parse(Buffer.from(refreshed.split('.')[1], 'base64url').toString());
    assert(!(claims.roles ?? []).includes('owner'),
      `the refreshed GEAI token carries owner: ${JSON.stringify(claims.roles)}`);
    assert(!(claims.roles ?? []).includes('operator'),
      `the refreshed GEAI token carries operator: ${JSON.stringify(claims.roles)}`);
    assert((claims.roles ?? []).includes('ecosystem'),
      `the refreshed token must stay an ecosystem principal, got ${JSON.stringify(claims.roles)}`);
    assert(Array.isArray(claims.scopes) && !claims.scopes.includes('memory:delete'),
      `the refreshed token must keep the approved scopes, got ${JSON.stringify(claims.scopes)}`);

    // The measurable consequence: the scope it was never granted must still be refused.
    const del = await json(`/v1/memory/${encodeURIComponent(MEM_KEY)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${refreshed}` },
    });
    assert(del.status === 403, `the refreshed GEAI deleted a record it has no scope for (${del.status})`);
  } else {
    assert(r.status === 401 || r.status === 403, `unexpected refresh status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
});

await test('GEAI denied a scope it was not granted (memory:delete) → 403', async () => {
  // The GEAI has memory:read + memory:write but NOT memory:delete. It reaches the route (role OK
  // via requireExternalPrincipal) but requireScope denies — proving scopes are enforced, not bypassed.
  const { status, body } = await json(`/v1/memory/${encodeURIComponent(MEM_KEY)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${geaiToken}` },
  });
  assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('Polling token before approval → authorization_pending', async () => {
  // A fresh hello whose request is never approved.
  const hello = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, app: 'pendingapp', public_key: APP_PUBKEY }),
  });
  assert(hello.body.ok === true, `hello failed: ${JSON.stringify(hello.body.error)}`);
  const { status, body } = await json('/v1/ecosystem-apps/token', {
    method: 'POST',
    body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: GRANT }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.error === 'authorization_pending', `expected authorization_pending, got ${body.error}`);
});

// ─── Phase 5: owner lists the memory the app wrote (GET /:app/data) ───
console.log('\nPhase 5 — Owner lists the app\'s written data');

await test('Owner GET /v1/ecosystem-apps/:app/data → sees the GEAI write', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${encodeURIComponent(APP)}/data`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `data list failed: ${JSON.stringify(body.error)}`);
  const items = body.data.items as any[];
  const found = items.find(i => i.key === MEM_KEY);
  assert(!!found, `app data must include the written key ${MEM_KEY}`);
  assert(found.value?.ticket === 'resolved', `value mismatch: ${JSON.stringify(found.value)}`);
  assert(found.visibility === 'private', `visibility mismatch: ${found.visibility}`);
  assert(typeof body.data.total === 'number' && body.data.total >= 1, `total should be >= 1, got ${body.data.total}`);
});

await test('Owner GET data for an app they never connected → 404', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/neverconnected/data', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'NOT_FOUND', `expected NOT_FOUND, got ${body.error?.code}`);
});

// ─── Phase 6: the app's OWN bilingual Markdown setup guide (manifest `setup:{fi,en}`) ───
console.log('\nPhase 6 — App-provided setup guide (manifest setup:{fi,en})');

const SETUP_APP = 'feedbackdesk';
const SETUP_FI = '# Näin asennat\n\nLiitä **agenttisi** ja valitse organismi.';
const SETUP_EN = '# How to set up\n\nConnect your **agent** and pick an organism.';
let setupDeviceCode = '';
let setupUserCode = '';

await test('App says hello WITH a manifest carrying setup:{fi,en} → pending request created', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName,
      app: SETUP_APP,
      display_name: 'Feedback Desk',
      public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      manifest: {
        app: SETUP_APP,
        scopes: ['memory:read', 'memory:write'],
        setup: { fi: SETUP_FI, en: SETUP_EN },
      },
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `hello failed: ${JSON.stringify(body.error)}`);
  // The manifest is well-formed → static validation must pass (so approval isn't blocked).
  assert(body.data.validation?.ok === true, `manifest validation should pass: ${JSON.stringify(body.data.validation)}`);
  setupDeviceCode = body.data.device_code;
  setupUserCode = body.data.user_code;
  assert(!!setupDeviceCode && !!setupUserCode, 'got device + user codes');
});

await test('Owner approves the setup-bearing app', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${setupUserCode}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.status === 'approved', `expected approved, got ${body.data.status}`);
});

await test('GET /v1/ecosystem-apps returns the app\'s setup guide (both locales)', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const apps = body.data.ecosystem_apps as any[];
  const rec = apps.find(a => a.app === SETUP_APP);
  assert(!!rec, `ecosystem app ${SETUP_APP} not listed`);
  assert(!!rec.setup, `setup must be present, got ${JSON.stringify(rec.setup)}`);
  assert(rec.setup.fi === SETUP_FI, `setup.fi mismatch: ${rec.setup.fi}`);
  assert(rec.setup.en === SETUP_EN, `setup.en mismatch: ${rec.setup.en}`);
});

await test('An app connected WITHOUT a setup guide returns setup: null (fallback case)', async () => {
  // The original APP (zendesk) was connected in Phase 1 with NO manifest → no setup guide.
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const apps = body.data.ecosystem_apps as any[];
  const rec = apps.find(a => a.app === APP);
  assert(!!rec, `ecosystem app ${APP} not listed`);
  assert(rec.setup === null, `setup must be null for an app with no guide, got ${JSON.stringify(rec.setup)}`);
});

// ─── Phase 7: the app's recommended agents (manifest `automation.recommended_agents`) ───
console.log('\nPhase 7 — App-declared recommended agents (automation.recommended_agents)');

const REC_APP = 'feedbackrec';
const REC_AGENTS = [{
  name: 'feedback-wisdom',
  match_tags: ['feedback-analysis', 'consumes:feedback-stats@1'],
  why: {
    fi: 'Lukee tämän appin feedback-statsit ja tuottaa niistä suositukset.',
    en: "Reads this app's feedback stats and turns them into recommendations.",
  },
}];
let recUserCode = '';

await test('App says hello WITH automation.recommended_agents → pending request created', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName,
      app: REC_APP,
      display_name: 'Feedback Rec',
      public_key: APP_PUBKEY,
      scopes: ['memory:read', 'memory:write'],
      manifest: {
        app: REC_APP,
        scopes: ['memory:read', 'memory:write'],
        automation: {
          schedulable: [{ id: 'publish-stats', produces: 'feedback-stats@1', produces_key: 'feedback.stats', cadences: ['weekly'] }],
          recommended_agents: REC_AGENTS,
        },
      },
    }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.ok === true, `hello failed: ${JSON.stringify(body.error)}`);
  // The manifest (incl. recommended_agents) is well-formed → static validation must pass.
  assert(body.data.validation?.ok === true, `manifest validation should pass: ${JSON.stringify(body.data.validation)}`);
  recUserCode = body.data.user_code;
  assert(!!recUserCode, 'got user code');
});

await test('Owner approves the recommendation-bearing app', async () => {
  const { status, body } = await json(`/v1/ecosystem-apps/${recUserCode}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.status === 'approved', `expected approved, got ${body.data.status}`);
});

await test('GET /v1/ecosystem-apps returns automation.recommended_agents (name + match_tags + bilingual why)', async () => {
  const { status, body } = await json('/v1/ecosystem-apps', {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const rec = (body.data.ecosystem_apps as any[]).find(a => a.app === REC_APP);
  assert(!!rec, `ecosystem app ${REC_APP} not listed`);
  const recs = rec.automation?.recommended_agents;
  assert(Array.isArray(recs) && recs.length === 1, `recommended_agents must round-trip, got ${JSON.stringify(rec.automation)}`);
  assert(recs[0].name === 'feedback-wisdom', `name mismatch: ${recs[0].name}`);
  assert(Array.isArray(recs[0].match_tags) && recs[0].match_tags.includes('feedback-analysis'), `match_tags mismatch: ${JSON.stringify(recs[0].match_tags)}`);
  assert(recs[0].why?.fi === REC_AGENTS[0].why.fi && recs[0].why?.en === REC_AGENTS[0].why.en, `why mismatch: ${JSON.stringify(recs[0].why)}`);
});

await test('Failure mode: a recommended_agents entry MISSING `why` fails static validation', async () => {
  const { status, body } = await json('/v1/ecosystem-apps/hello', {
    method: 'POST',
    body: JSON.stringify({
      owner: ownerName,
      app: 'feedbackbad',
      display_name: 'Feedback Bad',
      public_key: APP_PUBKEY,
      scopes: ['memory:read'],
      manifest: {
        app: 'feedbackbad',
        scopes: ['memory:read'],
        // `why` is REQUIRED on each recommended_agents entry — omit it to trip manifest_schema.
        automation: { recommended_agents: [{ name: 'x' }] },
      },
    }),
  });
  assert(status === 200, `hello itself should respond 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data.validation?.ok === false, `validation should FAIL for a why-less recommendation: ${JSON.stringify(body.data.validation)}`);
  const schemaCheck = (body.data.validation?.checks as any[]).find(c => c.name === 'manifest_schema');
  assert(schemaCheck && schemaCheck.ok === false, `manifest_schema check should be false: ${JSON.stringify(body.data.validation?.checks)}`);
});

// ─── Summary ───
console.log('\n' + '─'.repeat(48));
console.log(`Ecosystem-App Foundation E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All tests passed!\n');
