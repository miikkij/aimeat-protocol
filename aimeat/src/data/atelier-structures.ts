/**
 * @file src/data/atelier-structures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE STRUCTURES — the named, reusable page-shape recipes a look composes with (the
 *   masthead, the joined frame, the press sheet, the marquee, the full-bleed band). Extracted
 *   whole from atelier-looks.ts on 2026-09-01 when the broadcast look pushed that file past the
 *   800-line cap: a pure move, nothing changed. atelier-looks.ts re-exports STRUCTURES, so the
 *   registry and the look builder import exactly what they imported before.
 * @structure AtelierStructure · STRUCTURES
 * @usage
 *   import { STRUCTURES } from '../data/atelier-looks.js';   // the re-export, unchanged
 * @version-history
 *   v1.0.0 — 2026-09-01 — Extracted verbatim from atelier-looks.ts (v1.6.0).
 */

/** A named, reusable page-shape recipe. `css(sel)` emits its rules scoped to one look. */
export interface AtelierStructure {
  id: string;
  /** One sentence for the catalogue and the data sheet. */
  summary: string;
  /** The rules, scoped to the given look selector (e.g. "[data-ak-look='editorial']"). */
  css: (sel: string) => string;
}

// ── The structures: page shapes, written once, reused by any look ────────────────────────────

