/**
 * @file src/services/builder/atelier-screens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The phone and the desktop as two layouts of one app, decided from what the person
 *   does: the section of the Atelier specification that is part `screens`, read before any code
 *   on `plain` and `fine`.
 *
 *   WHY. Builds made the phone well and the desktop badly: the phone column stretched across a
 *   1 900 px screen, every section a full-width card, empty cards first, a button across the room
 *   (a family front page, 2026-11-20). The developer had to ask "make it better" again and again.
 *   An automatic grid in the kit was drawn and rejected: placement that does not come from the
 *   app's tasks is arbitrary. So the rules make the builder decide the desktop from the tasks,
 *   with the canonical layouts of Material 3 (list-detail, supporting pane, feed), the scanning
 *   and hierarchy findings of NN/g, GOV.UK's line lengths and Apple's sidebar
 *   (wish-atelier-leve-n-ytt-suunnitellaan-ja-taso-on-fine-ellei-k-ytt).
 * @structure ATELIER_SCREENS_SECTION
 * @usage body += ATELIER_SCREENS_SECTION;   // its own part, `screens` (atelier-layers.ts)
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial.
 */

/** The section, ending in a blank line like every other section of the specification. */
export const ATELIER_SCREENS_SECTION = '## The phone and the desktop: two layouts of one app\n\n'
  + 'Build the app for both, in the app itself: there is no separate sketch to make. They are two layouts decided from what the person DOES, '
  + 'never one column stretched to the desktop or squeezed to the phone. The phone usually comes out right, because the kit folds everything to one column; '
  + 'the desktop is where builds fail, and a desktop that is the phone column stretched across the screen is not finished.\n\n'
  + '**1. Start from the tasks, never from the data.** Before you place anything, write in the build notes the tasks this screen serves, in order of how often '
  + 'the person does them, and what they look at first when they open it. That order decides everything below. For each group of things on the screen, '
  + 'say why it is there and who looks at it when; a group with no answer goes to another screen or away.\n\n'
  + '**2. Group by the moment of use.** What needs the person now (a question waiting for their answer, today, the next step) sits together. '
  + 'What they check (status, totals, news, what changed) sits together. What they set up once (preferences, choices that steer the app) does not sit in '
  + 'the daily view: it goes behind a link, a settings view or a `reveal`. Two groups of different kinds never share a card.\n\n'
  + '**3. Choose the desktop shape from the main task** (Material 3\'s canonical layouts). Say in the build notes which one and why:\n'
  + '- **Working through items** (mail, tasks, cases, candidates, orders): `listDetail`, the list and the open item side by side. The list never navigates away to a page of its own.\n'
  + '- **One main piece of work with things that support it** (a front page, a document, a board, a planner): a WORK column of about two thirds and a SUPPORTING column of '
  + 'about one third. The work column holds the primary task; the supporting one holds status, summaries, what is next and short links. In the mosaic, '
  + 'blocks with `span: \'main\'` and `span: \'side\'`; hand-made content goes in a `section` block with a `fill`, so it is placed too. '
  + 'A page of `section({ target: a.main })` calls has no desktop layout at all: it is one column across the screen.\n'
  + '- **Browsing many similar things** (products, articles, pictures, recipes): a feed or `cardGrid`.\n'
  + '- **More than two views:** `app({ nav: \'side\' })`, the views in a left column on the desktop and the bottom bar on the phone. Never tabs across a wide page for the main views.\n'
  + '- **Settings, setup or a work queue:** the twelve rules for a settings page and a queue page (part `patterns`, the mosaic section), and the genre `workbench`.\n\n'
  + '**4. Desktop rules.**\n'
  + '- The primary task and its action are visible at 1280×900 without scrolling, at the top left of the work column. People scan top left first and read less the lower they go.\n'
  + '- ONE primary button per screen, at its own width, aligned left with the field it acts on. Every other action is secondary or quiet.\n'
  + '- A line of text is 60 to 75 characters. A text field is as wide as what is typed into it: a sentence 32 to 48rem, a name or a number much less. Nothing that is typed into spans the screen.\n'
  + '- Use the width to show MORE AT ONCE (the list beside the open item, the summary beside the work), never to make things bigger. At most three columns; '
  + 'related things close together and unrelated things apart, so the spacing itself shows the groups.\n'
  + '- An empty group takes one line, not a card: "No news yet" sits in the supporting column, or the group is left out until it has something. '
  + 'Design the first visit, when everything is empty, as its own state: it says what to do first and offers that one action.\n'
  + '- Keyboard and pointer work: every action is reached with Tab in reading order, the primary one with Enter, and what can be clicked shows it on hover.\n\n'
  + '**5. The phone.** One column in the order of the tasks, the primary action within reach of the thumb, one task at a time, the views in the bottom bar. '
  + 'The supporting column comes after the work, or behind a link when it is long. The kit does the rest: touch sizes, no sideways scroll, the bars.\n\n'
  + '**6. Check both before you call it done**, at the size matrix of "Finishing" (390×844 the phone, 1280×900 and 1920×1080 the desktop), and say in the report for the desktop: which task is primary and where it is; '
  + 'what each column holds and why; what the first, empty visit shows. A screenshot where the cards span the whole width with empty room inside them, '
  + 'or where empty cards come before the work, fails this check.\n\n';
