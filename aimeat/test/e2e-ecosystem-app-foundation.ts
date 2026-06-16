/**
 * @file e2e-ecosystem-app-foundation.ts
 * @description E2E tests for the ecosystem-apps foundation (GEAI principal, chunk 1). Covers the
 *   "hello integration" handshake (hello → owner approve → token pickup), the GEAI writing into its
 *   own eco: memory namespace, the owner seeing that write via owner-scope aggregation, the stored
 *   EcosystemAppRecord (status active, scopes, pinned publicKey), and failure modes (scope enforced,
 *   poll-before-approval). Also unit-asserts the gaii.ts GEAI/GAII discrimination. Additive: the
 *   agent path is unaffected (regression covered by e2e-agent-onboarding).
 * @version-history
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

// ─── Phase 4: failure modes ───
console.log('\nPhase 4 — Failure modes');

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
