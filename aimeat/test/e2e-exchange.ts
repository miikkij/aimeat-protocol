/**
 * @file test/e2e-exchange.ts
 * @description E2E for the EXCHANGE loop (TARGET-045): the metered entitlement (G1) + the metered-call
 *   gateway (G2) + the per-app cost surface (G3) + the contract-acceptance mint surface. Proves the full
 *   slice-1 path end-to-end against a real server: a provider publishes a morsel-priced extension action;
 *   a consumer ACCEPTS a contract (price read authoritatively from the action, consumer picks only the
 *   budget); each call flows through the gateway — caller debited, provider credited its cut, the platform
 *   rake routed, the budget decremented; the budget CAP hard-stops the call; the cost surface reflects the
 *   spend; the consumer's pause/revoke off-switch blocks calls; and re-accepting resumes (spend carried).
 * @usage cd aimeat && AIMEAT_EXTENSIONS_ENABLED=true pnpm exec tsx test/e2e-exchange.ts
 * @version-history
 *   v1.3.0 — 2026-07-28 — EARNINGS: GET /v1/exchange/earnings — the seller's own accrued payables
 *     (per currency + the per-entry breakdown), the ?status filter, cross-owner isolation and the
 *     unauthenticated refusal. The accrual rail booked these and no route read them.
 *   v1.2.0 — 2026-07-25 — ODPS v4.1 conformance (TARGET-045 §4): provenance + odps authoring block
 *     validated on write, and the projected document checked against the OFFICIAL published schema.
 *   v1.1.0 — 2026-07-20 — Legibility layer: offering detail (I/O schema + recipe + stats), usage terms, need
 *     min-spec, provider consumer-lineage (owner-only), ?stats=1 list.
 *   v1.0.0 — 2026-07-20 — Initial EXCHANGE loop proof (G1+G2+G3 + acceptance surface).
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
  return { status: res.status, body };
}
import * as ed from '@noble/ed25519';
import { parse as parseYaml } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
const odpsSchema = JSON.parse(readFileSync(new URL('./fixtures/odps-v4.1.schema.json', import.meta.url), 'utf8'));
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `xc${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Exchange', password: 'Exchange1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Exchange', password: 'Exchange1234' }) }); }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function balance(token: string): Promise<number> {
  const r = await json('/v1/wallet', { headers: auth(token) });
  assert(r.status === 200, `wallet ${r.status}`);
  return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

console.log('\n=== AIMEAT EXCHANGE E2E (TARGET-045 — G1 entitlement + G2 gateway + G3 cost) ===\n');

const EXT = `xchg${Date.now()}`;
const SCRIPTS = { echo: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }' };
const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'exchange e2e provider', author: 'e2e' },
  actions: [
    { id: 'validate', method: 'POST', path: '/validate', script: 'echo',
      input: { type: 'object', properties: { q: { type: 'string' } } },
      output: { type: 'object', properties: { echo: {}, caller: { type: 'string' } } },
      commercial: { payMorsels: 10 } },
    { id: 'cheap', method: 'POST', path: '/cheap', script: 'echo',
      input: { type: 'object', properties: { q: { type: 'string' } } },
      output: { type: 'object', properties: { echo: {} } },
      commercial: { payMorsels: 4 } },
    { id: 'money', method: 'POST', path: '/money', script: 'echo', commercial: { payMoney: { amount: 100000, currency: 'EUR' } } },
    { id: 'bundled', method: 'POST', path: '/bundled', script: 'echo', commercial: { payMorsels: 5, plans: [{ id: 'pack3', model: 'bundle', blockSize: 3, blockPrice: 12 }] } },
    { id: 'subbed', method: 'POST', path: '/subbed', script: 'echo', commercial: { payMorsels: 5, plans: [{ id: 'basic', model: 'subscription', periodSeconds: 3600, periodPrice: 30, callsPerWindow: 2, windowSeconds: 60 }] } },
    { id: 'free', method: 'POST', path: '/free', script: 'echo' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 5000, max_api_calls: 1 },
}, null, 2);

let provider: Awaited<ReturnType<typeof setupOwner>>;
let consumer: Awaited<ReturnType<typeof setupOwner>>;
let operator: Awaited<ReturnType<typeof setupOwner>>;
let appId = '';
let rakePerCall = 0;

await test('Setup: provider installs a morsel-priced extension; consumer registered', async () => {
  operator = await setupOwner('neutral'); // the FIRST owner on a fresh DB auto-becomes operator
  provider = await setupOwner('prov');
  consumer = await setupOwner('cons');
  appId = `${consumer.name}/exchangeapp`;
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

const accept = (token: string, action: string, extra: Record<string, unknown> = {}) =>
  json('/v1/exchange/entitlements', { method: 'POST', headers: auth(token), body: JSON.stringify({ ext: EXT, action, contract_ref: 'c-e2e-1', ...extra }) });
const invoke = (token: string, action: string) =>
  json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ hi: 1 }) });

await test('Accept requires auth → 401 without a token', async () => {
  const r = await json('/v1/exchange/entitlements', { method: 'POST', body: JSON.stringify({ ext: EXT, action: 'validate', contract_ref: 'x' }) });
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('Accepting a NON-priced action → 400 NOT_PRICED', async () => {
  const r = await accept(consumer.token, 'free');
  assert(r.status === 400, `expected 400, got ${r.status}`);
  assert(r.body?.error?.code === 'NOT_PRICED', `expected NOT_PRICED, got ${JSON.stringify(r.body?.error)}`);
});

await test('Consumer accepts a contract → price is authoritative (10), budget is the consumer’s (25)', async () => {
  const r = await accept(consumer.token, 'validate', { cap_units: 25, app_id: appId, price_per_call: 1 /* must be IGNORED */ });
  assert(r.status === 201, `accept ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const e = r.body.data.entitlement;
  assert(e.price_per_call === 10, `price must come from the provider action (10), got ${e.price_per_call}`);
  assert(e.unit === 'morsels' && e.state === 'active', `unit/state: ${JSON.stringify(e)}`);
  assert(e.budget.cap_units === 25 && e.budget.spent_units === 0, `budget: ${JSON.stringify(e.budget)}`);
  rakePerCall = e.rake_per_call;
  assert(rakePerCall >= 1, `a positive price must carry a rake, got ${rakePerCall}`);
});

await test('Metered call #1: caller −10, provider +(10−rake), budget spent=10', async () => {
  const cb = await balance(consumer.token);
  const pb = await balance(provider.token);
  const r = await invoke(consumer.token, 'validate');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(await balance(consumer.token) === cb - 10, 'consumer debited the 10-morsel price');
  assert(await balance(provider.token) === pb + (10 - rakePerCall), `provider credited its cut (10−${rakePerCall})`);
});

await test('Metered call #2: budget spent=20, still under the 25 cap', async () => {
  const r = await invoke(consumer.token, 'validate');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const e = list.body.data.entitlements.find((x: any) => x.action === 'validate');
  assert(e.budget.spent_units === 20 && e.budget.calls === 2, `budget after 2 calls: ${JSON.stringify(e.budget)}`);
});

await test('Budget CAP hard-stops call #3 → 402 BUDGET_EXHAUSTED, no debit', async () => {
  const cb = await balance(consumer.token);
  const r = await invoke(consumer.token, 'validate');
  assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body?.error?.code === 'BUDGET_EXHAUSTED', `expected BUDGET_EXHAUSTED, got ${JSON.stringify(r.body?.error)}`);
  assert(await balance(consumer.token) === cb, 'no morsels moved when the cap is hit');
});

await test('G3 cost surface reflects the contract: 1 contract, morsels spent=20, calls=2', async () => {
  const r = await json(`/v1/apps/cost?app_id=${encodeURIComponent(appId)}`, { headers: auth(consumer.token) });
  assert(r.status === 200, `cost ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const d = r.body.data;
  assert(d.total_contracts === 1, `expected 1 contract, got ${d.total_contracts}`);
  assert(d.totals.morsels.spent_units === 20 && d.totals.morsels.calls === 2, `totals: ${JSON.stringify(d.totals.morsels)}`);
  assert(d.contracts[0].capability === `${EXT}/validate`, `capability label: ${d.contracts[0].capability}`);
});

