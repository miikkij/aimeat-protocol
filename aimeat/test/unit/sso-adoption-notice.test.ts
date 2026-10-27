/**
 * @file test/unit/sso-adoption-notice.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An account the organisation's directory adopted (SCIM) is opened by the organisation's
 *   SAML sign-in through the adoption key, without the account's two-step code (secaudit2026oct26,
 *   scim-users.ts createUser adoption-skips-second-factor). The sign-in stays as it is; the person is
 *   told in the bell that the organisation's sign-in opened the account without the code. An account
 *   without two-step sign-in gets no such notice.
 * @usage pnpm exec vitest run test/unit/sso-adoption-notice.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
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
import { FAKE_IDP, buildSamlResponse, requestIdFromAuthorizeUrl } from '../helpers/fake-saml-idp.js';

const NODE_ID = 'aimeat-local-001-dev';
const PUBLIC = 'https://node.test';
const CONN = 'adoptco';

interface Raw { status: number; location?: string; setCookie: string[] }

function call(method: string, url: string, opts: { cookie?: string; form?: Record<string, string> } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.form ? new URLSearchParams(opts.form).toString() : '';
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [] }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const jar = (setCookie: string[]) => setCookie.map(c => c.split(';')[0]).filter(p => !p.endsWith('=')).join('; ');

describe('the organisation\'s sign-in opening an adopted account past its two-step code', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;

  async function adopted(name: string, armed: boolean): Promise<void> {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name, displayName: name, publicKey: kp.publicKey, roles: ['owner'], createdAt: now, managedBy: CONN } as never);
    await storage.createGHII({
      username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name, ownerName: name,
      verificationLevel: 1, totpEnabled: armed, ...(armed ? { totpSecret: 'JBSWY3DPEHPK3PXP' } : {}),
      emailHash: createHash('sha256').update(`${name}@adoptco.com`).digest('hex'), emailVerifiedAt: now,
      notificationEmail: `${name}@adoptco.com`, externalIdentities: { [`scim:${CONN}`]: `ext-${name}` },
      createdAt: now, updatedAt: now,
    } as never);
  }

  async function signIn(name: string): Promise<Raw> {
    const a = await call('GET', `${base}/v1/ghii/login/saml/${CONN}`);
    expect(a.status).toBe(302);
    const SAMLResponse = buildSamlResponse({
      acsUrl: `${PUBLIC}/v1/ghii/login/saml/${CONN}/acs`, audience: `${PUBLIC}/v1/sso/${CONN}/metadata`,
      inResponseTo: requestIdFromAuthorizeUrl(a.location!), nameId: `ext-${name}`, email: `${name}@adoptco.com`,
    });
    const relayState = new URL(a.location!).searchParams.get('RelayState')!;
    return call('POST', `${base}/v1/ghii/login/saml/${CONN}/acs`, { form: { SAMLResponse, RelayState: relayState }, cookie: jar(a.setCookie) });
  }

  const notices = async (name: string, type: string) =>
    (await storage.listMemory(`${name}@${NODE_ID}`, { prefix: 'notif.' })).map(m => m.value as { type: string }).filter(v => v.type === type);

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
    app.use(samlLoginRouter(config, storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const now = new Date().toISOString();
    const opKey = await generateKeyPair();
    await storage.createOwner({ name: 'firstop', displayName: 'Op', publicKey: opKey.publicKey, roles: ['owner', 'operator'], createdAt: now });
    await storage.createSsoConnection({
      id: CONN, name: 'Adopt Co', organismId: null, domains: ['adoptco.com'],
      saml: { idpEntityId: FAKE_IDP.entityId, ssoUrl: 'https://fake-idp-one.example/sso', idpCerts: [FAKE_IDP.cert] },
      allowIdpInitiated: false, loginVisibility: 'listed', createdBy: 'op', createdAt: now, updatedAt: now,
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('an adopted account with two-step sign-in: the person is told the organisation\'s sign-in opened it without the code', async () => {
    await adopted('armedone', true);
    const r = await signIn('armedone');
    expect(r.status).toBe(302);
    expect(r.location).not.toContain('auth_error=');
    expect(r.setCookie.some(c => /aimeat_rt=/.test(c) && !/aimeat_rt=;/.test(c))).toBe(true);
    expect(await notices('armedone', 'sso_signed_in_past_code')).toHaveLength(1);
  });

  it('usage: an adopted account without two-step sign-in signs in as before, with no notice', async () => {
    await adopted('plainone', false);
    const r = await signIn('plainone');
    expect(r.status).toBe(302);
    expect(r.location).not.toContain('auth_error=');
    expect(r.setCookie.some(c => /aimeat_rt=/.test(c) && !/aimeat_rt=;/.test(c))).toBe(true);
    expect(await notices('plainone', 'sso_signed_in_past_code')).toHaveLength(0);
  });

  it('usage: the next sign-in of the armed account goes through the linked identity, with no second notice', async () => {
    const r = await signIn('armedone');
    expect(r.status).toBe(302);
    expect(r.location).not.toContain('auth_error=');
    expect(await notices('armedone', 'sso_signed_in_past_code')).toHaveLength(1);
  });
});
