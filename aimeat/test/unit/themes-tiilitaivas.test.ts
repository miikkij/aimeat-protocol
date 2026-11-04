/**
 * @file test/unit/themes-tiilitaivas.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shipped theme Tiilitaivas against its source, tiilitaivas.json of Jouni's decision
 *   (2026-11-04 02:03): each colour and contrast pair that file states, recomputed from the theme the
 *   node serves, the faces served by the node itself, and no outside material in its stylesheet.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ratio } from '../../src/services/atelier-color.js';
import { checkContrast } from '../../src/services/themes/contrast.js';
import { lintCss } from '../../src/services/themes/css-lint.js';
import { checkShape } from '../../src/services/themes/shapes.js';
import { themeSheet } from '../../src/services/themes/sheet.js';
import { THEME_FACES, THEME_TOKENS } from '../../src/services/themes/tokens.js';
import { checkValue } from '../../src/services/themes/values.js';
import { SERVED_FONT_FAMILIES } from '../../src/services/app-ui/signature-tokens.js';
import { TIILITAIVAS_COLOURS, TIILITAIVAS_ID, tiilitaivasTheme } from '../../src/services/themes/tiilitaivas.js';

/** [foreground, background, the minimum the source states]; the source's own list, one line each. */
const PAIRS: ReadonlyArray<[keyof typeof TIILITAIVAS_COLOURS.light, keyof typeof TIILITAIVAS_COLOURS.light, number]> = [
    ['text', 'background', 4.5], ['textMuted', 'background', 4.5], ['accent', 'background', 4.5], ['success', 'background', 4.5], ['warning', 'background', 4.5], ['danger', 'background', 4.5],
    ['text', 'surface', 4.5], ['textMuted', 'surface', 4.5], ['accent', 'surface', 4.5], ['success', 'surface', 4.5], ['warning', 'surface', 4.5], ['danger', 'surface', 4.5],
    ['text', 'surfaceAlt', 4.5], ['textMuted', 'surfaceAlt', 4.5], ['accent', 'surfaceAlt', 4.5], ['success', 'surfaceAlt', 4.5], ['warning', 'surfaceAlt', 4.5], ['danger', 'surfaceAlt', 4.5],
    ['primaryText', 'primary', 4.5], ['primaryText', 'primaryHover', 4.5], ['secondaryText', 'secondary', 4.5],
    ['success', 'successBg', 4.5], ['warning', 'warningBg', 4.5], ['danger', 'dangerBg', 4.5],
    ['text', 'successBg', 4.5], ['text', 'warningBg', 4.5], ['text', 'dangerBg', 4.5],
    ['focus', 'background', 3], ['focus', 'surface', 3], ['border', 'surface', 3], ['border', 'background', 3],
    ['primary', 'background', 3], ['primary', 'surface', 3], ['secondaryText', 'accentDecor', 4.5],
];

const lib = (rel: string) => resolve(process.cwd(), 'public/lib', rel);

