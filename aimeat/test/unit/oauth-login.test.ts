/**
 * @file oauth-login.test.ts
 * @description Integration tests for Google social login (routes/oauth-login.ts). Drives the
 *   real router against a real in-memory SQLite storage with a FAKE OIDC client (so no network
 *   IdP is needed), covering the account-mapping decisions: create-new, returning-by-subject,
 *   link-by-verified-email, no-link-when-local-email-unverified, plus the failure redirects.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial suite (Google sign-in mapping + session establishment).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { oauthLoginRouter } from '../../src/routes/oauth-login.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import type { OidcClient } from '../../src/services/oidc-client.js';

const NODE_ID = 'aimeat-local-001-dev';

function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** A fake OIDC client: createAuthRequest yields unique state; exchangeCode returns canned claims. */
function makeFakeClient() {
  let counter = 0;
  let nextClaims: Record<string, unknown> = {};
  let nextValid = true;
  const client: OidcClient = {
    initialized: true,
    async initialize() { /* no-op */ },
    createAuthRequest() {
      counter += 1;
      return {
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=st-${counter}`,
        state: `st-${counter}`,
        nonce: `no-${counter}`,
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

/** Minimal HTTP GET that does NOT follow redirects — returns status + headers + body. */
function rawGet(url: string): Promise<{ status: number; location?: string; setCookie?: string[]; body: string }> {
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

describe('Google social login (oauth-login router)', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let fake: ReturnType<typeof makeFakeClient>;
  let config: AimeatConfig;

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, googleOAuthEnabled: true };

    // Node signing keys are required for issueJWT() inside establishOwnerSession().
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);

    fake = makeFakeClient();
    const app = express();
    app.use(express.json());
    app.use(oauthLoginRouter(config, storage, fake.client));
    // Also mount a disabled router (null client) under a sub-path proxy for the disabled test.
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

  /** Run the full authorize→callback dance for a given set of Google claims. */
  async function loginWith(claims: Record<string, unknown>) {
    fake.setClaims(claims);
    const authz = await rawGet(`${base}/v1/ghii/login/google`);
    expect(authz.status).toBe(302);
    const state = new URL(authz.location!).searchParams.get('state')!;
    return rawGet(`${base}/v1/ghii/login/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  }

  it('creates a new owner + GHII for a first-time Google user (verified email)', async () => {
    const res = await loginWith({ sub: 'g-new-1', email: 'newuser@example.com', email_verified: true, name: 'New User' });
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/`);
    expect((res.setCookie ?? []).some((c) => c.startsWith('aimeat_rt='))).toBe(true);

    const ghii = await storage.getGHIIByGoogleSub('g-new-1');
    expect(ghii).not.toBeNull();
    expect(ghii!.emailVerifiedAt).toBeTruthy();
    expect(ghii!.verificationLevel).toBe(1);
    expect(ghii!.emailHash).toBe(emailHashOf('newuser@example.com'));
  });

  it('logs a returning Google user into the SAME account (matched by subject)', async () => {
    const before = (await storage.listOwners()).length;
    const res = await loginWith({ sub: 'g-new-1', email: 'newuser@example.com', email_verified: true, name: 'New User' });
    expect(res.status).toBe(302);
    const after = (await storage.listOwners()).length;
    expect(after).toBe(before); // no new owner created
    const ghii = await storage.getGHIIByGoogleSub('g-new-1');
    expect(ghii!.loginCount).toBeGreaterThanOrEqual(2);
  });

  it('links to an existing account when Googleʼs verified email matches a locally-verified GHII', async () => {
    // Pre-create a password account whose email is locally VERIFIED.
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'linkme', displayName: 'Link Me', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'linkme', nodeId: NODE_ID, ghii: `linkme@${NODE_ID}`, displayName: 'Link Me',
      emailHash: emailHashOf('linkme@example.com'), emailVerifiedAt: now, verificationLevel: 1,
      verificationMethod: 'email', ownerName: 'linkme', totpEnabled: false, createdAt: now, updatedAt: now,
    });

    const ownersBefore = (await storage.listOwners()).length;
    const res = await loginWith({ sub: 'g-link-1', email: 'linkme@example.com', email_verified: true, name: 'Link Me' });
    expect(res.status).toBe(302);

    const linked = await storage.getGHII(`linkme@${NODE_ID}`);
    expect(linked!.googleSub).toBe('g-link-1'); // linked, not duplicated
    expect((await storage.listOwners()).length).toBe(ownersBefore); // no new owner
  });

  it('does NOT link (creates a new account) when the matching local email is unverified', async () => {
    // Pre-create an account that merely CLAIMED the email (emailHash set, but never verified).
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: 'claimer', displayName: 'Claimer', publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username: 'claimer', nodeId: NODE_ID, ghii: `claimer@${NODE_ID}`, displayName: 'Claimer',
      emailHash: emailHashOf('claimed@example.com'), verificationLevel: 0,
      ownerName: 'claimer', totpEnabled: false, createdAt: now, updatedAt: now,
    });

    const res = await loginWith({ sub: 'g-claim-1', email: 'claimed@example.com', email_verified: true, name: 'Real Owner' });
    expect(res.status).toBe(302);

    // The squatted account must NOT have been linked or taken over.
    const claimer = await storage.getGHII(`claimer@${NODE_ID}`);
    expect(claimer!.googleSub).toBeUndefined();
    // A separate, new account now owns the Google subject.
    const fresh = await storage.getGHIIByGoogleSub('g-claim-1');
    expect(fresh).not.toBeNull();
    expect(fresh!.ghii).not.toBe(`claimer@${NODE_ID}`);
  });

  it('redirects with auth_error on an invalid state', async () => {
    const res = await rawGet(`${base}/v1/ghii/login/google/callback?code=abc&state=does-not-exist`);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?auth_error=GOOGLE_INVALID_STATE`);
  });

  it('redirects with auth_error when the code is missing', async () => {
    const res = await rawGet(`${base}/v1/ghii/login/google/callback?state=whatever`);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${base}/?auth_error=GOOGLE_MISSING_CODE`);
  });

  it('returns 503 from authorize when Google sign-in is not configured', async () => {
    const app = express();
    app.use(oauthLoginRouter({ ...config, googleOAuthEnabled: false }, storage, null));
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await rawGet(`http://127.0.0.1:${port}/v1/ghii/login/google`);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(res.status).toBe(503);
  });
});
