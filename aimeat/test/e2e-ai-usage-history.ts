/**
 * @file e2e-ai-usage-history.ts
 * @description E2E for the AI-spend analytics endpoints backing the new usage charts:
 *   GET /v1/ai/usage/history (owner per-day series + 24h/7d/30d rollups) and
 *   GET /v1/admin/ai-usage (operator cross-user aggregate). Seeds ai-usage.<gaii>.<day> memory
 *   records for two owners (the retained per-day usage records the completion path writes), then
 *   asserts the owner history windows (d1/d7/d30) and per-app series, the operator per-app +
 *   per-user aggregation across both owners, and the auth guards (401 no-auth, 403 non-operator).
 * @version-history
 *   v1.0.0 — 2026-07-05 — Initial.
 */
// Run: cd aimeat && pnpm exec tsx test/e2e-ai-usage-history.ts

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Server } from 'node:http';

const TEST_PORT = parseInt(process.env.E2E_PORT ?? '40273', 10);
const BASE = process.env.E2E_BASE ?? `http://localhost:${TEST_PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let server: Server | null = null;
if (!process.env.E2E_BASE) {
  process.env.AIMEAT_PORT = String(TEST_PORT);
  process.env.AIMEAT_DEV_MODE = 'true';
  process.env.AIMEAT_TEST_MODE = 'true';
  if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
  const { config } = loadConfig({});
  config.port = TEST_PORT;
  const { app } = await createServer(config);
  server = await new Promise<Server>((resolve) => { const s = app.listen(TEST_PORT, () => resolve(s)); });
  console.log(`Test server started on port ${TEST_PORT}`);
}

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function approx(a: number, b: number, msg: string) { if (Math.abs(a - b) > 1e-6) throw new Error(`${msg}: ${a} vs ${b}`); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<string> {
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  assert(status === 201, `register ${name} status ${status}: ${JSON.stringify(body)}`);
  return body.data.private_key as string;
}
async function ownerToken(name: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, name + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
  assert(body.ok === true, `token ${name}: ${JSON.stringify(body.error)}`);
  return body.data.token as string;
}
const dayStr = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
async function seed(token: string, gaii: string, rec: any) {
  const { status } = await json('/v1/memory', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: `ai-usage.${gaii}.${rec.date}`, value: rec, visibility: 'private' }),
  });
  assert(status === 201 || status === 200, `seed ${gaii} ${rec.date} status ${status}`);
}

/**
 * Seed the OPERATOR aggregate the way production writes it: a priced ledger event carrying an app
 * id. `seed()` above still writes the per-day memory record, because that is what the OWNER's
 * /v1/ai/usage/history reads and what the daily budget counts — the two are different records of the
 * same call, and since 2026-08-14 a real completion writes both.
 *
 * Only "today" is seedable this way: the node stamps the timestamp, which is the honest limit of
 * driving a real path instead of hand-writing storage. The range assertion below is written to that
 * limit rather than around it.
 */
async function seedLedger(token: string, agent: string, appId: string, costUsd: number, tokens: number) {
  const r = await json(`/v1/agents/${encodeURIComponent(agent)}/telemetry`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 'llm_call',
      data: {
        model: 'anthropic/claude-opus-5', provider: 'openrouter',
        prompt_tokens: Math.round(tokens / 2), completion_tokens: Math.round(tokens / 2),
        cost_usd: costUsd, app_id: appId,
      },
    }),
  });
  assert(r.status === 201, `seedLedger ${agent}/${appId}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

