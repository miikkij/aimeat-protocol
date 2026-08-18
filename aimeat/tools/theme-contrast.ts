/**
 * @file tools/theme-contrast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Verifies the AIMEAT theme system (public/lib/aimeat-theme.css) against WCAG 2.1
 *   contrast — EVERY palette in BOTH modes — and verifies that the ratios the file CLAIMS in its
 *   own comments are the ratios it actually has. The claims are parsed out of the CSS, so a
 *   hand-edited colour whose comment was not updated fails here instead of shipping a false
 *   accessibility statement.
 *
 *   Checks per palette-mode block (tagged `@theme-block <palette> <mode>` in the CSS):
 *   1. CONTENT PAIRS — every `--color-X-content` against its `--color-X` fill. 4.5:1 normally;
 *      3:1 when the comment marks the pair "large/bold UI text only" (WCAG 1.4.3 large text and
 *      1.4.11 non-text contrast both settle at 3:1).
 *   2. SURFACE SEPARATION — the card-boundary step AND edge (both mechanisms required; loosening
 *      this once shipped invisible cards — the palette is wrong, not the check).
 *   3. BODY TEXT — base-content against both base-100 and base-200 at the full 4.5:1.
 *   4. PRIMARY DISCERNIBILITY (v2, tightened) — primary >= 3:1 against base-100 AND base-200
 *      (WCAG 1.4.11: a primary button must be tellable from the page and from the card it sits on).
 *   5. COMPLETENESS (v2) — every block declares the full token set (all colours + fonts + radii),
 *      so a palette can never silently inherit half its identity from another block.
 *   6. REGISTRY SYNC (v2) — the PALETTES registry in src/static/sdk-libs/auth/palette.js lists
 *      exactly the palettes the CSS ships, with true swatch colours (bg/card/accent per mode).
 * @structure lum/ratio (WCAG relative luminance) · parseThemes (@theme-block markers) ·
 *   checkTheme · registry sync · report
 * @usage cd aimeat && pnpm exec tsx tools/theme-contrast.ts     (or: pnpm check:theme)
 *   Exits non-zero on any failure, so it can gate CI or the pre-commit hook.
 * @version-history
 *   v2.0.0 — 2026-07-25 — Multi-palette: parses every `@theme-block`, requires both modes per
 *     palette, adds primary-vs-surface (1.4.11), token completeness and palette.js registry sync.
 *     No threshold was loosened.
 *   v1.0.0 — 2026-07-25 — Initial theme-contrast verifier, born with public/lib/aimeat-theme.css.
 */
import { readFileSync } from 'node:fs';

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

interface Decl { value: string; claim: number | null; largeTextOnly: boolean }
type Theme = Map<string, Decl>;

/**
 * Pull every `@theme-block <palette> <mode>` block out of the stylesheet. Each
 * `--color-*: #hex;` may carry a trailing `/* N:1 … *​/` comment; that number is the claim this
 * tool holds the file to. Non-colour tokens (fonts, radii) are collected for the completeness check.
 */
function parseThemes(css: string): Map<string, { light?: Theme; dark?: Theme }> {
  const out = new Map<string, { light?: Theme; dark?: Theme }>();
  const marker = /\/\*\s*@theme-block\s+([a-z0-9-]+)\s+(light|dark)\s*\*\//g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(css))) {
    const open = css.indexOf('{', marker.lastIndex);
    const close = css.indexOf('\n}', open);
    if (open < 0 || close < 0) throw new Error(`unterminated @theme-block ${m[1]} ${m[2]}`);
    const body = css.slice(open + 1, close);
    const theme: Theme = new Map();
    const decl = /--([a-z0-9-]+)\s*:\s*([^;]+);(?:[^\n]*?\/\*([^*]*)\*\/)?/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body))) {
      const comment = d[3] ?? '';
      const claimed = /(\d+(?:\.\d+)?):1/.exec(comment);
      theme.set(d[1]!, {
        value: d[2]!.trim().toLowerCase(),
        claim: claimed ? Number(claimed[1]) : null,
        largeTextOnly: /large\/bold UI text only/i.test(comment),
      });
    }
    const entry = out.get(m[1]!) ?? {};
    entry[m[2] as 'light' | 'dark'] = theme;
    out.set(m[1]!, entry);
  }
  if (!out.size) throw new Error('no @theme-block markers found — the CSS and this tool have drifted');
  return out;
}

