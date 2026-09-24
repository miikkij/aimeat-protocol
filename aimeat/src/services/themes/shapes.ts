/**
 * @file src/services/themes/shapes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape values of a theme: corners, frames, shadows, the letter case and spacing of
 *   headings, actions and labels, and the heading's weight, spacing and line height. Jouni,
 *   2026-09-24: "katsoo että pebble syntyy myös niille uusille tehdyille komponenteille mitä tullaan
 *   tekemään kun tehdään settings & controls kirjastoon."
 *
 *   Colours belong to a style and change between light and dark; shapes belong to the theme and are
 *   the same in every style and both modes. The component sheets read these tokens instead of
 *   writing a radius, a frame or a shadow of their own, so a component made tomorrow wears a theme's
 *   shapes from its first day. The built-in values are public/css/theme.css's `:root` block, read
 *   from the file, so the file stays the one place they are written. A theme's own values are
 *   served in its sheet on `html:root`, which outranks `:root`.
 *
 *   A value is held to a small grammar per kind before it is stored, like a style's colours: it is
 *   written into a stylesheet every visitor loads.
 * @structure ShapeKind · SHAPE_TOKENS · isShapeToken · builtinShapes · checkShape · shapeSheet
 * @usage import { SHAPE_TOKENS, checkShape, shapeSheet } from './shapes.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (07 "New components follow the theme").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../../server-bootstrap/asset-dirs.js';
import { readBlock, type TokenMap } from './builtin.js';
import { checkValue } from './values.js';

/**
 * corner: one to four lengths (a radius); width: one length (a frame); colour: a colour of the
 * style's grammar; shadow: `none` or up to three shadows; case: a text-transform keyword; tracking:
 * a letter spacing; weight: a font weight; leading: a line height.
 */
export type ShapeKind = 'corner' | 'width' | 'colour' | 'shadow' | 'case' | 'tracking' | 'weight' | 'leading';

export interface ShapeToken { name: string; kind: ShapeKind; group: 'corners' | 'frames' | 'shadows' | 'type'; what: string }

export const SHAPE_TOKENS: readonly ShapeToken[] = [
    { name: '--shape-corner', kind: 'corner', group: 'corners', what: 'the corner of a box, a panel, a frame or a card' },
    { name: '--shape-corner-control', kind: 'corner', group: 'corners', what: 'the corner of a field, a small control or a row you press' },
    { name: '--shape-corner-pill', kind: 'corner', group: 'corners', what: 'the corner of the loud action, a tab and a count' },
    { name: '--shape-corner-dialog', kind: 'corner', group: 'corners', what: 'the corner of a dialog and a menu that opens' },
    { name: '--shape-frame', kind: 'width', group: 'frames', what: 'the frame of a box or a control' },
    { name: '--shape-frame-heavy', kind: 'width', group: 'frames', what: 'the heavy frame and rule: a page frame, a record, a dialog, an underline' },
    { name: '--shape-frame-colour', kind: 'colour', group: 'frames', what: 'the colour of a box\'s frame' },
    { name: '--shape-rule-colour', kind: 'colour', group: 'frames', what: 'the colour of a rule between parts and of a control\'s frame' },
    { name: '--shape-field-colour', kind: 'colour', group: 'frames', what: 'the colour of a field\'s frame' },
    { name: '--shape-shadow', kind: 'shadow', group: 'shadows', what: 'the shadow of a box at rest' },
    { name: '--shape-shadow-raised', kind: 'shadow', group: 'shadows', what: 'the shadow of a record and a menu that opens' },
    { name: '--shape-shadow-dialog', kind: 'shadow', group: 'shadows', what: 'the shadow of a dialog' },
    { name: '--shape-shadow-action', kind: 'shadow', group: 'shadows', what: 'the shadow of the loud action' },
    { name: '--shape-shadow-action-pressed', kind: 'shadow', group: 'shadows', what: 'the shadow of the loud action under the pointer' },
    { name: '--shape-shadow-chosen', kind: 'shadow', group: 'shadows', what: 'the shadow of a chosen choice' },
    { name: '--shape-case-heading', kind: 'case', group: 'type', what: 'the letter case of headings' },
    { name: '--font-poster-weight', kind: 'weight', group: 'type', what: 'the weight of headings' },
    { name: '--font-poster-tracking', kind: 'tracking', group: 'type', what: 'the letter spacing of headings' },
    { name: '--font-poster-leading', kind: 'leading', group: 'type', what: 'the line height of headings' },
    { name: '--shape-case-action', kind: 'case', group: 'type', what: 'the letter case of actions and tabs' },
    { name: '--shape-tracking-action', kind: 'tracking', group: 'type', what: 'the letter spacing of actions and tabs' },
    { name: '--shape-case-label', kind: 'case', group: 'type', what: 'the letter case of labels' },
    { name: '--shape-tracking-label', kind: 'tracking', group: 'type', what: 'the letter spacing of labels' },
];