async function makeAgent(token: string, owner: string, name: string) {
  const r = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, owner, capabilities: ['test'] }),
  });
  assert(r.status === 201 || r.status === 200, `agent ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

const opName = `aiusageop${Date.now()}`;
const userName = `aiusageuser${Date.now()}`;
const opGaii = `${opName}@${NODE_ID}`;
const userGaii = `${userName}@${NODE_ID}`;
let opToken = '', userToken = '';
const today = dayStr(0), yesterday = dayStr(1), tenDaysAgo = dayStr(10);

console.log('\n=== AI Usage History E2E Tests ===\n');

await test('Register operator owner + token', async () => {
  opToken = await ownerToken(opName, await registerOwner(opName));
});
await test('Register non-operator owner + token', async () => {
  userToken = await ownerToken(userName, await registerOwner(userName));
});

await test('Seed operator per-day usage records (today, yesterday, 10 days ago)', async () => {
  await seed(opToken, opGaii, { date: today, total_cost_usd: 0.10, total_calls: 3, total_tokens: 1000, per_app: { drop: { cost_usd: 0.06, tokens: 600, calls: 2 }, notebook: { cost_usd: 0.04, tokens: 400, calls: 1 } }, updated_at: new Date().toISOString() });
  await seed(opToken, opGaii, { date: yesterday, total_cost_usd: 0.05, total_calls: 1, total_tokens: 500, per_app: { drop: { cost_usd: 0.05, tokens: 500, calls: 1 } }, updated_at: new Date().toISOString() });
  await seed(opToken, opGaii, { date: tenDaysAgo, total_cost_usd: 0.20, total_calls: 2, total_tokens: 2000, per_app: { notebook: { cost_usd: 0.20, tokens: 2000, calls: 2 } }, updated_at: new Date().toISOString() });
});
await test('Seed non-operator usage record (today)', async () => {
  await seed(userToken, userGaii, { date: today, total_cost_usd: 0.08, total_calls: 1, total_tokens: 800, per_app: { drop: { cost_usd: 0.08, tokens: 800, calls: 1 } }, updated_at: new Date().toISOString() });
});

await test('Seed the ledger the way a real completion does (app-attributed spend, today)', async () => {
  await makeAgent(opToken, opName, 'seeder');
  await makeAgent(userToken, userName, 'seeder');
  await seedLedger(opToken, 'seeder', 'drop', 0.06, 600);
  await seedLedger(opToken, 'seeder', 'notebook', 0.04, 400);
  await seedLedger(userToken, 'seeder', 'drop', 0.08, 800);
  // Not attributed to any app: it must NOT appear in an "AI apps spend" figure.
  await seedLedger(opToken, 'seeder', '', 0.99, 100);
});

await test('GET /v1/ai/usage/history requires auth → 401', async () => {
  const { status } = await json('/v1/ai/usage/history');
  assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/ai/usage/history returns series + 24h/7d/30d rollups', async () => {
  const { status, body } = await json('/v1/ai/usage/history?days=30', { headers: { Authorization: `Bearer ${opToken}` } });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const d = body.data;
  assert(Array.isArray(d.days) && d.days.length === 3, `3 day records, got ${d.days?.length}`);
  assert(d.days[0].date <= d.days[d.days.length - 1].date, 'days sorted oldest→newest');
  assert(Array.isArray(d.apps) && d.apps.includes('drop') && d.apps.includes('notebook'), `apps has drop+notebook, got ${JSON.stringify(d.apps)}`);
  assert(typeof d.daily_budget_usd === 'number', 'daily_budget_usd present');
  approx(d.windows.d1.cost_usd, 0.10, 'd1 (today) cost');
  approx(d.windows.d7.cost_usd, 0.15, 'd7 cost (today+yesterday)');
  approx(d.windows.d30.cost_usd, 0.35, 'd30 cost (all three)');
  assert(d.windows.d30.tokens === 3500, `d30 tokens 3500, got ${d.windows.d30.tokens}`);
  approx(d.windows.d30.per_app.drop.cost_usd, 0.11, 'd30 drop cost (0.06+0.05)');
});

await test('GET /v1/admin/ai-usage (operator) aggregates across both owners', async () => {
  const { status, body } = await json('/v1/admin/ai-usage', { headers: { Authorization: `Bearer ${opToken}` } });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  const d = body.data;
  // op(0.06 drop + 0.04 notebook) + user(0.08 drop) = 0.18. The 0.99 call carries no app id, so it
  // is the owner's own spend and not app spend — that exclusion is the definition this view uses.
  approx(d.totals.cost_usd, 0.18, 'grand total cost');
  assert(d.per_app.drop && d.per_app.notebook, 'per_app has drop + notebook');
  approx(d.per_app.drop.cost_usd, 0.14, 'per_app drop (op 0.06 + user 0.08)');
  assert(!d.per_app._unknown, 'an unattributed call is not an app, so there is no _unknown bucket');
  assert(Array.isArray(d.per_user) && d.per_user.length >= 2, `>=2 users, got ${d.per_user?.length}`);
  assert(d.per_user[0].cost_usd >= d.per_user[1].cost_usd, 'per_user sorted by spend desc');
  assert(Array.isArray(d.days) && d.days.length >= 1, 'days series present');
});

await test('GET /v1/admin/ai-usage with non-operator token → 403', async () => {
  const { status } = await json('/v1/admin/ai-usage', { headers: { Authorization: `Bearer ${userToken}` } });
  assert(status === 403, `expected 403, got ${status}`);
});

await test('GET /v1/admin/ai-usage honors a narrow from/to range', async () => {
  const inRange = await json(`/v1/admin/ai-usage?from=${today}&to=${today}`, { headers: { Authorization: `Bearer ${opToken}` } });
  assert(inRange.status === 200, `status ${inRange.status}`);
  approx(inRange.body.data.totals.cost_usd, 0.18, 'today-only total');

  // A window that ends before anything was seeded must be empty, not merely smaller — a range
  // filter that quietly ignored its bounds would still pass the assertion above.
  const past = await json(`/v1/admin/ai-usage?from=${tenDaysAgo}&to=${tenDaysAgo}`, { headers: { Authorization: `Bearer ${opToken}` } });
  assert(past.status === 200, `status ${past.status}`);
  approx(past.body.data.totals.cost_usd, 0, 'a window with no data is empty');
});

await test('Cleanup owners', async () => {
  const a = await json(`/v1/owners/${encodeURIComponent(userName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${opToken}` } });
  const b = await json(`/v1/owners/${encodeURIComponent(opName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${opToken}` } });
  assert(a.status === 200 && b.status === 200, `delete statuses ${a.status}/${b.status}`);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`AI Usage History E2E: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);
if (server) server.close();
process.exit(failed > 0 ? 1 : 0);
