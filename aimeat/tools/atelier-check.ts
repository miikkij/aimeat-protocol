/**
 * @file tools/atelier-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Verifies the Atelier look system (public/lib/aimeat-atelier.css) arithmetically:
 *   EVERY preset against EVERY palette in BOTH modes — 7 × 5 × 2 = 70 combinations today, and the
 *   full matrix always runs, because it is seconds for a program and was only ever unsustainable
 *   for a human. Human review is the diagonal; this tool is the floor under it (TARGET-074).
 *
 *   The rule that makes this possible: A PRESET NEVER INTRODUCES A COLOUR, IT INTRODUCES
 *   STRUCTURE. Every colour a preset sets must be an expression over the AIMEAT theme tokens
 *   (var chains, color-mix in oklab, gradients whose stops are such expressions). This tool
 *   ENFORCES that (a raw hex or rgb() inside a preset block fails AK-PURE), and that is what
 *   lets it resolve every combination to numbers instead of opinions.
 *
 *   Checks per (preset, palette, mode):
 *   - AK-TINT   — body ink on the page, the card, the nested row and every tinted-surface
 *                 gradient stop at 4.5:1; dimmed ink and accent-as-text at 4.5:1 on the card.
 *   - AK-SCRIM  — ink over the scrim composited over EVERY ground the hero can show (each brand
 *                 gradient stop and each gradient-mesh stop over the page) at 4.5:1.
 *   - AK-GRAD   — the primary action's ink against both stops of the brand gradient at 4.5:1
 *                 (button text is body-size, so the large-text discount does not apply).
 *   - AK-EDGE   — the card boundary survives the tint: hairline vs the strongest tint stop, and
 *                 the tinted card still steps off the page (theme-contrast's lesson: both
 *                 mechanisms, or invisible cards ship).
 *   - AK-CAP    — the tint budget: a surface tint mixes at most SURFACE_TINT_CAP% of anything
 *                 into the surface; the hero mesh at most HERO_MESH_CAP% (text never sits on raw
 *                 mesh — AK-SCRIM covers that — so its budget is wider).
 *   - AK-PURE   — no raw colour literals inside any preset block.
 *   - AK-COMPLETE — the base contract declares the full token set; dark re-declares the surface
 *                 set; a preset block only sets tokens the contract knows.
 *
 *   Semantic state colours (--ak-ok/warn/err) are inherited theme pairs already verified by
 *   check:theme and are used here only as fills and borders, so they carry no extra text check.
 * @structure lum/ratio (WCAG, as in theme-contrast.ts) · OKLab convert/mix · a small CSS colour
 *   expression evaluator (hex · var() · color-mix() · gradients) · parseThemes (@theme-block) ·
 *   parseAtelier (@preset-block + the contract blocks) · the AK checks · report
 * @usage cd aimeat && pnpm exec tsx tools/atelier-check.ts     (or: pnpm check:atelier)
 *   Exits non-zero on any failure, so it gates CI and the pre-commit hook.
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial: the 70-combination matrix (TARGET-074 phase 1, slice 2).
 */
import { readFileSync } from 'node:fs';

// ── WCAG 2.1, exactly as tools/theme-contrast.ts computes it ─────────────────────────────────

