/**
 * @file test/unit/login-round-host-cookie.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On an https node the sign-in round's browser binding and the pending sign-up cookie
 *   are cookies a same-site app, portfolio or company page cannot write (secaudit2026oct26,
 *   oauth-round-cookie.ts login-round-binding-cookie-settable-from-same-site-author-origin). Such a
 *   page can write a cookie for the apex under the old names, so a party could finish its own round in
 *   a visitor's browser (login CSRF). The requests here arrive as through the node's https proxy
 *   (X-Forwarded-Proto: https). The uses that stay: a round started and finished in one browser (OIDC
 *   and SAML), the username step and the finalize after it, and a round in flight across the deploy.
 * @usage pnpm exec vitest run test/unit/login-round-host-cookie.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { oauthLoginRouter } from '../../src/routes/oauth-login.js';
import { samlLoginRouter } from '../../src/routes/saml-login.js';
import { mapGoogleClaims, type OidcProvider } from '../../src/services/oidc-providers.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { bindingHash } from '../../src/services/oauth-round-secrets.js';
import type { OidcClient } from '../../src/services/oidc-client.js';
import { FAKE_IDP, buildSamlResponse, requestIdFromAuthorizeUrl } from '../helpers/fake-saml-idp.js';

const NODE_ID = 'aimeat-local-001-dev';
const PUBLIC = 'https://node.test';
const CONN = 'fabrikam';

interface Raw { status: number; location?: string; setCookie: string[]; body: string }

/** One request as through the https proxy, with an optional Cookie header; redirects are not followed. */
function call(method: string, url: string, opts: { cookie?: string; form?: Record<string, string>; json?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.json ?? (opts.form ? new URLSearchParams(opts.form).toString() : '');
    const headers: Record<string, string> = { 'X-Forwarded-Proto': 'https' };
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
/** The value of the one cookie whose name contains `part`, whatever its prefix. */
const valueOf = (setCookie: string[], part: string) => {
  const c = setCookie.find(x => x.split('=')[0].includes(part) && !x.split(';')[0].endsWith('='));
  return c ? c.split(';')[0].slice(c.indexOf('=') + 1) : '';
};
/** The old, prefix-less round cookie name a same-site page can write for the apex. */
const plainRoundName = (state: string) => `aimeat_oauth_${createHash('sha256').update(state).digest('hex').slice(0, 16)}`;

describe('the sign-in round and pending sign-up cookies on an https node', () => {
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
      return { authorizationUrl: `https://idp.example/auth?state=hostc-${counter}`, state: `hostc-${counter}`, nonce: `n-${counter}` };
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
    const opKey = await generateKeyPair();
    await storage.createOwner({ name: 'firstop', displayName: 'Op', publicKey: opKey.publicKey, roles: ['owner', 'operator'], createdAt: now });
    await storage.createGHII({
      username: 'firstop', nodeId: NODE_ID, ghii: `firstop@${NODE_ID}`, displayName: 'Op', ownerName: 'firstop',
      verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now,
    });
    await storage.createSsoConnection({
      id: CONN, name: 'Fabrikam Oy', organismId: null, domains: ['fabrikam.com'],
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
    const state = new URL(a.location!).searchParams.get('state')!;
    return { state, setCookie: a.setCookie, cookie: jar(a.setCookie), binding: valueOf(a.setCookie, 'aimeat_oauth_') };
  }
  const callback = (state: string, cookie?: string) =>
    call('GET', `${base}/v1/ghii/login/google/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie });

  it('OIDC: the round binding written under the old name by another page does not finish the round', async () => {
    const party = await startOidc({ sub: 'g-hostc-party', email: 'party@example.com', email_verified: true, name: 'Party' });
    expect(party.binding).not.toBe('');
    const visitor = await callback(party.state, `${plainRoundName(party.state)}=${party.binding}`);
    expect(visitor.location).toContain('auth_error=');
    expect(valueOf(visitor.setCookie, 'aimeat_pending_signup')).toBe('');
  });

  it('a pending sign-up token written under the old name by another page is not read', async () => {
    const party = await startOidc({ sub: 'g-hostc-pending', email: 'pending@example.com', email_verified: true, name: 'P' });
    const own = await callback(party.state, party.cookie);
    const token = valueOf(own.setCookie, 'aimeat_pending_signup');
    expect(token).not.toBe('');
    const read = await call('GET', `${base}/v1/ghii/login/pending`, { cookie: `aimeat_pending_signup=${token}` });
    expect(read.status).toBe(404);
    const fin = await call('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: `aimeat_pending_signup=${token}`, json: JSON.stringify({ username: 'hostcplanted' }) });
    expect(fin.status).toBe(400);
  });

  it('usage OIDC: a round started and finished in one browser reaches the username step and finalizes', async () => {
    const own = await startOidc({ sub: 'g-hostc-own', email: 'own@example.com', email_verified: true, name: 'Own' });
    const back = await callback(own.state, own.cookie);
    expect(back.location).toBe(`${PUBLIC}/?aimeat_signup=1`);
    const pendingJar = jar(back.setCookie);
    const read = await call('GET', `${base}/v1/ghii/login/pending`, { cookie: pendingJar });
    expect(read.status).toBe(200);
    const fin = await call('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: pendingJar, json: JSON.stringify({ username: 'hostcown' }) });
    expect(fin.status).toBe(200);
  });

  it('usage OIDC: a round started before the deploy, bound under the old name, still finishes', async () => {
    const state = `hostc-legacy-${randomUUID()}`;
    nextClaims = { sub: 'g-hostc-legacy', email: 'legacy@example.com', email_verified: true, name: 'Legacy' };
    await storage.createVerificationNonce({
      id: randomUUID(), owner: '', type: 'google_login', state, nonce: 'n', redirectUri: '/',
      payload: JSON.stringify({ binding: bindingHash('legacy-value') }),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    const r = await callback(state, `${plainRoundName(state)}=legacy-value`);
    expect(r.location).toBe(`${PUBLIC}/?aimeat_signup=1`);
  });

  async function startSaml(email: string) {
    const a = await call('GET', `${base}/v1/ghii/login/saml/${CONN}`);
    expect(a.status).toBe(302);
    const requestId = requestIdFromAuthorizeUrl(a.location!);
    const relayState = new URL(a.location!).searchParams.get('RelayState')!;
    const SAMLResponse = buildSamlResponse({
      acsUrl: `${PUBLIC}/v1/ghii/login/saml/${CONN}/acs`, audience: `${PUBLIC}/v1/sso/${CONN}/metadata`,
      inResponseTo: requestId, nameId: `opaque-${randomUUID()}`, email,
    });
    return { relayState, SAMLResponse, cookie: jar(a.setCookie), binding: valueOf(a.setCookie, 'aimeat_oauth_') };
  }
  const acs = (form: Record<string, string>, cookie?: string) => call('POST', `${base}/v1/ghii/login/saml/${CONN}/acs`, { form, cookie });

  it('SAML: the round binding written under the old name by another page does not finish the round', async () => {
    const party = await startSaml('party@fabrikam.com');
    const r = await acs({ SAMLResponse: party.SAMLResponse, RelayState: party.relayState }, `${plainRoundName(party.relayState)}=${party.binding}`);
    expect(r.location).toContain('auth_error=');
    expect(valueOf(r.setCookie, 'aimeat_pending_signup')).toBe('');
  });

  it('usage SAML: the browser that started the round finishes it', async () => {
    const own = await startSaml('own@fabrikam.com');
    const r = await acs({ SAMLResponse: own.SAMLResponse, RelayState: own.relayState }, own.cookie);
    expect(r.status).toBe(302);
    expect(r.location).toContain('aimeat_signup=1');
    expect(valueOf(r.setCookie, 'aimeat_pending_signup')).not.toBe('');
  });
});
