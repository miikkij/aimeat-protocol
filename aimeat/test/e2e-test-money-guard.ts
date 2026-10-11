/**
 * @file test/e2e-test-money-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The test-only money handler (`test.money`) cannot run on a node others can reach.
 *   Self-spawns two nodes with AIMEAT_TEST_MONEY_HANDLER=true. One is configured like production: a
 *   public URL that is not a loopback address. It must not advertise or register test.money, a EUR
 *   hold must not be authorized through it, and the operator's Security page must name the flag as
 *   critical. The other has a loopback URL, the way the E2E runner and `pnpm sandbox` start a node,
 *   and keeps test.money: that is the positive control, and the reason every money suite still runs.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=test-money-guard
 * @version-history
 *   v1.0.0 — 2026-10-11 — aimeat.io listed test.money at /.well-known/ucp/2026-04-08 because it ran
 *     with the flag on (wish-testiraha-ei-voi-olla-p-ll-tuotantonodessa-test-money).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { nodeEntryArgs } from './helpers/node-entry.js';

const PORT_PUBLIC = process.env.E2E_TMG_PUBLIC_PORT ?? '40486';
const PORT_LOCAL = process.env.E2E_TMG_LOCAL_PORT ?? '40487';
const ADMIN_PW = 'tmg-admin-password-2026';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Node { proc: ChildProcess; base: string; dbPath: string }

/** Start a node on loopback, with `publicUrl` as the address it believes others reach it at. */
async function startNode(port: string, publicUrl: string, label: string): Promise<Node> {
  const dbPath = `test/.tmg-${label}-${Date.now()}.db`;
  const proc = spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', dbPath], {
    env: {
      ...process.env,
      AIMEAT_PORT: port, AIMEAT_BASE_URL: publicUrl,
      AIMEAT_TEST_MONEY_HANDLER: 'true', AIMEAT_COMMERCE_ENABLED: 'true',
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
  const reg = await json(node, '/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name }) });
  assert(reg.status === 200 && reg.body.ok === true, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const tok = await json(node, '/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ owner: name, private_key: reg.body.private_key }) });
  assert(tok.status === 200, `token ${name}: ${tok.status} ${JSON.stringify(tok.body)}`);
  return (tok.body.token ?? tok.body.data?.token) as string;
}

const handlerIds = async (node: Node) =>
  ((await json(node, '/.well-known/ucp/2026-04-08')).body.ucp?.payment_handlers ?? []).map((h: { id: string }) => h.id) as string[];

console.log('\n=== TEST MONEY GUARD E2E (test.money never runs on a node others can reach) ===\n');

const stamp = Date.now().toString().slice(-6);
const pub = await startNode(PORT_PUBLIC, 'https://shop.example.org', 'public');
try {
  const operator = await owner(pub, `tmgop${stamp}`);
  const buyer = await owner(pub, `tmgbuy${stamp}`);
  await owner(pub, `tmgsel${stamp}`);

  await test('a node with a public URL and the flag on does not advertise test.money', async () => {
    const ids = await handlerIds(pub);
    assert(ids.length > 0, 'the profile lists the money handlers');
    assert(!ids.includes('test.money'), `test.money is advertised: ${JSON.stringify(ids)}`);
  });

  await test('a EUR hold on that node is not authorized through test.money', async () => {
    const r = await json(pub, '/v1/commerce/holds', {
      method: 'POST', headers: { Authorization: `Bearer ${buyer}` },
      body: JSON.stringify({ seller: `tmgsel${stamp}`, amount: 1_000_000, currency: 'EUR', purpose: 'probe', reference: `tmg-${stamp}`, payment: { instrument: 'pm_test' } }),
    });
    assert(r.status !== 201, `the hold was authorized: ${JSON.stringify(r.body)}`);
    const named = await json(pub, '/v1/commerce/holds', {
      method: 'POST', headers: { Authorization: `Bearer ${buyer}` },
      body: JSON.stringify({ seller: `tmgsel${stamp}`, amount: 1_000_000, currency: 'EUR', purpose: 'probe', reference: `tmg2-${stamp}`, payment: { handler: 'test.money', instrument: 'pm_test' } }),
    });
    assert(named.status === 422 && named.body.error?.code === 'HOLD_UNSUPPORTED', `naming test.money: ${named.status} ${JSON.stringify(named.body.error)}`);
  });

  await test('the Security page names the flag as critical, and says it is not in force', async () => {
    const r = await json(pub, '/v1/admin/security/overview', { headers: { Authorization: `Bearer ${operator}` } });
    assert(r.status === 200, `overview ${r.status}: ${JSON.stringify(r.body.error)}`);
    const t = r.body.data.now.test_money_handler;
    assert(t?.requested === true && t.active === false && t.zone === 'critical', `test_money_handler: ${JSON.stringify(t)}`);
    assert(String(t.message).includes('AIMEAT_TEST_MONEY_HANDLER'), `the message names the variable: ${t.message}`);
  });

  await test('a caller with no credentials cannot read that finding (401/403)', async () => {
    const r = await json(pub, '/v1/admin/security/overview');
    assert(r.status === 401 || r.status === 403, `signed-out overview ${r.status}`);
    assert(r.body.data === undefined, 'no overview data in the refusal');
  });
} finally {
  stopNode(pub);
}

const local = await startNode(PORT_LOCAL, `http://localhost:${PORT_LOCAL}`, 'local');
try {
  const operator = await owner(local, `tmglop${stamp}`);
  await test('the positive control: a loopback test node keeps test.money', async () => {
    const ids = await handlerIds(local);
    assert(ids.includes('test.money'), `test.money missing on a test node: ${JSON.stringify(ids)}`);
  });
  await test('the Security page still names the flag on a test node, as critical and in force', async () => {
    const r = await json(local, '/v1/admin/security/overview', { headers: { Authorization: `Bearer ${operator}` } });
    const t = r.body.data?.now?.test_money_handler;
    assert(t?.requested === true && t.active === true && t.zone === 'critical', `test_money_handler: ${JSON.stringify(t)}`);
  });
} finally {
  stopNode(local);
}

console.log(`\nTest money guard E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
