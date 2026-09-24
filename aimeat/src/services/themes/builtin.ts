/**
 * @file src/services/themes/builtin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The six built-in themes, read from the sheets that draw them, so the list can never
 *   say something the CSS does not do.
 *
 *   AIMEAT, the default, is public/css/theme.css itself: its `:root` block for light and its
 *   `[data-theme="dark"]` block over it for dark. The other five are the palettes of
 *   public/lib/aimeat-theme.css (paper, circuit, contrast, mist, voltage), carried onto the site's
 *   tokens by theme.css's palette bridge (`html[data-palette]`); their values here are the bridge's
 *   formulas worked out with each palette's colours, and their body face is the palette's own. The
 *   pages keep drawing the built-ins exactly as before (the pill sets `data-palette`, the two sheets
 *   answer): these records describe them, for the list, the editor and a copy.
 * @structure BUILTIN_IDS · readBlock · themeCssDefaults · paletteBlocks · bridgeFormulas ·
 *   builtinThemes
 * @usage import { builtinThemes } from './builtin.js';  builtinThemes(themeCss, paletteCss)
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { THEME_TOKENS, FACE_SLOTS, THEME_FACES } from './tokens.js';
import { resolveColour, toCss, type Rgba } from './values.js';

/** In the pill's order (src/static/sdk-libs/auth/palette.js). */
export const BUILTIN_IDS = ['aimeat', 'paper', 'circuit', 'contrast', 'mist', 'voltage'] as const;
const BUILTIN_NAMES: Record<string, string> = { aimeat: 'AIMEAT', paper: 'Paper', circuit: 'Circuit', contrast: 'Contrast', mist: 'Mist', voltage: 'Voltage' };

export type TokenMap = Record<string, string>;

export interface ThemeFaces { headline?: string; body?: string; mono?: string }

export interface BuiltinTheme {
    id: string;
    name: string;
    builtin: true;
    light: TokenMap;
    dark: TokenMap;
    faces: ThemeFaces;
}

/** The custom-property declarations of the first block whose selector list matches `selector`. */
export function readBlock(css: string, selector: RegExp): TokenMap {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const m = selector.exec(noComments);
    if (!m) return {};
    const open = noComments.indexOf('{', m.index);
    const close = noComments.indexOf('}', open);
    const body = noComments.slice(open + 1, close);
    const out: TokenMap = {};
    for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[d[1]] = d[2].trim();
    return out;
}

/** theme.css's own values of every theme token: light from :root, dark from the dark block over it. */
export function themeCssDefaults(themeCss: string): { light: TokenMap; dark: TokenMap; root: TokenMap } {
    const root = readBlock(themeCss, /^:root\s*\{/m);
    const darkOver = readBlock(themeCss, /^\[data-theme="dark"\]\s*\{/m);
    const light: TokenMap = {}, dark: TokenMap = {};
    for (const t of THEME_TOKENS) {
        if (root[t.name] !== undefined) light[t.name] = root[t.name];
        const d = darkOver[t.name] ?? root[t.name];
        if (d !== undefined) dark[t.name] = d;
    }
    return { light, dark, root };
}

/** Each palette's --color-* block per mode, from the `@theme-block <palette> <mode>` markers. */
export function paletteBlocks(paletteCss: string): Record<string, { light: TokenMap; dark: TokenMap }> {
    const out: Record<string, { light: TokenMap; dark: TokenMap }> = {};
    for (const m of paletteCss.matchAll(/\/\*\s*@theme-block\s+([a-z]+)\s+(light|dark)\s*\*\/\s*([^{]+)\{([^}]*)\}/g)) {
        const [, palette, mode, , body] = m;
        const block: TokenMap = {};
        for (const d of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) block[d[1]] = d[2].trim();
        (out[palette] ||= { light: {}, dark: {} })[mode as 'light' | 'dark'] = block;
    }
    return out;
}

/** The bridge's formula for every theme token it sets (theme.css `html[data-palette] { … }`). */
export function bridgeFormulas(themeCss: string): TokenMap {
    return readBlock(themeCss, /^html\[data-palette\]\s*\{/m);
}

/** A face named first in a font-family stack, when the node serves it. */
function firstServedFace(stack: string | undefined): string | undefined {
    const first = (stack || '').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
    return first && THEME_FACES[first] ? first : undefined;
}

/**
 * Work a bridge formula out with one palette's colours: var(--color-*) is the palette's value, and a
 * colour inside a gradient is worked out on its own. The result is plain CSS colours.
 */
function workOut(formula: string, palette: TokenMap): string {
    const lookup = (name: string): Rgba | null => {
        const v = palette[name];
        return v === undefined ? null : resolveColour(v, lookup);
    };
    if (/^linear-gradient\(/i.test(formula.trim())) {
        // Each colour stop is a color-mix(…) or a var(…); work each out and keep the rest as written.
        return formula.replace(/color-mix\((?:[^()]|\([^()]*\))*\)|var\(--color-[a-z0-9-]+\)/gi, (part) => {
            const c = resolveColour(part, lookup);
            return c ? toCss(c) : part;
        }).replace(/\s+/g, ' ').trim();
    }
    const c = resolveColour(formula, lookup);
    return c ? toCss(c) : formula;
}

/**
 * The six built-in themes. `themeCss` is public/css/theme.css and `paletteCss` is
 * public/lib/aimeat-theme.css, read by the caller.
 */
export function builtinThemes(themeCss: string, paletteCss: string): BuiltinTheme[] {
    const defaults = themeCssDefaults(themeCss);
    const faces: ThemeFaces = {
        headline: firstServedFace(defaults.root[FACE_SLOTS.headline]),
        body: firstServedFace(defaults.root[FACE_SLOTS.body]),
        mono: firstServedFace(defaults.root[FACE_SLOTS.mono]),
    };
    const out: BuiltinTheme[] = [{ id: 'aimeat', name: BUILTIN_NAMES.aimeat, builtin: true, light: defaults.light, dark: defaults.dark, faces }];
    const palettes = paletteBlocks(paletteCss);
    const bridge = bridgeFormulas(themeCss);
    for (const id of BUILTIN_IDS.slice(1)) {
        const p = palettes[id];
        if (!p) continue;
        const mode = (m: 'light' | 'dark'): TokenMap => {
            const map: TokenMap = {};
            for (const t of THEME_TOKENS) {
                const formula = bridge[t.name];
                // The sun and the ink on it are not bridged: a palette keeps the house sun.
                map[t.name] = formula !== undefined ? workOut(formula, p[m]) : (m === 'light' ? defaults.light : defaults.dark)[t.name];
            }
            return map;
        };
        out.push({
            id, name: BUILTIN_NAMES[id], builtin: true, light: mode('light'), dark: mode('dark'),
            faces: { ...faces, body: firstServedFace(p.light['--font-body']) ?? faces.body },
        });
    }
    return out;
}
