/**
 * @file e2e-wallet-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Wallet page reads: GET /v1/wallet and GET /v1/wallet/overview carry a lifetime
 *   that counts every row kind (in, out, ledger_sum, unrecorded, by_type), the two doors agree, the
 *   daily-pace request credits and writes its row, and the doors refuse without a token. The
 *   lifetime had summed four legacy row kinds and said "earned 0" over a wallet that had earned 190
 *   through extension_earn rows (aimeat.io, 2026-09-04).
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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
  return { status: res.status, body };
}

const username = `wallpage${Date.now()}`;
const password = 'WallPage123!';
let jwt = '';
const auth = () => ({ Authorization: `Bearer ${jwt}` });

console.log(`\n=== Wallet page E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Register and log in', async () => {
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: 'Wallet Page', password }) });
  assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
  const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  jwt = login.body.data?.token;
  assert(typeof jwt === 'string' && jwt.length > 0, 'missing token');
});

let welcome = 0;
await test('GET /v1/wallet: the welcome bonus is received, not earned, and the ledger explains the balance', async () => {
  const { status, body } = await json('/v1/wallet', { headers: auth() });
  assert(status === 200, `wallet ${status}: ${JSON.stringify(body.error)}`);
  const w = body.data;
  const l = w.lifetime;
  welcome = Number(l.welcome_bonus) || 0;
  assert(welcome === w.balance, `a fresh wallet is its welcome bonus: balance ${w.balance}, welcome_bonus ${welcome}`);
  assert(l.earned === 0, `nothing earned yet, got ${l.earned}`);
  assert(l.in === welcome, `in counts the bonus: ${l.in}`);
  assert(l.out === 0 && l.spent === 0, `nothing out yet: out ${l.out}, spent ${l.spent}`);
  assert(l.ledger_sum === welcome, `ledger_sum is the sum of the rows: ${l.ledger_sum}`);
  assert(l.unrecorded === 0, `every morsel so far has a row: unrecorded ${l.unrecorded}`);
  assert(l.by_type?.welcome_bonus?.count === (welcome > 0 ? 1 : undefined) || welcome === 0, `by_type.welcome_bonus: ${JSON.stringify(l.by_type)}`);
  assert(l.total_rows === (welcome > 0 ? 1 : 0), `total_rows ${l.total_rows}`);
  assert(w.daily_allowance?.amount > 0 && w.daily_allowance?.accumulation_cap > 0, 'the pace and its cap are served');
});

let granted = 0;
await test('POST /v1/wallet/request credits the pace and writes its row', async () => {
  const r = await json('/v1/wallet/request', { method: 'POST', headers: auth(), body: JSON.stringify({ amount: 30 }) });
  assert(r.status === 200, `request ${r.status}: ${JSON.stringify(r.body.error)}`);
  granted = Number(r.body.data.granted) || 0;
  assert(granted === 30, `granted 30, got ${granted}`);
  const { body } = await json('/v1/wallet', { headers: auth() });
  const l = body.data.lifetime;
  assert(l.received_allowance === 30, `received_allowance 30, got ${l.received_allowance}`);
  assert(l.earned === 0, `the pace is not earnings: earned ${l.earned}`);
  assert(l.ledger_sum === welcome + 30, `ledger_sum ${l.ledger_sum}`);
  assert(l.unrecorded === 0, `the request wrote its row: unrecorded ${l.unrecorded}`);
  assert(body.data.balance === welcome + 30, `balance ${body.data.balance}`);
});

await test('GET /v1/wallet/overview carries the same lifetime as GET /v1/wallet', async () => {
  const [a, b] = await Promise.all([json('/v1/wallet', { headers: auth() }), json('/v1/wallet/overview', { headers: auth() })]);
  assert(a.status === 200 && b.status === 200, `statuses ${a.status} ${b.status}`);
  const x = a.body.data.lifetime, y = b.body.data.wallet.lifetime;
  for (const k of ['earned', 'spent', 'received_allowance', 'welcome_bonus', 'in', 'out', 'ledger_sum', 'unrecorded', 'total_rows']) {
    assert(x[k] === y[k], `${k} differs: wallet ${x[k]}, overview ${y[k]}`);
  }
  assert(b.body.data.transactions.total === x.total_rows, `overview total ${b.body.data.transactions.total} vs rows ${x.total_rows}`);
});

await test('Without a token the wallet doors refuse → 401', async () => {
  const w = await json('/v1/wallet');
  assert(w.status === 401, `wallet without a token: expected 401, got ${w.status}`);
  const o = await json('/v1/wallet/overview');
  assert(o.status === 401, `overview without a token: expected 401, got ${o.status}`);
  const r = await json('/v1/wallet/request', { method: 'POST', body: JSON.stringify({ amount: 10 }) });
  assert(r.status === 401, `request without a token: expected 401, got ${r.status}`);
});

await test('Another owner reads their own wallet, never this one', async () => {
  const other = `wallother${Date.now()}`;
  await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'Other', password }) });
  const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: other, password }) });
  const { body } = await json('/v1/wallet', { headers: { Authorization: `Bearer ${login.body.data.token}` } });
  assert(body.data.gaii.startsWith(other + '@'), `the wallet answers for the caller: ${body.data.gaii}`);
  assert(body.data.lifetime.received_allowance === 0, 'the other owner has not received this owner\'s pace');
});

await test('The beneficiary split list answers 200 for an owner with no splits', async () => {
  const { status, body } = await json('/v1/commerce/beneficiary-splits', { headers: auth() });
  assert(status === 200, `splits ${status}: ${JSON.stringify(body.error)}`);
  assert(Array.isArray(body.data.splits) && body.data.count === 0, `an empty list: ${JSON.stringify(body.data)}`);
});

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
