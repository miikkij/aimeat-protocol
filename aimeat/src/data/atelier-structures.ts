/**
 * @file src/data/atelier-structures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE STRUCTURES — the named, reusable page-shape recipes a look composes with (the
 *   masthead, the joined frame, the press sheet, the marquee, the printed letter's rules, the
 *   machine room's console, the full-bleed band). Extracted
 *   whole from atelier-looks.ts on 2026-09-01 when the broadcast look pushed that file past the
 *   800-line cap: a pure move, nothing changed. atelier-looks.ts re-exports STRUCTURES, so the
 *   registry and the look builder import exactly what they imported before.
 * @structure AtelierStructure · STRUCTURES
 * @usage
 *   import { STRUCTURES } from '../data/atelier-looks.js';   // the re-export, unchanged
 * @version-history
 *   v1.2.0 — 2026-10-22 — operator-console, the machine room's page structure for the tdr look:
 *     a solid bar with a wide capital title, the hero as a plate with two accent corner brackets,
 *     letter-spaced capital labels, outlined actions that fill with the accent when touched, and
 *     rows between dashed rules.
 *   v1.1.0 — 2026-10-17 — press-rule, the printed letter's page structure for the kirjapaino
 *     look: the double rule (3 px of ink, a 4 px gap, 1 px of ink) under the bar and the hero,
 *     paper cards ruled in ink, rows between rules, underlined fields, the ink slab as the loud
 *     action, and color-scheme light so form controls stay paper-coloured in dark mode.
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
    id: 'press-rule',
    summary: 'The PRINTED LETTER: the bar and the hero are a masthead on the paper with the double rule under each (3 px of ink, a gap, 1 px of ink), cards are paper ruled in ink, lists are rows between rules, a field is one ink underline, the loud action is an ink slab with paper words, and the page keeps light form controls in dark mode.',
    css: (sel) => `
${sel} { color-scheme: light; }
${sel} .ak-app__bar {
  background: var(--ak-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 0;
  box-shadow: none;
  padding-bottom: 16px;
}
${sel} .ak-app__bar::after,
${sel} .ak-hero:not(.ak-hero--image)::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  box-sizing: border-box;
  border-top: 3px solid var(--ak-ink);
  border-bottom: 1px solid var(--ak-ink);
  pointer-events: none;
}
${sel} .ak-app__bar::after { left: var(--ak-pad); right: var(--ak-pad); }
${sel} .ak-app__title { letter-spacing: 0.01em; }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  overflow: visible;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: calc(var(--ak-pad) * 1.5) 0 calc(var(--ak-pad) * 1.5 + 8px); }
${sel} .ak-hero:not([data-ak-variant]) { --ak-hero-title-size: var(--ak-text-hero); }
${sel} .ak-hero__title { line-height: 1.04; letter-spacing: -0.015em; }
${sel} .ak-hero__title em, ${sel} .ak-hero__title i { font-style: italic; font-weight: 400; }
${sel} .ak-hero__sub { font-size: clamp(1.125rem, 1.6vw, 1.3rem); line-height: 1.5; max-width: 38rem; }
${sel} .ak-hero__before {
  font-family: var(--ak-font);
  letter-spacing: 0.2em;
  color: var(--ak-accent-text);
}
${sel} .ak-section {
  border: var(--ak-line-w) solid var(--ak-ink);
  box-shadow: none;
}
${sel} .ak-section__title { line-height: 1.15; }
${sel} .ak-statrow { gap: 0; border-top: var(--ak-line-w) solid var(--ak-ink); border-bottom: var(--ak-line-w) solid var(--ak-ink); }
${sel} .ak-statrow__tile {
  border: 0;
  border-right: var(--ak-line-w) solid var(--ak-ink);
  background: transparent;
  box-shadow: none;
  transform: none;
}
${sel} .ak-statrow__tile:last-child { border-right: 0; }
${sel} .ak-list { gap: 0; }
${sel} .ak-list__row {
  border: 0;
  border-top: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding-inline: 0;
}
${sel} .ak-list__row:last-child { border-bottom: var(--ak-line-w) solid var(--ak-line); }
${sel} .ak-btn { border-color: var(--ak-ink); }
${sel} .ak-btn--primary {
  background: var(--ak-ink);
  color: var(--ak-surface);
  border-color: var(--ak-ink);
  box-shadow: none;
  font-family: var(--ak-font-display);
  font-weight: 600;
  letter-spacing: 0.04em;
}
${sel} .ak-btn--primary:hover { filter: none; background: color-mix(in oklab, var(--ak-ink) 86%, var(--ak-bg)); }
${sel} .ak-input:not(.ak-input--range):not(.ak-input--area) {
  border: 0;
  border-bottom: 2px solid var(--ak-ink);
  background: transparent;
  padding-inline: 0;
}
${sel} .ak-input:focus-visible { outline: 2px solid var(--ak-ink); outline-offset: 4px; }
${sel} .ak-form__label {
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
${sel} input[type='checkbox'], ${sel} input[type='radio'] { accent-color: var(--ak-ink); }
${sel} a { color: var(--ak-ink); text-underline-offset: 3px; }
${sel} a:hover { color: var(--ak-accent-text); }`,
  },
  {
    id: 'operator-console',
    summary: 'The MACHINE ROOM: a solid bar on a hairline with its title set wide in capitals, the hero as a square plate on a hairline with two accent corner brackets, letter-spaced capital labels, outlined actions that fill with the accent when touched, and rows between dashed rules.',
    css: (sel) => `
${sel} .ak-app__bar {
  background: var(--ak-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
}
${sel} .ak-app__title {
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: var(--ak-surface);
  border: var(--ak-line-w) solid var(--ak-line);
  box-shadow: none;
  overflow: visible;
}
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image)::after {
  content: '';
  position: absolute;
  inset: auto;
  width: 22px;
  height: 22px;
  background: none;
  animation: none;
  pointer-events: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before {
  top: -1px;
  left: -1px;
  border-top: 2px solid var(--ak-accent);
  border-left: 2px solid var(--ak-accent);
}
${sel} .ak-hero:not(.ak-hero--image)::after {
  bottom: -1px;
  right: -1px;
  border-bottom: 2px solid var(--ak-accent);
  border-right: 2px solid var(--ak-accent);
}
${sel} .ak-hero__title { line-height: 1.2; letter-spacing: 0.05em; }
${sel} .ak-hero__sub {
  font-size: var(--ak-text-fine);
  line-height: 1.6;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ak-ink-dim);
}
${sel} .ak-hero__before { color: var(--ak-accent-text); letter-spacing: 0.14em; }
${sel} .ak-section { box-shadow: none; }
${sel} .ak-section__title,
${sel} .ak-statrow__value {
  font-weight: 400;
  letter-spacing: 0.06em;
}
${sel} .ak-section__title { font-size: 0.95rem; text-transform: uppercase; }
${sel} .ak-form__label,
${sel} .ak-statrow__label,
${sel} .ak-table th {
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ak-ink-dim);
}
${sel} .ak-statrow__tile { box-shadow: none; transform: none; }
${sel} .ak-list { gap: 0; }
${sel} .ak-list__row {
  border: 0;
  border-top: var(--ak-line-w) dashed var(--ak-line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
${sel} .ak-list__row:last-child { border-bottom: var(--ak-line-w) dashed var(--ak-line); }
${sel} .ak-btn,
${sel} .ak-tab {
  font-size: var(--ak-text-fine);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
${sel} .ak-btn {
  background: transparent;
  transition: background-color var(--ak-motion) var(--ak-ease), color var(--ak-motion) var(--ak-ease), border-color var(--ak-motion) var(--ak-ease);
}
${sel} .ak-btn:hover { filter: none; border-color: var(--ak-accent-text); color: var(--ak-accent-text); }
${sel} .ak-btn--primary {
  background: transparent;
  border-color: var(--ak-accent-text);
  color: var(--ak-accent-text);
  box-shadow: none;
  font-weight: 600;
}
${sel} .ak-btn--primary:hover,
${sel} .ak-btn--primary:active {
  filter: none;
  background: var(--ak-accent);
  border-color: var(--ak-accent);
  color: var(--ak-accent-ink);
}
${sel} .ak-btn--ghost { border-color: transparent; }
${sel} .ak-btn--danger:hover { border-color: currentColor; color: color-mix(in oklab, var(--ak-err) 74%, var(--ak-ink)); }
${sel} .ak-badge {
  background: transparent;
  border: var(--ak-line-w) solid currentColor;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
${sel} .ak-input:focus { border-color: var(--ak-accent-text); }
${sel} ::selection { background: var(--ak-accent); color: var(--ak-accent-ink); }`,
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
