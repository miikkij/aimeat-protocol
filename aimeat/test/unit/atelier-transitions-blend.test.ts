/**
 * @file test/unit/atelier-transitions-blend.test.ts
 * @description The screen fade names its own plus-lighter blend. Chromium applies that blend to a
 *   view transition's two snapshots through a UA animation in the same `animation` list, so a
 *   stylesheet that sets the `animation` shorthand on them drops it, and the cross-fade shows the
 *   backdrop at its midpoint: the whole page flashed light on every tab change until 2026-09-28.
 *   A stylesheet fact, read out of the stylesheet.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-transitions-blend.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../public/lib/aimeat-atelier/transitions.css', import.meta.url), 'utf8');

/** The declaration block of the first rule whose selector is exactly `selector`. */
function block(selector: string): string {
  const at = css.indexOf(selector + ' {');
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('the fade between two screens', () => {
  for (const side of ['old', 'new']) {
    it(`blends the ${side} snapshot with plus-lighter, beside its own animation`, () => {
      const rule = block(`:root[data-ak-transition='fade']::view-transition-${side}(root)`);
      expect(rule).toMatch(/animation:/);
      expect(rule).toMatch(/mix-blend-mode:\s*plus-lighter/);
    });
  }
});
