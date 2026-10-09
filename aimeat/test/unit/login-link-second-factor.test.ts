/**
 * @file login-link-second-factor.test.ts
 * @description An emailed sign-in link respects two-step sign-in (secaudit 2026-10-09, S1, ruled by
 *   the developer: "a sign-in link and attaching an email respect two-step sign-in"). Until then
 *   GET /v1/ghii/magic-link/open spent the link and opened a full owner session, operator included,
 *   on an account with TOTP armed, without asking for the code. The password sign-in asked for it.
 *
 *   Drives the real routes against in-memory SQLite: the open route and
 *   POST /v1/ghii/magic-link/second-factor. A TOTP account's link sets no refresh cookie and redirects
 *   to `/?auth_step=second_factor` with a ticket cookie; a wrong code is refused and keeps the ticket;
 *   the right code opens the session once; the ticket is gone after that, and after five wrong codes.
 *   An account without TOTP still gets its session straight from the link. POST
 *   /v1/ghii/login/attach-email, the other route that takes a password, asks for the code too.
 * @version-history
 *   v1.0.1 — 2026-10-09 — The node under test has an encryption key: TOTP is not set up without one.
 *   v1.0.0 — 2026-10-09 — Initial (secaudit 2026-10-09, S1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { TOTP, Secret } from 'otpauth';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { provisionOwner } from '../../src/services/owner-provisioning.js';
import { issueLoginLink, LOGIN_LINK_TTL_MS } from '../../src/services/login-link.js';
import { setupTotp, totpConfigOf } from '../../src/services/totp.js';
import { registerLoginLinkOpenRoute } from '../../src/routes/ghii/login-link-open.js';
import { registerAttachEmailRoute } from '../../src/routes/ghii/attach-email.js';
import { hashPassword } from '../../src/services/password.js';

const NODE_ID = 'aimeat-local-001-dev';
const PASSWORD = 'LinkSecondFactor1234';
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

/** A six-digit code that is not the current one, nor one in the window around it. */
function wrongCode(base32: string): string {
  const near = new Set([-2, -1, 0, 1, 2].map(o => codeOf(base32, o)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, '0');
    if (!near.has(c)) return c;
  }
}

