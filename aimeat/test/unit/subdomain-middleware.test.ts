/**
 * @file subdomain-middleware.test.ts
 * @description Unit tests for subdomainMiddleware — resolves req.subdomain + req.appOrigin
 *   from the x-subdomain/x-app-origin headers (production, nginx) and the hostname fallback
 *   (dev). Locks the H-2 two-level app-origin parsing (`<sub>.apps.<apex>` / `apps.<apex>`)
 *   and ensures the app host is never mis-parsed as the apex subdomain "apps".
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (H-2 app-origin isolation, Phase 1).
 */
import { describe, it, expect } from 'vitest';
import { subdomainMiddleware } from '../../src/middleware/subdomain.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Request, Response } from 'express';

const config = { baseUrl: 'https://aimeat.io', appHost: 'apps.aimeat.io' } as unknown as AimeatConfig;

/** Build a mock Request with a hostname and header bag (req.get reads it case-insensitively). */
function mockReq(hostname: string, headers: Record<string, string> = {}): Request {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return {
        hostname,
        headers: lower,
        get(name: string) { return lower[name.toLowerCase()]; },
    } as unknown as Request;
}

function run(req: Request): { subdomain: string | null | undefined; appOrigin: boolean | undefined } {
    const mw = subdomainMiddleware(config);
    let called = false;
    mw(req, {} as Response, () => { called = true; });
    expect(called).toBe(true);
    return { subdomain: req.subdomain, appOrigin: req.appOrigin };
}

describe('subdomainMiddleware — hostname fallback', () => {
    it('apex host → no subdomain, not app origin', () => {
        expect(run(mockReq('aimeat.io'))).toEqual({ subdomain: null, appOrigin: false });
    });

    it('single-label apex subdomain → subdomain set, not app origin', () => {
        expect(run(mockReq('sanomat.aimeat.io'))).toEqual({ subdomain: 'sanomat', appOrigin: false });
    });

    it('bare app host (apps.aimeat.io) → app origin, NO subdomain (not parsed as "apps")', () => {
        expect(run(mockReq('apps.aimeat.io'))).toEqual({ subdomain: null, appOrigin: true });
    });

    it('per-app sub on the app host (<sub>.apps.aimeat.io) → app origin + subdomain', () => {
        expect(run(mockReq('sanomat.apps.aimeat.io'))).toEqual({ subdomain: 'sanomat', appOrigin: true });
    });

    it('unknown unrelated host → nothing set', () => {
        expect(run(mockReq('example.com'))).toEqual({ subdomain: null, appOrigin: false });
    });
});

describe('subdomainMiddleware — header path (nginx)', () => {
    it('x-app-origin + x-subdomain → app origin + subdomain', () => {
        expect(run(mockReq('whatever', { 'x-app-origin': '1', 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'sanomat', appOrigin: true });
    });

    it('x-app-origin alone → app origin, no subdomain (bare app host)', () => {
        expect(run(mockReq('whatever', { 'x-app-origin': '1' })))
            .toEqual({ subdomain: null, appOrigin: true });
    });

    it('x-subdomain alone (apex subdomain) → subdomain, not app origin', () => {
        expect(run(mockReq('whatever', { 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'sanomat', appOrigin: false });
    });

    it('x-app-origin: 0 is treated as not the app origin', () => {
        expect(run(mockReq('whatever', { 'x-app-origin': '0', 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'sanomat', appOrigin: false });
    });
});

describe('subdomainMiddleware — app origin disabled (no appHost)', () => {
    const noApp = { baseUrl: 'https://aimeat.io', appHost: '' } as unknown as AimeatConfig;
    it('apps.aimeat.io with no configured appHost → parsed as the apex subdomain "apps"', () => {
        const req = mockReq('apps.aimeat.io');
        const mw = subdomainMiddleware(noApp);
        mw(req, {} as Response, () => { /* next */ });
        expect(req.appOrigin).toBe(false);
        expect(req.subdomain).toBe('apps');
    });
});
