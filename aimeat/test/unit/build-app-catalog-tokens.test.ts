/**
 * @file build-app-catalog-tokens.test.ts
 * @description The app catalog copies its type and sun tokens out of public/css/theme.css at build
 *   time (themePosterTokens in scripts/build-app-catalog.ts). These cases hold the copy to the real
 *   sheet: every token the catalog reads is found once in theme.css's :root block, a comment that
 *   merely names a token is not taken for its declaration, and a token that is missing or declared
 *   twice stops the build instead of copying a guess.
 * @structure the real theme.css · a comment is not a declaration · missing · declared twice
 * @usage pnpm test -- build-app-catalog-tokens
 * @version-history
 *   v1.2.0 — 2026-09-22 — The build inlines the whole light and dark token blocks, poster.css and
 *     parts.css: themeTokenBlocks is held to the fixture, and the assembled page must carry the
 *     shared rules inside its <style>, not inside the template's header comment.
 *   v1.1.0 — 2026-09-22 — The catalog copies the nine shape tokens as well (22 in all); the fixture
 *     carries them, because the copy refuses a token theme.css does not declare.
 *   v1.0.0 — 2026-09-13 — Initial.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themePosterTokens, themeTokenBlocks, renderAppCatalog } from '../../scripts/build-app-catalog.js';

const THEME = fileURLToPath(new URL('../../public/css/theme.css', import.meta.url));

/** A :root block carrying every token the catalog copies, with one line replaced when asked. */
function fixture(edit: (lines: string[]) => string[] = (l) => l): string {
  const lines = [
    ':root {',
    '  /* --font-headline  every headline, big numeral, sticker */',
    "  --font-headline: 'Fjalla One', sans-serif;",
    "  --font-body: 'Archivo', sans-serif;",
    "  --font-mono: 'JetBrains Mono', monospace;",
    '  --font-poster: var(--font-headline);',
    '  --font-poster-weight: 400;',
    '  --font-poster-text-weight: 400;',
    '  --font-poster-strong-weight: 600;',
    '  --font-poster-tracking: 0.01em;',
    '  --font-poster-leading: 1;',
    '  --font-poster-section: var(--font-body);',
    '  --font-poster-section-weight: 400;',
    '  --sun: #FFB52E;',
    '  --on-sun: #1A1A2E;',
    '  --shape-radius: 0;',
    '  --rule-hair: 1px;',
    '  --rule-thing: 2px;',
    '  --rule-heavy: 3px;',
    '  --rule-edge: 4px;',
    '  --rule-stripe: 6px;',
    '  --offset-s: 4px;',
    '  --offset-m: 8px;',
    '  --offset-l: 12px;',
    '}',
    '[data-theme="dark"] {',
    '  --sun: #000000;',
    '}',
  ];
  return edit(lines).join('\n');
}

describe('themePosterTokens', () => {
  it('finds every copied token in the real theme.css, with the headline face and its spacing', () => {
    const out = themePosterTokens(readFileSync(THEME, 'utf-8'));
    expect(out.split('\n')).toHaveLength(22);
    expect(out).toMatch(/--font-headline: 'Fjalla One'/);
    expect(out).toMatch(/--rule-heavy: 3px;/);
    expect(out).toMatch(/--font-poster-tracking: 0\.01em;/);
    expect(out).toMatch(/--font-poster-leading: 1;/);
  });

  it('copies the declaration, not the comment that names the token, and stops at the end of :root', () => {
    const out = themePosterTokens(fixture());
    expect(out).toContain("  --font-headline: 'Fjalla One', sans-serif;");
    expect(out).toContain('  --sun: #FFB52E;');
    expect(out).not.toContain('#000000');
  });

  it('refuses when theme.css no longer declares a token the catalog reads', () => {
    const css = fixture((l) => l.filter((line) => !line.includes('--font-poster-tracking')));
    expect(() => themePosterTokens(css)).toThrow(/--font-poster-tracking 0 times/);
  });

  it('refuses when a token is declared twice, rather than choosing one', () => {
    const css = fixture((l) => [...l.slice(0, 3), '  --sun: #EEEEEE;', ...l.slice(3)]);
    expect(() => themePosterTokens(css)).toThrow(/--sun 2 times/);
  });
});

describe('themeTokenBlocks', () => {
  it('copies the whole light and dark token blocks, dark after light', () => {
    const out = themeTokenBlocks(fixture());
    expect(out.startsWith(':root {')).toBe(true);
    expect(out).toContain('--offset-l: 12px;');
    expect(out.indexOf('[data-theme="dark"] {')).toBeGreaterThan(out.indexOf('--offset-l'));
    expect(out).toContain('--sun: #000000;');
  });
});

describe('renderAppCatalog', () => {
  // On 2026-09-22 the build put the tokens and poster.css before app-catalog.css, whose first lines
  // are the end of the template's header comment: the shared shapes landed inside an HTML comment,
  // and the whole catalog drew native buttons. The shared rules must sit inside the real <style>.
  it('puts the house tokens, the shapes and the parts inside the page style, after the header comment', async () => {
    const html = await renderAppCatalog();
    // The header comment itself names "<style>" (the marker line), so the real tag is the one after <head>.
    const head = html.indexOf('<head>');
    const style = html.indexOf('<style>', head);
    expect(head).toBeGreaterThan(-1);
    expect(style).toBeGreaterThan(head);
    // Nothing of the shared set may sit before <head>, where it would be inside the header comment.
    expect(html.slice(0, head)).not.toContain('.poster-slab {');
    expect(html.slice(0, head)).not.toContain('--rule-heavy:');
    for (const rule of ['--rule-heavy:', '.poster-slab {', '.poster-list-row {', '.poster-section-head {']) {
      expect(html.indexOf(rule), rule).toBeGreaterThan(style);
    }
    // The parts come last, so a part wins over a leftover catalog rule of the same weight.
    expect(html.lastIndexOf('.poster-section-head {')).toBeGreaterThan(html.lastIndexOf('.dlg-foot'));
  }, 60_000);
});
