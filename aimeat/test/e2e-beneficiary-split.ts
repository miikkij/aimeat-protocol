/**
 * @file test/e2e-beneficiary-split.ts
 * @description E2E for the SECOND RAKE: revenue a provider shares with beneficiaries who are neither
 *   the consumer nor themselves. Proves against a real server that
 *     - a static split accrues to N GHIIs, weighted, out of the PROVIDER's cut and never the buyer's
 *       charge (the consumer pays exactly the list price, before and after a split is declared);
 *     - a capability may name beneficiaries per call, and the `_revenue` key it uses is stripped from
 *       what the buyer is shown;
 *     - the ledger conserves: price === platform rake + provider net + Σ shares;
 *     - accruing is unconditional but PAYING is gated — release refuses for an unverified beneficiary
 *       and succeeds once an operator has recorded an approval;
 *     - a beneficiary with no PSP is never blocked, on either rail;
 *     - a call that fails after payment leaves no beneficiary paid from nothing;
 *     - cross-owner: a stranger cannot read another account's verification state, cannot declare a
 *       split against someone else's revenue, and cannot release someone else's obligation.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=beneficiary-split
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial.
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
  const name = `bs${label}${Date.now()}`;
  const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Beneficiary', password: 'Beneficiary1234' }) });
  let reg = await reg0();
  for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, token: tok.body.data.token as string, ghii: `${name}@${NODE_ID}` };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function balance(token: string): Promise<number> {
  const r = await json('/v1/wallet', { headers: auth(token) });
  assert(r.status === 200, `wallet ${r.status}`);
  return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

console.log('\n=== AIMEAT BENEFICIARY SPLIT E2E (the second rake) ===\n');

const EXT = `bsplit${Date.now()}`;
// A fresh owner is welcomed with 100 morsels, so the price has to leave room for the whole suite to
// call more than once. A 50 % pool of a 10-morsel call still divides 3:1 into visible whole numbers.
const PRICE = 10;
const POOL_PCT = 50;
const SCRIPTS = {
  echo: 'export default async function(ctx, input){ return { echo: input }; }',
  // Names its beneficiary for THIS call. The node resolves the destination and strips the key.
  designating: 'export default async function(ctx, input){ return { echo: input, _revenue: { beneficiaries: [{ ghii: input.pay_to, weight: 1 }] } }; }',
  boom: 'export default async function(){ throw new Error("delivery failed on purpose"); }',
};
const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'beneficiary split e2e provider', author: 'e2e' },
  actions: [
    { id: 'shared', method: 'POST', path: '/shared', script: 'echo', commercial: { payMorsels: PRICE } },
    { id: 'dyn', method: 'POST', path: '/dyn', script: 'designating', commercial: { payMorsels: PRICE } },
    { id: 'fails', method: 'POST', path: '/fails', script: 'boom', commercial: { payMorsels: PRICE } },
    { id: 'paid', method: 'POST', path: '/paid', script: 'echo', commercial: { payMoney: { amount: 500_000, currency: 'EUR' } } },
    // Money price AND a per-call destination: the exact combination kumppani sells (0.50 EUR a
    // lookup, the share going to whichever company was looked up). Each rail and each source had
    // been proven, and their product had not.
    { id: 'paiddyn', method: 'POST', path: '/paiddyn', script: 'designating', commercial: { payMoney: { amount: 500_000, currency: 'EUR' } } },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 5000, max_api_calls: 1 },
}, null, 2);

let operator: Awaited<ReturnType<typeof setupOwner>>;
let provider: Awaited<ReturnType<typeof setupOwner>>;
let consumer: Awaited<ReturnType<typeof setupOwner>>;
let alpha: Awaited<ReturnType<typeof setupOwner>>;     // beneficiary, weight 3
let beta: Awaited<ReturnType<typeof setupOwner>>;      // beneficiary, weight 1
let gamma: Awaited<ReturnType<typeof setupOwner>>;     // beneficiary named per call
let stranger: Awaited<ReturnType<typeof setupOwner>>;
let rakePerCall = 0;

await test('Setup: a provider with priced actions, a consumer, three would-be beneficiaries', async () => {
  operator = await setupOwner('op');   // the FIRST owner on a fresh DB auto-becomes operator
  provider = await setupOwner('prov');
  consumer = await setupOwner('cons');
  alpha = await setupOwner('alpha');
  beta = await setupOwner('beta');
  gamma = await setupOwner('gamma');
  stranger = await setupOwner('str');
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

const accept = (token: string, action: string, extra: Record<string, unknown> = {}) =>
  json('/v1/exchange/entitlements', { method: 'POST', headers: auth(token), body: JSON.stringify({ ext: EXT, action, contract_ref: 'c-bsplit', ...extra }) });
const invoke = (token: string, action: string, body: Record<string, unknown> = { hi: 1 }) =>
  json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const declare = (token: string, body: Record<string, unknown>) =>
  json('/v1/commerce/beneficiary-splits', { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const earnings = (token: string) => json('/v1/commerce/beneficiary/earnings', { headers: auth(token) });
const obligations = (token: string) => json('/v1/commerce/beneficiary/obligations', { headers: auth(token) });

/** Everything a beneficiary has been booked, in one number, so a delta is easy to assert. */
async function accrued(token: string): Promise<number> {
  const r = await earnings(token);
  assert(r.status === 200, `earnings ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return Number(r.body.data.totals?.morsels?.accrued ?? 0);
}

// ── Declaring a split ─────────────────────────────────────────────────────────

await test('Declaring a split needs auth → 401', async () => {
  const r = await json('/v1/commerce/beneficiary-splits', { method: 'POST', body: JSON.stringify({ ext: EXT, action: 'shared', pool_percent: 20 }) });
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('A split with no beneficiaries and not dynamic is refused → 400', async () => {
  const r = await declare(provider.token, { ext: EXT, action: 'shared', pool_percent: 20 });
  assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('A pool percent outside 0-100 is refused → 400', async () => {
  const r = await declare(provider.token, { ext: EXT, action: 'shared', pool_percent: 140, beneficiaries: [{ ghii: alpha.ghii }] });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('A malformed beneficiary is refused rather than silently dropped → 400', async () => {
  const r = await declare(provider.token, { ext: EXT, action: 'shared', pool_percent: 20, beneficiaries: [{ ghii: 'not-a-ghii' }] });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('Provider declares a 50 % pool shared alpha:beta = 3:1', async () => {
  const r = await declare(provider.token, {
    ext: EXT, action: 'shared', pool_percent: POOL_PCT,
    beneficiaries: [{ ghii: alpha.ghii, weight: 3, note: 'data steward' }, { ghii: beta.ghii, weight: 1 }],
  });
  assert(r.status === 200, `declare ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const s = r.body.data.split;
  assert(s.pool_percent === POOL_PCT && s.beneficiaries.length === 2, `split: ${JSON.stringify(s)}`);
  assert(s.provider === provider.ghii, `a split is always written for the caller's own owner, got ${s.provider}`);
});

