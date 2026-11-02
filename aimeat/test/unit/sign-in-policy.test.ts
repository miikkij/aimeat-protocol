/**
 * @file sign-in-policy.test.ts
 * @description The operator's sign-in policy (services/sign-in-policy.ts) where the E2E suite
 *   (test/e2e-sign-in-policy.ts) cannot reach: the setup token's expiry, which needs time to move;
 *   the emailed sign-in link, which needs the plain link the mail would carry; and the rules
 *   themselves, value by value.
 *
 *   Drives the real routes against in-memory SQLite: GET /v1/ghii/magic-link/open and
 *   POST /v1/ghii/login/two-step/{start,finish}. A link on a covered account without TOTP opens no
 *   session and redirects to `/?auth_step=two_step_setup#two_step=<token>`; start and finish arm
 *   TOTP and open the session with the link's return address. A covered account with TOTP keeps the
 *   code step it had; an uncovered account keeps its session from the link.
 * @version-history
 *   v1.1.0 — 2026-11-02 — Two-step required with totp.enabled false: the save refusal and the start warning.
 *   v1.0.0 — 2026-11-02 — Initial (IT review: required two-step sign-in, password sign-in off).
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
import { registerLoginTwoStepRoutes } from '../../src/routes/ghii/login-two-step.js';
import { issueSetupToken, readSetupTicket, spendSetupTicket, SETUP_TOKEN_TYPE } from '../../src/services/two-step-setup.js';
import {
  signInPolicyLoosens, signInPolicyChangeRefusal, passwordSignInRefusal, passwordWayInRefusal, newPasswordRefusal,
  twoStepCovers, hasIdentityProviderLink, TWO_STEP_REQUIRED_PATH, PASSWORD_SIGN_IN_PATH,
  TOTP_ENABLED_PATH, twoStepWithoutTotpRefusal, twoStepWithoutTotpWarning,
} from '../../src/services/sign-in-policy.js';

const NODE_ID = 'aimeat-local-001-dev';

interface Raw { status: number; location?: string; setCookie: string[]; body: string }

function request(method: string, url: string, body?: unknown): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(payload)); }
    const req = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [], body: text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const hasRefreshCookie = (setCookie: string[]) => setCookie.some(c => /^(__Host-)?aimeat_rt=[^;]/.test(c));
const codeOf = (base32: string) => new TOTP({ secret: Secret.fromBase32(base32), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

describe('the sign-in policy rules', () => {
  it('orders both settings from open to strict, and only a move down the order loosens', () => {
    expect(signInPolicyLoosens(TWO_STEP_REQUIRED_PATH, 'everyone', 'operators')).toBe(true);
    expect(signInPolicyLoosens(TWO_STEP_REQUIRED_PATH, 'operators', 'off')).toBe(true);
    expect(signInPolicyLoosens(TWO_STEP_REQUIRED_PATH, 'off', 'everyone')).toBe(false);
    expect(signInPolicyLoosens(PASSWORD_SIGN_IN_PATH, 'off', 'operators')).toBe(true);
    expect(signInPolicyLoosens(PASSWORD_SIGN_IN_PATH, 'operators', 'on')).toBe(true);
    expect(signInPolicyLoosens(PASSWORD_SIGN_IN_PATH, 'on', 'off')).toBe(false);
    // A value the setting does not take is the validator's to refuse, not a loosening.
    expect(signInPolicyLoosens(PASSWORD_SIGN_IN_PATH, 'off', 'maybe')).toBe(false);
  });

  it('refuses a loosening to an AI credential and to no person', () => {
    const pat = { roles: ['owner', 'operator'], via: 'pat' };
    const agent = { roles: ['agent'] };
    const person = { roles: ['owner', 'operator'] };
    expect(signInPolicyChangeRefusal(pat, TWO_STEP_REQUIRED_PATH, 'everyone', 'off')?.code).toBe('PERSON_REQUIRED');
    expect(signInPolicyChangeRefusal(agent, PASSWORD_SIGN_IN_PATH, 'off', 'on')?.code).toBe('PERSON_REQUIRED');
    expect(signInPolicyChangeRefusal(pat, TWO_STEP_REQUIRED_PATH, 'off', 'everyone')).toBeNull();
    expect(signInPolicyChangeRefusal(person, TWO_STEP_REQUIRED_PATH, 'everyone', 'off')).toBeNull();
  });

  it('reads who a password and the two-step policy cover', () => {
    const op = { roles: ['owner', 'operator'] };
    const member = { roles: ['owner'] };
    expect(passwordSignInRefusal({ passwordSignIn: 'on', twoStepRequired: 'off' })).toBeNull();
    expect(passwordSignInRefusal({ passwordSignIn: 'operators', twoStepRequired: 'off' })).toBeNull();
    expect(passwordSignInRefusal({ passwordSignIn: 'off', twoStepRequired: 'off' })?.code).toBe('PASSWORD_SIGN_IN_OFF');
    const ops = { passwordSignIn: 'operators' as const, twoStepRequired: 'off' as const };
    expect(passwordWayInRefusal(ops, op)).toBeNull();
    expect(passwordWayInRefusal(ops, member)?.code).toBe('PASSWORD_SIGN_IN_OFF');
    expect(newPasswordRefusal(ops, true)).toBeNull();
    expect(newPasswordRefusal(ops, false)?.code).toBe('PASSWORD_SIGN_IN_OFF');
    expect(newPasswordRefusal({ passwordSignIn: 'off', twoStepRequired: 'off' }, true)?.code).toBe('PASSWORD_SIGN_IN_OFF');
    expect(twoStepCovers({ passwordSignIn: 'on', twoStepRequired: 'off' }, op)).toBe(false);
    expect(twoStepCovers({ passwordSignIn: 'on', twoStepRequired: 'operators' }, op)).toBe(true);
    expect(twoStepCovers({ passwordSignIn: 'on', twoStepRequired: 'operators' }, member)).toBe(false);
    expect(twoStepCovers({ passwordSignIn: 'on', twoStepRequired: 'everyone' }, member)).toBe(true);
  });

  it('refuses two-step sign-in required with TOTP off, naming the other setting, and warns at start', () => {
    expect(twoStepWithoutTotpRefusal('off', false, TWO_STEP_REQUIRED_PATH)).toBeNull();
    expect(twoStepWithoutTotpRefusal('everyone', true, TWO_STEP_REQUIRED_PATH)).toBeNull();
    const byRequire = twoStepWithoutTotpRefusal('operators', false, TWO_STEP_REQUIRED_PATH);
    expect(byRequire?.code).toBe('TWO_STEP_NEEDS_TOTP');
    expect(byRequire?.message).toMatch(/totp\.enabled/);
    const bySwitch = twoStepWithoutTotpRefusal('everyone', false, TOTP_ENABLED_PATH);
    expect(bySwitch?.code).toBe('TWO_STEP_NEEDS_TOTP');
    expect(bySwitch?.message).toMatch(/auth\.two_step_required/);
    expect(twoStepWithoutTotpWarning({ twoStepRequired: 'operators', totpEnabled: false })).toMatch(/AIMEAT_TOTP_ENABLED=false/);
    expect(twoStepWithoutTotpWarning({ twoStepRequired: 'operators', totpEnabled: true })).toBeNull();
    expect(twoStepWithoutTotpWarning({ twoStepRequired: 'off', totpEnabled: false })).toBeNull();
  });

  it('counts a sign-in provider link, and not the SCIM bookkeeping keys', () => {
    expect(hasIdentityProviderLink({ externalIdentities: { entra: 'abc' } })).toBe(true);
    expect(hasIdentityProviderLink({ externalIdentities: { 'saml:contoso': 'n1' } })).toBe(true);
    expect(hasIdentityProviderLink({ googleSub: '123' })).toBe(true);
    expect(hasIdentityProviderLink({ externalIdentities: { 'scim:c1': 'x', 'scimuser:c1': 'y', 'scimadopted:c1': 'z' } })).toBe(false);
    expect(hasIdentityProviderLink({})).toBe(false);
  });
});

describe('required two-step sign-in on an emailed link, and the setup token', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base = '';
  let config: AimeatConfig;

  async function account(name: string, withTotp: boolean) {
    const email = `${name}@example.test`;
    const { ghii } = await provisionOwner(storage, config, { via: 'direct', fromLoopback: true, username: name, displayName: name, verifiedEmail: email });
    const updates: Record<string, unknown> = { notificationEmail: email, magicLinkEnabled: true };
    if (withTotp) {
      const t = await setupTotp(name, totpConfigOf(config));
      Object.assign(updates, { totpSecret: t.encryptedSecret, totpBackupCodes: t.hashedBackupCodes, totpEnabled: true });
    }
    await storage.updateGHII(ghii.ghii, updates);
    return { ghii: (await storage.getGHII(ghii.ghii))!, email };
  }

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, totpEnabled: true, encryptionKey: '11'.repeat(32), twoStepRequired: 'everyone', passwordSignIn: 'on' };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    const app = express();
    app.use(express.json());
    const router = Router();
    registerLoginLinkOpenRoute(router, config, storage);
    registerLoginTwoStepRoutes(router, config, storage);
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;
    await account('policyop', false); // the first account is the operator; the tests use ordinary ones
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('a link on a covered account without TOTP opens no session, and the enrolment opens it once', async () => {
    const { ghii, email } = await account('linkenrol', false);
    const link = await issueLoginLink(storage, config, ghii, email, LOGIN_LINK_TTL_MS, '/v1/profile');
    const opened = await request('GET', link);
    expect(opened.status).toBe(302);
    expect(opened.location).toMatch(new RegExp(`^${base}/\\?auth_step=two_step_setup#two_step=[A-Za-z0-9_-]{43}$`));
    expect(hasRefreshCookie(opened.setCookie)).toBe(false);
    // The return address stays on the server.
    expect(opened.location).not.toContain('profile');
    const token = opened.location!.split('#two_step=')[1];

    const start = await request('POST', `${base}/v1/ghii/login/two-step/start`, { setup_token: token });
    expect(start.status).toBe(200);
    const secret = JSON.parse(start.body).data.secret as string;
    const finish = await request('POST', `${base}/v1/ghii/login/two-step/finish`, { setup_token: token, code: codeOf(secret) });
    expect(finish.status).toBe(200);
    const data = JSON.parse(finish.body).data;
    expect(data.redirect).toBe(`${base}/v1/profile`);
    expect(data.backup_codes.length).toBe(config.totpBackupCodeCount);
    expect(hasRefreshCookie(finish.setCookie)).toBe(true);
    const armed = (await storage.getGHII(ghii.ghii))!;
    expect(armed.totpEnabled).toBe(true);
    expect(armed.totpSecret).toBeTruthy();

    const again = await request('POST', `${base}/v1/ghii/login/two-step/finish`, { setup_token: token, code: codeOf(secret) });
    expect(again.status).toBe(401);
    expect(JSON.parse(again.body).error.code).toBe('SETUP_TOKEN_EXPIRED');
  });

  it('a covered account with TOTP keeps its code step; nothing changes for it', async () => {
    const { ghii, email } = await account('linktotp', true);
    const link = await issueLoginLink(storage, config, ghii, email, LOGIN_LINK_TTL_MS);
    const opened = await request('GET', link);
    expect(opened.status).toBe(302);
    expect(opened.location).toBe(`${base}/?auth_step=second_factor`);
  });

  it('an uncovered account keeps its session straight from the link', async () => {
    config.twoStepRequired = 'operators';
    try {
      const { ghii, email } = await account('linkplain', false);
      const link = await issueLoginLink(storage, config, ghii, email, LOGIN_LINK_TTL_MS);
      const opened = await request('GET', link);
      expect(opened.status).toBe(302);
      expect(opened.location).toBe(`${base}/`);
      expect(hasRefreshCookie(opened.setCookie)).toBe(true);
    } finally {
      config.twoStepRequired = 'everyone';
    }
  });

  it('a setup token expires after its ten minutes, and is spent once', async () => {
    const { ghii } = await account('tokenlife', false);
    const { token } = await issueSetupToken(storage, ghii);
    const ticket = await readSetupTicket(storage, token);
    expect(ticket?.owner).toBe('tokenlife');
    // Ten minutes later: the row written again with an expiry in the past.
    const row = (await storage.getVerificationNonce(ticket!.key))!;
    expect(row.type).toBe(SETUP_TOKEN_TYPE);
    await storage.deleteVerificationNonce(ticket!.key);
    await storage.createVerificationNonce({ ...row, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await readSetupTicket(storage, token)).toBeNull();
    const r = await request('POST', `${base}/v1/ghii/login/two-step/start`, { setup_token: token });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).error.code).toBe('SETUP_TOKEN_EXPIRED');

    const fresh = await issueSetupToken(storage, ghii);
    const t2 = (await readSetupTicket(storage, fresh.token))!;
    expect(await spendSetupTicket(storage, t2)).toBe(true);
    expect(await spendSetupTicket(storage, t2)).toBe(false);
  });

  it('a token of another kind or shape is not a setup token', async () => {
    expect(await readSetupTicket(storage, 'short')).toBeNull();
    expect(await readSetupTicket(storage, 'A'.repeat(43))).toBeNull();
    expect(await readSetupTicket(storage, undefined)).toBeNull();
  });
});