const SEMANTIC = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error'];
/**
 * A card has to be TELLABLE from the page, and BOTH mechanisms are required — this check used to
 * accept either, which let the light theme ship with a 1.05 step behind a 1.24 hairline. The result
 * was the reported bug: white cards you could not see against a near-white page, and form controls
 * (daisyUI fills them with base-100) invisible inside the card they sat on. Loosening the test was
 * the wrong move; the palette had to change.
 *   - STEP: base-200 vs base-100 — enough that a card reads as raised with no border at all.
 *   - EDGE: base-300 against the card it outlines and the page behind it — a hairline you can see.
 * daisyUI's own dark theme fails both (1.05 step, 1.03 edge).
 */
const MIN_SURFACE_STEP = 1.12;
const MIN_EDGE_VS_CARD = 1.35;
const MIN_EDGE_VS_PAGE = 1.15;
/** WCAG 1.4.11 — the primary control colour against the surfaces it sits on. */
const MIN_PRIMARY_VS_SURFACE = 3;
/** Rounded claims are stated to one decimal, so allow half of that. */
const CLAIM_TOLERANCE = 0.05;
/** Every block must declare ALL of these — identity is never inherited across palettes. */
const REQUIRED_TOKENS = [
  'color-base-100', 'color-base-200', 'color-base-300', 'color-base-content',
  ...SEMANTIC.flatMap((s) => [`color-${s}`, `color-${s}-content`]),
  'radius-box', 'radius-field', 'radius-selector', 'border', 'border-w',
  'font-display', 'font-body', 'font-mono',
];

interface Result { theme: string; label: string; actual: number; min: number; claim: number | null; ok: boolean; why: string }

function checkTheme(name: string, theme: Theme): Result[] {
  const out: Result[] = [];
  const hex = (k: string): string => {
    const d = theme.get(`color-${k}`);
    if (!d) throw new Error(`${name}: --color-${k} is missing`);
    return d.value;
  };
  const add = (label: string, fg: string, bg: string, min: number, claim: number | null): void => {
    const actual = ratio(fg, bg);
    const failsMin = actual < min;
    const drifts = claim !== null && Math.abs(actual - claim) > CLAIM_TOLERANCE;
    out.push({
      theme: name, label, actual, min, claim, ok: !failsMin && !drifts,
      why: failsMin ? `below the ${min}:1 minimum` : drifts ? `comment claims ${claim}:1` : '',
    });
  };

  for (const token of REQUIRED_TOKENS) {
    if (!theme.has(token)) {
      out.push({ theme: name, label: `token --${token}`, actual: 0, min: 0, claim: null, ok: false, why: 'missing — a palette block must be complete' });
    }
  }
  for (const s of SEMANTIC) {
    const content = theme.get(`color-${s}-content`);
    if (!content) continue;
    add(`${s}-content on ${s}`, content.value, hex(s), content.largeTextOnly ? 3 : 4.5, content.claim);
  }
  const bodyText = theme.get('color-base-content');
  if (bodyText) {
    add('base-content on base-100 (page)', bodyText.value, hex('base-100'), 4.5, null);
    add('base-content on base-200 (card)', bodyText.value, hex('base-200'), 4.5, null);
  }
  // The card boundary: a luminance step AND a usable edge, reported separately so the theme
  // states honestly which mechanism carries how much.
  const step = ratio(hex('base-200'), hex('base-100'));
  const edgeCard = ratio(hex('base-300'), hex('base-200'));
  const edgePage = ratio(hex('base-300'), hex('base-100'));
  out.push({
    theme: name, label: 'card boundary: step (base-200 vs base-100)', actual: step,
    min: MIN_SURFACE_STEP, claim: null, ok: step >= MIN_SURFACE_STEP,
    why: 'a card with no border would be invisible on the page',
  });
  out.push({
    theme: name, label: 'card boundary: edge (base-300 vs base-200)', actual: edgeCard,
    min: MIN_EDGE_VS_CARD, claim: null, ok: edgeCard >= MIN_EDGE_VS_CARD,
    why: 'the hairline that outlines a card cannot be seen on it',
  });
  out.push({
    theme: name, label: 'card boundary: edge (base-300 vs base-100)', actual: edgePage,
    min: MIN_EDGE_VS_PAGE, claim: null, ok: edgePage >= MIN_EDGE_VS_PAGE,
    why: 'the hairline cannot be seen against the page',
  });
  // v2 tightening: the primary control colour must be discernible on both surfaces (1.4.11).
  const p = hex('primary');
  const pPage = ratio(p, hex('base-100'));
  const pCard = ratio(p, hex('base-200'));
  out.push({
    theme: name, label: 'primary vs base-100 (button on page)', actual: pPage,
    min: MIN_PRIMARY_VS_SURFACE, claim: null, ok: pPage >= MIN_PRIMARY_VS_SURFACE,
    why: 'a primary button melts into the page',
  });
  out.push({
    theme: name, label: 'primary vs base-200 (button on card)', actual: pCard,
    min: MIN_PRIMARY_VS_SURFACE, claim: null, ok: pCard >= MIN_PRIMARY_VS_SURFACE,
    why: 'a primary button melts into the card',
  });
  return out;
}

