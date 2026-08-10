/**
 * @file test/e2e-ext-paywall.ts
 * @description E2E for the priced raw-call paywall (design notes doc-r6tyr3o, roadmap
 *   rm-commercial-raw-calls). Proves the runtime invariants of routes/extensions/paywall.ts:
 *   owner-free (both direct paths); cross-owner morsel payment is REVENUE (atomic debit-caller +
 *   credit-owner, M1); anti-abuse `tollMorsels` BURNS (debits caller, never credits owner — M1);
 *   money channel → 402 (Phase 3 pending); insufficient balance → 402 with no partial debit;
 *   free (non-commercial) public call; refund-on-throw; and install-time C1/no-mint validation.
 * @usage cd aimeat && AIMEAT_EXTENSIONS_ENABLED=true pnpm exec tsx test/e2e-ext-paywall.ts
 * @version-history
 *   v1.1.0 — 2026-08-10 — The unaffordable action is priced at 9 999 rather than 10 million. What
 *     the test needs is a price above the welcome bonus (100), and the node now caps manifest prices.
 *   v1.0.0 — 2026-07-17 — Initial (Phase 4 — morsel paywall runtime proof)
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
  const name = `pw${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Paywall', password: 'Paywall1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Paywall', password: 'Paywall1234' }) }); }
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

console.log('\n=== AIMEAT Extension Paywall E2E (rm-commercial-raw-calls) ===\n');

const EXT = `paywall${Date.now()}`;
const SCRIPTS = {
  echo: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }',
  boom: 'export default async function(ctx, input){ throw new Error("boom after payment"); }',
};
const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'paywall e2e', author: 'e2e' },
  actions: [
    { id: 'freecall', method: 'POST', path: '/freecall', script: 'echo' },
    { id: 'paidcall', method: 'POST', path: '/paidcall', script: 'echo', commercial: { payMorsels: 5 } },
    { id: 'tollcall', method: 'POST', path: '/tollcall', script: 'echo', tollMorsels: 2 },
    { id: 'moneycall', method: 'POST', path: '/moneycall', script: 'echo', commercial: { payMoney: { amount: 500000, currency: 'EUR' } } },
    // Priced far above a welcome bonus (100) to prove the insufficient-balance 402, but under
    // the node's manifest price ceiling — the point is that the caller cannot afford it, not that
    // the number is astronomical.
    { id: 'expensivecall', method: 'POST', path: '/expensivecall', script: 'echo', commercial: { payMorsels: 9_999 } },
    { id: 'paidthrow', method: 'POST', path: '/paidthrow', script: 'boom', commercial: { payMorsels: 3 } },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 5000, max_api_calls: 1 },
}, null, 2);

let owner: Awaited<ReturnType<typeof setupOwner>>;
let caller: Awaited<ReturnType<typeof setupOwner>>;

await test('Setup: two owners; owner installs + activates the priced extension', async () => {
  await setupOwner('neutral'); // absorb any first-owner operator self-heal on a fresh DB
  owner = await setupOwner('own');
  caller = await setupOwner('call');
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

const invoke = (token: string, action: string) =>
  json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ hi: 1 }) });

await test('Owner calls a PAID action free (owner-free, no charge)', async () => {
  const before = await balance(owner.token);
  const r = await invoke(owner.token, 'paidcall');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(await balance(owner.token) === before, 'owner must not be charged for their own tool');
});

await test('Cross-owner PAID call = revenue: caller debited, owner credited (atomic, M1)', async () => {
  const cb = await balance(caller.token);
  const ob = await balance(owner.token);
  const r = await invoke(caller.token, 'paidcall');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(await balance(caller.token) === cb - 5, 'caller debited 5');
  assert(await balance(owner.token) === ob + 5, 'owner credited 5 (revenue)');
});

await test('Cross-owner TOLL burns: caller debited, owner UNCHANGED (M1 — toll is not revenue)', async () => {
  const cb = await balance(caller.token);
  const ob = await balance(owner.token);
  const r = await invoke(caller.token, 'tollcall');
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(await balance(caller.token) === cb - 2, 'caller debited the 2-morsel toll');
  assert(await balance(owner.token) === ob, 'owner NOT credited — toll is a burn, not revenue');
});

await test('Owner is free of toll too', async () => {
  const before = await balance(owner.token);
  const r = await invoke(owner.token, 'tollcall');
  assert(r.status === 200, `status ${r.status}`);
  assert(await balance(owner.token) === before, 'owner pays no toll');
});

await test('Money call WITHOUT a pay token → 402, no morsels moved', async () => {
  const cb = await balance(caller.token);
  const r = await invoke(caller.token, 'moneycall');
  assert(r.status === 402, `expected 402, got ${r.status}`);
  assert(await balance(caller.token) === cb, 'no morsels moved on a money 402');
});

// Money rail detection: EE Stripe in prod, or the AIMEAT_TEST_MONEY_HANDLER double in E2E.
let moneyEnabled = false;
try {
  const ucp = await fetch(`${BASE}/.well-known/ucp`).then((r) => r.json()) as any;
  moneyEnabled = (ucp.ucp?.payment_handlers || []).some((h: any) =>
    Array.isArray(h.currencies) ? h.currencies.includes('EUR') : String(h.id) !== 'io.aimeat.morsels');
} catch { /* leave false */ }

