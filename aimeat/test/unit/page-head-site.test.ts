import { describe, it, expect } from 'vitest';
import { injectSiteHead, injectPageHead } from '../../src/utils/page-head.js';
import type { AimeatConfig } from '../../src/config.js';
import type { PublicPage } from '../../src/data/public-pages.js';

/**
 * THE HOLE THIS FILE IS THE MEMORY OF.
 *
 * The node's identity was a set of literals in public/spa.html: `<title>AIMEAT …`, an og:image at
 * https://aimeat.io/og-image.png, and two JSON-LD blocks naming AIMEAT and its operator's company
 * in `sameAs`. serveSpa rewrote the HOST in those strings and nothing else, so a second node
 * running this software served structured data asserting that it WAS that company — to Google, to
 * every unfurler, and to every agent that resolves "who is this".
 *
 * Two more failures rode along. og:image and the twitter card sat in the shell, where the
 * per-route injection never reached them, so all ten registry pages shared one social card. And a
 * Search Console verification tag could not be added without editing source, which is the first
 * thing an operator has to do and the one door that was shut to them.
 *
 * These tests are about three things: the node describes ITSELF, a page that describes itself wins
 * over the node-wide fallback, and the master switch actually says noindex.
 */

const cfg = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  baseUrl: 'https://node.example',
  seoIndexing: 'on',
  seoSiteName: 'Acme Knowledge',
  seoSiteDescription: 'What Acme knows, and who may read it.',
  seoOgImage: '/og-image.png',
  seoOrganizationName: 'Acme Oy',
  seoOrganizationUrl: '',
  seoOrganizationLogo: '/favicon.svg',
  seoSameAs: ['https://github.com/miikkij/aimeat-protocol'],
  seoTwitterSite: '',
  seoVerificationGoogle: '',
  seoVerificationBing: '',
  seoVerificationExtra: {},
  ...over,
} as unknown as AimeatConfig);

/** The shell as it reaches injectSiteHead: a title and a description, nothing else. */
const shell = '<!DOCTYPE html><html lang="en"><head>'
  + '<title>AIMEAT</title>'
  + '<meta name="description" content="stale shell copy">'
  + '</head><body></body></html>';

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  path: '/v1/business',
  title: 'AIMEAT for your business',
  description: 'What AIMEAT does for an organisation, in one sentence long enough to be a description.',
  changefreq: 'monthly',
  priority: '0.8',
  ...over,
} as PublicPage);

describe('injectSiteHead', () => {
  it('says who THIS node is, not who the software vendor is', () => {
    const out = injectSiteHead(shell, cfg());
    expect(out).toContain('<title>Acme Knowledge</title>');
    expect(out).toContain('content="What Acme knows, and who may read it."');
    expect(out).toContain('"name":"Acme Oy"');
    // The Organization url falls back to this node's own base URL when the operator left it empty.
    expect(out).toContain('"url":"https://node.example"');
    expect(out).not.toContain('aimeat.io');
  });

  it('absolutises the social image, because a crawler cannot resolve a relative one', () => {
    const out = injectSiteHead(shell, cfg());
    expect(out).toContain('<meta property="og:image" content="https://node.example/og-image.png">');
    expect(out).toContain('<meta name="twitter:image" content="https://node.example/og-image.png">');
    expect(out).toContain('content="summary_large_image"');
  });

  it('serves the verification tags an operator pasted, and omits the ones they did not', () => {
    const out = injectSiteHead(shell, cfg({
      seoVerificationGoogle: 'abc123',
      seoVerificationExtra: { 'yandex-verification': 'yx1' },
    }));
    expect(out).toContain('<meta name="google-site-verification" content="abc123">');
    expect(out).toContain('<meta name="yandex-verification" content="yx1">');
    expect(out).not.toContain('msvalidate.01');
  });

  it('refuses a verification tag name that would break out of the attribute', () => {
    const out = injectSiteHead(shell, cfg({
      seoVerificationExtra: { 'evil"><script>alert(1)</script': 'x' },
    }));
    expect(out).not.toContain('<script>alert(1)');
  });

  it('says noindex when the master switch is off', () => {
    const out = injectSiteHead(shell, cfg({ seoIndexing: 'off' }));
    expect(out).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('says nothing about robots when the switch is on', () => {
    expect(injectSiteHead(shell, cfg())).not.toContain('name="robots"');
  });

  it('is idempotent: a second pass does not stack a second Organization block', () => {
    const once = injectSiteHead(shell, cfg());
    const twice = injectSiteHead(once, cfg());
    expect(twice.match(/"@type":"Organization"/g)).toHaveLength(1);
    expect(twice.match(/"@type":"SoftwareApplication"/g)).toHaveLength(1);
  });

  it('leaves a document with no head alone', () => {
    expect(injectSiteHead('just text', cfg())).toBe('just text');
  });
});

describe('injectSiteHead then injectPageHead', () => {
  it('lets the page describe itself over the node-wide fallback', () => {
    const config = cfg();
    let out = injectSiteHead(shell, config);
    out = injectPageHead(out, page(), config);
    expect(out).toContain('<title>AIMEAT for your business</title>');
    expect(out).toContain('<link rel="canonical" href="https://node.example/v1/business">');
    // og:title followed the page, not the node.
    expect(out).toContain('<meta property="og:title" content="AIMEAT for your business">');
    // …and so did the twitter pair, which for a while did not: one link unfurled with the page's
    // own name everywhere except X, where it showed the node's generic blurb instead.
    expect(out).toContain('<meta name="twitter:title" content="AIMEAT for your business">');
    expect(out).not.toContain('<meta name="twitter:description" content="What Acme knows, and who may read it.">');
    // …while the node-level facts the page says nothing about survive.
    expect(out).toContain('<meta property="og:site_name" content="Acme Knowledge">');
  });

  it('gives a page its own social card when it has one, and the node\'s when it does not', () => {
    const config = cfg();
    const withOwn = injectPageHead(injectSiteHead(shell, config), page({ image: '/press/business.png' }), config);
    expect(withOwn).toContain('<meta property="og:image" content="https://node.example/press/business.png">');
    expect(withOwn).toContain('<meta name="twitter:image" content="https://node.example/press/business.png">');

    const withoutOwn = injectPageHead(injectSiteHead(shell, config), page(), config);
    expect(withoutOwn).toContain('<meta property="og:image" content="https://node.example/og-image.png">');
  });

  it('names this node in the page structured data, not the software vendor', () => {
    const config = cfg();
    const out = injectPageHead(injectSiteHead(shell, config), page(), config);
    expect(out).toContain('"isPartOf":{"@type":"WebSite","name":"Acme Knowledge"');
  });
});
