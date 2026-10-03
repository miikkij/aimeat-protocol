/**
 * @file src/services/themes/font-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one list of faces, from two sources: the base faces in code (THEME_FACES in
 *   tokens.ts, SERVED_FONT_FAMILIES in app-ui/signature-tokens.ts) and the faces the node's operator
 *   added to the running node (the font manager, fonts.ts). Every code path that used to read the
 *   base lists alone reads the merged list here instead: the style check and its stacks (styles.ts),
 *   the face warning (sheet.ts), the built-in style reader (builtin.ts), the vocabulary an AI reads
 *   (service.ts) and the Design Book bench (app-ui/validate.ts, unservedFirstFamily).
 *
 *   HELD IN THIS PROCESS. Those readers are synchronous, as the theme snapshot is, so the added
 *   records are loaded at boot and replaced on every font write (fonts.ts calls setAddedFaces). This
 *   module imports no storage, so the lists stay importable from anywhere without a cycle.
 *
 *   AN ADDED FACE COUNTS ONCE A FILE OF IT HAS ARRIVED. A family registered and not yet uploaded is
 *   in the inventory, and no style may name it, because a page would fall back in silence. A base
 *   face always wins its name: an added record never replaces a base face's stack.
 * @structure FontKind · FontFile · FontRecord · stackFor · setAddedFaces · addedFaces · themeFaceStacks ·
 *   themeFaceNames · faceStackOf · addedFamilyNames · fontsSheet · fontsSheetHref
 * @usage import { faceStackOf, themeFaceNames } from './font-registry.js';
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager).
 */
import { createHash } from 'node:crypto';
import { THEME_FACES } from './tokens.js';

/** The generic family an added face falls back to, named as CSS names it. */
export const FONT_KINDS = ['sans-serif', 'serif', 'monospace', 'cursive'] as const;
export type FontKind = typeof FONT_KINDS[number];

export interface FontFile {
    /** The file's name under fonts/<slug>/, made from weight, style and subset. */
    file: string;
    /** "400", or a variable range "100 900". */
    weight: string;
    style: 'normal' | 'italic';
    /** A label for one unicode subset (latin, latin-ext), when the face ships in parts. */
    subset?: string;
    unicodeRange?: string;
    /** Null until the bytes have arrived through PUT /v1/upload/:token. */
    bytes: number | null;
    sha256: string | null;
    uploadedAt?: string;
}

/** One added family, as stored under the node's own principal (key ui.font.<slug>). */
export interface FontRecord {
    family: string;
    slug: string;
    /** Always "added": the base faces are never stored, they come from code. */
    origin: 'added';
    kind: FontKind;
    files: FontFile[];
    licence: string | null;
    copyright: string | null;
    source: string | null;
    /** "unknown" when the licence or the copyright holder is missing (Jouni, 2026-10-03). */
    licenceStatus: 'stated' | 'unknown';
    addedBy: string;
    addedAt: string;
    updatedBy?: string;
    updatedAt: string;
}

const FALLBACK: Record<FontKind, string> = {
    'sans-serif': 'system-ui, sans-serif',
    serif: 'Georgia, serif',
    monospace: 'ui-monospace, monospace',
    cursive: 'cursive',
};

/** The stack an added face is set in: the family, then a generic fallback by its kind. */
export const stackFor = (family: string, kind: FontKind): string => `'${family}', ${FALLBACK[kind] ?? FALLBACK['sans-serif']}`;

let added: FontRecord[] = [];

const arrived = (r: FontRecord): FontFile[] => r.files.filter((f) => f.sha256 && f.bytes !== null);
const baseLower = (): Set<string> => new Set(Object.keys(THEME_FACES).map((n) => n.toLowerCase()));

/** Replace the added records this process holds (at boot and after every font write). */
export function setAddedFaces(records: FontRecord[]): void {
    added = [...records].sort((a, b) => a.family.localeCompare(b.family));
}

/** Every added record, served or not. */
export const addedFaces = (): readonly FontRecord[] => added;

/** The added families a page can load: at least one file arrived, and the name is not a base face's. */
function servedAdded(): FontRecord[] {
    const base = baseLower();
    return added.filter((r) => arrived(r).length > 0 && !base.has(r.family.toLowerCase()));
}

/** Face name → stack, the base faces first, then the added ones that are served. */
export function themeFaceStacks(): Record<string, string> {
    const out: Record<string, string> = { ...THEME_FACES };
    for (const r of servedAdded()) out[r.family] = stackFor(r.family, r.kind);
    return out;
}

/** The faces a theme may choose. */
export const themeFaceNames = (): string[] => Object.keys(themeFaceStacks());

/** The stack a face is set in, or undefined for a face the node does not serve. */
export const faceStackOf = (face: string): string | undefined => themeFaceStacks()[face];

/**
 * The added families a page can load. app-ui/signature-tokens.ts puts them after its base list
 * (servedFontFamilies there), so this module never imports the app-ui layer.
 */
export const addedFamilyNames = (): string[] => servedAdded().map((r) => r.family);

const cssString = (s: string) => s.replace(/['\\\n\r]/g, '');

/** The @font-face rules of the added families, one per arrived file. */
export function fontsSheet(): string {
    const parts = ['/* The faces the operator of this node added (the font manager). Base faces are in /lib/aimeat-fonts.css. */'];
    for (const r of servedAdded()) {
        for (const f of arrived(r)) {
            parts.push([
                '@font-face {',
                `  font-family: '${cssString(r.family)}'; font-style: ${f.style}; font-weight: ${f.weight}; font-display: swap;`,
                `  src: url('/v1/themes/fonts/${r.slug}/${f.file}?v=${String(f.sha256).slice(0, 8)}') format('woff2');`,
                ...(f.unicodeRange ? [`  unicode-range: ${f.unicodeRange};`] : []),
                '}',
            ].join('\n'));
        }
    }
    return parts.join('\n') + '\n';
}

/** The sheet's address, stamped with its own hash; null while no added face is served. */
export function fontsSheetHref(): string | null {
    if (!servedAdded().length) return null;
    return `/v1/themes/fonts.css?v=${createHash('sha1').update(fontsSheet()).digest('hex').slice(0, 12)}`;
}
