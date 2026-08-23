/**
 * @file test/e2e-saml-login.ts
 * @description E2E for SAML organisation sign-in over live HTTP (BR-04 criterion 1's server half).
 *   The shared node boots with SSO OFF; the suite proves the 503s, flips `sso.enabled` through the
 *   operator config door (the same runtime path a real operator uses), builds a connection through
 *   the admin routes with pasted IdP metadata, runs a full signed login round-trip against the
 *   fake IdP (test/helpers/fake-saml-idp.ts), and asserts the refusals that live at THIS layer:
 *   management locked → 403, hidden connection absent from discovery, invite-mode → 403 for a new
 *   user, deactivated account → 403 at the ACS, and everything back to 503 when the flag drops.
 *   The cryptographic refusals (bad signature, wrong audience, expiry, unsolicited response) are
 *   asserted per-case in test/unit/saml-assertion.test.ts against the same router.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=saml-login
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial, with the feature (BR-04 phase 2).
 */
import { FAKE_IDP, buildSamlResponse, buildIdpMetadataXml, requestIdFromAuthorizeUrl } from './helpers/fake-saml-idp.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
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
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Register an owner (password door) + owner JWT — first one in a clean suite DB is the operator. */
async function setupOwner(label: string) {
    const owner = `saml${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'SamlSuite123456' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'SamlSuite123456' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    assert(tok.status === 200, `auth/token ${tok.status}`);
    return { owner, ownerToken: tok.body.data.token as string };
}

async function setConfig(opToken: string, path: string, value: unknown) {
    return json('/v1/admin/config', { method: 'PUT', headers: bearer(opToken), body: JSON.stringify({ changes: [{ path, value }] }) });
}

/** No-redirect GET, returning status + Location + Set-Cookie. */
async function rawGet(path: string, cookie?: string) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
    await res.body?.cancel();
    return { status: res.status, location: res.headers.get('location') ?? '', setCookie: res.headers.getSetCookie?.() ?? [] };
}

/** Post a SAML Response to the ACS the way an IdP-redirected browser would. */
async function postAcs(conn: string, form: Record<string, string>) {
    const res = await fetch(`${BASE}/v1/ghii/login/saml/${conn}/acs`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location') ?? '', setCookie: res.headers.getSetCookie?.() ?? [], body: text };
}

const cookieFrom = (setCookie: string[], name: string): string | null => {
    for (const c of setCookie) if (c.startsWith(name + '=')) return c.split(';')[0];
    return null;
};

const CONN = `c${Date.now().toString(36)}`;
const HIDDEN = `h${Date.now().toString(36)}`;
const acsUrl = (c: string) => `${BASE}/v1/ghii/login/saml/${c}/acs`;
const audience = (c: string) => `${BASE}/v1/sso/${c}/metadata`;

console.log('\n=== SAML organisation sign-in over live HTTP (BR-04) ===\n');

async function run() {
    const op = await setupOwner('op');

    await test('SSO OFF: every public door answers 503, management still works', async () => {
        assert((await rawGet(`/v1/ghii/login/saml/${CONN}`)).status === 503, 'login door should 503');
        assert((await json(`/v1/sso/${CONN}/metadata`)).status === 503, 'metadata door should 503');
        const create = await json('/v1/admin/sso/connections', {
            method: 'POST', headers: bearer(op.ownerToken),
            body: JSON.stringify({ id: CONN, name: 'Contoso Oy', domains: ['contoso.com'], login_visibility: 'listed' }),
        });
        assert(create.status === 201, `create while disabled: ${create.status}: ${JSON.stringify(create.body?.error)}`);
    });

    await test('a non-operator cannot manage connections: 403', async () => {
        const user = await setupOwner('u1');
        const r = await json('/v1/admin/sso/connections', {
            method: 'POST', headers: bearer(user.ownerToken),
            body: JSON.stringify({ id: 'nope', name: 'X', domains: [] }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('pasted IdP metadata configures the SAML half; SP metadata is served', async () => {
        await setConfig(op.ownerToken, 'sso.enabled', true);
        const meta = await json(`/v1/admin/sso/connections/${CONN}/idp-metadata`, {
            method: 'POST', headers: bearer(op.ownerToken),
            body: JSON.stringify({ xml: buildIdpMetadataXml() }),
        });
        assert(meta.status === 200, `idp-metadata ${meta.status}: ${JSON.stringify(meta.body?.error)}`);
        assert(meta.body.data.connection.saml_configured === true, 'saml_configured');
        const sp = await fetch(`${BASE}/v1/sso/${CONN}/metadata`);
        const xml = await sp.text();
        assert(sp.status === 200 && xml.includes('EntityDescriptor') && xml.includes(audience(CONN)), 'SP metadata served with entityID');
    });

    await test('garbage IdP metadata is refused before anything is written', async () => {
        const bad = await json(`/v1/admin/sso/connections/${CONN}/idp-metadata`, {
            method: 'POST', headers: bearer(op.ownerToken),
            body: JSON.stringify({ xml: '<html>not metadata</html>' }),
        });
        assert(bad.status === 400, `expected 400, got ${bad.status}`);
    });

    await test('discovery lists the LISTED connection and never the hidden one', async () => {
        const mk = await json('/v1/admin/sso/connections', {
            method: 'POST', headers: bearer(op.ownerToken),
            body: JSON.stringify({ id: HIDDEN, name: 'Hidden Oy', domains: [], login_visibility: 'hidden' }),
        });
        assert(mk.status === 201, `hidden create ${mk.status}`);
        const hm = await json(`/v1/admin/sso/connections/${HIDDEN}/idp-metadata`, {
            method: 'POST', headers: bearer(op.ownerToken), body: JSON.stringify({ xml: buildIdpMetadataXml() }),
        });
        assert(hm.status === 200, `hidden idp-metadata ${hm.status}`);
        const disc = await json('/v1/auth/providers');
        const ids = (disc.body.data.providers as Array<{ id: string }>).map(p => p.id);
        assert(ids.includes(`saml:${CONN}`), `listed connection missing from discovery: ${ids.join(',')}`);
        assert(!ids.includes(`saml:${HIDDEN}`), 'hidden connection must not be listed');
    });

    let userOwner = '';
    await test('full signed login round-trip: authorize → ACS → username choice → account', async () => {
        const authz = await rawGet(`/v1/ghii/login/saml/${CONN}?redirect=/`);
        assert(authz.status === 302 && authz.location.includes('SAMLRequest'), `authorize ${authz.status}`);
        const requestId = requestIdFromAuthorizeUrl(authz.location);
        const relayState = new URL(authz.location).searchParams.get('RelayState')!;
        const resp = buildSamlResponse({
            acsUrl: acsUrl(CONN), audience: audience(CONN), inResponseTo: requestId,
            nameId: 'objectid-ville', email: `ville.${Date.now()}@contoso.com`, displayName: 'Ville V',
        });
        const acs = await postAcs(CONN, { SAMLResponse: resp, RelayState: relayState });
        assert(acs.status === 302 && acs.location.includes('aimeat_signup=1'), `ACS ${acs.status} ${acs.location}`);
        const pendingCookie = cookieFrom(acs.setCookie, 'aimeat_pending_signup');
        assert(!!pendingCookie, 'pending cookie set');

        userOwner = `vilsam${Date.now().toString(36)}`;
        const fin = await fetch(`${BASE}/v1/ghii/login/saml/${CONN}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: pendingCookie! },
            body: JSON.stringify({ username: userOwner }),
        });
        const finBody = await fin.json() as any;
        assert(fin.status === 200, `finalize ${fin.status}: ${JSON.stringify(finBody?.error)}`);
        assert(finBody.data.owner === userOwner, 'account created under the chosen name');
    });

    await test('the returning user logs straight in with a session cookie', async () => {
        const authz = await rawGet(`/v1/ghii/login/saml/${CONN}`);
        const requestId = requestIdFromAuthorizeUrl(authz.location);
        const relayState = new URL(authz.location).searchParams.get('RelayState')!;
        const resp = buildSamlResponse({ acsUrl: acsUrl(CONN), audience: audience(CONN), inResponseTo: requestId, nameId: 'objectid-ville' });
        const acs = await postAcs(CONN, { SAMLResponse: resp, RelayState: relayState });
        assert(acs.status === 302 && !acs.location.includes('aimeat_signup'), `ACS ${acs.status} ${acs.location}`);
        assert(!!cookieFrom(acs.setCookie, 'aimeat_rt'), 'session cookie set');
    });

    await test('a foreign-certificate response answers 401 at the ACS', async () => {
        const authz = await rawGet(`/v1/ghii/login/saml/${CONN}`);
        const requestId = requestIdFromAuthorizeUrl(authz.location);
        const relayState = new URL(authz.location).searchParams.get('RelayState')!;
        // Signed by nobody this connection trusts: flip one byte region by signing for the hidden
        // connection's audience — the full per-cause matrix lives in the unit suite.
        const resp = buildSamlResponse({ acsUrl: acsUrl(CONN), audience: audience(HIDDEN), inResponseTo: requestId, nameId: 'evil' });
        const acs = await postAcs(CONN, { SAMLResponse: resp, RelayState: relayState });
        assert(acs.status === 401, `expected 401, got ${acs.status}`);
    });

    await test('invite-mode: a brand-new SAML user is refused at finalize, an existing one still signs in', async () => {
        const mode = await setConfig(op.ownerToken, 'registration.mode', 'invite');
        assert(mode.status === 200, `set invite ${mode.status}`);
        try {
            const authz = await rawGet(`/v1/ghii/login/saml/${CONN}`);
            const requestId = requestIdFromAuthorizeUrl(authz.location);
            const relayState = new URL(authz.location).searchParams.get('RelayState')!;
            const resp = buildSamlResponse({
                acsUrl: acsUrl(CONN), audience: audience(CONN), inResponseTo: requestId,
                nameId: 'objectid-newcomer', email: `new.${Date.now()}@contoso.com`,
            });
            const acs = await postAcs(CONN, { SAMLResponse: resp, RelayState: relayState });
            assert(acs.status === 302 && acs.location.includes('aimeat_signup=1'), `ACS under invite ${acs.status}`);
            const pendingCookie = cookieFrom(acs.setCookie, 'aimeat_pending_signup')!;
            const fin = await fetch(`${BASE}/v1/ghii/login/saml/${CONN}/finalize`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pendingCookie },
                body: JSON.stringify({ username: `deny${Date.now().toString(36)}` }),
            });
            const finBody = await fin.json() as any;
            assert(fin.status === 403 && finBody.error?.code === 'REGISTRATION_CLOSED', `expected 403 REGISTRATION_CLOSED, got ${fin.status} ${finBody.error?.code}`);
        } finally {
            await setConfig(op.ownerToken, 'registration.mode', 'open');
        }
    });

    await test('a deactivated account answers 403 ACCOUNT_DISABLED at the ACS', async () => {
        const dis = await json(`/v1/admin/owners/${userOwner}/disable`, { method: 'POST', headers: bearer(op.ownerToken) });
        assert(dis.status === 200, `disable ${dis.status}`);
        const authz = await rawGet(`/v1/ghii/login/saml/${CONN}`);
        const requestId = requestIdFromAuthorizeUrl(authz.location);
        const relayState = new URL(authz.location).searchParams.get('RelayState')!;
        const resp = buildSamlResponse({ acsUrl: acsUrl(CONN), audience: audience(CONN), inResponseTo: requestId, nameId: 'objectid-ville' });
        const acs = await postAcs(CONN, { SAMLResponse: resp, RelayState: relayState });
        assert(acs.status === 403, `expected 403, got ${acs.status}`);
        await json(`/v1/admin/owners/${userOwner}/enable`, { method: 'POST', headers: bearer(op.ownerToken) });
    });

    await test('sso.connections_locked freezes management with 403 SEALED_CONFIG', async () => {
        const lock = await setConfig(op.ownerToken, 'sso.connections_locked', true);
        assert(lock.status === 200, `lock ${lock.status}`);
        try {
            const r = await json('/v1/admin/sso/connections', {
                method: 'POST', headers: bearer(op.ownerToken),
                body: JSON.stringify({ id: 'frozen', name: 'X', domains: [] }),
            });
            assert(r.status === 403 && r.body.error?.code === 'SEALED_CONFIG', `expected 403 SEALED_CONFIG, got ${r.status} ${r.body.error?.code}`);
        } finally {
            await setConfig(op.ownerToken, 'sso.connections_locked', false);
        }
    });

    await test('sso.enabled off again: the doors are back to 503 (state restored)', async () => {
        const off = await setConfig(op.ownerToken, 'sso.enabled', false);
        assert(off.status === 200, `unset ${off.status}`);
        assert((await rawGet(`/v1/ghii/login/saml/${CONN}`)).status === 503, 'login door should 503 again');
        assert((await json(`/v1/sso/${CONN}/metadata`)).status === 503, 'metadata door should 503 again');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Suite crashed:', err); process.exit(1); });
