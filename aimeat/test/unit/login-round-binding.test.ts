/**
 * @file test/unit/login-round-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An external sign-in round finishes only in the browser that started it
 *   (secaudit2026oct22, oidc-saml-login-round-not-browser-bound). Two cookie jars stand for two
 *   browsers: A starts the round, B presents A's state (the OIDC callback) or A's SAML Response (the
 *   ACS). B is refused; A finishes. The node runs with an https base URL, as a node on the internet
 *   does; a plain-http node binds nothing (test/unit/oauth-login.test.ts, saml-assertion.test.ts).
 * @version-history
 *   2026-10-25 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { oauthLoginRouter } from '../../src/routes/oauth-login.js';
import { samlLoginRouter } from '../../src/routes/saml-login.js';
import { mapGoogleClaims, type OidcProvider } from '../../src/services/oidc-providers.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import type { OidcClient } from '../../src/services/oidc-client.js';
import { FAKE_IDP, buildSamlResponse, requestIdFromAuthorizeUrl } from '../helpers/fake-saml-idp.js';

const NODE_ID = 'aimeat-local-001-dev';
const PUBLIC = 'https://node.test';
const CONN = 'contoso';

interface Raw { status: number; location?: string; setCookie: string[]; body: string }

/** One request with an optional Cookie header; redirects are not followed. */
function call(method: string, url: string, opts: { cookie?: string; form?: Record<string, string>; json?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.json ?? (opts.form ? new URLSearchParams(opts.form).toString() : '');
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (payload) {
      headers['Content-Type'] = opts.json ? 'application/json' : 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [], body }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The `name=value` pairs a browser would send back, from a response's Set-Cookie list. */
const jar = (setCookie: string[]) => setCookie.map(c => c.split(';')[0]).filter(p => !p.endsWith('=')).join('; ');
const has = (setCookie: string[], name: string) => setCookie.some(c => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`));

describe('an external sign-in round is bound to the browser that started it', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let nextClaims: Record<string, unknown> = {};
  let counter = 0;

  const client: OidcClient = {
    initialized: true,
    async initialize() { /* no-op */ },
    createAuthRequest() {
      counter += 1;
      return { authorizationUrl: `https://idp.example/auth?state=bind-${counter}`, state: `bind-${counter}`, nonce: `n-${counter}` };
    },
    async exchangeCode() { return { valid: true, claims: nextClaims }; },
  };
  const google: OidcProvider = {
    id: 'google', label: 'Continue with Google', i18nKey: 'googleSignIn', enabled: true, client,
    scopes: ['openid', 'email', 'profile'], nonceType: 'google_login', mapClaims: mapGoogleClaims,
  };

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    const config: AimeatConfig = {
      ...loadConfig().config, nodeId: NODE_ID, baseUrl: PUBLIC, ssoEnabled: true,
      registrationRateLimitMax: 10000, registrationRateLimitWindowMs: 60_000, loginRateLimitMax: 10000, loginRateLimitWindowMs: 60_000,
    };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(oauthLoginRouter(config, storage, [google]));
    app.use(samlLoginRouter(config, storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const now = new Date().toISOString();
    // The node's first owner exists, so a sign-up through a provider is not the node's first account.
    const opKey = await generateKeyPair();
    await storage.createOwner({ name: 'firstop', displayName: 'Op', publicKey: opKey.publicKey, roles: ['owner', 'operator'], createdAt: now });
    await storage.createGHII({
      username: 'firstop', nodeId: NODE_ID, ghii: `firstop@${NODE_ID}`, displayName: 'Op', ownerName: 'firstop',
      verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now,
    });
    await storage.createSsoConnection({
      id: CONN, name: 'Contoso Oy', organismId: null, domains: ['contoso.com'],
      saml: { idpEntityId: FAKE_IDP.entityId, ssoUrl: 'https://fake-idp-one.example/sso', idpCerts: [FAKE_IDP.cert] },
      allowIdpInitiated: false, loginVisibility: 'listed', createdBy: 'op', createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  async function startOidc(claims: Record<string, unknown>) {
    nextClaims = claims;
    const a = await call('GET', `${base}/v1/ghii/login/google`);
    expect(a.status).toBe(302);
    return { state: new URL(a.location!).searchParams.get('state')!, cookie: jar(a.setCookie) };
  }
  const callback = (state: string, cookie?: string) =>
    call('GET', `${base}/v1/ghii/login/google/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie });

  it('OIDC: another browser presenting the round is refused, and gets neither the username step nor a session', async () => {
    const { state } = await startOidc({ sub: 'g-bind-new', email: 'bind-new@example.com', email_verified: true, name: 'New' });
    const b = await callback(state);
    expect(b.status).toBe(302);
    expect(b.location).toContain('auth_error=');
    expect(has(b.setCookie, 'aimeat_pending_signup')).toBe(false);
    expect(has(b.setCookie, 'aimeat_rt')).toBe(false);
  });

  it('OIDC: the browser that started the round finishes it (the designed use)', async () => {
    const { state, cookie } = await startOidc({ sub: 'g-bind-own', email: 'bind-own@example.com', email_verified: true, name: 'Own' });
    expect(cookie).toMatch(/aimeat_oauth_/);
    const a = await callback(state, cookie);
    expect(a.status).toBe(302);
    expect(a.location).toBe(`${PUBLIC}/?aimeat_signup=1`);
    expect(has(a.setCookie, 'aimeat_pending_signup')).toBe(true);
  });

  it('OIDC: a linked identity started elsewhere does not land its session in another browser', async () => {
    // Link a subject to an account first, in its own browser.
    const own = await startOidc({ sub: 'g-bind-linked', email: 'bind-linked@example.com', email_verified: true, name: 'L' });
    const first = await callback(own.state, own.cookie);
    const pending = jar(first.setCookie);
    const fin = await call('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: pending, json: JSON.stringify({ username: 'bindlinked' }) });
    expect(fin.status).toBe(200);
    // Now the same subject's round, presented by another browser.
    const { state } = await startOidc({ sub: 'g-bind-linked', email: 'bind-linked@example.com', email_verified: true, name: 'L' });
    const b = await callback(state);
    expect(b.location).toContain('auth_error=');
    expect(has(b.setCookie, 'aimeat_rt')).toBe(false);
  });

  it('OIDC: a round started before this change (a row with no binding) still finishes', async () => {
    const state = `legacy-${randomUUID()}`;
    nextClaims = { sub: 'g-bind-legacy', email: 'bind-legacy@example.com', email_verified: true, name: 'Legacy' };
    await storage.createVerificationNonce({
      id: randomUUID(), owner: '', type: 'google_login', state, nonce: 'n', redirectUri: '/',
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const r = await callback(state);
    expect(r.location).toBe(`${PUBLIC}/?aimeat_signup=1`);
  });

  async function startSaml() {
    const a = await call('GET', `${base}/v1/ghii/login/saml/${CONN}`);
    expect(a.status).toBe(302);
    const requestId = requestIdFromAuthorizeUrl(a.location!);
    const relayState = new URL(a.location!).searchParams.get('RelayState')!;
    const SAMLResponse = buildSamlResponse({
      acsUrl: `${PUBLIC}/v1/ghii/login/saml/${CONN}/acs`, audience: `${PUBLIC}/v1/sso/${CONN}/metadata`,
      inResponseTo: requestId, nameId: `opaque-${randomUUID()}`, email: 'bind@contoso.com',
    });
    return { relayState, SAMLResponse, cookie: jar(a.setCookie), setCookie: a.setCookie };
  }
  const acs = (form: Record<string, string>, cookie?: string) => call('POST', `${base}/v1/ghii/login/saml/${CONN}/acs`, { form, cookie });

  it('SAML: the round cookie rides a cross-site form post (SameSite=None; Secure)', async () => {
    const { setCookie } = await startSaml();
    const round = setCookie.find(c => c.startsWith('aimeat_oauth_'));
    expect(round).toBeTruthy();
    expect(round!).toMatch(/SameSite=None/i);
    expect(round!).toMatch(/Secure/i);
  });

  it('SAML: another browser posting the round\'s Response is refused, with or without RelayState', async () => {
    const one = await startSaml();
    const b = await acs({ SAMLResponse: one.SAMLResponse, RelayState: one.relayState });
    expect(b.location).toContain('auth_error=');
    expect(has(b.setCookie, 'aimeat_pending_signup')).toBe(false);
    const two = await startSaml();
    const c = await acs({ SAMLResponse: two.SAMLResponse });
    expect(c.location).toContain('auth_error=');
    expect(has(c.setCookie, 'aimeat_pending_signup')).toBe(false);
  });

  it('SAML: the browser that started the round finishes it (the designed use)', async () => {
    const { relayState, SAMLResponse, cookie } = await startSaml();
    const a = await acs({ SAMLResponse, RelayState: relayState }, cookie);
    expect(a.status).toBe(302);
    expect(a.location).toContain('aimeat_signup=1');
    expect(has(a.setCookie, 'aimeat_pending_signup')).toBe(true);
  });
});
