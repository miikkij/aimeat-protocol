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
 * @structure the colour arithmetic re-exported from atelier-color.ts · evalColor/gradientStops/mix
 *   scans · parseThemes/parseAtelier · loadAtelierSheets() (cached) · runMatrix(overrides?, opts?)
 *   → Result[]
 * @usage
 *   import { runMatrix } from './atelier-contrast.js';
 *   const failures = runMatrix({ '--ak-accent': '#b3261e' }).filter((r) => !r.ok);
 *   runMatrix(undefined, { presets: ['riso'], effect: { id: 'duotone', params: { strength: 0.8 } } });
 * @version-history
 *   v1.6.0 — 2026-09-05 — AK-SOLID: the accent as a FLAT FILL under its own ink, which nothing
 *     had ever proven. AK-GRAD proves the brand gradient and every look darkens its stops toward
 *     the ink, so the primary action read; the tab, the chip, the avatar, the compare handle and
 *     the price badge paint `background: var(--ak-accent)` raw, and the 2026-09-05 measuring
 *     review found white on the house coral at 3.58:1 across ten components. The new check fails
 *     on the pre-fix contract in all nineteen looks on aimeat/light and nowhere else. The
 *     evaluator's oklch grammar gains the second form the contract now uses,
 *     `oklch(from <colour> min(l, N) c h)` — the lightness cap the light accent carries.
 *   v1.5.0 — 2026-09-05 — AK-FX: a post-process EFFECT is proven on the grounds the rest of the
 *     matrix resolves (wish-atelier-post-process-effects, stage 2). `opts.effect` names one of
 *     the registry's effects and its parameters (clamped as the kit clamps them): a colour effect
 *     (duotone, recolour) maps page, card, ink, dimmed ink and accent text through the same
 *     transform the browser applies and holds the mapped pairs to 4.5:1, because a filter
 *     transforms ground and words together and a hue turn in sRGB does not keep luminance; an
 *     overlay effect (vignette, scanlines) composites ink at its strength over the page and the
 *     card and holds body ink to 4.5:1 at the darkest point; an effect with no proof records
 *     that it ran. An unknown effect refuses naming the nine.
 *   v1.4.0 — 2026-09-05 — The colour arithmetic (lum, ratio, OKLab both ways, rotateHue, mixOklab,
 *     Rgba, over) moved whole to atelier-color.ts and is re-exported from here: a pure move under
 *     the 800-line cap before the effects round adds the CSS filter transforms and the AK-FX
 *     branch (wish-atelier-post-process-effects, stage 1). Nothing else changed.
 *   v1.3.0 — 2026-09-05 — AK-AMBIENT: the ambient LAYER is proven (wish-atelier-ambient-visuals).
 *     REQUIRED_BASE grows by --ak-ambient, --ak-ambient-alpha and --ak-ambient-speed; a look
 *     (or a signature override) that names a preset is held to the registry's numbers: a field
 *     preset's pigments composited over the page at peak × alpha must keep body ink and accent
 *     text readable, and on a look standing on the palette page the field is held to the same
 *     whisper AK-PAGE holds the still ground; a sparse preset carries no ground check. An
 *     unknown preset and an alpha outside the bounds refuse with words.
 *   v1.2.0 — 2026-09-02 — REQUIRED_BASE grows by the spring hand (--ak-spring-stiffness,
 *     --ak-spring-damping, --ak-spring-mass), so every look must resolve the physics its
 *     motion rides and the matrix says which one does not.
 *   v1.1.0 — 2026-09-01 — REQUIRED_BASE grows by the broadcast family's five tokens
 *     (--ak-crt-ch1..4, --ak-crt-set), declared in the contract for the broadcast look.
 *   v1.0.0 — 2026-08-28 — Extracted from tools/atelier-check.ts (TARGET-074: colour reaches the
 *     signature). The checks and thresholds are byte-for-byte the tool's; new here are only
 *     loadAtelierSheets' cache and runMatrix's `overrides` parameter.
 *   v1.1.0 — 2026-08-29 — AK-PAT: the pattern volumes are proven per combo — body ink on the
 *     ground weave and on the prop weave (the .ak-pat--ground/--prop c1 formulas, modelled
 *     verbatim). The zone volume carries no text by rule, so it carries no floor.
 */
