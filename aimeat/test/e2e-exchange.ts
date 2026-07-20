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
    { id: 'validate', method: 'POST', path: '/validate', script: 'echo', commercial: { payMorsels: 10 } },
    { id: 'cheap', method: 'POST', path: '/cheap', script: 'echo', commercial: { payMorsels: 4 } },
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
let appId = '';
let rakePerCall = 0;

await test('Setup: provider installs a morsel-priced extension; consumer registered', async () => {
  await setupOwner('neutral'); // absorb any first-owner operator self-heal on a fresh DB
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
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