if (!moneyEnabled) {
  console.log('  ⏭  money-token chain skipped — no EUR handler (set AIMEAT_TEST_MONEY_HANDLER=true, or EE Stripe in prod)');
} else {
  let payToken = '';
  await test('Money chain: settle ext-call checkout (EUR) → one-time token minted', async () => {
    const open = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: auth(caller.token),
      body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'ext-call', app: EXT, tool: 'moneycall' }] }) });
    assert(open.status === 201, `open ${open.status}: ${JSON.stringify(open.body?.error)}`);
    const s = open.body.data.session;
    assert(s.total === 500000 && s.currency === 'EUR', `quote: ${JSON.stringify(s)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${s.id}/complete`, { method: 'POST', headers: auth(caller.token), body: JSON.stringify({ payment: { handler: 'test.money' } }) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
    payToken = done.body.data.session.fulfillment?.results?.[0]?.result?.pay_token;
    assert(typeof payToken === 'string' && payToken.length > 0, `no pay_token: ${JSON.stringify(done.body.data.session.fulfillment)}`);
  });

  await test('Money chain: retry the raw call WITH the token → 200 (money off-ledger, morsels unchanged)', async () => {
    const cb = await balance(caller.token);
    const r = await json(`/v1/ext/${EXT}/moneycall`, { method: 'POST', headers: { ...auth(caller.token), 'x-aimeat-pay-token': payToken }, body: JSON.stringify({ hi: 1 }) });
    assert(r.status === 200, `expected 200 with token, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await balance(caller.token) === cb, 'money settles off-ledger — morsels unchanged');
  });

  await test('Money chain: REPLAY the same token → 402 (single-use)', async () => {
    const r = await json(`/v1/ext/${EXT}/moneycall`, { method: 'POST', headers: { ...auth(caller.token), 'x-aimeat-pay-token': payToken }, body: JSON.stringify({ hi: 1 }) });
    assert(r.status === 402, `expected 402 on replay, got ${r.status}`);
  });
}

await test('Insufficient morsels → 402 with NO partial debit', async () => {
  const cb = await balance(caller.token);
  const r = await invoke(caller.token, 'expensivecall');
  assert(r.status === 402, `expected 402, got ${r.status}`);
  assert(await balance(caller.token) === cb, 'balance untouched when payment cannot be collected');
});

await test('Free (non-commercial) public call: anyone, no charge', async () => {
  const cb = await balance(caller.token);
  const r = await invoke(caller.token, 'freecall');
  assert(r.status === 200, `status ${r.status}`);
  assert(await balance(caller.token) === cb, 'free call charges nothing');
});

await test('Refund-on-throw: paid action whose script throws refunds the caller', async () => {
  const cb = await balance(caller.token);
  const ob = await balance(owner.token);
  const r = await invoke(caller.token, 'paidthrow');
  assert(r.status === 500, `expected 500, got ${r.status}`);
  assert(await balance(caller.token) === cb, 'caller refunded after the script threw');
  assert(await balance(owner.token) === ob, 'owner not left holding revenue for an undelivered call');
});

await test('Install validation: commercial:{} (C1) and payMorsels:-1 rejected 400', async () => {
  const bad1 = JSON.stringify({ metadata: { name: `${EXT}c1`, version: '1.0.0', description: 'x', author: 'e2e' },
    actions: [{ id: 'a', method: 'POST', path: '/a', script: 'echo', commercial: {} }], limits: {} }, null, 2);
  const r1 = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: bad1, scripts: { echo: SCRIPTS.echo } }) });
  assert(r1.status === 400, `C1 should reject, got ${r1.status}`);
  const bad2 = JSON.stringify({ metadata: { name: `${EXT}neg`, version: '1.0.0', description: 'x', author: 'e2e' },
    actions: [{ id: 'a', method: 'POST', path: '/a', script: 'echo', commercial: { payMorsels: -1 } }], limits: {} }, null, 2);
  const r2 = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: bad2, scripts: { echo: SCRIPTS.echo } }) });
  assert(r2.status === 400, `negative payMorsels should reject, got ${r2.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
