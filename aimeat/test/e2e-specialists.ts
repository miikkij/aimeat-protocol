// E2E test — Specialist agents (Secretary P5 / S-A)
//
// Verifies the specialist agent type: a reusable agent ALONGSIDE the secretaries, provisioned with its
// own brain (directives), its own operating-model policy (same bands/cost-guard taxonomy as the
// Secretary), and its own scope profile — and never colliding with the personal/company Secretary.
//
// Run via the CI runner: cd aimeat && pnpm exec node --env-file=.env.test.sqlite \
//   --import tsx test/run-e2e-ci.ts --test=specialists

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { scopesForProfile, SPECIALIST_ROLES } from '../src/mcp/catalog/scopes.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

// Expected SECRETARY default operating-model bands — a specialist must seed an identical set (S-A).
const EXPECTED_DEFAULT_BANDS: Record<string, string> = {
  discover: 'act', file_intake: 'act', briefing: 'act', reminders: 'act',
  curate_knowledge: 'draft', draft_replies: 'draft', create_resource: 'ask',
  delegate: 'ask', resource_invoke: 'ask', third_party_message: 'ask', spend: 'ask',
};

let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `specowner${Date.now()}`;

console.log('\n=== AIMEAT Specialist Agents E2E (S-A) ===\n');

// ─── Phase 0: Setup ───
console.log('Phase 0 — Setup');
await test('register owner (operator)', async () => {
  const { status, body } = await json('/v1/admin/setup/register', {
    method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: ownerName }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.private_key;
  assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'owner private key');
});
await test('owner auth token', async () => {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(ownerPrivKey, ownerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp, signature }) });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
  assert(typeof ownerToken === 'string', 'owner token');
});

const H = () => ({ Authorization: `Bearer ${ownerToken}` });

