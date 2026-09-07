/**
 * @file e2e-app-publish-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Proves publishing permission at all three HTTP doors with real device-authorized
 * agents and consented app grants. A refused publish must preserve the live app and its draft.
 * @usage node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-publish-scopes
 * @version-history
 *   v1.0.0 -- 2026-09-07 -- Review finding: inline, presigned and draft promotion lacked app:write.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `pubscope${Date.now()}`;
const filename = 'scope-target.html';
const grantApp = 'scope-client.html';
const redirect = 'http://localhost:9911/callback';
let ownerToken = '';
let passed = 0;
let failed = 0;
const b64 = (text: string) => Buffer.from(text).toString('base64');
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  PASS ${name}`); }
    catch (err) { failed++; console.error(`  FAIL ${name}: ${String(err)}`); }
}
async function json(path: string, token: string, body?: unknown, method = 'POST') {
    const response = await fetch(`${BASE}${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
}
function html(file: string, marker: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="aimeat-app" content="${file}"><meta name="aimeat-scopes" content="memory:read app:write">
<meta name="aimeat-locales" content="en fi"><link rel="stylesheet" href="/lib/aimeat-theme.css">
</head><body><main><h1>${marker}</h1><div id="login"></div></main>
<script src="/v1/libs/aimeat-auth.js"></script>
<script>AIMEAT.auth.mountLoginButton('#login', { onLogin: () => {} });</script></body></html>`;
}
async function publish(token: string, file: string, marker: string) {
    return json('/v1/apps', token, { filename: file, name: 'Publishing scopes', description: 'Publishing permission regression check.', content: b64(html(file, marker)) });
}
async function agent(scopes: string[]): Promise<string> {
    const d = await json('/v1/agents/device-authorize', '', { owner, agent_name: `scope${randomBytes(4).toString('hex')}` });
    assert(d.status === 200, `device authorize ${d.status}`);
    const v = await json('/v1/agents/verify', '', { user_code: d.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken });
    assert(v.status === 200, `device verify ${v.status}`);
    const t = await json('/v1/agents/device-token', '', { device_code: d.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    assert(t.status === 200 && t.body.token, `device token ${t.status}`);
    return t.body.token;
}
async function appGrant(scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ app: `${owner}/${grantApp}`, response_type: 'code', scope,
        redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${query}`, { redirect: 'manual' });
    const requestId = /req=([^&]+)/.exec(auth.headers.get('location') ?? '')?.[1];
    assert(typeof requestId === 'string', `app authorize ${auth.status}`);
    const consent = await json('/v1/app-grants/authorize-consent', ownerToken, { request_id: decodeURIComponent(requestId) });
    assert(consent.status === 200, `app consent ${consent.status}`);
    const code = new URL(consent.body.data.redirect_url).searchParams.get('code');
    const token = await json('/v1/app-grants/token', '', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    assert(token.status === 200 && token.body.data.access_token, `app token ${token.status}`);
    return token.body.data.access_token;
}
async function draft(marker: string) {
    const r = await json(`/v1/apps/${owner}/${filename}/draft`, ownerToken,
        { content: b64(html(filename, marker)), name: 'Publishing scopes', description: 'Publishing permission regression check.' }, 'PUT');
    assert(r.status === 200, `save draft ${r.status}: ${JSON.stringify(r.body.error)}`);
}
const doors = ['inline', 'presigned', 'draft'] as const;
async function invoke(door: typeof doors[number], token: string, marker: string) {
    if (door === 'inline') return publish(token, filename, marker);
    if (door === 'presigned') return json('/v1/apps', token, { mode: 'presigned', filename });
    return json(`/v1/apps/${owner}/${filename}/publish-draft`, token, {});
}
async function rawLive(): Promise<string> {
    const r = await fetch(`${BASE}/v1/apps/${owner}/${filename}?download=true`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(r.ok, `read live ${r.status}`);
    return r.text();
}
async function main() {
    const reg = await json('/v1/owners', '', { name: owner, public_key: 'placeholder' });
    assert(reg.status === 201, `register ${reg.status}`);
    const timestamp = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(owner + reg.body.node + timestamp), Buffer.from(reg.body.data.private_key, 'base64'))).toString('base64');
    const login = await json('/v1/auth/token', '', { owner, timestamp, signature: sig });
    assert(login.status === 200, `owner token ${login.status}`);
    ownerToken = login.body.data.token;
    try {
        const p = await publish(ownerToken, grantApp, 'grant-client');
        assert(p.status === 201, `publish grant client ${p.status}: ${JSON.stringify(p.body.error)}`);
        const readers = [['agent', await agent(['memory:read'])], ['app grant', await appGrant('memory:read')], ['anonymous', '']];
        for (const [label, token] of readers) {
            for (const door of doors) {
                await test(`${label}: ${door} refuses before changing live bytes or consuming the draft`, async () => {
                    const seed = await publish(ownerToken, filename, 'original-live');
                    assert(seed.status === 201, `seed ${seed.status}`);
                    await draft('pending-draft');
                    const before = await rawLive();
                    const r = await invoke(door, token, 'unauthorized-change');
                    assert(r.status === (token ? 403 : 401), `expected ${token ? 403 : 401}, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data?.upload_method)}`);
                    assert(await rawLive() === before, 'live bytes changed');
                    const saved = await json(`/v1/apps/${owner}/${filename}/draft`, ownerToken, undefined, 'GET');
                    assert(saved.status === 200, 'draft was consumed');
                });
            }
        }
        const writers = [['owner', ownerToken], ['agent', await agent(['memory:read', 'app:write'])], ['app grant', await appGrant('memory:read app:write')]];
        for (const [label, token] of writers) {
            for (const door of doors) {
                await test(`${label}: ${door} publishes with permission`, async () => {
                    const marker = `allowed-${label.replace(' ', '-')}-${door}`;
                    if (door === 'draft') await draft(marker);
                    const r = await invoke(door, token, marker);
                    assert(r.status === (door === 'presigned' ? 200 : 201), `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
                    if (door === 'presigned') {
                        assert(r.body.data.upload_url, 'missing upload URL');
                        const uploaded = await fetch(r.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: html(filename, marker) });
                        assert(uploaded.ok, `upload ${uploaded.status}: ${await uploaded.text()}`);
                    }
                    assert((await rawLive()).includes(marker), 'published bytes missing');
                });
            }
        }
        const other = `${owner}b`;
        const otherReg = await json('/v1/owners', '', { name: other, public_key: 'placeholder' });
        assert(otherReg.status === 201, `second owner ${otherReg.status}`);
        const otherTime = new Date().toISOString();
        const otherSig = Buffer.from(await ed.signAsync(new TextEncoder().encode(other + otherReg.body.node + otherTime),
            Buffer.from(otherReg.body.data.private_key, 'base64'))).toString('base64');
        const otherLogin = await json('/v1/auth/token', '', { owner: other, timestamp: otherTime, signature: otherSig });
        assert(otherLogin.status === 200, `second owner token ${otherLogin.status}`);
        const otherToken = otherLogin.body.data.token;
        try {
            for (const door of doors) {
                await test(`another owner: ${door} cannot overwrite the first owner's app`, async () => {
                    const before = await rawLive();
                    if (door === 'draft') {
                        await draft('first-owner-pending');
                        const r = await invoke(door, otherToken, 'cross-owner');
                        assert(r.status === 404, `cross-owner promotion ${r.status}`);
                        const saved = await json(`/v1/apps/${owner}/${filename}/draft`, ownerToken, undefined, 'GET');
                        assert(saved.status === 200, 'other owner consumed the draft');
                    } else {
                        // Publishing is caller-scoped: supplied owner fields cannot redirect the bucket.
                        const r = await json('/v1/apps', otherToken, { owner, ownerGaii: `${owner}@${reg.body.node}`,
                            filename, name: 'Other owner', description: 'Cross-owner publishing regression.',
                            ...(door === 'inline' ? { content: b64(html(filename, 'cross-owner')) } : { mode: 'presigned' }) });
                        assert(r.status === (door === 'presigned' ? 200 : 201), `own-bucket publishing ${r.status}`);
                        if (door === 'presigned') {
                            const uploaded = await fetch(r.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: html(filename, 'cross-owner') });
                            assert(uploaded.ok, `own-bucket upload ${uploaded.status}`);
                        }
                    }
                    assert(await rawLive() === before, 'another owner overwrote the first owner');
                });
            }
        } finally {
            const cleanup = await json(`/v1/owners/${other}`, otherToken, undefined, 'DELETE');
            assert(cleanup.status === 200, `second owner cleanup ${cleanup.status}`);
        }
    } finally {
        const cleanup = await json(`/v1/owners/${owner}`, ownerToken, undefined, 'DELETE');
        assert(cleanup.status === 200, `cleanup ${cleanup.status}`);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}
main().catch(err => { console.error(err); process.exitCode = 1; });
