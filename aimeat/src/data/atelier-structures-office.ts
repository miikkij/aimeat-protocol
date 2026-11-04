/**
 * @file src/data/atelier-structures-office.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page shapes of the five office and corporate looks (atelier-looks-office.ts):
 *   the binder, the highlighter, the command room, the annual report and the company bar. Each one
 *   changes what a side-navigation app is made of, because a set of colours on the same stacked
 *   white cards still reads as the same page. Moved out of atelier-structures.ts to keep that file
 *   under the 800-line cap; atelier-structures.ts composes them into STRUCTURES.
 *
 *   A STRUCTURE'S OWN COLOURS ARE ALWAYS PROVEN. The binder's board and tabs are the one place here
 *   with literal colours; test/unit/atelier-looks-office.test.ts measures the words on them.
 * @structure OFFICE_STRUCTURES
 * @usage
 *   import { OFFICE_STRUCTURES } from './atelier-structures-office.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: binder, highlighter, command-room, annual-report, company-bar.
 */
import type { AtelierStructure } from './atelier-structure-shape.js';

/** The binder's colours: the board behind the sheet and the five index tabs. */
export const BINDER_COLOURS = {
  board: { light: '#0f3b45', dark: '#08181c' },
  onBoard: { light: '#ffffff', dark: '#e6eeee' },
  tabInk: '#14242a',
  tabs: ['#8ab4f8', '#f4b740', '#c9a7eb', '#7bc8a4', '#f28b82'],
} as const;

