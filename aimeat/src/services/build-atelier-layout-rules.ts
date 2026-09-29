/**
 * @file src/services/build-atelier-layout-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layout rules for a settings page and a work-queue page, as the paragraph the
 *   Atelier specification carries after "COMPOSE, do not pile", and the catalogue entries of the
 *   workbench pieces that carry those rules. Its own file because build-atelier-prompt.ts is at
 *   the line ceiling.
 *
 *   WHY. The kit's form filled the width of its container and grouped nothing, and the page itself
 *   defaults to the full width of the screen (--ak-main-max: 100%). On a 2600 px screen an app built
 *   by the book showed every field as a line across the room, with no grouping, and its owner
 *   called it ugly, impractical and confusing (Postinjalostamo, 2026-09-28). The rules are from
 *   NN/g, Baymard, GOV.UK, Shopify Polaris, Material 3 and IBM Carbon, researched the same day.
 *   The owner then approved a drawn design for the same app and asked why such a layout was not
 *   in the Design Book to begin with; its pieces are now the kit's workbench (workbench.js), the
 *   look `workbench` and the genre `workbench`, and the rules below name them.
 * @structure ATELIER_WORKBENCH_COMPONENTS · atelierLayoutRules()
 * @usage body += atelierLayoutRules();
 *        export const ATELIER_COMPONENTS = [ ..., ...ATELIER_WORKBENCH_COMPONENTS ];
 * @version-history
 *   v1.4.0 — 2026-09-29 — `margins`: the person's home margin figure on the empty sides (wish reunakuvio).
 *   v1.3.0 — 2026-09-29 — The build order when the owner approved a drawing: drawing → genre on
 *     sample data → owner approves → app forked from the genre (wish rakennusohjeen-jarjestys).
 *   v1.2.0 — 2026-09-28 — Rule 5 adds the one settings card (`.ak-setgroups`) and saving on change,
 *     as the approved design draws the settings page.
 *   v1.1.0 — 2026-09-28 — The rules name the workbench pieces (settingsGroup, field `width`,
 *     statusBand + checkGrid, progressFigure, callout, app({ nav: 'side' })) where they named a
 *     proposed Design Book part and hand-set widths, and the pieces join the component catalogue.
 *   v1.0.0 — 2026-09-28 — Initial.
 */

/** The workbench pieces as catalogue entries: one sentence and one call each. */
export const ATELIER_WORKBENCH_COMPONENTS: ReadonlyArray<{ id: string; summary: string; example: string }> = [
  {
    id: 'sideNav',
    summary: 'The left column of a working tool: entries with a count and a tone dot, under group headings. Usually through app({ nav: \'side\', navItems }), which also folds it into the bottom bar on a phone; handle.nav.set({ value, items }) moves the mark and the counts.',
    example: "var a = AIMEAT.atelier.app({ title: 'Mail', logo: LOGO_URL, look: 'workbench', nav: 'side', navItems: [{ id: 'setup', label: 'Setup', count: '5/5', tone: 'ok', onPick: show }, { id: 'unclear', label: 'Unclear', count: 1, tone: 'warn', group: 'Waiting for you', onPick: show }] });",
  },
  {
    id: 'statusBand',
    summary: 'A page\'s opening card: where things stand (title + one sentence), a progress bar, one primary action. Its body takes a checkGrid.',
    example: "var b = AIMEAT.atelier.statusBand({ target: a.main, title: 'Ready', text: 'Five of five done.', progress: { value: 5, total: 5 }, action: { label: 'Run a batch', onClick: run } });",
  },
  {
    id: 'checkGrid',
    summary: 'Readiness tiles: ok, todo (needs the person, click to fix), optional, fail, wait. One line under each title.',
    example: "AIMEAT.atelier.checkGrid({ target: b.body, items: [{ id: 'mail', state: 'ok', title: 'Mailbox', sub: 'Gmail' }, { id: 'send', state: 'optional', title: 'Forwarding', sub: 'Not in use' }], onPick: fix });",
  },
  {
    id: 'choiceCards',
    summary: 'Two to four ways to do one thing as a radio group of cards, and a panel under them the app fills for the chosen one.',
    example: "AIMEAT.atelier.choiceCards({ target: s.body, items: [{ id: 'chat', kicker: 'Your own AI', title: 'Interview me', text: '…' }, { id: 'agent', kicker: 'Connected', title: 'Let an agent do it' }], renderPanel: function (item, host) { host.textContent = item.title; } });",
  },
  {
    id: 'settingsGroup',
    summary: 'One group of settings: heading and one sentence on the left, the controls on the right capped at a measure; folds to one column on a narrow box. Give each form field a `width` (short, date, medium, long).',
    example: "var g = AIMEAT.atelier.settingsGroup({ target: a.main, title: 'Batch', hint: 'How much mail one run reads.' }); AIMEAT.atelier.form({ target: g.body, fields: [{ name: 'size', label: 'Messages per batch', type: 'number', width: 'short' }], onSubmit: save });",
  },
  {
    id: 'progressFigure',
    summary: 'A batch while it runs: "3 / 10" as the largest thing, the bar, the item being worked on with step chips, toned tallies. set() counts up.',
    example: "var p = AIMEAT.atelier.progressFigure({ target: a.main, label: 'Processing', value: 3, total: 10, now: subject, steps: [{ label: 'read', state: 'done' }, { label: 'extract', state: 'now' }], counts: [{ id: 'ok', label: 'Clear', value: 2, tone: 'ok' }] });",
  },
  {
    id: 'promptPanel',
    summary: 'The person\'s own AI helps: copy the prompt, paste the answer; expect "json" hands onResult the parsed object.',
    example: "AIMEAT.atelier.promptPanel({ target: panel, prompt: setupPrompt, expect: 'json', onResult: preview });",
  },
  {
    id: 'queueRow',
    summary: 'A queue item\'s content (who, when, subject, chips, why it waits), as a list row part.',
    example: "parts: { row: function (r) { return AIMEAT.atelier.queueRow({ who: r.from, when: r.at, title: r.subject, chips: [{ text: r.klass }] }); } }",
  },
  {
    id: 'callout',
    summary: 'A tinted note with a tone (info, ok, warn, err) that says why: why an item is unclear, what failed, what to do.',
    example: "AIMEAT.atelier.callout({ target: detail, tone: 'warn', title: 'Why this is unclear', text: reason });",
  },
  {
    id: 'margins',
    summary: 'Wide screens: the sides wear the home margin figure.',
    example: "AIMEAT.atelier.margins(AIMEAT.atelier.marginsOf(prefs));",
  },
];

