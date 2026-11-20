/**
 * @file test/unit/check-app-ref.test.ts
 * @description scripts/check-app-ref.ts finds a hand-written `.html` decision on an app name and
 *   leaves a comment or a plain string alone.
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import { describe, it, expect } from 'vitest';
import { appRefFindings, compareWithAllowed } from '../../scripts/check-app-ref.js';

describe('appRefFindings', () => {
  it('finds a strip, an add and an endsWith', () => {
    const src = [
      "const a = f.replace(/\\.html?$/i, '');",
      'const b = `${name}.html`;',
      "const c = name + '.html';",
      "const d = f.endsWith('.html');",
    ].join('\n');
    expect(appRefFindings('x.ts', src).map(f => f.shape)).toEqual(['html-regex', 'adds-html', 'adds-html', 'ends-with-html']);
  });
  it('leaves comments, plain strings and other extensions alone', () => {
    const src = [
      "// strip .html with f.replace(/\\.html$/, '')",
      "const s = 'lifecycle-central.html';",
      'const t = `${name}.json`;',
      'const u = `${name}.htmlx`;',
    ].join('\n');
    expect(appRefFindings('x.ts', src)).toEqual([]);
  });
});

describe('compareWithAllowed', () => {
  it('names a new finding and a stale entry', () => {
    const found = new Map([['a.ts', [{ line: 1, shape: 'adds-html', text: '`${x}.html`' }]]]);
    const out = compareWithAllowed(found, { 'a.ts': { '`${y}.html`': 'gone' } });
    expect(out.fresh.map(f => f.text)).toEqual(['`${x}.html`']);
    expect(out.stale.map(s => s.text)).toEqual(['`${y}.html`']);
  });
});
