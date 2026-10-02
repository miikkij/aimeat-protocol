/**
 * @file src/services/app-ui/registry-defs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mosaic registry's two types and its two prop helpers, moved out of registry.ts
 *   unchanged so registry-library-blocks.ts can use them without an import cycle. registry.ts
 *   re-exports the types, so every importer keeps the address it had.
 * @structure AppUiPropDef · AppUiComponentDef · text() · requiredText()
 * @usage import { text, requiredText, type AppUiComponentDef } from './registry-defs.js';
 * @version-history
 *   v1.0.0 — 2026-10-02 — Moved from registry.ts (v1.25.0) under the 800-line cap.
 */
import type { BlockPropDef } from '../surface-layout/registry-types.js';

/** A mosaic prop: the shared grammar, plus whether a layout must supply it. */
export type AppUiPropDef = BlockPropDef & {
  /** The validator refuses a block that omits this prop. Most props default instead. */
  required?: true;
};

export interface AppUiComponentDef {
  /** Stable id — the kit's own component name (AIMEAT.atelier.<id>). */
  id: string;
  /** One sentence for the catalogue and the picker. */
  summary: string;
  /** The declared settings. Append-only once a layout is stored. */
  props: Record<string, AppUiPropDef>;
  /** At most this many instances per layout (the hero rule: one focal point). */
  maxPerLayout?: number;
}

/** A free-text prop. */
export const text = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description });
/** A free-text prop a layout must supply. */
export const requiredText = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description, required: true });
