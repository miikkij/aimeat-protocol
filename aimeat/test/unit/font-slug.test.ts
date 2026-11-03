/**
 * @file test/unit/font-slug.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description fontSlug (src/services/themes/fonts.ts) makes a family's address from its name: lower
 *   case letters, digits and single hyphens, no hyphen at either end, at most 60 characters. The edge
 *   hyphens are trimmed by a scan instead of /^-+|-+$/ (CodeQL js/polynomial-redos, alert 1780), and
 *   the answers stay the ones the regex gave; a long run of hyphens answers at once.
 * @version-history
 *   v1.0.0 -- 2026-11-03 -- Initial (CodeQL alert 1780).
 */
import { describe, it, expect } from 'vitest';
import { fontSlug } from '../../src/services/themes/fonts.js';

describe('fontSlug', () => {
  it('use kept: the address a name has always had', () => {
    expect(fontSlug('Inter Tight')).toBe('inter-tight');
    expect(fontSlug('  --Söhne Breit--  ')).toBe('sohne-breit');
    expect(fontSlug('IBM Plex Sans 2')).toBe('ibm-plex-sans-2');
    expect(fontSlug('---')).toBe('');
    expect(fontSlug('a'.repeat(70))).toBe('a'.repeat(60));
  });

  it('answers at once on a name made of hyphens and spaces', () => {
    const started = Date.now();
    expect(fontSlug('-'.repeat(50_000) + 'x' + ' -'.repeat(50_000))).toBe('x');
    expect(Date.now() - started).toBeLessThan(200);
  });
});
