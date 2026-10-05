/**
 * @file html-escape.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for escapeHtml (src/utils/html-escape.ts), the one HTML escaper for
 *   server code: each of the five characters, `&` escaped once and first, null and undefined, and
 *   a value that is not a string.
 * @usage cd aimeat && pnpm exec vitest run test/unit/html-escape.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/utils/html-escape.js';

describe('escapeHtml', () => {
  it('escapes each of the five characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes all five in one string and leaves other text as it is', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
    expect(escapeHtml('Hyvää päivää ♥')).toBe('Hyvää päivää ♥');
  });

  it('escapes an existing entity once more, so `&lt;` stays the text `&lt;`', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('gives an empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converts a value that is not a string before it escapes it', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(false)).toBe('false');
  });
});
