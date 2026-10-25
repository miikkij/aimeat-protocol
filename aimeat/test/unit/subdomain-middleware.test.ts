/**
 * @file subdomain-middleware.test.ts
 * @description Unit tests for subdomainMiddleware — resolves req.subdomain + req.appOrigin
 *   from the x-subdomain/x-app-origin headers (production, nginx) and the hostname fallback
 *   (dev). Locks the H-2 two-level app-origin parsing (`<sub>.apps.<apex>` / `apps.<apex>`)
 *   and ensures the app host is never mis-parsed as the apex subdomain "apps".
 * @version-history
 *   2026-10-25 — X-Subdomain counts only when it equals the Host's label; the case that asserted it set
 *     the label on an unrelated Host now asserts null (approved by Jouni, secaudit2026oct22).
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
    // Express derives req.hostname FROM the Host header, so a mock that sets one without the other
    // is a request no server ever sees. The middleware reads headers.host directly when it checks
    // that an origin marker's family matches the host nginx routed on, and it read as absent here.
    if (!lower.host) lower.host = hostname;
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
    // The Host must belong to the family the marker claims. Until 2026-08-11 it did not have to,
    // and the apex nginx block was not blanking the markers either, so one request header made the
    // node believe a request had arrived on the isolated app origin. That skipped the redirect and
    // served app HTML on the origin the session lives on, which is the whole H-2 isolation.
    //
    // These two cases used the Host 'whatever' precisely because the Host was ignored. They now
    // carry the host nginx would have routed on.
    it('x-app-origin + x-subdomain → app origin + subdomain', () => {
        expect(run(mockReq('sanomat.apps.aimeat.io', { 'x-app-origin': '1', 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'sanomat', appOrigin: true });
    });

    it('x-app-origin alone → app origin, no subdomain (bare app host)', () => {
        expect(run(mockReq('apps.aimeat.io', { 'x-app-origin': '1' })))
            .toEqual({ subdomain: null, appOrigin: true });
    });

    it('a forged x-app-origin on the apex is ignored', () => {
        expect(run(mockReq('aimeat.io', { 'x-app-origin': '1' })))
            .toEqual({ subdomain: null, appOrigin: false });
    });

    it('x-subdomain alone (apex subdomain) → subdomain, not app origin', () => {
        expect(run(mockReq('sanomat.aimeat.io', { 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'sanomat', appOrigin: false });
    });

    // Approved behaviour change (Jouni, 2026-10-25): X-Subdomain counts only when it names the label
    // the Host yields. On a Host in no family it set req.subdomain by itself (secaudit2026oct22,
    // subdomain-label-from-client-headers).
    it('x-subdomain on a Host that yields no label is dropped', () => {
        expect(run(mockReq('whatever', { 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: null, appOrigin: false });
        expect(run(mockReq('aimeat.io', { 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: null, appOrigin: false });
    });

    it('x-subdomain naming another label than the Host is dropped; the Host label stands', () => {
        expect(run(mockReq('blog.aimeat.io', { 'x-subdomain': 'sanomat' })))
            .toEqual({ subdomain: 'blog', appOrigin: false });
        expect(run(mockReq('mine.apps.aimeat.io', { 'x-app-origin': '1', 'x-subdomain': 'theirs' })))
            .toEqual({ subdomain: 'mine', appOrigin: true });
    });

    it('the label never comes from X-Forwarded-Host (req.hostname)', () => {
        const req = mockReq('aimeat.io', { 'x-subdomain': 'sanomat' });
        (req as unknown as { hostname: string }).hostname = 'sanomat.aimeat.io';
        expect(run(req)).toEqual({ subdomain: null, appOrigin: false });
    });

    it('x-app-origin: 0 is treated as not the app origin', () => {
        expect(run(mockReq('sanomat.aimeat.io', { 'x-app-origin': '0', 'x-subdomain': 'sanomat' })))
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