import { readFileSync } from 'node:fs';
import { AMBIENT_BOUNDS, AMBIENT_IDS, AMBIENT_NONE, ambientById } from '../data/atelier-ambients.js';
import { EFFECT_IDS, EFFECT_TOKEN_VARS, effectById, resolveParams } from '../data/atelier-effects.js';
// The colour arithmetic (WCAG luminance and ratio, OKLab, the hue rotation, source-over) lives
// in atelier-color.ts since 2026-09-05, a pure move under the 800-line cap; it is re-exported
// here so every importer keeps the address it had. The CSS filter transforms beside it are
// what AK-FX runs.
import {
  lum, ratio, rotateHue, capLightness, mixOklab, over, type Rgba,
  hueRotateSrgb, saturateSrgb, duotoneSrgb,
} from './atelier-color.js';
export { lum, ratio, rotateHue, capLightness, mixOklab, over, type Rgba };

// ── The tiny CSS colour-expression evaluator ─────────────────────────────────────────────────
// Grammar (and the contract confines itself to it): #hex · transparent · var(--name[, fallback])
// · color-mix(in oklab, <expr> [N%], <expr>|transparent [N%]) · rgba(r,g,b,a) ·
// oklch(from <expr> l c calc(h ± N)) · oklch(from <expr> min(l, N) c h). Anything else is a
// refusal naming the token.

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
      // Relative colour syntax, the two forms the contract uses:
      //   oklch(from <expr> l c calc(h ± N))       a HUE ROTATION that keeps lightness and
      //     chroma, which is what makes a derived spectrum arithmetically safe: every contrast
      //     ratio depends on L, and L does not move.
      //   oklch(from <expr> min(l, N) c h)         a LIGHTNESS CAP that keeps chroma and hue —
      //     the light contract's floor under white-on-accent. It moves L only downward and only
      //     when the source is above N, so a palette that already reads is untouched.
      const m = /^from\s+(.+?)\s+(?:l|min\(\s*l\s*,\s*(\d*\.?\d+)\s*\))\s+c\s+(?:calc\(\s*h\s*([+-])\s*(\d+(?:\.\d+)?)(?:deg)?\s*\)|h)$/is.exec(body.trim());
      if (!m) throw new Error(`${trail}: oklch() is supported only as "oklch(from <colour> l c calc(h ± N))" or "oklch(from <colour> min(l, N) c h)"`);
      const base = evalColor(m[1]!, vars, trail);
      const capped = m[2] !== undefined ? capLightness(base.hex, Number(m[2])) : base.hex;
      const delta = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
      return { hex: rotateHue(capped, delta), alpha: base.alpha };
    }
  }
  throw new Error(`${trail}: cannot evaluate colour "${s.slice(0, 60)}" — the contract confines itself to hex, var(), color-mix(in oklab), oklch(from … calc(h ± N)), oklch(from … min(l, N) c h) and gradients over those`);
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
/** A SPARSE ambient (motes, lines) is bounded by its registry peak rather than proven as a
 *  ground; this is the ceiling that peak may reach (test/unit/atelier-ambients.test.ts). */
export const AMBIENT_SPARSE_CAP = 0.6;
/** The GROUND TOKENS a world-look may claim with literal values — the one licence to bring a
 *  colour of its own (paper, phosphor, night), because every check in this matrix then runs
 *  against exactly those values in both modes. Anything else stays var()/color-mix only. */
export const GROUND_TOKENS = [
  '--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-ink', '--ak-ink-dim', '--ak-line',
  // The tone trio joined when the ops family arrived: a world that owns its ground must be
  // able to own its ok/warn/err too — the theme's light-mode tones vanish on a forced-dark
  // world, and AK-TONE below now proves whichever values stand.
  '--ak-ok', '--ak-warn', '--ak-err',
] as const;

