/**
 * @file src/services/atelier-contrast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier contrast arithmetic, extracted whole from tools/atelier-check.ts so
 *   the SERVER can run the same matrix the pre-commit gate runs (pure move — the colour math,
 *   the CSS colour-expression evaluator, the sheet parsers and the per-combination checks are
 *   the tool's own lines in a new home; the tool now imports from here and keeps only its drift
 *   gate and report).
 *
 *   WHY THE SERVER NEEDS IT: the signature lets a stored layout override tokens per app, and a
 *   COLOUR override is only omalaatuinen-but-readable when the arithmetic has proven it. With
 *   this module the validator runs EVERY preset × palette × mode with the override layered
 *   last — the same 4.5:1 floors, the same OKLab mixing the browser does — and refuses with the
 *   failing pair's numbers instead of refusing colour wholesale.
 *
 *   The stylesheets are read from the node's own public/lib files once and cached: the server
 *   trusts what it ships (the drift gate that proves looks.css matches the registry stays in the
 *   tool, where the build lives).
 * @structure lum/ratio (WCAG) · OKLab convert/mix/rotate · evalColor/gradientStops/mix scans ·
 *   parseThemes/parseAtelier · loadAtelierSheets() (cached) · runMatrix(overrides?) → Result[]
 * @usage
 *   import { runMatrix } from './atelier-contrast.js';
 *   const failures = runMatrix({ '--ak-accent': '#b3261e' }).filter((r) => !r.ok);
 * @version-history
 *   v1.0.0 — 2026-08-28 — Extracted from tools/atelier-check.ts (TARGET-074: colour reaches the
 *     signature). The checks and thresholds are byte-for-byte the tool's; new here are only
 *     loadAtelierSheets' cache and runMatrix's `overrides` parameter.
 */
import { readFileSync } from 'node:fs';

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

// ── The tiny CSS colour-expression evaluator ─────────────────────────────────────────────────
// Grammar (and the contract confines itself to it): #hex · transparent · var(--name[, fallback])
// · color-mix(in oklab, <expr> [N%], <expr>|transparent [N%]) · rgba(r,g,b,a) ·
// oklch(from <expr> l c calc(h ± N)). Anything else is a refusal naming the token.

/** Split a comma-separated argument list at the TOP level (parens stay balanced). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

export type Vars = Map<string, string>;

export function expandHex(raw: string): string {
  const h = raw.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  throw new Error(`unsupported hex "${raw}"`);
}

/**
 * Resolve one colour expression to an Rgba. `vars` maps every custom property (theme + atelier,
 * already layered for the combination under test) to its raw value string.
 */
