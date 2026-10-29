/**
 * @file test/unit/sso-adoption-code.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first organisation sign-in into an account the directory adopted (SCIM) asks the
 *   account's two-step code once (secaudit2026oct26 round 8c, scim-users.ts createUser
 *   adoption-skips-second-factor). Adopted means positive evidence: the adoption marker SCIM writes
 *   since this change, or an account older than the connection, which that connection's SCIM cannot
 *   have created. An account whose adoption already completed an organisation sign-in, an adopted
 *   account without two-step sign-in, and an account with no such evidence sign in as before.
 *   The real SCIM adoption and the code step end to end: test/e2e-scim-users.ts.
 * @usage pnpm exec vitest run test/unit/sso-adoption-code.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c).
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
const CONN = 'codeco';
const CONN_CREATED = '2026-06-01T00:00:00.000Z';
const BEFORE = '2026-01-01T00:00:00.000Z';
const AFTER = '2026-09-01T00:00:00.000Z';

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
const session = (r: Raw) => r.setCookie.some(c => /aimeat_rt=/.test(c) && !/aimeat_rt=;/.test(c));

describe('the first organisation sign-in into an adopted account with two-step sign-in', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;

  async function account(name: string, o: { createdAt: string; armed: boolean; marker?: boolean; linked?: boolean }): Promise<void> {
    const kp = await generateKeyPair();
    await storage.createOwner({ name, displayName: name, publicKey: kp.publicKey, roles: ['owner'], createdAt: o.createdAt, managedBy: CONN } as never);
    await storage.createGHII({
      username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name, ownerName: name,
      verificationLevel: 1, totpEnabled: o.armed, ...(o.armed ? { totpSecret: 'JBSWY3DPEHPK3PXP' } : {}),
      emailHash: createHash('sha256').update(`${name}@codeco.com`).digest('hex'), emailVerifiedAt: o.createdAt,
      notificationEmail: `${name}@codeco.com`,
      externalIdentities: {
        [`scim:${CONN}`]: `ext-${name}`,
        ...(o.marker ? { [`scimadopted:${CONN}`]: AFTER } : {}),
        ...(o.linked ? { [`saml:${CONN}`]: `ext-${name}` } : {}),
      },
      createdAt: o.createdAt, updatedAt: o.createdAt,
    } as never);
  }

  async function signIn(name: string): Promise<Raw> {
    const a = await call('GET', `${base}/v1/ghii/login/saml/${CONN}`);
    expect(a.status).toBe(302);
    const SAMLResponse = buildSamlResponse({
      acsUrl: `${PUBLIC}/v1/ghii/login/saml/${CONN}/acs`, audience: `${PUBLIC}/v1/sso/${CONN}/metadata`,
      inResponseTo: requestIdFromAuthorizeUrl(a.location!), nameId: `ext-${name}`, email: `${name}@codeco.com`,
    });
    const relayState = new URL(a.location!).searchParams.get('RelayState')!;
    return call('POST', `${base}/v1/ghii/login/saml/${CONN}/acs`, { form: { SAMLResponse, RelayState: relayState }, cookie: jar(a.setCookie) });
  }

  const linkedSaml = async (name: string) => (await storage.getGHII(`${name}@${NODE_ID}`))?.externalIdentities?.[`saml:${CONN}`];
  const notices = async (name: string) =>
    (await storage.listMemory(`${name}@${NODE_ID}`, { prefix: 'notif.' })).map(m => m.value as { type: string }).filter(v => v.type === 'sso_signed_in_past_code');

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
    const opKey = await generateKeyPair();
    await storage.createOwner({ name: 'firstop', displayName: 'Op', publicKey: opKey.publicKey, roles: ['owner', 'operator'], createdAt: BEFORE });
    await storage.createSsoConnection({
      id: CONN, name: 'Code Co', organismId: null, domains: ['codeco.com'],
      saml: { idpEntityId: FAKE_IDP.entityId, ssoUrl: 'https://fake-idp-one.example/sso', idpCerts: [FAKE_IDP.cert] },
      allowIdpInitiated: false, loginVisibility: 'listed', createdBy: 'op', createdAt: CONN_CREATED, updatedAt: CONN_CREATED,
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('an account older than the connection, adopted before this change: the code step, nothing linked, no session', async () => {
    await account('olderone', { createdAt: BEFORE, armed: true });
    const r = await signIn('olderone');
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${PUBLIC}/?auth_step=second_factor`);
    expect(session(r)).toBe(false);
    expect(await linkedSaml('olderone')).toBeUndefined();
    expect(await notices('olderone')).toHaveLength(0);
  });

  it('an account adopted since this change (the adoption marker): the code step', async () => {
    await account('markedone', { createdAt: AFTER, armed: true, marker: true });
    const r = await signIn('markedone');
    expect(r.location).toBe(`${PUBLIC}/?auth_step=second_factor`);
    expect(session(r)).toBe(false);
    expect(await linkedSaml('markedone')).toBeUndefined();
  });

  it('usage: an adoption that already completed an organisation sign-in signs in without the code, as before', async () => {
    await account('doneone', { createdAt: BEFORE, armed: true, marker: true, linked: true });
    const r = await signIn('doneone');
    expect(r.status).toBe(302);
    expect(r.location).toBe(`${PUBLIC}/`);
    expect(session(r)).toBe(true);
  });

  it('usage: an adopted account without two-step sign-in signs in without the code, as before', async () => {
    await account('plainolder', { createdAt: BEFORE, armed: false, marker: true });
    const r = await signIn('plainolder');
    expect(r.location).toBe(`${PUBLIC}/`);
    expect(session(r)).toBe(true);
    expect(await linkedSaml('plainolder')).toBe('ext-plainolder');
  });

  it('usage: an account with no evidence of adoption (made after the connection, no marker) signs in as before, with the notice', async () => {
    await account('noevidence', { createdAt: AFTER, armed: true });
    const r = await signIn('noevidence');
    expect(r.location).toBe(`${PUBLIC}/`);
    expect(session(r)).toBe(true);
    expect(await notices('noevidence')).toHaveLength(1);
  });
});
