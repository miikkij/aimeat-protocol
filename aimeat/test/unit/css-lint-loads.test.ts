/**
 * @file test/unit/css-lint-loads.test.ts
 * @description The theme and component CSS reader (services/themes/css-lint.ts) warns about every
 *   form that loads a file, escaped names included, as the browser reads them (secaudit 2026-10, C8).
 *   The warnings stay warnings: the operator may save anyway.
 * @usage pnpm test -- css-lint-loads
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */
import { describe, it, expect } from 'vitest';
import { lintCss } from '../../src/services/themes/css-lint.js';

const loads = (css: string) => lintCss(css).warnings.filter((w) => w.code === 'loads');

describe('lintCss: what loads a file', () => {
  it('warns about a plain @import and url()', () => {
    const w = loads('@import url(https://x.example/a.css);\n.a { background: url(x.png); }');
    expect(w.map((x) => x.line)).toEqual([1, 1, 2]);
    expect(w.find((x) => x.line === 2)?.property).toBe('background');
  });

  it('warns about the escaped forms the browser reads the same way', () => {
    const w = loads(String.raw`@\69mport "https://x.example/a.css";` + '\n' + String.raw`.a { background: u\72l("x.png"); }`);
    expect(w.map((x) => x.line)).toEqual([1, 2]);
  });

  it('does not warn about a url in a comment or a string', () => {
    expect(loads('/* url(x.png) */ .a { content: "url(x.png)"; }')).toEqual([]);
  });

  it('stays a warning: the CSS is still accepted', () => {
    expect(lintCss('@import url(https://x.example/a.css);').error).toBeNull();
  });
});