describe('Tiilitaivas against its source', () => {
    const theme = tiilitaivasTheme();
    const style = theme.styles[0];

    it('is one read-only theme with one style in both modes', () => {
        expect(theme.id).toBe(TIILITAIVAS_ID);
        expect(theme.name).toBe('Tiilitaivas');
        expect(theme.builtin).toBe(true);
        expect(theme.styles).toHaveLength(1);
        expect(theme.defaultStyle).toBe(style.id);
        expect(style.onlyMode).toBeNull();
    });

    it.each(['light', 'dark'] as const)('reaches every contrast the source states in %s', (mode) => {
        const c = TIILITAIVAS_COLOURS[mode];
        for (const [fg, bg, min] of PAIRS) {
            expect(ratio(c[fg], c[bg]), `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        }
    });

    it('carries the source colours onto the tokens the pages read', () => {
        for (const mode of ['light', 'dark'] as const) {
            const c = TIILITAIVAS_COLOURS[mode];
            const map = style[mode];
            expect(map['--bg']).toBe(c.background);
            expect(map['--card-bg']).toBe(c.surface);
            expect(map['--card-bg-alt']).toBe(c.surfaceAlt);
            expect(map['--text']).toBe(c.text);
            expect(map['--text-dim']).toBe(c.textMuted);
            expect(map['--accent']).toBe(c.accent);
            expect(map['--sun']).toBe(c.secondary);
            expect(map['--on-sun']).toBe(c.secondaryText);
            expect(map['--border-focus']).toBe(c.focus);
        }
    });

    it('sets every token a style sets with a value the node accepts, and passes the node\'s contrast rules', () => {
        for (const mode of ['light', 'dark'] as const) {
            for (const t of THEME_TOKENS) {
                expect(style[mode][t.name], `${mode} ${t.name}`).toBeDefined();
                expect(checkValue(style[mode][t.name], t.kind), `${mode} ${t.name}`).toBeNull();
            }
        }
        expect(checkContrast(style.light, style.dark).filter((r) => !r.ok)).toEqual([]);
    });

    it('sets shape values the node accepts: the source radii, frames and hard shadows', () => {
        const shapes = theme.shapes ?? {};
        for (const [name, value] of Object.entries(shapes)) expect(checkShape(name, value), name).toBeNull();
        expect(shapes['--shape-corner']).toBe('14px');
        expect(shapes['--shape-corner-control']).toBe('8px');
        expect(shapes['--shape-frame-heavy']).toBe('3px');
        expect(shapes['--shape-shadow-action']).toBe('4px 4px 0 0 var(--shadow)');
        expect(shapes['--shape-shadow-action-pressed']).toBe('1px 1px 0 0 var(--shadow)');
        expect(shapes['--shape-shadow-raised']).toBe('6px 6px 0 0 var(--shadow)');
    });

    it('serves a stylesheet that parses, reads no outside file and names no outside brand', () => {
        expect(lintCss(theme.css ?? '').error).toBeFalsy();
        const sheet = themeSheet(theme);
        expect(sheet).toContain('--bg: #EAF8F6;');
        expect(sheet).toContain('--bg: #1B1726;');
        expect(sheet).toContain('--shadow: #2A2238;');
        expect(sheet).toContain('--shadow: #0D0A14;');
        expect(sheet).not.toMatch(/url\(|@import|https?:/i);
        expect(`${sheet} ${JSON.stringify(theme)}`).not.toMatch(/nintendo|mario|luigi|bowser|yoshi|toad|koopa|goomba/i);
    });

    it('names the headline face only on the large headings, and gives a field its ring over the page sheets', () => {
        const css = theme.css ?? '';
        expect(css).toContain('--font-poster: var(--font-body); --font-showroom: var(--font-body); --font-display: var(--font-body);');
        const readers = [...css.matchAll(/([^{}]+)\{[^{}]*font-family: var\(--font-headline\)/g)].map((m) => m[1]);
        expect(readers).toHaveLength(1);
        expect(readers[0]).toContain('.poster-page-title');
        expect(css).toContain('box-shadow: 0 0 0 3px var(--focus) !important');
    });

    it('keeps the translate out of a reduced-motion hover and press, and only the shadow changes', () => {
        const css = theme.css ?? '';
        const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(start).toBeGreaterThan(-1);
        expect(css.slice(start)).toContain('transform: none');
    });
});

describe('the Tiilitaivas faces are the node\'s own', () => {
    it('sets the headline and the body in the stacks the source states', () => {
        expect(THEME_FACES['Pixelify Sans']).toBe("'Pixelify Sans', 'Baloo 2', system-ui, sans-serif");
        expect(THEME_FACES['Baloo 2']).toBe("'Baloo 2', 'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
        expect(tiilitaivasTheme().styles[0].faces).toMatchObject({ headline: 'Pixelify Sans', body: 'Baloo 2' });
    });

    it('declares each face in the node\'s font sheet from a file the node holds, with a licence row', () => {
        const sheet = readFileSync(lib('aimeat-fonts.css'), 'utf8');
        const trail = readFileSync(lib('fonts/LICENSE.md'), 'utf8');
        for (const [family, files] of [
            ['Pixelify Sans', ['pixelify-sans-var-latin', 'pixelify-sans-var-latin-ext']],
            ['Baloo 2', ['baloo2-latin', 'baloo2-latin-ext']],
            ['Nunito', ['nunito-var-latin', 'nunito-var-latin-ext']],
        ] as const) {
            expect(SERVED_FONT_FAMILIES, family).toContain(family);
            expect(sheet, family).toContain(`font-family: '${family}'`);
            expect(trail, family).toContain(`| ${family} |`);
            for (const file of files) {
                expect(sheet, file).toContain(`/lib/fonts/${file}.woff2`);
                expect(existsSync(lib(`fonts/${file}.woff2`)), file).toBe(true);
                expect(readFileSync(lib(`fonts/${file}.woff2`)).subarray(0, 4).toString('latin1'), file).toBe('wOF2');
            }
        }
    });
});