/** The paragraph, ending in a blank line like every other paragraph of the specification. */
export function atelierLayoutRules(): string {
  return 'A SETTINGS PAGE AND A QUEUE PAGE HAVE RULES, and a wide screen is where they break. The '
    + 'kit\'s form fills its container and the page is as wide as the screen, so on a desktop every '
    + 'field becomes a line across the room. Twelve rules, each from a design system or a usability '
    + 'study: (1) no input fills a wide page: a form field\'s `width` is short (a number), date, '
    + 'medium (a name or email) or long (a URL or a line of text, 32rem), full width only on a '
    + 'phone; (2) help text is at most 60ch per line; (3) one column, the label above its field, and '
    + 'only short related fields share a row; (4) every group of settings is a `settingsGroup` with '
    + 'a heading and ONE sentence of help, and no field stands outside a group; (5) from 840 px the '
    + 'group puts its help in a left column beside the controls, below that above them, and the '
    + 'groups of one page share ONE card divided by hairlines (target them into '
    + '`<div class="ak-setgroups">`), each control saving on change; (6) a tool '
    + 'with more than two screens uses `app({ nav: \'side\' })`: the pages in a left column, the '
    + 'content capped at 65rem; (7) advanced settings go behind ONE closed disclosure (`reveal`); '
    + '(8) the primary button aligns left with the inputs, says its verb and spans the width on a '
    + 'phone; (9) a setup screen opens with a `statusBand` ("5 of 5 done" and a bar) holding a '
    + '`checkGrid`, and each missing step is one tile with one fix a tap away; (10) a batch of ten '
    + 'seconds or more is a `progressFigure`: "3 / 10", the item being worked on and its steps; '
    + '(11) a number that changed flashes in place without moving (`attention(el, "flash")`); (12) '
    + 'every item an AI classified offers "Why?" (a `callout` with the answer, the reason and the '
    + 'data it saw) and "Correct", which says what it changes and from when. A work queue is '
    + '`listDetail`, its queues listed in the side column with counts. THE WHOLE SHAPE IS READY: '
    + 'the look `workbench` and the genre `workbench` (setup, queue, processing and settings screens '
    + 'with sample data) are this design finished; fork the genre rather than drawing it again. '
    + 'AND WHEN THE OWNER APPROVED A DRAWN DESIGN OF THEIR OWN, the order is fixed: the drawing '
    + 'becomes a GENRE first (the drawing\'s screens as one page on sample data), the owner looks at '
    + 'it running and approves it, and only then is the app forked from that genre. An app built '
    + 'straight from a drawing out of kit parts drifts from it screen by screen, and the owner finds '
    + 'every difference himself (Postinjalostamo, 2026-09-28: three rounds).\n\n';
}
