/**
 * @file test/unit/extract-image-svg-sniff.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readImageFacts recognises an SVG sent without its MIME type: an optional XML
 *   declaration, any number of comments, then <svg>. A head of "<!--" and many "--><!--" with no
 *   <svg> after it returns quickly; the regex this replaced backtracked exponentially on it (CodeQL
 *   js/redos, alert 1760).
 * @structure svg sniff
 * @usage cd aimeat && pnpm exec vitest run test/unit/extract-image-svg-sniff.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { readImageFacts } from '../../src/services/content/extract-image.js';

const OCTET = 'application/octet-stream';

describe('svg sniff', () => {
  it('reads an SVG behind an XML declaration and comments as SVG', async () => {
    const svg = '<?xml version="1.0"?>\n<!-- a -->\n<!-- b --><svg width="10" height="20"></svg>';
    const { facts } = await readImageFacts(Buffer.from(svg), OCTET);
    expect(facts.format).toBe('svg+xml');
  });

  it('does not take a comment that never closes, or text before <svg>, for SVG', async () => {
    for (const head of ['<!-- open <svg>', 'hello <svg></svg>']) {
      const { facts } = await readImageFacts(Buffer.from(head), OCTET);
      expect(facts.format).not.toBe('svg+xml');
    }
  });

  it('answers quickly on many repeated comment boundaries', async () => {
    // The old regex doubled its time with each repetition: about 80 ms at 22 and seconds at 27.
    const head = '<!--' + '--><!--'.repeat(27) + 'x';
    const started = performance.now();
    await readImageFacts(Buffer.from(head), OCTET);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