export function evalColor(expr: string, vars: Vars, trail: string): Rgba {
  const s = expr.trim();
  if (s.startsWith('#')) return { hex: expandHex(s), alpha: 1 };
  if (/^transparent$/i.test(s)) return { hex: '#000000', alpha: 0 };
  const fn = /^([a-z-]+)\((.*)\)$/is.exec(s);
  if (fn) {
    const name = fn[1]!.toLowerCase();
    const body = fn[2]!;
    if (name === 'var') {
      const args = splitArgs(body);
      const ref = args[0]!.trim();
      const known = vars.get(ref);
      if (known !== undefined) return evalColor(known, vars, `${trail} → ${ref}`);
      if (args.length > 1) return evalColor(args.slice(1).join(','), vars, `${trail} → ${ref}(fallback)`);
      throw new Error(`${trail}: ${ref} is not resolvable and has no fallback`);
    }
    if (name === 'color-mix') {
      const args = splitArgs(body);
      if (!/^in\s+oklab$/i.test(args[0] ?? '')) throw new Error(`${trail}: color-mix must be "in oklab"`);
      const parse = (arg: string): { c: Rgba; p: number | null } => {
        const pm = /^(.*?)\s+(\d+(?:\.\d+)?)%$/s.exec(arg.trim());
        if (pm) return { c: evalColor(pm[1]!, vars, trail), p: Number(pm[2]) / 100 };
        return { c: evalColor(arg, vars, trail), p: null };
      };
      const first = parse(args[1]!);
      const second = parse(args[2]!);
      const p1 = first.p ?? (second.p !== null ? 1 - second.p : 0.5);
      if (first.c.alpha === 0) return { hex: second.c.hex, alpha: (1 - p1) * second.c.alpha };
      if (second.c.alpha === 0) return { hex: first.c.hex, alpha: p1 * first.c.alpha };
      return { hex: mixOklab(first.c.hex, second.c.hex, p1), alpha: 1 };
    }
    if (name === 'rgba' || name === 'rgb') {
      const parts = splitArgs(body).map((v) => Number(v));
      const to = (v: number): string => Math.round(v).toString(16).padStart(2, '0');
      return { hex: `#${to(parts[0]!)}${to(parts[1]!)}${to(parts[2]!)}`, alpha: parts[3] ?? 1 };
    }
    if (name === 'oklch') {
      // Relative colour syntax, the one form the contract uses: oklch(from <expr> l c calc(h ± N))
      // — a HUE ROTATION that keeps lightness and chroma, which is what makes a derived spectrum
      // arithmetically safe: every contrast ratio depends on L, and L does not move.
      const m = /^from\s+(.+?)\s+l\s+c\s+(?:calc\(\s*h\s*([+-])\s*(\d+(?:\.\d+)?)(?:deg)?\s*\)|h)$/is.exec(body.trim());
      if (!m) throw new Error(`${trail}: oklch() is supported only as "oklch(from <colour> l c calc(h ± N))"`);
      const base = evalColor(m[1]!, vars, trail);
      const delta = m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
      return { hex: rotateHue(base.hex, delta), alpha: base.alpha };
    }
  }
  throw new Error(`${trail}: cannot evaluate colour "${s.slice(0, 60)}" — the contract confines itself to hex, var(), color-mix(in oklab), oklch(from … calc(h ± N)) and gradients over those`);
}

/** Pull the colour stops out of a linear/radial gradient value (positions and angles skipped).
 *  A SCANNER, not a regex — a stop may be a color-mix whose first argument is itself a color-mix
 *  over var()s, which is three levels of nesting and past what a bounded regex balances. */