export const OFFICE_STRUCTURES: readonly AtelierStructure[] = [
  {
    id: 'binder',
    summary: 'The BINDER: the page sits on a coloured board, the side navigation is a row of coloured index tabs, the chosen tab joins the sheet, and the sheet has two punched holes. Sections are ruled on the sheet instead of floating as cards.',
    css: (sel) => `
${sel} {
  --ak-binder-board: ${BINDER_COLOURS.board.light};
  --ak-binder-on-board: ${BINDER_COLOURS.onBoard.light};
  --ak-binder-tab-ink: ${BINDER_COLOURS.tabInk};
  --ak-binder-tab-1: ${BINDER_COLOURS.tabs[0]};
  --ak-binder-tab-2: ${BINDER_COLOURS.tabs[1]};
  --ak-binder-tab-3: ${BINDER_COLOURS.tabs[2]};
  --ak-binder-tab-4: ${BINDER_COLOURS.tabs[3]};
  --ak-binder-tab-5: ${BINDER_COLOURS.tabs[4]};
}
[data-theme='dark'] ${sel}, ${sel}[data-theme='dark'] {
  --ak-binder-board: ${BINDER_COLOURS.board.dark};
  --ak-binder-on-board: ${BINDER_COLOURS.onBoard.dark};
}
${sel} .ak-app__bar {
  background: var(--ak-binder-board);
  color: var(--ak-binder-on-board);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 0;
  box-shadow: none;
}
${sel} .ak-app__title { color: var(--ak-binder-on-board); letter-spacing: -0.02em; }
${sel} .ak-app__pill .aimeat-auth-wrap { display: inline-flex; padding: 4px 6px; background: var(--ak-surface); border-radius: var(--ak-radius-sm); }
${sel} .ak-app__bar .ak-app__tagline { color: var(--ak-binder-on-board); }
${sel} .ak-app__frame { background: var(--ak-binder-board); gap: 0; padding: 0 var(--ak-pad) var(--ak-pad) calc(var(--ak-pad) * 1.5); }
${sel} .ak-app__side { padding-top: calc(var(--ak-pad) * 2); }
${sel} .ak-sidenav { gap: 12px; }
${sel} .ak-sidenav__group { gap: 5px; padding-left: 14px; }
${sel} .ak-sidenav__heading { color: var(--ak-binder-on-board); padding-left: 2px; }
${sel} .ak-sidenav__item {
  background: var(--ak-binder-tab-1);
  color: var(--ak-binder-tab-ink);
  font-weight: 600;
  border-radius: var(--ak-radius) 0 0 var(--ak-radius);
  transition: margin-left var(--ak-motion) var(--ak-ease), background var(--ak-motion) var(--ak-ease);
}
${sel} .ak-sidenav__item:nth-of-type(5n+2) { background: var(--ak-binder-tab-2); }
${sel} .ak-sidenav__item:nth-of-type(5n+3) { background: var(--ak-binder-tab-3); }
${sel} .ak-sidenav__item:nth-of-type(5n+4) { background: var(--ak-binder-tab-4); }
${sel} .ak-sidenav__item:nth-of-type(5n) { background: var(--ak-binder-tab-5); }
${sel} .ak-sidenav__item:hover { background: var(--ak-binder-tab-2); margin-left: -6px; width: calc(100% + 6px); }
${sel} .ak-sidenav__item .ak-sidenav__count { color: var(--ak-binder-tab-ink); }
${sel} .ak-sidenav__item--active,
${sel} .ak-sidenav__item--active:hover,
${sel} .ak-sidenav__item--active:nth-of-type(n) {
  background: var(--ak-bg);
  color: var(--ak-ink);
  font-weight: 700;
  margin-left: -14px;
  width: calc(100% + 14px);
  box-shadow: none;
}
${sel} .ak-sidenav__item--active .ak-sidenav__count { color: var(--ak-ink-dim); }
${sel} .ak-sidenav__item:focus-visible { outline-color: var(--ak-binder-on-board); }
${sel} .ak-app__side .ak-sidenav__foot { color: var(--ak-ink); }
${sel}.ak-app--sidenav .ak-app__main,
${sel} .ak-app--sidenav .ak-app__main {
  padding: calc(var(--ak-pad) * 2.25) calc(var(--ak-pad) * 2.75) calc(var(--ak-chrome-bottom) + var(--ak-pad) * 2.75) calc(var(--ak-pad) * 4.5);
  background:
    radial-gradient(circle 10px at 32px 120px, var(--ak-binder-board) 96%, transparent) no-repeat,
    radial-gradient(circle 10px at 32px 360px, var(--ak-binder-board) 96%, transparent) no-repeat,
    var(--ak-bg);
  border-radius: 0 var(--ak-radius) var(--ak-radius) var(--ak-radius);
  max-width: none;
  min-height: 100%;
  box-sizing: border-box;
}
${sel} .ak-section {
  background: transparent;
  border: 0;
  border-top: 2px solid var(--ak-ink);
  border-radius: 0;
  box-shadow: none;
}
${sel} .ak-section:not(.ak-section--flush) { --ak-section-pad: 16px 0 0; }
${sel} .ak-section__title { font-size: 1.625rem; letter-spacing: -0.015em; }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: 0 0 var(--ak-pad); }
${sel} .ak-hero__title { line-height: 1; letter-spacing: -0.03em; }
${sel} .ak-input:not(.ak-input--range) { border: 2px solid var(--ak-ink); background: var(--ak-surface); }
${sel} .ak-btn--primary { background: var(--ak-ink); color: var(--ak-bg); border-color: var(--ak-ink); box-shadow: none; }
${sel} .ak-btn--primary:hover, ${sel} .ak-btn--primary:active { filter: none; background: color-mix(in oklab, var(--ak-ink) 86%, var(--ak-bg)); }
${sel} .ak-btn:not(.ak-btn--primary):not(.ak-btn--danger) { border: 2px solid var(--ak-ink); background: transparent; color: var(--ak-ink); }
${sel} .ak-list { gap: 0; }
${sel} .ak-list__row {
  background: transparent;
  border: 0;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  padding-inline: 0;
}
${sel} .ak-table { background: transparent; border: 0; border-radius: 0; box-shadow: none; }
${sel} .ak-table th { background: transparent; color: var(--ak-ink); border-bottom: 2px solid var(--ak-ink); }
${sel} .ak-statrow__tile { background: transparent; border: 0; border-top: 2px solid var(--ak-ink); border-radius: 0; box-shadow: none; transform: none; }
@media (max-width: 760px) {
  ${sel} .ak-app__frame { padding: 0; background: var(--ak-bg); }
  ${sel}.ak-app--sidenav .ak-app__main,
  ${sel} .ak-app--sidenav .ak-app__main {
    padding: var(--ak-pad) var(--ak-pad) calc(var(--ak-chrome-bottom) + var(--ak-touch) + var(--ak-pad) * 2);
    background: var(--ak-bg);
    border-radius: 0;
  }
}`,
  },
  {
    id: 'highlighter',
    summary: 'The HIGHLIGHTER: no cards at all. Black words on the page under heavy rules, a giant heading, and one marker colour on a <mark> that always means the same thing: this came from a machine and nobody has accepted it yet.',
    css: (sel) => `
${sel} .ak-app__bar {
  background: var(--ak-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 3px solid var(--ak-ink);
  box-shadow: none;
}
${sel} .ak-app__title { font-weight: 900; letter-spacing: -0.02em; }
${sel} .ak-section,
${sel} .ak-statrow__tile {
  background: transparent;
  border: 0;
  border-top: 3px solid var(--ak-ink);
  border-radius: 0;
  box-shadow: none;
  transform: none;
}
${sel} .ak-section:not(.ak-section--flush) { --ak-section-pad: 16px 0 0; }
${sel} .ak-section__title { font-size: 1.875rem; font-weight: 900; letter-spacing: -0.03em; }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: 0 0 var(--ak-pad); }
${sel} .ak-hero__title { line-height: 0.92; letter-spacing: -0.05em; }
${sel} .ak-hero__sub { font-size: clamp(1.25rem, 2vw, 1.625rem); line-height: 1.3; font-weight: 500; color: var(--ak-ink); }
${sel} .ak-sidenav__item { background: transparent; border-radius: 0; padding-inline: 0; font-weight: 500; }
${sel} .ak-sidenav__item:hover { background: transparent; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
${sel} .ak-sidenav__heading { padding-inline: 0; }
${sel} .ak-sidenav__item--active,
${sel} .ak-sidenav__item--active:hover {
  background: transparent;
  box-shadow: none;
  font-weight: 900;
  text-decoration: underline;
  text-decoration-thickness: 3px;
  text-underline-offset: 5px;
}
${sel} .ak-input:not(.ak-input--range) { background: transparent; border: 2px solid var(--ak-ink); }
${sel} .ak-btn--primary { background: var(--ak-ink); color: var(--ak-bg); border-color: var(--ak-ink); box-shadow: none; font-weight: 800; }
${sel} .ak-btn--primary:hover, ${sel} .ak-btn--primary:active { filter: none; background: var(--ak-mark); color: var(--ak-mark-ink); }
${sel} .ak-btn:not(.ak-btn--primary):not(.ak-btn--danger) { border: 2px solid var(--ak-ink); background: transparent; color: var(--ak-ink); font-weight: 800; }
${sel} .ak-dialog { background: var(--ak-bg); border: 3px solid var(--ak-ink); }
${sel} .ak-list { gap: 0; }
${sel} .ak-list__row {
  background: transparent;
  border: 0;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
  padding-inline: 0;
}
${sel} .ak-table { background: transparent; border: 0; border-radius: 0; box-shadow: none; }
${sel} .ak-table th { background: transparent; color: var(--ak-ink); font-weight: 800; border-bottom: 2px solid var(--ak-ink); }
${sel} .ak-table td { border-color: color-mix(in oklab, var(--ak-ink) 22%, var(--ak-bg)); font-variant-numeric: tabular-nums; }
${sel} .ak-statrow__value { font-weight: 900; letter-spacing: -0.04em; }
${sel} mark { padding: 0 0.3em; font-weight: inherit; }
${sel} ::selection { background: var(--ak-mark); color: var(--ak-mark-ink); }`,
  },
  {
    id: 'command-room',
    summary: 'The COMMAND ROOM: a working screen for many rows. A slim bar on a hairline, a tight side column, flat panels joined by hairlines, table heads in small capitals, figures in tabular numerals. On a wide screen the controls sit lower; on a phone they keep their full touch height.',
    css: (sel) => `
${sel} .ak-app__bar {
  background: var(--ak-surface);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  box-shadow: none;
}
${sel} .ak-app__title { font-size: 0.9375rem; font-weight: 700; letter-spacing: 0.02em; }
${sel} .ak-section {
  background: var(--ak-surface);
  border: var(--ak-line-w) solid var(--ak-line);
  box-shadow: none;
}
${sel} .ak-section:not(.ak-section--flush) { --ak-section-pad: 12px 14px; --ak-section-gap: 8px; }
${sel} .ak-section__title,
${sel} .ak-app--sidenav .ak-section__title { font-size: 0.875rem; font-weight: 600; letter-spacing: 0; }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: transparent;
  border: 0;
  box-shadow: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: 0 0 var(--ak-pad); }
${sel} .ak-hero__title { font-size: 1.25rem; font-weight: 600; line-height: 1.3; letter-spacing: 0; }
${sel} .ak-hero__sub { font-size: var(--ak-text-body); }
${sel} .ak-table th,
${sel} .ak-sidenav__heading {
  font-size: var(--ak-text-fine);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ak-ink-dim);
}
${sel} .ak-table td { font-variant-numeric: tabular-nums; }
${sel} .ak-input:not(.ak-input--range) { background: var(--ak-surface); }
${sel} .ak-sidenav { gap: 10px; }
${sel} .ak-sidenav__group { gap: 1px; }
${sel} .ak-sidenav__item { color: var(--ak-ink); border-radius: var(--ak-radius-sm); }
${sel} .ak-sidenav__item:hover { background: var(--ak-surface-2); }
${sel} .ak-sidenav__item--active,
${sel} .ak-sidenav__item--active:hover {
  background: color-mix(in oklab, var(--ak-accent) 12%, var(--ak-surface));
  color: var(--ak-ink);
  box-shadow: inset 0 0 0 var(--ak-line-w) var(--ak-accent-text);
}
${sel} .ak-sidenav__count { font-family: var(--ak-font-mono); font-size: var(--ak-text-fine); }
${sel} .ak-list { gap: 0; background: var(--ak-surface); border: var(--ak-line-w) solid var(--ak-line); }
${sel} .ak-list__row {
  border: 0;
  border-bottom: var(--ak-line-w) solid var(--ak-line);
  border-radius: 0;
  box-shadow: none;
}
${sel} .ak-list__row:last-child { border-bottom: 0; }
${sel} .ak-btn { box-shadow: none; font-weight: 600; }
${sel} .ak-btn--primary { background: var(--ak-accent); color: var(--ak-accent-ink); border-color: var(--ak-accent); }
${sel} .ak-statrow__tile { box-shadow: none; transform: none; border: var(--ak-line-w) solid var(--ak-line); }
${sel} .ak-statrow__value { font-family: var(--ak-font-mono); font-weight: 500; }
@media (min-width: 761px) {
  ${sel} { --ak-touch: 34px; --ak-touch-min: 30px; }
  ${sel} .ak-sidenav__item { padding: 5px 10px; }
  ${sel} .ak-table th, ${sel} .ak-table td { padding-block: 6px; }
  ${sel} .ak-list__row { padding-block: 7px; }
}`,
  },
  {
    id: 'annual-report',
    summary: 'The ANNUAL REPORT: one band of the company colour across the top, a numbered table of contents as the side navigation, a serif heading over rules, no cards, and a very large figure in the hero\'s kicker for a chapter number.',
    css: (sel) => `
${sel} .ak-app__bar {
  background: var(--ak-bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-top: 12px solid var(--ak-accent);
  border-bottom: var(--ak-line-w) solid var(--ak-ink);
  box-shadow: none;
}
${sel} .ak-app__title { font-family: var(--ak-font); font-size: 0.875rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
${sel} .ak-sidenav { gap: 0; counter-reset: ak-report-toc; }
${sel} .ak-sidenav__group { gap: 0; }
${sel} .ak-sidenav__heading { padding: 14px 0 6px; color: var(--ak-ink); font-weight: 700; letter-spacing: 0.1em; }
${sel} .ak-sidenav__item {
  counter-increment: ak-report-toc;
  background: transparent;
  border-top: var(--ak-line-w) solid color-mix(in oklab, var(--ak-ink) 22%, var(--ak-bg));
  border-radius: 0;
  padding-inline: 0;
  color: var(--ak-ink);
}
${sel} .ak-sidenav__item::before {
  content: counter(ak-report-toc, decimal-leading-zero);
  flex: none;
  width: 26px;
  font-size: var(--ak-text-fine);
  font-variant-numeric: tabular-nums;
  color: var(--ak-ink-dim);
}
${sel} .ak-sidenav__item:hover { background: transparent; text-decoration: underline; text-underline-offset: 3px; }
${sel} .ak-sidenav__item--active,
${sel} .ak-sidenav__item--active:hover {
  background: transparent;
  box-shadow: none;
  font-weight: 700;
  border-top: 2px solid var(--ak-ink);
}
${sel} .ak-sidenav__item--active::before { color: var(--ak-ink); }
${sel} .ak-section,
${sel} .ak-statrow__tile {
  background: transparent;
  border: 0;
  border-top: 2px solid var(--ak-ink);
  border-radius: 0;
  box-shadow: none;
  transform: none;
}
${sel} .ak-section:not(.ak-section--flush) { --ak-section-pad: 16px 0 0; }
${sel} .ak-section__title,
${sel} .ak-app--sidenav .ak-section__title { font-size: 1.625rem; font-weight: 600; letter-spacing: -0.005em; }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: 0 0 var(--ak-pad); }
${sel} .ak-hero__before {
  font-family: var(--ak-font-display);
  font-size: clamp(5.5rem, 13vw, 11.5rem);
  font-weight: 400;
  line-height: 0.8;
  letter-spacing: 0;
  color: var(--ak-accent-text);
}
${sel} .ak-hero__title { line-height: 1.02; letter-spacing: -0.015em; }
${sel} .ak-hero__sub { font-family: var(--ak-font-display); font-size: 1.3125rem; line-height: 1.3; color: var(--ak-ink); }
${sel} .ak-table { background: transparent; border: 0; border-radius: 0; box-shadow: none; }
${sel} .ak-table th { background: transparent; color: var(--ak-ink); font-weight: 700; border-bottom: 2px solid var(--ak-ink); }
${sel} .ak-table td { font-variant-numeric: tabular-nums; border-color: color-mix(in oklab, var(--ak-ink) 22%, var(--ak-bg)); }
${sel} .ak-statrow__value { font-weight: 600; font-variant-numeric: lining-nums tabular-nums; }
${sel} .ak-input:not(.ak-input--range) { background: var(--ak-surface); border: 0; border-bottom: 2px solid var(--ak-ink); }
${sel} .ak-btn { box-shadow: none; }
${sel} .ak-btn--primary { background: var(--ak-accent); color: var(--ak-accent-ink); border-color: var(--ak-accent); }
${sel} .ak-btn:not(.ak-btn--primary):not(.ak-btn--danger) { background: transparent; border: var(--ak-line-w) solid var(--ak-ink); color: var(--ak-ink); }
${sel} .ak-list { gap: 0; }
${sel} .ak-list__row {
  background: transparent;
  border: 0;
  border-bottom: var(--ak-line-w) solid color-mix(in oklab, var(--ak-ink) 22%, var(--ak-bg));
  border-radius: 0;
  box-shadow: none;
  padding-inline: 0;
}`,
  },
  {
    id: 'company-bar',
    summary: 'The COMPANY BAR: the bar is filled with the company\'s own colour, with words worked out to stay readable on it. Neutral greys everywhere else, headings in the colour, and the chosen page tinted with it. Made for a style kit with one brand colour.',
    css: (sel) => `
${sel} .ak-app__bar {
  background: var(--ak-accent);
  color: var(--ak-accent-ink);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 0;
  box-shadow: none;
}
${sel} .ak-app__title,
${sel} .ak-app__bar .ak-app__tagline { color: var(--ak-accent-ink); }
${sel} .ak-app__pill .aimeat-auth-wrap { display: inline-flex; padding: 4px 6px; background: var(--ak-surface); border-radius: var(--ak-radius-sm); }
${sel} .ak-sidenav__item { color: var(--ak-ink); }
${sel} .ak-sidenav__item--active,
${sel} .ak-sidenav__item--active:hover {
  background: color-mix(in oklab, var(--ak-accent) 12%, var(--ak-surface));
  color: var(--ak-accent-text);
  font-weight: 700;
  box-shadow: none;
}
${sel} .ak-section { box-shadow: none; }
${sel} .ak-section__title,
${sel} .ak-hero__title { color: var(--ak-accent-text); }
${sel} .ak-hero:not(.ak-hero--image) {
  min-height: unset;
  background: transparent;
  border: 0;
  box-shadow: none;
}
${sel} .ak-hero:not(.ak-hero--image)::before,
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__scrim { display: none; }
${sel} .ak-hero:not(.ak-hero--image) .ak-hero__inner { padding: 0 0 var(--ak-pad); }
${sel} .ak-hero__title { letter-spacing: -0.02em; }
${sel} .ak-btn--primary { background: var(--ak-accent); color: var(--ak-accent-ink); border-color: var(--ak-accent); box-shadow: none; }
${sel} .ak-btn--primary:hover, ${sel} .ak-btn--primary:active { filter: brightness(0.94); }
${sel} .ak-input:not(.ak-input--range) { background: var(--ak-surface); }
${sel} .ak-input:focus { border-color: var(--ak-accent-text); }`,
  },
];
