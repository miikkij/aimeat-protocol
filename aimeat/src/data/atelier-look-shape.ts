/**
 * @file src/data/atelier-look-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SHAPE of a look — the one interface atelier-looks.ts (the page looks and the
 *   composed LOOKS list) and atelier-looks-worlds.ts (the looks that own their ground) both
 *   fill. It lives apart from either so the two registries import it one way: a type-only
 *   import from the worlds back into the registry still reads as a cycle to the dependency
 *   gate (check:deps), which is what refused the first split on 2026-09-05. Every importer
 *   keeps the address it always had — atelier-looks.ts re-exports the type.
 * @structure AtelierLook
 * @usage
 *   import type { AtelierLook } from './atelier-look-shape.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Pure extraction from atelier-looks.ts (wish-atelier-ambient-visuals).
 */

export interface AtelierLook {
  id: string;
  /** How it feels — the picker's words. */
  feel: string;
  /** The imagery pipeline's style words for this look. */
  imagery: string;
  /** Structure recipes this look uses, by id. */
  structures: string[];
  /** Token overrides on the --ak-* contract. The base look (vivid) IS the contract, so it
   *  overrides nothing but the SPRING HAND: every look states its own three
   *  --ak-spring-* numbers, because a look block nested inside another look would otherwise
   *  wear the outer look's bounce (the same trap the never-inherited trio was written for). */
  tokens: Record<string, string>;
  /** A WORLD owns its ground: literal values for the ground tokens (bg, surface, surface-2,
   *  ink, ink-dim, line), one set per mode — paper for a print world, phosphor for a machine
   *  one, night for a stage. The matrix runs every check against these in both modes, which is
   *  what makes the literals legal: a look never ships an UNPROVEN colour. A world that is
   *  always dark simply declares the same set twice. */
  grounds?: { light: Record<string, string>; dark: Record<string, string> };
  /** Dark-mode token EXPRESSIONS layered with the dark ground (var()/color-mix only — the
   *  purity check covers them): for the values whose polarity flips with the palette's accent,
   *  like the action band. */
  dusk?: Record<string, string>;
  /** The comment above the generated block — why this look is what it is. */
  note: string;
}