export function gradientStops(expr: string, vars: Vars, trail: string): Rgba[] {
  const stops: Rgba[] = [];
  const heads = /(?:linear|radial)-gradient\(/g;
  let m: RegExpExecArray | null;
  while ((m = heads.exec(expr)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(`${trail}: unbalanced parentheses in gradient value`);
    for (const arg of splitArgs(expr.slice(open + 1, end))) {
      if (/^(?:-?\d+(?:\.\d+)?deg|at\s)/i.test(arg)) continue;
      const colorPart = arg.replace(/\s+\d+(?:\.\d+)?%\s*$/, '').trim();
      if (/^transparent$/i.test(colorPart)) continue;
      stops.push(evalColor(colorPart, vars, trail));
    }
    heads.lastIndex = end + 1;
  }
  return stops;
}

/** Record every color-mix percentage that mixes something INTO a base, for the budget check. */
export function mixPercents(expr: string): number[] {
  const out: number[] = [];
  for (const m of expr.matchAll(/color-mix\(in oklab,\s*[^,]*?\s(\d+(?:\.\d+)?)%\s*,/g)) out.push(Number(m[1]));
  return out;
}

/**
 * The mesh budget's own scan: only the percentages mixed OVER THE PAGE GROUND count as pigment.
 * A nested hue blend between two accents is vocabulary, not coverage — what the cap bounds is
 * how much of ANY colour lands on the bg. Balanced scan, since the first argument may itself be
 * a color-mix.
 */
export function groundMixPercents(expr: string, groundVar: string): number[] {
  const out: number[] = [];
  let at = expr.indexOf('color-mix(');
  while (at !== -1) {
    let depth = 0;
    let end = at;
    for (let i = at; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const inner = expr.slice(at + 'color-mix('.length, end);
    // Split the top level: "in oklab, <colour1> N%, <colour2>".
    const parts: string[] = [];
    let d = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') d++;
      else if (inner[i] === ')') d--;
      else if (inner[i] === ',' && d === 0) { parts.push(inner.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(inner.slice(start).trim());
    if (parts.length === 3 && parts[2] === `var(${groundVar})`) {
      const pct = parts[1]!.match(/\s(\d+(?:\.\d+)?)%$/);
      if (pct) out.push(Number(pct[1]));
    }
    at = expr.indexOf('color-mix(', at + 1);
  }
  return out;
}

// ── Parse the two stylesheets ────────────────────────────────────────────────────────────────

export function parseDecls(body: string): Map<string, string> {
  // A scanner, not a regex: gradient values nest parentheses three deep (gradient → color-mix →
  // var), which is past what a bounded regex can balance. Comments are stripped first so a
  // semicolon inside one cannot split a declaration.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  let depth = 0;
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      const stmt = clean.slice(start, i);
      const colon = stmt.indexOf(':');
      if (colon > 0) {
        const name = stmt.slice(0, colon).trim();
        if (name.startsWith('--')) out.set(name, stmt.slice(colon + 1).replace(/\s+/g, ' ').trim());
      }
      start = i + 1;
    }
  }
  return out;
}

/** Every `@theme-block <palette> <mode>` from aimeat-theme.css → its custom-property map. */
export function parseThemes(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const marker = /\/\*\s*@theme-block\s+([a-z0-9-]+)\s+(light|dark)\s*\*\//g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(css))) {
    const open = css.indexOf('{', marker.lastIndex);
    const close = css.indexOf('\n}', open);
    if (open < 0 || close < 0) throw new Error(`unterminated @theme-block ${m[1]} ${m[2]}`);
    out.set(`${m[1]}/${m[2]}`, parseDecls(css.slice(open + 1, close)));
  }
  if (!out.size) throw new Error('no @theme-block markers in aimeat-theme.css — the files have drifted');
  return out;
}

export interface AtelierSheet {
  base: Map<string, string>;
  dark: Map<string, string>;
  presets: Map<string, { decls: Map<string, string>; raw: string }>;
}

/** The base contract, the dark re-declaration, and every `@preset-block` from aimeat-atelier.css. */
export function parseAtelier(css: string): AtelierSheet {
  const blockAfter = (index: number): { body: string } => {
    const open = css.indexOf('{', index);
    const close = css.indexOf('\n}', open);
    if (open < 0 || close < 0) throw new Error('unterminated block in aimeat-atelier.css');
    return { body: css.slice(open + 1, close) };
  };
  const presets = new Map<string, { decls: Map<string, string>; raw: string }>();
  const marker = /\/\*\s*@preset-block\s+([a-z0-9@-]+)\b[^*]*\*\//g;
  let m: RegExpExecArray | null;
  let base: Map<string, string> | null = null;
  let dark: Map<string, string> | null = null;
  while ((m = marker.exec(css))) {
    const { body } = blockAfter(marker.lastIndex);
    if (m[1] === 'vivid') base = parseDecls(body);
    else if (m[1] === 'vivid-dark') dark = parseDecls(body);
    else presets.set(m[1]!, { decls: parseDecls(body), raw: body });
  }
  if (!base) throw new Error('no @preset-block vivid marker on the base contract');
  if (!dark) throw new Error('no @preset-block vivid-dark marker on the dark re-declaration');
  return { base, dark, presets };
}

// ── The matrix ───────────────────────────────────────────────────────────────────────────────

export const MIN_TEXT = 4.5;
export const MIN_STEP = 1.10;
export const MIN_EDGE_VS_CARD = 1.30;
export const MIN_EDGE_VS_PAGE = 1.15;
/** A card tint may mix at most this much of anything into the surface. */
export const SURFACE_TINT_CAP = 8;
/** The hero mesh budget is wider: text never sits on raw mesh (AK-SCRIM covers text). An
 *  aesthetic bound (a mesh, not a solid poster fill); the readability guarantee is AK-SCRIM. */
export const HERO_MESH_CAP = 36;
/** The GROUND TOKENS a world-look may claim with literal values — the one licence to bring a
 *  colour of its own (paper, phosphor, night), because every check in this matrix then runs
 *  against exactly those values in both modes. Anything else stays var()/color-mix only. */
export const GROUND_TOKENS = [
  '--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-ink', '--ak-ink-dim', '--ak-line',
] as const;

/** Tokens the base contract must declare — a look can never inherit half its identity. */
export const REQUIRED_BASE = [
  '--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-surface-image', '--ak-ink', '--ak-ink-dim',
  '--ak-line', '--ak-line-w', '--ak-accent', '--ak-accent-2', '--ak-spectrum-2', '--ak-spectrum-3',
  '--ak-page-image', '--ak-glass', '--ak-blur', '--ak-grain', '--ak-accent-ink', '--ak-accent-text',
  '--ak-hero-ink', '--ak-hero-ink-dim',
  '--ak-ok', '--ak-warn', '--ak-err', '--ak-focus', '--ak-grad', '--ak-scrim', '--ak-hero-image',
  '--ak-radius', '--ak-radius-sm', '--ak-radius-pill', '--ak-elev-1', '--ak-elev-2',
  '--ak-font', '--ak-font-display', '--ak-font-mono',
  '--ak-text-hero', '--ak-text-title', '--ak-text-body', '--ak-text-fine', '--ak-weight-display',
  '--ak-display-shadow', '--ak-display-stroke', '--ak-tilt', '--ak-kinetic', '--ak-page-grain',
  '--ak-gap', '--ak-pad', '--ak-touch', '--ak-motion', '--ak-ease',
  '--ak-enter-distance', '--ak-enter-stagger', '--ak-chrome-bottom', '--ak-main-max', '--ak-hero-min',
];
/** The dark block must re-declare at least the surfaces and inks it exists for. */
export const REQUIRED_DARK = ['--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-ink', '--ak-line', '--ak-scrim'];

export interface Result { combo: string; label: string; actual: number; min: number; ok: boolean; why: string }

export interface AtelierSheets {
  themes: Map<string, Map<string, string>>;
  sheet: AtelierSheet;
  presetNames: string[];
}

let sheetsCache: AtelierSheets | null = null;

/** The node's own shipped stylesheets, parsed once. The drift gate that proves looks.css matches
 *  the registry lives in the TOOL, beside the build — the server trusts what it ships. */
export function loadAtelierSheets(): AtelierSheets {
  if (sheetsCache) return sheetsCache;
  const themeCss = readFileSync(new URL('../../public/lib/aimeat-theme.css', import.meta.url), 'utf8');
  const looksCss = readFileSync(new URL('../../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');
  const atelierCss = readFileSync(new URL('../../public/lib/aimeat-atelier.css', import.meta.url), 'utf8') + '\n' + looksCss;
  const themes = parseThemes(themeCss);
  const sheet = parseAtelier(atelierCss);
  // A `name@dark` block is a WORLD's dark ground, layered under dark mode — never its own look.
  sheetsCache = {
    themes, sheet,
    presetNames: [...new Set(['vivid', ...[...sheet.presets.keys()].filter((n) => !n.endsWith('@dark'))])],
  };
  return sheetsCache;
}

/**
 * Run the full contrast matrix — every preset × palette × mode — optionally with token OVERRIDES
 * layered on top of everything (the signature's position in the cascade: an inline style on the
 * app frame wins over every stylesheet). Returns every check's result; the caller decides what a
 * failure means (the tool prints and exits, the validator refuses with the first numbers).
 */
export function runMatrix(
  overrides?: Record<string, string>,
  opts?: { presets?: readonly string[] },
): Result[] {
  const { themes, sheet, presetNames: allPresets } = loadAtelierSheets();
  // A signature is proven WHERE IT LIVES: an accent pair chosen for one look validates against
  // that look, not against every world in the registry — otherwise each new world (paper,
  // phosphor, night) would shrink the legal accent space for apps that never wear it.
  const presetNames = opts?.presets?.length
    ? allPresets.filter((p) => opts.presets!.includes(p))
    : allPresets;
  const results: Result[] = [];
  // Two floor classes, and only under an OVERRIDE do they differ. The 4.5:1 floors are WCAG
  // readability and never move (beyond float noise). The 1.10/1.30 step-and-edge floors are the
  // HOUSE'S aesthetic tuning, and the shipped sheet passes them by hair-thin margins tuned to
  // the shipped accents — so any brand hue at all would fail them by 0.001-0.008 and the colour
  // signature would be a dead letter. Under an override they carry a small tolerance: a real
  // collapse (an invisible card edge) still refuses, a hair off the house's own taste does not.
  const EPS = 1e-6;
  const aestheticSlack = overrides ? 0.05 : 0;
  const add = (combo: string, label: string, actual: number, min: number, why: string): void => {
    const slack = min < MIN_TEXT ? aestheticSlack : 0;
    results.push({ combo, label, actual, min, ok: actual >= min - slack - EPS, why });
  };
  const failR = (combo: string, label: string, why: string): void => {
    results.push({ combo, label, actual: 0, min: 0, ok: false, why });
  };
  const passR = (combo: string, label: string): void => {
    results.push({ combo, label, actual: 1, min: 0, ok: true, why: '' });
  };

  // Completeness and purity are per-file facts, checked once (and unaffected by overrides).
  if (!overrides) {
    for (const token of REQUIRED_BASE) {
      if (!sheet.base.has(token)) failR('contract', `AK-COMPLETE ${token}`, 'missing from the base contract');
    }
    for (const token of REQUIRED_DARK) {
      if (!sheet.dark.has(token)) failR('contract', `AK-COMPLETE dark ${token}`, 'the dark block must re-declare it');
    }
    for (const [name, block] of sheet.presets) {
      for (const token of block.decls.keys()) {
        if (!REQUIRED_BASE.includes(token)) {
          failR(`preset ${name}`, `AK-COMPLETE ${token}`, 'sets a token the contract does not declare — add it to the contract first');
        }
      }
      // THE FREED PURITY RULE (2026-08-29, the developer's direction): a look may OWN ITS GROUND
      // — paper, phosphor, night — as literal values on the ground tokens, because every check
      // in this matrix then runs against them. What stays forbidden is an UNPROVEN colour: a
      // literal on any non-ground token still refuses, since nothing would prove it.
      let pure = true;
      for (const [token, value] of block.decls) {
        if (/#[0-9a-fA-F]{3,6}\b|rgba?\s*\(/.test(value) && !(GROUND_TOKENS as readonly string[]).includes(token)) {
          failR(`preset ${name}`, `AK-PURE ${token}`, 'a literal colour outside the ground tokens is unproven — use var()/color-mix, or move it to the look\'s grounds');
          pure = false;
        }
      }
      if (pure) passR(`preset ${name}`, 'AK-PURE');
    }
  }

  for (const preset of presetNames) {
    for (const [paletteMode, themeVars] of themes) {
      const combo = `${preset} × ${paletteMode}`;
      const mode = paletteMode.endsWith('/dark') ? 'dark' : 'light';

      // Layer the maps exactly as the cascade does: theme < base < dark (dark mode) < preset —
      // and the signature's overrides LAST, because an inline style on the frame wins them all.
      const vars: Vars = new Map(themeVars);
      for (const [k, v] of sheet.base) vars.set(k, v);
      if (mode === 'dark') for (const [k, v] of sheet.dark) vars.set(k, v);
      if (preset !== 'vivid') for (const [k, v] of sheet.presets.get(preset)!.decls) vars.set(k, v);
      // A world's dark ground layers over its look block in dark mode, exactly as the cascade
      // does — so every check below runs against the ground a person will actually see.
      if (mode === 'dark' && sheet.presets.has(`${preset}@dark`)) {
        for (const [k, v] of sheet.presets.get(`${preset}@dark`)!.decls) vars.set(k, v);
      }
      if (overrides) for (const [k, v] of Object.entries(overrides)) vars.set(k, v);

      const colorOf = (token: string): string => {
        const raw = vars.get(token);
        if (raw === undefined) throw new Error(`${combo}: ${token} is undeclared`);
        const c = evalColor(raw, vars, `${combo} ${token}`);
        if (c.alpha !== 1) throw new Error(`${combo}: ${token} resolved translucent where an opaque colour was expected`);
        return c.hex;
      };

      try {
        const bg = colorOf('--ak-bg');
        const surface = colorOf('--ak-surface');
        const surface2 = colorOf('--ak-surface-2');
        const ink = colorOf('--ak-ink');
        const inkDim = colorOf('--ak-ink-dim');
        const line = colorOf('--ak-line');
        const accentText = colorOf('--ak-accent-text');
        const accentInk = colorOf('--ak-accent-ink');
        const scrim = evalColor(vars.get('--ak-scrim')!, vars, `${combo} --ak-scrim`);

        // AK-TINT: every ground body text actually sits on.
        add(combo, 'AK-TINT ink on page', ratio(ink, bg), MIN_TEXT, 'body text on the page');
        add(combo, 'AK-TINT ink on card', ratio(ink, surface), MIN_TEXT, 'body text on a card');
        add(combo, 'AK-TINT ink on nested row', ratio(ink, surface2), MIN_TEXT, 'body text on a nested row');
        add(combo, 'AK-TINT dimmed ink on card', ratio(inkDim, surface), MIN_TEXT, 'secondary text on a card');
        add(combo, 'AK-TINT accent-as-text on card', ratio(accentText, surface), MIN_TEXT, 'accent-coloured text on a card');
        add(combo, 'AK-TINT accent-as-text on page', ratio(accentText, bg), MIN_TEXT, 'accent-coloured text on the page');

        const tintRaw = vars.get('--ak-surface-image')!;
        const tintStops = tintRaw === 'none' ? [] : gradientStops(tintRaw, vars, `${combo} --ak-surface-image`);
        let strongestTint = surface;
        let strongestDelta = 0;
        for (const stop of tintStops) {
          const ground = stop.alpha === 1 ? stop.hex : over(stop, surface);
          add(combo, 'AK-TINT ink on tint stop', ratio(ink, ground), MIN_TEXT, 'body text at the strongest point of a card tint');
          const delta = Math.abs(lum(ground) - lum(surface));
          if (delta >= strongestDelta) { strongestDelta = delta; strongestTint = ground; }
        }
        for (const p of mixPercents(tintRaw)) {
          if (p <= SURFACE_TINT_CAP) passR(combo, 'AK-CAP surface tint %');
          else failR(combo, 'AK-CAP surface tint %', `a card tint above ${SURFACE_TINT_CAP}% stops being a tint (uses ${p}%)`);
        }

        // AK-EDGE: the boundary survives the tint (both mechanisms, per theme-contrast's lesson).
        add(combo, 'AK-EDGE hairline vs tinted card', ratio(line, strongestTint), MIN_EDGE_VS_CARD, 'the card outline must stay visible on the tint');
        add(combo, 'AK-EDGE hairline vs page', ratio(line, bg), MIN_EDGE_VS_PAGE, 'the card outline must stay visible against the page');
        add(combo, 'AK-EDGE tinted card steps off page', ratio(strongestTint, bg), MIN_STEP, 'a tinted card must still read as raised');

        // AK-GRAD: the primary action's text on both stops (body-size text — no large-text discount).
        const gradStops = gradientStops(vars.get('--ak-grad')!, vars, `${combo} --ak-grad`);
        const gradGrounds = gradStops.length
          ? gradStops.map((s) => (s.alpha === 1 ? s.hex : over(s, surface)))
          : [colorOf('--ak-accent')];
        for (const ground of gradGrounds) {
          add(combo, 'AK-GRAD action ink on gradient stop', ratio(accentInk, ground), MIN_TEXT, 'primary-action text on the brand gradient');
        }

        // AK-SCRIM: the hero's OWN ink pair over the scrim over every ground the band can show.
        // The band's base is ALWAYS the brand gradient (shell.css paints var(--ak-grad) under the
        // mesh), so the grounds are the grad stops and every mesh stop COMPOSITED OVER each grad
        // stop — never the bare page, which the band never reveals. Modelling the page as a
        // ground was the conservatism that made a saturated banner unprovable; the hero-ink pair
        // (default: the page ink; inverse: the action ink) is what a look declares and this
        // proves.
        const heroInk = colorOf('--ak-hero-ink');
        const heroInkDim = colorOf('--ak-hero-ink-dim');
        const heroRaw = vars.get('--ak-hero-image')!;
        const meshStops = heroRaw === 'none' ? [] : gradientStops(heroRaw, vars, `${combo} --ak-hero-image`);
        const heroGrounds = [
          ...gradGrounds,
          ...meshStops.flatMap((s) => (s.alpha === 1 ? [s.hex] : gradGrounds.map((g) => over(s, g)))),
        ];
        for (const ground of heroGrounds) {
          add(combo, 'AK-SCRIM hero ink over scrim', ratio(heroInk, over(scrim, ground)), MIN_TEXT, 'hero title on the scrimmed band');
          add(combo, 'AK-SCRIM hero sub over scrim', ratio(heroInkDim, over(scrim, ground)), MIN_TEXT, 'hero subline on the scrimmed band');
        }
        // Only pigment laid over the page ground counts against the mesh budget — a nested hue
        // blend between two accents is vocabulary, not coverage (see groundMixPercents).
        for (const p of groundMixPercents(heroRaw, '--ak-bg')) {
          if (p <= HERO_MESH_CAP) passR(combo, 'AK-CAP hero mesh %');
          else failR(combo, 'AK-CAP hero mesh %', `the hero mesh above ${HERO_MESH_CAP}% stops being a wash (uses ${p}%)`);
        }

        // AK-PAGE: the ambient page ground. Body ink must read on every ambient stop, and the
        // ambient's pigment is capped at the SURFACE budget — the page whispers, the hero speaks.
        const pageRaw = vars.get('--ak-page-image') ?? 'none';
        if (pageRaw !== 'none') {
          for (const s of gradientStops(pageRaw, vars, `${combo} --ak-page-image`)) {
            add(combo, 'AK-PAGE ink on ambient ground', ratio(ink, s.alpha === 1 ? s.hex : over(s, bg)), MIN_TEXT, 'body text on the ambient page ground');
          }
          // A world that owns its ground may light it as it pleases — the ink-on-ambient check
          // above still proves every stop readable. The whisper cap guards only the looks that
          // stand on the palette's own page.
          const ownsGround = preset !== 'vivid' && sheet.presets.get(preset)!.decls.has('--ak-bg');
          if (!ownsGround) {
            for (const p of groundMixPercents(pageRaw, '--ak-bg')) {
              if (p <= SURFACE_TINT_CAP) passR(combo, 'AK-PAGE ambient %');
              else failR(combo, 'AK-PAGE ambient %', `the page ambient above ${SURFACE_TINT_CAP}% stops being a whisper (uses ${p}%)`);
            }
          }
        }

        // AK-GLASS: bar and bottom-nav text sits on the glass pane composited over the page —
        // the translucency is a look, never a licence to blur the words with the ground.
        const glassRaw = vars.get('--ak-glass') ?? 'none';
        if (glassRaw !== 'none') {
          const glass = evalColor(glassRaw, vars, `${combo} --ak-glass`);
          const glassGround = glass.alpha === 1 ? glass.hex : over(glass, bg);
          add(combo, 'AK-GLASS ink on chrome glass', ratio(ink, glassGround), MIN_TEXT, 'bar text on the glass pane over the page');
        }
      } catch (e) {
        failR(combo, 'resolve', (e as Error).message);
      }
    }
  }
  return results;
}
