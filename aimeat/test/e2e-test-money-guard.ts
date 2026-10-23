/**
 * @file test/e2e-test-money-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The test-only money handler (`test.money`) works on any node while
 *   AIMEAT_TEST_MONEY_HANDLER=true, and a public node warns about it. Self-spawns three nodes. The
 *   first is configured like production (a public URL that is not a loopback address) with the flag
 *   on: it advertises test.money, a EUR checkout settles through it, a EUR hold is authorized through
 *   it, and the operator's Security page shows the flag as critical with the sentence that any buyer
 *   can complete a money checkout without paying. The second has the same public URL with the flag
 *   off: test.money is not registered and the Security page has no finding. The third has a loopback
 *   URL, the way the E2E runner and `pnpm sandbox` start a node: test.money works and nothing warns.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=test-money-guard
 * @version-history
 *   v2.0.1 — 2026-10-23 — owner() uses setupOperator (a password and the password sign-in); POST
 *     /v1/admin/setup/token answers 410 from 4.0.0 (secaudit2026oct22).
 *   2026-10-16 —The node(s) this suite starts follow the run's backend (test/helpers/own-node-db.ts); they were SQLite on both runs (QA audit P1-02).
 *   v2.0.0 — 2026-10-13 — Ruling decision-testiraha-toimii-julkisella-nodella-kun-operaattori-kytkee-s:
 *     the flag works on a public node so the money path can be tested in production; the public
 *     node's Security page keeps it critical. A node with the flag off is the negative control.
 *   v1.0.0 — 2026-10-11 — aimeat.io listed test.money at /.well-known/ucp/2026-04-08 because it ran
 *     with the flag on (wish-testiraha-ei-voi-olla-p-ll-tuotantonodessa-test-money).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { setupOperator } from './helpers/owner-login.js';

const PORT_PUBLIC = process.env.E2E_TMG_PUBLIC_PORT ?? '40486';
const PORT_LOCAL = process.env.E2E_TMG_LOCAL_PORT ?? '40487';
const PORT_OFF = process.env.E2E_TMG_OFF_PORT ?? '40489';
const ADMIN_PW = 'tmg-admin-password-2026';
const PACK_PRICE = 2_000_000;   // 2.00 EUR in micro-units

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Node { proc: ChildProcess; base: string; dbPath: string }

/** Start a node on loopback, with `publicUrl` as the address it believes others reach it at. */
async function startNode(port: string, publicUrl: string, label: string, testMoney: boolean): Promise<Node> {
  const dbPath = `test/.tmg-${label}-${Date.now()}.db`;
  const db = await ownNodeDb(port, { sqlitePath: dbPath });
  const proc = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], {
    env: {
      ...process.env,
      ...db.env,
      AIMEAT_PORT: port, AIMEAT_BASE_URL: publicUrl,
      AIMEAT_TEST_MONEY_HANDLER: testMoney ? 'true' : 'false', AIMEAT_COMMERCE_ENABLED: 'true',
      // The operator sells pacing capacity for money: a money checkout line any fresh node can sell.
      AIMEAT_PACING_PACK_MORSELS: '50', AIMEAT_PACING_PACK_PRICE: String(PACK_PRICE), AIMEAT_PACING_PACK_CURRENCY: 'EUR',
      AIMEAT_ADMIN_PASSWORD: ADMIN_PW, AIMEAT_EE_DISABLED: 'true', AIMEAT_APP_ORIGIN_ENABLED: 'false',
      AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '5000',
      AIMEAT_RL_ADMIN_SETUP: '1000', AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX: '1000',
      AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', () => {}); proc.stderr?.on('data', () => {});
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/v1/spec`); if (r.ok) return { proc, base, dbPath }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  proc.kill();
  throw new Error(`node ${label} did not start on ${port}`);
}

function stopNode(node: Node): void {
  node.proc.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(node.dbPath + suffix, { force: true }); } catch { /* the file may not exist */ }
  }
}

async function json(node: Node, path: string, opts: RequestInit = {}) {
  const res = await fetch(`${node.base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() as any : {} };
}

/** An account through the admin setup route, and a token for it. The first one is the operator. */
async function owner(node: Node, name: string): Promise<string> {
  return (await setupOperator(node.base, ADMIN_PW, name)).token;
}

const handlerIds = async (node: Node) =>
  ((await json(node, '/.well-known/ucp/2026-04-08')).body.ucp?.payment_handlers ?? []).map((h: { id: string }) => h.id) as string[];

/** Buy one pacing pack (a EUR checkout line sold by the operator) and pay with test.money. */
async function buyPackWithTestMoney(node: Node, buyer: string) {
  const open = await json(node, '/v1/commerce/checkout-sessions', { method: 'POST', headers: { Authorization: `Bearer ${buyer}` }, body: JSON.stringify({ items: [{ kind: 'pacing-pack', quantity: 1 }] }) });
  assert(open.status === 201 && open.body.data.session.currency === 'EUR' && open.body.data.session.total === PACK_PRICE, `open ${open.status}: ${JSON.stringify(open.body.data?.session ?? open.body.error)}`);
  return json(node, `/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${buyer}` }, body: JSON.stringify({ payment: { handler: 'test.money', instrument: 'pm_test' } }),
  });
}

