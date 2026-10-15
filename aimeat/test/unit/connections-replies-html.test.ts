/**
 * @file test/unit/connections-replies-html.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description htmlToText (services/connections/replies.ts), which turns a Mastodon reply's HTML into
 *   plain text: entities decode once, and tag stripping runs until nothing changes (CodeQL
 *   js/double-escaping, js/incomplete-multi-character-sanitization, alerts 1738 and 1739).
 * @usage cd aimeat && pnpm exec vitest run test/unit/connections-replies-html.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { htmlToText } from '../../src/services/connections/replies.js';

describe('htmlToText', () => {
  it('keeps the words, a line break for <br> and a blank line between paragraphs', () => {
    expect(htmlToText('<p>Hello <a href="https://x.example/@a">@a</a></p><p>second<br/>line</p>'))
      .toBe('Hello @a\n\nsecond\nline');
  });

  it('decodes the named entities', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; it&#39;s it&apos;s&nbsp;e')).toBe(`a & b <c> "d" it's it's e`);
  });

  it('decodes once: an escaped entity stays the entity text', () => {
    expect(htmlToText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('leaves no tag that one strip pass would assemble', () => {
    const out = htmlToText('<<b>script>alert(1)<</b>/script>');
    expect(out).not.toMatch(/<\/?script/i);
  });
});
