/**
 * @file src/services/design-book/kit-brand.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One brand colour in, the whole colour of a style kit out, with the contrast worked
 *   out instead of hoped for. A company knows one colour. The signature's colour door takes an
 *   accent pair and refuses what fails, which leaves a yellow or a pale brand with no way in: white
 *   words fail on it, and so does the colour itself as text on a white page. Two apps had already
 *   built this by hand before the kit could do it.
 *
 *   IT WORKS OUT THREE COLOURS PER MODE, AND KEEPS THE BRAND WHERE IT CAN. The fill stays the brand
 *   as given. The words on the fill are white or near-black, whichever reads. The accent as text
 *   walks from the brand toward the mode's ink only as far as it must. The fill moves only when it
 *   has to: on a dark page a very dark brand would vanish, and a mid-tone may hold neither word
 *   colour. The answer says what moved.
 *
 *   THE MATRIX DECIDES, not this file's arithmetic: every candidate runs the same contrast matrix a
 *   look does, on the kit's own look, so a kit that passes here passes everything its look promises.
 * @structure BRAND_TOKENS · BrandProof · isBrandColour · deriveBrandTokens
 * @usage
 *   const { tokens, proof } = deriveBrandTokens('#f2b705', 'konserni');
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { loadAtelierSheets, ratio, runMatrix, type Result } from '../atelier-contrast.js';
import { lightnessOf, withLightness } from '../atelier-color.js';
import { DesignBookError } from './errors.js';

/** The tokens a brand colour sets, each a light/dark pair. */
export const BRAND_TOKENS = ['--ak-accent', '--ak-accent-ink', '--ak-accent-text'] as const;

/** What the derivation found for one mode: the three colours and the two ratios people read. */
export interface BrandHalf {
  accent: string;
  ink: string;
  text: string;
  /** Words on the fill. */
  ink_ratio: number;
  /** Whether the fill had to move away from the brand as given. */
  moved: boolean;
}

export interface BrandProof { brand: string; look: string; light: BrandHalf; dark: BrandHalf }

const HEX_RE = /^#[0-9a-f]{6}$/;
const WHITE = '#ffffff';
const NEAR_BLACK = '#14161a';
/** A filled bar or button must still be seen as a shape on the dark page. */
const MIN_FILL_ON_DARK = 2.2;
/** How far the search goes, as parts of the way to the mode's far end of lightness. */
const STEPS = Array.from({ length: 26 }, (_, i) => i / 25);

export function isBrandColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim().toLowerCase());
}

/** The words that read best on this fill. */
function bestInk(fill: string): string {
  return ratio(WHITE, fill) >= ratio(NEAR_BLACK, fill) ? WHITE : NEAR_BLACK;
}

/** The page a look stands on in dark mode, for the one check the matrix does not make. */
function darkGround(look: string): string {
  const { sheet } = loadAtelierSheets();
  const value = sheet.presets.get(`${look}@dark`)?.decls.get('--ak-bg') ?? sheet.dark.get('--ak-bg') ?? '';
  return HEX_RE.test(value.toLowerCase()) ? value.toLowerCase() : '#10131b';
}

/** The matrix's failures for one mode, with these three colours on this look. */
function failures(look: string, mode: 'light' | 'dark', accent: string, ink: string, text: string): Result[] {
  return runMatrix({ '--ak-accent': accent, '--ak-accent-ink': ink, '--ak-accent-text': text }, { presets: [look] })
    .filter((r) => !r.ok && r.combo.includes('/dark') === (mode === 'dark'));
}

/** The colour this far of the way toward a lightness: the hue and chroma stay, so the brand stays itself. */
function walk(from: string, toL: number, step: number): string {
  if (step === 0) return from;
  const L = lightnessOf(from);
  return withLightness(from, L + (toL - L) * step);
}

/** The nearest fill and text that pass, walking the text before the fill. */
function deriveHalf(brand: string, look: string, mode: 'light' | 'dark'): BrandHalf {
  const textEnd = mode === 'light' ? 0.12 : 0.96;
  // A fill walks toward the end that gives its words room: on the light page a dark brand darkens
  // and a pale one lightens, and on the dark page it rises off the ground.
  const fillEnd = mode === 'dark' ? 0.9 : (bestInk(brand) === WHITE ? 0.12 : 0.96);
  const ground = darkGround(look);
  let last: Result | undefined;
  for (const fillStep of STEPS) {
    const fill = walk(brand, fillEnd, fillStep);
    if (mode === 'dark' && ratio(fill, ground) < MIN_FILL_ON_DARK) continue;
    const ink = bestInk(fill);
    for (const textStep of STEPS) {
      const text = walk(fill, textEnd, textStep);
      const bad = failures(look, mode, fill, ink, text);
      if (bad.length === 0) {
        return { accent: fill, ink, text, ink_ratio: Number(ratio(ink, fill).toFixed(2)), moved: fill !== brand };
      }
      last = bad[0];
      // Only the accent-as-text checks can improve by walking the text further.
      if (!bad.every((r) => r.label.includes('accent-as-text'))) break;
    }
  }
  const why = last ? `${last.label} in ${last.combo} measures ${last.actual.toFixed(2)} against the ${last.min} floor` : 'no colour stood out from the page';
  throw new DesignBookError('BODY_INVALID', `The brand colour ${brand} found no ${mode} form that passes the contrast matrix on the look "${look}": ${why}. Try a stronger colour, or give "tokens" an --ak-accent pair of your own.`, 422);
}

/** The kit's colour tokens from one brand colour, and the record of what was worked out. */
export function deriveBrandTokens(rawBrand: string, look: string): { tokens: Record<string, string>; proof: BrandProof } {
  const brand = rawBrand.trim().toLowerCase();
  if (!HEX_RE.test(brand)) {
    throw new DesignBookError('BODY_INVALID', '"brand" is one colour as #rrggbb, for example "#0b6b53". The kit works out the rest and proves it.', 422);
  }
  const light = deriveHalf(brand, look, 'light');
  const dark = deriveHalf(brand, look, 'dark');
  return {
    tokens: {
      '--ak-accent': `${light.accent}/${dark.accent}`,
      '--ak-accent-ink': `${light.ink}/${dark.ink}`,
      '--ak-accent-text': `${light.text}/${dark.text}`,
    },
    proof: { brand, look, light, dark },
  };
}

/** The factor between two colours, kept here so the tests read the same arithmetic. */
export { ratio as brandRatio, NEAR_BLACK as BRAND_NEAR_BLACK };
