/**
 * @file robots-header.test.ts
 * @description The X-Robots-Tag decision (src/middleware/robots-header.ts), one case per rule.
 *   Bing judged aimeat.io by the addresses its front page linked to: signed-in views titled
 *   "AIMEAT" with no content, and machine documents with no title at all. The front page sat at
 *   "Discovered but not crawled" for five months (2026-09-30). The e2e suite
 *   e2e-seo-noindex.ts proves the same rules on a served node.
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (wish-bing-noindex-kirjautumissivut-ja-konetiedostot)
 */
import { describe, it, expect } from 'vitest';
import { robotsTagFor, type RobotsTagInput } from '../../src/middleware/robots-header.js';

const html = 'text/html; charset=utf-8';
const on = (over: Partial<RobotsTagInput>): string | null =>
  robotsTagFor({ path: '/', ownOrigin: false, contentType: html, ...over });

describe('robotsTagFor: machine documents', () => {
  it.each([
    ['/llms.txt', 'text/plain; charset=utf-8'],
    ['/llms-full.txt', 'text/plain; charset=utf-8'],
    ['/AGENTS.md', 'text/markdown; charset=utf-8'],
    ['/sitemap.md', 'text/markdown; charset=utf-8'],
    ['/v1/spec', 'application/yaml'],
    ['/', 'application/json; charset=utf-8'],
    ['/v1/apps', 'application/json; charset=utf-8'],
    ['/.well-known/api-catalog', 'application/linkset+json'],
    ['/css/theme.css', 'text/css; charset=utf-8'],
  ])('%s answered as %s is noindex', (path, contentType) => {
    expect(on({ path, contentType })).toBe('noindex');
  });

  it('is noindex on an app origin as well', () => {
    expect(on({ path: '/llms.txt', contentType: 'text/plain', ownOrigin: true })).toBe('noindex');
  });

  it.each(['/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/sitemap-portfolios.xml'])(
    '%s, which a crawler reads as instructions, carries no header', (path) => {
      expect(on({ path, contentType: 'application/xml' })).toBeNull();
      expect(on({ path, contentType: 'text/plain', ownOrigin: true })).toBeNull();
    });

  it('the IndexNow key file carries no header', () => {
    expect(on({ path: '/abc123.txt', contentType: 'text/plain', indexNowKey: 'abc123' })).toBeNull();
    expect(on({ path: '/abc123.txt', contentType: 'text/plain' })).toBe('noindex');
  });

  it('a response with no Content-Type (a 304, a bare redirect) is left alone', () => {
    expect(on({ path: '/v1/admin', contentType: '' })).toBeNull();
  });
});

describe('robotsTagFor: HTML pages on the apex', () => {
  it.each([
    '/', '/v1/business', '/v1/how-it-works', '/v1/docs', '/v1/help', '/v1/connect', '/v1/glossary',
    '/v1/changelog', '/v1/how-an-app-builds', '/v1/everything', '/v1/app-store', '/v1/members',
    '/v1/transparency', '/v1/privacy', '/v1/terms', '/v1/portal', '/v1/privacy/fi', '/v1/connect/fi',
  ])('the public page %s stays indexable', (path) => {
    expect(on({ path })).toBeNull();
  });

  it.each([
    '/v1/admin', '/v1/appcat', '/v1/chat', '/v1/home', '/v1/profile', '/v1/fleet', '/v1/aimeat-os',
    '/v1/classic', '/v1/portfolio', '/v1/start', '/v1/app-grant', '/v1/invite', '/v1/connect-your-ai',
    '/v1/publicworkspaceviewer', '/v1/design-lab/frame', '/v1/agents/verify', '/v1/oauth/consent',
    '/v1/setup/wizard', '/v1/admin/setup', '/spa.html', '/app-catalog.html',
  ])('the page %s, which is not a content page, is noindex but followed', (path) => {
    expect(on({ path })).toBe('noindex, follow');
  });

  it('/v1/portal?view=dev is noindex, /v1/portal itself is not', () => {
    expect(on({ path: '/v1/portal', view: 'dev' })).toBe('noindex, follow');
    expect(on({ path: '/v1/portal' })).toBeNull();
  });

  it.each(['/v1/apps/alice/game.html', '/v1/portfolio/alice', '/v1/designbook', '/v1/provenance/x'])(
    '%s makes its own decision and is left alone', (path) => {
      expect(on({ path })).toBeNull();
    });

  it('an HTML page on an app or portfolio origin is its owner\'s decision', () => {
    expect(on({ path: '/', ownOrigin: true })).toBeNull();
    expect(on({ path: '/about', ownOrigin: true })).toBeNull();
  });
});
