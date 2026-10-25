/**
 * @file test/unit/inline-script-parse.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description extractInlineScripts() reads an app's HTML in time linear in its size, and finds the
 *   same blocks the regular expression it replaced found (secaudit2026oct22,
 *   extract-inline-scripts-quadratic-scan).
 * @usage pnpm exec vitest run test/unit/inline-script-parse.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — secaudit2026oct22: growth case for unclosed opening tags, and equivalence
 *     with the earlier regular expression on well-formed and malformed documents.
 */
import { describe, it, expect } from 'vitest';
import { extractInlineScripts } from '../../src/utils/inline-script-parse.js';

/** The extraction as it was before 2026-10-25, kept here as the reference for equal findings. */
function referenceExtract(html: string): Array<{ index: number; source: string; goal: string }> {
  const out: Array<{ index: number; source: string; goal: string }> = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(html)) !== null) {
    n += 1;
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    out.push({ index: n, source: m[2] ?? '', goal: type === 'module' ? 'module' : 'script' });
  }
  return out;
}

describe('extractInlineScripts: time linear in the size of the HTML', () => {
  it('reads 256 KB of unclosed opening tags in well under a second', () => {
    const html = '<script '.repeat(32_000);
    const started = Date.now();
    const found = extractInlineScripts(html);
    const ms = Date.now() - started;
    expect(found).toEqual([]);
    expect(ms).toBeLessThan(250);
  });

  it('reads 256 KB of opening tags with no closing tag in well under a second', () => {
    const html = '<script>'.repeat(32_000);
    const started = Date.now();
    const found = extractInlineScripts(html);
    expect(found).toEqual([]);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('extractInlineScripts: the same blocks as before', () => {
  const documents: Record<string, string> = {
    'plain and module blocks': '<html><script>var a = 1;</script><p>x</p><script type="module">import x from "y";</script></html>',
    'src and data blocks are skipped but counted': '<script src="a.js"></script><script type="application/ld+json">{}</script><script>var b;</script>',
    'upper case tags and spaced closer': '<SCRIPT TYPE="text/javascript">var c;</SCRIPT  ><Script>d()</sCrIpT\n>',
    'a closer inside a string truncates the block': '<script>var s = "</script>"; tail()</script>',
    'a near-miss closer is read past': '<script>a()</scripts>b()</script x>c()</script>',
    'a longer tag name is not a script tag': '<scripts>no</scripts><script>yes()</script>',
    'an opening tag inside a block is body text': '<script>a <script>b</script>after',
    'an unclosed block after a closed one': '<script>one()</script><script>never closed',
    'an opening tag with no end': '<script>ok()</script><script type="module"',
    'attributes and a module goal': '<script defer type=\'module\' data-x="1">export const q = 1;</script>',
    'empty document': '',
    'no scripts': '<p>hello</p>',
    'script at the end of the input': 'x<script',
  };
  for (const [name, html] of Object.entries(documents)) {
    it(name, () => {
      expect(extractInlineScripts(html)).toEqual(referenceExtract(html));
    });
  }
});
