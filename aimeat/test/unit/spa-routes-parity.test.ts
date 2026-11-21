/**
 * @file test/unit/spa-routes-parity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SPA's client routes (spa.html ROUTES) and the addresses the server serves the SPA
 *   shell on (SPA_PAGE_PATHS) are one list written twice. A view in ROUTES alone works on a click and
 *   answers 404 on F5; a path in SPA_PAGE_PATHS alone serves the shell, which then draws the front
 *   page under that address (docs/pitfalls.md §2 until 2026-11-21).
 * @version-history
 *   v1.0.1 — 2026-11-21 — /v1/app-store's reason names the crawler page; the admin link left it.
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPA_PAGE_PATHS } from '../../src/data/spa-page-paths.js';

const SPA = readFileSync(new URL('../../public/spa.html', import.meta.url), 'utf8');

/** The literal keys of the `const ROUTES = { … }` object in spa.html. */
function clientRoutes(html: string): string[] {
    const start = html.indexOf('const ROUTES = {');
    const end = html.indexOf('};', start);
    return [...html.slice(start, end).matchAll(/^\s*'(\/[^']+)'\s*:/gm)].map(m => m[1]);
}

/** One side only, on purpose, with the reason. */
const ONE_SIDE: Record<string, string> = {
    // routes/portal.ts serves GET /v1/portal itself (with its canonical link and markdown), so it is
    // not in SPA_PAGE_PATHS; ROUTES uses it as the view every unknown address falls back to.
    '/v1/portal': 'served by its own route in routes/portal.ts',
    // The public app list a search engine reads (data/public-pages.ts, services/page/body-live.ts
    // writes its crawler body, the sitemap names it). The shell is served here and no view owns the
    // address, so a person who opens it sees the front page. The node's own links go to /v1/appcat
    // (services/home/rooms.ts, the admin Apps tab since 2026-11-21). Which view owns this address is
    // not decided.
    '/v1/app-store': 'public crawler page; no client view, the shell draws the front page (open question)',
};

describe('spa.html ROUTES and SPA_PAGE_PATHS name the same pages', () => {
    const routes = clientRoutes(SPA);
    it('reads the client routes (the parse is not empty)', () => {
        expect(routes.length).toBeGreaterThan(20);
        expect(routes).toContain('/v1/profile');
    });
    it('every client route is served the SPA shell on a refresh', () => {
        expect(routes.filter(r => !SPA_PAGE_PATHS.includes(r) && !(r in ONE_SIDE)),
            'add it to SPA_PAGE_PATHS (src/data/spa-page-paths.ts), or F5 on the view is a 404').toEqual([]);
    });
    it('every address served the shell has a view of its own', () => {
        expect(SPA_PAGE_PATHS.filter(p => !routes.includes(p) && !(p in ONE_SIDE)),
            'add the view to ROUTES in public/spa.html, or the shell draws the front page at this address').toEqual([]);
    });
    it('the one-side list names only addresses that are on one side', () => {
        expect(Object.keys(ONE_SIDE).filter(p => routes.includes(p) && SPA_PAGE_PATHS.includes(p))).toEqual([]);
    });
});
