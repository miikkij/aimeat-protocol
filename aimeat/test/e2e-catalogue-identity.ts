/**
 * @file e2e-catalogue-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue action's provider coordinate is the resolved identity, not the raw
 *   `sub`. POST /v1/catalogue is gated by requireRole('agent'), which the role hierarchy also admits
 *   an OWNER session to — and there `req.auth!.sub` is the bare name `alice`, not the GHII
 *   `alice@node`. Before the 2026-08-23 fix an owner publishing a service stored, and showed in the
 *   public catalogue as provider_gaii, a half-identity. This proves the stored value is the full
 *   GHII, and that the cross-owner delete boundary holds.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=catalogue-identity
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial: owner-session provider_gaii is a GHII; cross-owner delete → 404.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
async function signMsg(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });

async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}` };
}

console.log('\n=== Catalogue provider identity E2E ===\n');

const ts = Date.now() % 100000;
const aName = `catowna${ts}`, bName = `catownb${ts}`;
let aTok = '', bTok = '', aGhii = '';
let actionId = '';

await test('Setup: two owners', async () => {
    const a = await registerOwner(aName); aTok = a.token; aGhii = a.ghii;
    bTok = (await registerOwner(bName)).token;
});

await test('Owner A publishes a service; the stored provider_gaii is A\'s GHII, not a bare name', async () => {
    const pub = await json('/v1/catalogue', { ...auth(aTok), method: 'POST', body: JSON.stringify({ display_name: 'Summarise', description: 'summarises text', category: 'text', price_morsels: 0 }) });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    actionId = pub.body.data?.id ?? pub.body.data?.action?.id;
    assert(!!actionId, `an action id comes back: ${JSON.stringify(pub.body.data)}`);

    const detail = await json(`/v1/catalogue/${actionId}`);
    assert(detail.status === 200, `detail: ${detail.status}`);
    assert(detail.body.data?.provider_gaii === aGhii,
        `provider_gaii must be the full GHII "${aGhii}", got "${detail.body.data?.provider_gaii}"`);
});

await test('Owner B cannot delete A\'s action (cross-owner boundary → 404)', async () => {
    const del = await json(`/v1/catalogue/${actionId}`, { ...auth(bTok), method: 'DELETE' });
    assert(del.status === 404, `a different owner must not delete it, got ${del.status}`);
    // And it is still there.
    const still = await json(`/v1/catalogue/${actionId}`);
    assert(still.status === 200, `the action must survive the refused delete, got ${still.status}`);
});

await test('Publishing a service without a credential is refused (401)', async () => {
    const pub = await json('/v1/catalogue', { method: 'POST', body: JSON.stringify({ display_name: 'Anon', description: 'no auth', category: 'text', price_morsels: 0 }) });
    assert(pub.status === 401, `an unauthenticated publish must be refused, got ${pub.status}`);
});

await test('Owner A deletes their own action (the stored key round-trips)', async () => {
    const del = await json(`/v1/catalogue/${actionId}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `owner delete: ${del.status} ${JSON.stringify(del.body)}`);
    const gone = await json(`/v1/catalogue/${actionId}`);
    assert(gone.status === 404, `the action must be gone, got ${gone.status}`);
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${aName}`, { ...auth(aTok), method: 'DELETE' });
    await json(`/v1/owners/${bName}`, { ...auth(bTok), method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
