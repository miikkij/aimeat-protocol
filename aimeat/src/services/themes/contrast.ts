/**
 * @file src/services/themes/contrast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contrast a theme must reach before it is saved, in each of its two modes: the
 *   rules of `pnpm check:theme` (tools/theme-contrast.ts) put in the site's own token names. Words
 *   are 4.5:1 against the ground they sit on (the ink on the page and on a card, and the page's
 *   colour on the dark block, which is the same pair), quiet words the same, the accent 3:1 (it
 *   draws labels in bold capitals and the edge of a control, as a palette's primary does), and the
 *   words on the sun 4.5:1. A colour with transparency is laid on the ground under it before it is
 *   measured. The ratio is atelier-color.ts's, which is check:theme's formula.
 * @structure CONTRAST_RULES · ContrastResult · checkContrast · modeColours
 * @usage import { checkContrast } from './contrast.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { ratio } from '../atelier-color.js';
import { THEME_TOKENS } from './tokens.js';
import { resolveColour, toCss, type Rgba } from './values.js';
import type { TokenMap } from './builtin.js';

/** [words, ground, minimum, what it is]. */
export const CONTRAST_RULES: ReadonlyArray<[string, string, number, string]> = [
    ['--text', '--bg', 4.5, 'words on the page, and the page\'s colour on the dark block'],
    ['--text', '--card-bg', 4.5, 'words on a card'],
    ['--text-dim', '--bg', 4.5, 'quiet words on the page'],
    ['--text-dim', '--card-bg', 4.5, 'quiet words on a card'],
    ['--accent', '--bg', 3, 'the accent on the page'],
    ['--accent', '--card-bg', 3, 'the accent on a card'],
    ['--on-sun', '--sun', 4.5, 'words on the sun'],
];

export interface ContrastResult { mode: 'light' | 'dark'; words: string; ground: string; ratio: number; min: number; ok: boolean; what: string }

const over = (top: Rgba, under: Rgba): Rgba => ({
    r: Math.round(top.r * top.a + under.r * (1 - top.a)),
    g: Math.round(top.g * top.a + under.g * (1 - top.a)),
    b: Math.round(top.b * top.a + under.b * (1 - top.a)),
    a: 1,
});

/** Every colour token of one mode, worked out (var() followed inside the map, no loops). */
export function modeColours(map: TokenMap): Record<string, Rgba | null> {
    const out: Record<string, Rgba | null> = {};
    const visiting = new Set<string>();
    const get = (name: string): Rgba | null => {
        if (name in out) return out[name];
        if (visiting.has(name) || map[name] === undefined) return null;
        visiting.add(name);
        const c = resolveColour(map[name], get);
        visiting.delete(name);
        out[name] = c;
        return c;
    };
    for (const t of THEME_TOKENS) if (t.kind === 'colour') get(t.name);
    return out;
}

/** The contrast of both modes; `ok` false on any line means the theme cannot be saved. */
export function checkContrast(light: TokenMap, dark: TokenMap): ContrastResult[] {
    const results: ContrastResult[] = [];
    for (const [mode, map] of [['light', light], ['dark', dark]] as const) {
        const c = modeColours(map);
        const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
        const page = c['--bg'] ? over(c['--bg']!, mode === 'dark' ? { r: 0, g: 0, b: 0, a: 1 } : white) : null;
        const solid = (name: string): Rgba | null => {
            const v = c[name];
            if (!v) return null;
            if (name === '--bg') return page;
            const ground = name === '--text' || name === '--text-dim' || name === '--accent' || name === '--on-sun' ? null : page;
            return ground ? over(v, ground) : over(v, page ?? white);
        };
        for (const [words, ground, min, what] of CONTRAST_RULES) {
            const g = solid(ground);
            const w0 = c[words];
            if (!g || !w0) { results.push({ mode, words, ground, ratio: 0, min, ok: false, what }); continue; }
            const w = over(w0, g);
            const r = Math.round(ratio(toCss(w), toCss(g)) * 100) / 100;
            results.push({ mode, words, ground, ratio: r, min, ok: r >= min, what });
        }
    }
    return results;
}