// ─── Phase 1: Provision a specialist with a distinct brain + scope profile ───
console.log('Phase 1 — Provision specialist (distinct brain + scope profile)');
await test('POST /v1/specialists — create sdr with brain + role', async () => {
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(),
    body: JSON.stringify({
      name: 'sdr', role: 'sdr', display_name: 'SDR Bot', description: 'Finds and qualifies leads.',
      brain: { purpose: 'Find and qualify B2B leads.', rules: [{ description: 'Scout existing resources before building anything new.' }] },
    }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const s = body.data?.specialist;
  assert(s?.gaii === `sdr#${ownerName}@${NODE_ID}`, `gaii ${s?.gaii}`);
  assert(s?.role === 'sdr', 'role sdr');
  assert(s?.created === true, 'created');
  assert((s?.tags ?? []).includes('system:specialist'), 'tagged system:specialist');
  assert((s?.tags ?? []).includes('unlisted'), 'tagged unlisted');
  assert((s?.tags ?? []).includes('role:sdr'), 'tagged role:sdr');
  // sdr scope profile: Community-safe — read-heavy, drafts, never spends/outbound on its own.
  // The Enterprise superset (wallet/workflow:write/social/outbound) is NOT granted in Community (G1).
  assert((s?.scopes ?? []).includes('memory:read') && (s?.scopes ?? []).includes('workflow:read'), 'has the Community base reads');
  assert(!(s?.scopes ?? []).includes('workflow:write'), 'no workflow:write (Enterprise-only)');
  assert(!(s?.scopes ?? []).includes('social:read') && !(s?.scopes ?? []).includes('social:write'), 'no social scope (Enterprise-only)');
  assert(!(s?.scopes ?? []).includes('spend'), 'no spend scope');
  assert(!(s?.scopes ?? []).some((x: string) => x.startsWith('wallet')), 'no wallet scope');
  assert(!(s?.scopes ?? []).includes('messages:send'), 'no messages:send scope');
  assert(s?.brain?.purpose === 'Find and qualify B2B leads.', 'brain purpose');
  assert((s?.brain?.rules ?? []).length === 1, 'one brain rule');
});

await test('GET /v1/agents/sdr/directives — brain is the specialist’s own', async () => {
  const { status, body } = await json('/v1/agents/sdr/directives', { headers: H() });
  assert(status === 200, `status ${status}`);
  assert(body.data?.purpose === 'Find and qualify B2B leads.', 'directives purpose');
  assert((body.data?.rules ?? []).some((r: any) => /scout/i.test(r.description)), 'scout rule present');
});

await test('scope profile differs from the Secretary (distinct, by narrowing — never widening)', async () => {
  const { body } = await json('/v1/specialists/sdr', { headers: H() });
  const scopes: string[] = body.data?.specialist?.scopes ?? [];
  // Secretary profile = memory:read/write/delete, storage:read/write, messages:read, workflow:read.
  // A Community specialist role differs ONLY by narrowing the base — sdr drops memory:delete (G1).
  assert(!scopes.includes('memory:delete'), 'sdr drops memory:delete (≠ secretary)');
  assert(scopes.includes('messages:read'), 'sdr keeps messages:read');
});

await test('least-privilege: every specialist role ⊆ the secretary Community baseline (G1)', async () => {
  // The source-of-truth check: no specialist role may grant a scope outside the Community `secretary`
  // baseline. The Enterprise superset (wallet/workflow:write/social/outbound/consent) is never a
  // Community specialist default. See docs/plans/2026-06-24-secretary-p5-gap-prompt.md (G1).
  const base = new Set(scopesForProfile('secretary'));
  for (const role of SPECIALIST_ROLES) {
    const roleScopes = scopesForProfile(role);
    const extra = roleScopes.filter(s => !base.has(s));
    assert(extra.length === 0, `role "${role}" grants scopes outside the secretary baseline: ${extra.join(', ')}`);
  }
});

// ─── Phase 1b: scope-CONSENT (declare → consent → grant) ───
// A role's GRANTED default stays conservative; the EXTRAS it declares need the owner's explicit consent.
console.log('Phase 1b — Scope-consent: declare → consent → grant');

await test('(a) create a role WITH extras, no approval → conservative + requestable_extras listed', async () => {
  // `recruiter` declares one extra (social:read) beyond the conservative baseline.
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'rec', role: 'recruiter' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const s = body.data?.specialist;
  // Provisioned conservatively — the extra is NOT granted without consent.
  assert(!(s?.scopes ?? []).includes('social:read'), 'social:read NOT granted silently');
  // …but it IS surfaced as a requestable extra, with a plain-language description.
  const extras = s?.requestable_extras ?? [];
  assert(extras.some((x: any) => x.scope === 'social:read' && typeof x.description === 'string' && x.description.length > 0),
    `requestable_extras lists social:read with a description: ${JSON.stringify(extras)}`);
});

await test('(b) POST approved_scopes ⊆ requested → defaultScopes = baseline ∪ approved', async () => {
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'rec', role: 'recruiter', approved_scopes: ['social:read'] }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`); // idempotent re-provision
  const s = body.data?.specialist;
  assert((s?.scopes ?? []).includes('social:read'), 'social:read now granted after consent');
  // Baseline kept (it never narrows below the role default).
  const base = new Set(scopesForProfile('recruiter'));
  for (const sc of base) assert((s?.scopes ?? []).includes(sc), `baseline scope ${sc} retained`);
  // Persisted on the agent record.
  const got = await json('/v1/specialists/rec', { headers: H() });
  assert((got.body.data?.specialist?.scopes ?? []).includes('social:read'), 'granted scope persisted on the agent');
});

await test('(c) approved_scopes ⊄ requested (asks for more than requested) → 400, never widened', async () => {
  // recruiter does NOT request wallet:read → it must be rejected, and the grant must not widen.
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'rec', role: 'recruiter', approved_scopes: ['wallet:read'] }),
  });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(/requestable|wallet:read/i.test(JSON.stringify(body.error)), 'error names the rejected scope');
  // The agent's scopes were NOT widened by the rejected request.
  const got = await json('/v1/specialists/rec', { headers: H() });
  assert(!(got.body.data?.specialist?.scopes ?? []).includes('wallet:read'), 'wallet:read never granted');
});

await test('(c2) a known scope OUTSIDE this role’s requested set is still rejected (bounded to the role)', async () => {
  // finance requests wallet:read; recruiter does not. Asking recruiter for finance’s extra → 400.
  const { status } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'rec', role: 'recruiter', approved_scopes: ['workflow:write'] }),
  });
  assert(status === 400, `status ${status}`);
});

await test('(d) a NO-extras role provisions unchanged, requestable_extras empty (no consent surfaced)', async () => {
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'plainspec', role: 'specialist' }),
  });
  assert(status === 201, `status ${status}`);
  assert((body.data?.specialist?.requestable_extras ?? []).length === 0, 'no requestable extras for the generic specialist');
  // Approving nothing/with a body containing extras for a no-extras role → rejected (nothing is requestable).
  const bad = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'plainspec', role: 'specialist', approved_scopes: ['social:read'] }),
  });
  assert(bad.status === 400, `no-extras role rejects any approved scope: ${bad.status}`);
});

await test('cleanup phase-1b specialists', async () => {
  await json('/v1/specialists/rec', { method: 'DELETE', headers: H() });
  await json('/v1/specialists/plainspec', { method: 'DELETE', headers: H() });
});

// ─── Phase 2: bands/cost-guard parity with the Secretary ───
console.log('Phase 2 — Bands/cost-guard behave like the Secretary');
await test('default policy = the Secretary operating model (11 bands + stop-spending)', async () => {
  const { body } = await json('/v1/specialists/sdr', { headers: H() });
  const policy = body.data?.specialist?.policy;
  assert(policy?.stopSpending === false, 'stopSpending default false');
  assert(policy?.dailyMorselBudget === null, 'dailyMorselBudget default null');
  const bands = policy?.bands ?? {};
  assert(Object.keys(bands).length === Object.keys(EXPECTED_DEFAULT_BANDS).length, `11 bands, got ${Object.keys(bands).length}`);
  for (const [cap, band] of Object.entries(EXPECTED_DEFAULT_BANDS)) {
    assert(bands[cap] === band, `band ${cap}=${bands[cap]} expected ${band}`);
  }
});

// ─── Phase 3: a second specialist with a different role (auto display name) ───
console.log('Phase 3 — Second specialist, different role');
await test('POST /v1/specialists — create meeting-prep (role prep), no display name', async () => {
  const { status, body } = await json('/v1/specialists', {
    method: 'POST', headers: H(), body: JSON.stringify({ name: 'meeting-prep', role: 'prep' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  const s = body.data?.specialist;
  assert(s?.display_name === 'Meeting Prep', `auto title-cased name, got ${s?.display_name}`);
  const scopes: string[] = s?.scopes ?? [];
  assert(!scopes.includes('social:read') && !scopes.includes('workflow:write'), 'prep is narrower than sdr');
});

// ─── Phase 4: no collision with the Secretaries ───
console.log('Phase 4 — Never collides with the personal/company Secretary');
await test('POST /v1/specialists name="secretary" → rejected', async () => {
  const { status, body } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'secretary' }) });
  assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
  assert(/reserved/i.test(JSON.stringify(body.error)), 'reserved message');
});
await test('POST /v1/specialists name="secretary-acme" → rejected (company prefix)', async () => {
  const { status } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'secretary-acme' }) });
  assert(status === 400, `status ${status}`);
});

// ─── Phase 5: list + policy update ───
console.log('Phase 5 — List + policy update');
await test('GET /v1/specialists — lists both specialists', async () => {
  const { status, body } = await json('/v1/specialists', { headers: H() });
  assert(status === 200, `status ${status}`);
  const names = (body.data?.specialists ?? []).map((s: any) => s.name).sort();
  assert(body.data?.total === 2, `total 2, got ${body.data?.total}`);
  assert(names.join(',') === 'meeting-prep,sdr', `names ${names.join(',')}`);
});
await test('PUT /v1/specialists/sdr/policy — stop-spending + band changes merge (locked stays)', async () => {
  const { status, body } = await json('/v1/specialists/sdr/policy', {
    method: 'PUT', headers: H(),
    body: JSON.stringify({ stopSpending: true, dailyMorselBudget: 25, bands: { spend: 'off', draft_replies: 'ask', discover: 'off' } }),
  });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const p = body.data?.policy;
  assert(p?.stopSpending === true, 'stopSpending now true');
  assert(p?.dailyMorselBudget === 25, 'dailyMorselBudget 25');
  assert(p?.bands?.spend === 'off', 'spend → off');
  assert(p?.bands?.draft_replies === 'ask', 'draft_replies → ask');
  assert(p?.bands?.discover === 'act', 'discover stays locked at act despite the request');
});

// ─── Phase 6: failure modes ───
console.log('Phase 6 — Failure modes');
await test('POST /v1/specialists invalid name → 400', async () => {
  const { status } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'x' }) });
  assert(status === 400, `status ${status}`);
});
await test('POST /v1/specialists invalid role → 400', async () => {
  const { status } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'closer', role: 'wizard' }) });
  assert(status === 400, `status ${status}`);
});
await test('collision with a non-specialist agent → 409', async () => {
  const reg = await json('/v1/agents', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'helper', owner: ownerName, capabilities: ['memory'] }) });
  assert(reg.status === 201, `agent register status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const { status, body } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'helper' }) });
  assert(status === 409, `status ${status}: ${JSON.stringify(body)}`);
});
await test('re-create same specialist → idempotent (created:false, 200)', async () => {
  const { status, body } = await json('/v1/specialists', { method: 'POST', headers: H(), body: JSON.stringify({ name: 'sdr', role: 'sdr' }) });
  assert(status === 200, `status ${status}`);
  assert(body.data?.specialist?.created === false, 'created false on re-provision');
});

// ─── Cleanup ───
console.log('Cleanup');
await test('DELETE /v1/specialists/sdr → removed', async () => {
  const { status } = await json('/v1/specialists/sdr', { method: 'DELETE', headers: H() });
  assert(status === 200, `status ${status}`);
  const after = await json('/v1/specialists/sdr', { headers: H() });
  assert(after.status === 404, `after delete status ${after.status}`);
});
await test('DELETE /v1/specialists/meeting-prep → removed', async () => {
  const { status } = await json('/v1/specialists/meeting-prep', { method: 'DELETE', headers: H() });
  assert(status === 200, `status ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
