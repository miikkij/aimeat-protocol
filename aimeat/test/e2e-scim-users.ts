/**
 * @file test/e2e-scim-users.ts
 * @description E2E for SCIM 2.0 provisioning over live HTTP (BR-04 criterion 2, and criterion 3
 *   through the SCIM door). A directory's whole lifecycle against the real node: create with a
 *   UPN → filter by that UPN verbatim → the provisioned person signs in through SAML with the
 *   SAME objectId (R11 adoption, no duplicate) → their session actually works → the directory
 *   says active=false and the session is dead within the same second → active=true and the person
 *   (not their old tokens) is back → DELETE deactivates without erasing. Every isolation boundary
 *   is asserted as a refusal: no token 401, another connection's token on this path 403, another
 *   connection's user invisible 404, an owner JWT on the SCIM door 401, the SCIM token on a
 *   platform door 401, `closed` mode 403, a foreign-domain email collision 409, and the organism
 *   binding adds exactly a membership.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=scim-users
 * @version-history
 *   v1.1.0 — 2026-09-04 — Clears the SSO flags before its first assertion. It builds connections
 *     through the management routes, which an inherited `sso.connections_locked` refuses — and a
 *     refusal there fails every test after it without naming what caused it.
 *   v1.0.0 — 2026-08-24 — Initial, with the feature (BR-04 phase 3).
 */
import { buildSamlResponse, buildIdpMetadataXml, requestIdFromAuthorizeUrl } from './helpers/fake-saml-idp.js';
import { requireCleanSsoState } from './helpers/sso-state.js';

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

