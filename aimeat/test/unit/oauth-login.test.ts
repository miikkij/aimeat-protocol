/**
 * @file oauth-login.test.ts
 * @description Integration tests for multi-provider social login (routes/oauth-login.ts + the
 *   provider registry in services/oidc-providers.ts). Drives the real router against real in-memory
 *   SQLite storage with FAKE OIDC clients (no network IdP), covering the account-mapping decisions
 *   for Google, Casdoor, and Microsoft Entra ID: create-new (username-choice), returning-by-subject,
 *   link-by-verified-email, no-link-when-local-email-unverified, cross-provider linking, Entra
 *   tenant gating + email-claim fallback, the failure redirects, and the /v1/auth/providers discovery.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial suite (Google sign-in mapping + session establishment).
 *   v1.1.0 — 2026-06-25 — Brand-new users now go through the one-time username-choice step
 *     (pending cookie → /login/pending → /login/google/finalize); cover that flow + fallbacks.
 *   v2.0.0 — 2026-07-01 — Generalised to the provider registry: router now takes OidcProvider[].
 *     Added Casdoor + Entra coverage (incl. tenant gating, email fallback, cross-provider link) and
 *     the /v1/auth/providers discovery assertion; Google behaviour is unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { oauthLoginRouter } from '../../src/routes/oauth-login.js';
import {
  mapGoogleClaims, mapCasdoorClaims, makeEntraMapper, makeEntraValidator, type OidcProvider,
} from '../../src/services/oidc-providers.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import type { OidcClient } from '../../src/services/oidc-client.js';

const NODE_ID = 'aimeat-local-001-dev';
const ENTRA_TENANT = '11111111-1111-1111-1111-111111111111'; // pinned single-tenant GUID for gating tests

function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** A fake OIDC client: createAuthRequest yields a unique (prefixed) state; exchangeCode returns canned claims. */
function makeFakeClient(prefix: string) {
  let counter = 0;
  let nextClaims: Record<string, unknown> = {};
  let nextValid = true;
  const client: OidcClient = {
    initialized: true,
    async initialize() { /* no-op */ },
    createAuthRequest() {
      counter += 1;
      return {
        authorizationUrl: `https://idp.example/auth?state=${prefix}-${counter}`,
        state: `${prefix}-${counter}`,
        nonce: `${prefix}-no-${counter}`,
      };
    },
    async exchangeCode() {
      return nextValid ? { valid: true, claims: nextClaims } : { valid: false, error: 'bad' };
    },
  };
  return {
    client,
    setClaims(c: Record<string, unknown>) { nextClaims = c; nextValid = true; },
    setInvalid() { nextValid = false; },
  };
}

const googleProvider = (client: OidcClient | null, enabled = true): OidcProvider => ({
  id: 'google', label: 'Continue with Google', i18nKey: 'googleSignIn',
  enabled, client, scopes: ['openid', 'email', 'profile'], nonceType: 'google_login', mapClaims: mapGoogleClaims,
});
const casdoorProvider = (client: OidcClient | null, enabled = true): OidcProvider => ({
  id: 'casdoor', label: 'Continue with Casdoor', i18nKey: 'casdoorSignIn',
  enabled, client, scopes: ['openid', 'email', 'profile'], nonceType: 'casdoor_login', mapClaims: mapCasdoorClaims,
});
const entraProvider = (client: OidcClient | null, enabled = true): OidcProvider => ({
  id: 'entra', label: 'Continue with Microsoft', i18nKey: 'entraSignIn',
  enabled, client, scopes: ['openid', 'email', 'profile'], nonceType: 'entra_login',
  mapClaims: makeEntraMapper(ENTRA_TENANT), validateClaims: makeEntraValidator(ENTRA_TENANT),
});

interface RawResponse { status: number; location?: string; setCookie?: string[]; body: string }

/** Minimal HTTP GET that does NOT follow redirects — returns status + headers + body. */
function rawGet(url: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        location: res.headers.location,
        setCookie: res.headers['set-cookie'],
        body,
      }));
    }).on('error', reject);
  });
}