/** WCAG 2.1 relative luminance of an #rrggbb colour. */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours (order-independent). */
function ratio(a: string, b: string): number {
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

/** Mix two opaque colours in OKLab, `p` being the first colour's share (0..1). */
function mixOklab(a: string, b: string, p: number): string {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  return labToHex({ L: la.L * p + lb.L * (1 - p), a: la.a * p + lb.a * (1 - p), b: la.b * p + lb.b * (1 - p) });
}

/** A resolved colour: an opaque hex, or a hex with alpha (a scrim). */
interface Rgba { hex: string; alpha: number }

/** Source-over compositing of `top` (with alpha) on an opaque `ground`, in sRGB as browsers do. */
function over(top: Rgba, ground: string): string {
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
// Grammar this tool accepts (and the contract confines itself to): #hex · transparent ·
// var(--name[, fallback]) · color-mix(in oklab, <expr> [N%], <expr>|transparent [N%]) ·
// rgba(r,g,b,a). Anything else is a refusal naming the token — that refusal IS the
// "structure, not colour" rule working.

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

type Vars = Map<string, string>;

/** The percentages every color-mix in the file uses, recorded for the AK-CAP budget check. */
interface MixUse { token: string; percentOfOther: number }

function expandHex(raw: string): string {
  const h = raw.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  throw new Error(`unsupported hex "${raw}"`);
}

/**
 * Resolve one colour expression to an Rgba. `vars` maps every custom property (theme + atelier,
 * already layered for the combination under test) to its raw value string.
 */
function evalColor(expr: string, vars: Vars, trail: string): Rgba {
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
  }
  throw new Error(`${trail}: cannot evaluate colour "${s.slice(0, 60)}" — the contract confines itself to hex, var(), color-mix(in oklab) and gradients over those`);
}

/** Pull the colour stops out of a linear/radial gradient value (positions and angles skipped). */
function gradientStops(expr: string, vars: Vars, trail: string): Rgba[] {
  const stops: Rgba[] = [];
  const grads = expr.matchAll(/(?:linear|radial)-gradient\(((?:[^()]|\([^()]*(?:\([^()]*\)[^()]*)*\))*)\)/g);
  for (const g of grads) {
    for (const arg of splitArgs(g[1]!)) {
      if (/^(?:-?\d+(?:\.\d+)?deg|at\s)/i.test(arg)) continue;
      const colorPart = arg.replace(/\s+\d+(?:\.\d+)?%\s*$/, '').trim();
      if (/^transparent$/i.test(colorPart)) continue;
      stops.push(evalColor(colorPart, vars, trail));
    }
  }
  return stops;
}

/** Record every color-mix percentage that mixes something INTO a base, for the budget check. */
function mixPercents(expr: string): number[] {
  const out: number[] = [];
  for (const m of expr.matchAll(/color-mix\(in oklab,\s*[^,]*?\s(\d+(?:\.\d+)?)%\s*,/g)) out.push(Number(m[1]));
  return out;
}

/**
 * The mesh budget's own scan: only the percentages mixed OVER THE PAGE GROUND count as pigment.
 * A nested hue blend between two accents (55% of one accent into the other) is vocabulary, not
 * coverage — what the cap bounds is how much of ANY colour lands on the bg. Balanced scan, since
 * the first argument may itself be a color-mix.
 */
function groundMixPercents(expr: string, groundVar: string): number[] {
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

function parseDecls(body: string): Map<string, string> {
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
function parseThemes(css: string): Map<string, Map<string, string>> {
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

interface AtelierSheet {
  base: Map<string, string>;
  dark: Map<string, string>;
  presets: Map<string, { decls: Map<string, string>; raw: string }>;
}

/** The base contract, the dark re-declaration, and every `@preset-block` from aimeat-atelier.css. */
function parseAtelier(css: string): AtelierSheet {
  const blockAfter = (index: number): { body: string } => {
    const open = css.indexOf('{', index);
    const close = css.indexOf('\n}', open);
    if (open < 0 || close < 0) throw new Error('unterminated block in aimeat-atelier.css');
    return { body: css.slice(open + 1, close) };
  };
  const presets = new Map<string, { decls: Map<string, string>; raw: string }>();
  const marker = /\/\*\s*@preset-block\s+([a-z0-9-]+)\b[^*]*\*\//g;
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

const MIN_TEXT = 4.5;
const MIN_STEP = 1.10;
const MIN_EDGE_VS_CARD = 1.30;
const MIN_EDGE_VS_PAGE = 1.15;
/** A card tint may mix at most this much of anything into the surface. */
const SURFACE_TINT_CAP = 8;
/** The hero mesh budget is wider: text never sits on raw mesh (AK-SCRIM covers text). Raised
 *  from 18 on 2026-08-27 by the developer's direction — the 18% mesh read as a washed tint in
 *  the first real-browser screenshots, and the focal band is the one place the system COMMITS
 *  to colour. This cap is an aesthetic bound (a mesh, not a solid poster fill); the readability
 *  guarantee is AK-SCRIM, which is unchanged and still arithmetic. */
const HERO_MESH_CAP = 36;
/** Tokens the base contract must declare — a look can never inherit half its identity. */
const REQUIRED_BASE = [
  '--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-surface-image', '--ak-ink', '--ak-ink-dim',
  '--ak-line', '--ak-line-w', '--ak-accent', '--ak-accent-2', '--ak-accent-ink', '--ak-accent-text',
  '--ak-ok', '--ak-warn', '--ak-err', '--ak-focus', '--ak-grad', '--ak-scrim', '--ak-hero-image',
  '--ak-radius', '--ak-radius-sm', '--ak-radius-pill', '--ak-elev-1', '--ak-elev-2',
  '--ak-font', '--ak-font-display', '--ak-font-mono',
  '--ak-text-hero', '--ak-text-title', '--ak-text-body', '--ak-text-fine', '--ak-weight-display',
  '--ak-display-shadow', '--ak-display-stroke', '--ak-tilt',
  '--ak-gap', '--ak-pad', '--ak-touch', '--ak-motion', '--ak-ease',
  '--ak-enter-distance', '--ak-enter-stagger', '--ak-chrome-bottom', '--ak-main-max', '--ak-hero-min',
];
/** The dark block must re-declare at least the surfaces and inks it exists for. */
const REQUIRED_DARK = ['--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-ink', '--ak-line', '--ak-scrim'];

interface Result { combo: string; label: string; actual: number; min: number; ok: boolean; why: string }

const results: Result[] = [];
function add(combo: string, label: string, actual: number, min: number, why: string): void {
  results.push({ combo, label, actual, min, ok: actual >= min, why });
}
function fail(combo: string, label: string, why: string): void {
  results.push({ combo, label, actual: 0, min: 0, ok: false, why });
}
function pass(combo: string, label: string): void {
  results.push({ combo, label, actual: 1, min: 0, ok: true, why: '' });
}

const themeCss = readFileSync(new URL('../public/lib/aimeat-theme.css', import.meta.url), 'utf8');
const atelierCss = readFileSync(new URL('../public/lib/aimeat-atelier.css', import.meta.url), 'utf8');
const themes = parseThemes(themeCss);
const sheet = parseAtelier(atelierCss);
const presetNames = ['vivid', ...sheet.presets.keys()];

// Completeness and purity are per-file facts, checked once.
for (const token of REQUIRED_BASE) {
  if (!sheet.base.has(token)) fail('contract', `AK-COMPLETE ${token}`, 'missing from the base contract');
}
for (const token of REQUIRED_DARK) {
  if (!sheet.dark.has(token)) fail('contract', `AK-COMPLETE dark ${token}`, 'the dark block must re-declare it');
}
for (const [name, block] of sheet.presets) {
  for (const token of block.decls.keys()) {
    if (!REQUIRED_BASE.includes(token)) {
      fail(`preset ${name}`, `AK-COMPLETE ${token}`, 'sets a token the contract does not declare — add it to the contract first');
    }
  }
  if (/#[0-9a-fA-F]{3,6}\b|rgba?\s*\(/.test(block.raw)) {
    fail(`preset ${name}`, 'AK-PURE', 'a preset never introduces a colour — only var() and color-mix over theme tokens');
  } else {
    pass(`preset ${name}`, 'AK-PURE');
  }
}

for (const preset of presetNames) {
  for (const [paletteMode, themeVars] of themes) {
    const combo = `${preset} × ${paletteMode}`;
    const mode = paletteMode.endsWith('/dark') ? 'dark' : 'light';

    // Layer the maps exactly as the cascade does: theme < base < dark (dark mode) < preset.
    const vars: Vars = new Map(themeVars);
    for (const [k, v] of sheet.base) vars.set(k, v);
    if (mode === 'dark') for (const [k, v] of sheet.dark) vars.set(k, v);
    if (preset !== 'vivid') for (const [k, v] of sheet.presets.get(preset)!.decls) vars.set(k, v);

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
        if (p <= SURFACE_TINT_CAP) pass(combo, 'AK-CAP surface tint %');
        else fail(combo, 'AK-CAP surface tint %', `a card tint above ${SURFACE_TINT_CAP}% stops being a tint (uses ${p}%)`);
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

      // AK-SCRIM: ink over the scrim over every ground the hero can show.
      const heroRaw = vars.get('--ak-hero-image')!;
      const meshStops = heroRaw === 'none' ? [] : gradientStops(heroRaw, vars, `${combo} --ak-hero-image`);
      const heroGrounds = [...gradGrounds, ...meshStops.map((s) => (s.alpha === 1 ? s.hex : over(s, bg))), bg];
      for (const ground of heroGrounds) {
        add(combo, 'AK-SCRIM ink over scrim', ratio(ink, over(scrim, ground)), MIN_TEXT, 'hero text on the scrimmed ground');
      }
      // Only pigment laid over the page ground counts against the mesh budget — a nested hue
      // blend between two accents is vocabulary, not coverage (see groundMixPercents).
      for (const p of groundMixPercents(heroRaw, '--ak-bg')) {
        if (p <= HERO_MESH_CAP) pass(combo, 'AK-CAP hero mesh %');
        else fail(combo, 'AK-CAP hero mesh %', `the hero mesh above ${HERO_MESH_CAP}% stops being a wash (uses ${p}%)`);
      }
    } catch (e) {
      fail(combo, 'resolve', (e as Error).message);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────
const combos = presetNames.length * themes.size;
console.log(`\nAtelier look matrix — ${presetNames.length} presets × ${themes.size} palette-modes = ${combos} combinations, ${results.length} checks\n`);
let failed = 0;
for (const r of results) {
  if (r.ok) continue;
  failed++;
  console.log(`  FAIL ${r.combo.padEnd(26)} ${r.label.padEnd(38)} ${r.actual.toFixed(2).padStart(6)} < ${r.min}   <- ${r.why}`);
}
if (failed) {
  console.error(`\n${failed} of ${results.length} checks failed. Fix the token expression, not the check.\n`);
  process.exit(1);
}
console.log(`  ok   every combination meets every minimum (${results.length} checks green)\n`);
