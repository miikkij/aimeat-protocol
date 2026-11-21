/**
 * @file test/unit/locale-duplicate-keys.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One dotted key written twice in a locale file, flat and nested, is found
 *   (duplicateKeys in scripts/lib/locale-files.ts) and none of the shipped files has one. The browser
 *   shows the later spelling and the server the flat one, so an edit to the other changed nothing
 *   (docs/pitfalls.md §5).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { duplicateKeys, loadLocale, shippedLocales } from '../../scripts/lib/locale-files.js';

describe('a locale key written twice', () => {
    it('is found when written flat and nested', () => {
        const found = duplicateKeys({ 'profile.landing.home': 'Overview', profile: { landing: { home: 'Home' } } });
        expect(found.map(d => d.key)).toEqual(['profile.landing.home']);
        expect(found[0].paths).toHaveLength(2);
    });
    it('is found when the flat spelling sits one level down', () => {
        expect(duplicateKeys({ a: { 'b.c': 'x', b: { c: 'y' } } }).map(d => d.key)).toEqual(['a.b.c']);
    });
    it('is not reported for one spelling, or for a branch and a leaf that differ', () => {
        expect(duplicateKeys({ a: { b: 'x' }, 'a.c': 'y', list: ['p', 'q'] })).toEqual([]);
    });
    it.each(shippedLocales())('does not occur in %s.json', tag => {
        expect(duplicateKeys(loadLocale(tag)).map(d => d.key)).toEqual([]);
    });
});
