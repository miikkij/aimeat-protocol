/**
 * @file src/services/atelier-color.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The colour arithmetic the Atelier contrast matrix stands on — WCAG 2.1 luminance
 *   and ratio exactly as tools/theme-contrast.ts computes them, OKLab both ways (the stylesheet
 *   mixes in oklab and the numbers must match the browser), the OKLCh hue rotation the
 *   relative-colour syntax performs, and source-over compositing in sRGB as browsers do it. A
 *   pure extraction from atelier-contrast.ts on 2026-09-05: that file stood at 701 lines against
 *   the 800 cap, and the effects round adds the CSS filter transforms beside these. The contrast
 *   module re-exports every public name, so every importer keeps the address it had.
 * @structure lum · ratio · srgbToLinear · linearToSrgb · hexToLab · labToHex · rotateHue ·
 *   mixOklab · Rgba · over
 * @usage
 *   import { ratio, mixOklab, over } from './atelier-color.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Pure extraction from atelier-contrast.ts v1.3.0
 *     (wish-atelier-post-process-effects, stage 1).
 */

// ── WCAG 2.1, exactly as tools/theme-contrast.ts computes it ─────────────────────────────────

/** WCAG 2.1 relative luminance of an #rrggbb colour. */
export function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours (order-independent). */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ── OKLab, because the stylesheet mixes in oklab and the numbers must match the browser ──────

type Lab = { L: number; a: number; b: number };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function labToHex(lab: Lab): string {
  const l = Math.pow(lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3);
  const m = Math.pow(lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3);
  const s = Math.pow(lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b, 3);
  const r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  const to = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Rotate a colour's OKLCh hue by `deg`, keeping L and C — the browser's relative-colour
 *  `oklch(from X l c calc(h + deg))`, computed the same way. */
export function rotateHue(hex: string, deg: number): string {
  const lab = hexToLab(hex);
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const h = Math.atan2(lab.b, lab.a) + (deg * Math.PI) / 180;
  return labToHex({ L: lab.L, a: c * Math.cos(h), b: c * Math.sin(h) });
}

/** Mix two opaque colours in OKLab, `p` being the first colour's share (0..1). */
export function mixOklab(a: string, b: string, p: number): string {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return labToHex({ L: la.L * p + lb.L * (1 - p), a: la.a * p + lb.a * (1 - p), b: la.b * p + lb.b * (1 - p) });
}

/** A resolved colour: an opaque hex, or a hex with alpha (a scrim). */
export interface Rgba { hex: string; alpha: number }

/** Source-over compositing of `top` (with alpha) on an opaque `ground`, in sRGB as browsers do. */
export function over(top: Rgba, ground: string): string {
  const t = parseInt(top.hex.slice(1), 16);
  const g = parseInt(ground.slice(1), 16);
  const ch = (shift: number): number => {
    const tv = (t >> shift) & 255;
    const gv = (g >> shift) & 255;
    return Math.round(tv * top.alpha + gv * (1 - top.alpha));
  };
  const to = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${to(ch(16))}${to(ch(8))}${to(ch(0))}`;
}
