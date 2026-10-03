/**
 * @file test/unit/font-registry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The merged list of faces (the font manager): the base faces from code and the faces
 *   the operator added, read by every place that used to read the base lists alone. An added face
 *   counts only once a file of it has arrived, a base face always wins its name, and the faces
 *   sheet declares what is served.
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { THEME_FACES } from '../../src/services/themes/tokens.js';
import { SERVED_FONT_FAMILIES, servedFontFamilies, unservedFirstFamily } from '../../src/services/app-ui/signature-tokens.js';
import {
    setAddedFaces, themeFaceStacks, themeFaceNames, faceStackOf, fontsSheet, fontsSheetHref, stackFor,
    type FontRecord,
} from '../../src/services/themes/font-registry.js';
import { servedFaces } from '../../src/services/themes/sheet.js';
import { validateSignatureTokens } from '../../src/services/app-ui/validate.js';

const record = (patch: Partial<FontRecord> = {}): FontRecord => ({
    family: 'Space Mono', slug: 'space-mono', origin: 'added', kind: 'monospace',
    files: [{ file: '400-latin.woff2', weight: '400', style: 'normal', subset: 'latin', unicodeRange: 'U+0000-00FF', bytes: 16520, sha256: 'ab'.repeat(32) }],
    licence: 'OFL-1.1', copyright: '© 2016 Google Inc.', source: 'https://fonts.google.com/specimen/Space+Mono',
    licenceStatus: 'stated', addedBy: 'op@node', addedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
    ...patch,
});

afterEach(() => setAddedFaces([]));

describe('the merged list of faces', () => {
    it('is the base faces alone while nothing is added', () => {
        expect(themeFaceStacks()).toEqual(THEME_FACES);
        expect(servedFontFamilies()).toEqual([...SERVED_FONT_FAMILIES]);
        expect(fontsSheetHref()).toBeNull();
    });

    it('takes an added face once a file of it has arrived, after the base faces', () => {
        setAddedFaces([record()]);
        const names = themeFaceNames();
        expect(names.slice(0, Object.keys(THEME_FACES).length)).toEqual(Object.keys(THEME_FACES));
        expect(names).toContain('Space Mono');
        expect(faceStackOf('Space Mono')).toBe("'Space Mono', ui-monospace, monospace");
        expect(servedFaces()).toContain('Space Mono');
        expect(servedFontFamilies()).toContain('Space Mono');
        expect(unservedFirstFamily("'Space Mono', monospace")).toBeNull();
        expect(validateSignatureTokens({ '--ak-font': "'Space Mono', monospace" })['--ak-font']).toMatch(/Space Mono/);
    });

    it('leaves out a family whose files have not arrived yet', () => {
        setAddedFaces([record({ files: [{ file: '400.woff2', weight: '400', style: 'normal', bytes: null, sha256: null }] })]);
        expect(themeFaceNames()).not.toContain('Space Mono');
        expect(unservedFirstFamily("'Space Mono', monospace")).toBe('Space Mono');
        expect(fontsSheetHref()).toBeNull();
    });

    it('never lets an added record take a base face\'s name or stack', () => {
        setAddedFaces([record({ family: 'Fjalla One', slug: 'fjalla-one' })]);
        expect(faceStackOf('Fjalla One')).toBe(THEME_FACES['Fjalla One']);
        expect(themeFaceNames().filter((n) => n === 'Fjalla One')).toHaveLength(1);
    });

    it('gives each kind its generic fallback', () => {
        expect(stackFor('A', 'serif')).toBe("'A', Georgia, serif");
        expect(stackFor('A', 'sans-serif')).toBe("'A', system-ui, sans-serif");
        expect(stackFor('A', 'cursive')).toBe("'A', cursive");
        expect(stackFor('A', 'monospace')).toBe("'A', ui-monospace, monospace");
    });
});

describe('the faces sheet', () => {
    it('declares one @font-face per arrived file, pointing at the file route with its digest', () => {
        setAddedFaces([record({ files: [
            { file: '400-latin.woff2', weight: '400', style: 'normal', subset: 'latin', unicodeRange: 'U+0000-00FF', bytes: 1, sha256: 'ab'.repeat(32) },
            { file: '400-italic.woff2', weight: '400', style: 'italic', bytes: null, sha256: null },
        ] })]);
        const css = fontsSheet();
        expect(css.match(/@font-face/g)).toHaveLength(1);
        expect(css).toContain("font-family: 'Space Mono'");
        expect(css).toContain("url('/v1/themes/fonts/space-mono/400-latin.woff2?v=abababab') format('woff2')");
        expect(css).toContain('unicode-range: U+0000-00FF');
        expect(css).toContain('font-display: swap');
        expect(fontsSheetHref()).toMatch(/^\/v1\/themes\/fonts\.css\?v=[0-9a-f]{12}$/);
    });
});
