/**
 * @file src/services/themes/tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a theme may set: the site tokens of public/css/theme.css that change the look of
 *   the node's own interface, and the faces the node serves. A theme is written in these names, the
 *   same names every component sheet reads, so a theme changes every page at once and a copy of the
 *   built-in AIMEAT theme is exactly today's look.
 *
 *   THE TOKEN LIST IS THE PALETTE BRIDGE'S LIST (theme.css `html[data-palette]`), plus the sun and the
 *   ink on it: what a built-in palette changes is what a theme may change. The semantic family
 *   (success, warning, danger and their tints) is left out on purpose, as the bridge leaves it out: a
 *   warning keeps its colour whatever the theme.
 *
 *   FACES: a theme may choose each of the three faces (headline, body, mono) from the faces the node
 *   serves itself (public/lib/aimeat-fonts.css), and from nothing else (Jouni, 2026-09-24: fonts yes,
 *   vendored faces only).
 * @structure ThemeTokenKind · THEME_TOKENS · CORE_TOKENS · THEME_FACES · FACE_SLOTS · faceStack
 * @usage import { THEME_TOKENS, THEME_FACES } from './tokens.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */

/** A colour token takes one colour; a gradient token takes a linear-gradient of colours. */
export type ThemeTokenKind = 'colour' | 'gradient';

export interface ThemeToken {
    name: string;
    kind: ThemeTokenKind;
    /** What it paints, in words, for the editor and for an AI. */
    what: string;
}

export const THEME_TOKENS: readonly ThemeToken[] = [
    { name: '--bg', kind: 'colour', what: 'the page ground' },
    { name: '--bg-surface', kind: 'colour', what: 'a quiet surface on the page' },
    { name: '--bg-elevated', kind: 'colour', what: 'a raised surface' },
    { name: '--card-bg', kind: 'colour', what: 'a card or a panel' },
    { name: '--card-bg-hover', kind: 'colour', what: 'a card under the pointer' },
    { name: '--card-bg-solid', kind: 'colour', what: 'a card that must not show through' },
    { name: '--card-bg-alt', kind: 'colour', what: 'the second card ground' },
    { name: '--card-border', kind: 'colour', what: 'a card\'s edge' },
    { name: '--accent', kind: 'colour', what: 'the accent: labels, links, the heart' },
    { name: '--accent-bright', kind: 'colour', what: 'the accent, lighter' },
    { name: '--accent-deep', kind: 'colour', what: 'the accent, deeper' },
    { name: '--accent-glow', kind: 'colour', what: 'a glow in the accent' },
    { name: '--accent-subtle', kind: 'colour', what: 'a faint accent tint' },
    { name: '--accent-border', kind: 'colour', what: 'a hairline in the accent' },
    { name: '--love1', kind: 'colour', what: 'the love gradient, first stop' },
    { name: '--love2', kind: 'colour', what: 'the love gradient, second stop' },
    { name: '--love3', kind: 'colour', what: 'the love gradient, third stop' },
    { name: '--love4', kind: 'colour', what: 'the love gradient, fourth stop' },
    { name: '--love5', kind: 'colour', what: 'the love gradient, last stop' },
    { name: '--text', kind: 'colour', what: 'the ink: words, rules, the dark block' },
    { name: '--text-bright', kind: 'colour', what: 'the strongest words' },
    { name: '--text-dim', kind: 'colour', what: 'quiet words' },
    { name: '--text-muted', kind: 'colour', what: 'the quietest words' },
    { name: '--border', kind: 'colour', what: 'a hairline between rows' },
    { name: '--border-subtle', kind: 'colour', what: 'the faintest hairline' },
    { name: '--border-focus', kind: 'colour', what: 'the edge of a field in use' },
    { name: '--bg-input', kind: 'colour', what: 'a field\'s ground' },
    { name: '--bg-input-focus', kind: 'colour', what: 'a field\'s ground while typing' },
    { name: '--control-bg', kind: 'colour', what: 'a control\'s ground' },
    { name: '--control-border', kind: 'colour', what: 'a control\'s edge' },
    { name: '--code-bg', kind: 'colour', what: 'the ground of code' },
    { name: '--scrollbar-thumb', kind: 'colour', what: 'the scrollbar' },
    { name: '--morsel-bg', kind: 'gradient', what: 'the morsel badge' },
    { name: '--pf-hero-gradient', kind: 'gradient', what: 'the settings hero' },
    { name: '--pf-cta-gradient', kind: 'gradient', what: 'a call to act' },
    { name: '--pf-callout-gradient', kind: 'gradient', what: 'a callout' },
    { name: '--sun', kind: 'colour', what: 'the sun: the dark block\'s shadow, the chosen tab, the section edge' },
    { name: '--on-sun', kind: 'colour', what: 'words on the sun' },
];

/** The eight a person reads a theme by; the editor shows these first and folds the rest. */
export const CORE_TOKENS: readonly string[] = ['--bg', '--card-bg', '--text', '--text-dim', '--accent', '--sun', '--on-sun', '--border'];

const TOKEN_NAMES = new Set(THEME_TOKENS.map((t) => t.name));
export const isThemeToken = (name: string): boolean => TOKEN_NAMES.has(name);
export const tokenKind = (name: string): ThemeTokenKind | undefined => THEME_TOKENS.find((t) => t.name === name)?.kind;

/** The faces the node serves (public/lib/aimeat-fonts.css), each with the stack it is set in. */
export const THEME_FACES: Readonly<Record<string, string>> = {
    'Fjalla One': "'Fjalla One', 'Archivo Black', 'Archivo', system-ui, sans-serif",
    'Archivo Black': "'Archivo Black', 'Archivo', system-ui, sans-serif",
    'Archivo': "'Archivo', 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'DM Sans': "'DM Sans', 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'Inter': "'Inter', 'Segoe UI', system-ui, sans-serif",
    'Space Grotesk': "'Space Grotesk', 'Inter', system-ui, sans-serif",
    'Fraunces': "'Fraunces', Georgia, 'Times New Roman', serif",
    'Bungee': "'Bungee', 'Archivo Black', system-ui, sans-serif",
    'VT323': "'VT323', 'JetBrains Mono', monospace",
    'JetBrains Mono': "'JetBrains Mono', 'SF Mono', monospace",
};

/** The three faces a theme may choose, and the token each one sets. */
export const FACE_SLOTS = { headline: '--font-headline', body: '--font-body', mono: '--font-mono' } as const;
export type FaceSlot = keyof typeof FACE_SLOTS;

/** The stack a face is set in, or undefined for a face the node does not serve. */
export const faceStack = (face: string): string | undefined => THEME_FACES[face];
