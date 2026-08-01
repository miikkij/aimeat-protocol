/**
 * @file public/components/ai-label-icons.js
 * @description The EU-icon truth table, on the browser side. A PURE module: no imports, no DOM, no
 *   i18n — which is what lets a unit test load it under node and compare it, row by row, against the
 *   normative server adapter (src/services/ai-provenance-adapters.ts `toEuIcon`).
 *
 *   WHY A SECOND COPY EXISTS AT ALL. The normative table is TypeScript under src/ and the browser
 *   cannot import it; there is no shared build between the two trees. A duplicated mapping is a
 *   defect unless something makes drift impossible, so test/unit/ai-label-icon-parity.test.ts runs
 *   both implementations over the whole cross-product of the frozen enums and fails on any
 *   disagreement. Change `toEuIcon()` and this file goes red rather than quietly wrong.
 *
 *   Split out of ai-label.js rather than living inside it for one concrete reason: ai-label.js
 *   imports `/js/i18n.js` and Preact, which a node-side test cannot resolve. Keeping the table
 *   import-free is what keeps it testable.
 * @structure
 *   - EU_ICONS — the three icon stems with their real viewBox ratios
 *   - euIconFor(record) — level + humanInvolvement → { file, alt } | null
 * @usage
 *   import { euIconFor } from './ai-label-icons.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 3. Table from docs/internal/EUAct/22-frozen-vocabulary.md §C2.
 */

/** The frozen spec string. Anything else reads as unstated — never as "a human wrote it". */
export const AI_PROVENANCE_SPEC_V1 = 'aimeat.provenance/v1';

/**
 * The three official icons and the viewBox ratio each one actually has.
 *
 * THEY ARE LOCKUPS, NOT GLYPHS: only `ai-basic` is square, and the other two are wide badges
 * containing the word "AI". Any CSS assuming a square icon box distorts them, which the Code
 * forbids ("proportions are preserved on resize"). The parity test reads these numbers back out of
 * the SVG files and out of ai-label.css, so all three stay in agreement.
 */
export const EU_ICONS = {
  'ai-basic': { ratio: 1 },
  'ai-generated': { ratio: 1789.84 / 566.93 },
  'ai-modified': { ratio: 1700.79 / 566.93 },
};

/** Did a person read the substance and retain the power to reject it? */
function reviewed(record) {
  return record.humanInvolvement === 'editorial-control' || record.humanInvolvement === 'full-human';
}

/**
 * Which official EU icon, and the i18n KEY for its alt text. `null` means no icon: a human wrote it
 * and there is nothing to disclose.
 *
 * The unstated case is deliberately not silence — an absent, malformed or unknown-`spec` record gets
 * the basic icon and an honest "AI involvement unstated" alt. Whether a label is OWED is a separate
 * question this function does not answer; the server's disclosureFor() already answered it and the
 * component reads `disclosure.required`.
 *
 * @param {any} record the `aimeat.provenance/v1` document, or anything at all
 * @returns {{ file: 'ai-basic'|'ai-generated'|'ai-modified', alt: string }|null}
 */
export function euIconFor(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.spec !== AI_PROVENANCE_SPEC_V1) {
    return { file: 'ai-basic', alt: 'aiLabel.iconAlt.unstated' };
  }
  switch (record.level) {
    case 'original': return null;
    case 'assisted': return { file: 'ai-modified', alt: 'aiLabel.iconAlt.aiModified' };
    case 'synthesized':
    case 'ai-generated':
      return reviewed(record)
        ? { file: 'ai-basic', alt: 'aiLabel.iconAlt.aiBasic' }
        : { file: 'ai-generated', alt: 'aiLabel.iconAlt.aiGenerated' };
    default: return { file: 'ai-basic', alt: 'aiLabel.iconAlt.unstated' };
  }
}
