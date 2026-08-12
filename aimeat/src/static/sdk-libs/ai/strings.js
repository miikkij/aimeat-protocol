/**
 * @file ai/strings.js
 * @description The AI-label strings the SDK resolves, and the lookup that resolves them. A PURE
 *   module: no DOM, no browser globals — which is the whole point, because it lets a node-side unit
 *   test load it and check every key the label renders actually resolves.
 *
 *   WHY IT IS ITS OWN FILE. The first version did this inside disclose.js and got it wrong: the keys
 *   are spelled the way the apex component spells them (`aiLabel.regionLabel`), while what is
 *   imported here is the `aiLabel` BLOCK, so the lookup walked one level too deep and every string
 *   rendered as its own key. A browser caught it; nothing else could, because the code was welded to
 *   the DOM. Splitting it out is what turns that into a test.
 *
 *   The strings come from the platform's own locales/*.json — one source, tree-shaken to this block
 *   at bundle time — so an app's label and the apex SPA's label say the same words.
 * @structure STRINGS — { en, fi, es } · pick(key, loc) — full dotted key → string
 * @usage import { pick } from './strings.js';  pick('aiLabel.short', 'fi')
 * @version-history
 *   v1.1.0 — 2026-08-12 — Spanish (es) added. The disclosure the EU AI Act asks for is now carried
 *     in every language the node declares at /v1/ai-transparency, not two of the three.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5, after a browser showed raw keys on the chip.
 */
import { aiLabel as EN } from '../../../../locales/en.json';
import { aiLabel as FI } from '../../../../locales/fi.json';
import { aiLabel as ES } from '../../../../locales/es.json';

/** The label strings, per language the node ships. */
export const STRINGS = { en: EN, fi: FI, es: ES };

/**
 * A platform string by its FULL dotted key, in `loc`, falling back to English and finally to the key
 * itself.
 *
 * The leading `aiLabel.` segment is stripped because the bundles here ARE that block. Keys are kept
 * in the apex component's spelling on purpose: the two surfaces name the same strings, and someone
 * comparing them should be comparing like with like.
 *
 * @param {string} key  e.g. `aiLabel.short`, `aiLabel.iconAlt.aiGenerated`
 * @param {string} loc  `en` | `fi`
 * @returns {string}
 */
export function pick(key, loc) {
  const path = (key.startsWith('aiLabel.') ? key.slice('aiLabel.'.length) : key).split('.');
  for (const bundle of [STRINGS[loc], STRINGS.en]) {
    const v = path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), bundle);
    if (typeof v === 'string') return v;
  }
  return key;
}