describe('an emailed sign-in link and two-step sign-in', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base = '';
  let config: AimeatConfig;
  let secret = '';

  async function account(name: string, withTotp: boolean) {
    const email = `${name}@example.test`;
    const { ghii } = await provisionOwner(storage, config, { via: 'direct', username: name, displayName: name, verifiedEmail: email });
    const updates: Record<string, unknown> = { notificationEmail: email, magicLinkEnabled: true };
    if (withTotp) {
      const t = await setupTotp(name, totpConfigOf(config));
      secret = t.secret;
      Object.assign(updates, { totpSecret: t.encryptedSecret, totpBackupCodes: t.hashedBackupCodes, totpEnabled: true });
    }
    await storage.updateGHII(ghii.ghii, updates);
    return { ghii: (await storage.getGHII(ghii.ghii))!, email };
  }

  async function linkFor(name: string, withTotp: boolean, redirect?: string) {
    const { ghii, email } = await account(name, withTotp);
    return issueLoginLink(storage, config, ghii, email, LOGIN_LINK_TTL_MS, redirect);
  }

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    // A key, because a node without one no longer sets TOTP up (services/totp.ts, 2026-10-09).
    config = { ...loadConfig().config, nodeId: NODE_ID, totpEnabled: true, totpMaxFailedAttempts: 50, encryptionKey: '11'.repeat(32) };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);

    const app = express();
    app.use(express.json());
    const router = Router();
    // Registers POST /v1/ghii/magic-link/second-factor beside the open route.
    registerLoginLinkOpenRoute(router, config, storage);
    registerAttachEmailRoute(router, config, storage, undefined);
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;
    // The first account on a fresh node becomes the operator. It is made here, so the accounts the
    // tests sign in are ordinary ones.
    await account('linkop', false);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('an account without TOTP gets its session straight from the link', async () => {
    const link = await linkFor('plainlink', false, '/v1/profile');
    const r = await request('GET', link);
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${base}/v1/profile`);
    expect(cookieFrom(r.setCookie, 'aimeat_rt')).toBeTruthy();
  });

  it('a TOTP account opens no session from the link; the code does it, once', async () => {
    const link = await linkFor('totplink', true, '/v1/profile?tab=security');
    const opened = await request('GET', link);
    expect(opened.status).toBe(302);
    expect(opened.location).toBe(`${base}/?auth_step=second_factor`);
    expect(cookieFrom(opened.setCookie, 'aimeat_rt')).toBeNull();
    const ticket = cookieFrom(opened.setCookie, TICKET_COOKIE);
    expect(ticket).toBeTruthy();
    const raw = opened.setCookie.find(c => c.startsWith(TICKET_COOKIE + '='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\/v1\/ghii\/magic-link/);
    // The return address stays on the server.
    expect(opened.location).not.toContain('profile');

    const url = `${base}/v1/ghii/magic-link/second-factor`;
    const none = await request('POST', url, { cookie: ticket!, body: {} });
    expect(none.status).toBe(401);
    expect(JSON.parse(none.body).error.code).toBe('TOTP_REQUIRED');

    const wrong = await request('POST', url, { cookie: ticket!, body: { totp_code: wrongCode(secret) } });
    expect(wrong.status).toBe(401);
    expect(JSON.parse(wrong.body).error.code).toBe('INVALID_TOTP');
    expect(cookieFrom(wrong.setCookie, 'aimeat_rt')).toBeNull();

    const right = await request('POST', url, { cookie: ticket!, body: { totp_code: codeOf(secret) } });
    expect(right.status).toBe(200);
    expect(JSON.parse(right.body).data.redirect).toBe(`${base}/v1/profile?tab=security`);
    expect(cookieFrom(right.setCookie, 'aimeat_rt')).toBeTruthy();

    const again = await request('POST', url, { cookie: ticket!, body: { totp_code: codeOf(secret, 1) } });
    expect(again.status).toBe(401);
    expect(JSON.parse(again.body).error.code).toBe('SECOND_FACTOR_EXPIRED');
  });

  it('no ticket, or a made-up one, is SECOND_FACTOR_EXPIRED', async () => {
    const url = `${base}/v1/ghii/magic-link/second-factor`;
    const r1 = await request('POST', url, { body: { totp_code: '123456' } });
    expect(r1.status).toBe(401);
    expect(JSON.parse(r1.body).error.code).toBe('SECOND_FACTOR_EXPIRED');
    const r2 = await request('POST', url, { cookie: `${TICKET_COOKIE}=bm90LWEtdGlja2V0`, body: { totp_code: '123456' } });
    expect(r2.status).toBe(401);
    expect(JSON.parse(r2.body).error.code).toBe('SECOND_FACTOR_EXPIRED');
  });

  it('attach-email asks an account with TOTP armed for its code, and takes the right one', async () => {
    const name = 'totpattach';
    const { ghii } = await provisionOwner(storage, config, { via: 'direct', username: name, displayName: name, passwordHash: await hashPassword(PASSWORD) });
    const t = await setupTotp(name, totpConfigOf(config));
    await storage.updateGHII(ghii.ghii, { totpSecret: t.encryptedSecret, totpBackupCodes: t.hashedBackupCodes, totpEnabled: true, verificationLevel: 0 });
    const url = `${base}/v1/ghii/login/attach-email`;
    const body = { username: name, password: PASSWORD, email: `${name}@example.test` };

    const bare = await request('POST', url, { body });
    expect(bare.status).toBe(401);
    expect(JSON.parse(bare.body).error.code).toBe('TOTP_REQUIRED');
    expect((await storage.getGHII(ghii.ghii))!.notificationEmail ?? null).toBeNull();

    const coded = await request('POST', url, { body: { ...body, totp_code: codeOf(t.secret) } });
    expect(coded.status).toBe(200);
  });

  it('the ticket is gone after five wrong codes, even with the right code next', async () => {
    const opened = await request('GET', await linkFor('totpfive', true));
    const ticket = cookieFrom(opened.setCookie, TICKET_COOKIE)!;
    const url = `${base}/v1/ghii/magic-link/second-factor`;
    for (let n = 0; n < 5; n++) {
      const w = await request('POST', url, { cookie: ticket, body: { totp_code: wrongCode(secret) } });
      expect(JSON.parse(w.body).error.code).toBe('INVALID_TOTP');
    }
    const late = await request('POST', url, { cookie: ticket, body: { totp_code: codeOf(secret) } });
    expect(late.status).toBe(401);
    expect(JSON.parse(late.body).error.code).toBe('SECOND_FACTOR_EXPIRED');
    expect(cookieFrom(late.setCookie, 'aimeat_rt')).toBeNull();
  });
});
