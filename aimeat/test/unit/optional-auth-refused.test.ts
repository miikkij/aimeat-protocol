/**
 * @file test/unit/optional-auth-refused.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description optionalAuth() answers a Bearer token it refused with 401 invalid_token on every route,
 *   and leaves a request with no token as it was (QA audit F1-01). It used to leave req.auth unset and
 *   call next(), so a route without requireAuth() served its public or empty view to a caller whose
 *   token was dead, and in anonymous mode gave them the shared anonymous identity.
 *   Cases: an expired JWT, a revoked JWT, garbage, a dead personal access token — each with anonymous
 *   mode on and off — plus a live token and no token, an opaque token that belongs to another route
 *   (SCIM) and sign-out with an expired token, which stay with their routes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/optional-auth-refused.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F1-01).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));

import { generateKeyPair } from '../../src/auth/keypair.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-unit-optional-auth';

const revoked = new Set<string>();
const storage = {
  isTokenRevoked: async (hash: string) => revoked.has(hash),
  revokeToken: async (hash: string) => { revoked.add(hash); },
  cleanExpiredRevocations: async () => 0,
  getOwner: async (name: string) => ({ name, roles: ['owner'], createdAt: '2020-01-01T00:00:00.000Z', disabledAt: null }),
  isSessionRevoked: async () => false,
  getAppGrant: async () => null,
  getEcosystemApp: async () => null,
  getPatByHash: async () => null,
  getPat: async () => null,
  touchPat: async () => undefined,
  getAgent: async () => null,
} as unknown as Storage;

type Mw = typeof import('../../src/auth/middleware.js');
type Jwt = typeof import('../../src/auth/jwt.js');
type NodeAuth = typeof import('../../src/auth/node-auth.js');
let mw: Mw;
let jwt: Jwt;
let nodeAuth: NodeAuth;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const keys = await generateKeyPair();
  jwt = await import('../../src/auth/jwt.js');
  await jwt.initNodeKeys(keys.publicKey, keys.privateKey);
  jwt.initRevocationStorage(storage);
  mw = await import('../../src/auth/middleware.js');
  mw.initSessionAuth(storage, { nodeId: NODE } as AimeatConfig);
  nodeAuth = await import('../../src/auth/node-auth.js');
});
afterAll(() => { vi.useRealTimers(); });

interface Outcome { status: number | null; code?: string; nextCalled: boolean; auth: Request['auth'] }

async function run(token: string | null, path = '/v1/agents/me/handbook'): Promise<Outcome> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}`, host: 'node.test' } : { host: 'node.test' };
  const req = {
    headers, path, originalUrl: path, method: 'GET', ip: '127.0.0.1',
    protocol: 'https', hostname: 'node.test', secure: true, get: (h: string) => headers[h.toLowerCase()],
  } as unknown as Request;
  const out: Outcome = { status: null, nextCalled: false, auth: undefined };
  const res = {
    headersSent: false,
    setHeader: () => res,
    cookie: () => res,
    status(code: number) { out.status = code; return res; },
    json(body: { error?: { code?: string } }) { out.code = body?.error?.code; return res; },
  } as unknown as Response;
  await mw.optionalAuth()(req, res, () => { out.nextCalled = true; });
  out.auth = req.auth;
  return out;
}

const ownerToken = (ttl: number) => jwt.issueJWT({ sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'] }, ttl);

describe.each([false, true])('anonymous mode %s', (anonymousOn) => {
  beforeAll(() => {
    if (anonymousOn) nodeAuth.enableAnonymousAuth(`shared#anonymous@${NODE}`, 'anonymous');
  });

  it('an expired JWT is answered 401 invalid_token, not served as no credential', async () => {
    const out = await run(await ownerToken(-60));
    expect(out.status).toBe(401);
    expect(out.code).toBe('INVALID_TOKEN');
    expect(out.nextCalled).toBe(false);
  });

  it('a revoked JWT is answered 401', async () => {
    const t = await ownerToken(3600 + (anonymousOn ? 1 : 0));
    await jwt.revokeToken(t, Math.floor(Date.now() / 1000) + 3600);
    const out = await run(t);
    expect(out.status).toBe(401);
    expect(out.nextCalled).toBe(false);
  });

  it('a token that is not a token at all is answered 401', async () => {
    const out = await run('garbage.not.ajwt');
    expect(out.status).toBe(401);
    expect(out.nextCalled).toBe(false);
  });

  it('a dead personal access token is answered 401', async () => {
    const out = await run('aimeat_pat_0000000000000000000000000000000000000000');
    expect(out.status).toBe(401);
    expect(out.nextCalled).toBe(false);
  });

  it('a live token passes with its identity', async () => {
    const out = await run(await ownerToken(3700 + (anonymousOn ? 1 : 0)));
    expect(out.status).toBeNull();
    expect(out.nextCalled).toBe(true);
    expect(out.auth?.sub).toBe('alice');
  });

  it('a Bearer value that is not ours (an opaque SCIM provisioning token) is left to its own route', async () => {
    const out = await run('aimeat_scim_abcdefghijklmnopqrstuvwxyz0123456789', '/v1/scim/v2/conn/Users');
    expect(out.status).toBeNull();
    expect(out.nextCalled).toBe(true);
  });

  it('sign-out still works with an expired token: the route answers for it', async () => {
    const out = await run(await ownerToken(-120), '/v1/auth/revoke');
    expect(out.status).toBeNull();
    expect(out.nextCalled).toBe(true);
  });

  it('a request with no token is unchanged: public, or the anonymous identity when the mode is on', async () => {
    const out = await run(null);
    expect(out.status).toBeNull();
    expect(out.nextCalled).toBe(true);
    if (anonymousOn) expect(out.auth?.anonymous).toBe(true);
    else expect(out.auth).toBeUndefined();
  });
});
