/**
 * @file test/unit/ai-label-icon-parity.test.ts
 * @description The browser cannot import src/services/ai-provenance-adapters.ts, so
 *   public/components/ai-label-icons.js carries the only other copy of the EU-icon truth table on this
 *   platform. A second copy of a mapping is a defect waiting to happen; this test is what turns it
 *   into a loud one. It runs BOTH implementations over the whole cross-product of the frozen enums
 *   plus the unstated cases, and fails the moment they disagree.
 *
 *   If you changed toEuIcon() and this went red, the browser port in ai-label-icons.js needs the same
 *   change. Do not "fix" the test by relaxing it — the point is that the label a person sees and the
 *   mark a machine reads come from the same table (22-frozen-vocabulary.md §C2).
 *
 *   It also pins the icon ASPECT RATIOS to the SVGs actually in the repo. Two of the three official
 *   icons are wide lockups rather than glyphs, and a wrong ratio distorts the mark — which the Code
 *   forbids ("proportions are preserved on resize"). Reading the viewBox out of the file is the only
 *   check that cannot go stale.
 * @structure
 *   - parity over AI_PROVENANCE_LEVELS × AI_HUMAN_INVOLVEMENT
 *   - parity over the unstated inputs
 *   - EU_ICONS ratios vs the SVG viewBoxes, and vs the CSS aspect-ratio declarations
 * @usage pnpm exec vitest run test/unit/ai-label-icon-parity.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 3.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toEuIcon } from '../../src/services/ai-provenance-adapters.js';
import {
  AI_PROVENANCE_SPEC_V1, AI_PROVENANCE_LEVELS, AI_HUMAN_INVOLVEMENT,
} from '../../src/models/ai-provenance-schemas.js';
// The browser module under test. Import-free by design, so vitest's node environment loads it
// directly — the same trick test/unit/offers-grouping.test.ts already uses. (ai-label.js itself
// cannot be imported here: it pulls Preact and the absolute /js/i18n.js specifier, which is exactly
// why the table lives in its own file.)
import { euIconFor, EU_ICONS } from '../../public/components/ai-label-icons.js';

const root = join(import.meta.dirname, '../..');

describe('the browser icon port agrees with the server adapter', () => {
  for (const level of AI_PROVENANCE_LEVELS) {
    for (const humanInvolvement of AI_HUMAN_INVOLVEMENT) {
      it(`${level} × ${humanInvolvement}`, () => {
        const record = {
          spec: AI_PROVENANCE_SPEC_V1, level, humanInvolvement,
          generatedAt: '2026-08-01T18:42:00Z',
        };
        // toEuIcon returns undefined for "no icon"; the browser port returns null. Normalise the
        // absence, compare the substance.
        expect(euIconFor(record) ?? undefined).toEqual(toEuIcon(record));
      });
    }
  }

  const unstated: unknown[] = [
    undefined, null, {}, [], 'ai-generated', 42,
    { spec: 'aimeat.provenance/v99', level: 'ai-generated', humanInvolvement: 'none', generatedAt: '2026-08-01T18:42:00Z' },
    { level: 'ai-generated', humanInvolvement: 'none', generatedAt: '2026-08-01T18:42:00Z' },
  ];
  for (const [i, input] of unstated.entries()) {
    it(`unstated input #${i} → the honest basic icon on both sides`, () => {
      expect(euIconFor(input) ?? undefined).toEqual(toEuIcon(input));
      expect(euIconFor(input)).toEqual({ file: 'ai-basic', alt: 'aiLabel.iconAlt.unstated' });
    });
  }
});

describe('the lockups keep their real proportions', () => {
  const svgRatio = (stem: string): number => {
    const svg = readFileSync(join(root, `public/assets/eu-ai-icons/svg/${stem}_black.svg`), 'utf8');
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!m) throw new Error(`no viewBox in ${stem}_black.svg`);
    return Number(m[1]) / Number(m[2]);
  };

  for (const stem of Object.keys(EU_ICONS) as (keyof typeof EU_ICONS)[]) {
    it(`${stem} — the component's ratio is the SVG's own`, () => {
      expect(EU_ICONS[stem].ratio).toBeCloseTo(svgRatio(stem), 5);
    });
  }

  it('only ai-basic is square; the other two are wide badges', () => {
    expect(EU_ICONS['ai-basic'].ratio).toBe(1);
    expect(EU_ICONS['ai-generated'].ratio).toBeGreaterThan(3);
    expect(EU_ICONS['ai-modified'].ratio).toBeCloseTo(3, 2);
  });

  it('the CSS declares the same aspect-ratio the SVG has, for every icon', () => {
    const css = readFileSync(join(root, 'public/css/components/ai-label.css'), 'utf8');
    for (const stem of Object.keys(EU_ICONS) as (keyof typeof EU_ICONS)[]) {
      const rule = new RegExp(`\\.ai-label__icon--${stem}\\s*\\{[^}]*aspect-ratio:\\s*([\\d.]+)\\s*/\\s*([\\d.]+)`);
      const m = rule.exec(css);
      expect(m, `no aspect-ratio for ${stem}`).toBeTruthy();
      expect(Number(m![1]) / Number(m![2])).toBeCloseTo(EU_ICONS[stem].ratio, 5);
    }
  });

  it('both theme variants of every icon exist on disk', () => {
    for (const stem of Object.keys(EU_ICONS)) {
      for (const variant of ['black', 'white']) {
        expect(() => readFileSync(join(root, `public/assets/eu-ai-icons/svg/${stem}_${variant}.svg`)))
          .not.toThrow();
      }
    }
  });
});
