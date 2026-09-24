/**
 * @file src/services/themes/values.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The values a theme may give a token, and how a value becomes a colour.
 *
 *   A theme's values are written into a stylesheet the node serves to every visitor, so a value is
 *   held to a small grammar before it is stored: hex, rgb(), rgba(), hsl(), hsla(), `transparent`,
 *   `color-mix(in srgb, …)`, `var(--token)` of another theme token, and for a gradient token
 *   `linear-gradient(<angle>, <colour> <stop>, …)`. The characters that could end a declaration or
 *   open a rule (`;`, `{`, `}`, quotes, `<`, `@`, `\`, `/`, `:`) never pass, and a function outside
 *   that list (`url(`, `image(`, `expression(`) is refused by name.
 *
 *   resolveColour turns a value into an RGBA colour the contrast rules can read, following var() to
 *   the same mode's map and mixing color-mix() in sRGB as the browser does (straight channels, the
 *   alpha mixed with them).
 * @structure checkValue · resolveColour · Rgba · toCss
 * @usage import { checkValue, resolveColour } from './values.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import type { ThemeTokenKind } from './tokens.js';

export interface Rgba { r: number; g: number; b: number; a: number }

const ALLOWED_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'color-mix', 'var', 'linear-gradient']);
const SAFE_CHARS = /^[#a-zA-Z0-9(),.%\s-]+$/;
const MAX_VALUE = 400;

/**
 * Why a value cannot be stored, or null when it can. `kind` says whether the token takes a colour or
 * a gradient; a gradient may only be a linear-gradient.
 */
export function checkValue(value: unknown, kind: ThemeTokenKind): string | null {
    if (typeof value !== 'string') return 'a value is a string';
    const v = value.trim();
    if (!v) return 'a value is empty';
    if (v.length > MAX_VALUE) return `a value is at most ${MAX_VALUE} characters`;
    if (!SAFE_CHARS.test(v)) return 'a value may hold only letters, digits, #, %, dots, commas, brackets and spaces';
    for (const m of v.matchAll(/([a-zA-Z-]+)\s*\(/g)) {
        if (!ALLOWED_FUNCTIONS.has(m[1].toLowerCase())) return `"${m[1]}(" is not a colour function a theme may use`;
    }
    for (const m of v.matchAll(/var\(\s*([^)\s]*)\s*\)/g)) {
        if (!/^--[a-z0-9-]+$/.test(m[1])) return 'var() takes one token name, such as var(--accent)';
    }
    let depth = 0;
    for (const c of v) { if (c === '(') depth++; if (c === ')') depth--; if (depth < 0) return 'a closing bracket comes before its opening one'; }
    if (depth !== 0) return 'the brackets do not close';
    const isGradient = /^linear-gradient\(/i.test(v);
    if (kind === 'gradient' && !isGradient && resolveColourSyntax(v) === null) return 'a gradient token takes a linear-gradient or one colour';
    if (kind === 'colour' && isGradient) return 'a colour token takes one colour, not a gradient';
    if (kind === 'colour' && resolveColourSyntax(v) === null) return 'the value is not a colour this node can read';
    return null;
}

/** A syntactic check that a value is a colour, following no var(). */
function resolveColourSyntax(v: string): Rgba | null {
    return resolveColour(v, () => ({ r: 0, g: 0, b: 0, a: 1 }));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parseHex(v: string): Rgba | null {
    const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
    if (!m) return null;
    let s = m[1];
    if (s.length <= 4) s = s.split('').map((c) => c + c).join('');
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1 };
}

/** The top-level comma-separated parts of a function's arguments. */
function splitArgs(inner: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(inner.slice(start).trim());
    return parts;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * A value as an RGBA colour, or null when it is not one. `lookup` answers var(--name) with that
 * token's colour in the same mode.
 */
export function resolveColour(value: string, lookup: (name: string) => Rgba | null, seen: Set<string> = new Set()): Rgba | null {
    const v = value.trim();
    if (/^transparent$/i.test(v)) return { r: 0, g: 0, b: 0, a: 0 };
    if (v.startsWith('#')) return parseHex(v);
    const fn = /^([a-z-]+)\((.*)\)$/is.exec(v);
    if (!fn) return null;
    const name = fn[1].toLowerCase();
    const inner = fn[2];
    if (name === 'var') {
        const token = inner.trim();
        if (seen.has(token)) return null;
        return lookup(token);
    }
    if (name === 'rgb' || name === 'rgba') {
        const nums = inner.split(/[\s,/]+/).filter(Boolean);
        if (nums.length < 3) return null;
        const ch = nums.slice(0, 3).map((n) => n.endsWith('%') ? parseFloat(n) * 2.55 : parseFloat(n));
        const a = nums[3] === undefined ? 1 : nums[3].endsWith('%') ? parseFloat(nums[3]) / 100 : parseFloat(nums[3]);
        if ([...ch, a].some((n) => !Number.isFinite(n))) return null;
        return { r: clamp(Math.round(ch[0]), 0, 255), g: clamp(Math.round(ch[1]), 0, 255), b: clamp(Math.round(ch[2]), 0, 255), a: clamp(a, 0, 1) };
    }
    if (name === 'hsl' || name === 'hsla') {
        const nums = inner.split(/[\s,/]+/).filter(Boolean);
        if (nums.length < 3) return null;
        const h = parseFloat(nums[0]), s = parseFloat(nums[1]) / 100, l = parseFloat(nums[2]) / 100;
        const a = nums[3] === undefined ? 1 : nums[3].endsWith('%') ? parseFloat(nums[3]) / 100 : parseFloat(nums[3]);
        if ([h, s, l, a].some((n) => !Number.isFinite(n))) return null;
        const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1));
        return { r, g, b, a: clamp(a, 0, 1) };
    }
    if (name === 'color-mix') {
        const parts = splitArgs(inner);
        if (parts.length !== 3 || !/^in\s+srgb$/i.test(parts[0])) return null;
        const side = (p: string) => {
            const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/s.exec(p.trim());
            if (!m) return null;
            const c = resolveColour(m[1], lookup, seen);
            return c ? { c, pct: m[2] === undefined ? undefined : parseFloat(m[2]) / 100 } : null;
        };
        const A = side(parts[1]), B = side(parts[2]);
        if (!A || !B) return null;
        let pa = A.pct, pb = B.pct;
        if (pa === undefined && pb === undefined) { pa = 0.5; pb = 0.5; }
        else if (pa === undefined) pa = 1 - (pb as number);
        else if (pb === undefined) pb = 1 - pa;
        const sum = (pa as number) + (pb as number);
        if (sum <= 0) return null;
        const wa = (pa as number) / sum, wb = (pb as number) / sum;
        const alphaScale = Math.min(sum, 1);
        // Premultiplied mixing, as the browser does it: a transparent side adds no colour.
        const a = A.c.a * wa + B.c.a * wb;
        const mix = (x: number, y: number) => a === 0 ? 0 : Math.round((x * A.c.a * wa + y * B.c.a * wb) / a);
        return { r: mix(A.c.r, B.c.r), g: mix(A.c.g, B.c.g), b: mix(A.c.b, B.c.b), a: a * alphaScale };
    }
    return null;
}

/** An RGBA colour as CSS: hex when opaque, rgba() otherwise. */
export function toCss(c: Rgba): string {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    if (c.a >= 0.999) return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}