await test('Another owner cannot see this app’s cost (cross-owner isolation)', async () => {
  const stranger = await setupOwner('str');
  const r = await json(`/v1/apps/cost?app_id=${encodeURIComponent(appId)}`, { headers: auth(stranger.token) });
  assert(r.status === 200, `cost ${r.status}`);
  assert(r.body.data.total_contracts === 0, 'a stranger must see none of the consumer’s contracts');
});

await test('Off-switch: pause a contract → the call is blocked (402 ENTITLEMENT_INACTIVE)', async () => {
  const a = await accept(consumer.token, 'cheap', { app_id: appId }); // uncapped
  assert(a.status === 201, `accept cheap ${a.status}: ${JSON.stringify(a.body?.error)}`);
  const one = await invoke(consumer.token, 'cheap');
  assert(one.status === 200, `cheap call before pause ${one.status}`);
  const off = await json('/v1/exchange/entitlements/off', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ ext: EXT, action: 'cheap', mode: 'pause' }) });
  assert(off.status === 200 && off.body.data.applied, `pause ${off.status}: ${JSON.stringify(off.body)}`);
  const blocked = await invoke(consumer.token, 'cheap');
  assert(blocked.status === 402 && blocked.body?.error?.code === 'ENTITLEMENT_INACTIVE', `expected ENTITLEMENT_INACTIVE, got ${blocked.status}/${JSON.stringify(blocked.body?.error)}`);
});

await test('Re-accepting resumes the contract and carries spend forward', async () => {
  const before = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const prev = before.body.data.entitlements.find((x: any) => x.action === 'cheap');
  const r = await accept(consumer.token, 'cheap', { app_id: appId });
  assert(r.status === 201, `re-accept ${r.status}`);
  assert(r.body.data.entitlement.state === 'active', 'resumed to active');
  assert(r.body.data.entitlement.budget.spent_units === prev.budget.spent_units, 'spend carried forward across re-accept');
  const call = await invoke(consumer.token, 'cheap');
  assert(call.status === 200, `call after resume ${call.status}: ${JSON.stringify(call.body?.error)}`);
});

// ── PRICING MODEL: bundle (N calls per block price) ──
await test('Bundle plan: block of 3 for 12 — call#1 charges 12 (refill), calls #2/#3 free', async () => {
  const a = await accept(consumer.token, 'bundled', { app_id: appId, plan_id: 'pack3', cap_units: 100 });
  assert(a.status === 201 && a.body.data.entitlement.pricing.model === 'bundle', `accept bundle: ${a.status} ${JSON.stringify(a.body?.data?.entitlement?.pricing || a.body?.error)}`);
  const b0 = await balance(consumer.token);
  const c1 = await invoke(consumer.token, 'bundled');
  assert(c1.status === 200, `bundle call1 ${c1.status}`);
  assert(await balance(consumer.token) === b0 - 12, 'call#1 buys the block (−12)');
  const b1 = await balance(consumer.token);
  await invoke(consumer.token, 'bundled');            // call#2 — from quota
  await invoke(consumer.token, 'bundled');            // call#3 — from quota
  assert(await balance(consumer.token) === b1, 'calls #2/#3 draw from the block (free)');
});

await test('Bundle refills: call#4 buys a new block (−12), spend=24 over 4 calls', async () => {
  const b = await balance(consumer.token);
  const c4 = await invoke(consumer.token, 'bundled');
  assert(c4.status === 200 && await balance(consumer.token) === b - 12, 'call#4 refills the block (−12)');
  const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const e = list.body.data.entitlements.find((x: any) => x.action === 'bundled');
  assert(e.budget.spent_units === 24 && e.budget.calls === 4, `bundle budget: ${JSON.stringify(e.budget)}`);
});

// ── PRICING MODEL: subscription (flat period fee + rate limit N/window) ──
await test('Subscription plan: call#1 charges the 30 period fee; call#2 free; call#3 → 429 rate-limited', async () => {
  const a = await accept(consumer.token, 'subbed', { app_id: appId, plan_id: 'basic', cap_units: 100 });
  assert(a.status === 201 && a.body.data.entitlement.pricing.model === 'subscription', `accept sub: ${a.status} ${JSON.stringify(a.body?.data?.entitlement?.pricing || a.body?.error)}`);
  const b0 = await balance(consumer.token);
  const c1 = await invoke(consumer.token, 'subbed');
  assert(c1.status === 200 && await balance(consumer.token) === b0 - 30, 'call#1 buys the period (−30)');
  const b1 = await balance(consumer.token);
  const c2 = await invoke(consumer.token, 'subbed');
  assert(c2.status === 200 && await balance(consumer.token) === b1, 'call#2 is within the paid period (free)');
  const c3 = await invoke(consumer.token, 'subbed');
  assert(c3.status === 429 && c3.body?.error?.code === 'RATE_LIMITED', `call#3 over 2/window → 429, got ${c3.status}/${JSON.stringify(c3.body?.error)}`);
});

// ── MARKETPLACE: offering (supply) + need (demand) + bid → accept → mint (Phase C) ──
let offeringId = '', needId = '', bidId = '';
let buyer: Awaited<ReturnType<typeof setupOwner>>;

