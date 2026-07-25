/**
 * @file tools/theme-contrast.ts
 * @description Verifies the AIMEAT daisyUI theme (public/lib/aimeat-theme.css) against WCAG 2.1
 *   contrast, and verifies that the ratios the file CLAIMS in its own comments are the ratios it
 *   actually has. The claims are parsed out of the CSS, so a hand-edited colour whose comment was
 *   not updated fails here instead of shipping a false accessibility statement.
 *
 *   Three classes of check:
 *   1. CONTENT PAIRS — every `--color-X-content` against its `--color-X` fill. 4.5:1 normally;
 *      3:1 when the comment marks the pair "large/bold UI text only" (WCAG 1.4.3 large text and
 *      1.4.11 non-text contrast both settle at 3:1). This is the check that catches the daisyUI
 *      default that started all this: white-or-brown on amber, identical in both themes.
 *   2. SURFACE SEPARATION — base-200 (card) against base-100 (page). daisyUI's own dark theme
 *      scores 1.05:1 here, which is why a card is invisible on a dark page; AIMEAT requires 1.10.
 *   3. BODY TEXT — base-content against both base-100 and base-200 at the full 4.5:1.
 * @structure lum/ratio (WCAG relative luminance) · parseThemes · CHECKS assembly · report
 * @usage cd aimeat && pnpm exec tsx tools/theme-contrast.ts     (or: pnpm check:theme)
 *   Exits non-zero on any failure, so it can gate CI or the pre-commit hook.
 * @version-history
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
 * Pull the light and dark blocks out of the stylesheet. Each `--color-*: #hex;` may carry a
 * trailing `/* N:1 … *​/` comment; that number is the claim this tool holds the file to.
 */
function parseThemes(css: string): { light: Theme; dark: Theme } {
  const block = (selector: RegExp): Theme => {
    const start = css.search(selector);
    if (start < 0) throw new Error(`theme block not found: ${selector}`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    const out: Theme = new Map();
    const decl = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;(?:[^\n]*?\/\*([^*]*)\*\/)?/g;
    let m: RegExpExecArray | null;
    while ((m = decl.exec(body))) {
      const comment = m[3] ?? '';
      const claimed = /(\d+(?:\.\d+)?):1/.exec(comment);
      out.set(m[1]!, {
        value: m[2]!.toLowerCase(),
        claim: claimed ? Number(claimed[1]) : null,
        largeTextOnly: /large\/bold UI text only/i.test(comment),
      });
    }
    return out;
  };
  return { light: block(/^:root,\s*$/m), dark: block(/^\[data-theme='dark'\]/m) };
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
/** Rounded claims are stated to one decimal, so allow half of that. */
const CLAIM_TOLERANCE = 0.05;

interface Result { theme: string; label: string; actual: number; min: number; claim: number | null; ok: boolean; why: string }

function checkTheme(name: string, theme: Theme): Result[] {
  const out: Result[] = [];
  const hex = (k: string): string => {
    const d = theme.get(k);
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

  for (const s of SEMANTIC) {
    const content = theme.get(`${s}-content`);
    if (!content) continue;
    add(`${s}-content on ${s}`, content.value, hex(s), content.largeTextOnly ? 3 : 4.5, content.claim);
  }
  const bodyText = theme.get('base-content');
  if (bodyText) {
    add('base-content on base-100 (page)', bodyText.value, hex('base-100'), 4.5, null);
    add('base-content on base-200 (card)', bodyText.value, hex('base-200'), 4.5, null);
  }
  // The card boundary: a luminance step OR a usable edge. Reported either way, so the theme
  // states honestly which mechanism it is relying on.
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
  return out;
}

const css = readFileSync(new URL('../public/lib/aimeat-theme.css', import.meta.url), 'utf8');
const { light, dark } = parseThemes(css);
const results = [...checkTheme('light', light), ...checkTheme('dark', dark)];

console.log(`\nAIMEAT theme contrast — ${results.length} checks\n`);
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  const mark = r.ok ? 'ok  ' : 'FAIL';
  console.log(
    `  ${mark} ${r.theme.padEnd(5)} ${r.label.padEnd(50)} ${r.actual.toFixed(2).padStart(6)}:1` +
    (r.ok ? '' : `   <- ${r.why}`),
  );
}
if (failed) {
  console.error(`\n${failed} check(s) failed. Fix the colour, or the ratio stated in its comment.\n`);
  process.exit(1);
}
console.log('\nAll pairs meet their minimum and every stated ratio is accurate.\n');
