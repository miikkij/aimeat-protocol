/**
 * @file test/unit/rate-limit-anonymous.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In anonymous mode each visitor without a credential has a rate-limit count of its own,
 *   keyed by address, and the visitor multiplier (secaudit2026oct22,
 *   auto-key-shared-anonymous-principal).
 * @usage pnpm exec vitest run test/unit/rate-limit-anonymous.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — secaudit2026oct22: two visitors on the shared anonymous identity, and an
 *     identified agent that keeps one count across addresses.
 */
import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from '../../src/middleware/rate-limit.js';
import type { VerifiedToken } from '../../src/auth/jwt.js';

const ANON: VerifiedToken = {
  sub: 'shared#anonymous@test-node', owner: 'anonymous', node: '', roles: ['agent'],
  exp: Math.floor(Date.now() / 1000) + 3600, scopes: ['memory:read'], anonymous: true,
};
const AGENT: VerifiedToken = {
  sub: 'helper#alice@test-node', owner: 'alice', node: '', roles: ['agent'],
  exp: Math.floor(Date.now() / 1000) + 3600, scopes: ['memory:read'],
};
const MULTIPLIERS = { operator: 10, owner: 4, agent: 2, anonymous: 1 };

/** One request through a limiter: the status it set (200 when it called next) and its limit header. */
function hit(limiter: ReturnType<typeof rateLimit>, ip: string, auth?: VerifiedToken): { status: number; limit: number } {
  let status = 200;
  let limit = 0;
  const res = {
    setHeader: (k: string, v: number) => { if (k === 'X-RateLimit-Limit') limit = v; },
    status: (s: number) => { status = s; return res; },
    json: () => res,
  } as unknown as Response;
  limiter({ ip, socket: {}, path: '/x', auth } as unknown as Request, res, () => undefined);
  return { status, limit };
}

describe('rateLimit and the shared anonymous identity', () => {
  it('counts two visitors on the anonymous identity separately, by address', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    expect(hit(limiter, '198.51.100.1', ANON).status).toBe(200);
    expect(hit(limiter, '198.51.100.1', ANON).status).toBe(200);
    expect(hit(limiter, '198.51.100.1', ANON).status).toBe(429);
    expect(hit(limiter, '198.51.100.2', ANON).status).toBe(200);
  });

  it('gives a visitor on the anonymous identity the visitor multiplier', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 10 }, MULTIPLIERS);
    expect(hit(limiter, '198.51.100.3', ANON).limit).toBe(10);
    expect(hit(limiter, '198.51.100.3').limit).toBe(10);
  });

  it('keeps one count for an identified agent, whatever address it calls from', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 }, MULTIPLIERS);
    expect(hit(limiter, '198.51.100.4', AGENT)).toEqual({ status: 200, limit: 4 });
    expect(hit(limiter, '198.51.100.5', AGENT).status).toBe(200);
    expect(hit(limiter, '198.51.100.6', AGENT).status).toBe(200);
    expect(hit(limiter, '198.51.100.7', AGENT).status).toBe(200);
    expect(hit(limiter, '198.51.100.8', AGENT).status).toBe(429);
  });
});
