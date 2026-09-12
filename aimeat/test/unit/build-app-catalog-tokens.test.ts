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
 *   v1.0.0 — 2026-09-13 — Initial.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themePosterTokens } from '../../scripts/build-app-catalog.js';

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
    expect(out.split('\n')).toHaveLength(13);
    expect(out).toMatch(/--font-headline: 'Fjalla One'/);
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
