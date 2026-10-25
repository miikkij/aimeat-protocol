/**
 * @file test/unit/refused-credential-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Bearer value this node never signed costs no revoked-token read, and refused
 *   credentials from one address are counted by an address limiter, so the 401 path is bounded like
 *   any other request (secaudit2026oct22, refused-credential-before-rate-limit). A revoked token
 *   that this node did sign is still refused, and a live token still passes.
 * @usage pnpm exec vitest run test/unit/refused-credential-cost.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — secaudit2026oct22: forged values, the refusal limiter, a revoked token and
 *     a live token.
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

const NODE = 'aimeat-unit-refused-cost';

const revoked = new Set<string>();
const reads = { revoked: 0, pat: 0 };
const storage = {
  isTokenRevoked: async (hash: string) => { reads.revoked += 1; return revoked.has(hash); },
  revokeToken: async (hash: string) => { revoked.add(hash); },
  cleanExpiredRevocations: async () => 0,
  getOwner: async (name: string) => ({ name, roles: ['owner'], createdAt: '2020-01-01T00:00:00.000Z', disabledAt: null }),
  isSessionRevoked: async () => false,
  getAppGrant: async () => null,
  getEcosystemApp: async () => null,
  getPatByHash: async () => { reads.pat += 1; return null; },
  getPat: async () => null,
  touchPat: async () => undefined,
  getAgent: async () => null,
} as unknown as Storage;

type Mw = typeof import('../../src/auth/middleware.js');
type Jwt = typeof import('../../src/auth/jwt.js');
type Rl = typeof import('../../src/middleware/rate-limit.js');
let mw: Mw;
let jwt: Jwt;
let rl: Rl;
let foreignSign: (n: number) => Promise<string>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  // A token signed by a key this node does not hold: shaped like ours, verified by nothing here.
  const foreign = await generateKeyPair();
  const foreignJwt = await import('../../src/auth/jwt.js');
  await foreignJwt.initNodeKeys(foreign.publicKey, foreign.privateKey);
  const forged: string[] = [];
  for (let n = 0; n < 12; n++) forged.push(await foreignJwt.issueJWT({ sub: `mallory-${n}`, owner: 'mallory', node: NODE, roles: ['owner'] }, 3600));
  foreignSign = async (n: number) => forged[n]!;
  const keys = await generateKeyPair();
  jwt = foreignJwt;
  await jwt.initNodeKeys(keys.publicKey, keys.privateKey);
  jwt.initRevocationStorage(storage);
  mw = await import('../../src/auth/middleware.js');
  mw.initSessionAuth(storage, { nodeId: NODE } as AimeatConfig);
  rl = await import('../../src/middleware/rate-limit.js');
});
afterAll(() => { vi.useRealTimers(); });

interface Outcome { status: number | null; code?: string; nextCalled: boolean }

async function run(auth: ReturnType<Mw['optionalAuth']>, token: string, ip = '203.0.113.9'): Promise<Outcome> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, host: 'node.test' };
  const req = {
    headers, path: '/v1/agents/me/handbook', originalUrl: '/v1/agents/me/handbook', method: 'GET', ip, socket: {},
    protocol: 'https', hostname: 'node.test', secure: true, get: (h: string) => headers[h.toLowerCase()],
  } as unknown as Request;
  const out: Outcome = { status: null, nextCalled: false };
  const res = {
    headersSent: false,
    setHeader: () => res,
    cookie: () => res,
    status(code: number) { out.status = code; return res; },
    json(body: { error?: { code?: string } }) { out.code = body?.error?.code; return res; },
  } as unknown as Response;
  await auth(req, res, () => { out.nextCalled = true; });
  return out;
}

describe('a refused credential', () => {
  it('a value this node never signed costs no revoked-token read', async () => {
    const auth = mw.optionalAuth();
    const before = reads.revoked;
    for (let n = 0; n < 10; n++) {
      const out = await run(auth, await foreignSign(n));
      expect(out.status).toBe(401);
    }
    expect(reads.revoked - before).toBe(0);
  });

  it('refusals from one address are counted, and answered 429 past the limit', async () => {
    const auth = mw.optionalAuth({ refusedLimiter: rl.rateLimit({ windowMs: 60_000, max: 2, keyBy: 'ip' }) });
    const statuses: Array<number | null> = [];
    for (let n = 0; n < 5; n++) statuses.push((await run(auth, await foreignSign(n), '203.0.113.20')).status);
    expect(statuses).toEqual([401, 401, 429, 429, 429]);
    // Another address has its own count.
    expect((await run(auth, await foreignSign(6), '203.0.113.21')).status).toBe(401);
    // A dead access token is counted the same way.
    expect((await run(auth, 'aimeat_pat_0000000000000000000000000000000000000000', '203.0.113.20')).status).toBe(429);
  });

  it('a revoked token this node signed is still refused', async () => {
    const auth = mw.optionalAuth({ refusedLimiter: rl.rateLimit({ windowMs: 60_000, max: 100, keyBy: 'ip' }) });
    const t = await jwt.issueJWT({ sub: 'alice', owner: 'alice', node: NODE, roles: ['owner'] }, 3600);
    await jwt.revokeToken(t, Math.floor(Date.now() / 1000) + 3600);
    const out = await run(auth, t, '203.0.113.30');
    expect(out.status).toBe(401);
    expect(out.nextCalled).toBe(false);
  });

  it('a live token passes, and is not counted as a refusal', async () => {
    const auth = mw.optionalAuth({ refusedLimiter: rl.rateLimit({ windowMs: 60_000, max: 1, keyBy: 'ip' }) });
    for (let n = 0; n < 3; n++) {
      const t = await jwt.issueJWT({ sub: 'bob', owner: 'bob', node: NODE, roles: ['owner'] }, 3600 + n);
      const out = await run(auth, t, '203.0.113.40');
      expect(out.nextCalled).toBe(true);
    }
  });
});