const validTerms = { derivatives: true, resale: false, attribution: true };
await test('Provider lists an OFFERING for its priced action (authoritative price from the action)', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'Y-tunnus validation', description: 'PRH company lookup', tags: ['prh', 'finland'], usage_terms: validTerms }) });
  assert(r.status === 201, `list offering ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const o = r.body.data.offering;
  assert(o.unit === 'morsels' && o.basePrice === 10, `offering price authoritative: ${JSON.stringify(o)}`);
  offeringId = o.offeringId;
});

await test('Legibility gate: listing an action with NO published schema → 400 SCHEMA_REQUIRED', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'money', title: 'no schema', usage_terms: validTerms }) });
  assert(r.status === 400 && r.body?.error?.code === 'SCHEMA_REQUIRED', `expected SCHEMA_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Legibility gate: listing WITHOUT usage_terms → 400 USAGE_TERMS_REQUIRED', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'no terms' }) });
  assert(r.status === 400 && r.body?.error?.code === 'USAGE_TERMS_REQUIRED', `expected USAGE_TERMS_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('One capability, one listing: the same call offered as BOTH kinds -> 409, naming the first', async () => {
  // The marketplace carried `ext:laake-fi:getPackage` twice — once raw, once as the app-tool bound
  // to it — with two descriptions, two sets of usage terms and two completeness scores for one
  // call. Nothing refused it and nothing connected them, so authoring one left the other bare and
  // a buyer could not tell they were the same thing.
  // Re-listing the same SURFACE is legitimate (that is how a listing is changed), so this offers
  // the same underlying action through the OTHER kind: an app-tool bound to `ext:<EXT>:validate`.
  const manifest = { tools: [{ name: 'dup-tool', description: 'the same call, sold twice',
    action_id: `ext:${EXT}:validate`, price: { morsels: 10 },
    inputSchema: { type: 'object', properties: { y: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }] };
  const dupApp = `${provider.name}/dup-app`;
  const w = await json('/v1/memory', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ key: `apps.${dupApp}.tools`, value: manifest, visibility: 'private' }) });
  assert(w.status === 201 || w.status === 200, `manifest write ${w.status}`);
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ kind: 'app-tool', app_id: dupApp, tool: 'dup-tool',
      title: 'the same call, listed twice', usage_terms: validTerms }) });
  assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body?.error?.code === 'CAPABILITY_ALREADY_LISTED', `expected CAPABILITY_ALREADY_LISTED, got ${JSON.stringify(r.body?.error)}`);
  assert(String(r.body?.error?.message ?? '').includes(offeringId),
    `the refusal must name the listing that already exists: ${r.body?.error?.message}`);
});

await test('Browse offerings by capability finds the listing (public, no auth)', async () => {
  const r = await json(`/v1/exchange/offerings?ext=${EXT}&action=validate`);
  assert(r.status === 200, `browse ${r.status}`);
  assert(r.body.data.offerings.some((o: any) => o.offeringId === offeringId), `listing not found: ${r.body.data.count}`);
});

await test('A non-owner cannot list someone else’s extension as an offering → 403', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'stolen' }) });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Consumer posts a NEED → open, and matches surface the offering', async () => {
  buyer = await setupOwner('buy');
  const r = await json('/v1/exchange/needs', { method: 'POST', headers: auth(buyer.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', description: 'Need Finnish company lookups', app_id: `${buyer.name}/lookup-app`, budget_unit: 'morsels', budget_cap: 50 }) });
  assert(r.status === 201, `post need ${r.status}: ${JSON.stringify(r.body?.error)}`);
  needId = r.body.data.need.needId;
  assert(r.body.data.matches.some((o: any) => o.offeringId === offeringId), 'offering should match the need');
});

await test('Open needs are browsable; provider bids on the need', async () => {
  const open = await json('/v1/exchange/needs?open=1');
  assert(open.status === 200 && open.body.data.needs.some((n: any) => n.needId === needId), 'need not in open list');
  const r = await json(`/v1/exchange/needs/${needId}/bids`, { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', offering_id: offeringId, note: 'happy to serve' }) });
  assert(r.status === 201, `bid ${r.status}: ${JSON.stringify(r.body?.error)}`);
  bidId = r.body.data.bid.bidId;
});

await test('Requester accepts the bid → entitlement minted; the metered call then works', async () => {
  const acc = await json(`/v1/exchange/needs/${needId}/bids/${bidId}/accept`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ cap_units: 50 }) });
  assert(acc.status === 201, `accept bid ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  const cb = await balance(buyer.token);
  const call = await invoke(buyer.token, 'validate');
  assert(call.status === 200, `metered call after bid-accept ${call.status}: ${JSON.stringify(call.body?.error)}`);
  assert(await balance(buyer.token) === cb - 10, 'buyer charged the authoritative price under the bid contract');
  const need = await json('/v1/exchange/needs?mine=1', { headers: auth(buyer.token) });
  assert(need.body.data.needs.find((n: any) => n.needId === needId)?.state === 'matched', 'need should be matched');
});

