/**
 * @file e2e-auth-refusals.ts
 * @description E2E for the refusal log's operator surface (GET /v1/admin/auth-refusals).
 *   Generates real refusals (an anonymous knock and a non-operator knock on an operator
 *   door), then asserts the operator sees them as a list — newest first, with the door,
 *   the source and the credential KIND but never a credential value — and that the list
 *   itself is operator-only.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: refusals recorded, listed newest-first, gate enforced.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-auth-refusals

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

console.log('\n=== AIMEAT Auth-Refusals E2E ===\n');

const opName = `refop${Date.now()}`;
const nonOpName = `refnon${Date.now()}`;
let opToken = '';
let nonOpToken = '';

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
});

await test('Two refusals happen: an anonymous knock and a non-operator knock', async () => {
    const anon = await json('/v1/admin/security/incidents');
    assert(anon.status === 401, `anonymous expected 401, got ${anon.status}`);
    const nonOp = await json('/v1/admin/security/incidents', { headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
});

await test('Operator sees the refusals as a list, newest first', async () => {
    const { status, body } = await json('/v1/admin/auth-refusals?limit=50', { headers: { Authorization: `Bearer ${opToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.enabled === true, 'log is enabled under the runner');
    const items = body.data.items as Array<Record<string, unknown>>;
    assert(Array.isArray(items) && items.length >= 2, `at least the two refusals just made, got ${items?.length}`);
    for (let i = 1; i < items.length; i++) assert(String(items[i - 1].ts) >= String(items[i].ts), 'ordered newest-first');
    const anonLine = items.find(r => r.status === 401 && String(r.path).includes('/v1/admin/security/incidents'));
    assert(!!anonLine, 'the anonymous knock is in the list with its door');
    assert(anonLine!.credential === 'none', `anonymous line carries credential kind none, got ${anonLine!.credential}`);
    const nonOpLine = items.find(r => r.status === 403 && String(r.path).includes('/v1/admin/security/incidents'));
    assert(!!nonOpLine, 'the non-operator knock is in the list');
    assert(String(nonOpLine!.credential).includes('jwt'), `403 line names a jwt credential kind, got ${nonOpLine!.credential}`);
    const digest = String(nonOpLine!.credential_digest ?? '');
    assert(/^[0-9a-f]{12}$/.test(digest), `digest is 12 hex chars, got "${digest}"`);
    assert(!JSON.stringify(items).includes(nonOpToken), 'no credential value appears anywhere in the list');
});

await test('The list itself is operator-only', async () => {
    const nonOp = await json('/v1/admin/auth-refusals', { headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
    const anon = await json('/v1/admin/auth-refusals');
    assert(anon.status === 401, `anonymous expected 401, got ${anon.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
