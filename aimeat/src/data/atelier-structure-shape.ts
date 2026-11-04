/**
 * @file src/data/atelier-structure-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SHAPE of a structure: the one interface atelier-structures.ts and
 *   atelier-structures-office.ts both fill. It lives apart from either for the reason
 *   atelier-look-shape.ts does: a type-only import back into the registry still reads as a cycle to
 *   the dependency gate. Every importer keeps its address, atelier-structures.ts re-exports the type.
 * @structure AtelierStructure
 * @usage
 *   import type { AtelierStructure } from './atelier-structure-shape.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Pure extraction from atelier-structures.ts.
 */

/** A named, reusable page-shape recipe. `css(sel)` emits its rules scoped to one look. */
export interface AtelierStructure {
  id: string;
  /** One sentence for the catalogue and the data sheet. */
  summary: string;
  /** The rules, scoped to the given look selector (e.g. "[data-ak-look='editorial']"). */
  css: (sel: string) => string;
}
