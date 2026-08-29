/**
 * @file app-legal.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit: the markdown-lite renderer (every character the author wrote is escaped,
 *   only http(s)/mailto links become links), the legal-page request shape, the readiness rule,
 *   the rendered page (whose page it is, the platform disclaimer), the head links and the
 *   listing strip. The route, the audit entries and the origin are in test/e2e-app-legal.ts.
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdownLite } from '../../src/utils/markdown-lite.js';
import {
  parseLegalInput, appLegalState, legalReadiness, renderLegalPage, legalLinksFor, stripLegalContent,
  LEGAL_CONTENT_MAX,
} from '../../src/services/app-legal.js';
import { applyAppHeadMeta } from '../../src/utils/app-head-meta.js';
import type { AppRecord, AppManifest } from '../../src/storage/types/apps.js';

const manifest = (extra: Partial<AppManifest> = {}): AppManifest =>
  ({ name: 'Shop', description: 'A shop', version: '1.0.0', category: 'utility', ...extra }) as unknown as AppManifest;

const app = (extra: Partial<AppManifest> = {}): AppRecord =>
  ({ ownerName: 'alice', ownerGaii: 'alice@node', filename: 'shop.html', manifest: manifest(extra) }) as unknown as AppRecord;

describe('markdown-lite', () => {
  it('renders headings, paragraphs, lists, quotes, code and emphasis', () => {
    const html = renderMarkdownLite('# Terms\n\nSome **bold** and *em* and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\nraw < code\n```\n\n---\n');
    expect(html).toContain('<h1>Terms</h1>');
    expect(html).toContain('<p>Some <strong>bold</strong> and <em>em</em> and <code>code</code>.</p>');
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(html).toContain('<ol>\n<li>first</li>\n<li>second</li>\n</ol>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<pre><code>raw &lt; code</code></pre>');
    expect(html).toContain('<hr>');
  });

  it('escapes everything the author wrote: raw HTML is text, javascript: is not a link', () => {
    const html = renderMarkdownLite('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.org/a?b=1) [m](mailto:a@b.c) <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="https://example.org/a?b=1" rel="noopener">ok</a>');
    expect(html).toContain('<a href="mailto:a@b.c" rel="noopener">m</a>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the legal request shape', () => {
  it('accepts the three formats, trims a URL, refuses the rest by name', () => {
    const ok = parseLegalInput({ terms: { format: 'markdown', content: '# T\r\nx' }, privacy: null, support: { format: 'url', content: ' https://a.b/c ' } }, 'alice@node');
    expect('legal' in ok && ok.legal.terms?.content).toBe('# T\nx');
    expect('legal' in ok && ok.legal.privacy).toBeNull();
    expect('legal' in ok && ok.legal.support?.content).toBe('https://a.b/c');
    expect('legal' in ok && ok.legal.terms?.updatedBy).toBe('alice@node');
    expect(parseLegalInput({ eula: { format: 'markdown', content: 'x' } }, 'a')).toMatchObject({ error: expect.stringContaining('legal.eula') });
    expect(parseLegalInput({ terms: { format: 'pdf', content: 'x' } }, 'a')).toMatchObject({ error: expect.stringContaining('format') });
    expect(parseLegalInput({ terms: { format: 'markdown', content: '   ' } }, 'a')).toMatchObject({ error: expect.stringContaining('empty') });
    expect(parseLegalInput({ terms: { format: 'url', content: 'http://insecure' } }, 'a')).toMatchObject({ error: expect.stringContaining('https') });
    expect(parseLegalInput({ terms: { format: 'markdown', content: 'x'.repeat(LEGAL_CONTENT_MAX + 1) } }, 'a')).toMatchObject({ error: expect.stringContaining('kB') });
    expect(parseLegalInput('terms', 'a')).toMatchObject({ error: expect.any(String) });
    expect(parseLegalInput({ terms: 'text' }, 'a')).toMatchObject({ error: expect.any(String) });
  });
});

describe('readiness, state, links, strip', () => {
  const doc = { format: 'markdown' as const, content: '# Terms\n\nHello.', updatedAt: '2026-08-29T10:00:00.000Z', updatedBy: 'alice@node' };

  it('a plain app ought to have terms and privacy; MONEY brings the whole set, morsels never do', () => {
    expect(legalReadiness(app())).toMatchObject({ recommended: ['terms', 'privacy'], missing: ['terms', 'privacy'] });
    // Morsels pace what agents push into the store and buy nothing: a morsel price, a morsel
    // licence or a morsel-priced tool makes no shop and creates no consumer-law duty.
    expect(legalReadiness(app({ priceMorsels: 500, licenseType: 'lifetime' })).recommended).toEqual(['terms', 'privacy']);
    const selling = legalReadiness(app({ legal: { terms: doc } }), { sellsForMoney: true });
    expect(selling.recommended).toEqual(['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'support']);
    expect(selling.missing).toEqual(['privacy', 'imprint', 'refunds', 'accessibility', 'support']);
    expect(legalReadiness(app(), { sellsForMoney: false }).recommended).toEqual(['terms', 'privacy']);
  });

  it('state carries no content; the strip empties it except for a URL; the provenance id rides along', () => {
    const a = app({ legal: { terms: { ...doc, aiProvenanceId: 'prov_1' }, support: { ...doc, format: 'url', content: 'https://x.y/help' } } });
    const state = appLegalState(a);
    expect(state.terms).toMatchObject({ format: 'markdown', size: Buffer.byteLength(doc.content), updatedBy: 'alice@node', aiProvenanceId: 'prov_1' });
    expect((state.terms as unknown as { content?: string }).content).toBeUndefined();
    expect(state.support?.aiProvenanceId).toBeUndefined();
    expect(state.support?.url).toBe('https://x.y/help');
    const stripped = stripLegalContent(a.manifest);
    expect(stripped.legal?.terms?.content).toBe('');
    expect(stripped.legal?.support?.content).toBe('https://x.y/help');
  });

  it('links follow the base, and the head pass writes the registered relations only', () => {
    const a = app({ legal: { terms: doc, privacy: doc, imprint: doc, support: { ...doc, format: 'url', content: 'https://x.y/help' } } });
    const links = legalLinksFor(a, 'https://shop.apps.aimeat.io/');
    expect(links.map(l => l.href)).toEqual([
      'https://shop.apps.aimeat.io/terms', 'https://shop.apps.aimeat.io/privacy', 'https://shop.apps.aimeat.io/imprint', 'https://x.y/help',
    ]);
    const head = applyAppHeadMeta('<!DOCTYPE html><html><head><title>t</title></head><body></body></html>', {
      owner: 'alice', filename: 'shop.html', origin: 'https://shop.apps.aimeat.io', baseUrl: 'https://aimeat.io', legal: links,
    });
    expect(head).toContain('<link rel="terms-of-service" href="https://shop.apps.aimeat.io/terms" title="Terms of use">');
    expect(head).toContain('<link rel="privacy-policy" href="https://shop.apps.aimeat.io/privacy" title="Privacy notice">');
    expect(head).toContain('<link rel="help" href="https://x.y/help" title="Support">');
    expect(head).not.toContain('/imprint"');
  });

  it('the rendered markdown page names whose page it is and that the node does not answer for it', () => {
    const page = renderLegalPage(app({ authorship: { name: 'Maija Meikäläinen', declaredBy: 'alice@node', declaredAt: 'x' } }), 'terms', doc, { baseUrl: 'https://aimeat.io' });
    expect('html' in page).toBe(true);
    const html = ('html' in page ? page.html : '');
    expect(html).toContain('<title>Terms of use · Shop</title>');
    expect(html).toContain('Published by Maija Meikäläinen for the app "Shop". Updated 2026-08-29.');
    expect(html).toContain('<h1>Terms of use</h1>');
    expect(html).toContain('<p>Hello.</p>');
    expect(html).toContain('who answers for the app and for what this page says');
    expect(html).toContain('href="https://aimeat.io/v1/terms"');
    expect(renderLegalPage(app(), 'terms', { ...doc, format: 'html', content: '<html><body>mine</body></html>' }, { baseUrl: 'https://aimeat.io' })).toEqual({ html: '<html><body>mine</body></html>' });
    expect(renderLegalPage(app(), 'terms', { ...doc, format: 'url', content: 'https://x.y/t' }, { baseUrl: 'https://aimeat.io' })).toEqual({ redirect: 'https://x.y/t' });
  });
});
