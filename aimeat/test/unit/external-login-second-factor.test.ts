/**
 * @file external-login-second-factor.test.ts
 * @description The first external sign-in that links a provider identity to an existing account by
 *   its verified e-mail address asks an account with two-step sign-in (TOTP armed) for its code
 *   before the link is saved and before a session opens (secaudit2026oct22,
 *   external-login-skips-second-factor). Until then the OIDC callback saved the new subject on the
 *   account and opened a full owner session on the e-mail match alone.
 *
 *   Drives the real OIDC sign-in router (routes/oauth-login.ts) with a fake OIDC client, and the
 *   real POST /v1/ghii/magic-link/second-factor (routes/ghii/login-link-second-factor.ts), against
 *   in-memory SQLite. A TOTP account: the callback sets no refresh cookie, leaves a ticket cookie,
 *   redirects to `/?auth_step=second_factor`, and links nothing; a wrong code links nothing; the
 *   right code links the subject and opens the session; the next sign-in with that subject is one
 *   click. An account without TOTP is linked and signed in at the callback, as before.
 * @version-history
 *   2026-10-25 — provisionOwner is called as a request from loopback (fromLoopback): a call with no request is
 *     asked for the setup code of a node without an operator (secaudit2026oct22 round 2).
 *   2026-10-24 — Initial (secaudit2026oct22, external-login-skips-second-factor).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { TOTP, Secret } from 'otpauth';
import { oauthLoginRouter } from '../../src/routes/oauth-login.js';
import { registerLoginLinkSecondFactorRoute } from '../../src/routes/ghii/login-link-second-factor.js';
import { mapGoogleClaims, type OidcProvider } from '../../src/services/oidc-providers.js';
import type { OidcClient } from '../../src/services/oidc-client.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { provisionOwner } from '../../src/services/owner-provisioning.js';
import { setupTotp, totpConfigOf } from '../../src/services/totp.js';

const NODE_ID = 'aimeat-local-001-dev';
const TICKET_COOKIE = 'aimeat_link_2fa';

interface Raw { status: number; location?: string; setCookie: string[]; body: string }

function request(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(payload)); }
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

/** A live `name=value` pair from Set-Cookie; a clearing header (empty value) does not count. */
function cookieFrom(setCookie: string[], name: string): string | null {
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    if (pair.startsWith(name + '=') && pair.length > name.length + 1) return pair;
  }
  return null;
}

const codeOf = (base32: string, offsetPeriods = 0) =>
  new TOTP({ secret: Secret.fromBase32(base32), algorithm: 'SHA1', digits: 6, period: 30 })
    .generate({ timestamp: Date.now() + offsetPeriods * 30_000 });

function wrongCode(base32: string): string {
  const near = new Set([-2, -1, 0, 1, 2].map(o => codeOf(base32, o)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, '0');
    if (!near.has(c)) return c;
  }
}

