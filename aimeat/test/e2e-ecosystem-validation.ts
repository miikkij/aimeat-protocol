/**
 * @file e2e-ecosystem-validation.ts
 * @description E2E for the connector-profile static-validation slice (chunk 4): a manifest submitted
 *   at hello is statically validated (schema + app-match + scope ceiling), the result is surfaced in
 *   the pending list, and a FAILED validation blocks approval. A hello with no manifest is unaffected
 *   (back-compat). Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-validation
 * @version-history
 *   v1.0.0 — 2026-06-14 — Initial creation (connector-profile static validation, chunk 4).
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
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) { await sleep(2000); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const ownerName = `ecovalowner${Date.now()}`;
let ownerToken = '';
let auth: Record<string, string> = {};

async function pendingFor(app: string): Promise<any> {
  const r = await json('/v1/ecosystem-apps/pending', { headers: auth });
  return (r.body.data?.requests ?? []).find((x: any) => x.app === app);
}

async function run() {
  console.log('\n=== AIMEAT Ecosystem Static-Validation E2E ===\n');

  await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(ownerName + NODE_ID + ts), Buffer.from(body.data.private_key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
    ownerToken = tok.body.data.token;
    auth = { Authorization: `Bearer ${ownerToken}` };
  });

  await test('A valid manifest validates and the request can be approved', async () => {
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({
      owner: ownerName, app: 'goodapp', public_key: 'a2V5', scopes: ['memory:read', 'memory:write'],
      manifest: { app: 'goodapp', origin: 'https://goodapp.example', scopes: ['memory:read'], capabilities: [{ id: 'reply' }], events: { emits: ['ticket.resolved'], subscribes: ['memory.write'] } },
    }) });
    assert(hello.body.data?.validation?.ok === true, `hello validation should pass: ${JSON.stringify(hello.body.data?.validation)}`);
    const p = await pendingFor('goodapp');
    assert(p?.validation === 'validated', `pending should be validated, got ${p?.validation}`);
    const ap = await json(`/v1/ecosystem-apps/${p.user_code}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }) });
    assert(ap.body.data?.status === 'approved', `approve should succeed: ${JSON.stringify(ap.body)}`);
  });

  await test('A failed manifest (app mismatch) is flagged and BLOCKS approval', async () => {
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({
      owner: ownerName, app: 'badapp', public_key: 'a2V5', scopes: ['memory:read'],
      manifest: { app: 'somethingelse', scopes: ['memory:read'] }, // app != request app → check fails
    }) });
    assert(hello.body.data?.validation?.ok === false, `hello validation should fail: ${JSON.stringify(hello.body.data?.validation)}`);
    const p = await pendingFor('badapp');
    assert(p?.validation === 'failed', `pending should be failed, got ${p?.validation}`);
    const ap = await json(`/v1/ecosystem-apps/${p.user_code}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'approve' }) });
    assert(ap.status === 409, `approve should be blocked (409), got ${ap.status}: ${JSON.stringify(ap.body)}`);
    assert(ap.body.error?.code === 'VALIDATION_FAILED', `expected VALIDATION_FAILED, got ${ap.body.error?.code}`);
  });

  await test('No manifest → validation "none" and approval works (back-compat)', async () => {
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({
      owner: ownerName, app: 'plainapp', public_key: 'a2V5', scopes: ['memory:read'],
    }) });
    assert(hello.body.data?.validation === null, `no-manifest validation should be null, got ${JSON.stringify(hello.body.data?.validation)}`);
    const p = await pendingFor('plainapp');
    assert(p?.validation === 'none', `pending should be none, got ${p?.validation}`);
    const ap = await json(`/v1/ecosystem-apps/${p.user_code}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'approve', scopes: ['memory:read'] }) });
    assert(ap.body.data?.status === 'approved', `approve should succeed: ${JSON.stringify(ap.body)}`);
  });

  console.log('\n' + '─'.repeat(48));
  console.log(`Ecosystem Static-Validation E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
  if (failed > 0) process.exit(1);
  console.log('✅ All tests passed!\n');
}

run().catch(err => { console.error(err); process.exit(1); });
