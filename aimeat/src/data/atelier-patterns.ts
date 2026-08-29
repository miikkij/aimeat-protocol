/**
 * @file src/data/atelier-patterns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE PATTERN REGISTRY — every gradient-built background recipe the kit ships
 *   (public/lib/aimeat-atelier/patterns.css), described so an AI can CHOOSE one: what the eye
 *   sees, what it evokes, and where it belongs. Technique after Temani Afif's CSS-Pattern
 *   collection (https://github.com/Afif13/CSS-Pattern, MIT); every recipe here is rewritten on
 *   the --ak-* tokens, which is what lets the contrast matrix prove the volumes (AK-PAT).
 *
 *   ONE RECIPE, THREE VOLUMES (classes in patterns.css):
 *     ground  ~6% ink over the page — a WHOLE page stands on it, body text stays readable;
 *     prop    card-strength — one object (a chip, an edge, an empty state) wears it as texture;
 *     zone    full ink — a banner or divider, ONE per screen, words only inside a solid chip.
 *
 *   Derives: the ui catalogue's `patterns` block (app-ui/registry.ts) and the Atelier prompt's
 *   pattern lesson — described once, read by every door.
 * @structure AtelierPattern · PATTERNS
 * @usage
 *   import { PATTERNS } from '../data/atelier-patterns.js';
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial: the eight shipped recipes, described for choosing (the
 *     developer's ask: "kertoa mitä noissa nähdään … sitten AI osaisi arvioida niiden käyttöä").
 */

export interface AtelierPattern {
  /** The class stem: `.ak-pat-<id>` in patterns.css. */
  id: string;
  /** What the eye sees — plain words, no geometry jargon. */
  looksLike: string;
  /** What it evokes — the registers it belongs to. */
  evokes: string;
  /** Where it earns its place, by volume. */
  use: { ground?: string; prop?: string; zone?: string };
  /** The default tile size (override with --ak-pat-size on the element). */
  defaultSize: string;
}

export const PATTERNS: readonly AtelierPattern[] = [
  {
    id: 'zigzag',
    looksLike: 'Bold chevrons marching sideways, like rickrack ribbon or a knitted row.',
    evokes: 'Festival, print shop, retro packaging — loud and warm.',
    use: {
      zone: 'The banner behind a giant title (the Pattern Dept.\'s own masthead), or a divider that changes the subject.',
      prop: 'A card fill for something celebratory.',
    },
    defaultSize: '60px',
  },
  {
    id: 'check',
    looksLike: 'A checkerboard — even squares, two inks, no gaps.',
    evokes: 'Finish lines, race flags, café tablecloths, ska records.',
    use: {
      zone: 'A finish-line divider under a completed step; a footer band.',
      ground: 'At whisper volume, quiet graph-paper order for a workshop page.',
    },
    defaultSize: '46px',
  },
  {
    id: 'halftone',
    looksLike: 'Offset rows of round dots, like newspaper photo grain up close.',
    evokes: 'Print, comics, risograph — the hand-made press register.',
    use: {
      ground: 'The classic whisper: a whole page on soft dots reads as paper, not as decoration.',
      prop: 'An empty state or a chip that needs texture without an image.',
    },
    defaultSize: '34px',
  },
  {
    id: 'hazard',
    looksLike: 'Diagonal stripes at 45°, even width, like warning tape.',
    evokes: 'Caution, construction, backstage — the sign that something is off-limits or in progress.',
    use: {
      zone: 'A HOLD or maintenance band; the edge of something under construction. Never a ground — a page of hazard stripes shouts all day.',
    },
    defaultSize: '26px',
  },
  {
    id: 'ribbon',
    looksLike: 'Wide diagonal bands, broader and calmer than hazard — wrapping-paper stripes.',
    evokes: 'Gift wrap, awnings, deck chairs — friendly diagonals.',
    use: {
      zone: 'A festive divider or a footer with more warmth than hazard.',
      prop: 'A card fill for offers and seasonal things.',
    },
    defaultSize: '68px',
  },
  {
    id: 'diamonds',
    looksLike: 'A checkerboard turned 45° — a lattice of diamonds, harlequin style.',
    evokes: 'Playing cards, circus, argyle — playful but orderly.',
    use: {
      zone: 'A game or leaderboard band.',
      prop: 'The art area of a playful card; a badge ground.',
    },
    defaultSize: '52px',
  },
  {
    id: 'graph',
    looksLike: 'Thin ruled lines both ways — engineering graph paper.',
    evokes: 'Plans, workshops, notebooks — the desk things are designed on.',
    use: {
      ground: 'THE default page whisper for tools and dashboards: order without decoration (the Pattern Dept. page stands on it).',
      prop: 'A sketch area or an input zone.',
    },
    defaultSize: '44px',
  },
  {
    id: 'scallop',
    looksLike: 'Overlapping half-circles in rows — fish scales, or awning edges.',
    evokes: 'Seaside, bakery, japanese seigaiha waves — soft and patient.',
    use: {
      prop: 'A gentle card fill or an edge strip under a header.',
      ground: 'At whisper volume, a softer alternative to halftone for calm content.',
    },
    defaultSize: '44px',
  },
];