describe('the first external sign-in onto an account with two-step sign-in', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base = '';
  let config: AimeatConfig;
  let nextClaims: Record<string, unknown> = {};
  let counter = 0;

  const client: OidcClient = {
    initialized: true,
    async initialize() { /* no-op */ },
    createAuthRequest() {
      counter += 1;
      return { authorizationUrl: `https://idp.example/auth?state=g2f-${counter}`, state: `g2f-${counter}`, nonce: `n-${counter}` };
    },
    async exchangeCode() { return { valid: true, claims: nextClaims }; },
  };
  const google: OidcProvider = {
    id: 'google', label: 'Continue with Google', i18nKey: 'googleSignIn',
    enabled: true, client, scopes: ['openid', 'email', 'profile'], nonceType: 'google_login', mapClaims: mapGoogleClaims,
  };

  async function signInWithGoogle(claims: Record<string, unknown>, redirect?: string): Promise<Raw> {
    nextClaims = claims;
    const authz = await request('GET', `${base}/v1/ghii/login/google${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`);
    expect(authz.status).toBe(302);
    const state = new URL(authz.location!).searchParams.get('state')!;
    return request('GET', `${base}/v1/ghii/login/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  }

  async function account(name: string, withTotp: boolean): Promise<{ ghii: string; email: string; secret: string }> {
    const email = `${name}@example.test`;
    const { ghii } = await provisionOwner(storage, config, { via: 'direct', fromLoopback: true, username: name, displayName: name, verifiedEmail: email });
    let secret = '';
    if (withTotp) {
      const t = await setupTotp(name, totpConfigOf(config));
      secret = t.secret;
      await storage.updateGHII(ghii.ghii, { totpSecret: t.encryptedSecret, totpBackupCodes: t.hashedBackupCodes, totpEnabled: true });
    }
    expect((await storage.getGHII(ghii.ghii))!.emailVerifiedAt).toBeTruthy();
    return { ghii: ghii.ghii, email, secret };
  }

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, totpEnabled: true, totpMaxFailedAttempts: 50, encryptionKey: '22'.repeat(32) };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);

    const app = express();
    app.use(express.json());
    app.use(oauthLoginRouter(config, storage, [google]));
    const router = Router();
    registerLoginLinkSecondFactorRoute(router, config, storage);
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;
    // The first account on a fresh node is the operator; the accounts under test are ordinary ones.
    await account('extop', false);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('a new subject asserting a TOTP account\'s address gets a code step, and nothing is linked', async () => {
    const victim = await account('totpvictim', true);
    const r = await signInWithGoogle({ sub: 'g-new-subject', email: victim.email, email_verified: true, name: 'Someone' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${base}/?auth_step=second_factor`);
    expect(cookieFrom(r.setCookie, 'aimeat_rt')).toBeNull();
    expect(cookieFrom(r.setCookie, TICKET_COOKIE)).toBeTruthy();
    expect(await storage.getGHIIByExternalId('google', 'g-new-subject')).toBeNull();
    expect((await storage.getGHII(victim.ghii))!.externalIdentities?.google).toBeUndefined();
  });

  it('a wrong code links nothing; the right code links the subject and opens the session; the next sign-in is one click', async () => {
    const person = await account('totpperson', true);
    const first = await signInWithGoogle({ sub: 'g-person', email: person.email, email_verified: true, name: 'Person' }, '/v1/profile');
    const ticket = cookieFrom(first.setCookie, TICKET_COOKIE)!;
    expect(ticket).toBeTruthy();
    const url = `${base}/v1/ghii/magic-link/second-factor`;

    const wrong = await request('POST', url, { cookie: ticket, body: { totp_code: wrongCode(person.secret) } });
    expect(wrong.status).toBe(401);
    expect(JSON.parse(wrong.body).error.code).toBe('INVALID_TOTP');
    expect(cookieFrom(wrong.setCookie, 'aimeat_rt')).toBeNull();
    expect(await storage.getGHIIByExternalId('google', 'g-person')).toBeNull();

    const right = await request('POST', url, { cookie: ticket, body: { totp_code: codeOf(person.secret) } });
    expect(right.status).toBe(200);
    expect(JSON.parse(right.body).data.redirect).toBe(`${base}/v1/profile`);
    expect(cookieFrom(right.setCookie, 'aimeat_rt')).toBeTruthy();
    const linked = await storage.getGHIIByExternalId('google', 'g-person');
    expect(linked?.ghii).toBe(person.ghii);
    expect(linked!.googleSub).toBe('g-person');

    const again = await signInWithGoogle({ sub: 'g-person', email: person.email, email_verified: true, name: 'Person' });
    expect(again.status).toBe(302);
    expect(again.location).toBe(`${base}/`);
    expect(cookieFrom(again.setCookie, 'aimeat_rt')).toBeTruthy();
    expect(cookieFrom(again.setCookie, TICKET_COOKIE)).toBeNull();
  });

  it('a subject another account took while the code was pending is refused at the code step', async () => {
    const person = await account('totprace', true);
    const other = await account('otherholder', false);
    const first = await signInWithGoogle({ sub: 'g-race', email: person.email, email_verified: true, name: 'Race' });
    const ticket = cookieFrom(first.setCookie, TICKET_COOKIE)!;
    await storage.updateGHII(other.ghii, { externalIdentities: { google: 'g-race' }, googleSub: 'g-race' });

    const right = await request('POST', `${base}/v1/ghii/magic-link/second-factor`, { cookie: ticket, body: { totp_code: codeOf(person.secret) } });
    expect(right.status).toBe(409);
    expect(JSON.parse(right.body).error.code).toBe('EXTERNAL_IDENTITY_TAKEN');
    expect(cookieFrom(right.setCookie, 'aimeat_rt')).toBeNull();
    expect((await storage.getGHII(person.ghii))!.externalIdentities?.google).toBeUndefined();
  });

  it('an account without TOTP is linked and signed in at the callback, as before', async () => {
    const plain = await account('plainperson', false);
    const r = await signInWithGoogle({ sub: 'g-plain', email: plain.email, email_verified: true, name: 'Plain' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${base}/`);
    expect(cookieFrom(r.setCookie, 'aimeat_rt')).toBeTruthy();
    expect(cookieFrom(r.setCookie, TICKET_COOKIE)).toBeNull();
    expect((await storage.getGHIIByExternalId('google', 'g-plain'))?.ghii).toBe(plain.ghii);
  });
});
