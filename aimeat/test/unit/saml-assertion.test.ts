/**
 * @file saml-assertion.test.ts
 * @description Integration tests for SAML organisation sign-in (routes/saml-login.ts +
 *   services/saml-sp.ts + the shared mapping tree in services/external-login.ts). Drives the real
 *   router against real in-memory SQLite storage with REAL signed SAML Responses from the fake
 *   IdP (test/helpers/fake-saml-idp.ts) — so the cryptographic refusals are exercised for real:
 *   unsigned, foreign-certificate, wrong-audience, expired, and unsolicited (IdP-initiated)
 *   responses. Plus the mapping order R11: returning by NameID, adoption of a SCIM-provisioned
 *   account, the domain-fenced email link, and the username-choice step for a brand-new user.
 * @usage cd aimeat && pnpm exec vitest run test/unit/saml-assertion.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 2).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { samlLoginRouter } from '../../src/routes/saml-login.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { FAKE_IDP, OTHER_IDP, buildSamlResponse, requestIdFromAuthorizeUrl } from '../helpers/fake-saml-idp.js';

const NODE_ID = 'aimeat-local-001-dev';
const emailHashOf = (email: string): string => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

interface RawResponse { status: number; location?: string; setCookie?: string[]; body: string }

function rawGet(url: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'], body }));
    }).on('error', reject);
  });
}

function rawPost(url: string, form: Record<string, string>, opts: { cookie?: string; json?: string } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.json ?? new URLSearchParams(form).toString();
    const headers: Record<string, string> = {
      'Content-Type': opts.json ? 'application/json' : 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(payload)),
    };
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    const req = http.request({ method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'], body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie: string[] | undefined, name: string): string | null {
  for (const c of setCookie ?? []) if (c.startsWith(name + '=')) return c.split(';')[0];
  return null;
}

describe('SAML organisation sign-in (saml-login router)', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let config: AimeatConfig;
  const CONN = 'contoso';
  const IDPI = 'idpinit';   // a second connection that allows IdP-initiated responses

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, ssoEnabled: true, registrationRateLimitMax: 10000, registrationRateLimitWindowMs: 60_000, loginRateLimitMax: 10000, loginRateLimitWindowMs: 60_000 };

    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(samlLoginRouter(config, storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;

    const now = new Date().toISOString();
    await storage.createSsoConnection({
      id: CONN, name: 'Contoso Oy', organismId: null, domains: ['contoso.com'],
      saml: { idpEntityId: FAKE_IDP.entityId, ssoUrl: 'https://fake-idp-one.example/sso', idpCerts: [FAKE_IDP.cert] },
      allowIdpInitiated: false, loginVisibility: 'listed', createdBy: 'op', createdAt: now, updatedAt: now,
    });
    await storage.createSsoConnection({
      id: IDPI, name: 'IdP-Initiated Oy', organismId: null, domains: [],
      saml: { idpEntityId: FAKE_IDP.entityId, ssoUrl: 'https://fake-idp-one.example/sso', idpCerts: [FAKE_IDP.cert] },
      allowIdpInitiated: true, loginVisibility: 'hidden', createdBy: 'op', createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  const acsUrl = (conn: string) => `${base}/v1/ghii/login/saml/${conn}/acs`;
  const audience = (conn: string) => `${base}/v1/sso/${conn}/metadata`;

  /** Run authorize (capturing the request id a real IdP would echo) and post a Response built by `mutate`. */
  async function spInitiated(conn: string, opts: Partial<Parameters<typeof buildSamlResponse>[0]> & { nameId: string }): Promise<RawResponse> {
    const authz = await rawGet(`${base}/v1/ghii/login/saml/${conn}`);
    expect(authz.status).toBe(302);
    const requestId = requestIdFromAuthorizeUrl(authz.location!);
    const relayState = new URL(authz.location!).searchParams.get('RelayState')!;
    const samlResponse = buildSamlResponse({
      acsUrl: acsUrl(conn), audience: audience(conn), inResponseTo: requestId, ...opts,
    });
    return rawPost(acsUrl(conn), { SAMLResponse: samlResponse, RelayState: relayState });
  }

  it('a brand-new user lands in the username-choice step, and finalize creates the account', async () => {
    const res = await spInitiated(CONN, { nameId: 'opaque-user-1', email: 'ville@contoso.com', displayName: 'Ville V' });
    expect(res.status).toBe(302);
    expect(res.location).toContain('aimeat_signup=1');
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup');
    expect(pendingCookie).toBeTruthy();
    expect(await storage.getGHIIByExternalId(`saml:${CONN}`, 'opaque-user-1')).toBeNull();

    const fin = await rawPost(`${base}/v1/ghii/login/saml/${CONN}/finalize`, {}, {
      cookie: pendingCookie!, json: JSON.stringify({ username: 'ville' }),
    });
    expect(fin.status).toBe(200);
    const created = await storage.getGHIIByExternalId(`saml:${CONN}`, 'opaque-user-1');
    expect(created).not.toBeNull();
    expect(created!.ownerName).toBe('ville');
    expect(created!.emailVerifiedAt).toBeTruthy();  // the organisation's IdP vouched for the address
  });

  it('a returning user logs straight in with a session cookie', async () => {
    const res = await spInitiated(CONN, { nameId: 'opaque-user-1', email: 'ville@contoso.com' });
    expect(res.status).toBe(302);
    expect(res.location).not.toContain('aimeat_signup');
    expect(cookieFrom(res.setCookie, 'aimeat_rt')).toBeTruthy();
  });

  it('R11: a SCIM-provisioned account is ADOPTED by NameID — no duplicate, no signup step', async () => {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'maija', displayName: 'Maija M', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'maija', nodeId: NODE_ID, ghii: `maija@${NODE_ID}`, displayName: 'Maija M',
      externalIdentities: { [`scim:${CONN}`]: 'objectid-maija' },
      verificationLevel: 1, verificationMethod: 'email', ownerName: 'maija', totpEnabled: false,
      createdAt: now, updatedAt: now,
    });

    const ownersBefore = (await storage.listOwners()).length;
    const res = await spInitiated(CONN, { nameId: 'objectid-maija' });   // opaque NameID, no email attribute
    expect(res.status).toBe(302);
    expect(res.location).not.toContain('aimeat_signup');
    expect(cookieFrom(res.setCookie, 'aimeat_rt')).toBeTruthy();
    expect((await storage.listOwners()).length).toBe(ownersBefore);
    const adopted = await storage.getGHII(`maija@${NODE_ID}`);
    expect(adopted!.externalIdentities).toMatchObject({ [`scim:${CONN}`]: 'objectid-maija', [`saml:${CONN}`]: 'objectid-maija' });
  });

  it('R5: a verified email IN the connection domains links an existing account', async () => {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'pekka', displayName: 'P', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'pekka', nodeId: NODE_ID, ghii: `pekka@${NODE_ID}`, displayName: 'P',
      emailHash: emailHashOf('pekka@contoso.com'), emailVerifiedAt: now, verificationLevel: 1,
      verificationMethod: 'email', ownerName: 'pekka', totpEnabled: false, createdAt: now, updatedAt: now,
    });
    const res = await spInitiated(CONN, { nameId: 'opaque-pekka', email: 'pekka@contoso.com' });
    expect(res.status).toBe(302);
    expect(res.location).not.toContain('aimeat_signup');
    const linked = await storage.getGHII(`pekka@${NODE_ID}`);
    expect(linked!.externalIdentities).toMatchObject({ [`saml:${CONN}`]: 'opaque-pekka' });
  });

  it('R5: a verified email OUTSIDE the connection domains is NOT linked — signup step instead', async () => {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'outsider', displayName: 'O', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'outsider', nodeId: NODE_ID, ghii: `outsider@${NODE_ID}`, displayName: 'O',
      emailHash: emailHashOf('outsider@gmail.com'), emailVerifiedAt: now, verificationLevel: 1,
      verificationMethod: 'email', ownerName: 'outsider', totpEnabled: false, createdAt: now, updatedAt: now,
    });
    const res = await spInitiated(CONN, { nameId: 'opaque-outsider', email: 'outsider@gmail.com' });
    expect(res.status).toBe(302);
    expect(res.location).toContain('aimeat_signup=1');   // NOT logged into the foreign account
    const untouched = await storage.getGHII(`outsider@${NODE_ID}`);
    expect(untouched!.externalIdentities?.[`saml:${CONN}`]).toBeUndefined();
  });

  // ── The cryptographic refusals: each one answers 401 and creates nothing ──

  it('a response signed by a DIFFERENT valid IdP key is refused', async () => {
    const res = await spInitiated(CONN, { nameId: 'evil-1', email: 'evil@contoso.com', signWith: OTHER_IDP.key });
    expect(res.status).toBe(401);
    expect(await storage.getGHIIByExternalId(`saml:${CONN}`, 'evil-1')).toBeNull();
  });

  it('an UNSIGNED response is refused', async () => {
    const res = await spInitiated(CONN, { nameId: 'evil-2', signWith: null });
    expect(res.status).toBe(401);
  });

  it('a wrong Audience is refused', async () => {
    const authz = await rawGet(`${base}/v1/ghii/login/saml/${CONN}`);
    const requestId = requestIdFromAuthorizeUrl(authz.location!);
    const samlResponse = buildSamlResponse({
      acsUrl: acsUrl(CONN), audience: 'https://some-other-sp.example/metadata', inResponseTo: requestId, nameId: 'evil-3',
    });
    const res = await rawPost(acsUrl(CONN), { SAMLResponse: samlResponse });
    expect(res.status).toBe(401);
  });

  it('an EXPIRED assertion is refused', async () => {
    const res = await spInitiated(CONN, { nameId: 'evil-4', notOnOrAfterMs: -60_000 });
    expect(res.status).toBe(401);
  });

  it('an unsolicited (IdP-initiated) response is refused when the connection does not allow it', async () => {
    const samlResponse = buildSamlResponse({ acsUrl: acsUrl(CONN), audience: audience(CONN), nameId: 'evil-5' });
    const res = await rawPost(acsUrl(CONN), { SAMLResponse: samlResponse });
    expect(res.status).toBe(401);
  });

  it('an IdP-initiated response IS accepted when the connection explicitly allows it', async () => {
    const samlResponse = buildSamlResponse({ acsUrl: acsUrl(IDPI), audience: audience(IDPI), nameId: 'tile-user-1', email: 'tile@example.org' });
    const res = await rawPost(acsUrl(IDPI), { SAMLResponse: samlResponse });
    expect(res.status).toBe(302);
    expect(res.location).toContain('aimeat_signup=1');   // brand-new user → username choice
  });

  // ── Doors ──

  it('an unknown connection answers 404', async () => {
    const res = await rawGet(`${base}/v1/ghii/login/saml/nosuch`);
    expect(res.status).toBe(404);
  });

  it('sso.enabled off answers 503 on every public door', async () => {
    config.ssoEnabled = false;
    try {
      expect((await rawGet(`${base}/v1/ghii/login/saml/${CONN}`)).status).toBe(503);
      expect((await rawPost(acsUrl(CONN), { SAMLResponse: 'x' })).status).toBe(503);
    } finally {
      config.ssoEnabled = true;
    }
  });
});