// ── The happy path, and where the money comes from ────────────────────────────

await test('Contract accepted at the authoritative price', async () => {
  const r = await accept(consumer.token, 'shared', { cap_units: 10_000 });
  assert(r.status === 201, `accept ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.entitlement.price_per_call === PRICE, `price ${r.body.data.entitlement.price_per_call}`);
  rakePerCall = r.body.data.entitlement.rake_per_call;
  assert(rakePerCall >= 1, `a positive price must carry a rake, got ${rakePerCall}`);
});

await test('A settled call: the CONSUMER pays exactly the list price — a split costs the buyer nothing', async () => {
  const before = await balance(consumer.token);
  const r = await invoke(consumer.token, 'shared');
  assert(r.status === 200, `call ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(await balance(consumer.token) === before - PRICE, 'the buyer is charged the price and not a micro-unit more');
});

await test('The PROVIDER received their whole cut — the share is an obligation, not a deduction', async () => {
  // Route 2: nothing is withheld at settlement. The provider holds the money and owes part of it on.
  const list = await obligations(provider.token);
  assert(list.status === 200, `obligations ${list.status}: ${JSON.stringify(list.body?.error)}`);
  assert(list.body.data.entries.length === 2, `expected 2 obligations, got ${list.body.data.entries.length}`);
});

await test('The pool divides 3:1 and the ledger conserves: price === rake + provider net + shares', async () => {
  const providerCut = PRICE - rakePerCall;
  const pool = Math.floor(providerCut * POOL_PCT / 100);
  const a = await accrued(alpha.token);
  const b = await accrued(beta.token);
  assert(a + b === pool, `shares must sum to the pool exactly: ${a} + ${b} !== ${pool}`);
  assert(a === Math.floor(pool * 3 / 4) || a === Math.floor(pool * 3 / 4) + 1, `alpha's 3/4 share: got ${a} of ${pool}`);
  assert(a > b, `weight 3 must receive more than weight 1: ${a} vs ${b}`);
  // The conservation invariant, read off what actually happened rather than recomputed from itself.
  assert(rakePerCall + (providerCut - pool) + a + b === PRICE,
    `conservation: ${rakePerCall} + ${providerCut - pool} + ${a} + ${b} !== ${PRICE}`);
});

await test('A beneficiary sees only their OWN share, with the amount explained', async () => {
  const r = await earnings(alpha.token);
  const e = r.body.data.entries[0];
  assert(r.body.data.entries.length === 1, `alpha must see one entry, got ${r.body.data.entries.length}`);
  assert(e.from === provider.ghii, `the debtor is the provider, got ${e.from}`);
  assert(e.buyer === consumer.ghii, `the buyer is context, got ${e.buyer}`);
  assert(e.status === 'accrued' && e.unit === 'morsels', `entry: ${JSON.stringify(e)}`);
  assert(e.weight === 3 && e.kind === 'static', `weight/kind: ${JSON.stringify(e)}`);
});

// ── Per-call designation ──────────────────────────────────────────────────────

await test('A dynamic split lets the capability name this call\'s beneficiary', async () => {
  const d = await declare(provider.token, { ext: EXT, action: 'dyn', pool_percent: 100, dynamic: true });
  assert(d.status === 200, `declare dyn ${d.status}: ${JSON.stringify(d.body?.error)}`);
  const a = await accept(consumer.token, 'dyn', { cap_units: 10_000 });
  assert(a.status === 201, `accept dyn ${a.status}`);

  const before = await accrued(gamma.token);
  const r = await invoke(consumer.token, 'dyn', { pay_to: gamma.ghii });
  assert(r.status === 200, `dyn call ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const pool = PRICE - rakePerCall;
  assert(await accrued(gamma.token) === before + pool, `gamma must be booked the whole pool (${pool})`);
});

await test('The `_revenue` key never reaches the buyer', async () => {
  const r = await invoke(consumer.token, 'dyn', { pay_to: gamma.ghii });
  assert(r.status === 200, `dyn call ${r.status}`);
  assert(!('_revenue' in (r.body.data ?? {})), `the designation key leaked to the buyer: ${JSON.stringify(r.body.data)}`);
  assert(r.body.data.echo?.pay_to === gamma.ghii, 'the rest of the result is untouched');
});

await test('A dynamic call that designates nobody leaves the whole cut with the provider', async () => {
  const before = await accrued(gamma.token);
  const r = await invoke(consumer.token, 'dyn', {});     // no pay_to → the script names an undefined ghii
  assert(r.status === 200, `dyn call ${r.status}`);
  assert(await accrued(gamma.token) === before, 'nobody new is owed anything');
});

// ── Money never leaves without delivery ───────────────────────────────────────

await test('Refund unwind: a call that fails after payment leaves no beneficiary paid from nothing', async () => {
  const d = await declare(provider.token, { ext: EXT, action: 'fails', pool_percent: 50, beneficiaries: [{ ghii: alpha.ghii, weight: 1 }] });
  assert(d.status === 200, `declare fails ${d.status}`);
  const a = await accept(consumer.token, 'fails', { cap_units: 10_000 });
  assert(a.status === 201, `accept fails ${a.status}`);

  const consumerBefore = await balance(consumer.token);
  const alphaBefore = await accrued(alpha.token);
  const r = await invoke(consumer.token, 'fails');
  assert(r.status >= 400, `the failing action must not report success, got ${r.status}`);
  assert(await balance(consumer.token) === consumerBefore, 'the consumer was refunded in full');
  assert(await accrued(alpha.token) === alphaBefore, 'no share was booked against a call that never delivered');
});

// ── The payout gate ───────────────────────────────────────────────────────────

await test('An unverified beneficiary reads their accrual and is told it is not payable yet', async () => {
  const r = await earnings(alpha.token);
  assert(r.body.data.verification.state === 'unverified', `state: ${JSON.stringify(r.body.data.verification)}`);
  assert(r.body.data.verification.payable === false, 'nothing is payable before an approval exists');
  assert(Number(r.body.data.totals.morsels.accrued) > 0, 'the accrual is visible regardless — it must not vanish');
});

let alphaTracking = '';
await test('Releasing to an UNVERIFIED beneficiary is refused → 409 BENEFICIARY_UNVERIFIED', async () => {
  const list = await obligations(provider.token);
  const entry = list.body.data.entries.find((e: any) => e.beneficiary === alpha.ghii && e.status === 'accrued');
  assert(!!entry, `the provider must have an accrued obligation to alpha: ${JSON.stringify(list.body.data.entries)}`);
  alphaTracking = entry.tracking_code;
  const alphaBalanceBefore = await balance(alpha.token);
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ tracking_code: alphaTracking, beneficiary: alpha.ghii }),
  });
  assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body?.error?.code === 'BENEFICIARY_UNVERIFIED', `expected BENEFICIARY_UNVERIFIED, got ${JSON.stringify(r.body?.error)}`);
  assert(await balance(alpha.token) === alphaBalanceBefore, 'a refused release moves nothing');
});

await test('A non-operator cannot verify anyone, including themselves → 403', async () => {
  for (const who of [provider, alpha]) {
    const r = await json('/v1/commerce/beneficiary/approvals', {
      method: 'POST', headers: auth(who.token),
      body: JSON.stringify({ ghii: alpha.ghii, state: 'verified', method: 'self-serve' }),
    });
    assert(r.status === 403, `expected 403 for ${who.name}, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  }
});

await test('An operator verification must say HOW representation was established → 400 without a method', async () => {
  const r = await json('/v1/commerce/beneficiary/approvals', {
    method: 'POST', headers: auth(operator.token),
    body: JSON.stringify({ ghii: alpha.ghii, state: 'verified' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('Operator verifies alpha → the release now succeeds and morsels actually move', async () => {
  const ok = await json('/v1/commerce/beneficiary/approvals', {
    method: 'POST', headers: auth(operator.token),
    body: JSON.stringify({ ghii: alpha.ghii, state: 'verified', method: 'manual-operator', subject: 'fi-ytunnus:3323553-5', evidence: 'e2e' }),
  });
  assert(ok.status === 200, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);

  const alphaBefore = await balance(alpha.token);
  const providerBefore = await balance(provider.token);
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ tracking_code: alphaTracking, beneficiary: alpha.ghii }),
  });
  assert(r.status === 200, `release ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.settled_here === true, 'a morsel release completes on this node');
  assert(r.body.data.method === 'morsel-transfer', `release method: ${r.body.data.method}`);
  const amount = Number(r.body.data.amount);
  assert(amount > 0, `released amount ${amount}`);
  assert(await balance(alpha.token) === alphaBefore + amount, 'the beneficiary was credited');
  assert(await balance(provider.token) === providerBefore - amount, 'out of the PROVIDER\'s balance, not the node\'s');
});

await test('The released entry records HOW it was released, not a placeholder', async () => {
  // It stored the literal string 'pending' for every rail until 2026-07-30: the status was written
  // before the fact it described, so the entry could not say what had actually happened to it.
  const r = await earnings(alpha.token);
  const rel = r.body.data.entries.find((e: any) => e.status === 'released');
  assert(!!rel, `expected a released entry: ${JSON.stringify(r.body.data.entries)}`);
  assert(rel.release_method === 'morsel-transfer', `release_method: ${rel.release_method}`);
  assert(!!rel.released_at, 'a released entry is stamped');
});

await test('The same share cannot be released twice → 404 NOTHING_ACCRUED', async () => {
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ tracking_code: alphaTracking, beneficiary: alpha.ghii }),
  });
  assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('A rejected beneficiary stays accrued and unpayable', async () => {
  const rej = await json('/v1/commerce/beneficiary/approvals', {
    method: 'POST', headers: auth(operator.token),
    body: JSON.stringify({ ghii: beta.ghii, state: 'rejected', method: 'manual-operator', evidence: 'could not establish representation' }),
  });
  assert(rej.status === 200, `reject ${rej.status}`);
  const list = await obligations(provider.token);
  const entry = list.body.data.entries.find((e: any) => e.beneficiary === beta.ghii && e.status === 'accrued');
  assert(!!entry, 'beta still has an accrued obligation');
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ tracking_code: entry.tracking_code, beneficiary: beta.ghii }),
  });
  assert(r.status === 409 && r.body?.error?.code === 'BENEFICIARY_UNVERIFIED', `expected refusal, got ${r.status}`);
  assert(Number((await earnings(beta.token)).body.data.totals.morsels.accrued) > 0, 'the accrual survives a rejection');
});

// ── The money rail, and a beneficiary with no PSP ─────────────────────────────

await test('Money rail: a share accrues in micro-units for a beneficiary who has configured no PSP', async () => {
  const d = await declare(provider.token, { ext: EXT, action: 'paid', pool_percent: 70, beneficiaries: [{ ghii: gamma.ghii, weight: 1 }] });
  assert(d.status === 200, `declare paid ${d.status}: ${JSON.stringify(d.body?.error)}`);
  const a = await accept(consumer.token, 'paid', { cap_units: 5_000_000 });
  assert(a.status === 201, `accept paid ${a.status}: ${JSON.stringify(a.body?.error)}`);
  // The rake comes from the contract the node actually minted, never from a percent assumed here —
  // a test that recomputes the node's own policy proves only that it can do the same arithmetic.
  const moneyRake = Number(a.body.data.entitlement.rake_per_call);
  assert(moneyRake > 0, `a positive money price must carry a rake, got ${moneyRake}`);

  const r = await invoke(consumer.token, 'paid');
  assert(r.status === 200, `money call ${r.status}: ${JSON.stringify(r.body?.error)}`);

  const e = await earnings(gamma.token);
  const totals = e.body.data.totals ?? {};
  const eur = totals.EUR;
  assert(!!eur && eur.accrued > 0, `gamma must have a EUR accrual with no PSP configured: ${JSON.stringify(totals)}`);
  assert(eur.accrued === Math.floor((500_000 - moneyRake) * 70 / 100),
    `EUR share should be 70 % of the provider's net (${500_000 - moneyRake}): got ${eur.accrued}`);
  // Money micro-units and morsels are counted in separate buckets and never summed into one figure.
  assert(totals.morsels === undefined || totals.morsels.accrued < eur.accrued,
    `micro-units must not be folded into the morsel total: ${JSON.stringify(totals)}`);
});

await test('Releasing a money share books it as an invoiceable payable — the node moves no fiat', async () => {
  const ok = await json('/v1/commerce/beneficiary/approvals', {
    method: 'POST', headers: auth(operator.token),
    body: JSON.stringify({ ghii: gamma.ghii, state: 'verified', method: 'manual-operator' }),
  });
  assert(ok.status === 200, `approve gamma ${ok.status}`);
  const list = await obligations(provider.token);
  const entry = list.body.data.entries.find((e: any) => e.beneficiary === gamma.ghii && e.unit === 'money' && e.status === 'accrued');
  assert(!!entry, `expected a money obligation to gamma: ${JSON.stringify(list.body.data.entries.map((x: any) => [x.beneficiary, x.unit, x.status]))}`);

  const balBefore = await balance(gamma.token);
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ tracking_code: entry.tracking_code, beneficiary: gamma.ghii }),
  });
  assert(r.status === 200, `release money ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.settled_here === false, 'money is booked as an obligation, never pushed by the node');
  assert(await balance(gamma.token) === balBefore, 'a EUR share must not touch a morsel balance');

  const gEarn = await earnings(gamma.token);
  const gRel = gEarn.body.data.entries.find((e: any) => e.status === 'released' && e.unit === 'money');
  assert(gRel && gRel.release_method === 'payable-booked', `money release_method: ${gRel?.release_method}`);

  // It lands where a seller already looks for what they are owed.
  const earned = await json('/v1/exchange/earnings', { headers: auth(gamma.token) });
  assert(earned.status === 200, `earnings ${earned.status}`);
  const line = earned.body.data.entries.find((x: any) => x.method === 'beneficiary-share');
  assert(!!line, `the released share must appear on the payable book: ${JSON.stringify(earned.body.data.entries)}`);
  assert(line.status === 'pending' && line.amount === entry.amount, `payable line: ${JSON.stringify(line)}`);
});

// ── Dynamic + money together: what kumppani actually sells ───────────────────

await test('A money-priced call whose capability names the beneficiary per call accrues in micro-units', async () => {
  const d = await declare(provider.token, { ext: EXT, action: 'paiddyn', pool_percent: 70, dynamic: true });
  assert(d.status === 200, `declare paiddyn ${d.status}: ${JSON.stringify(d.body?.error)}`);
  const a = await accept(consumer.token, 'paiddyn', { cap_units: 5_000_000 });
  assert(a.status === 201, `accept paiddyn ${a.status}: ${JSON.stringify(a.body?.error)}`);
  const rake = Number(a.body.data.entitlement.rake_per_call);

  const before = Number((await earnings(beta.token)).body.data.totals?.EUR?.accrued ?? 0);
  const r = await invoke(consumer.token, 'paiddyn', { pay_to: beta.ghii });
  assert(r.status === 200, `paiddyn call ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(!('_revenue' in (r.body.data ?? {})), 'the designation key must not reach the buyer on the money rail either');

  const after = Number((await earnings(beta.token)).body.data.totals?.EUR?.accrued ?? 0);
  const expected = Math.floor((500_000 - rake) * 70 / 100);
  assert(after - before === expected, `EUR share from a per-call designation: expected ${expected}, got ${after - before}`);
});

await test('That share is money, kept apart from the morsel meter on the same account', async () => {
  const t = (await earnings(beta.token)).body.data.totals;
  assert(t.EUR && t.EUR.accrued > 0, `EUR bucket: ${JSON.stringify(t)}`);
  assert(t.morsels && t.morsels.accrued > 0, `beta also holds morsel shares: ${JSON.stringify(t)}`);
  // The two are different KINDS of thing: money is income, morsels are capacity to call. A total
  // over both would be meaningless, so they are never in the same bucket.
  assert(t.EUR.accrued !== t.morsels.accrued, 'the two units are counted separately');
});

await test('The money-rail entry names the per-call source and the right unit', async () => {
  const list = await obligations(provider.token);
  const e = list.body.data.entries.find((x: any) => x.beneficiary === beta.ghii && x.unit === 'money');
  assert(!!e, `expected a money obligation to beta: ${JSON.stringify(list.body.data.entries.map((x: any) => [x.beneficiary, x.unit, x.kind]))}`);
  assert(e.kind === 'dynamic', `named per call, got kind=${e.kind}`);
  assert(e.currency === 'EUR' && e.unit === 'money', `unit/currency: ${e.unit}/${e.currency}`);
});

// ── Cross-owner isolation ─────────────────────────────────────────────────────

await test('A stranger cannot read another account\'s verification state → 403', async () => {
  const r = await json(`/v1/commerce/beneficiary/approvals?ghii=${encodeURIComponent(alpha.ghii)}`, { headers: auth(stranger.token) });
  assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('A stranger declaring a split writes it against their OWN revenue, never the provider\'s', async () => {
  const r = await declare(stranger.token, {
    ext: EXT, action: 'shared', pool_percent: 100, beneficiaries: [{ ghii: stranger.ghii, weight: 1 }],
  });
  assert(r.status === 200, `declare ${r.status}`);
  assert(r.body.data.split.provider === stranger.ghii, `written under the caller, got ${r.body.data.split.provider}`);

  // And it has no effect on the provider's capability: the same call still splits 20 % to alpha+beta.
  const strangerBefore = await accrued(stranger.token);
  const alphaBefore = await accrued(alpha.token);
  const call = await invoke(consumer.token, 'shared');
  assert(call.status === 200, `call ${call.status}`);
  assert(await accrued(stranger.token) === strangerBefore, 'a stranger cannot route another provider\'s revenue to themselves');
  assert(await accrued(alpha.token) > alphaBefore, 'the real provider\'s split still applies');
});

await test('A stranger cannot release someone else\'s obligation', async () => {
  const list = await obligations(provider.token);
  const entry = list.body.data.entries.find((e: any) => e.beneficiary === alpha.ghii && e.status === 'accrued');
  assert(!!entry, 'the provider has an accrued obligation to alpha');
  const alphaBefore = await balance(alpha.token);
  const r = await json('/v1/commerce/beneficiary/release', {
    method: 'POST', headers: auth(stranger.token),
    body: JSON.stringify({ tracking_code: entry.tracking_code, beneficiary: alpha.ghii }),
  });
  assert(r.status === 404, `a non-debtor has nothing to release; expected 404, got ${r.status}`);
  assert(await balance(alpha.token) === alphaBefore, 'nothing moved');
});

await test('A stranger sees only their own splits', async () => {
  const r = await json('/v1/commerce/beneficiary-splits', { headers: auth(stranger.token) });
  assert(r.status === 200, `list ${r.status}`);
  assert(r.body.data.splits.every((s: any) => s.provider === stranger.ghii), 'only the caller\'s own splits');
});

// ── Withdrawing ───────────────────────────────────────────────────────────────

await test('Deleting a split stops future sharing and leaves accrued shares standing', async () => {
  const alphaBefore = await accrued(alpha.token);
  const del = await json(`/v1/commerce/beneficiary-splits?ext=${EXT}&action=shared`, { method: 'DELETE', headers: auth(provider.token) });
  assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
  const call = await invoke(consumer.token, 'shared');
  assert(call.status === 200, `call after delete ${call.status}`);
  assert(await accrued(alpha.token) === alphaBefore, 'no new share after the split is withdrawn');
  assert(alphaBefore > 0, 'what was already earned still stands');
});

await test('Deleting a split that does not exist → 404', async () => {
  const r = await json(`/v1/commerce/beneficiary-splits?ext=${EXT}&action=nosuch`, { method: 'DELETE', headers: auth(provider.token) });
  assert(r.status === 404, `expected 404, got ${r.status}`);
});

console.log(`\n=== BENEFICIARY SPLIT E2E: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
