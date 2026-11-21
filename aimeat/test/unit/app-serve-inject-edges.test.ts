/**
 * @file test/unit/app-serve-inject-edges.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two edges of what the node writes into an app page it serves:
 *   - the marks go before the last `</body>` OUTSIDE a script, a style, a textarea, a title or a
 *     comment. A page whose script stands after its `</body>` and holds the string '</body>' got
 *     the marks inside that string, a SyntaxError that stopped the app's script;
 *   - the app-body block names the app in an `<h2>` when the app has an `<h1>` of its own, so the
 *     served page carries one main heading, not two.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-serve-inject-edges.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6: publish/node-injects-before-first-body-close,
 *     publish/node-adds-h1-app-own-h1-doubles).
 */
import { describe, it, expect } from 'vitest';
import { injectBeforeClosingTag } from '../../src/utils/html-inject.js';
import { applyServeMarks } from '../../src/services/app/serve-marks.js';

const SNIP = '<i id="mark"></i>';

describe('injectBeforeClosingTag skips raw text', () => {
  it('a script after </body> holding "</body>" is left whole; the snippet goes before the real tag', () => {
    const doc = '<html><body><p>x</p></body><script>const end = "</body>"; go(end);</script></html>';
    const out = injectBeforeClosingTag(doc, SNIP);
    expect(out).toBe('<html><body><p>x</p>' + SNIP + '</body><script>const end = "</body>"; go(end);</script></html>');
  });

  it('a "</body>" in a style, a textarea, a title or a comment after the body is not the tag', () => {
    const doc = '<html><head><title>a </body> b</title></head><body><p>x</p></body>'
      + '<!-- </body> --><style>/* </body> */</style><textarea></body></textarea></html>';
    const out = injectBeforeClosingTag(doc, SNIP);
    expect(out.indexOf(SNIP)).toBe(doc.indexOf('</body><!--'));
    expect(out.replace(SNIP, '')).toBe(doc);
  });

  it('the old cases stand: last real </body>, then </html>, then the end; tag case and space', () => {
    expect(injectBeforeClosingTag('<body><script>var t="</bo"+"dy>"</script></BODY >', SNIP)).toBe('<body><script>var t="</bo"+"dy>"</script>' + SNIP + '</BODY >');
    expect(injectBeforeClosingTag('<html><p>x</p></html>', SNIP)).toBe('<html><p>x</p>' + SNIP + '</html>');
    expect(injectBeforeClosingTag('<p>x</p>', SNIP)).toBe('<p>x</p>' + SNIP);
    expect(injectBeforeClosingTag('<body><bodyguard></bodyguard></body>', SNIP)).toBe('<body><bodyguard></bodyguard>' + SNIP + '</body>');
  });

  it('an unclosed script does not hang and leaves the text as it is, with the snippet at the end', () => {
    const out = injectBeforeClosingTag('<body><script>let a = "</body>"', SNIP);
    expect(out).toBe('<body><script>let a = "</body>"' + SNIP);
  });
});

describe('the app-body block and the app\'s own <h1>', () => {
  const BODY = { name: 'Noste', description: 'Laskee nostovoiman.' };
  const serve = (html: string) => applyServeMarks(html, { isDocument: true, appBody: BODY }).toString('utf-8');

  it('an app with its own <h1> gets the name in an <h2>, and the page has one <h1>', () => {
    const out = serve('<!DOCTYPE html><html><head><title>t</title></head><body><h1 class="hero">Noste</h1></body></html>');
    expect(out).toContain('<div id="aimeat-app-body"><style>');
    expect(out).toContain('<h2>Noste</h2>');
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it('an app without an <h1> still gets the name in an <h1>', () => {
    const out = serve('<!DOCTYPE html><html><head><title>t</title></head><body><canvas></canvas></body></html>');
    expect(out).toContain('<h1>Noste</h1>');
  });

  it('an <h1x> or <h10> element is not an h1', () => {
    const out = serve('<html><head></head><body><h1x>no</h1x></body></html>');
    expect(out).toContain('<h1>Noste</h1>');
  });
});