export const STRUCTURES: readonly AtelierStructure[] = [
  {
    id: 'masthead',
    summary: 'The hero is a front-page masthead: giant display type on rules, no card, no mesh — and the news under it separates with RULES, not boxes (a card widget inside a newspaper was the first design review\'s finding).',
    css: (sel) => `
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  border-top: 3px solid var(--ak-ink);
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  overflow: visible;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: calc(var(--ak-pad) * 1.25) 0; }
${sel} .ak-hero__title {
  font-size: clamp(2.8rem, 9vw, 5.6rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
}
${sel} .ak-hero__sub { font-size: var(--ak-text-title); }
${sel} .ak-statrow { gap: 0; }
${sel} .ak-statrow__tile {
  border: 0;
  border-right: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding: calc(var(--ak-pad) * 1.25) var(--ak-pad);
  transform: none;
}
${sel} .ak-statrow__tile:last-child { border-right: 0; }
${sel} .ak-statrow__value { font-size: clamp(2.4rem, 6vw, 4rem); line-height: 1; }
${sel} .ak-statrow__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--ak-font-mono);
}
${sel} .ak-list__row {
  border: 0;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  padding-inline: 0;
}
${sel} .ak-list .ak-badge {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--ak-font-mono);
  font-size: var(--ak-text-fine);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ak-ink-dim);
}`,
  },
  {
    id: 'joined',
    summary: 'Cells share hairlines inside one bordered frame — a laid-out page, not floating cards.',
    css: (sel) => `
${sel} .ak-mosaic__units--grid {
  gap: 0;
  border: var(--ak-line-w) solid var(--ak-line);
}
${sel} .ak-mosaic__units--grid .ak-mosaic__unit {
  align-self: stretch;
  border-right: var(--ak-line-w) solid var(--ak-line);
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  padding: var(--ak-pad);
  margin-right: calc(-1 * var(--ak-line-w));
  margin-bottom: calc(-1 * var(--ak-line-w));
}
${sel} .ak-mosaic .ak-section {
  border: 0;
  box-shadow: none;
  background: transparent;
  padding: 0;
}`,
  },
  {
    id: 'press-sheet',
    summary: 'The POSTER composition: the masthead is giant display type ON the sheet itself (no band), the KPI chips are print stickers overlapping its foot, and unspanned units set themselves asymmetrically — a composed page, not a pile.',
    css: (sel) => `
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  margin-inline: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  overflow: visible;
}
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image) .ak-hero__inner {
  display: flex;
  flex-direction: column-reverse;
  gap: 6px;
  padding: clamp(8px, 3vh, 28px) 0 0;
}
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image) .ak-hero__title {
  font-size: clamp(3.4rem, 12.5vw, 10.5rem);
  line-height: 0.88;
  letter-spacing: -0.03em;
  text-transform: uppercase;
  color: var(--ak-accent-text);
  text-shadow: 0.045em 0.035em 0 color-mix(in oklab, var(--ak-spectrum-2) 62%, transparent);
  overflow-wrap: anywhere;
}
${sel} .ak-mosaic__band .ak-hero:not(.ak-hero--image) .ak-hero__sub {
  font-family: var(--ak-font-mono);
  font-size: var(--ak-text-fine);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--ak-ink-dim);
}
${sel} .ak-statrow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: calc(-1 * clamp(0.6rem, 2.5vw, 2.4rem));
  position: relative;
  z-index: 2;
}
${sel} .ak-statrow__tile {
  flex: 0 1 auto;
  border: 2px solid var(--ak-accent-text);
  border-radius: 4px;
  background: var(--ak-surface);
  box-shadow: none;
  padding: 8px 18px;
  transform: rotate(-1.2deg);
}
${sel} .ak-statrow__tile:nth-child(2n) {
  transform: rotate(1deg);
  border-color: color-mix(in oklab, var(--ak-spectrum-2) 62%, var(--ak-ink));
}
${sel} .ak-statrow__value { color: var(--ak-accent-text); }
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']) { grid-column: span 6; }
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(3n+2) { grid-column: span 4; }
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(3n) {
  grid-column: span 2;
  transform: translateY(clamp(6px, 1.8vw, 20px)) rotate(0.6deg);
}
@media (max-width: 760px) {
  ${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']),
  ${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(3n+2),
  ${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(3n) {
    grid-column: 1 / -1;
    transform: none;
  }
}`,
  },
  {
    id: 'marquee',
    summary: 'The OPENING composition: the band fills three quarters of the window with the title at its foot, and the working surface RISES OVER its bottom edge — staggered, asymmetric, layered; the page opens like a curtain, not like a form.',
    css: (sel) => `
${sel} .ak-mosaic__band .ak-hero {
  min-height: 74dvh;
  border-radius: 0;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
}
${sel} .ak-mosaic__band .ak-hero .ak-hero__inner {
  margin-top: auto;
  padding-inline: max(var(--ak-pad), calc((100vw - min(var(--ak-main-max), 100vw)) / 2 + var(--ak-pad)));
  padding-bottom: clamp(3rem, 10vh, 6.5rem);
}
${sel} .ak-hero__title {
  font-size: clamp(3.2rem, 11vw, 9.5rem);
  line-height: 0.92;
  letter-spacing: -0.025em;
}
${sel} .ak-mosaic__units--grid {
  margin-top: calc(-1 * clamp(2rem, 7vh, 5rem));
  position: relative;
  z-index: 2;
  align-items: start;
}
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):first-child { grid-column: span 6; }
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(2n) { grid-column: span 4; }
${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(2n+3) {
  grid-column: span 2;
  transform: translateY(clamp(10px, 3vh, 30px));
}
@media (max-width: 760px) {
  ${sel} .ak-mosaic__units--grid { margin-top: calc(-1 * clamp(1rem, 4vh, 2.4rem)); }
  ${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(2n),
  ${sel} .ak-mosaic__units--grid > .ak-mosaic__unit:not([class*='ak-mosaic__unit--']):nth-child(2n+3) {
    grid-column: 1 / -1;
    transform: none;
  }
}`,
  },
  {
    id: 'full-bleed-hero',
    summary: 'The focal band runs edge to edge, out of the measure column.',
    css: (sel) => `
${sel} .ak-mosaic__band .ak-hero {
  border-radius: 0;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
}
/* The band escapes the column; its TEXT stays aligned to it — found in the first
 * real-data experiment run, where the title clipped at the viewport edge. */
${sel} .ak-mosaic__band .ak-hero .ak-hero__inner {
  padding-inline: max(var(--ak-pad), calc((100vw - min(var(--ak-main-max), 100vw)) / 2 + var(--ak-pad)));
}`,
  },
];