/** Tokens the base contract must declare — a look can never inherit half its identity. */
export const REQUIRED_BASE = [
  '--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-surface-image', '--ak-ink', '--ak-ink-dim',
  '--ak-line', '--ak-line-w', '--ak-accent', '--ak-accent-2', '--ak-spectrum-2', '--ak-spectrum-3',
  '--ak-page-image', '--ak-glass', '--ak-blur', '--ak-grain', '--ak-accent-ink', '--ak-accent-text',
  '--ak-hero-ink', '--ak-hero-ink-dim',
  '--ak-ok', '--ak-warn', '--ak-err', '--ak-ok-text', '--ak-warn-text', '--ak-err-text',
  '--ak-focus', '--ak-grad', '--ak-scrim', '--ak-hero-image',
  '--ak-radius', '--ak-radius-sm', '--ak-radius-pill', '--ak-elev-1', '--ak-elev-2',
  '--ak-font', '--ak-font-display', '--ak-font-mono',
  '--ak-text-hero', '--ak-text-title', '--ak-text-body', '--ak-text-fine', '--ak-weight-display',
  '--ak-display-shadow', '--ak-display-stroke', '--ak-tilt', '--ak-kinetic', '--ak-page-grain',
  '--ak-gap', '--ak-pad', '--ak-touch', '--ak-motion', '--ak-ease',
  '--ak-enter-distance', '--ak-enter-stagger', '--ak-chrome-bottom', '--ak-main-max', '--ak-hero-min',
  // The spring hand (2026-09-02): the physics the kit's spring, drag and staggered entrance
  // sample, read off the element. Contract tokens so every look declares its own feel and this
  // matrix proves each one resolves. Mode-independent, so REQUIRED_DARK leaves them alone.
  '--ak-spring-stiffness', '--ak-spring-damping', '--ak-spring-mass',
  // The ambient layer (2026-09-05): the preset a look runs at idle, how much of it shows and how
  // fast it moves. Contract tokens so every look declares its own and AK-AMBIENT proves it.
  '--ak-ambient', '--ak-ambient-alpha', '--ak-ambient-speed',
  // The broadcast family's channel colours and the set's ground (2026-09-01): contract tokens
  // so a look may retune the CRT, the countdown and the crawl under this matrix's proof.
  '--ak-crt-ch1', '--ak-crt-ch2', '--ak-crt-ch3', '--ak-crt-ch4', '--ak-crt-set',
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
  opts?: {
    presets?: readonly string[];
    /** A post-process effect to prove on every combination, with its parameters (missing ones
     *  take the registry's defaults, and every number is clamped as the kit clamps it). */
    effect?: { id: string; params?: Record<string, unknown> | null };
  },
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

        // AK-SOLID: the accent as a FLAT FILL under its own ink. AK-GRAD below has always proven
        // the gradient, and every look darkens its gradient stops toward the ink, so the action
        // that wears --ak-grad was safe — while the tab, the chip, the avatar, the price badge
        // and the handle paint `background: var(--ak-accent)` raw and were proven by nothing.
        // The 2026-09-05 measuring review read 3.58:1 there on the house palette, on ten
        // separate components. Body size, no large-text discount: a tab label is 13px.
        add(combo, 'AK-SOLID action ink on the flat accent', ratio(accentInk, colorOf('--ak-accent')), MIN_TEXT, 'text on a component filled with the raw accent (tab, chip, avatar, badge)');

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

        // A world that owns its ground may light it as it pleases — the ink checks still prove
        // every stop readable. The whisper cap guards only the looks that stand on the palette's
        // own page; AK-PAGE and AK-AMBIENT below both read it.
        const ownsGround = preset !== 'vivid' && sheet.presets.get(preset)!.decls.has('--ak-bg');

        // AK-PAGE: the STILL page ground (--ak-page-image; the moving layer is AK-AMBIENT below).
        // Body ink must read on every stop, and the pigment is capped at the SURFACE budget —
        // the page whispers, the hero speaks.
        const pageRaw = vars.get('--ak-page-image') ?? 'none';
        if (pageRaw !== 'none') {
          for (const s of gradientStops(pageRaw, vars, `${combo} --ak-page-image`)) {
            add(combo, 'AK-PAGE ink on ambient ground', ratio(ink, s.alpha === 1 ? s.hex : over(s, bg)), MIN_TEXT, 'body text on the ambient page ground');
          }
          if (!ownsGround) {
            for (const p of groundMixPercents(pageRaw, '--ak-bg')) {
              if (p <= SURFACE_TINT_CAP) passR(combo, 'AK-PAGE ambient %');
              else failR(combo, 'AK-PAGE ambient %', `the page ambient above ${SURFACE_TINT_CAP}% stops being a whisper (uses ${p}%)`);
            }
          }
        }

        // AK-AMBIENT: the ambient LAYER — the one thing the kit lets move at idle (the registry
        // in data/atelier-ambients.ts). A FIELD preset lays pigment under the words: every token
        // it paints is composited over the page at its peak × the alpha the look (or the
        // signature) set, and body ink must still read on that. At the whisper (the AK-PAGE cap)
        // the layer is the same class of ground as the still page wash and carries the same
        // proof; LOUDER than the whisper it is a new ground, so accent-coloured text is proven
        // on it too — and only a world that owns its ground may run it that loud, exactly as
        // AK-PAGE holds a palette-page look to the whisper. A SPARSE preset (motes, lines) is
        // not a ground a word sits on: its peak is bounded in the registry (the unit test) and
        // its alpha here, so it only records that it ran.
        const ambientRaw = (vars.get('--ak-ambient') ?? AMBIENT_NONE).trim();
        if (ambientRaw !== AMBIENT_NONE) {
          const ambient = ambientById(ambientRaw);
          const alphaRaw = (vars.get('--ak-ambient-alpha') ?? '1').trim();
          const alpha = Number(alphaRaw);
          if (!ambient) {
            failR(combo, 'AK-AMBIENT preset', `"${ambientRaw}" is not an ambient the kit ships — one of ${AMBIENT_IDS.join(', ')}, or none`);
          } else if (!Number.isFinite(alpha) || alpha < AMBIENT_BOUNDS.alpha[0] || alpha > AMBIENT_BOUNDS.alpha[1]) {
            failR(combo, 'AK-AMBIENT alpha', `--ak-ambient-alpha is how much of the layer shows through: a number from ${AMBIENT_BOUNDS.alpha[0]} to ${AMBIENT_BOUNDS.alpha[1]} (got "${alphaRaw}")`);
          } else if (ambient.proof === 'sparse') {
            passR(combo, `AK-AMBIENT ${ambient.id} sparse`);
          } else {
            const strength = ambient.peak * alpha;
            const pct = strength * 100;
            const loud = pct > SURFACE_TINT_CAP + EPS;
            for (const token of ambient.pigments) {
              const pigment = colorOf(token);
              const ground = ambient.blend === 'mix' ? mixOklab(pigment, bg, strength) : over({ hex: pigment, alpha: strength }, bg);
              add(combo, `AK-AMBIENT ink over ${ambient.id} (${token})`, ratio(ink, ground), MIN_TEXT, `body text over the ${ambient.id} layer at its strongest`);
              if (loud) add(combo, `AK-AMBIENT accent-as-text over ${ambient.id} (${token})`, ratio(accentText, ground), MIN_TEXT, `accent-coloured text over the ${ambient.id} layer, which runs louder than a whisper`);
            }
            if (ownsGround || !loud) passR(combo, `AK-AMBIENT ${ambient.id} %`);
            else failR(combo, `AK-AMBIENT ${ambient.id} %`, `the ${ambient.id} layer above ${SURFACE_TINT_CAP}% stops being a whisper on a look that stands on the palette's page (peak ${ambient.peak} × alpha ${alpha} = ${+pct.toFixed(1)}%) — lower --ak-ambient-alpha, or give the look its own ground`);
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

        // AK-PAT: the pattern volumes (patterns.css). A ground-volume pattern carries a whole
        // page, so body ink must read on its darker weave; a prop-volume pattern carries chip
        // labels, so ink must read on its accent weave. The zone volume carries no text by rule
        // (words sit in solid chips, proven by AK-TINT), so it needs no floor here. These two
        // expressions ARE the .ak-pat--ground / .ak-pat--prop formulas — change them together.
        const patGround = evalColor('color-mix(in oklab, var(--ak-ink) 6%, var(--ak-bg))', vars, `${combo} ak-pat--ground c1`);
        add(combo, 'AK-PAT ink on ground weave', ratio(ink, patGround.hex), MIN_TEXT, 'body text on a whisper-volume pattern page');
        const patProp = evalColor('color-mix(in oklab, var(--ak-accent) 22%, var(--ak-surface))', vars, `${combo} ak-pat--prop c1`);
        add(combo, 'AK-PAT ink on prop weave', ratio(ink, patProp.hex), MIN_TEXT, 'a chip label on a card-strength pattern fill');

        // AK-TONE: the ops family speaks in ok/warn/err. The RAW tones stay fills (lamps,
        // pill grounds) and carry no text floor; what a person READS is the ink-anchored
        // *-text derivation — console lines on the vane's ground (surface-2), gauge readings
        // on the card — and those are proven for every combination, worlds included.
        for (const tone of ['ok', 'warn', 'err']) {
          const raw = vars.get(`--ak-${tone}-text`);
          if (raw === undefined) continue; // pre-toned sheets; REQUIRED_BASE keeps the base honest
          const c = evalColor(raw, vars, `${combo} --ak-${tone}-text`);
          const hex = c.alpha === 1 ? c.hex : over(c, surface);
          add(combo, `AK-TONE ${tone} text on card`, ratio(hex, surface), MIN_TEXT, 'a tone-coloured reading on a card');
          add(combo, `AK-TONE ${tone} text on vane`, ratio(hex, surface2), MIN_TEXT, 'a tone-coloured log line on the console ground');
        }

        // AK-FX: a post-process effect is proven on the SAME resolved grounds every check above
        // stands on — the effect is the last thing the eye sees, after the whole cascade. A
        // colour effect maps ground and words together, so the mapped PAIR must keep the floor
        // (a hue turn in sRGB does not keep luminance); an overlay effect lays ink over the
        // ground, so body ink must read at the darkest point. An effect with no proof records
        // that it ran: the volume rule the validator enforces is its whole guarantee.
        if (opts?.effect) {
          const fx = effectById(opts.effect.id);
          if (!fx) {
            failR(combo, 'AK-FX effect', `"${opts.effect.id}" is not an effect the kit ships — one of ${EFFECT_IDS.join(', ')}`);
          } else if (fx.proof === 'colour') {
            const p = resolveParams(fx, opts.effect.params);
            const map = fx.id === 'duotone'
              ? (hex: string): string => duotoneSrgb(hex, colorOf(EFFECT_TOKEN_VARS[String(p.shadow)]!), colorOf(EFFECT_TOKEN_VARS[String(p.light)]!), Number(p.strength))
              : (hex: string): string => saturateSrgb(hueRotateSrgb(hex, Number(p.hue)), Number(p.saturate));
            add(combo, `AK-FX ${fx.id} ink on mapped page`, ratio(map(ink), map(bg)), MIN_TEXT, `body text and the page, both seen through the ${fx.id} effect`);
            add(combo, `AK-FX ${fx.id} ink on mapped card`, ratio(map(ink), map(surface)), MIN_TEXT, `body text and a card, both seen through the ${fx.id} effect`);
            add(combo, `AK-FX ${fx.id} dimmed ink on mapped card`, ratio(map(inkDim), map(surface)), MIN_TEXT, `secondary text and a card, both seen through the ${fx.id} effect`);
            add(combo, `AK-FX ${fx.id} accent-as-text on mapped card`, ratio(map(accentText), map(surface)), MIN_TEXT, `accent-coloured text and a card, both seen through the ${fx.id} effect`);
          } else if (fx.proof === 'overlay') {
            const p = resolveParams(fx, opts.effect.params);
            const veil: Rgba = { hex: ink, alpha: Number(p.strength) };
            add(combo, `AK-FX ${fx.id} ink at the darkest point on page`, ratio(ink, over(veil, bg)), MIN_TEXT, `body text where the ${fx.id} overlay is darkest on the page`);
            add(combo, `AK-FX ${fx.id} ink at the darkest point on card`, ratio(ink, over(veil, surface)), MIN_TEXT, `body text where the ${fx.id} overlay is darkest on a card`);
          } else {
            passR(combo, `AK-FX ${fx.id} ${fx.volume.join('/')}`);
          }
        }
      } catch (e) {
        failR(combo, 'resolve', (e as Error).message);
      }
    }
  }
  return results;
}
