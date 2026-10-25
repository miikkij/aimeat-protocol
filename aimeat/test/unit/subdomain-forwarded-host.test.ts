/**
 * @file test/unit/subdomain-forwarded-host.test.ts
 * @description The subdomain middleware reads the origin family and the label from the raw Host
 *   header, never from req.hostname. Behind nginx on loopback, Express's 'trust proxy' makes
 *   req.hostname the client's X-Forwarded-Host, so a request whose Host is the apex could name an
 *   app, portfolio or company site of its choosing. The Host nginx routed on decides.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, subdomain label from client headers).
 */
import { describe, it, expect } from 'vitest';
import { subdomainMiddleware } from '../../src/middleware/subdomain.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Request, Response } from 'express';

const config = {
    baseUrl: 'https://aimeat.io', appHost: 'apps.aimeat.io', portfolioHost: 'portfolio.aimeat.io', coHost: 'co.aimeat.io',
} as unknown as AimeatConfig;

/** A request as Express builds it under 'trust proxy': `hostname` from X-Forwarded-Host, `Host` as sent. */
function proxied(host: string, forwardedHost: string, headers: Record<string, string> = {}): Request {
    const lower: Record<string, string> = { host, 'x-forwarded-host': forwardedHost };
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return { hostname: forwardedHost, headers: lower, path: '/', get(n: string) { return lower[n.toLowerCase()]; } } as unknown as Request;
}

function run(req: Request) {
    subdomainMiddleware(config)(req, {} as Response, () => { /* next */ });
    return { subdomain: req.subdomain, appOrigin: req.appOrigin, portfolioOrigin: req.portfolioOrigin, coOrigin: req.coOrigin };
}

const apex = { subdomain: null, appOrigin: false, portfolioOrigin: false, coOrigin: false };

describe('X-Forwarded-Host does not choose the site', () => {
    it('an app label in X-Forwarded-Host on the apex Host is ignored', () => {
        expect(run(proxied('aimeat.io', 'victim.apps.aimeat.io'))).toEqual(apex);
    });
    it('the bare app host in X-Forwarded-Host on the apex Host is ignored', () => {
        expect(run(proxied('aimeat.io', 'apps.aimeat.io'))).toEqual(apex);
    });
    it('a portfolio or company host in X-Forwarded-Host on the apex Host is ignored', () => {
        expect(run(proxied('aimeat.io', 'alice.portfolio.aimeat.io'))).toEqual(apex);
        expect(run(proxied('aimeat.io', 'acme.co.aimeat.io'))).toEqual(apex);
    });
    it('an apex subdomain in X-Forwarded-Host on the apex Host is ignored', () => {
        expect(run(proxied('aimeat.io', 'redirsite.aimeat.io'))).toEqual(apex);
    });
    it('the label nginx marks on a real app Host still comes from that Host', () => {
        expect(run(proxied('notes.apps.aimeat.io', 'other.apps.aimeat.io', { 'x-app-origin': '1' })))
            .toEqual({ subdomain: 'notes', appOrigin: true, portfolioOrigin: false, coOrigin: false });
    });
    it('the no-proxy fallback still reads a family Host', () => {
        expect(run(proxied('notes.apps.aimeat.io', 'notes.apps.aimeat.io'))).toEqual({ subdomain: 'notes', appOrigin: true, portfolioOrigin: false, coOrigin: false });
        expect(run(proxied('alice.portfolio.aimeat.io', 'alice.portfolio.aimeat.io'))).toEqual({ subdomain: 'alice', appOrigin: false, portfolioOrigin: true, coOrigin: false });
    });
});