/**
 * The picker registry (sdk-libs/auth/palette.js) must offer exactly the palettes the CSS ships,
 * with true swatch colours. Parsed textually (the file is an ES module for the browser bundle).
 */
function checkRegistry(themes: Map<string, { light?: Theme; dark?: Theme }>): Result[] {
  const js = readFileSync(new URL('../src/static/sdk-libs/auth/palette.js', import.meta.url), 'utf8');
  const out: Result[] = [];
  const entry = /\{ id: '([a-z0-9-]+)', label: '[^']+', swatch: \{\s*light: \{ bg: '(#[0-9a-fA-F]{6})', card: '(#[0-9a-fA-F]{6})', accent: '(#[0-9a-fA-F]{6})' \},\s*dark: \{ bg: '(#[0-9a-fA-F]{6})', card: '(#[0-9a-fA-F]{6})', accent: '(#[0-9a-fA-F]{6})' \} \} \}/g;
  const seen = new Set<string>();
  const fail = (label: string, why: string): void => { out.push({ theme: 'registry', label, actual: 0, min: 0, claim: null, ok: false, why }); };
  const pass = (label: string): void => { out.push({ theme: 'registry', label, actual: 1, min: 1, claim: null, ok: true, why: '' }); };
  let m: RegExpExecArray | null;
  while ((m = entry.exec(js))) {
    const [, id, lBg, lCard, lAcc, dBg, dCard, dAcc] = m;
    seen.add(id!);
    const t = themes.get(id!);
    if (!t || !t.light || !t.dark) { fail(`palette '${id}'`, 'registered in palette.js but not shipped (both modes) by aimeat-theme.css'); continue; }
    const v = (theme: Theme, k: string): string => theme.get(`color-${k}`)?.value ?? '';
    const pairs: [string, string, string][] = [
      [lBg!, v(t.light, 'base-100'), 'light bg'], [lCard!, v(t.light, 'base-200'), 'light card'], [lAcc!, v(t.light, 'primary'), 'light accent'],
      [dBg!, v(t.dark, 'base-100'), 'dark bg'], [dCard!, v(t.dark, 'base-200'), 'dark card'], [dAcc!, v(t.dark, 'primary'), 'dark accent'],
    ];
    const bad = pairs.filter(([claimed, actual]) => claimed.toLowerCase() !== actual);
    if (bad.length) fail(`palette '${id}' swatch`, bad.map(([c, a, w]) => `${w} is ${c} but the CSS says ${a}`).join('; '));
    else pass(`palette '${id}' swatch matches the CSS`);
  }
  for (const id of themes.keys()) {
    if (!seen.has(id)) fail(`palette '${id}'`, 'shipped by aimeat-theme.css but missing from the palette.js picker registry');
  }
  return out;
}

const css = readFileSync(new URL('../public/lib/aimeat-theme.css', import.meta.url), 'utf8');
const themes = parseThemes(css);
const results: Result[] = [];
for (const [palette, modes] of themes) {
  for (const mode of ['light', 'dark'] as const) {
    const theme = modes[mode];
    if (!theme) {
      results.push({ theme: `${palette}/${mode}`, label: 'block', actual: 0, min: 0, claim: null, ok: false, why: 'every palette must define BOTH modes' });
      continue;
    }
    results.push(...checkTheme(`${palette}/${mode}`, theme));
  }
}
results.push(...checkRegistry(themes));

console.log(`\nAIMEAT theme contrast — ${themes.size} palettes, ${results.length} checks\n`);
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  const mark = r.ok ? 'ok  ' : 'FAIL';
  console.log(
    `  ${mark} ${r.theme.padEnd(14)} ${r.label.padEnd(46)} ${r.actual.toFixed(2).padStart(6)}:1` +
    (r.ok ? '' : `   <- ${r.why}`),
  );
}
if (failed) {
  console.error(`\n${failed} check(s) failed. Fix the colour (or the registry), not the check.\n`);
  process.exit(1);
}
console.log('\nEvery palette meets every minimum in both modes, and every stated ratio is accurate.\n');
