/**
 * @file test/unit/ai-label-sdk-strings.test.ts
 * @description The SDK's AI label resolves its own strings, and this is the test that would have
 *   caught it not doing so.
 *
 *   WHAT HAPPENED. `AIMEAT.ai.disclose()` renders the label inside a published app, and the first
 *   version looked up `aiLabel.regionLabel` inside a bundle that WAS the `aiLabel` block — one level
 *   too deep — so every string rendered as its own key: a chip whose accessible name was literally
 *   "aiLabel.regionLabel". Nothing failed. Nothing logged. A browser found it, on an app origin, at
 *   1280x900, in the second look.
 *
 *   The lookup now lives in a pure module with no DOM in it (sdk-libs/ai/strings.js) precisely so
 *   this file can load it. Every key the label can render is asserted to resolve, in every language
 *   the node ships, and to differ from the key — because "returns a string" was never the bar; the
 *   bug returned a string.
 * @structure every key × every locale resolves · Finnish is Finnish · unknown keys degrade honestly
 * @usage pnpm exec vitest run test/unit/ai-label-sdk-strings.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a JS SDK source with a JSON import; checked by tsconfig.sdk.json, not this one.
import { pick, STRINGS } from '../../src/static/sdk-libs/ai/strings.js';

/** Every key ai/disclose.js can ask for, spelled the way the apex component spells them. */
const KEYS = [
  'aiLabel.regionLabel',
  'aiLabel.short',
  'aiLabel.publicText',
  'aiLabel.detailsLink',
  'aiLabel.interactionTitle',
  'aiLabel.interactionBody',
  // The four alt texts euIconFor() can return.
  'aiLabel.iconAlt.aiGenerated',
  'aiLabel.iconAlt.aiModified',
  'aiLabel.iconAlt.aiBasic',
  'aiLabel.iconAlt.unstated',
];

describe('the SDK label resolves every string it can render', () => {
  for (const loc of ['en', 'fi'] as const) {
    for (const key of KEYS) {
      it(`${loc}: ${key}`, () => {
        const v = pick(key, loc);
        // The bug returned the key. "It returned a string" is not the assertion that catches it.
        expect(v).not.toBe(key);
        expect(v.length).toBeGreaterThan(1);
      });
    }
  }

  it('the two languages actually differ — a copied English bundle would pass everything above', () => {
    expect(pick('aiLabel.short', 'fi')).not.toBe(pick('aiLabel.short', 'en'));
    expect(pick('aiLabel.short', 'fi')).toBe('Tekoälyn tuottama');
  });

  it('falls back to English for a language the node does not ship', () => {
    expect(pick('aiLabel.short', 'de')).toBe(pick('aiLabel.short', 'en'));
  });

  it('returns the key itself for a string that does not exist, rather than empty or undefined', () => {
    expect(pick('aiLabel.notAThing', 'en')).toBe('aiLabel.notAThing');
  });

  it('carries only the aiLabel block — the whole 430 KB locale bundle has no business in an app', () => {
    expect(Object.keys(STRINGS.en)).toContain('regionLabel');
    expect(Object.keys(STRINGS.en)).not.toContain('admin');
    expect(Object.keys(STRINGS.en).length).toBeLessThan(40);
  });
});
