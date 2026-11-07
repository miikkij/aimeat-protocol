/**
 * @file src/services/app-build/build-introduction-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two additions to the Atelier build specification that Jouni asked for on 2026-11-07,
 *   while Pastelair was being built:
 *
 *   THE INTRODUCTION. The interview asks whether the app opens with an introduction for a new user:
 *   what the app is, who it is for, how it is used, how to start using it with one's own AI (prompts
 *   with copy buttons for their chat), and what it is good for; at which scope; and whether it
 *   carries diagrams or pictures. A page whose job is to sell or announce, such as a landing page,
 *   usually takes none. His words: "haluaisin että tämmöinen introduction juttu olisi application
 *   devaamiseen ihan defaulttinakin kova juttu, niin että ainakin kysytään käyttäjältä haluaako se
 *   introductionin siihen applikaatioon mukaan [...] esim sitä ei varmasti haluta jos joku
 *   markkinointi tekee jonkun landing pagen". The question names diagrams and pictures, never a
 *   library, as he asked; the build section says how they are drawn.
 *
 *   THE CLEAN DESIGN, ALWAYS OFFERED. The proposal offers three to five designs and one of them is
 *   always the clean look (`clean`, atelier-looks-clean.ts). His words: "olisi hyvä antaa 3-5
 *   vaihtoehtoa ja 1 niistä olisi aina tämä default clean vaihtoehto".
 *
 *   ITS OWN FILE because build-atelier-prompt.ts is at the 800-line limit, the same reason
 *   build-data-map-step.ts has one. In app-build/ because no new flat file goes into src/services/
 *   (check:services-flat); the build specification's other files are older than that rule. Atelier only: a new app is built on Atelier, and the Classic
 *   interview runs for an app the owner asked to build on Classic by name.
 * @structure INTRODUCTION_QUESTION (the interview) · ATELIER_INTRODUCTION_PROPOSAL_LINE and
 *   ATELIER_DESIGNS_PROPOSAL_LINE (the proposal, build-atelier-people.ts) ·
 *   ATELIER_INTRODUCTION_HEADING and ATELIER_INTRODUCTION_SECTION (the body, served in part
 *   `libraries`) · CLEAN_LOOK_ID
 * @usage
 *   import { INTRODUCTION_QUESTION, ATELIER_INTRODUCTION_SECTION } from './app-build/build-introduction-step.js';
 *   full += buildDataMapStep('atelier') + INTRODUCTION_QUESTION + ATELIER_STRUCTURE_STEP;
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial: the introduction question and section, and the clean design in
 *     every proposal.
 */

/** The look that is one of the designs in every proposal (atelier-looks-clean.ts). */
export const CLEAN_LOOK_ID = 'clean';

/**
 * One more interview question, right after the data map. No markdown heading on purpose: it is
 * read as part of the interview section, and the layered serving cuts the specification at headings.
 */
export const INTRODUCTION_QUESTION = '**Then the introduction: one more question.** '
  + 'Ask whether the app opens with an introduction for a new user: what it is, who it is for, how it is used, how to start using it with their own AI (prompts they copy into their chat with one press), and what it is good for. '
  + 'Offer the scope: none, short (a few paragraphs on one screen) or full (a view of its own, in sections). Ask whether it should have diagrams or pictures that explain how it works. '
  + 'Recommend one: a full one for a tool other people will learn, none for a page whose job is to sell or announce, such as a landing page.\n\n';

/** One bullet of the proposal: the introduction the interview agreed, or none. */
export const ATELIER_INTRODUCTION_PROPOSAL_LINE = '- **The introduction, or none**, as the interview agreed: its scope, its diagrams or pictures, and the prompts it gives their AI. Part `libraries` says how it is built.\n';

/** The designs bullet of the proposal. It replaced "Two or three genres" on 2026-11-07. */
export const ATELIER_DESIGNS_PROPOSAL_LINE = '- **Three to five designs, named, each with one sentence on why it fits THIS app** and what the first screen looks like in it. '
  + 'ONE IS ALWAYS THE CLEAN ONE, for a person who wants a clear working app: the look `' + CLEAN_LOOK_ID + '` (grey surfaces, the system\'s own fonts, thin hairlines, one accent, nothing moving at idle; the style kit `kit-clean` gives it one blue where this node has it), built as `app({ look: \'' + CLEAN_LOOK_ID + '\' })`, and on `fine` with `<meta name="aimeat-register" content="custom:' + CLEAN_LOOK_ID + '">`. '
  + 'The others are more coloured or different: on `fine` genres from the genre list (part `genre`, or `aimeat_designbook_search { kind: "genre" }`), on `plain` looks (part `look`). Look at the owner\'s own apps first (`aimeat_app_list`): the ones already on Atelier show what they like. Say which one you would take. '
  + 'Apart from the clean one, a look preset with components stacked in it is not a design: that is the default page every app looks like, and it is what gets sent back.\n';

/** The heading of the build section; build-atelier-layers.ts serves it in part `libraries`. */
export const ATELIER_INTRODUCTION_HEADING = 'An introduction, when the owner asked for one';

/** How the introduction is built. In the body, so it is part of the spec token. */
export const ATELIER_INTRODUCTION_SECTION = '## ' + ATELIER_INTRODUCTION_HEADING + '\n\n'
  + 'Build it only when the interview said so, at the scope it agreed. It is the first thing a new person reads, so lead with what they get, not with how the app is made.\n'
  + '- **Where it lives.** A short one is a `section` at the top of the first screen while the person has nothing saved yet. A full one is a view of its own, first in the navigation (a tab, or an entry of `app({ nav: \'side\' })`), opened first while the person has nothing saved and reachable from the navigation at all times. Never a second header or a page outside the app.\n'
  + '- **What it says, in this order** (a short one keeps a sentence or two of each): what the app is, in one paragraph; who it is for; how it is used, in numbered steps; how to start with their own AI; what it is good for, as three to five real uses. Write facts the app has, the same as its text about the app (`aimeat_app_manage` action `settings`, `about`), and nothing it does not do.\n'
  + '- **Diagrams** are written as ```mermaid fences in markdown and drawn by the kit\'s `doc` block with `rich: true` (`AIMEAT.atelier.doc({ target, title, markdown, rich: true })`, which wears the page\'s colours); load `aimeat-markdown.js` beside the kit, because without it the block shows the text as written. A flow of how the app is used, or of where the data goes, is usually the one worth drawing; keep a diagram to a few boxes, with labels in the page\'s language. **A picture** follows the imagery rule (part `look`): at most one without asking, generated with `aimeat_image_generate` and kept in storage, never a data: address.\n'
  + '- **Prompts for their AI.** Each one is a ready message for the person\'s own chat, with a copy button: `AIMEAT.atelier.promptPanel({ target, prompt })`, or `AIMEAT.atelier.copy(text)` behind a button. The first one connects their AI to the app: it names the app\'s address and its bound skill (`aimeat_skill_get`), so the AI reads how to use it before it does anything. Then one prompt for each typical task. Write them in the page\'s language, and say in one line that an AI connected over MCP does the work and any other AI gets the steps.\n'
  + '- **Two languages.** Every word, diagram labels and prompts included, goes through `AIMEAT.atelier.i18n.use({ en: {…}, fi: {…} })` like the rest of the page.\n\n';
