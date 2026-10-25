/**
 * @file test/e2e-ext-operator-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's limits on extension load, set through PUT /v1/admin/config, end to end
 *   (secaudit2026oct22, round 7). Each limit is "no limit" by default or generous, and the designed
 *   use keeps working under it:
 *     - extensions.namespace_max_mb: past the total, ctx.memory.set refuses a NEW key with a sentence
 *       naming the setting, while an existing key is still updated and read; 0 lifts it (lead 750);
 *     - extensions.max_instances: past the count, POST /v1/extensions/:name/instances answers 409
 *       LIMIT_EXCEEDED naming the setting; 0 lifts it (lead 750).
 *   The suite's first account is the operator; every setting it changes is put back at the end.
 *   FIRST FAIL: before the change, PUT /v1/admin/config answers 400 for both paths (unknown setting).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ext-operator-limits
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 750).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body; headers: Headers }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed: Body;
  try { parsed = JSON.parse(text) as Body; } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const EXT = `oplim${stamp}`;
const SCRIPTS = {
  put: `export default async function(ctx, input){
    await ctx.memory.set(input.key, { text: 'x'.repeat(input.kb * 1024) });
    return { written: input.key };
  }`,
  get: `export default async function(ctx, input){
    var v = await ctx.memory.get(input.key);
    return { length: v ? v.text.length : -1 };
  }`,
};
const MANIFEST = JSON.stringify({
  metadata: { name: EXT, version: '1.0.0', description: 'operator limits e2e', author: 'e2e' },
  actions: [
    { id: 'put', method: 'POST', path: '/put', script: 'put' },
    { id: 'get', method: 'POST', path: '/get', script: 'get' },
  ],
  instances: { supported: true },
  limits: { timeout_ms: 5000, max_api_calls: 20 },
}, null, 2);

console.log('\n=== The operator\'s limits on extension load (secaudit2026oct22, round 7) ===\n');

let op!: RegisteredOwner;
const setSetting = (path: string, value: unknown) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path, value }] });
const put = (key: string, kb: number, instance?: string) =>
  call('POST', instance ? `/v1/ext/${EXT}/${instance}/put` : `/v1/ext/${EXT}/put`, op.token, { key, kb });

await test('Setup: the operator installs an extension that writes its memory and runs as several copies', async () => {
  op = await registerOwner(BASE, `oplim${stamp}`);
  assert(op.roles.includes('operator'), `the suite's first account is the operator: ${JSON.stringify(op.roles)}`);
  const inst = await call('POST', '/v1/extensions', op.token, { manifest: MANIFEST, scripts: SCRIPTS });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await call('POST', `/v1/extensions/${EXT}/activate`, op.token);
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

await test('By default an extension\'s memory has no total: two 600 kB keys are written', async () => {
  for (const key of ['big.one', 'big.two']) {
    const r = await put(key, 600);
    assert(r.status === 200, `${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
  }
});

await test('The operator sets extensions.namespace_max_mb to 1 through PUT /v1/admin/config', async () => {
  const r = await setSetting('extensions.namespace_max_mb', 1);
  assert(r.status === 200, `PUT ${r.status}: ${JSON.stringify(r.body?.error ?? r.body?.data?.errors)}`);
});

await test('FAILURE: past the total, a NEW key is refused with a sentence that names the setting', async () => {
  const r = await put('small.new', 1);
  assert(r.status !== 200, `a new key past the total was written: ${JSON.stringify(r.body)}`);
  const msg = String(r.body?.error?.message ?? '');
  assert(msg.includes('extensions.namespace_max_mb'), `the refusal names the setting: ${msg}`);
});

await test('Past the total, an existing key is still updated and read', async () => {
  const w = await put('big.one', 700);
  assert(w.status === 200, `update ${w.status}: ${JSON.stringify(w.body?.error)}`);
  const g = await call('POST', `/v1/ext/${EXT}/get`, op.token, { key: 'big.one' });
  assert(g.status === 200 && g.body.data.length === 700 * 1024, `read back ${g.status}: ${JSON.stringify(g.body?.data ?? g.body?.error)}`);
});

await test('extensions.namespace_max_mb 0 is no limit: the new key is written', async () => {
  const s = await setSetting('extensions.namespace_max_mb', 0);
  assert(s.status === 200, `PUT ${s.status}: ${JSON.stringify(s.body?.error)}`);
  const r = await put('small.new', 1);
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('By default an extension may run as several copies', async () => {
  const a = await call('POST', `/v1/extensions/${EXT}/instances`, op.token, { id: 'copy-one' });
  assert(a.status === 201, `first copy ${a.status}: ${JSON.stringify(a.body?.error)}`);
});

await test('FAILURE: with extensions.max_instances 1, a second copy is refused 409 naming the setting', async () => {
  const s = await setSetting('extensions.max_instances', 1);
  assert(s.status === 200, `PUT ${s.status}: ${JSON.stringify(s.body?.error ?? s.body?.data?.errors)}`);
  const b = await call('POST', `/v1/extensions/${EXT}/instances`, op.token, { id: 'copy-two' });
  assert(b.status === 409, `expected 409, got ${b.status}: ${JSON.stringify(b.body)}`);
  assert(b.body?.error?.code === 'LIMIT_EXCEEDED', `code ${b.body?.error?.code}`);
  assert(String(b.body?.error?.message ?? '').includes('extensions.max_instances'), `names the setting: ${b.body?.error?.message}`);
  const run = await put('copy.key', 1, 'copy-one');
  assert(run.status === 200, `the existing copy still runs: ${run.status} ${JSON.stringify(run.body?.error)}`);
});

await test('extensions.max_instances 0 is no limit: the second copy is made', async () => {
  const s = await setSetting('extensions.max_instances', 0);
  assert(s.status === 200, `PUT ${s.status}: ${JSON.stringify(s.body?.error)}`);
  const b = await call('POST', `/v1/extensions/${EXT}/instances`, op.token, { id: 'copy-two' });
  assert(b.status === 201, `${b.status}: ${JSON.stringify(b.body?.error)}`);
});

await test('Cleanup: the settings go back to their defaults and the extension is removed', async () => {
  for (const path of ['extensions.namespace_max_mb', 'extensions.max_instances']) {
    await call('DELETE', `/v1/admin/config/${path}`, op.token);
  }
  await call('DELETE', `/v1/extensions/${EXT}`, op.token);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
