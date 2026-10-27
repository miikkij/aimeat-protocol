/**
 * @file test/unit/app-origin-sign-in-families.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-origin sign-in refusal (src/middleware/app-origin-sign-in.ts) reads every
 *   origin that serves author-written script same-site with the apex: the app host family, the
 *   portfolio pages and the company front pages. It also knows a sign-in route whatever the case of
 *   its path, as Express routes it (secaudit2026oct26,
 *   app-origin-sign-in.ts:requestFromApp-misses-portfolio-company-origins-and-case-variant-paths).
 *   The usage half: the apex SPA, a caller without an Origin (the CLI, the CrewAI package, the crew
 *   image), the SAML assertion consumer's `Origin: null` and every route that is not a sign-in route
 *   pass as before, and with the setting off nothing is refused.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-origin-sign-in-families.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../src/config.js';
import { appOriginSignIn, isSignInRoute, requestFromApp } from '../../src/middleware/app-origin-sign-in.js';

const config = {
  nodeId: 'test-node', baseUrl: 'https://aimeat.test', appHost: 'apps.aimeat.test',
  portfolioHost: 'portfolio.aimeat.test', coHost: 'co.aimeat.test', appOriginSignInRefuse: true,
} as unknown as AimeatConfig;

function req(path: string, origin?: string, flags: Partial<Record<'appOrigin' | 'portfolioOrigin' | 'coOrigin', boolean>> = {}, method = 'POST'): Request {
  return { method, path, headers: origin === undefined ? {} : { origin }, appOrigin: false, portfolioOrigin: false, coOrigin: false, ...flags } as unknown as Request;
}

/** The status the middleware answers, or 'next' when it lets the request through. */
function run(r: Request, cfg: AimeatConfig = config): number | 'next' {
  let status: number | 'next' = 'next';
  const res = { status: (s: number) => { status = s; return { json: () => undefined }; } } as unknown as Response;
  let passed = false;
  appOriginSignIn(cfg)(r, res, () => { passed = true; });
  return passed ? 'next' : status;
}

describe('the refusal reads every author-script origin', () => {
  it('a portfolio page origin is an app', () => {
    expect(requestFromApp(req('/v1/ghii/login', 'https://alice.portfolio.aimeat.test'), config)).not.toBeNull();
    expect(run(req('/v1/ghii/login', 'https://alice.portfolio.aimeat.test'))).toBe(403);
  });
  it('a company front page origin is an app', () => {
    expect(run(req('/v1/ghii/login', 'https://acme.co.aimeat.test'))).toBe(403);
  });
  it('a request that arrived on a portfolio or company host is an app', () => {
    expect(run(req('/v1/ghii/login', undefined, { portfolioOrigin: true }))).toBe(403);
    expect(run(req('/v1/auth/refresh', undefined, { coOrigin: true }))).toBe(403);
  });
  it('a sign-in route in another case is still a sign-in route', () => {
    expect(isSignInRoute('POST', '/V1/GHII/LOGIN')).toBe(true);
    expect(run(req('/V1/GHII/LOGIN', 'https://x.apps.aimeat.test'))).toBe(403);
    expect(run(req('/v1/Auth/Refresh', 'https://alice.portfolio.aimeat.test'))).toBe(403);
  });
});

describe('the uses that pass as before', () => {
  it('the apex SPA signs in', () => {
    expect(run(req('/v1/ghii/login', 'https://aimeat.test'))).toBe('next');
  });
  it('a caller with no Origin signs in', () => {
    expect(run(req('/v1/ghii/login'))).toBe('next');
    expect(run(req('/v1/auth/refresh'))).toBe('next');
  });
  it('the SAML assertion consumer takes Origin: null', () => {
    expect(run(req('/v1/ghii/login/saml/idp1/acs', 'null'))).toBe('next');
  });
  it('a route that is not a sign-in route is not read', () => {
    expect(run(req('/v1/memory', 'https://alice.portfolio.aimeat.test'))).toBe('next');
    expect(run(req('/v1/ghii/me', 'https://acme.co.aimeat.test', {}, 'GET'))).toBe('next');
  });
  it('an app origin is refused as before', () => {
    expect(run(req('/v1/ghii/login', 'https://x.apps.aimeat.test'))).toBe(403);
  });
  it('with the setting off, nothing is refused', () => {
    const off = { ...config, appOriginSignInRefuse: false } as AimeatConfig;
    expect(run(req('/v1/ghii/login', 'https://alice.portfolio.aimeat.test'), off)).toBe('next');
    expect(run(req('/V1/GHII/LOGIN', 'https://x.apps.aimeat.test'), off)).toBe('next');
  });
});
