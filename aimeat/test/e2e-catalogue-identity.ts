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
import { createHash, randomBytes } from 'node:crypto';
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

// Four browse doors were gated on catalogue:read on 2026-09-04. The word already existed and was
// already enforced — on four SSE domains (auth/sse-domain-scopes.ts) and on the consent screen
// (app-grants.ts) — while the fetch of the same content asked nothing. What it refuses is narrow by
// design: catalogue:read is a DEFAULT scope for agents, for anonymous sessions and for federation,
// so nothing that browses today loses anything. An APP GRANT is the exception, because an app holds
// only what its owner ticked, and what the directory hands out is bulk data about OTHER people —
// display names, bios, interests, city and country, and lat/lon for everyone who opted in.
await test('An app grant approved for memory:read alone cannot browse the directories', async () => {
    const APP_FILE = `catbrowse-${ts}.html`;
    const pub = await json('/v1/apps', {
        ...auth(aTok), method: 'POST',
        body: JSON.stringify({ filename: APP_FILE, content: Buffer.from('<h1>browse</h1>', 'utf8').toString('base64'), name: 'Browser', description: 'browses', category: 'utility', tags: [] }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);

    const REDIRECT = 'http://localhost:9/cb';
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${aName}/${APP_FILE}`, response_type: 'code', scope: 'memory:read',
        redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')?.[1] ?? '');
    assert(!!rid, `expected a consent redirect, got ${authz.status}`);
    const con = await json('/v1/app-grants/authorize-consent', {
        ...auth(aTok), method: 'POST', body: JSON.stringify({ request_id: rid }),
    });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.body.ok === true, `grant token: ${JSON.stringify(tok.body?.error)}`);
    const appToken = tok.body.data.access_token as string;

    for (const path of ['/v1/catalogue/directory', '/v1/ghii/list', '/v1/cortex', '/v1/trusted-issuers']) {
        const r = await json(path, auth(appToken));
        assert(r.status === 403, `${path}: an app approved for memory:read alone browsed it: ${r.status}`);
        assert(r.body.error?.code === 'SCOPE_DENIED', `${path}: refused for the wrong reason: ${JSON.stringify(r.body.error)}`);
        assert((r.body.error?.message ?? '').includes('catalogue:read'), `${path}: the refusal must name the word, got: ${r.body.error?.message}`);
    }

    // The control: the person's own session still browses all four. Owner sessions bypass scopes, so
    // what the gate costs is a third-party app reading about other people, not anybody's own use.
    for (const path of ['/v1/catalogue/directory', '/v1/ghii/list', '/v1/cortex', '/v1/trusted-issuers']) {
        const r = await json(path, auth(aTok));
        assert(r.status !== 403, `${path}: the account holder was refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${aName}`, { ...auth(aTok), method: 'DELETE' });
    await json(`/v1/owners/${bName}`, { ...auth(bTok), method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