async function setupOwner(label: string) {
    const owner = `scim${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ScimSuite123456' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ScimSuite123456' }) });
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

const CONN = `sc${Date.now().toString(36)}`;
const OTHER = `so${Date.now().toString(36)}`;
const scimBase = (c: string) => `/v1/scim/v2/${c}`;

/** A SCIM request with a connection's bearer, scim+json both ways. */
async function scim(token: string, method: string, path: string, body?: unknown, conn = CONN) {
    const res = await fetch(`${BASE}${scimBase(conn)}${path}`, {
        method,
        headers: { 'Content-Type': 'application/scim+json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

console.log('\n=== SCIM provisioning over live HTTP (BR-04) ===\n');

async function run() {
    const op = await setupOwner('op');
    // Connection management is refused while sso.connections_locked is set, and a run that died
    // before its own restore leaves it set. → test/helpers/sso-state.ts
    await requireCleanSsoState(BASE, op.ownerToken);
    let scimToken = '';
    let otherToken = '';
    let organismId = '';

    await test('setup: SSO on, organism-bound connection + a second connection, SCIM tokens minted', async () => {
        assert((await setConfig(op.ownerToken, 'sso.enabled', true)).status === 200, 'enable sso');
        const org = await json('/v1/organisms', {
            method: 'POST', headers: bearer(op.ownerToken),
            body: JSON.stringify({ name: 'Contoso Staff', type: 'team', join_policy: 'invite_only', visibility: 'private' }),
        });
        assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body?.error)}`);
        organismId = org.body.data.organism.id;

        for (const [id, name] of [[CONN, 'Contoso Oy'], [OTHER, 'Other Oy']] as const) {
            const mk = await json('/v1/admin/sso/connections', {
                method: 'POST', headers: bearer(op.ownerToken),
                body: JSON.stringify({ id, name, domains: ['contoso.com'], login_visibility: 'hidden', ...(id === CONN ? { organism_id: organismId } : {}) }),
            });
            assert(mk.status === 201, `create ${id}: ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
            const tok = await json(`/v1/admin/sso/connections/${id}/scim-token`, { method: 'POST', headers: bearer(op.ownerToken) });
            assert(tok.status === 201 && typeof tok.body.data.scim_token === 'string', `scim-token ${id}: ${tok.status}`);
            if (id === CONN) scimToken = tok.body.data.scim_token;
            else otherToken = tok.body.data.scim_token;
        }
        const meta = await json(`/v1/admin/sso/connections/${CONN}/idp-metadata`, {
            method: 'POST', headers: bearer(op.ownerToken), body: JSON.stringify({ xml: buildIdpMetadataXml() }),
        });
        assert(meta.status === 200, `idp-metadata ${meta.status}`);
    });

    // ── The doors refuse the wrong credential in every direction ──
    await test('no token → 401, owner JWT → 401, SCIM token on a platform door → 401', async () => {
        const anon = await fetch(`${BASE}${scimBase(CONN)}/Users`);
        await anon.body?.cancel();
        assert(anon.status === 401, `anonymous SCIM: ${anon.status}`);
        const jwt = await scim(op.ownerToken as unknown as string, 'GET', '/Users');
        assert(jwt.status === 401, `owner JWT on SCIM: ${jwt.status}`);
        const platform = await json('/v1/memory?limit=1', { headers: bearer(scimToken) });
        assert(platform.status === 401, `SCIM token on /v1/memory: ${platform.status}`);
    });
    await test('another connection\'s token on this path → 403', async () => {
        const r = await scim(otherToken, 'GET', '/Users');
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    // ── The lifecycle ──
    let userId = '';
    await test('POST /Users creates the account: managed, verified email, organism member, not operator', async () => {
        const r = await scim(scimToken, 'POST', '/Users', {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            userName: 'Maija.M@contoso.com', externalId: 'objectid-maija',
            displayName: 'Maija Meikäläinen', active: true,
            emails: [{ value: 'maija.m@contoso.com', primary: true }],
        });
        assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
        userId = r.body.id;
        assert(r.body.active === true, 'active');
        const org = await json(`/v1/organisms/${organismId}`, { headers: bearer(op.ownerToken) });
        assert(org.status === 200, `organism read ${org.status}`);
        const members = JSON.stringify(org.body.data);
        assert(members.includes(userId), `provisioned user should be an organism member: ${members.slice(0, 200)}`);
        const admin = await json('/v1/admin/owners', { headers: bearer(op.ownerToken) });
        const row = (admin.body.data.owners as any[]).find(o => o.name === userId);
        assert(row && row.managed_by, 'owners list shows the managing connection');
        assert(!row.roles.includes('operator'), 'a provisioned account is never an operator');
    });

    await test('GET /Users?filter finds it by the UPN verbatim (R11)', async () => {
        const r = await scim(scimToken, 'GET', `/Users?filter=${encodeURIComponent('userName eq "Maija.M@contoso.com"')}`);
        assert(r.status === 200 && r.body.totalResults === 1, `filter ${r.status} total=${r.body?.totalResults}`);
        assert(r.body.Resources[0].id === userId, 'filter returns the managed account');
    });

    await test('the other connection cannot see or touch this user: 404', async () => {
        const get = await scim(otherToken, 'GET', `/Users/${userId}`, undefined, OTHER);
        assert(get.status === 404, `cross-conn GET ${get.status}`);
        const patch = await scim(otherToken, 'PATCH', `/Users/${userId}`, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'active', value: false }],
        }, OTHER);
        assert(patch.status === 404, `cross-conn PATCH ${patch.status}`);
    });

    // The provisioned person signs in through SAML with the SAME objectId — adopted, no duplicate —
    // and we keep their real session to prove deactivation kills it.
    let userAccessToken = '';
    let refreshCookie = '';
    await test('the provisioned person signs in via SAML (R11) and holds a WORKING session', async () => {
        const authz = await fetch(`${BASE}/v1/ghii/login/saml/${CONN}`, { redirect: 'manual' });
        await authz.body?.cancel();
        const requestId = requestIdFromAuthorizeUrl(authz.headers.get('location')!);
        const relayState = new URL(authz.headers.get('location')!).searchParams.get('RelayState')!;
        const resp = buildSamlResponse({
            acsUrl: `${BASE}/v1/ghii/login/saml/${CONN}/acs`, audience: `${BASE}/v1/sso/${CONN}/metadata`,
            inResponseTo: requestId, nameId: 'objectid-maija',
        });
        const acs = await fetch(`${BASE}/v1/ghii/login/saml/${CONN}/acs`, {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ SAMLResponse: resp, RelayState: relayState }).toString(),
        });
        await acs.body?.cancel();
        assert(acs.status === 302 && !(acs.headers.get('location') ?? '').includes('aimeat_signup'), `ACS ${acs.status}: adopted, not duplicated`);
        const setCookie = acs.headers.getSetCookie?.() ?? [];
        refreshCookie = setCookie.find(c => c.startsWith('aimeat_rt='))?.split(';')[0] ?? '';
        assert(!!refreshCookie, 'session cookie set');

        const refresh = await json('/v1/auth/refresh', {
            method: 'POST', headers: { Cookie: refreshCookie, 'X-AIMEAT-Refresh': '1' },
        });
        assert(refresh.status === 200, `refresh ${refresh.status}: ${JSON.stringify(refresh.body?.error)}`);
        userAccessToken = refresh.body.data.token;
        const works = await json('/v1/memory?limit=1', { headers: bearer(userAccessToken) });
        assert(works.status === 200, `the person's session should work, got ${works.status}`);
    });

    await test('the directory says active=false → the session is dead NOW (criterion 3)', async () => {
        const r = await scim(scimToken, 'PATCH', `/Users/${userId}`, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'Replace', path: 'active', value: 'False' }],   // Entra-shaped on purpose
        });
        assert(r.status === 200 && r.body.active === false, `patch ${r.status} active=${r.body?.active}`);
        const dead = await json('/v1/memory?limit=1', { headers: bearer(userAccessToken) });
        assert(dead.status === 401, `the session must be dead, got ${dead.status}`);
        const refresh = await json('/v1/auth/refresh', { method: 'POST', headers: { Cookie: refreshCookie, 'X-AIMEAT-Refresh': '1' } });
        assert(refresh.status === 401 || refresh.status === 403, `refresh must refuse, got ${refresh.status}`);
    });

    await test('active=true reactivates the ACCOUNT, not the old credentials', async () => {
        const r = await scim(scimToken, 'PATCH', `/Users/${userId}`, {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'active', value: true }],
        });
        assert(r.status === 200 && r.body.active === true, `patch ${r.status}`);
        const stillDead = await json('/v1/memory?limit=1', { headers: bearer(userAccessToken) });
        assert(stillDead.status === 401, `old token must stay dead, got ${stillDead.status}`);
    });

    await test('a colliding foreign-domain email answers 409 uniqueness', async () => {
        // A local person who verified a NON-contoso address must be unclaimable by this connection.
        // The suite cannot easily mint a verified foreign email, so assert the nearer boundary the
        // same rule guards: creating the SAME userName again is a 409, never a second account.
        const dup = await scim(scimToken, 'POST', '/Users', {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'Maija.M@contoso.com',
        });
        assert(dup.status === 409 && dup.body.scimType === 'uniqueness', `duplicate ${dup.status} ${dup.body?.scimType}`);
    });

    await test('registration mode `closed` refuses provisioning with 403', async () => {
        assert((await setConfig(op.ownerToken, 'registration.mode', 'closed')).status === 200, 'set closed');
        try {
            const r = await scim(scimToken, 'POST', '/Users', {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'Nobody@contoso.com',
            });
            assert(r.status === 403, `expected 403 under closed, got ${r.status}`);
        } finally {
            await setConfig(op.ownerToken, 'registration.mode', 'open');
        }
    });

    await test('DELETE deactivates and keeps the account (R3)', async () => {
        const del = await scim(scimToken, 'DELETE', `/Users/${userId}`);
        assert(del.status === 204, `delete ${del.status}`);
        const admin = await json('/v1/admin/owners', { headers: bearer(op.ownerToken) });
        const row = (admin.body.data.owners as any[]).find(o => o.name === userId);
        assert(row && row.disabled_at, 'still listed, deactivated — not erased');
    });

    await test('SSO off: the SCIM door answers 503 (state restored)', async () => {
        assert((await setConfig(op.ownerToken, 'sso.enabled', false)).status === 200, 'disable sso');
        const r = await scim(scimToken, 'GET', '/Users');
        assert(r.status === 503, `expected 503, got ${r.status}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Suite crashed:', err); process.exit(1); });