// ── LEGIBILITY LAYER: offering detail (I/O schema + recipe + stats), usage terms, need spec, provider lineage ──
await test('Offering DETAIL exposes the I/O schema, call recipe, and usage stats', async () => {
  const r = await json(`/v1/exchange/offerings/${offeringId}`);
  assert(r.status === 200, `detail ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const d = r.body.data;
  assert(d.offering?.offeringId === offeringId, 'detail returns the offering');
  assert(d.capability && typeof d.capability.output_schema === 'object', 'detail carries the action output schema');
  assert(d.call_recipe?.method === 'POST' && d.call_recipe.url === `/v1/ext/${EXT}/validate`, `call recipe: ${JSON.stringify(d.call_recipe)}`);
  // 'validate' was consumed by the capped consumer (2 calls) + the bid buyer (1 call) → real usage across ≥2 consumers.
  assert(d.stats.totalCalls >= 3, `stats.totalCalls should reflect metered use, got ${d.stats.totalCalls}`);
  assert(d.stats.consumers >= 2, `stats.consumers should count distinct consumers, got ${d.stats.consumers}`);
});

await test('Offering carries provider USAGE TERMS (derivatives/resale/attribution)', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'cheap', title: 'Cheap feed', usage_terms: { derivatives: true, resale: false, attribution: true, note: 'internal analytics' } }) });
  assert(r.status === 201, `list w/ terms ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const ut = r.body.data.offering.usageTerms;
  assert(ut && ut.derivatives === true && ut.resale === false && ut.attribution === true, `usage terms roundtrip: ${JSON.stringify(ut)}`);
});

await test('Need carries a MIN-SPEC (required fields + format) so a provider can judge fit', async () => {
  const r = await json('/v1/exchange/needs', { method: 'POST', headers: auth(buyer.token),
    body: JSON.stringify({ description: 'Company registry with VAT status', app_id: `${buyer.name}/vat-app`, spec: { requiredFields: ['name', 'vatValid'], format: 'JSON { name, vatValid }', inputSchema: { type: 'object', properties: { businessId: { type: 'string' } } }, outputSchema: { type: 'object', properties: { name: {}, vatValid: { type: 'boolean' } } } }, budget_unit: 'morsels', budget_cap: 40 }) });
  assert(r.status === 201, `need w/ spec ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const s = r.body.data.need.spec;
  assert(s && Array.isArray(s.requiredFields) && s.requiredFields.includes('vatValid') && s.format, `need spec roundtrip: ${JSON.stringify(s)}`);
  assert(s.inputSchema && s.outputSchema && s.outputSchema.properties, `need I/O interface schema roundtrip: ${JSON.stringify({ i: s.inputSchema, o: s.outputSchema })}`);
});

await test('A need REQUIRES a requesting app → 400 NEED_APP_REQUIRED without app_id', async () => {
  const r = await json('/v1/exchange/needs', { method: 'POST', headers: auth(buyer.token),
    body: JSON.stringify({ description: 'orphan need with no app', budget_unit: 'morsels', budget_cap: 10 }) });
  assert(r.status === 400 && r.body?.error?.code === 'NEED_APP_REQUIRED', `expected NEED_APP_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Provider LINEAGE: the offering owner sees who holds contracts; a stranger gets 404', async () => {
  const mine = await json(`/v1/exchange/offerings/${offeringId}/consumers`, { headers: auth(provider.token) });
  assert(mine.status === 200, `consumers ${mine.status}: ${JSON.stringify(mine.body?.error)}`);
  assert(mine.body.data.consumers.length >= 2, `provider should see its consumers, got ${mine.body.data.consumers.length}`);
  assert(mine.body.data.consumers.some((c: any) => c.calls >= 1), 'a consumer row should carry its call count');
  const stranger = await json(`/v1/exchange/offerings/${offeringId}/consumers`, { headers: auth(consumer.token) });
  assert(stranger.status === 404, `a non-owner must not read the lineage, got ${stranger.status}`);
});

await test('Offerings list with ?stats=1 folds usage into each listing', async () => {
  const r = await json('/v1/exchange/offerings?stats=1');
  assert(r.status === 200, `list+stats ${r.status}`);
  const o = r.body.data.offerings.find((x: any) => x.offeringId === offeringId);
  assert(o && o.stats && typeof o.stats.totalCalls === 'number', `stats folded into list: ${JSON.stringify(o?.stats)}`);
});

// ── MONEY unit (real currency via the accrual rail) — needs a EUR money handler (test.money in E2E) ──
let moneyEnabled = false;
try {
  const ucp = await fetch(`${BASE}/.well-known/ucp`).then((r) => r.json()) as any;
  moneyEnabled = (ucp.ucp?.payment_handlers || []).some((h: any) =>
    Array.isArray(h.currencies) && h.currencies.includes('EUR'));
} catch { /* leave false */ }

if (!moneyEnabled) {
  console.log('  ⏭  money-unit contract skipped — no EUR handler (set AIMEAT_TEST_MONEY_HANDLER=true)');
} else {
  await test('Accept a MONEY-priced contract → unit=money, authoritative EUR price, budget in micros', async () => {
    const r = await accept(consumer.token, 'money', { cap_units: 250000, app_id: appId }); // 0.25 EUR cap
    assert(r.status === 201, `accept money ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const e = r.body.data.entitlement;
    assert(e.unit === 'money' && e.currency === 'EUR', `unit/currency: ${JSON.stringify(e)}`);
    assert(e.price_per_call === 100000, `authoritative EUR price (100000 micros), got ${e.price_per_call}`);
    assert(e.budget.cap_units === 250000 && e.budget.spent_units === 0, `budget: ${JSON.stringify(e.budget)}`);
  });

  await test('Metered MONEY call: real EUR accrues off-ledger (morsels UNCHANGED), budget spent=100000', async () => {
    const cb = await balance(consumer.token);          // morsel balance must not move — money is off-ledger
    const r = await invoke(consumer.token, 'money');
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await balance(consumer.token) === cb, 'money settles off the morsel ledger — morsels unchanged');
    const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
    const e = list.body.data.entitlements.find((x: any) => x.action === 'money');
    assert(e.budget.spent_units === 100000 && e.budget.calls === 1, `budget after 1 money call: ${JSON.stringify(e.budget)}`);
  });

  await test('MONEY budget cap hard-stops: 2nd call ok (0.20/0.25), 3rd → 402 BUDGET_EXHAUSTED', async () => {
    const two = await invoke(consumer.token, 'money');   // spent -> 200000, under 250000
    assert(two.status === 200, `2nd money call ${two.status}`);
    const three = await invoke(consumer.token, 'money'); // 300000 > 250000 cap → denied
    assert(three.status === 402 && three.body?.error?.code === 'BUDGET_EXHAUSTED', `expected BUDGET_EXHAUSTED, got ${three.status}/${JSON.stringify(three.body?.error)}`);
  });

  await test('G3 cost surface splits money vs morsels: money spent=200000, 2 calls', async () => {
    const r = await json(`/v1/apps/cost?app_id=${encodeURIComponent(appId)}`, { headers: auth(consumer.token) });
    assert(r.status === 200, `cost ${r.status}`);
    assert(r.body.data.totals.money.spent_units === 200000 && r.body.data.totals.money.calls === 2, `money totals: ${JSON.stringify(r.body.data.totals.money)}`);
  });

  // ── EARNINGS: the other half of the money rail — what the accrual actually owes the SELLER ──
  // The consumer's side of a money call was already readable (budget spent). The provider's side was
  // booked as a payable and read by nothing, so a seller could see that they had been used and not
  // that they had been paid.
  await test('EARNINGS: the seller reads what the money calls accrued — 2 pending EUR entries, net of rake', async () => {
    const rake = ((await json('/v1/exchange/info')).body.data.rake_percent) || 5;
    const net = 100000 - Math.ceil(100000 * rake / 100);
    const r = await json('/v1/exchange/earnings', { headers: auth(provider.token) });
    assert(r.status === 200, `earnings ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const d = r.body.data;
    assert(d.seller === `${provider.name}@${NODE_ID}`, `earnings are owner-scoped, got seller=${d.seller}`);
    const eur = d.currencies?.EUR;
    assert(!!eur, `expected an EUR accrual, got ${JSON.stringify(d.currencies)}`);
    assert(eur.entries === 2, `2 money calls → 2 payable entries, got ${eur.entries}`);
    assert(eur.pending === 2 * net, `pending must be the net of rake (2×${net}), got ${eur.pending}`);
    assert(eur.settled === 0, `nothing is settled yet (this surface only makes the accrual readable), got ${eur.settled}`);
    assert(Array.isArray(d.entries) && d.entries.length === 2, `per-contract breakdown behind the figure: ${JSON.stringify(d.entries)}`);
    assert(d.entries.every((e: any) => e.status === 'pending' && e.amount === net && e.tracking_code), `entry shape: ${JSON.stringify(d.entries[0])}`);
    assert(d.entries.some((e: any) => e.buyer === `${consumer.name}@${NODE_ID}`), `the buyer is named on the entry: ${JSON.stringify(d.entries.map((e: any) => e.buyer))}`);
  });

  await test('EARNINGS: ?status=settled filters — none of this accrual is settled', async () => {
    const r = await json('/v1/exchange/earnings?status=settled', { headers: auth(provider.token) });
    assert(r.status === 200, `earnings filtered ${r.status}`);
    assert(r.body.data.count === 0, `no settled entries yet, got ${r.body.data.count}`);
  });

  await test('EARNINGS: the BUYER who paid reads none of the seller’s accrual (owner-scoped, not client-supplied)', async () => {
    const r = await json('/v1/exchange/earnings', { headers: auth(consumer.token) });
    assert(r.status === 200, `earnings ${r.status}`);
    assert(r.body.data.count === 0, `the buyer must read none of the provider's payables, got ${r.body.data.count}`);
    assert(!r.body.data.currencies?.EUR, `and no EUR total: ${JSON.stringify(r.body.data.currencies)}`);
  });
}

await test('EARNINGS requires auth → 401 without a token', async () => {
  const r = await json('/v1/exchange/earnings');
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

// ── GAP 1: APP-TOOL OFFERINGS (cross-app selling) — pinned interface + metered call + freeze ──
// A provider APP sells one of its tools (e.g. getCompanyBrief) as a durable metered offering. The tool binds
// to a capability; a consumer contracts it and calls it repeatedly, metered + raked, routed to a PINNED
// interface version so the provider can ship new app versions without breaking the integration.
const APP_ID = 'briefapp';
const IN_SCHEMA = { type: 'object', properties: { businessId: { type: 'string' } } };
const OUT_SCHEMA = { type: 'object', properties: { echo: {}, caller: { type: 'string' } } };
const capId = `ext:${EXT}:free`; // the auto-aggregated capability wrapping the unpriced `free` echo action
let appToolOfferingId = '';

const writeManifest = (token: string, tools: unknown[]) =>
  json('/v1/memory', { method: 'POST', headers: auth(token),
    body: JSON.stringify({ key: `apps.${APP_ID}.tools`, visibility: 'public', value: { version: 1, tools } }) });
const listAppTool = (token: string, body: Record<string, unknown>) =>
  json('/v1/exchange/offerings', { method: 'POST', headers: auth(token), body: JSON.stringify({ kind: 'app-tool', app_id: APP_ID, ...body }) });
const callTool = (token: string, tool = 'getbrief') =>
  json(`/v1/apps/${provider.name}/${APP_ID}/webmcp/tools/${tool}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ input: { businessId: '2145874-6' } }) });

await test('Setup: aggregate the backing capability + provider publishes an app-tool manifest', async () => {
  // The metered call routes to the tool's bound capability; aggregation turns the unpriced `free` ext action
  // into a callable capability (`ext:{EXT}:free`). Operator-only — the first owner is operator on a fresh DB.
  const agg = await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(operator.token) });
  assert(agg.status === 200, `aggregate ${agg.status}: ${JSON.stringify(agg.body?.error)} — first owner must be operator`);
  const cap = await json(`/v1/capabilities/${encodeURIComponent(capId)}`);
  assert(cap.status === 200 && cap.body.data?.callable, `backing capability ${capId} must exist + be callable: ${cap.status}`);
  // A well-formed sellable tool + a couple of gate-probe tools.
  const w = await writeManifest(provider.token, [
    { name: 'getbrief', description: 'Company brief', action_id: capId, inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA,
      price: { morsels: 8 }, plans: [{ id: 'pack5', model: 'bundle', blockSize: 5, blockPrice: 30 }] },
    { name: 'noout', description: 'missing output schema', action_id: capId, inputSchema: IN_SCHEMA, price: { morsels: 3 } },
    { name: 'unbound', description: 'no binding', inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA, price: { morsels: 3 } },
  ]);
  assert(w.status === 200 || w.status === 201, `write manifest ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('List an app-tool offering → kind=app-tool, pinned interface v1, authoritative price 8', async () => {
  const r = await listAppTool(provider.token, { tool: 'getbrief', title: 'Company brief', usage_terms: validTerms, tags: ['prh', 'brief'] });
  assert(r.status === 201, `list app-tool ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const o = r.body.data.offering;
  assert(o.kind === 'app-tool' && o.surface?.ifaceVersion === 1, `kind/surface: ${JSON.stringify(o.surface)}`);
  assert(o.unit === 'morsels' && o.basePrice === 8, `authoritative price: ${JSON.stringify({ unit: o.unit, basePrice: o.basePrice })}`);
  assert(o.ext === `apptool:${provider.name}/${APP_ID}` && o.action === 'getbrief', `coordinate: ${o.ext}/${o.action}`);
  appToolOfferingId = o.offeringId;
});

await test('Legibility gate (app-tool): a tool with no outputSchema → 400 SCHEMA_REQUIRED', async () => {
  const r = await listAppTool(provider.token, { tool: 'noout', usage_terms: validTerms });
  assert(r.status === 400 && r.body?.error?.code === 'SCHEMA_REQUIRED', `expected SCHEMA_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Legibility gate (app-tool): listing without usage_terms → 400 USAGE_TERMS_REQUIRED', async () => {
  const r = await listAppTool(provider.token, { tool: 'getbrief' });
  assert(r.status === 400 && r.body?.error?.code === 'USAGE_TERMS_REQUIRED', `expected USAGE_TERMS_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('An unbound (no action_id) tool cannot be offered as a metered service → 400 TOOL_UNBOUND', async () => {
  const r = await listAppTool(provider.token, { tool: 'unbound', usage_terms: validTerms });
  assert(r.status === 400 && r.body?.error?.code === 'TOOL_UNBOUND', `expected TOOL_UNBOUND, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Offering DETAIL exposes the PINNED interface schema + the WebMCP call recipe', async () => {
  const r = await json(`/v1/exchange/offerings/${appToolOfferingId}`);
  assert(r.status === 200, `detail ${r.status}`);
  const d = r.body.data;
  assert(d.capability?.kind === 'app-tool' && d.capability.iface_version === 1, `pinned iface in detail: ${JSON.stringify(d.capability)}`);
  assert(typeof d.capability.output_schema === 'object' && d.capability.output_schema.properties, 'detail carries the frozen output schema');
  assert(d.call_recipe?.url === `/v1/apps/${provider.name}/${APP_ID}/webmcp/tools/getbrief`, `call recipe url: ${d.call_recipe?.url}`);
});

await test('A non-contracted caller hitting the priced tool → 402 (payment required), not a free call', async () => {
  const r = await callTool(consumer.token);
  assert(r.status === 402, `expected 402 without a contract, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('Consumer contracts the app-tool offering (by offering_id) → entitlement pinned to v1', async () => {
  const r = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: appToolOfferingId, cap_units: 20, app_id: appId }) });
  assert(r.status === 201, `contract ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const e = r.body.data.entitlement;
  assert(e.price_per_call === 8 && e.unit === 'morsels' && e.state === 'active', `entitlement: ${JSON.stringify(e)}`);
  assert(e.surface?.kind === 'app-tool' && e.surface.ifaceVersion === 1, `pinned surface: ${JSON.stringify(e.surface)}`);
});

await test('Metered app-tool call: caller −8, provider +(8−rake), routed to pinned v1, budget spent=8', async () => {
  const cb = await balance(consumer.token);
  const pb = await balance(provider.token);
  const r = await callTool(consumer.token);
  assert(r.status === 200, `metered call ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.metered === true && r.body.data.iface_version === 1, `metered/pinned in response: ${JSON.stringify({ metered: r.body.data.metered, v: r.body.data.iface_version })}`);
  const fee = Math.ceil(8 * 5 / 100); // default 5% rake, ceils
  assert(await balance(consumer.token) === cb - 8, 'consumer debited the 8-morsel app-tool price');
  assert(await balance(provider.token) === pb + (8 - fee), `provider credited its cut (8−${fee})`);
});

await test('App-tool budget CAP hard-stops: after 2 calls (16/20), the 3rd → 402 BUDGET_EXHAUSTED', async () => {
  const two = await callTool(consumer.token);       // spent → 16, under 20
  assert(two.status === 200, `2nd app-tool call ${two.status}`);
  const cb = await balance(consumer.token);
  const three = await callTool(consumer.token);      // 24 > 20 cap → denied, no debit
  assert(three.status === 402 && three.body?.error?.code === 'BUDGET_EXHAUSTED', `expected BUDGET_EXHAUSTED, got ${three.status}/${JSON.stringify(three.body?.error)}`);
  assert(await balance(consumer.token) === cb, 'no morsels move when the app-tool budget cap is hit');
});

await test('Provider lineage reflects the app-tool consumer (calls + spend)', async () => {
  const r = await json(`/v1/exchange/offerings/${appToolOfferingId}/consumers`, { headers: auth(provider.token) });
  assert(r.status === 200, `consumers ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.consumers.some((c: any) => c.calls >= 2), `app-tool consumer lineage: ${JSON.stringify(r.body.data.consumers)}`);
});

await test('FREEZE: re-list with an UNCHANGED interface is idempotent (still v1)', async () => {
  const r = await listAppTool(provider.token, { tool: 'getbrief', usage_terms: validTerms });
  assert(r.status === 201 && r.body.data.offering.surface.ifaceVersion === 1, `unchanged relist should stay v1, got ${r.body.data.offering.surface?.ifaceVersion}`);
});

await test('FREEZE: a schema change mints interface v2; the consumer’s contract stays pinned to v1', async () => {
  // Provider ships a new interface (adds an output field) — the app product evolves.
  const w = await writeManifest(provider.token, [
    { name: 'getbrief', description: 'Company brief v2', action_id: capId, inputSchema: IN_SCHEMA,
      outputSchema: { type: 'object', properties: { echo: {}, caller: { type: 'string' }, score: { type: 'number' } } },
      price: { morsels: 8 }, plans: [{ id: 'pack5', model: 'bundle', blockSize: 5, blockPrice: 30 }] },
  ]);
  assert(w.status === 200 || w.status === 201, `rewrite manifest ${w.status}`);
  const r = await listAppTool(provider.token, { tool: 'getbrief', usage_terms: validTerms });
  assert(r.status === 201 && r.body.data.offering.surface.ifaceVersion === 2, `schema change should mint v2, got ${r.body.data.offering.surface?.ifaceVersion}`);
  // The consumer's existing contract is still pinned to v1 (the freeze) — a NEW contract would get v2.
  const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const e = list.body.data.entitlements.find((x: any) => x.action === 'getbrief');
  assert(e?.surface?.ifaceVersion === 1, `consumer contract must stay pinned to v1 after provider ships v2, got ${e?.surface?.ifaceVersion}`);
});

// ── RENEGOTIATION (proposals) + HISTORY + NEEDS APP-CONTEXT ──
const consumerGaii = `${consumer.name}@${NODE_ID}`;
const propose = (token: string, body: Record<string, unknown>) =>
  json('/v1/exchange/proposals', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
let propId = '';

await test('A non-party cannot propose a change to a contract → 403/404', async () => {
  // `buyer` is party to its OWN bid contract, but NOT to the consumer's 'cheap' contract → must be refused.
  const r = await propose(buyer.token, { consumer_gaii: consumerGaii, ext: EXT, action: 'cheap', new_price_per_call: 9 });
  assert(r.status === 403 || r.status === 404, `a non-party must not propose, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('Provider proposes a price change on the consumer’s contract → pending + a message is delivered', async () => {
  const r = await propose(provider.token, { consumer_gaii: consumerGaii, ext: EXT, action: 'cheap', new_price_per_call: 6, note: 'Upstream API got pricier' });
  assert(r.status === 201, `propose ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const p = r.body.data.proposal;
  assert(p.status === 'pending' && p.proposed_by === 'provider' && p.new_price_per_call === 6, `proposal: ${JSON.stringify(p)}`);
  assert(p.current_terms.pricePerCall === 4, `current terms snapshot: ${JSON.stringify(p.current_terms)}`);
  propId = p.proposal_id;
  // The counterparty (consumer) receives an inbox message about it.
  const inbox = await json('/v1/messages/inbox', { headers: auth(consumer.token) });
  assert(inbox.status === 200 && JSON.stringify(inbox.body).includes('contract change proposed'), 'consumer should get a proposal message in their inbox');
});

await test('The proposer cannot accept their own proposal; only the counterparty can', async () => {
  const r = await json(`/v1/exchange/proposals/${propId}/accept`, { method: 'POST', headers: auth(provider.token), body: '{}' });
  assert(r.status === 403, `proposer accepting must 403, got ${r.status}`);
});

await test('Consumer sees the incoming proposal in their list', async () => {
  const r = await json('/v1/exchange/proposals', { headers: auth(consumer.token) });
  assert(r.status === 200 && r.body.data.proposals.some((p: any) => p.proposal_id === propId && p.status === 'pending'), 'proposal not in consumer list');
});

await test('Consumer ACCEPTS → contract supersedes at the new price (6); the old one is archived to history', async () => {
  const r = await json(`/v1/exchange/proposals/${propId}/accept`, { method: 'POST', headers: auth(consumer.token), body: '{}' });
  assert(r.status === 200, `accept ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.entitlement.price_per_call === 6, `new price should be 6, got ${r.body.data.entitlement.price_per_call}`);
  assert(r.body.data.entitlement.budget.spent_units === 0, 'renegotiated contract starts a fresh meter');
  // The live contract now prices at 6.
  const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const e = list.body.data.entitlements.find((x: any) => x.action === 'cheap');
  assert(e.price_per_call === 6, `live contract must be 6, got ${e.price_per_call}`);
  // The old contract (price 4) is in history.
  const hist = await json('/v1/exchange/entitlements/history', { headers: auth(consumer.token) });
  assert(hist.status === 200, `history ${hist.status}`);
  assert(hist.body.data.history.some((h: any) => h.action === 'cheap' && h.price_per_call === 4 && h.archive_reason === 'superseded'), `superseded old contract not in history: ${JSON.stringify(hist.body.data.history)}`);
});

await test('A metered call after renegotiation is priced at the NEW rate (6)', async () => {
  // The renegotiated price (6) is what the gateway charges. Prove it robustly against the long suite's
  // depleted balance: either the call succeeds and debits exactly 6, or it is refused for insufficient
  // funds with a message that states the 6-morsel price — both confirm the new rate is in force.
  const cb = await balance(consumer.token);
  const r = await invoke(consumer.token, 'cheap');
  if (r.status === 200) {
    assert(await balance(consumer.token) === cb - 6, `the renegotiated price (6) is charged, balance moved ${cb - await balance(consumer.token)}`);
  } else {
    assert(r.status === 402 && /6 morsels/.test(JSON.stringify(r.body?.error)), `expected a 6-morsel charge or a 6-morsel insufficient-funds notice, got ${r.status}/${JSON.stringify(r.body?.error)}`);
  }
});

await test('Provider’s history view also shows the superseded contract', async () => {
  const r = await json('/v1/exchange/provider/history', { headers: auth(provider.token) });
  assert(r.status === 200 && r.body.data.history.some((h: any) => h.action === 'cheap' && h.price_per_call === 4), `provider history: ${JSON.stringify(r.body.data.history)}`);
});

await test('DECLINE: a new proposal declined by the consumer leaves the contract unchanged', async () => {
  const p = await propose(provider.token, { consumer_gaii: consumerGaii, ext: EXT, action: 'cheap', new_price_per_call: 5 });
  const id = p.body.data.proposal.proposal_id;
  const dec = await json(`/v1/exchange/proposals/${id}/decline`, { method: 'POST', headers: auth(consumer.token), body: '{}' });
  assert(dec.status === 200 && dec.body.data.proposal.status === 'declined', `decline ${dec.status}`);
  const list = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const e = list.body.data.entitlements.find((x: any) => x.action === 'cheap');
  assert(e.price_per_call === 6, 'declined proposal must not change the price (still 6)');
});

await test('WITHDRAW: the proposer can withdraw their own pending proposal', async () => {
  const p = await propose(provider.token, { consumer_gaii: consumerGaii, ext: EXT, action: 'cheap', new_price_per_call: 7 });
  const id = p.body.data.proposal.proposal_id;
  const wd = await json(`/v1/exchange/proposals/${id}/withdraw`, { method: 'POST', headers: auth(provider.token), body: '{}' });
  assert(wd.status === 200 && wd.body.data.proposal.status === 'withdrawn', `withdraw ${wd.status}`);
  const cannotAccept = await json(`/v1/exchange/proposals/${id}/accept`, { method: 'POST', headers: auth(consumer.token), body: '{}' });
  assert(cannotAccept.status === 404, 'a withdrawn proposal cannot be accepted');
});

await test('Needs carry usage-intent + an appContext field (provider can judge who they’d serve)', async () => {
  const r = await json('/v1/exchange/needs', { method: 'POST', headers: auth(buyer.token),
    body: JSON.stringify({ description: 'Company registry lookups for a CRM enrichment app', app_id: `${buyer.name}/crm-enrich`, usage_intent: 'Enrich CRM contacts nightly; internal use only, no resale', budget_unit: 'morsels', budget_cap: 40 }) });
  assert(r.status === 201, `need w/ intent ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.need.usageIntent && r.body.data.need.usageIntent.includes('CRM'), `usageIntent roundtrip: ${r.body.data.need.usageIntent}`);
  const list = await json('/v1/exchange/needs?open=1');
  const n = list.body.data.needs.find((x: any) => x.needId === r.body.data.need.needId);
  assert(n && 'appContext' in n && n.usageIntent, `enriched need must carry usageIntent + appContext field: ${JSON.stringify({ ac: n?.appContext, ui: n?.usageIntent })}`);
});

// ── AGENT WORK (async third surface — metered per delivered task, Gap 2) ──
let awOfferingId = '', awWorkId = '', awRake = 5;
await test('Provider registers a worker agent + lists an AGENT-WORK offering (task type, priced)', async () => {
  const reg = await json('/v1/agents', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ name: 'worker', owner: provider.name, capabilities: ['actions'] }) });
  assert(reg.status === 201, `agent register ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  awRake = ((await json('/v1/exchange/info')).body.data.rake_percent) || 5;
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ kind: 'agent-work', agent_name: 'worker', task_type: 'summarize', title: 'Doc summarization',
      price_morsels: 12, usage_terms: validTerms,
      input_schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
      output_schema: { type: 'object', properties: { summary: { type: 'string' } } } }) });
  assert(r.status === 201, `list agent-work ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const o = r.body.data.offering;
  assert(o.kind === 'agent-work' && o.surface?.kind === 'agent-work' && o.surface.taskType === 'summarize', `surface: ${JSON.stringify(o.surface)}`);
  assert(o.basePrice === 12 && o.ext === `agentwork:${provider.name}/worker` && o.action === 'summarize', `price/coordinate: ${JSON.stringify({ p: o.basePrice, ext: o.ext, action: o.action })}`);
  assert(o.taskSpec && o.taskSpec.inputSchema && o.taskSpec.outputSchema, `task spec stored: ${JSON.stringify(o.taskSpec)}`);
  awOfferingId = o.offeringId;
});

await test('Agent-work legibility gate: no output schema → 400 SCHEMA_REQUIRED', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ kind: 'agent-work', agent_name: 'worker', task_type: 'noout', price_morsels: 5, usage_terms: validTerms, input_schema: { type: 'object', properties: { x: {} } } }) });
  assert(r.status === 400 && r.body?.error?.code === 'SCHEMA_REQUIRED', `expected SCHEMA_REQUIRED, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Starting work without a contract → 402 NO_CONTRACT', async () => {
  const r = await json('/v1/exchange/work', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: awOfferingId, input: { text: 'hi' } }) });
  assert(r.status === 402 && r.body?.error?.code === 'NO_CONTRACT', `expected NO_CONTRACT, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Consumer contracts the agent-work offering, then STARTS a task (nothing charged yet)', async () => {
  const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: awOfferingId, cap_units: 50 }) });
  assert(acc.status === 201 && acc.body.data.entitlement.price_per_call === 12, `contract ${acc.status}: ${JSON.stringify(acc.body?.error || acc.body.data.entitlement)}`);
  const cb = await balance(buyer.token);
  const st = await json('/v1/exchange/work', { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ offering_id: awOfferingId, input: { text: 'a long document to summarize' } }) });
  assert(st.status === 201 && st.body.data.work.state === 'open' && st.body.data.work.charged_units === 0, `start work ${st.status}: ${JSON.stringify(st.body?.error || st.body.data.work)}`);
  awWorkId = st.body.data.work.work_id;
  assert(await balance(buyer.token) === cb, 'nothing is charged when work is started — only on delivery');
});

