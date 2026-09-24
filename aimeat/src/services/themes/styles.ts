/**
 * @file src/services/themes/styles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A style: one set of colours in light and dark, three faces and its mode, inside a
 *   theme (07-themes-and-styles.md "Words": "Paper is a style of the AIMEAT theme"). The six built-in
 *   styles are today's palettes, read from the sheets that draw them (builtin.ts), and keep their ids
 *   so `data-palette` works as before.
 *
 *   A style's values are refused only when they do not parse (values.ts: they are written into a
 *   stylesheet every visitor downloads). Contrast is a warning, never a refusal (Jouni, Q2): the
 *   style can be saved, and the failing lines go back with it.
 *
 *   Its stylesheet: light on `html[data-palette='<id>'][data-theme]`, dark on
 *   `…[data-theme='dark']` after it. Both outrank theme.css's own blocks and its palette bridge by
 *   weight or by coming later; every theme token is written, so no bridge formula reads a palette the
 *   style does not have.
 * @structure Style · StyleInput · OnlyMode · builtinStyles · prepareStyle · styleSheet · swatchOf
 * @usage import { builtinStyles, prepareStyle, styleSheet } from './styles.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial: the style level of the two-level model (was the branch's "theme").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../../server-bootstrap/asset-dirs.js';
import { THEME_TOKENS, THEME_FACES, FACE_SLOTS, faceStack, tokenKind, isThemeToken, type FaceSlot } from './tokens.js';
import { checkValue, toCss } from './values.js';
import { builtinThemes, type TokenMap, type ThemeFaces } from './builtin.js';
import { checkContrast, modeColours, type ContrastResult } from './contrast.js';

export type OnlyMode = 'light' | 'dark' | null;

export interface Style {
    id: string;
    name: string;
    builtin: boolean;
    light: TokenMap;
    dark: TokenMap;
    faces: ThemeFaces;
    onlyMode: OnlyMode;
    retired: boolean;
}

/** What a caller may send for a style; every field optional on an edit. */
export interface StyleInput {
    name?: string;
    light?: TokenMap;
    dark?: TokenMap;
    faces?: ThemeFaces;
    onlyMode?: OnlyMode | '';
    retired?: boolean;
}

export const STYLE_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

let builtinCache: Style[] | null = null;
/** The six built-in styles, read once from public/css/theme.css and public/lib/aimeat-theme.css. */
export function builtinStyles(): Style[] {
    if (builtinCache) return builtinCache;
    const pub = resolveAssetDir('public', join(dirname(fileURLToPath(import.meta.url)), '..'), process.cwd());
    if (!pub) throw new Error('This server was started without its public files, so it cannot read its built-in styles.');
    builtinCache = builtinThemes(readFileSync(join(pub, 'css', 'theme.css'), 'utf8'), readFileSync(join(pub, 'lib', 'aimeat-theme.css'), 'utf8'))
        .map((b) => ({ id: b.id, name: b.name, builtin: true, light: b.light, dark: b.dark, faces: b.faces, onlyMode: null, retired: false }));
    return builtinCache;
}

/**
 * A style with the input applied over `base`: the stored form and the reasons it cannot be stored
 * (values that do not parse, a name that is empty), or its contrast lines that miss (warnings).
 */
export function prepareStyle(input: StyleInput, base: Style): { style: Omit<Style, 'id'>; refused: string[]; contrast: ContrastResult[] } {
    const refused: string[] = [];
    const name = (input.name ?? base.name).trim();
    if (!name || name.length > 60 || /[<>]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32)) refused.push('name: 1 to 60 characters, no angle brackets');
    const merge = (mode: 'light' | 'dark', given: TokenMap | undefined): TokenMap => {
        const out: TokenMap = { ...base[mode] };
        if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given))) { refused.push(`${mode}: an object of token → value`); return out; }
        for (const [token, value] of Object.entries(given ?? {})) {
            if (!isThemeToken(token)) { refused.push(`${mode} ${token}: not a token a style sets`); continue; }
            const bad = checkValue(value, tokenKind(token)!);
            if (bad) refused.push(`${mode} ${token}: ${bad}`); else out[token] = String(value).trim();
        }
        for (const t of THEME_TOKENS) if (out[t.name] === undefined) refused.push(`${mode} ${t.name}: missing`);
        return out;
    };
    const light = merge('light', input.light);
    const dark = merge('dark', input.dark);
    const faces: ThemeFaces = { ...base.faces };
    for (const [slot, face] of Object.entries(input.faces ?? {})) {
        if (!(slot in FACE_SLOTS)) { refused.push(`faces.${slot}: the faces are headline, body and mono`); continue; }
        if (face && !THEME_FACES[face]) { refused.push(`faces.${slot}: "${face}" is not a face this server serves (${Object.keys(THEME_FACES).join(', ')})`); continue; }
        faces[slot as FaceSlot] = face || undefined;
    }
    const mode = input.onlyMode === undefined ? base.onlyMode : (input.onlyMode || null);
    if (mode !== null && mode !== 'light' && mode !== 'dark') refused.push('onlyMode: light, dark or empty');
    const style = { name, builtin: false, light, dark, faces, onlyMode: mode, retired: input.retired ?? base.retired ?? false };
    return { style, refused, contrast: checkContrast(light, dark) };
}

const declarations = (map: TokenMap, faces?: ThemeFaces): string[] => {
    const out: string[] = [];
    for (const t of THEME_TOKENS) if (map[t.name] !== undefined) out.push(`  ${t.name}: ${map[t.name]};`);
    if (faces) for (const [slot, token] of Object.entries(FACE_SLOTS)) {
        const face = faces[slot as FaceSlot];
        const stack = face ? faceStack(face) : undefined;
        if (stack) out.push(`  ${token}: ${stack};`);
    }
    return out;
};

/**
 * The palette names the shared libraries read (the look picker's own popover, the markdown and
 * editor libraries read `--color-*`, as an app does), taken from the style's own colours. The node's
 * own sheets read the site tokens only; without these a custom style's picker kept the house coral.
 */
const PALETTE_NAMES = [
    '  --color-base-100: var(--bg);', '  --color-base-200: var(--card-bg);', '  --color-base-300: var(--card-border);',
    '  --color-base-content: var(--text);', '  --color-primary: var(--accent);', '  --color-secondary: var(--love3);',
    '  --color-accent: var(--sun);', '  --color-accent-content: var(--on-sun);',
];

/** One custom style's token blocks. Its id is held to [a-z0-9-] where it is made. */
export function styleSheet(style: Style): string {
    const at = `html[data-palette='${style.id}']`;
    return [
        `/* Style "${style.name.replace(/\*\//g, '')}" (${style.id}) */`,
        `${at}, ${at}[data-theme] {`, ...declarations(style.light, style.faces), ...PALETTE_NAMES, '}',
        `${at}[data-theme='dark'] {`, ...declarations(style.dark), '}',
    ].join('\n') + '\n';
}

/** The colours a chip shows: page, card, accent, sun, per mode, as hex. */
export function swatchOf(style: Pick<Style, 'light' | 'dark'>): { light: Record<string, string>; dark: Record<string, string> } {
    const pick = (map: TokenMap) => {
        const c = modeColours(map);
        const hex = (n: string) => (c[n] ? toCss({ ...c[n]!, a: 1 }) : '#888888');
        return { bg: hex('--bg'), card: hex('--card-bg'), accent: hex('--accent'), sun: hex('--sun') };
    };
    return { light: pick(style.light), dark: pick(style.dark) };
}
