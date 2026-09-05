/**
 * @file atelier/describe-data.js
 * @description GENERATED — do not edit. Every component's parts, slots, variants, tokens and
 *   fork sentence, read out of the component modules' own JSDoc by tools/build-atelier-parts.ts.
 *   `AIMEAT.atelier.describe(name)` answers from this, so what an app reads at run time and what
 *   the source says are the same thing by construction. Run `pnpm build:atelier-parts` after
 *   changing an @parts / @slots / @variants / @tokens / @fork line; `pnpm check:atelier-parts`
 *   refuses a commit where the two have drifted.
 * @structure PARTS: one entry per public component
 * @usage  import { PARTS } from './describe-data.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Generated (wish-atelier-always-excellent, part 3).
 */
export const PARTS = {
  "bottomNav": {
    parts: ["root","item"],
    slots: ["item(entry)"],
    variants: ["dense"],
    tokens: ["--ak-chrome-bottom"],
    fork: "Copy .ak-bottomnav* out of shell.css; the chrome reserve is the shell's.",
    file: "shell.js",
  },
  "cardGrid": {
    parts: ["root","card","art","monogram","badge","body","title","sub","extra","aside"],
    slots: ["title(item)","sub(item)","extra(item)","badge(item)","aside(item)","art(item)"],
    variants: ["dense","wide","plain"],
    tokens: ["--ak-card-min","--ak-card-gap","--ak-card-aspect","--ak-card-pad"],
    fork: "Copy .ak-grid and .ak-card* out of content.css; you keep the monogram washes and lose the keyed reconcile that stops the wall re-entering on every change.",
    file: "grid.js",
  },
  "dialog": {
    parts: ["root","panel","head","title","close","body","text","before","after","actions","action"],
    slots: ["before()","after()","actions()","aside()"],
    variants: ["danger","celebrate","ai","roomy","wide"],
    tokens: [],
    fork: "Do not: the focus trap, Escape and focus return are the browser's through native <dialog>, and a hand-rolled overlay loses all three. Put your own markup in body(host) instead.",
    file: "dialog.js",
  },
  "figure": {
    parts: ["root","label","row","value","unit","delta","sub","aside"],
    slots: ["unit()","aside()"],
    variants: ["compact","center"],
    tokens: ["--ak-stat-unit-size","--ak-stat-up","--ak-stat-down"],
    fork: "One element, one number: build it yourself and call countUp(node, from, to).",
    file: "hero.js",
  },
  "form": {
    parts: ["root","field","label","input","req","hint","error","range","readout","bar","submit","cancel"],
    slots: [],
    variants: [],
    tokens: ["--ak-range-track","--ak-range-thumb"],
    fork: "Copy .ak-form* and .ak-input* out of data.css and build the fields yourself; you keep the tokens, and you give up the label/hint/error wiring, the announced refusal with focus on the first problem, the submit guard and the range's reading.",
    file: "form.js",
  },
  "health": {
    parts: ["root","row","lamp","name","label","sub","reading","aside"],
    slots: ["label(item)","sub(item)","reading(item)","aside(item)"],
    variants: ["dense","plain"],
    tokens: ["--ak-health-lamp","--ak-health-row-pad-y"],
    fork: "One row, one lamp; copy .ak-health* out of data.css.",
    file: "ops.js",
  },
  "hero": {
    parts: ["root","image","scrim","inner","before","title","sub","actions","after","aside"],
    slots: ["before()","title()","sub()","after()","aside()"],
    variants: ["tall","compact","center"],
    tokens: ["--ak-hero-min","--ak-hero-pad","--ak-hero-gap","--ak-hero-title-size","--ak-hero-image","--ak-scrim"],
    fork: "Copy .ak-hero and .ak-hero__* out of shell.css; you keep the tokens and the scrim's mode-following arithmetic, and you give up the repeated-title claim and the picture layer an effect knows how to land on.",
    file: "hero.js",
  },
  "kanban": {
    parts: ["root","col","head","colname","count","well","card","cardtitle","cardsub","badge","extra","aside"],
    slots: ["card(card)","cardtitle(card)","cardsub(card)","extra(card)","badge(card)","aside(card)","colhead(column)"],
    variants: ["dense","plain"],
    tokens: ["--ak-kanban-col-min","--ak-kanban-card-pad","--ak-kanban-gap"],
    fork: "Copy .ak-kanban* out of planner.css; you keep the tokens and give up the drag, the arrow-key move and the card's spring travel.",
    file: "planner.js",
  },
  "list": {
    parts: ["root","row","text","title","sub","extra","side","badge","meta","aside"],
    slots: ["row(item)","title(item)","sub(item)","extra(item)","badge(item)","meta(item)","aside(item)"],
    variants: ["dense","numbered","plain"],
    tokens: ["--ak-list-gap","--ak-list-row-gap","--ak-list-row-pad-y","--ak-list-row-pad-x","--ak-list-line-gap","--ak-list-aside-size"],
    fork: "Copy .ak-list and .ak-list__* out of content.css and build the row yourself; you keep the tokens, the look and settle()/keyedRows() if you call them, and you give up the empty state, the pick mark and every later fix to this row.",
    file: "list.js",
  },
  "listDetail": {
    parts: ["root","master","detail","back","body"],
    slots: ["title(item)","sub(item)","extra(item)","badge(item)","meta(item)","aside(item)"],
    variants: ["dense","numbered","plain"],
    tokens: ["--ak-list-gap","--ak-list-row-gap","--ak-list-aside-size"],
    fork: "Do not fork the container: mark your detail's own heading .ak-listdetail__title and the picked row's words travel into it. Its `variant` and `parts` are the list's, handed to the master pane.",
    file: "list.js",
  },
  "mediaCard": {
    parts: ["root","card","art","monogram","badge","body","title","sub","extra","actions"],
    slots: ["title(item)","sub(item)","extra(item)","badge(item)","art(item)"],
    variants: ["dense","plain"],
    tokens: ["--ak-card-aspect","--ak-card-pad"],
    fork: "Same as cardGrid; this is one card and its action row.",
    file: "grid.js",
  },
  "queue": {
    parts: ["root","strip","list","row","state","words","title","sub","extra","aside"],
    slots: ["row(item)","state(item)","title(item)","sub(item)","extra(item)","aside(item)"],
    variants: ["dense","plain"],
    tokens: ["--ak-queue-row-pad-y","--ak-queue-state-min"],
    fork: "Copy .ak-queue* out of data.css; you give up the keyed line, so a job finishing looks like a repaint.",
    file: "ops.js",
  },
  "rating": {
    parts: ["root","value","track","fill","words"],
    slots: ["words(state)"],
    variants: ["compact"],
    tokens: [],
    fork: "Copy .ak-rating* out of content.css; the clip trick is four rules.",
    file: "hero.js",
  },
  "searchBar": {
    parts: ["root","input","clear"],
    slots: ["aside()"],
    variants: ["dense","plain"],
    tokens: [],
    fork: "Two elements and a debounce; copy them if the shape is wrong.",
    file: "table.js",
  },
  "section": {
    parts: ["root","head","words","title","hint","actions","before","body","after"],
    slots: ["actions()","before()","after()"],
    variants: ["dense","plain","quiet"],
    tokens: ["--ak-section-pad","--ak-section-gap"],
    fork: "It IS the escape hatch: put your own markup in its body and keep the frame.",
    file: "shell.js",
  },
  "statRow": {
    parts: ["root","tile","value","unit","delta","label","hint","trend","aside"],
    slots: ["label(tile)","hint(tile)","aside(tile)"],
    variants: ["compact","trend","plain"],
    tokens: ["--ak-stat-min","--ak-stat-pad","--ak-stat-gap","--ak-stat-figure-size","--ak-stat-unit-size","--ak-stat-up","--ak-stat-down"],
    fork: "Copy .ak-statrow* out of shell.css; you keep the tokens and lose countUp() on a changed figure.",
    file: "hero.js",
  },
  "table": {
    parts: ["root","table","head","headcell","sort","body","row","cell","caption"],
    slots: ["cell(value, row, column)","head(column)","row(row)"],
    variants: ["dense","plain","lined"],
    tokens: ["--ak-table-cell-pad-y","--ak-table-cell-pad-x"],
    fork: "Copy .ak-table* out of content.css; you keep the tokens and the tabular numerals, and you give up the keyed body, so a sort stops being seen as a move.",
    file: "table.js",
  },
  "tabs": {
    parts: ["root","tab"],
    slots: ["tab(item)"],
    variants: ["dense","pill"],
    tokens: ["--ak-tabs-gap"],
    fork: "A row of buttons; copy .ak-tabs* out of shell.css and you give up the view transition.",
    file: "shell.js",
  },
  "timeline": {
    parts: ["root","item","dot","body","when","title","sub","extra","aside"],
    slots: ["item(item)","when(item)","title(item)","sub(item)","extra(item)","aside(item)"],
    variants: ["dense","plain"],
    tokens: ["--ak-timeline-dot","--ak-timeline-rail","--ak-timeline-gap","--ak-timeline-indent"],
    fork: "Copy .ak-timeline* out of content.css; the rail is one ::before and the dot is one span, and you give up the keyed line so every event re-enters on every change.",
    file: "timeline.js",
  },
};