async function overview(node: Node, token?: string) {
  return json(node, '/v1/admin/security/overview', token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

console.log('\n=== TEST MONEY GUARD E2E (test.money works on any node while its flag is on; a public node warns) ===\n');

const stamp = Date.now().toString().slice(-6);
const pub = await startNode(PORT_PUBLIC, 'https://shop.example.org', 'public', true);
try {
  const operator = await owner(pub, `tmgop${stamp}`);
  const buyer = await owner(pub, `tmgbuy${stamp}`);
  await owner(pub, `tmgsel${stamp}`);

  await test('a node with a public URL and the flag on advertises test.money', async () => {
    const ids = await handlerIds(pub);
    assert(ids.includes('test.money'), `test.money is not advertised: ${JSON.stringify(ids)}`);
  });

  await test('a EUR checkout on that node settles through test.money', async () => {
    const done = await buyPackWithTestMoney(pub, buyer);
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
    const s = done.body.data.session;
    assert(s.status === 'completed' && s.receipt?.handler === 'test.money' && s.receipt.charged === PACK_PRICE, `session: ${JSON.stringify({ status: s.status, receipt: s.receipt })}`);
  });

  await test('a EUR hold on that node is authorized through test.money, by default and by name', async () => {
    const byDefault = await json(pub, '/v1/commerce/holds', {
      method: 'POST', headers: { Authorization: `Bearer ${buyer}` },
      body: JSON.stringify({ seller: `tmgsel${stamp}`, amount: 1_000_000, currency: 'EUR', purpose: 'probe', reference: `tmg-${stamp}`, payment: { instrument: 'pm_test' } }),
    });
    assert(byDefault.status === 201, `default hold: ${byDefault.status} ${JSON.stringify(byDefault.body.error)}`);
    const named = await json(pub, '/v1/commerce/holds', {
      method: 'POST', headers: { Authorization: `Bearer ${buyer}` },
      body: JSON.stringify({ seller: `tmgsel${stamp}`, amount: 1_000_000, currency: 'EUR', purpose: 'probe', reference: `tmg2-${stamp}`, payment: { handler: 'test.money', instrument: 'pm_test' } }),
    });
    assert(named.status === 201, `naming test.money: ${named.status} ${JSON.stringify(named.body.error)}`);
  });

  await test('the Security page shows the flag as critical and in force, and says any buyer can check out without paying', async () => {
    const r = await overview(pub, operator);
    assert(r.status === 200, `overview ${r.status}: ${JSON.stringify(r.body.error)}`);
    const t = r.body.data.now.test_money_handler;
    assert(t?.requested === true && t.active === true && t.zone === 'critical', `test_money_handler: ${JSON.stringify(t)}`);
    const msg = String(t.message);
    assert(msg.includes('AIMEAT_TEST_MONEY_HANDLER') && msg.includes('any buyer can complete a EUR or USD checkout without paying'), `the message: ${msg}`);
    assert(/remove the variable/i.test(msg), `the message says how to turn it off: ${msg}`);
    assert(['watch', 'open'].includes(r.body.data.now.status), `the page status asks for a look: ${r.body.data.now.status}`);
  });

  await test('a caller with no credentials cannot read that finding (401/403)', async () => {
    const r = await overview(pub);
    assert(r.status === 401 || r.status === 403, `signed-out overview ${r.status}`);
    assert(r.body.data === undefined, 'no overview data in the refusal');
  });
} finally {
  stopNode(pub);
}

const off = await startNode(PORT_OFF, 'https://shop.example.org', 'off', false);
try {
  const operator = await owner(off, `tmgoop${stamp}`);
  const buyer = await owner(off, `tmgobuy${stamp}`);
  await test('the negative control: with the flag off a public node does not register test.money', async () => {
    const ids = await handlerIds(off);
    assert(ids.length > 0, 'the profile lists the money handlers');
    assert(!ids.includes('test.money'), `test.money is advertised with the flag off: ${JSON.stringify(ids)}`);
    const done = await buyPackWithTestMoney(off, buyer);
    assert(done.status !== 200, `a checkout settled through test.money with the flag off: ${JSON.stringify(done.body.data?.session?.status)}`);
  });
  await test('with the flag off the Security page has no test money finding', async () => {
    const t = (await overview(off, operator)).body.data?.now?.test_money_handler;
    assert(t?.requested === false && t.active === false && t.zone === 'healthy' && t.message === null, `test_money_handler: ${JSON.stringify(t)}`);
  });
} finally {
  stopNode(off);
}

const local = await startNode(PORT_LOCAL, `http://localhost:${PORT_LOCAL}`, 'local', true);
try {
  const operator = await owner(local, `tmglop${stamp}`);
  const buyer = await owner(local, `tmglbuy${stamp}`);
  await test('a loopback test node keeps test.money and settles a EUR checkout with it', async () => {
    const ids = await handlerIds(local);
    assert(ids.includes('test.money'), `test.money missing on a test node: ${JSON.stringify(ids)}`);
    const done = await buyPackWithTestMoney(local, buyer);
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
  });
  await test('on a loopback test node the Security page shows the flag in force with no critical warning', async () => {
    const t = (await overview(local, operator)).body.data?.now?.test_money_handler;
    assert(t?.requested === true && t.active === true && t.zone === 'healthy' && t.message === null, `test_money_handler: ${JSON.stringify(t)}`);
  });
} finally {
  stopNode(local);
}

console.log(`\nTest money guard E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
