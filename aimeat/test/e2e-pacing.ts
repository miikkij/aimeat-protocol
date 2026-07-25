/**
 * @file test/e2e-pacing.ts
 * @description The pacing floor (morsels bound the call RATE, whatever the call is paid in). Self-spawns
 *   a node with AIMEAT_PACING_TOLL_DEFAULT set, because the point of the feature is the node-wide default:
 *   a capability that declares no toll of its own is still paced.
 *
 *   What this proves is the hole the developer spotted: a MONEY-priced capability used to have no morsel
 *   brake at all — its only limit was the buyer's total budget, which a runaway loop empties at machine
 *   speed. The toll now burns on the chokepoint every metered path shares, so the same loop hits a
 *   morsel ceiling first, and the burn is a burn: the provider is never credited by it.
 * @usage cd aimeat && pnpm exec tsx test/e2e-pacing.ts
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial: pacing applies to a money contract, is a burn, and spares the owner.
 */
import { spawn } from 'node:child_process';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_PACING_PORT ?? '40488';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const TOLL = 2;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  \u2705 ${name}`); }
  catch (err) { failed++; console.error(`  \u274c ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() as any : {} };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
  const name = `pace${label}${Date.now().toString().slice(-7)}`;
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Pacing', password: 'Pacing12345' }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(name + NODE_ID + ts), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
  return { name, token: tok.body.data.token as string };
}
async function balance(token: string) {
  const r = await json('/v1/wallet', { headers: auth(token) });
  return Number(r.body.data.balance ?? 0);
}

const dbPath = `test/.pacing-${Date.now()}.db`;
const server = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', dbPath], {
  env: {
    ...process.env,
    AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_EXTENSIONS_ENABLED: 'true',
    AIMEAT_PACING_TOLL_DEFAULT: String(TOLL),          // the whole point: a node-wide floor
    AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '5000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*', AIMEAT_ANONYMOUS: 'true', AIMEAT_EE_DISABLED: 'true',
    AIMEAT_COMMERCE_ENABLED: 'true', AIMEAT_TEST_MONEY_HANDLER: 'true',   // an off-PSP money rail so the EUR leg settles
    AIMEAT_APP_ORIGIN_ENABLED: 'false',
    AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout?.on('data', () => {}); server.stderr?.on('data', () => {});
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`${BASE}/v1/spec`); if (r.ok) break; } catch { /* not up yet */ }
  await new Promise(r => setTimeout(r, 1000));
}

console.log('\n=== AIMEAT PACING E2E (morsels bound the rate, whatever pays) ===\n');

const provider = await setupOwner('prov');
const consumer = await setupOwner('cons');
const EXT = `pace${Date.now().toString().slice(-7)}`;
const SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };
let offeringId = '';

await test('Setup: provider lists a MONEY-priced capability that declares no toll of its own', async () => {
  const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'pacing probe', author: 'e2e' },
    actions: [{
      id: 'run', method: 'POST', path: '/run', script: 'echo', input: SCHEMA, output: SCHEMA,
      commercial: { payMorsels: 0, payMoney: { amount: 20000, currency: 'EUR' }, exchange: true,
        usageTerms: { derivatives: true, resale: false, attribution: true } },
    }],
  });
  const ins = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token),
    body: JSON.stringify({ manifest, scripts: { echo: 'export default async function(ctx, input){ return { q: "ok" }; }' } }) });
  assert(ins.status === 201 || ins.status === 200, `install ${ins.status}: ${JSON.stringify(ins.body?.error)}`);
  await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
  const list = await json('/v1/exchange/offerings');
  const o = (list.body.data.offerings as any[]).find(x => x.ext === EXT && x.action === 'run');
  assert(!!o && o.unit === 'money', `money listing projected: ${JSON.stringify(o)}`);
  offeringId = o.offeringId;
});

await test('A money contract is paced: each call burns the node toll from the CALLER', async () => {
  const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token),
    body: JSON.stringify({ offering_id: offeringId, cap_units: 100_000_000 }) });
  assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
  const before = await balance(consumer.token);
  const call = await json(`/v1/ext/${EXT}/run`, { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ q: 'x' }) });
  assert(call.status === 200, `metered money call ${call.status}: ${JSON.stringify(call.body?.error)}`);
  const after = await balance(consumer.token);
  assert(before - after === TOLL, `caller burned exactly the toll: ${before} -> ${after} (expected -${TOLL})`);
});

await test('The toll is a BURN: the provider is not credited by it', async () => {
  const pBefore = await balance(provider.token);
  const call = await json(`/v1/ext/${EXT}/run`, { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ q: 'y' }) });
  assert(call.status === 200, `call ${call.status}`);
  assert(await balance(provider.token) === pBefore, 'the provider gained no morsels from the pacing toll');
});

await test('Pacing stops a runaway loop before the money budget does', async () => {
  // The scenario the developer described: a repeat-call bug against a money contract. The morsel
  // balance is the ceiling now, so the loop ends in 402 while the EUR budget is nowhere near spent.
  let calls = 0, blocked = false;
  for (let i = 0; i < 400; i++) {
    const r = await json(`/v1/ext/${EXT}/run`, { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ q: 'loop' }) });
    if (r.status === 200) { calls++; continue; }
    blocked = r.status === 402 && r.body?.error?.code === 'INSUFFICIENT_MORSELS';
    break;
  }
  assert(blocked, `the loop hit the morsel ceiling, not an open till (made ${calls} calls)`);
  const contracts = await json('/v1/exchange/entitlements', { headers: auth(consumer.token) });
  const list = (contracts.body.data.entitlements ?? contracts.body.data.contracts ?? []) as any[];
  const ent = list.find(c => c.ext === EXT);
  assert(ent && (ent.budget.remainingUnits ?? ent.budget.remaining_units) > 0, `and the money budget still had room: ${JSON.stringify(ent?.budget)}`);
});

await test('The provider calling their own capability is never paced', async () => {
  const before = await balance(provider.token);
  const call = await json(`/v1/ext/${EXT}/run`, { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ q: 'own' }) });
  assert(call.status === 200, `owner call ${call.status}: ${JSON.stringify(call.body?.error)}`);
  assert(await balance(provider.token) === before, 'the owner burned nothing on their own capability');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
server.kill('SIGTERM');
process.exit(failed > 0 ? 1 : 0);