const SHAPE_NAMES = new Set(SHAPE_TOKENS.map((t) => t.name));
export const isShapeToken = (name: string): boolean => SHAPE_NAMES.has(name);
const kindOf = (name: string): ShapeKind | undefined => SHAPE_TOKENS.find((t) => t.name === name)?.kind;

let builtinCache: TokenMap | null = null;
/** The built-in theme's shape values: theme.css's `:root` block, read once. */
export function builtinShapes(): TokenMap {
    if (builtinCache) return builtinCache;
    const pub = resolveAssetDir('public', join(dirname(fileURLToPath(import.meta.url)), '..'), process.cwd());
    if (!pub) throw new Error('This server was started without its public files, so it cannot read its built-in shapes.');
    const root = readBlock(readFileSync(join(pub, 'css', 'theme.css'), 'utf8'), /^:root\s*\{/m);
    const out: TokenMap = {};
    for (const t of SHAPE_TOKENS) if (root[t.name] !== undefined) out[t.name] = root[t.name];
    builtinCache = out;
    return out;
}

const LENGTH = /^-?(0|\d+(\.\d+)?(px|rem|em|%))$/;
const CASES = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);

/** A value's top-level parts, split on `sep` outside brackets. */
function splitTop(v: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < v.length; i++) {
        if (v[i] === '(') depth++;
        else if (v[i] === ')') depth--;
        else if (depth === 0 && v.startsWith(sep, i)) { out.push(v.slice(start, i)); start = i + sep.length; }
    }
    out.push(v.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
}

/** One shadow: `inset`, then two to four lengths, then a colour (or a colour first). */
function checkOneShadow(s: string): string | null {
    const parts = splitTop(s, ' ');
    const rest = parts.filter((p) => p !== 'inset');
    const lengths = rest.filter((p) => LENGTH.test(p));
    const colours = rest.filter((p) => !LENGTH.test(p));
    if (lengths.length < 2 || lengths.length > 4) return 'a shadow has two to four lengths';
    if (colours.length !== 1) return 'a shadow has one colour';
    const bad = checkValue(colours[0], 'colour');
    return bad ? `the shadow's colour: ${bad}` : null;
}

/** Why a shape value cannot be stored, or null when it can. */
export function checkShape(name: string, value: unknown): string | null {
    const kind = kindOf(name);
    if (!kind) return `${name} is not a shape value (${SHAPE_TOKENS.map((t) => t.name).join(', ')})`;
    if (typeof value !== 'string' || !value.trim()) return `${name}: a value is a string`;
    const v = value.trim();
    if (v.length > 200 || !/^[#a-zA-Z0-9(),.%\s-]+$/.test(v)) return `${name}: letters, digits, #, %, dots, commas, brackets and spaces only, at most 200 characters`;
    switch (kind) {
        case 'corner': {
            const parts = v.split(/\s+/);
            return parts.length <= 4 && parts.every((p) => LENGTH.test(p) && !p.startsWith('-')) ? null : `${name}: one to four lengths, for example 0, 12px or 999px`;
        }
        case 'width': return LENGTH.test(v) && !v.startsWith('-') && !v.endsWith('%') ? null : `${name}: one length, for example 1px or 3px`;
        case 'colour': { const bad = checkValue(v, 'colour'); return bad ? `${name}: ${bad}` : null; }
        case 'shadow': {
            if (v === 'none') return null;
            const shadows = splitTop(v, ',');
            if (shadows.length > 3) return `${name}: at most three shadows`;
            for (const s of shadows) { const bad = checkOneShadow(s); if (bad) return `${name}: ${bad}`; }
            return null;
        }
        case 'case': return CASES.has(v) ? null : `${name}: one of ${[...CASES].join(', ')}`;
        case 'tracking': return v === 'normal' || LENGTH.test(v) ? null : `${name}: normal or a length, for example 0 or -0.01em`;
        case 'weight': return v === 'normal' || v === 'bold' || /^[1-9]00$/.test(v) ? null : `${name}: 100 to 900, normal or bold`;
        case 'leading': return v === 'normal' || /^\d+(\.\d+)?$/.test(v) ? null : `${name}: normal or a number, for example 1.1`;
    }
}

/**
 * A theme's shape values as the block its sheet serves; empty when it sets none. `html:root`
 * outranks theme.css's `:root` wherever the sheet is: a page links the sheet only while it wears the
 * theme, and a preview frame adopts a draft's sheet without naming a theme on the page.
 */
export function shapeSheet(shapes: TokenMap | undefined): string {
    const entries = Object.entries(shapes || {}).filter(([k, v]) => isShapeToken(k) && !checkShape(k, v));
    if (!entries.length) return '';
    return `html:root {\n${entries.map(([k, v]) => `  ${k}: ${v.trim()};`).join('\n')}\n}`;
}
