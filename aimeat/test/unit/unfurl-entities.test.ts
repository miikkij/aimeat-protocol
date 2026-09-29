/**
 * @file test/unit/unfurl-entities.test.ts
 * @description The link preview decodes the entities in a page's meta text once each: `&amp;lt;` is
 *   the text `&lt;`, not `<` (CodeQL js/double-escaping, the same fault as alert 1682).
 * @usage pnpm test -- unfurl-entities
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { decodeEntities } from '../../src/routes/unfurl.js';

describe('decodeEntities', () => {
  it('decodes each entity once', () => {
    expect(decodeEntities('a &amp;lt;b&amp;gt; &amp;amp; &lt;c&gt;')).toBe('a &lt;b&gt; &amp; <c>');
  });

  it('decodes the quote and apostrophe forms and a non-breaking space', () => {
    expect(decodeEntities('&quot;x&quot; &#39;y&#039; &apos;z&#x27;&nbsp;!')).toBe('"x" \'y\' \'z\' !');
  });
});
