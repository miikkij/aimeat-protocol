/**
 * @file test/unit/link-preview-meta-scan.test.ts
 * @description The link preview (routes/unfurl.ts parseMeta) and the welcome-mat reader
 *   (services/welcome-mat-parse.ts readWelcomeMatMeta) read `<meta>` tags and the `<title>` in time
 *   that grows with the page, not with its square. A fetched page chosen by any signed-in caller full
 *   of `<meta` openers with no `>` cost seconds of event-loop time per pattern (secaudit2026oct31w2
 *   round 10, f-2026aug-dos-ratelimit-1). The usage half: real pages give the same preview as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/link-preview-meta-scan.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect } from 'vitest';
import { parseMeta } from '../../src/routes/unfurl.js';
import { readWelcomeMatMeta } from '../../src/services/welcome-mat-parse.js';

const URL_A = 'https://example.com/a';

function timed<T>(fn: () => T): { ms: number; value: T } {
  const t = Date.now();
  const value = fn();
  return { ms: Date.now() - t, value };
}

describe('link preview: bounded time on a hostile page', () => {
  it('reads a 200,000-character page of unclosed <meta openers quickly', () => {
    const page = '<meta '.repeat(34_000);
    const { ms, value } = timed(() => parseMeta(page, URL_A, URL_A));
    expect(value.title).toBeNull();
    expect(ms).toBeLessThan(500);
  });

  it('reads a page of <meta property="og:title" openers with no content quickly', () => {
    const page = '<meta property="og:title" '.repeat(8_000);
    const { ms } = timed(() => parseMeta(page, URL_A, URL_A));
    expect(ms).toBeLessThan(500);
  });

  it('reads a page of unclosed <title openers quickly', () => {
    const page = '<title '.repeat(28_000);
    const { ms, value } = timed(() => parseMeta(page, URL_A, URL_A));
    expect(value.title).toBeNull();
    expect(ms).toBeLessThan(500);
  });

  it('the welcome-mat reader is bounded the same way', () => {
    const page = '<meta name="ai-model" '.repeat(10_000);
    const { ms } = timed(() => readWelcomeMatMeta(page));
    expect(ms).toBeLessThan(500);
  });
});

describe('link preview: real pages read as before', () => {
  it('reads OpenGraph tags in either attribute order and decodes entities', () => {
    const page = `<!doctype html><html><head>
      <title>Fallback Title</title>
      <meta property="og:site_name" content="Fixture Site" />
      <meta content="Hello &amp; Welcome" property="og:title" />
      <meta property='og:description' content='A tiny page.' />
      <meta property="og:image" content="/img.png" />
    </head><body>hi</body></html>`;
    expect(parseMeta(page, URL_A, URL_A)).toEqual({
      url: URL_A, resolvedUrl: URL_A,
      title: 'Hello & Welcome', description: 'A tiny page.',
      image: 'https://example.com/img.png', siteName: 'Fixture Site',
    });
  });

  it('falls back to twitter tags, the description name and the <title> element', () => {
    const page = `<html><head><TITLE lang="en">  Plain Title </TITLE>
      <meta name="twitter:image" content="https://cdn.example.com/x.jpg">
      <meta name="description" content="Described.">
    </head></html>`;
    const p = parseMeta(page, URL_A, 'https://www.example.org/b');
    expect(p.title).toBe('Plain Title');
    expect(p.description).toBe('Described.');
    expect(p.image).toBe('https://cdn.example.com/x.jpg');
    expect(p.siteName).toBe('example.org');
  });

  it('prefers og:title over twitter:title and keys match case-insensitively', () => {
    const page = '<meta name="twitter:title" content="Tw"><META PROPERTY="OG:TITLE" CONTENT="Og">';
    expect(parseMeta(page, URL_A, URL_A).title).toBe('Og');
  });

  it('keeps a > inside a quoted content value', () => {
    const page = '<meta property="og:description" content="a > b">';
    expect(parseMeta(page, URL_A, URL_A).description).toBe('a > b');
  });

  it('skips a tag with the key but no content and takes the next one', () => {
    const page = '<meta property="og:title"><meta property="og:title" content="Second">';
    expect(parseMeta(page, URL_A, URL_A).title).toBe('Second');
  });

  it('the welcome-mat reader tolerates spaces around = and either order', () => {
    const page = `<head><meta content = "gpt-x" name = 'ai-model'><meta name="ai-can-mcp" content="TRUE"></head>`;
    const m = readWelcomeMatMeta(page);
    expect(m.model).toBe('gpt-x');
    expect(m.canMcp).toBe('yes');
    expect(m.declared).toBe(false);
  });
});