await test('A non-provider cannot deliver the work → 404', async () => {
  const r = await json(`/v1/exchange/work/${awWorkId}/deliver`, { method: 'POST', headers: auth(buyer.token), body: JSON.stringify({ output: { summary: 'x' } }) });
  assert(r.status === 404, `a non-provider must not deliver, got ${r.status}`);
});

await test('Provider DELIVERS → consumer charged 12 ON DELIVERY, provider +(12−rake), output stored', async () => {
  const cb = await balance(buyer.token), pb = await balance(provider.token);
  const r = await json(`/v1/exchange/work/${awWorkId}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: { summary: 'A short summary.' } }) });
  assert(r.status === 200 && r.body.data.work.state === 'delivered', `deliver ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.work.charged_units === 12, `charged 12 on delivery, got ${r.body.data.work.charged_units}`);
  const fee = Math.ceil(12 * awRake / 100);
  assert(await balance(buyer.token) === cb - 12, 'consumer charged the 12-morsel task price on delivery');
  assert(await balance(provider.token) === pb + (12 - fee), `provider credited its cut (12−${fee})`);
  assert(JSON.stringify(r.body.data.work.output).includes('A short summary'), `delivered output stored: ${JSON.stringify(r.body.data.work.output)}`);
});

await test('Re-delivering the same work → 409 WORK_NOT_OPEN', async () => {
  const r = await json(`/v1/exchange/work/${awWorkId}/deliver`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ output: {} }) });
  assert(r.status === 409 && r.body?.error?.code === 'WORK_NOT_OPEN', `expected WORK_NOT_OPEN, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Work lists: consumer sees it (consumer role); provider sees it delivered (provider role)', async () => {
  const cw = await json('/v1/exchange/work', { headers: auth(buyer.token) });
  assert(cw.status === 200 && cw.body.data.work.some((w: any) => w.work_id === awWorkId), 'consumer work list');
  const pw = await json('/v1/exchange/work?role=provider', { headers: auth(provider.token) });
  assert(pw.status === 200 && pw.body.data.work.some((w: any) => w.work_id === awWorkId && w.state === 'delivered'), 'provider work list shows delivered');
});

// ── ODPS v4.1 (TARGET-045 §4): the listing as an Open Data Product Specification document ──
// Validated against the OFFICIAL published schema (test/fixtures/odps-v4.1.schema.json, ODPS v4.1,
// Apache-2.0) — a conformance claim only counts if a real validator agrees with it. v4.1 keys `details`
// and `pricingPlans.declarative` by ISO 639-1 language and wraps several labels in language maps.
const ODPS_PROVENANCE = {
  source: 'PRH open company register (YTJ v3)',
  legalBasis: 'Public register — open data, no personal data reused',
  consentStatus: 'not applicable (public register)',
  retention: 'Snapshot kept 30 days, then refreshed from source',
  transformations: 'Normalised names, joined municipality codes, dropped discontinued companies.',
  snapshotHash: 'a'.repeat(64),
  lineage: [{ source: 'avoindata.prh.fi/opendata-ytj-api', transform: 'fetch + normalise', at: '2026-07-25T00:00:00.000Z' }],
};
const ODPS_EXTRAS = {
  language: 'en',
  productType: 'derived data',
  governanceProfile: 'audit_ready',
  portfolioPriority: 'high',
  valueProposition: 'Verified Finnish company identity in one call, priced per use.',
  categories: ['company data', 'finland'],
  standards: ['ISO 8000'],
  useCases: [{ title: 'KYB onboarding', description: 'Verify a counterparty before opening an account.' }, { title: 'Invoice counterparty check' }],
  contentSample: 'https://example.org/samples/ytunnus.json',
  sla: [{ dimension: 'uptime', objective: 99.5, unit: 'percent' }, { dimension: 'responseTime', objective: 800, unit: 'milliseconds' }],
  dataQuality: [{ dimension: 'accuracy', objective: 99, unit: 'percentage' }],
  dataHolder: { legalName: 'Overscale Solutions Oy', businessID: '3312345-6', addressCountry: 'FI' },
  license: { geographicalArea: ['EU'], exclusive: false, applicableLaws: 'Finnish law' },
};
let odpsOfferingId = '';

await test('Listing accepts a validated PROVENANCE + ODPS authoring block (odpsVersion stamped by the node)', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'Y-tunnus validation (ODPS)', description: 'PRH company lookup with provenance',
      tags: ['prh', 'odps'], usage_terms: { derivatives: true, resale: false, attribution: true, note: 'Attribute PRH as the source.' },
      provenance: ODPS_PROVENANCE, odps: ODPS_EXTRAS }) });
  assert(r.status === 201, `list with odps ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const o = r.body.data.offering;
  odpsOfferingId = o.offeringId;
  assert(o.provenance?.odpsVersion === '4.1', `node stamps odpsVersion, got ${JSON.stringify(o.provenance)}`);
  assert(o.provenance?.lineage?.length === 1 && o.odps?.dataHolder?.legalName === 'Overscale Solutions Oy', `provenance + odps stored: ${JSON.stringify(o.odps)}`);
});