/** HTTP request with an optional Cookie header + JSON body (for the pending/finalize flow). */
function rawReq(method: string, url: string, opts: { cookie?: string; body?: string } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = {};
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    if (opts.body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(opts.body)); }
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'], body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Pull a single `name=value` cookie pair out of a Set-Cookie header array. */
function cookieFrom(setCookie: string[] | undefined, name: string): string | null {
  for (const c of setCookie ?? []) if (c.startsWith(name + '=')) return c.split(';')[0];
  return null;
}

describe('Multi-provider social login (oauth-login router)', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let fakeGoogle: ReturnType<typeof makeFakeClient>;
  let fakeCasdoor: ReturnType<typeof makeFakeClient>;
  let fakeEntra: ReturnType<typeof makeFakeClient>;
  let config: AimeatConfig;

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    // High finalize rate limit so the many finalize calls across this suite aren't throttled
    // (the rate limiter itself is not under test here).
    config = { ...loadConfig().config, nodeId: NODE_ID, registrationRateLimitMax: 10000, registrationRateLimitWindowMs: 60_000 };

    // Node signing keys are required for issueJWT() inside establishOwnerSession().
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);

    fakeGoogle = makeFakeClient('g');
    fakeCasdoor = makeFakeClient('c');
    fakeEntra = makeFakeClient('e');
    const app = express();
    app.use(express.json());
    app.use(oauthLoginRouter(config, storage, [
      googleProvider(fakeGoogle.client),
      casdoorProvider(fakeCasdoor.client),
      entraProvider(fakeEntra.client),
    ]));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
    // baseUrl drives the redirect target the route emits.
    config.baseUrl = base;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  /** Run the full authorize→callback dance for a given provider + claims. */
  async function loginWith(providerId: string, fake: ReturnType<typeof makeFakeClient>, claims: Record<string, unknown>) {
    fake.setClaims(claims);
    const authz = await rawGet(`${base}/v1/ghii/login/${providerId}`);
    expect(authz.status).toBe(302);
    const state = new URL(authz.location!).searchParams.get('state')!;
    return rawGet(`${base}/v1/ghii/login/${providerId}/callback?code=abc&state=${encodeURIComponent(state)}`);
  }

  // ── Google (behaviour preserved from v1) ──

  it('first-time Google user gets the one-time username-choice step; finalize creates it with the CHOSEN name', async () => {
    const res = await loginWith('google', fakeGoogle, { sub: 'g-new-1', email: 'newuser@example.com', email_verified: true, name: 'New User' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?aimeat_signup=1`);
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup');
    expect(pendingCookie).toBeTruthy();
    expect((res.setCookie ?? []).some((c) => c.startsWith('aimeat_rt='))).toBe(false);
    expect(await storage.getGHIIByExternalId('google', 'g-new-1')).toBeNull();

    const pending = await rawReq('GET', `${base}/v1/ghii/login/pending`, { cookie: pendingCookie! });
    expect(pending.status).toBe(200);
    const pendingData = JSON.parse(pending.body).data;
    expect(pendingData.suggested).toBe('newuser');
    expect(pendingData.email).toBe('newuser@example.com');
    expect(pendingData.provider).toBe('google');

    const fin = await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, {
      cookie: pendingCookie!, body: JSON.stringify({ username: 'chosenname' }),
    });
    expect(fin.status).toBe(200);
    expect((fin.setCookie ?? []).some((c) => c.startsWith('aimeat_rt='))).toBe(true);

    const ghii = await storage.getGHIIByExternalId('google', 'g-new-1');
    expect(ghii).not.toBeNull();
    expect(ghii!.username).toBe('chosenname');
    expect(ghii!.googleSub).toBe('g-new-1'); // mirror kept for google
    expect(ghii!.externalIdentities).toMatchObject({ google: 'g-new-1' });
    expect(ghii!.emailVerifiedAt).toBeTruthy();
    expect(ghii!.verificationLevel).toBe(1);
    expect(ghii!.emailHash).toBe(emailHashOf('newuser@example.com'));
  });

  it('finalize falls back to the suggested username when none is provided', async () => {
    const res = await loginWith('google', fakeGoogle, { sub: 'g-blank-1', email: 'blankchoice@example.com', email_verified: true, name: 'Blank Choice' });
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup')!;
    const fin = await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: pendingCookie, body: JSON.stringify({}) });
    expect(fin.status).toBe(200);
    const ghii = await storage.getGHIIByExternalId('google', 'g-blank-1');
    expect(ghii!.username).toBe('blankchoice');
  });

  it('finalize uses the CHOSEN display name, and falls back to the provider name when blank', async () => {
    // Chosen display name overrides the provider-supplied one.
    const r1 = await loginWith('google', fakeGoogle, { sub: 'g-dn-1', email: 'dn1@example.com', email_verified: true, name: 'Provider Name 1' });
    const c1 = cookieFrom(r1.setCookie, 'aimeat_pending_signup')!;
    await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: c1, body: JSON.stringify({ username: 'dnuser1', displayName: 'My Chosen Name' }) });
    expect((await storage.getGHIIByExternalId('google', 'g-dn-1'))!.displayName).toBe('My Chosen Name');

    // Blank/whitespace display name → falls back to the provider claim.
    const r2 = await loginWith('google', fakeGoogle, { sub: 'g-dn-2', email: 'dn2@example.com', email_verified: true, name: 'Provider Name 2' });
    const c2 = cookieFrom(r2.setCookie, 'aimeat_pending_signup')!;
    await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: c2, body: JSON.stringify({ username: 'dnuser2', displayName: '   ' }) });
    expect((await storage.getGHIIByExternalId('google', 'g-dn-2'))!.displayName).toBe('Provider Name 2');
  });

  it('finalize rejects a taken username (409) and a blank pending (400)', async () => {
    const res = await loginWith('google', fakeGoogle, { sub: 'g-dup-1', email: 'dup@example.com', email_verified: true, name: 'Dup' });
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup')!;
    const dup = await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: pendingCookie, body: JSON.stringify({ username: 'chosenname' }) });
    expect(dup.status).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('NAME_TAKEN');
    expect(await storage.getGHIIByExternalId('google', 'g-dup-1')).toBeNull();

    const noPending = await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { body: JSON.stringify({ username: 'whatever' }) });
    expect(noPending.status).toBe(400);
    expect(JSON.parse(noPending.body).error.code).toBe('NO_PENDING_SIGNUP');
  });

  it('GET /v1/ghii/login/pending 404s without the signed cookie', async () => {
    const res = await rawReq('GET', `${base}/v1/ghii/login/pending`);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NO_PENDING_SIGNUP');
  });

  it('GET /v1/ghii/username-available reports valid/available, taken, and invalid', async () => {
    const free = await rawReq('GET', `${base}/v1/ghii/username-available?name=brandnewname`);
    expect(JSON.parse(free.body).data).toMatchObject({ valid: true, available: true });

    const taken = await rawReq('GET', `${base}/v1/ghii/username-available?name=chosenname`);
    expect(JSON.parse(taken.body).data).toMatchObject({ valid: true, available: false });

    const invalid = await rawReq('GET', `${base}/v1/ghii/username-available?name=ab`);
    expect(JSON.parse(invalid.body).data.valid).toBe(false);
  });

  it('logs a returning Google user into the SAME account (matched by subject)', async () => {
    const before = (await storage.listOwners()).length;
    const res = await loginWith('google', fakeGoogle, { sub: 'g-new-1', email: 'newuser@example.com', email_verified: true, name: 'New User' });
    expect(res.status).toBe(302);
    const after = (await storage.listOwners()).length;
    expect(after).toBe(before);
    const ghii = await storage.getGHIIByExternalId('google', 'g-new-1');
    expect(ghii!.loginCount).toBeGreaterThanOrEqual(2);
  });

  it('links to an existing account when Googleʼs verified email matches a locally-verified GHII', async () => {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'linkme', displayName: 'Link Me', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'linkme', nodeId: NODE_ID, ghii: `linkme@${NODE_ID}`, displayName: 'Link Me',
      emailHash: emailHashOf('linkme@example.com'), emailVerifiedAt: now, verificationLevel: 1,
      verificationMethod: 'email', ownerName: 'linkme', totpEnabled: false, createdAt: now, updatedAt: now,
    });

    const ownersBefore = (await storage.listOwners()).length;
    const res = await loginWith('google', fakeGoogle, { sub: 'g-link-1', email: 'linkme@example.com', email_verified: true, name: 'Link Me' });
    expect(res.status).toBe(302);

    const linked = await storage.getGHII(`linkme@${NODE_ID}`);
    expect(linked!.googleSub).toBe('g-link-1');
    expect(linked!.externalIdentities).toMatchObject({ google: 'g-link-1' });
    expect((await storage.listOwners()).length).toBe(ownersBefore);
  });

  it('does NOT link (sends to the username-choice step) when the matching local email is unverified', async () => {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'claimer', displayName: 'Claimer', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'claimer', nodeId: NODE_ID, ghii: `claimer@${NODE_ID}`, displayName: 'Claimer',
      emailHash: emailHashOf('claimed@example.com'), verificationLevel: 0,
      ownerName: 'claimer', totpEnabled: false, createdAt: now, updatedAt: now,
    });

    const res = await loginWith('google', fakeGoogle, { sub: 'g-claim-1', email: 'claimed@example.com', email_verified: true, name: 'Real Owner' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?aimeat_signup=1`);

    const claimer = await storage.getGHII(`claimer@${NODE_ID}`);
    expect(claimer!.googleSub).toBeUndefined();
    expect(await storage.getGHIIByExternalId('google', 'g-claim-1')).toBeNull();
  });

  it('redirects with auth_error on an invalid state / missing code (Google error-code prefix preserved)', async () => {
    const badState = await rawGet(`${base}/v1/ghii/login/google/callback?code=abc&state=does-not-exist`);
    expect(badState.status).toBe(302);
    expect(badState.location).toBe(`${base}/?auth_error=GOOGLE_INVALID_STATE`);

    const noCode = await rawGet(`${base}/v1/ghii/login/google/callback?state=whatever`);
    expect(noCode.status).toBe(302);
    expect(noCode.location).toBe(`${base}/?auth_error=GOOGLE_MISSING_CODE`);
  });

  // ── Casdoor ──

  it('first-time Casdoor user → username-choice → finalize creates the account (externalIdentities.casdoor set)', async () => {
    const res = await loginWith('casdoor', fakeCasdoor, { sub: 'cas-1', email: 'casuser@corp.example', name: 'Cas User' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?aimeat_signup=1`);
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup')!;

    const pending = await rawReq('GET', `${base}/v1/ghii/login/pending`, { cookie: pendingCookie });
    expect(JSON.parse(pending.body).data.provider).toBe('casdoor');

    const fin = await rawReq('POST', `${base}/v1/ghii/login/casdoor/finalize`, { cookie: pendingCookie, body: JSON.stringify({ username: 'casaccount' }) });
    expect(fin.status).toBe(200);
    const ghii = await storage.getGHIIByExternalId('casdoor', 'cas-1');
    expect(ghii).not.toBeNull();
    expect(ghii!.username).toBe('casaccount');
    expect(ghii!.externalIdentities).toMatchObject({ casdoor: 'cas-1' });
    expect(ghii!.googleSub).toBeUndefined(); // no google mirror for non-google providers
  });

  it('returning Casdoor user logs into the SAME account (matched by subject)', async () => {
    const before = (await storage.listOwners()).length;
    const res = await loginWith('casdoor', fakeCasdoor, { sub: 'cas-1', email: 'casuser@corp.example', name: 'Cas User' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/`); // straight to session, no signup flag
    expect((await storage.listOwners()).length).toBe(before);
  });

  it('Casdoor callback redirects with CASDOOR_ error-code prefix on invalid state / missing code', async () => {
    const badState = await rawGet(`${base}/v1/ghii/login/casdoor/callback?code=abc&state=nope`);
    expect(badState.location).toBe(`${base}/?auth_error=CASDOOR_INVALID_STATE`);
    const noCode = await rawGet(`${base}/v1/ghii/login/casdoor/callback?state=whatever`);
    expect(noCode.location).toBe(`${base}/?auth_error=CASDOOR_MISSING_CODE`);
  });

  it('cross-provider: a verified-email Casdoor login links into the existing Google account (one GHII, two identities)', async () => {
    // Seed a Google account with a verified email.
    const seed = await loginWith('google', fakeGoogle, { sub: 'g-x-1', email: 'shared@corp.example', email_verified: true, name: 'Shared' });
    const seedCookie = cookieFrom(seed.setCookie, 'aimeat_pending_signup')!;
    await rawReq('POST', `${base}/v1/ghii/login/google/finalize`, { cookie: seedCookie, body: JSON.stringify({ username: 'shareduser' }) });
    const ownersBefore = (await storage.listOwners()).length;

    // Now the SAME person signs in with Casdoor using the same (verified) email.
    const res = await loginWith('casdoor', fakeCasdoor, { sub: 'cas-x-1', email: 'shared@corp.example', name: 'Shared' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/`); // linked → straight to session, not signup

    const ghii = await storage.getGHII(`shareduser@${NODE_ID}`);
    expect(ghii!.externalIdentities).toMatchObject({ google: 'g-x-1', casdoor: 'cas-x-1' });
    expect((await storage.listOwners()).length).toBe(ownersBefore); // no new owner
  });

  // ── Microsoft Entra ID (single-tenant gating) ──

  it('Entra rejects a token from a different tenant (ENTRA_WRONG_TENANT)', async () => {
    const res = await loginWith('entra', fakeEntra, { sub: 'ent-bad', tid: '99999999-9999-9999-9999-999999999999', preferred_username: 'x@other.example', name: 'Other' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?auth_error=ENTRA_WRONG_TENANT`);
    expect(await storage.getGHIIByExternalId('entra', 'ent-bad')).toBeNull();
  });

  it('Entra maps email from preferred_username when no email claim, for the correct tenant', async () => {
    const res = await loginWith('entra', fakeEntra, { sub: 'ent-1', tid: ENTRA_TENANT, preferred_username: 'alice@corp.example', name: 'Alice' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?aimeat_signup=1`);
    const pendingCookie = cookieFrom(res.setCookie, 'aimeat_pending_signup')!;
    const pending = await rawReq('GET', `${base}/v1/ghii/login/pending`, { cookie: pendingCookie });
    const data = JSON.parse(pending.body).data;
    expect(data.provider).toBe('entra');
    expect(data.email).toBe('alice@corp.example'); // fell back to preferred_username
    expect(data.suggested).toBe('alice');
  });

  // ── Discovery + disabled guard ──

  it('GET /v1/auth/providers lists the enabled providers', async () => {
    const res = await rawReq('GET', `${base}/v1/auth/providers`);
    expect(res.status).toBe(200);
    const ids = JSON.parse(res.body).data.providers.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['casdoor', 'entra', 'google']);
    const google = JSON.parse(res.body).data.providers.find((p: { id: string }) => p.id === 'google');
    expect(google.loginUrl).toBe('/v1/ghii/login/google');
  });

  it('returns 503 from authorize when a provider is not configured', async () => {
    const app = express();
    app.use(oauthLoginRouter(config, storage, [googleProvider(null, false)]));
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await rawGet(`http://127.0.0.1:${port}/v1/ghii/login/google`);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(res.status).toBe(503);
  });
});
