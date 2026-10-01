import { describe, it, expect } from 'vitest';
import { apexPageRedirectTarget, type ApexPageRedirectInput } from '../../src/middleware/apex-page-redirect.js';

/**
 * Every app and portfolio host answered the node's content pages with a full copy, so a search
 * engine saw each page once per host (found 2026-10-01 while Bing held aimeat.io at "Discovered but
 * not crawled"). These pin which requests move to the apex and, as importantly, which stay.
 */
const req = (over: Partial<ApexPageRedirectInput> = {}): ApexPageRedirectInput => ({
  method: 'GET',
  path: '/v1/glossary',
  originalUrl: '/v1/glossary',
  appOrigin: true,
  portfolioOrigin: false,
  subdomain: 'turbo',
  baseUrl: 'https://node.example/',
  ...over,
});

describe('apexPageRedirectTarget', () => {
  it('sends a registry page on an app host to the same address on the apex, query kept', () => {
    expect(apexPageRedirectTarget(req())).toBe('https://node.example/v1/glossary');
    expect(apexPageRedirectTarget(req({ path: '/v1/help', originalUrl: '/v1/help?lang=fi' })))
      .toBe('https://node.example/v1/help?lang=fi');
  });

  it('does the same on a portfolio host', () => {
    expect(apexPageRedirectTarget(req({ appOrigin: false, portfolioOrigin: true, subdomain: 'alice' })))
      .toBe('https://node.example/v1/glossary');
  });

  it('sends the bare app host\'s root to the apex, and leaves an app\'s and a portfolio\'s own root', () => {
    expect(apexPageRedirectTarget(req({ path: '/', originalUrl: '/', subdomain: null }))).toBe('https://node.example/');
    expect(apexPageRedirectTarget(req({ path: '/', originalUrl: '/' }))).toBeNull();
    expect(apexPageRedirectTarget(req({ path: '/', originalUrl: '/', appOrigin: false, portfolioOrigin: true, subdomain: null }))).toBeNull();
  });

  it('leaves the apex, the API, the documents and the mirrors where they are', () => {
    expect(apexPageRedirectTarget(req({ appOrigin: false }))).toBeNull();
    for (const path of ['/v1/spec', '/v1/apps/alice/x.html', '/llms.txt', '/robots.txt', '/sitemap.xml', '/v1/glossary.md']) {
      expect(apexPageRedirectTarget(req({ path, originalUrl: path }))).toBeNull();
    }
  });

  it('only GET and HEAD move', () => {
    expect(apexPageRedirectTarget(req({ method: 'HEAD' }))).toBe('https://node.example/v1/glossary');
    expect(apexPageRedirectTarget(req({ method: 'POST' }))).toBeNull();
  });
});