await test('Malformed provenance (bad snapshotHash) → 400 INVALID_PROVENANCE', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'bad prov', usage_terms: validTerms, provenance: { snapshotHash: 'not-a-digest' } }) });
  assert(r.status === 400 && r.body?.error?.code === 'INVALID_PROVENANCE', `expected INVALID_PROVENANCE, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('Malformed ODPS block (SLA dimension outside the spec enum) → 400 INVALID_ODPS', async () => {
  const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ ext: EXT, action: 'validate', title: 'bad odps', usage_terms: validTerms,
      odps: { sla: [{ dimension: 'vibes', objective: 10, unit: 'percent' }] } }) });
  assert(r.status === 400 && r.body?.error?.code === 'INVALID_ODPS', `expected INVALID_ODPS, got ${r.status}/${JSON.stringify(r.body?.error)}`);
});

await test('GET /odps.yaml serves YAML that VALIDATES against the official ODPS v4.1 schema', async () => {
  const res = await fetch(`${BASE}/v1/exchange/offerings/${odpsOfferingId}/odps.yaml`);
  assert(res.status === 200, `odps.yaml ${res.status}`);
  assert((res.headers.get('content-type') ?? '').includes('yaml'), `content-type should be YAML, got ${res.headers.get('content-type')}`);
  const doc = parseYaml(await res.text()) as any;
  // KNOWN SPEC BUG (still present in the v4.1 published JSON Schema): `product.dataAccess` and `product.paymentGateways` are
  // declared `type: object` while $ref-ing an ARRAY-typed definition — a contradiction no document can
  // satisfy. The specification's own examples show a MAPPING of named access blocks, which is what we emit.
  // We therefore validate every other element strictly and assert those two by hand (below). If ODPS repairs
  // the schema, the tripwire assertion at the end of this test fails and full validation can be turned on.
  const validator = new Ajv2020({ strict: false, allErrors: true });
  addFormats(validator);
  const validatable = { ...doc, product: { ...doc.product } };
  delete validatable.product.dataAccess;
  delete validatable.product.paymentGateways;
  const ok = validator.validate(odpsSchema, validatable);
  assert(ok === true, `ODPS schema validation failed: ${JSON.stringify(validator.errors?.slice(0, 4))}`);
  // A YAML document points at the YAML schema (as the spec's own examples do); the JSON route keeps odps.json.
  assert(doc.version === '4.1' && String(doc.schema) === 'https://opendataproducts.org/v4.1/schema/odps.yaml', `root: ${JSON.stringify({ v: doc.version, s: doc.schema })}`);
  // Tripwire: the contradiction is still present in the pinned schema fixture.
  const daProp = odpsSchema.properties.product.properties.dataAccess;
  const daDef = odpsSchema.$defs.DataAccess;
  assert(daProp.type === 'object' && daDef.type === 'array',
    'ODPS fixed the dataAccess schema contradiction — validate the whole document again and drop this workaround');
});

await test('The ODPS document carries the AIMEAT truth: pricing, licence rights, provenance, observed usage', async () => {
  const res = await fetch(`${BASE}/v1/exchange/offerings/${odpsOfferingId}/odps.yaml`);
  const doc = parseYaml(await res.text()) as any;
  const p = doc.product;
  // v4.1: details is keyed by ISO 639-1 language — one key only, the language the provider declared.
  assert(Object.keys(p.details).length === 1 && p.details.en, `details should be language-keyed: ${JSON.stringify(Object.keys(p.details))}`);
  const det = p.details.en;
  assert(det.productID === odpsOfferingId && det.status === 'production' && det.type === 'derived data',
    `details: ${JSON.stringify(det)}`);
  assert(det.standards.includes('ODPS v4.1') && det.useCases[0].useCase.useCaseTitle === 'KYB onboarding', `details standards/useCases: ${JSON.stringify(det.standards)}`);
  assert(det.governanceProfile === 'audit_ready' && det.portfolioPriority === 'high', `v4.1 governance fields: ${JSON.stringify({ g: det.governanceProfile, p: det.portfolioPriority })}`);
  const plan = p.pricingPlans.declarative.en[0];
  assert(plan.unit === 'Pay-per-use' && plan.price === '10', `base plan should mirror the authoritative price, got ${JSON.stringify(plan)}`);
  // usage_terms: derivatives yes → Adaptation granted; resale no → not resellable; attribution → a restriction.
  assert(p.license.scope.rights.includes('Adaptation') && !p.license.scope.rights.includes('Reselling'),
    `licence rights from usage terms: ${JSON.stringify(p.license.scope.rights)}`);
  assert(String(p.license.scope.restrictions).includes('Attribution'), `attribution restriction: ${p.license.scope.restrictions}`);
  assert(p.dataHolder.legalName === 'Overscale Solutions Oy', `provider-declared data holder wins: ${JSON.stringify(p.dataHolder)}`);
  assert(p.SLA.declarative[0].dimensions.length === 2 && p.dataQuality.declarative[0].dimensions[0].dimension === 'accuracy',
    'SLA + data-quality commitments projected');
  assert(String(p.dataAccess.default.accessURL).endsWith(`/v1/ext/${EXT}/validate`) && p.dataAccess.mcp.format === 'MCP',
    `data access ports: ${JSON.stringify(Object.keys(p.dataAccess))}`);
  // v4.1: access-port and gateway labels are language maps, not bare strings.
  assert(p.dataAccess.default.name.en === 'Metered AIMEAT call', `access name should be a language map: ${JSON.stringify(p.dataAccess.default.name)}`);
  assert(p.paymentGateways.default.type === 'Custom' && String(p.paymentGateways.default.description.en).includes('Morsel'),
    `morsel-priced offering settles on the morsel meter: ${JSON.stringify(p.paymentGateways)}`);
  const x = p['x-aimeat'];
  assert(String(x.provenance.legalBasis).startsWith('Public register') && x.provenance.odpsVersion === '4.1', `x-aimeat provenance: ${JSON.stringify(x.provenance)}`);
  assert(x.capability.ext === EXT && typeof x.interface.output_schema === 'object', `x-aimeat capability + interface: ${JSON.stringify(x.capability)}`);
  assert(typeof x.observed.total_calls === 'number' && x.economics.rake_percent >= 0, `x-aimeat observed + economics: ${JSON.stringify(x.economics)}`);
});

await test('GET /odps returns the same document as JSON in the envelope; unknown offering → 404', async () => {
  const r = await json(`/v1/exchange/offerings/${odpsOfferingId}/odps`);
  assert(r.status === 200 && r.body.data.odps_version === '4.1', `odps json ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.odps.product.details.en.productID === odpsOfferingId, 'same document as JSON');
  assert(String(r.body.data.odps.schema).endsWith('odps.json'), `the JSON rendering points at the JSON schema: ${r.body.data.odps.schema}`);
  const missing = await json('/v1/exchange/offerings/off-does-not-exist/odps.yaml');
  assert(missing.status === 404, `unknown offering should 404, got ${missing.status}`);
});

await test('Offering DETAIL points at the ODPS projection (discoverable without reading docs)', async () => {
  const r = await json(`/v1/exchange/offerings/${odpsOfferingId}`);
  assert(r.status === 200 && r.body.data.odps?.version === '4.1', `detail odps pointer: ${JSON.stringify(r.body.data.odps)}`);
  assert(r.body.data.odps.url === `/v1/exchange/offerings/${odpsOfferingId}/odps.yaml`, 'detail carries the odps url');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
